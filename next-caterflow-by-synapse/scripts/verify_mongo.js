#!/usr/bin/env node
// Verifies that a target MongoDB database matches a source: either a live
// source database, or (with IN_DIR set) the local *.ejson.json files
// produced by export_mongo.js. Local-file mode is preferable when the
// source cluster is slow/flaky, since export_mongo.js already verified
// (per-collection count match) that those files faithfully captured the
// source at export time — comparing against them avoids re-reading a large,
// slow collection from the network on every verification attempt.
//
// Checks per collection:
// - same document count
// - same set of _id values
// - a content hash (canonical EJSON of the whole doc, _id excluded from the
//   hash since it's already checked) for every doc, compared by _id so a
//   mismatch names the exact document instead of just "counts differ".
//
// Usage (live source):
//   SOURCE_MONGODB_URL="mongodb+srv://.../" \
//   TARGET_MONGODB_URL="mongodb+srv://.../" \
//   DATABASE_NAME=caterflow_archive \
//   node scripts/verify_mongo.js [--collections=a,b,c]
//
// Usage (local export files as source):
//   IN_DIR=/home/gee/caterflow_mongo_export \
//   TARGET_MONGODB_URL="mongodb+srv://.../" \
//   DATABASE_NAME=caterflow_archive \
//   node scripts/verify_mongo.js [--collections=a,b,c]

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const args = process.argv.slice(2);
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const ONLY_COLLECTIONS = collectionsArg
  ? collectionsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const SOURCE_URI = process.env.SOURCE_MONGODB_URL || process.env.SOURCE_MONGODB_URI || '';
const TARGET_URI = process.env.TARGET_MONGODB_URL || process.env.TARGET_MONGODB_URI || '';
const DATABASE_NAME = process.env.DATABASE_NAME || process.env.MONGODB_DB_NAME || 'caterflow_archive';
const IN_DIR = process.env.IN_DIR || '';

if (!IN_DIR && !SOURCE_URI) {
  console.error('Set either SOURCE_MONGODB_URL (live source) or IN_DIR (local export files).');
  process.exit(2);
}
if (!TARGET_URI) {
  console.error('Set TARGET_MONGODB_URL.');
  process.exit(2);
}

const mongoOptions = {
  maxPoolSize: 3,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 20000,
  socketTimeoutMS: 120000,
  retryReads: true,
};

// Same lessons as migrate/export/import: this link occasionally goes fully
// silent on a large read (ESTABLISHED socket, 0% CPU, no driver error ever
// fires), and a flat cursor batch size can also just be too big for
// large-document collections (e.g. stock_baselines averages ~2.4MB/doc).
const BATCH_SIZE = 100;
const TARGET_BATCH_BYTES = 3 * 1024 * 1024;
const OP_STALL_MS = 90000;
const MAX_ATTEMPTS = 6;

function computeBatchSize(avgObjSize) {
  if (!avgObjSize || avgObjSize <= 0) return BATCH_SIZE;
  return Math.max(1, Math.min(BATCH_SIZE, Math.floor(TARGET_BATCH_BYTES / avgObjSize)));
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

function firstLine(message) {
  return String(message || '').split('\n')[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|socket hang up|connection.*closed|topology.*closed|SSL routines|tlsv1 alert|timed out|SystemOverloadedError/i.test(
      msg
    )
  );
}

function maskUri(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

function hashDoc(doc) {
  const { _id, ...rest } = doc;
  return crypto.createHash('sha256').update(EJSON.stringify(rest, { relaxed: false })).digest('hex');
}

function idKey(id) {
  return EJSON.stringify(id, { relaxed: false });
}

async function loadIdHashMapFromFile(name) {
  const filePath = path.join(IN_DIR, `${name}.ejson.json`);
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const doc = EJSON.parse(line);
    map.set(idKey(doc._id), hashDoc(doc));
  }
  return map;
}

async function loadIdHashMapOnce(db, name, label) {
  const collection = db.collection(name);
  let avgObjSize = 0;
  try {
    const stats = await db.command({ collStats: name });
    avgObjSize = stats.avgObjSize || 0;
  } catch {
    // ignore, fall back to default batch size
  }
  const batchSize = computeBatchSize(avgObjSize);
  const map = new Map();
  const cursor = collection.find({}, { batchSize });
  while (await withStallWatchdog(cursor.hasNext(), `${label} ${name}: read`)) {
    const doc = await withStallWatchdog(cursor.next(), `${label} ${name}: read`);
    map.set(idKey(doc._id), hashDoc(doc));
  }
  return map;
}

// Retries a full collection scan on transient/stall errors, reconnecting the
// client each time so a dead socket doesn't get reused.
async function loadIdHashMap(ctx, side, name) {
  if (side === 'source' && IN_DIR) {
    return loadIdHashMapFromFile(name);
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const db = side === 'source' ? ctx.sourceDb : ctx.targetDb;
      return await loadIdHashMapOnce(db, name, side);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
      console.log(
        `  ${name} (${side}): transient error (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`
      );
      await ctx.reconnect(side);
      await sleep(delay);
    }
  }
}

function countFileLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf8');
  return content.length === 0 ? 0 : content.split('\n').filter(Boolean).length;
}

async function verifyCollection(ctx, name) {
  const targetCollection = ctx.targetDb.collection(name);

  const sourceCount = IN_DIR
    ? countFileLines(path.join(IN_DIR, `${name}.ejson.json`))
    : await ctx.sourceDb.collection(name).countDocuments();
  const targetCount = await targetCollection.countDocuments();

  console.log(`  ${name}: source=${sourceCount} target=${targetCount}`);

  if (sourceCount === 0 && targetCount === 0) {
    return { name, sourceCount, targetCount, ok: true, missing: [], extra: [], mismatched: [] };
  }

  const sourceMap = await loadIdHashMap(ctx, 'source', name);
  const targetMap = await loadIdHashMap(ctx, 'target', name);

  const missing = []; // in source, not in target
  const mismatched = []; // in both, different content
  for (const [id, hash] of sourceMap) {
    if (!targetMap.has(id)) {
      missing.push(id);
    } else if (targetMap.get(id) !== hash) {
      mismatched.push(id);
    }
  }
  const extra = []; // in target, not in source
  for (const id of targetMap.keys()) {
    if (!sourceMap.has(id)) extra.push(id);
  }

  const ok = missing.length === 0 && extra.length === 0 && mismatched.length === 0;
  if (!ok) {
    console.log(
      `    MISMATCH: ${missing.length} missing, ${extra.length} extra, ${mismatched.length} content-differ`
    );
    if (missing.length) console.log(`    missing _ids (first 5): ${missing.slice(0, 5).join(', ')}`);
    if (extra.length) console.log(`    extra _ids (first 5): ${extra.slice(0, 5).join(', ')}`);
    if (mismatched.length) console.log(`    mismatched _ids (first 5): ${mismatched.slice(0, 5).join(', ')}`);
  } else {
    console.log(`    OK: all ${sourceCount} document(s) match exactly.`);
  }

  return { name, sourceCount, targetCount, ok, missing, extra, mismatched };
}

(async () => {
  console.log(`Source: ${IN_DIR ? `local files at ${IN_DIR}` : maskUri(SOURCE_URI)}`);
  console.log(`Target: ${maskUri(TARGET_URI)}`);
  console.log(`Database: ${DATABASE_NAME}`);
  console.log('');

  const ctx = { sourceClient: null, targetClient: null, sourceDb: null, targetDb: null };
  ctx.reconnect = async (side) => {
    if (!IN_DIR && (side === 'source' || side === 'both')) {
      if (ctx.sourceClient) await ctx.sourceClient.close(true).catch(() => {});
      ctx.sourceClient = new MongoClient(SOURCE_URI, mongoOptions);
      await ctx.sourceClient.connect();
      ctx.sourceDb = ctx.sourceClient.db(DATABASE_NAME);
    }
    if (side === 'target' || side === 'both') {
      if (ctx.targetClient) await ctx.targetClient.close(true).catch(() => {});
      ctx.targetClient = new MongoClient(TARGET_URI, mongoOptions);
      await ctx.targetClient.connect();
      ctx.targetDb = ctx.targetClient.db(DATABASE_NAME);
    }
  };
  await ctx.reconnect('both');

  try {
    let collectionNames = IN_DIR
      ? fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.ejson.json')).map((f) => f.replace(/\.ejson\.json$/, ''))
      : (await ctx.sourceDb.listCollections().toArray()).map((c) => c.name);
    if (ONLY_COLLECTIONS) {
      collectionNames = collectionNames.filter((n) => ONLY_COLLECTIONS.includes(n));
    }

    console.log(`Verifying: ${collectionNames.join(', ')}\n`);

    const results = [];
    for (const name of collectionNames) {
      results.push(await verifyCollection(ctx, name));
    }

    console.log('\nSummary:');
    let failures = 0;
    for (const r of results) {
      if (!r.ok) failures++;
      console.log(`  ${r.name}: ${r.ok ? 'MATCH' : 'MISMATCH'} (source=${r.sourceCount}, target=${r.targetCount})`);
    }

    if (failures > 0) {
      console.error(`\n${failures} collection(s) do not match. See details above.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll collections verified identical between source and target.');
    }
  } finally {
    if (ctx.sourceClient) await ctx.sourceClient.close();
    if (ctx.targetClient) await ctx.targetClient.close();
  }
})().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
