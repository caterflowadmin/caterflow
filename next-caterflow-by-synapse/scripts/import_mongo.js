#!/usr/bin/env node
// One-off import: load every *.ejson.json file produced by export_mongo.js
// (one file per collection, one MongoDB Extended JSON document per line)
// into a target MongoDB database. Only writes to the target — reads are all
// local disk, so this isn't affected by the old cluster's slow/flaky link.
//
// Usage:
//   TARGET_MONGODB_URL="mongodb+srv://.../" \
//   DATABASE_NAME=caterflow_archive \
//   IN_DIR=/home/gee/caterflow_mongo_export \
//   node scripts/import_mongo.js [--collections=a,b,c] [--force]
//
// --force  Drop and recreate a target collection that already has documents
//          instead of resuming into it.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const ONLY_COLLECTIONS = collectionsArg
  ? collectionsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const TARGET_URI = process.env.TARGET_MONGODB_URL || process.env.TARGET_MONGODB_URI || '';
const DATABASE_NAME = process.env.DATABASE_NAME || process.env.MONGODB_DB_NAME || 'caterflow_archive';
const IN_DIR = process.env.IN_DIR || path.join(process.cwd(), 'mongo_export');

if (!TARGET_URI) {
  console.error('Set TARGET_MONGODB_URL (the connection string for the new cluster).');
  process.exit(2);
}
if (!fs.existsSync(IN_DIR)) {
  console.error(`IN_DIR does not exist: ${IN_DIR}`);
  process.exit(2);
}

const BATCH_SIZE = 100;
const TARGET_BATCH_BYTES = 3 * 1024 * 1024;
const BATCH_DELAY_MS = 250;
const OP_STALL_MS = 90000;
const MAX_ATTEMPTS = 10;
const OVERLOAD_BASE_DELAY_MS = 10000;

const mongoOptions = {
  maxPoolSize: 3,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 20000,
  socketTimeoutMS: 120000,
  retryWrites: true,
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

class StallTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} stalled: no response after ${ms}ms (connection likely dead)`);
    this.name = 'StallTimeoutError';
  }
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
  const client = new MongoClient(TARGET_URI, mongoOptions);
  await connectWithRetry(client, 'target');
  return client;
}

// Inserts a batch, tolerating duplicate-key errors: a doc already present
// (from an earlier partial pass) is treated as already-done, not a failure.
async function insertBatchTolerant(targetCollection, batch) {
  try {
    const res = await targetCollection.insertMany(batch, { ordered: false });
    return res.insertedCount;
  } catch (err) {
    const writeErrors = err.writeErrors || [];
    const allDuplicates = writeErrors.length > 0 && writeErrors.every((e) => e.code === 11000);
    if (allDuplicates) return batch.length - writeErrors.length;
    throw err;
  }
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.length === 0 ? 0 : content.split('\n').filter(Boolean).length;
}

async function readLinesFrom(filePath, skip, onDoc) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (lineNo <= skip) continue;
    if (!line) continue;
    await onDoc(EJSON.parse(line));
  }
}

async function importCollectionOnce(ctx, name, filePath, sourceCount, batchSize) {
  const targetCollection = ctx.targetDb.collection(name);
  const existingCount = await targetCollection.countDocuments();

  if (existingCount >= sourceCount && sourceCount > 0) {
    console.log(`  SKIP ${name}: target already has ${existingCount} document(s) (fully synced).`);
    return { name, sourceCount, written: existingCount, skipped: true };
  }
  if (existingCount > 0) {
    console.log(`  RESUME ${name}: target already has ${existingCount} of ${sourceCount} document(s), continuing...`);
  }

  let batch = [];
  let written = existingCount;
  await readLinesFrom(filePath, existingCount, async (doc) => {
    batch.push(doc);
    if (batch.length >= batchSize) {
      const toInsert = batch;
      batch = [];
      written += await withStallWatchdog(insertBatchTolerant(targetCollection, toInsert), `${name}: write`);
      await sleep(BATCH_DELAY_MS);
    }
  });
  if (batch.length > 0) {
    written += await withStallWatchdog(insertBatchTolerant(targetCollection, batch), `${name}: write`);
  }

  const finalCount = await targetCollection.countDocuments();
  console.log(
    `  ${name}: target now has ${finalCount}/${sourceCount} document(s)${finalCount !== sourceCount ? '  MISMATCH' : ''}`
  );
  return { name, sourceCount, written: finalCount };
}

async function importCollectionResumable(ctx, name, filePath, indexes) {
  const sourceCount = countLines(filePath);

  if (sourceCount === 0) {
    console.log(`  ${name}: source file is empty, nothing to import.`);
    return { name, sourceCount: 0, written: 0 };
  }

  const targetCollection = ctx.targetDb.collection(name);
  if (FORCE) {
    const existingCount = await targetCollection.countDocuments();
    if (existingCount > 0) {
      console.log(`  Dropping existing target collection ${name} (${existingCount} document(s))...`);
      await targetCollection.drop();
    }
  }

  if (indexes && indexes.length > 0) {
    const toCreate = indexes.filter((idx) => idx.name !== '_id_').map(({ key, name: idxName, ...options }) => ({ key, name: idxName, ...options }));
    if (toCreate.length > 0) {
      try {
        await withStallWatchdog(targetCollection.createIndexes(toCreate), `${name}: indexes`);
      } catch (err) {
        console.log(`  ${name}: index creation warning (${firstLine(err.message)})`);
      }
    }
  }

  // Rough average byte size per line, to keep write batches to a sane byte budget.
  const stat = fs.statSync(filePath);
  const avgObjSize = sourceCount > 0 ? stat.size / sourceCount : 0;
  const batchSize = computeBatchSize(avgObjSize);
  if (batchSize < BATCH_SIZE) {
    console.log(`  ${name}: large documents (avg ~${Math.round(avgObjSize / 1024)}KB), using batch size ${batchSize}`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await importCollectionOnce(ctx, name, filePath, sourceCount, batchSize);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const stalled = err?.name === 'StallTimeoutError';
      const overloaded = isOverloadError(err);
      const base = overloaded ? OVERLOAD_BASE_DELAY_MS : 2000;
      const delay = Math.min(overloaded ? 120000 : 30000, base * 2 ** (attempt - 1));
      console.log(
        `  ${name}: ${stalled ? 'stalled connection' : overloaded ? 'target overloaded' : 'transient error'} (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`
      );
      try {
        await ctx.reconnect();
      } catch (reconnectErr) {
        console.log(`  ${name}: reconnect failed (${firstLine(reconnectErr.message)}), will retry anyway`);
      }
      await sleep(delay);
    }
  }
}

(async () => {
  console.log(`Target: ${maskUri(TARGET_URI)}`);
  console.log(`Database: ${DATABASE_NAME}`);
  console.log(`Input directory: ${IN_DIR}`);
  console.log('');

  const ctx = { targetClient: null, targetDb: null };
  ctx.reconnect = async () => {
    if (ctx.targetClient) await ctx.targetClient.close(true).catch(() => {});
    ctx.targetClient = await createClient();
    ctx.targetDb = ctx.targetClient.db(DATABASE_NAME);
  };
  await ctx.reconnect();

  let indexesByCollection = {};
  const indexesFile = path.join(IN_DIR, '_indexes.json');
  if (fs.existsSync(indexesFile)) {
    indexesByCollection = JSON.parse(fs.readFileSync(indexesFile, 'utf8'));
  }

  try {
    let files = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.ejson.json'));
    let collectionNames = files.map((f) => f.replace(/\.ejson\.json$/, ''));
    if (ONLY_COLLECTIONS) {
      collectionNames = collectionNames.filter((n) => ONLY_COLLECTIONS.includes(n));
    }

    if (collectionNames.length === 0) {
      console.log('No matching *.ejson.json files found. Nothing to do.');
      return;
    }

    console.log(`Collections to import: ${collectionNames.join(', ')}\n`);

    const results = [];
    for (const name of collectionNames) {
      const filePath = path.join(IN_DIR, `${name}.ejson.json`);
      results.push(await importCollectionResumable(ctx, name, filePath, indexesByCollection[name]));
    }

    console.log('\nSummary:');
    let mismatches = 0;
    for (const r of results) {
      if (r.skipped) {
        console.log(`  ${r.name}: skipped (already synced)`);
      } else {
        const ok = r.written === r.sourceCount;
        if (!ok) mismatches++;
        console.log(`  ${r.name}: ${r.written}/${r.sourceCount} document(s) ${ok ? 'OK' : 'MISMATCH'}`);
      }
    }

    if (mismatches > 0) {
      console.error(`\n${mismatches} collection(s) have a document count mismatch. Re-run the same command to resume.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll collections imported successfully.');
    }
  } finally {
    if (ctx.targetClient) await ctx.targetClient.close();
  }
})().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
