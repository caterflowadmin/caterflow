#!/usr/bin/env node
// One-off migration: copy every collection (data + indexes) from a source
// MongoDB database to a target one. Used to move the archive database to a
// new Atlas cluster without losing history.
//
// Usage:
//   SOURCE_MONGODB_URL="mongodb+srv://.../" \
//   TARGET_MONGODB_URL="mongodb+srv://.../" \
//   DATABASE_NAME=caterflow_archive \
//   node scripts/migrate_mongo.js [--dry-run] [--force] [--collections=a,b,c]
//
// --dry-run     Only prints what would happen (source/target counts), no writes.
// --force       Overwrite target collections that already contain documents
//               (they are dropped and recreated before copying). Without
//               this flag, any target collection that already has documents
//               is left untouched and reported as skipped.
// --collections Comma-separated allowlist of collection names to migrate.
//               Defaults to every collection found in the source database.

const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const ONLY_COLLECTIONS = collectionsArg
  ? collectionsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const SOURCE_URI = process.env.SOURCE_MONGODB_URL || process.env.SOURCE_MONGODB_URI || '';
const TARGET_URI = process.env.TARGET_MONGODB_URL || process.env.TARGET_MONGODB_URI || '';
const DATABASE_NAME =
  process.env.DATABASE_NAME || process.env.MONGODB_DB_NAME || 'caterflow_archive';

// Target is a free-tier (M0) shared cluster: keep batches small, throttle
// between writes, and use a tiny connection pool so we don't trip Atlas's
// "SystemOverloadedError" connection-shedding under a bulk-write burst.
//
// M0-to-M0 throughput between these clusters has been observed as low as
// ~80KB/s (region/tier throttling, not a local network problem — confirmed
// separately against a CDN at ~950KB/s). A flat 100-document batch size is
// fine for small documents but disastrous for collections with large
// documents (e.g. stock_baselines averages ~2.4MB/doc): a 100-doc getMore
// there would need to move ~240MB, which blows both the 30s socket timeout
// and MongoDB's ~48MB max message size. So batch size is computed per
// collection from its average document size to target a roughly constant
// number of bytes per round trip instead of a constant document count.
const BATCH_SIZE = 100;
const TARGET_BATCH_BYTES = 3 * 1024 * 1024; // ~3MB per read/write round trip
const BATCH_DELAY_MS = 250;
const MAX_COLLECTION_ATTEMPTS = 10;
const OVERLOAD_BASE_DELAY_MS = 10000;
// Observed failure mode on this link: a large-document read/write
// occasionally goes fully silent — the TCP socket stays ESTABLISHED with 0%
// CPU and no data flowing, and neither socketTimeoutMS nor any driver error
// ever fires (consistent with a path MTU black hole silently dropping large
// TLS records rather than a clean reset). A per-operation watchdog is the
// only thing that can catch this: if a single read or write batch doesn't
// settle within OP_STALL_MS, treat it as dead and force a full reconnect.
const OP_STALL_MS = 90000;

const mongoOptions = {
  maxPoolSize: 3,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 20000,
  // At the slow end of observed throughput (~80KB/s), a single
  // TARGET_BATCH_BYTES (~3MB) round trip can take ~40s. 120s leaves
  // generous headroom without masking a truly dead connection.
  socketTimeoutMS: 120000,
  retryWrites: true,
  retryReads: true,
};

// Picks a batch size (document count) that keeps each read/write round trip
// to roughly TARGET_BATCH_BYTES, so slow links don't time out on
// large-document collections and message-size limits aren't hit.
function computeBatchSize(avgObjSize) {
  if (!avgObjSize || avgObjSize <= 0) return BATCH_SIZE;
  return Math.max(1, Math.min(BATCH_SIZE, Math.floor(TARGET_BATCH_BYTES / avgObjSize)));
}

if (!SOURCE_URI || !TARGET_URI) {
  console.error(
    'Set SOURCE_MONGODB_URL and TARGET_MONGODB_URL (the connection strings for the old and new clusters).'
  );
  process.exit(2);
}

function maskUri(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

function firstLine(message) {
  return String(message || '').split('\n')[0];
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

// Races a driver operation against a watchdog timer. If the watchdog fires
// first, the original promise is abandoned (its eventual settlement is
// swallowed so it can't crash the process with an unhandled rejection once
// the caller has force-closed the connection it was waiting on).
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

function isTransientNetworkError(err) {
  const msg = String((err && err.message) || '');
  const labels = err?.errorLabelSet || err?.cause?.errorLabelSet;
  return (
    err?.name === 'StallTimeoutError' ||
    err?.name === 'MongoNetworkError' ||
    err?.name === 'MongoNetworkTimeoutError' ||
    err?.name === 'MongoServerSelectionError' ||
    // The driver itself flags a write as safe to retry via errorLabelSet —
    // more reliable than matching on error class name/message, which is
    // what MongoNetworkTimeoutError slipped through before (its name and
    // message don't match ETIMEDOUT/MongoNetworkError text, even though the
    // driver already knows it's retryable).
    (labels && typeof labels.has === 'function' && labels.has('RetryableWriteError')) ||
    isOverloadError(err) ||
    /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|socket hang up|connection.*closed|topology.*closed|SSL routines|tlsv1 alert|timed out/i.test(
      msg
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Inserts a batch, tolerating duplicate-key errors (code 11000): those mean
// the document was already written by an earlier attempt that got cut off
// by a transient network error, so it's safe to treat as already-done.
async function insertBatchTolerant(targetCollection, batch) {
  try {
    const res = await targetCollection.insertMany(batch, { ordered: false });
    return res.insertedCount;
  } catch (err) {
    const writeErrors = err.writeErrors || [];
    const allDuplicates = writeErrors.length > 0 && writeErrors.every((e) => e.code === 11000);
    if (allDuplicates) {
      return batch.length - writeErrors.length;
    }
    throw err;
  }
}

async function copyIndexes(sourceCollection, targetCollection) {
  const indexes = await sourceCollection.indexes();
  const toCreate = indexes.filter((idx) => idx.name !== '_id_');
  if (toCreate.length === 0) return 0;
  const specs = toCreate.map(({ key, name, ...options }) => ({ key, name, ...options }));
  await targetCollection.createIndexes(specs);
  return specs.length;
}

async function copyCollectionOnce(sourceDb, targetDb, name) {
  const sourceCollection = sourceDb.collection(name);
  const targetCollection = targetDb.collection(name);

  const sourceCount = await sourceCollection.countDocuments();
  const existingTargetCount = await targetCollection.countDocuments();

  if (existingTargetCount >= sourceCount && sourceCount > 0 && !FORCE) {
    console.log(`  SKIP ${name}: target already has ${existingTargetCount} document(s) (fully synced).`);
    return { name, sourceCount, copied: 0, targetCount: existingTargetCount, skipped: true };
  }

  if (DRY_RUN) {
    console.log(
      `  DRY-RUN ${name}: would copy ${sourceCount - Math.min(existingTargetCount, sourceCount)} more document(s) (target currently has ${existingTargetCount} of ${sourceCount})`
    );
    return { name, sourceCount, copied: 0, dryRun: true };
  }

  let avgObjSize = 0;
  try {
    const stats = await sourceDb.command({ collStats: name });
    avgObjSize = stats.avgObjSize || 0;
  } catch {
    // collStats can fail on an empty/missing collection; fall back to the default batch size.
  }
  const batchSize = computeBatchSize(avgObjSize);
  if (batchSize < BATCH_SIZE) {
    console.log(`  ${name}: large documents (avg ~${Math.round(avgObjSize / 1024)}KB), using batch size ${batchSize}`);
  }

  if (FORCE && existingTargetCount > 0) {
    console.log(`  Dropping existing target collection ${name} (${existingTargetCount} document(s))...`);
    await targetCollection.drop();
  } else if (existingTargetCount > 0) {
    console.log(`  RESUME ${name}: target already has ${existingTargetCount} of ${sourceCount} document(s), filling the gap...`);
  }

  const indexCount = await copyIndexes(sourceCollection, targetCollection);

  let copied = 0;
  const cursor = sourceCollection.find({}, { batchSize });
  let batch = [];
  while (await withStallWatchdog(cursor.hasNext(), `${name}: read`)) {
    batch.push(await withStallWatchdog(cursor.next(), `${name}: read`));
    if (batch.length >= batchSize) {
      copied += await withStallWatchdog(insertBatchTolerant(targetCollection, batch), `${name}: write`);
      batch = [];
      await sleep(BATCH_DELAY_MS);
    }
  }
  if (batch.length > 0) {
    copied += await withStallWatchdog(insertBatchTolerant(targetCollection, batch), `${name}: write`);
  }

  const targetCount = await targetCollection.countDocuments();
  console.log(
    `  ${name}: inserted ${copied} document(s) this pass, ${indexCount} index(es). source=${sourceCount} target=${targetCount}${
      targetCount !== sourceCount ? '  MISMATCH' : ''
    }`
  );
  return { name, sourceCount, copied, targetCount };
}

async function copyCollection(ctx, name) {
  for (let attempt = 1; attempt <= MAX_COLLECTION_ATTEMPTS; attempt++) {
    try {
      return await copyCollectionOnce(ctx.sourceDb, ctx.targetDb, name);
    } catch (err) {
      if (attempt >= MAX_COLLECTION_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const overloaded = isOverloadError(err);
      const stalled = err?.name === 'StallTimeoutError';
      const base = overloaded ? OVERLOAD_BASE_DELAY_MS : 2000;
      const delay = Math.min(overloaded ? 120000 : 30000, base * 2 ** (attempt - 1));
      console.log(
        `  ${name}: ${stalled ? 'stalled connection' : overloaded ? 'target overloaded' : 'transient error'} (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_COLLECTION_ATTEMPTS})...`
      );
      // A stalled socket can sit ESTABLISHED-but-dead indefinitely, so retrying
      // on the same connection pool would just hang again. Force a clean
      // reconnect on any transient error so every retry starts with fresh
      // sockets. Reconnecting itself can fail (also transient); let that
      // surface as this attempt's failure rather than crashing the run.
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
  console.log(`Source: ${maskUri(SOURCE_URI)}`);
  console.log(`Target: ${maskUri(TARGET_URI)}`);
  console.log(`Database: ${DATABASE_NAME}`);
  if (DRY_RUN) console.log('Mode: DRY RUN (no writes)');
  console.log('');

  const sourceClient = new MongoClient(SOURCE_URI, mongoOptions);
  const targetClient = new MongoClient(TARGET_URI, mongoOptions);

  async function connectWithRetry(client, label) {
    for (let attempt = 1; attempt <= MAX_COLLECTION_ATTEMPTS; attempt++) {
      try {
        await client.connect();
        return;
      } catch (err) {
        if (attempt >= MAX_COLLECTION_ATTEMPTS || !isTransientNetworkError(err)) throw err;
        const overloaded = isOverloadError(err);
        const base = overloaded ? OVERLOAD_BASE_DELAY_MS : 2000;
        const delay = Math.min(overloaded ? 120000 : 30000, base * 2 ** (attempt - 1));
        console.log(`Connecting to ${label} failed (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      }
    }
  }

  await connectWithRetry(sourceClient, 'source');
  await connectWithRetry(targetClient, 'target');

  try {
    const sourceDb = sourceClient.db(DATABASE_NAME);
    const targetDb = targetClient.db(DATABASE_NAME);

    let collectionNames = (await sourceDb.listCollections().toArray()).map((c) => c.name);
    if (ONLY_COLLECTIONS) {
      collectionNames = collectionNames.filter((n) => ONLY_COLLECTIONS.includes(n));
    }

    if (collectionNames.length === 0) {
      console.log('No matching collections found in source database. Nothing to do.');
      return;
    }

    console.log(`Collections to migrate: ${collectionNames.join(', ')}\n`);

    const results = [];
    for (const name of collectionNames) {
      results.push(await copyCollection(sourceDb, targetDb, name));
    }

    console.log('\nSummary:');
    let mismatches = 0;
    for (const r of results) {
      if (r.skipped) {
        console.log(`  ${r.name}: skipped (target not empty)`);
      } else if (r.dryRun) {
        console.log(`  ${r.name}: dry-run, source has ${r.sourceCount}`);
      } else {
        const ok = r.targetCount === r.sourceCount;
        if (!ok) mismatches++;
        console.log(`  ${r.name}: ${r.copied} copied (source=${r.sourceCount}, target=${r.targetCount}) ${ok ? 'OK' : 'MISMATCH'}`);
      }
    }

    if (mismatches > 0) {
      console.error(`\n${mismatches} collection(s) have a document count mismatch. Investigate before cutting over.`);
      process.exitCode = 1;
    } else if (!DRY_RUN) {
      console.log('\nAll collections migrated successfully.');
    }
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
})().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
