// Unit tests for the pure/mockable parts of the archive engine —
// stableSerialize/normalizeForComparison and insertIfNotExists. These run
// against a mocked Mongo `Db` and mocked Sanity client; no live connection
// is ever made (see the jest.mock calls below), so this is safe to run
// against any environment, including one whose .env points at production.

jest.mock("@/lib/sanity", () => ({
  client: {},
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
} from "@/lib/archiveService";
import { writeClient } from "@/lib/sanity";
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

    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0 });
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

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 1 });
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

    expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0 });
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

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 1 });
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

    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });
    expect(find).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
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

  it("queries only Mongo copies that are archived, past cutoff, and not already deleted", async () => {
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
    expect(query).toMatchObject({
      _isArchived: true,
      _archivedAt: { $lt: cutoffDate },
      _sanityDeletedAt: { $exists: false },
    });
    // FileAttachments has no workflow status, so DELETE_SAFE_STATUS must not
    // add a status clause for it.
    expect(query.status).toBeUndefined();
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
