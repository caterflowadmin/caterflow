// Regression test for a real bug found live: getRecentArchiveRuns() only
// excluded the archive engine's live-progress singleton (kind: "progress"),
// not the cleanup engine's equivalent (kind: "cleanup-progress"). That doc
// is the SAME one document being upserted in place while a cleanup runs —
// not a completed run record — so it leaked into "history" as a duplicate,
// constantly-mutating row, and (since its kind isn't exactly "cleanup")
// rendered as an "Archive" run in the admin UI instead of "Delete".

jest.mock("@/lib/mongoClient", () => ({
  getArchiveDb: jest.fn(),
  COLLECTIONS: {
    ARCHIVE_RUNS: "archive_runs",
    STOCK_BASELINES: "stock_baselines",
    DISPATCH_LOGS: "dispatch_logs",
    GOODS_RECEIPTS: "goods_receipts",
    INVENTORY_COUNTS: "inventory_counts",
    INTERNAL_TRANSFERS: "internal_transfers",
  },
}));

// archiveQueries.ts's getLatestStockBaseline() now imports
// reconstructStockBaselineChain from archiveService.ts, which transitively
// pulls in @/lib/sanity -> next-sanity (an ESM-only package Jest's default
// transform can't parse). None of that is exercised by getRecentArchiveRuns
// (this file's only subject), so stub the whole module out rather than
// dragging archiveService.test.ts's full sanity/mongodb/next-sanity mock
// setup in here too.
jest.mock("@/lib/archiveService", () => ({
  reconstructStockBaselineChain: jest.fn(),
}));

import {
  getRecentArchiveRuns,
  getArchivedDispatchLogs,
  getArchivedGoodsReceipts,
  getArchivedBinCounts,
  getArchivedTransfers,
} from "@/lib/archiveQueries";
import { getArchiveDb } from "@/lib/mongoClient";

describe("getRecentArchiveRuns", () => {
  it("excludes both the archive and cleanup live-progress singleton docs", async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const db = { collection: jest.fn().mockReturnValue({ find }) } as any;
    (getArchiveDb as jest.Mock).mockResolvedValue(db);

    await getRecentArchiveRuns(10);

    const query = find.mock.calls[0][0];
    expect(query.kind.$nin).toEqual(
      expect.arrayContaining(["progress", "cleanup-progress"]),
    );
  });
});

// Regression: archived history used to be silently capped at the newest 500
// documents, so reports built opening stock from a truncated ledger.
describe("archived transaction queries return the complete history", () => {
  const setup = () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    (getArchiveDb as jest.Mock).mockResolvedValue({
      collection: jest.fn().mockReturnValue({ find }),
    });
    return limit;
  };
  const opts = { userSiteId: null, canAccessMultipleSites: true };

  it.each([
    ["dispatches", getArchivedDispatchLogs],
    ["goods receipts", getArchivedGoodsReceipts],
    ["bin counts", getArchivedBinCounts],
    ["transfers", getArchivedTransfers],
  ])("does not cap %s at 500", async (_name, fn) => {
    const limit = setup();
    await (fn as any)(opts);
    expect(limit).toHaveBeenCalledWith(0); // Mongo: 0 = no limit
  });

  it("still honours an explicit limit", async () => {
    const limit = setup();
    await getArchivedDispatchLogs({ ...opts, limit: 25 });
    expect(limit).toHaveBeenCalledWith(25);
  });
});
