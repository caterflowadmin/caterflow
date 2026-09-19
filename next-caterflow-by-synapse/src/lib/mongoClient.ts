// src/lib/mongoClient.ts
// MongoDB connection singleton for the archive system

import { MongoClient, Db, MongoClientOptions } from 'mongodb';

const uri = process.env.MONGODB_URL || process.env.MONGODB_URI || '';
const dbName = process.env.DATABASE_NAME || process.env.MONGODB_DB_NAME || 'caterflow_archive';

// Serverless-tuned connection options. Left entirely at driver defaults
// before, which is a poor fit for Vercel: every cold-started function
// instance opens its own pool, and the driver's default
// serverSelectionTimeoutMS (30000ms) means a struggling/overloaded cluster
// makes EVERY request — not just archive ones — hang for a full 30s before
// failing (this matches "MongoServerSelectionError: Server selection timed
// out after 30000 ms" and "connection <monitor> ... closed [SystemOverloadedError]"
// seen in production logs on both /api/archive/run and ordinary routes like
// /api/bins). Lowering maxPoolSize keeps each serverless instance from
// opening more sockets than it needs (Atlas connection limits are shared
// across every concurrent instance), and lowering the various timeouts
// makes failures fail fast instead of eating a function's whole execution
// budget waiting on a hung connection.
//
// NOTE: this does not fix an IP-allowlist or cluster-tier/region problem —
// if Atlas's Network Access list doesn't include Vercel's IPs, or the
// cluster is undersized/in a different region than the function, these
// timeouts will still eventually trigger, just faster and more gracefully.
// connectTimeoutMS/socketTimeoutMS were lowered from 8000/20000 — production
// logs showed MongoNetworkTimeoutError stalls, and at the old socketTimeoutMS
// a single stuck operation inside an unbudgeted per-document loop (see
// archiveService.ts's insertIfNotExists/cleanupCollectionBatched fallback
// paths) could eat up to 20s before failing, which is enough for a handful
// of stalls in one batch to blow through Vercel's 300s hard timeout with no
// checkpoint saved. Lower values fail fast enough for the surrounding
// time-budget checks and retry logic to actually get a turn, at the cost of
// misclassifying a genuinely slow-but-successful op as a failure sooner —
// don't lower further without confirming the actual cluster tier/health.
const mongoOptions: MongoClientOptions = {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 12000,
    retryWrites: true,
    retryReads: true,
};

// Global singleton to reuse across serverless function invocations
let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

declare global {
    // Prevent TypeScript from complaining about the global
    var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (uri) {
    if (process.env.NODE_ENV === 'development') {
        if (!global._mongoClientPromise) {
            client = new MongoClient(uri, mongoOptions);
            global._mongoClientPromise = client.connect();
        }
        clientPromise = global._mongoClientPromise!;
    } else {
        client = new MongoClient(uri, mongoOptions);
        clientPromise = client.connect();
    }
}

export default clientPromise;

/**
 * Get the archive database instance
 */
export async function getArchiveDb(): Promise<Db> {
    if (!uri || !clientPromise) {
        throw new Error('Please define the MONGODB_URI environment variable');
    }
    const mongoClient = await clientPromise;
    return mongoClient.db(dbName);
}

/**
 * Collection name constants
 */
export const COLLECTIONS = {
    DISPATCH_LOGS: 'archived_dispatch_logs',
    PURCHASE_ORDERS: 'archived_purchase_orders',
    GOODS_RECEIPTS: 'archived_goods_receipts',
    INTERNAL_TRANSFERS: 'archived_internal_transfers',
    STOCK_ADJUSTMENTS: 'archived_stock_adjustments',
    INVENTORY_COUNTS: 'archived_inventory_counts',
    FILE_ATTACHMENTS: 'archived_file_attachments',
    STOCK_SNAPSHOTS: 'archived_stock_snapshots',
    ARCHIVE_RUNS: 'archive_runs',
    SEQUENCE_COUNTERS: 'sequence_counters',
    STOCK_BASELINES: 'stock_baselines',
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];
