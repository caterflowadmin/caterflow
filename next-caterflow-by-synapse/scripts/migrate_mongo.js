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
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 250;
const MAX_COLLECTION_ATTEMPTS = 10;
const OVERLOAD_BASE_DELAY_MS = 10000;

const mongoOptions = {
  maxPoolSize: 3,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 30000,
  retryWrites: true,
  retryReads: true,
};

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

function isTransientNetworkError(err) {
  const msg = String((err && err.message) || '');
  return (
    err?.name === 'MongoNetworkError' ||
    err?.name === 'MongoServerSelectionError' ||
    isOverloadError(err) ||
    /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|MongoNetworkError|MongoServerSelectionError|socket hang up|connection.*closed|topology.*closed|SSL routines|tlsv1 alert/i.test(
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

  if (FORCE && existingTargetCount > 0) {
    console.log(`  Dropping existing target collection ${name} (${existingTargetCount} document(s))...`);
    await targetCollection.drop();
  } else if (existingTargetCount > 0) {
    console.log(`  RESUME ${name}: target already has ${existingTargetCount} of ${sourceCount} document(s), filling the gap...`);
  }

  const indexCount = await copyIndexes(sourceCollection, targetCollection);

  let copied = 0;
  const cursor = sourceCollection.find({}, { batchSize: BATCH_SIZE });
  let batch = [];
  while (await cursor.hasNext()) {
    batch.push(await cursor.next());
    if (batch.length >= BATCH_SIZE) {
      copied += await insertBatchTolerant(targetCollection, batch);
      batch = [];
      await sleep(BATCH_DELAY_MS);
    }
  }
  if (batch.length > 0) {
    copied += await insertBatchTolerant(targetCollection, batch);
  }

  const targetCount = await targetCollection.countDocuments();
  console.log(
    `  ${name}: inserted ${copied} document(s) this pass, ${indexCount} index(es). source=${sourceCount} target=${targetCount}${
      targetCount !== sourceCount ? '  MISMATCH' : ''
    }`
  );
  return { name, sourceCount, copied, targetCount };
}

async function copyCollection(sourceDb, targetDb, name) {
  for (let attempt = 1; attempt <= MAX_COLLECTION_ATTEMPTS; attempt++) {
    try {
      return await copyCollectionOnce(sourceDb, targetDb, name);
    } catch (err) {
      if (attempt >= MAX_COLLECTION_ATTEMPTS || !isTransientNetworkError(err)) throw err;
      const overloaded = isOverloadError(err);
      const base = overloaded ? OVERLOAD_BASE_DELAY_MS : 2000;
      const delay = Math.min(overloaded ? 120000 : 30000, base * 2 ** (attempt - 1));
      console.log(
        `  ${name}: ${overloaded ? 'target overloaded' : 'transient error'} (${firstLine(err.message)}), retrying in ${Math.round(delay / 1000)}s (attempt ${attempt}/${MAX_COLLECTION_ATTEMPTS})...`
      );
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
