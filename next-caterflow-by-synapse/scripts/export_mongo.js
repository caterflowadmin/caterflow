#!/usr/bin/env node
// One-off export: dump every collection in a MongoDB database to a local
// Extended JSON (EJSON) file, one file per collection, plus a metadata file
// with each collection's indexes. Only reads from the source — no writes to
// any other cluster — so it isn't affected by target-side throttling/OOM.
//
// The output files can be imported into any MongoDB database (Atlas's
// Data Explorer "Import Data" UI, `mongoimport --jsonArray`, or a small
// script using EJSON.parse + insertMany) since EJSON preserves BSON types
// (ObjectId, Date, Binary, Decimal128, Long, ...) exactly.
//
// Usage:
//   SOURCE_MONGODB_URL="mongodb+srv://.../" \
//   DATABASE_NAME=caterflow_archive \
//   OUT_DIR=/path/to/export \
//   node scripts/export_mongo.js [--collections=a,b,c]

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const args = process.argv.slice(2);
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const ONLY_COLLECTIONS = collectionsArg
  ? collectionsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const SOURCE_URI = process.env.SOURCE_MONGODB_URL || process.env.SOURCE_MONGODB_URI || '';
const DATABASE_NAME = process.env.DATABASE_NAME || process.env.MONGODB_DB_NAME || 'caterflow_archive';
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'mongo_export');

if (!SOURCE_URI) {
  console.error('Set SOURCE_MONGODB_URL (the connection string to export from).');
  process.exit(2);
}

// Same slow-link lessons as migrate_mongo.js: adapt batch size to document
// size, and use a per-operation watchdog since a stalled socket can sit
// ESTABLISHED-but-dead indefinitely with no driver-level error.
const BATCH_SIZE = 100;
const TARGET_BATCH_BYTES = 3 * 1024 * 1024;
const OP_STALL_MS = 90000;
const MAX_ATTEMPTS = 10;

const mongoOptions = {
  maxPoolSize: 3,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 20000,
  socketTimeoutMS: 120000,
  retryReads: true,
};

function computeBatchSize(avgObjSize) {
  if (!avgObjSize || avgObjSize <= 0) return BATCH_SIZE;
  return Math.max(1, Math.min(BATCH_SIZE, Math.floor(TARGET_BATCH_BYTES / avgObjSize)));
}

function maskUri(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

function firstLine(message) {
  return String(message || '').split('\n')[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOverloadError(err) {
  const labels = err?.errorLabelSet || err?.cause?.errorLabelSet;
  if (labels && typeof labels.has === 'function' && labels.has('SystemOverloadedError')) return true;
  return /SystemOverloadedError/i.test(String((err && err.message) || ''));
}

function isTransientNetworkError(err) {
  const msg = String((err && err.message) || '');
  const labels = err?.errorLabelSet || err?.cause?.errorLabelSet;
  return (
    err?.name === 'StallTimeoutError' ||
    err?.name === 'MongoNetworkError' ||
    err?.name === 'MongoNetworkTimeoutError' ||
    err?.name === 'MongoServerSelectionError' ||
    (labels && typeof labels.has === 'function' && labels.has('RetryableWriteError')) ||
    isOverloadError(err) ||
    /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|socket hang up|connection.*closed|topology.*closed|SSL routines|tlsv1 alert|timed out/i.test(
      msg
    )
  );
}

class StallTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} stalled: no response after ${ms}ms (connection likely dead)`);
    this.name = 'StallTimeoutError';
  }
}

function withStallWatchdog(promise, label) {
  let settled = false;
  const guarded = promise.then(
    (v) => { settled = true; return v; },
    (e) => { settled = true; throw e; }
  );
  guarded.catch(() => {});
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (!settled) reject(new StallTimeoutError(label, OP_STALL_MS));
    }, OP_STALL_MS);
  });
  return Promise.race([guarded, watchdog]).finally(() => clearTimeout(timer));
}

async function connectWithRetry(client, label) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
      console.log(`Connecting to ${label} failed (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
}

async function createClient() {
  const client = new MongoClient(SOURCE_URI, mongoOptions);
  await connectWithRetry(client, 'source');
  return client;
}

// Exports one collection to <OUT_DIR>/<name>.ejson.json, resuming from
// wherever a previous partial run left off (line count = documents already
// written), and reconnecting on any stalled/transient read.
async function exportCollectionResumable(ctx, name) {
  const outFile = path.join(OUT_DIR, `${name}.ejson.json`);
  let alreadyWritten = 0;
  if (fs.existsSync(outFile)) {
    const existing = fs.readFileSync(outFile, 'utf8');
    alreadyWritten = existing.length === 0 ? 0 : existing.split('\n').filter(Boolean).length;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await exportCollectionOnce(ctx, name, outFile, alreadyWritten);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const stalled = err?.name === 'StallTimeoutError';
      const overloaded = isOverloadError(err);
      const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
      console.log(
        `  ${name}: ${stalled ? 'stalled connection' : overloaded ? 'source overloaded' : 'transient error'} (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`
      );
      try {
        await ctx.reconnect();
      } catch (reconnectErr) {
        console.log(`  ${name}: reconnect failed (${firstLine(reconnectErr.message)}), will retry anyway`);
      }
      // Recompute how much is already on disk in case the failed attempt partially wrote lines.
      if (fs.existsSync(outFile)) {
        const existing = fs.readFileSync(outFile, 'utf8');
        alreadyWritten = existing.length === 0 ? 0 : existing.split('\n').filter(Boolean).length;
      }
      await sleep(delay);
    }
  }
}

async function exportCollectionOnce(ctx, name, outFile, alreadyWritten) {
  const collection = ctx.sourceDb.collection(name);
  const sourceCount = await collection.countDocuments();

  if (sourceCount === 0) {
    if (!fs.existsSync(outFile)) fs.writeFileSync(outFile, '');
    console.log(`  ${name}: empty collection, wrote 0 documents.`);
    return { name, sourceCount: 0, written: 0 };
  }

  if (alreadyWritten >= sourceCount) {
    console.log(`  SKIP ${name}: already fully exported (${alreadyWritten} document(s)).`);
    return { name, sourceCount, written: alreadyWritten, skipped: true };
  }

  let avgObjSize = 0;
  try {
    const stats = await ctx.sourceDb.command({ collStats: name });
    avgObjSize = stats.avgObjSize || 0;
  } catch {
    // ignore, fall back to default batch size
  }
  const batchSize = computeBatchSize(avgObjSize);
  if (batchSize < BATCH_SIZE) {
    console.log(`  ${name}: large documents (avg ~${Math.round(avgObjSize / 1024)}KB), using batch size ${batchSize}`);
  }

  if (alreadyWritten > 0) {
    console.log(`  RESUME ${name}: ${alreadyWritten} of ${sourceCount} document(s) already exported, continuing...`);
  }

  const out = fs.createWriteStream(outFile, { flags: alreadyWritten > 0 ? 'a' : 'w' });
  const cursor = collection.find({}, { batchSize }).skip(alreadyWritten);
  let written = alreadyWritten;

  try {
    while (await withStallWatchdog(cursor.hasNext(), `${name}: read`)) {
      const doc = await withStallWatchdog(cursor.next(), `${name}: read`);
      out.write(EJSON.stringify(doc) + '\n');
      written++;
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }

  console.log(`  ${name}: exported ${written}/${sourceCount} document(s) to ${path.basename(outFile)}`);
  return { name, sourceCount, written };
}

(async () => {
  console.log(`Source: ${maskUri(SOURCE_URI)}`);
  console.log(`Database: ${DATABASE_NAME}`);
  console.log(`Output directory: ${OUT_DIR}`);
  console.log('');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ctx = { sourceClient: null, sourceDb: null };
  ctx.reconnect = async () => {
    if (ctx.sourceClient) await ctx.sourceClient.close(true).catch(() => {});
    ctx.sourceClient = await createClient();
    ctx.sourceDb = ctx.sourceClient.db(DATABASE_NAME);
  };
  await ctx.reconnect();

  try {
    let collectionNames = (await ctx.sourceDb.listCollections().toArray()).map((c) => c.name);
    if (ONLY_COLLECTIONS) {
      collectionNames = collectionNames.filter((n) => ONLY_COLLECTIONS.includes(n));
    }

    if (collectionNames.length === 0) {
      console.log('No matching collections found. Nothing to do.');
      return;
    }

    console.log(`Collections to export: ${collectionNames.join(', ')}\n`);

    const indexesByCollection = {};
    const results = [];
    for (const name of collectionNames) {
      try {
        indexesByCollection[name] = await withStallWatchdog(
          ctx.sourceDb.collection(name).indexes(),
          `${name}: indexes`
        );
      } catch {
        indexesByCollection[name] = [];
      }
      results.push(await exportCollectionResumable(ctx, name));
    }

    fs.writeFileSync(
      path.join(OUT_DIR, '_indexes.json'),
      JSON.stringify(indexesByCollection, null, 2)
    );

    console.log('\nSummary:');
    let mismatches = 0;
    for (const r of results) {
      const ok = r.written === r.sourceCount;
      if (!ok) mismatches++;
      console.log(`  ${r.name}: ${r.written}/${r.sourceCount} document(s) ${ok ? 'OK' : 'MISMATCH'}`);
    }

    if (mismatches > 0) {
      console.error(`\n${mismatches} collection(s) incomplete. Re-run the same command to resume.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll collections exported successfully.');
    }
  } finally {
    if (ctx.sourceClient) await ctx.sourceClient.close();
  }
})().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
