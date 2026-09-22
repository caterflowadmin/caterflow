// Unit tests for the pure/mockable parts of the archive engine —
// stableSerialize/normalizeForComparison and insertIfNotExists. These run
// against a mocked Mongo `Db` and mocked Sanity client; no live connection
// is ever made (see the jest.mock calls below), so this is safe to run
// against any environment, including one whose .env points at production.

jest.mock("@/lib/sanity", () => ({
  client: { fetch: jest.fn() },
  writeClient: { delete: jest.fn(), transaction: jest.fn() },
}));

// next-sanity ships ESM-only, which Jest can't parse under the default
// transformIgnorePatterns — archiveService.ts only uses `groq` as a
// template-tag for building query strings, which none of the functions
// under test here actually execute, so a trivial stand-in is enough.
jest.mock("next-sanity", () => ({
  groq: (strings: TemplateStringsArray, ...values: any[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), ""),
}));

// The mongodb driver's bson dependency ships an ESM .mjs build that Jest's
// default transform can't parse either. archiveService.ts only uses
// `ObjectId` as a value import (Db is type-only). This stand-in replicates
// the one behavior that actually matters for cleanupCollectionBatched's
// cursor handling: the real ObjectId throws on anything that isn't a
// 24-character hex string — which is exactly what a Sanity document id
// (UUID or short-id format) is not.
jest.mock("mongodb", () => ({
  ObjectId: function ObjectId(id?: any) {
    if (id !== undefined && !/^[0-9a-fA-F]{24}$/.test(String(id))) {
      throw new Error(
        "input must be a 24 character hex string, 12 byte Uint8Array, or an integer",
      );
    }
    return { toString: () => String(id ?? "") };
  },
}));

jest.mock("@/lib/mongoClient", () => ({
  getArchiveDb: jest.fn(),
  COLLECTIONS: {
    DISPATCH_LOGS: "archived_dispatch_logs",
    PURCHASE_ORDERS: "archived_purchase_orders",
    GOODS_RECEIPTS: "archived_goods_receipts",
    INTERNAL_TRANSFERS: "archived_internal_transfers",
    STOCK_ADJUSTMENTS: "archived_stock_adjustments",
    INVENTORY_COUNTS: "archived_inventory_counts",
    FILE_ATTACHMENTS: "archived_file_attachments",
    STOCK_SNAPSHOTS: "archived_stock_snapshots",
    ARCHIVE_RUNS: "archive_runs",
    SEQUENCE_COUNTERS: "sequence_counters",
    STOCK_BASELINES: "stock_baselines",
  },
}));

import {
  normalizeForComparison,
  stableSerialize,
  insertIfNotExists,
  cleanupCollectionBatched,
  cleanupArchivedSanityData,
  captureStockBaseline,
  computeStockBaselineDiff,
  reconstructStockBaselineChain,
  cleanupOldArchiveMetadata,
  ensureIndexes,
} from "@/lib/archiveService";
import { writeClient, client as sanityClient } from "@/lib/sanity";
import { getArchiveDb } from "@/lib/mongoClient";

describe("normalizeForComparison / stableSerialize", () => {
  it("produces identical output regardless of top-level key order", () => {
    const a = { foo: 1, bar: { z: 1, a: 2 } };
    const b = { bar: { a: 2, z: 1 }, foo: 1 };
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });

  it("distinguishes objects with different values", () => {
    expect(stableSerialize({ foo: 1 })).not.toBe(stableSerialize({ foo: 2 }));
  });

  it("sorts keys inside objects nested in arrays too", () => {
    const a = [{ b: 1, a: 2 }];
    const b = [{ a: 2, b: 1 }];
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });

  it("passes through primitives, null and undefined", () => {
    expect(normalizeForComparison(null)).toBeNull();
    expect(normalizeForComparison(undefined)).toBeUndefined();
    expect(normalizeForComparison(5)).toBe(5);
    expect(normalizeForComparison("x")).toBe("x");
  });
});

function createMockDb(existingDocs: any[] = []) {
  const bulkWrite = jest.fn().mockResolvedValue({ ok: 1 });
  const find = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(existingDocs),
  });
  const collection = jest.fn().mockReturnValue({ find, bulkWrite });
  return { db: { collection } as any, bulkWrite, find };
}

describe("insertIfNotExists", () => {
  it("inserts brand-new documents", async () => {
    const { db, bulkWrite } = createMockDb([]);
    const errors: string[] = [];

    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [{ _id: "doc-1", dispatchNumber: "D-1" }],
      errors,
    );

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      skipped: 0,
      lastProcessedSanityId: "doc-1",
      completedAll: true,
    });
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops[0].insertOne.document._sanityId).toBe("doc-1");
    expect(errors).toEqual([]);
  });

  it("skips documents that are unchanged, even if key order differs", async () => {
    const existing = {
      _id: "mongo-1",
      _sanityId: "doc-1",
      dispatchNumber: "D-1",
      status: "completed",
      _isArchived: true,
    };
    const { db, bulkWrite } = createMockDb([existing]);

    // Same content as `existing`, just different key order.
    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [{ status: "completed", _id: "doc-1", dispatchNumber: "D-1" }],
      [],
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      skipped: 1,
      lastProcessedSanityId: "doc-1",
      completedAll: true,
    });
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("updates documents whose content actually changed", async () => {
    const existing = {
      _id: "mongo-1",
      _sanityId: "doc-1",
      dispatchNumber: "D-1",
      status: "draft",
      _isArchived: true,
    };
    const { db, bulkWrite } = createMockDb([existing]);

    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [{ _id: "doc-1", dispatchNumber: "D-1", status: "completed" }],
      [],
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 1,
      skipped: 0,
      lastProcessedSanityId: "doc-1",
      completedAll: true,
    });
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops[0].replaceOne.filter).toEqual({ _sanityId: "doc-1" });
    expect(ops[0].replaceOne.replacement.status).toBe("completed");
  });

  it("skips documents with no resolvable Sanity id, without touching the db", async () => {
    const { db, bulkWrite, find } = createMockDb([]);

    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [{ dispatchNumber: "no-id-here" }],
      [],
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      skipped: 1,
      lastProcessedSanityId: null,
      completedAll: true,
    });
    expect(find).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("returns immediately for an empty docs array without touching the db", async () => {
    const { db, bulkWrite, find } = createMockDb([]);

    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [],
      [],
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      skipped: 0,
      lastProcessedSanityId: null,
      completedAll: true,
    });
    expect(find).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  // Regression test for the production incident this fix addresses: a
  // batch whose bulk write fails (e.g. a duplicate-key collision) falls
  // back to per-document writes, and under a slow/flaky MongoDB connection
  // that per-document loop could previously run with no time-budget check
  // at all — silently consuming the whole run's remaining time and running
  // straight into Vercel's hard function timeout with zero checkpoint
  // saved. This pins down that the loop now stops as soon as
  // checkTimeBudget() says to, and reports exactly how far it actually got
  // (not the whole batch) so a resume can pick up correctly.
  it("stops the per-document fallback loop mid-batch once the time budget is exhausted, without claiming later documents were processed", async () => {
    const bulkWrite = jest.fn().mockRejectedValue(new Error("duplicate key"));
    const find = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn().mockReturnValue({ find, bulkWrite, findOne, insertOne });
    const db = { collection } as any;
    const errors: string[] = [];

    // Tied to whether the first document has actually finished inserting
    // (rather than a raw call count, which would be fragile against exactly
    // how many times checkTimeBudget happens to be consulted per document —
    // it's now checked both at the top of each loop iteration and inside
    // each retry-wrapped db operation). Budget is "exhausted" only once
    // insertOne has resolved once, so the first document is guaranteed to
    // complete and only the second document's iteration should ever see it
    // return true.
    const checkTimeBudget = () => insertOne.mock.calls.length > 0;

    const result = await insertIfNotExists(
      db,
      "archived_dispatch_logs",
      [
        { _id: "doc-1", dispatchNumber: "D-1" },
        { _id: "doc-2", dispatchNumber: "D-2" },
        { _id: "doc-3", dispatchNumber: "D-3" },
      ],
      errors,
      undefined,
      checkTimeBudget,
    );

    expect(result.completedAll).toBe(false);
    expect(result.lastProcessedSanityId).toBe("doc-1");
    expect(result.inserted).toBe(1);
    // Only the first document should ever have reached the db.
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0][0]._sanityId).toBe("doc-1");
  });
});

// cleanupCollectionBatched is what the admin page's "Delete Old Archived
// Sanity Data" button ultimately drives (via cleanupArchivedSanityData).
// These tests exist to pin down the one property that actually matters for
// safety: a Sanity document is only ever a delete candidate because of the
// MongoDB-side query filter, never because of anything the button itself
// decided — the button no longer runs an archive pass first (see
// confirmDeleteOld in the admin page), so this filter is the only thing
// standing between "old" and "actually archived, finished, and old".
function createCleanupMockDb() {
  const toArray = jest.fn().mockResolvedValue([]);
  const project = jest.fn().mockReturnValue({ toArray });
  const limit = jest.fn().mockReturnValue({ project });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  const updateOne = jest.fn().mockResolvedValue({});
  const collection = jest.fn().mockReturnValue({ find, updateOne });
  return { db: { collection } as any, find, toArray, updateOne };
}

describe("cleanupCollectionBatched", () => {
  beforeEach(() => {
    (writeClient.delete as jest.Mock).mockClear();
    (writeClient.transaction as jest.Mock).mockClear();
  });

  it("queries only Mongo copies that are archived, past cutoff (by the collection's own business date), and not already deleted", async () => {
    const { db, find } = createCleanupMockDb();
    const cutoffDate = "2026-01-01T00:00:00.000Z";

    await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate,
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
    });

    expect(find).toHaveBeenCalledTimes(1);
    const query = find.mock.calls[0][0];
    // FileAttachments' own business date is `uploadedAt` (see
    // CLEANUP_DATE_FIELD / archiveFileAttachments' `uploadedAt < $cutoff`
    // filter) — NOT `_archivedAt` (when the doc was copied into Mongo).
    // Regression test: these two clocks used to be conflated, which meant a
    // document only became delete-eligible ARCHIVE_DAYS after it happened to
    // be (re-)archived into Mongo, regardless of how old the actual business
    // record was.
    expect(query).toMatchObject({
      _isArchived: true,
      uploadedAt: { $lt: cutoffDate },
      _sanityDeletedAt: { $exists: false },
    });
    expect(query._archivedAt).toBeUndefined();
    // FileAttachments has no workflow status, so DELETE_SAFE_STATUS must not
    // add a status clause for it.
    expect(query.status).toBeUndefined();
  });

  it("compares against each collection's own business date field, not _archivedAt", async () => {
    const cutoffDate = "2026-01-01T00:00:00.000Z";
    const cases: Array<[string, string]> = [
      ["archived_dispatch_logs", "dispatchDate"],
      ["archived_purchase_orders", "orderDate"],
      ["archived_goods_receipts", "receiptDate"],
      ["archived_internal_transfers", "transferDate"],
      ["archived_stock_adjustments", "adjustmentDate"],
      ["archived_inventory_counts", "countDate"],
      ["archived_file_attachments", "uploadedAt"],
      ["archived_stock_snapshots", "_createdAt"],
    ];

    for (const [collectionName, dateField] of cases) {
      const { db, find } = createCleanupMockDb();
      await cleanupCollectionBatched({
        db,
        collectionName,
        cutoffDate,
        resumeCursor: null,
        checkTimeBudget: () => false,
        errors: [],
      });
      const query = find.mock.calls[0][0];
      expect(query[dateField]).toEqual({ $lt: cutoffDate });
      expect(query._archivedAt).toBeUndefined();
    }
  });

  it("additionally requires a finished workflow status for gated collections", async () => {
    const { db, find } = createCleanupMockDb();

    await cleanupCollectionBatched({
      db,
      collectionName: "archived_dispatch_logs",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
    });

    const query = find.mock.calls[0][0];
    expect(query.status).toEqual({ $in: ["completed", "cancelled"] });
  });

  // Regression test: every archive collection's `_id` is the original
  // Sanity document id (a string), never a native MongoDB ObjectId — a
  // real production bug where resuming a paused cleanup run crashed
  // immediately (uncaught, swallowed by a background .catch(), later
  // misreported as generic staleness) because this path unconditionally
  // did `new ObjectId(cursor)` on a cursor that was never valid ObjectId
  // input. No prior test ever exercised a non-null resumeCursor at all.
  it("resumes from a non-ObjectId (Sanity-id-shaped) cursor without throwing", async () => {
    const { db, find } = createCleanupMockDb();
    const sanityIdCursor = "12823a30-4437-4228-b743-463e73c1ac3a";

    await expect(
      cleanupCollectionBatched({
        db,
        collectionName: "archived_dispatch_logs",
        cutoffDate: "2026-01-01T00:00:00.000Z",
        resumeCursor: sanityIdCursor,
        checkTimeBudget: () => false,
        errors: [],
      }),
    ).resolves.toBeDefined();

    const query = find.mock.calls[0][0];
    expect(query._id).toEqual({ $gt: sanityIdCursor });
  });

  // Deletes are now issued as ONE Sanity mutation transaction per page,
  // not one HTTP request per document — see cleanupCollectionBatched. A
  // multi-thousand-document backlog previously took roughly one ~100-doc
  // batch per ~270s invocation (almost entirely sequential network
  // latency); this collapses each batch to a single round trip.
  function createMockTransaction() {
    const deleted: string[] = [];
    const transaction = {
      delete: jest.fn((id: string) => {
        deleted.push(id);
        return transaction;
      }),
      commit: jest.fn().mockResolvedValue({}),
    };
    return { transaction, deleted };
  }

  it("deletes a whole page in one transaction and marks all of them in Mongo with one updateMany", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        { _id: "mongo-1", _sanityId: "sanity-1" },
        { _id: "mongo-2", _sanityId: "sanity-2" },
      ])
      .mockResolvedValueOnce([]); // second page: none left, loop stops
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateMany = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateMany }) } as any;

    const { transaction, deleted } = createMockTransaction();
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
      batchSize: 2,
    });

    expect(result.deletedCount).toBe(2);
    expect(deleted).toEqual(["sanity-1", "sanity-2"]);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(writeClient.delete).not.toHaveBeenCalled(); // fast path only, no fallback needed
    expect(updateMany).toHaveBeenCalledWith(
      { _sanityId: { $in: ["sanity-1", "sanity-2"] } },
      { $set: { _sanityDeletedAt: expect.any(String) } },
    );
  });

  // Regression test: deleteSanityAsset existed in this file but was never
  // actually called anywhere — confirmed against production Mongo data on
  // 2026-09-20, where every one of 3,671 already-deleted FileAttachment
  // documents still had its underlying 1-4MB image/PDF asset sitting
  // orphaned in Sanity (Assets Deleted: 0 on every run, ever). A
  // FileAttachment document and its asset are now deleted together, in the
  // same transaction, whenever the doc carries a file.asset._id.
  it("deletes a FileAttachment's underlying asset alongside its document, in the same transaction", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        {
          _id: "mongo-1",
          _sanityId: "sanity-1",
          file: { asset: { _id: "file-asset-1" } },
        },
        // No asset on this one — e.g. a legacy record — must not throw or
        // attempt to delete anything for it.
        { _id: "mongo-2", _sanityId: "sanity-2" },
      ])
      .mockResolvedValueOnce([]);
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateMany = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateMany }) } as any;

    const { transaction, deleted } = createMockTransaction();
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
      batchSize: 2,
    });

    expect(deleted).toEqual(["sanity-1", "file-asset-1", "sanity-2"]);
    expect(result.deletedCount).toBe(2);
    expect(result.assetsDeleted).toBe(1);
  });

  it("deletes a FileAttachment's underlying asset via a separate call when falling back to per-document deletes", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        {
          _id: "mongo-1",
          _sanityId: "sanity-1",
          file: { asset: { _id: "file-asset-1" } },
        },
      ])
      .mockResolvedValueOnce([]);
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateOne = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateOne }) } as any;

    const { transaction } = createMockTransaction();
    transaction.commit.mockRejectedValue(new Error("transaction failed"));
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);
    (writeClient.delete as jest.Mock).mockResolvedValue({});

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
      batchSize: 2,
    });

    expect(writeClient.delete).toHaveBeenCalledWith("sanity-1");
    expect(writeClient.delete).toHaveBeenCalledWith("file-asset-1");
    expect(result.deletedCount).toBe(1);
    expect(result.assetsDeleted).toBe(1);
  });

  it("falls back to per-document deletes for a page if the batched transaction itself fails", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        { _id: "mongo-1", _sanityId: "sanity-1" },
        { _id: "mongo-2", _sanityId: "sanity-2" },
      ])
      .mockResolvedValueOnce([]);
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateOne = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateOne }) } as any;

    const { transaction } = createMockTransaction();
    transaction.commit.mockRejectedValue(new Error("transaction failed"));
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);
    (writeClient.delete as jest.Mock).mockResolvedValue({});

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
      batchSize: 2,
    });

    expect(result.deletedCount).toBe(2);
    expect(writeClient.delete).toHaveBeenCalledTimes(2);
    expect(writeClient.delete).toHaveBeenCalledWith("sanity-1");
    expect(writeClient.delete).toHaveBeenCalledWith("sanity-2");
    expect(updateOne).toHaveBeenCalledWith(
      { _sanityId: "sanity-1" },
      { $set: { _sanityDeletedAt: expect.any(String) } },
    );
  });

  // Regression test for the exact production incident this run reported:
  // "FAILED, 462 errors, 0 deleted" — every one of those 462 was Sanity
  // correctly refusing to delete a document still referenced by a *different*
  // live document that hadn't individually crossed the delete cutoff yet
  // (expected, since ARCHIVE_MIN_AGE_DAYS is decoupled from ARCHIVE_DAYS —
  // see the comment above both constants). That's not a bug and must not be
  // counted as one, or a run where literally nothing was old enough to
  // delete yet gets misreported as a failure.
  it("skips (not errors) a document Sanity refuses to delete because a live document still references it", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        { _id: "mongo-1", _sanityId: "sanity-1" },
        { _id: "mongo-2", _sanityId: "sanity-2" },
      ])
      .mockResolvedValueOnce([]);
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateOne = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateOne }) } as any;

    const { transaction } = createMockTransaction();
    transaction.commit.mockRejectedValue(new Error("transaction failed"));
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);

    const referencedError = Object.assign(
      new Error(
        'Mutation failed: Document "sanity-1" cannot be deleted as there are references to it from "some-other-doc"',
      ),
      {
        statusCode: 409,
        details: {
          type: "mutationError",
          items: [{ error: { type: "documentHasExistingReferencesError" } }],
        },
      },
    );
    (writeClient.delete as jest.Mock)
      .mockRejectedValueOnce(referencedError)
      .mockResolvedValueOnce({});

    const errors: string[] = [];
    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_purchase_orders",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors,
      batchSize: 2,
    });

    // sanity-1 was blocked by a live reference and must be silently skipped:
    // not an error, and not counted as deleted.
    expect(errors).toEqual([]);
    expect(result.deletedCount).toBe(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { _sanityId: "sanity-2" },
      { $set: { _sanityDeletedAt: expect.any(String) } },
    );
  });

  // Regression test mirroring the equivalent one for insertIfNotExists:
  // this per-document fallback loop (used when the batched Sanity
  // transaction itself fails) previously had no time-budget check at all,
  // so a slow/flaky connection to either Sanity or Mongo here could run
  // straight through the whole run's time budget with no checkpoint saved.
  // This is very plausibly the exact mechanism behind a real production
  // incident where a cleanup run reported 8/8 collections "completed" with
  // 462 errors and 0 net deletions.
  it("stops the per-document delete fallback mid-batch once the time budget is exhausted, resuming from the last document actually attempted", async () => {
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([
        { _id: "mongo-1", _sanityId: "sanity-1" },
        { _id: "mongo-2", _sanityId: "sanity-2" },
        { _id: "mongo-3", _sanityId: "sanity-3" },
      ]);
    const project = jest.fn().mockReturnValue({ toArray });
    const limit = jest.fn().mockReturnValue({ project });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const updateOne = jest.fn().mockResolvedValue({});
    const db = { collection: jest.fn().mockReturnValue({ find, updateOne }) } as any;

    const { transaction } = createMockTransaction();
    transaction.commit.mockRejectedValue(new Error("transaction failed"));
    (writeClient.transaction as jest.Mock).mockReturnValue(transaction);
    (writeClient.delete as jest.Mock).mockResolvedValue({});

    // Stop only once the first document's Mongo bookkeeping update has
    // actually completed — decoupled from exact call counts, which shifted
    // once withRetry started consulting this same predicate before each
    // retry-wrapped operation, not just once per document.
    const checkTimeBudget = () => updateOne.mock.calls.length > 0;

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget,
      errors: [],
      batchSize: 3,
    });

    expect(result.done).toBe(false);
    expect(result.resumeCursor).toBe("mongo-1");
    expect(result.deletedCount).toBe(1);
    // Only the first document should ever have been attempted.
    expect(writeClient.delete).toHaveBeenCalledTimes(1);
    expect(writeClient.delete).toHaveBeenCalledWith("sanity-1");
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("never calls Sanity delete or transaction for a candidate with no resolvable _sanityId", async () => {
    const { db } = createCleanupMockDb();
    (db.collection as jest.Mock).mockReturnValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([{ _id: "mongo-1" }]),
            }),
          }),
        }),
      }),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
    });

    const result = await cleanupCollectionBatched({
      db,
      collectionName: "archived_file_attachments",
      cutoffDate: "2026-01-01T00:00:00.000Z",
      resumeCursor: null,
      checkTimeBudget: () => false,
      errors: [],
    });

    expect(result.deletedCount).toBe(0);
    expect(writeClient.delete).not.toHaveBeenCalled();
    expect(writeClient.transaction).not.toHaveBeenCalled();
  });
});

// The admin page polls /api/archive/status while a cleanup run is active and
// renders currentCleanupRun.errors.length unconditionally (no `?.`, no error
// boundary in src/app). If the progress document cleanupArchivedSanityData
// writes at the start of a run doesn't include an `errors` array, that
// render throws for the entire "running" phase — which from the admin's
// point of view looks exactly like "the delete button doesn't work" (click
// it, page breaks). This pins down that the field is always present.
describe("cleanupArchivedSanityData", () => {
  function createEmptyCandidateCollection() {
    return {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            project: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
  }

  it("writes an `errors` array on the very first progress update, before any collection is processed", async () => {
    const progressUpdateOne = jest.fn().mockResolvedValue({});
    const progressCollection = {
      updateOne: progressUpdateOne,
      insertOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const emptyCollection = createEmptyCandidateCollection();
    const db = {
      collection: jest.fn().mockImplementation((name: string) =>
        name === "archive_runs" ? progressCollection : emptyCollection,
      ),
    } as any;
    (getArchiveDb as jest.Mock).mockResolvedValue(db);

    await cleanupArchivedSanityData("test-run-1");

    const firstUpdateArgs = progressUpdateOne.mock.calls[0];
    expect(firstUpdateArgs[1].$set.status).toBe("running");
    expect(firstUpdateArgs[1].$set.errors).toEqual([]);
  });
});

// captureStockBaseline() used to run unconditionally on every runArchive()
// call — including every resumeIncompleteArchives() retry, fired every 5
// minutes — which drove stock_baselines to ~5-8 captures/day instead of the
// intended 1/day and blew through the Atlas free-tier quota (378MB of a
// 512MB cap). These tests cover the captureDay dedupe fix that stops that.
describe("captureStockBaseline (captureDay dedupe)", () => {
  const REAL_DATE_NOW = Date.now;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Date.now = REAL_DATE_NOW;
  });

  function mockDbWithBaselineCollection(overrides: {
    findOne?: jest.Mock;
    insertOne?: jest.Mock;
  }) {
    const baselineCollection = {
      findOne: overrides.findOne || jest.fn().mockResolvedValue(null),
      insertOne: overrides.insertOne || jest.fn().mockResolvedValue({}),
    };
    const db = {
      collection: jest.fn().mockReturnValue(baselineCollection),
    } as any;
    return { db, baselineCollection };
  }

  it("skips the Sanity fetch and insert entirely when today is already captured", async () => {
    const todayIso = new Date().toISOString();
    const captureDay = todayIso.slice(0, 10);
    const findOne = jest.fn().mockResolvedValue({ captureDay });
    const insertOne = jest.fn();
    const { db } = mockDbWithBaselineCollection({ findOne, insertOne });

    await captureStockBaseline(db);

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(sanityClient.fetch).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("captures when the latest doc is from a different day", async () => {
    const findOne = jest.fn().mockResolvedValue({ captureDay: "2000-01-01" });
    const insertOne = jest.fn().mockResolvedValue({});
    const { db } = mockDbWithBaselineCollection({ findOne, insertOne });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted.captureDay).toBe(new Date().toISOString().slice(0, 10));
  });

  it("captures on the very first run when there is no prior doc at all", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn().mockResolvedValue({});
    const { db } = mockDbWithBaselineCollection({ findOne, insertOne });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("treats a lost captureDay race (E11000) as a normal no-op, not an error", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn().mockRejectedValue({ code: 11000 });
    const { db } = mockDbWithBaselineCollection({ findOne, insertOne });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await expect(captureStockBaseline(db)).resolves.toBeUndefined();
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the Sanity registry has no stockData", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn();
    const { db } = mockDbWithBaselineCollection({ findOne, insertOne });
    (sanityClient.fetch as jest.Mock).mockResolvedValue(null);

    await expect(captureStockBaseline(db)).resolves.toBeUndefined();
    expect(insertOne).not.toHaveBeenCalled();
  });
});

function bin(overrides: Partial<Record<string, any>> = {}) {
  return {
    binId: "b1",
    quantity: 10,
    lastUpdated: "2026-09-01T00:00:00.000Z",
    lastTransactionId: "t1",
    lastTransactionType: "goodsReceipt",
    ...overrides,
  };
}

describe("computeStockBaselineDiff", () => {
  it("produces an empty diff when nothing changed", () => {
    const items = [{ stockItemId: "A", binQuantities: { bins: [bin()] } }];
    const { changedItems, removedItemIds } = computeStockBaselineDiff(
      items,
      items.map((i) => ({ ...i, binQuantities: { bins: [{ ...bin() }] } })),
    );
    expect(changedItems).toEqual([]);
    expect(removedItemIds).toEqual([]);
  });

  it("includes only the changed bin, not untouched siblings", () => {
    const previous = [
      {
        stockItemId: "A",
        binQuantities: { bins: [bin({ binId: "b1" }), bin({ binId: "b2" })] },
      },
    ];
    const current = [
      {
        stockItemId: "A",
        binQuantities: {
          bins: [bin({ binId: "b1", quantity: 99 }), bin({ binId: "b2" })],
        },
      },
    ];
    const { changedItems } = computeStockBaselineDiff(previous, current);
    expect(changedItems).toEqual([
      { stockItemId: "A", bins: [bin({ binId: "b1", quantity: 99 })] },
    ]);
  });

  it("marks a bin removed from an item as {binId, removed:true}", () => {
    const previous = [
      {
        stockItemId: "A",
        binQuantities: { bins: [bin({ binId: "b1" }), bin({ binId: "b2" })] },
      },
    ];
    const current = [
      { stockItemId: "A", binQuantities: { bins: [bin({ binId: "b1" })] } },
    ];
    const { changedItems } = computeStockBaselineDiff(previous, current);
    expect(changedItems).toEqual([
      { stockItemId: "A", bins: [{ binId: "b2", removed: true }] },
    ]);
  });

  it("includes every bin for a brand-new item", () => {
    const previous: any[] = [];
    const current = [
      { stockItemId: "A", binQuantities: { bins: [bin()] } },
    ];
    const { changedItems } = computeStockBaselineDiff(previous, current);
    expect(changedItems).toEqual([{ stockItemId: "A", bins: [bin()] }]);
  });

  it("puts an entirely-removed item in removedItemIds, not changedItems", () => {
    const previous = [{ stockItemId: "A", binQuantities: { bins: [bin()] } }];
    const current: any[] = [];
    const { changedItems, removedItemIds } = computeStockBaselineDiff(
      previous,
      current,
    );
    expect(changedItems).toEqual([]);
    expect(removedItemIds).toEqual(["A"]);
  });

  it("handles empty arrays on both sides without throwing", () => {
    expect(computeStockBaselineDiff([], [])).toEqual({
      changedItems: [],
      removedItemIds: [],
    });
  });
});

const ANCHOR_ID = "507f1f77bcf86cd799439011";
const OTHER_ANCHOR_ID = "507f1f77bcf86cd799439099";

function makeReconstructDb(docsById: Record<string, any>, diffs: any[]) {
  const findOne = jest.fn(async (query: any) => {
    const idStr = query?._id?.toString?.();
    return idStr ? docsById[idStr] ?? null : null;
  });
  const find = jest.fn((query: any) => {
    const matches = diffs
      .filter(
        (d) =>
          d.type === "diff" &&
          d.baseId === query.baseId &&
          new Date(d.capturedAt).getTime() <=
            new Date(query.capturedAt.$lte).getTime(),
      )
      .sort(
        (a, b) =>
          new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      );
    return {
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(matches),
      }),
    };
  });
  const db = { collection: jest.fn().mockReturnValue({ findOne, find }) } as any;
  return db;
}

describe("reconstructStockBaselineChain", () => {
  it("returns a full doc's items as-is with no db lookups", async () => {
    const db = { collection: jest.fn() } as any;
    const fullDoc = {
      type: "full",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin()] } }] },
    };

    const result = await reconstructStockBaselineChain(db, fullDoc);

    expect(result?.items).toEqual(fullDoc.stockData.items);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("treats a legacy doc with no type field as an implicit full doc", async () => {
    const db = { collection: jest.fn() } as any;
    const legacyDoc = {
      capturedAt: "2026-08-23T08:22:16.879Z", // legacy: string, not Date
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin()] } }] },
    };

    const result = await reconstructStockBaselineChain(db, legacyDoc);

    expect(result?.items).toEqual(legacyDoc.stockData.items);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("applies a single diff on top of its anchor full doc", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin({ quantity: 10 })] } }] },
    };
    const diff = {
      type: "diff",
      baseId: ANCHOR_ID,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
      changedItems: [{ stockItemId: "A", bins: [bin({ quantity: 20 })] }],
      removedItemIds: [],
    };
    const db = makeReconstructDb({ [ANCHOR_ID]: anchor }, [diff]);

    const result = await reconstructStockBaselineChain(db, diff);

    expect(result?.items).toEqual([
      { stockItemId: "A", binQuantities: { bins: [bin({ quantity: 20 })] } },
    ]);
  });

  it("replays chained diffs in capturedAt order, not array/insertion order", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin({ quantity: 10 })] } }] },
    };
    const diff1 = {
      type: "diff",
      baseId: ANCHOR_ID,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
      changedItems: [{ stockItemId: "A", bins: [bin({ quantity: 20 })] }],
      removedItemIds: [],
    };
    const diff2 = {
      type: "diff",
      baseId: ANCHOR_ID,
      capturedAt: new Date("2026-09-03T00:00:00.000Z"),
      changedItems: [{ stockItemId: "A", bins: [bin({ quantity: 30 })] }],
      removedItemIds: [],
    };
    // Deliberately out of chronological order in the backing array/collection.
    const db = makeReconstructDb({ [ANCHOR_ID]: anchor }, [diff2, diff1]);

    const result = await reconstructStockBaselineChain(db, diff2);

    expect(result?.items[0].binQuantities.bins[0].quantity).toBe(30);
  });

  it("removes a bin marked removed:true during replay", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      stockData: {
        items: [
          {
            stockItemId: "A",
            binQuantities: { bins: [bin({ binId: "b1" }), bin({ binId: "b2" })] },
          },
        ],
      },
    };
    const diff = {
      type: "diff",
      baseId: ANCHOR_ID,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
      changedItems: [{ stockItemId: "A", bins: [{ binId: "b2", removed: true }] }],
      removedItemIds: [],
    };
    const db = makeReconstructDb({ [ANCHOR_ID]: anchor }, [diff]);

    const result = await reconstructStockBaselineChain(db, diff);

    expect(result?.items[0].binQuantities.bins.map((b: any) => b.binId)).toEqual(["b1"]);
  });

  it("removes an item listed in removedItemIds during replay", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      stockData: {
        items: [
          { stockItemId: "A", binQuantities: { bins: [bin()] } },
          { stockItemId: "B", binQuantities: { bins: [bin()] } },
        ],
      },
    };
    const diff = {
      type: "diff",
      baseId: ANCHOR_ID,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
      changedItems: [],
      removedItemIds: ["B"],
    };
    const db = makeReconstructDb({ [ANCHOR_ID]: anchor }, [diff]);

    const result = await reconstructStockBaselineChain(db, diff);

    expect(result?.items.map((i: any) => i.stockItemId)).toEqual(["A"]);
  });

  it("returns null and logs when the anchor doc is missing (expired/deleted)", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const diff = {
      type: "diff",
      baseId: OTHER_ANCHOR_ID,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
      changedItems: [],
      removedItemIds: [],
    };
    const db = makeReconstructDb({}, [diff]); // anchor not present

    const result = await reconstructStockBaselineChain(db, diff);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("returns null and logs when a diff doc has no baseId", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const malformedDiff = {
      type: "diff",
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const db = { collection: jest.fn() } as any;

    const result = await reconstructStockBaselineChain(db, malformedDiff);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("captureStockBaseline (full-vs-diff decision)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeCaptureFlowDb(opts: { latest: any; anchor?: any }) {
    const insertOne = jest.fn().mockResolvedValue({});
    const findOne = jest.fn(async (query: any, options?: any) => {
      if (options?.sort) return opts.latest;
      if (query?._id) return opts.anchor ?? null;
      return null;
    });
    const find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    });
    const db = {
      collection: jest.fn().mockReturnValue({ findOne, find, insertOne }),
    } as any;
    return { db, insertOne };
  }

  it("captures type:'full' when there is no prior doc at all", async () => {
    const { db, insertOne } = makeCaptureFlowDb({ latest: null });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin()] } }] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("full");
    expect(doc.capturedAt).toBeInstanceOf(Date);
  });

  it("captures type:'diff' with the correct baseId when the anchor is under 7 days old", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      captureDay: "2000-01-01",
      capturedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin({ quantity: 10 })] } }] },
    };
    const { db, insertOne } = makeCaptureFlowDb({ latest: anchor, anchor });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: {
        items: [{ stockItemId: "A", binQuantities: { bins: [bin({ quantity: 20 })] } }],
      },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    expect(insertOne).toHaveBeenCalledTimes(1);
    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("diff");
    expect(doc.baseId).toBe(ANCHOR_ID);
    expect(doc.changedItems).toEqual([
      { stockItemId: "A", bins: [bin({ quantity: 20 })] },
    ]);
    expect(doc.removedItemIds).toEqual([]);
  });

  it("captures a fresh type:'full' when the anchor is 7+ days old", async () => {
    const anchor = {
      _id: { toString: () => ANCHOR_ID },
      type: "full",
      captureDay: "2000-01-01",
      capturedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      stockData: { items: [] },
    };
    const { db, insertOne } = makeCaptureFlowDb({ latest: anchor, anchor });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin()] } }] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("full");
  });

  it("self-heals to type:'full' when the anchor is missing/orphaned", async () => {
    const latest = {
      _id: { toString: () => "507f1f77bcf86cd799439022" },
      type: "diff",
      baseId: ANCHOR_ID,
      captureDay: "2000-01-01",
      capturedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      changedItems: [],
      removedItemIds: [],
    };
    // anchor deliberately omitted -> findOne({_id}) resolves null
    const { db, insertOne } = makeCaptureFlowDb({ latest, anchor: null });
    (sanityClient.fetch as jest.Mock).mockResolvedValue({
      stockData: { items: [{ stockItemId: "A", binQuantities: { bins: [bin()] } }] },
      lastUpdated: "2026-09-22T00:00:00.000Z",
    });

    await captureStockBaseline(db);

    const doc = insertOne.mock.calls[0][0];
    expect(doc.type).toBe("full");
  });
});

describe("cleanupOldArchiveMetadata", () => {
  it("compares stock_baselines.capturedAt as a Date, and archive_runs.startedAt as a string", async () => {
    const deleteManyRuns = jest.fn().mockResolvedValue({ deletedCount: 2 });
    const deleteManyBaselines = jest.fn().mockResolvedValue({ deletedCount: 5 });
    const db = {
      collection: jest.fn().mockImplementation((name: string) =>
        name === "archive_runs"
          ? { deleteMany: deleteManyRuns }
          : { deleteMany: deleteManyBaselines },
      ),
    } as any;
    (getArchiveDb as jest.Mock).mockResolvedValue(db);

    const result = await cleanupOldArchiveMetadata();

    const runsQuery = deleteManyRuns.mock.calls[0][0];
    expect(typeof runsQuery.startedAt.$lt).toBe("string");

    const baselinesQuery = deleteManyBaselines.mock.calls[0][0];
    expect(baselinesQuery.capturedAt.$lt).toBeInstanceOf(Date);

    expect(result.deletedRuns).toBe(2);
    expect(result.deletedBaselines).toBe(5);
  });
});

describe("ensureIndexes (stock_baselines)", () => {
  it("creates a unique+sparse captureDay index and a 30-day TTL capturedAt index", async () => {
    const createIndex = jest.fn().mockResolvedValue("ok");
    const db = { collection: jest.fn().mockReturnValue({ createIndex }) } as any;

    await ensureIndexes(db);

    const captureDayCall = createIndex.mock.calls.find(
      ([spec]: any[]) => spec.captureDay === 1,
    );
    expect(captureDayCall).toBeTruthy();
    expect(captureDayCall![1]).toEqual({ unique: true, sparse: true });

    const ttlCall = createIndex.mock.calls.find(
      ([spec]: any[]) => spec.capturedAt === 1,
    );
    expect(ttlCall).toBeTruthy();
    expect(ttlCall![1]).toEqual({ expireAfterSeconds: 30 * 24 * 60 * 60 });
  });
});
