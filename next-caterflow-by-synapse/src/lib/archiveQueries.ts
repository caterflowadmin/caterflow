// src/lib/archiveQueries.ts
// MongoDB query helpers for fetching archived data — used by the API routes

import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";
import type { Filter } from "mongodb";

// ─── Generic helpers ───────────────────────────────────────────────────────────

/** Build a site filter for MongoDB queries based on user role */
function buildMongoSiteFilter(
  userSiteId: string | null,
  canAccessMultipleSites: boolean,
  siteField: string = "site._id",
): Filter<any> {
  if (canAccessMultipleSites) return {};
  if (userSiteId) return { [siteField]: userSiteId };
  return { _id: null }; // No access — return nothing
}

// ─── Dispatch Logs ─────────────────────────────────────────────────────────────

export async function getArchivedDispatchLogs(options: {
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
  limit?: number;
  skip?: number;
}) {
  const db = await getArchiveDb();
  const siteFilter = buildMongoSiteFilter(
    options.userSiteId,
    options.canAccessMultipleSites,
    "sourceSite._id",
  );

  return db
    .collection(COLLECTIONS.DISPATCH_LOGS)
    .find(siteFilter)
    .sort({ dispatchDate: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 500)
    .toArray();
}

export async function getArchivedDispatchById(sanityId: string) {
  const db = await getArchiveDb();
  return db.collection(COLLECTIONS.DISPATCH_LOGS).findOne({
    _sanityId: sanityId,
  });
}

// ─── Purchase Orders ───────────────────────────────────────────────────────────

export async function getArchivedPurchaseOrders(options: {
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
  status?: string;
  limit?: number;
  skip?: number;
}) {
  const db = await getArchiveDb();
  const siteFilter = buildMongoSiteFilter(
    options.userSiteId,
    options.canAccessMultipleSites,
    "site._id",
  );

  const filter: Filter<any> = { ...siteFilter };
  if (options.status) filter.status = options.status;

  return db
    .collection(COLLECTIONS.PURCHASE_ORDERS)
    .find(filter)
    .sort({ orderDate: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 500)
    .toArray();
}

export async function getArchivedPurchaseOrderById(id: string) {
  const db = await getArchiveDb();
  return db.collection(COLLECTIONS.PURCHASE_ORDERS).findOne({
    _sanityId: id,
  });
}

// ─── Goods Receipts ────────────────────────────────────────────────────────────

export async function getArchivedGoodsReceipts(options: {
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
  limit?: number;
  skip?: number;
}) {
  const db = await getArchiveDb();

  let filter: Filter<any> = {};
  if (!options.canAccessMultipleSites && options.userSiteId) {
    filter = {
      $or: [
        { "purchaseOrder.site._id": options.userSiteId },
        { "receivedItems.receivingBin.site._id": options.userSiteId },
      ],
    };
  } else if (!options.canAccessMultipleSites) {
    filter = { _id: null };
  }

  return db
    .collection(COLLECTIONS.GOODS_RECEIPTS)
    .find(filter)
    .sort({ receiptDate: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 500)
    .toArray();
}

export async function getArchivedGoodsReceiptById(id: string) {
  const db = await getArchiveDb();
  return db.collection(COLLECTIONS.GOODS_RECEIPTS).findOne({
    _sanityId: id,
  });
}

// ─── Bin Counts (Inventory Counts) ───────────────────────────────────────────────

export async function getArchivedBinCounts(options: {
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
  limit?: number;
  skip?: number;
}) {
  const db = await getArchiveDb();
  const siteFilter = buildMongoSiteFilter(
    options.userSiteId,
    options.canAccessMultipleSites,
    "bin.site._id",
  );

  return db
    .collection(COLLECTIONS.INVENTORY_COUNTS)
    .find(siteFilter)
    .sort({ countDate: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 500)
    .toArray();
}

export async function getArchivedBinCountById(id: string) {
  const db = await getArchiveDb();
  return db.collection(COLLECTIONS.INVENTORY_COUNTS).findOne({
    _sanityId: id,
  });
}

export async function getArchivedFileAttachments(options: {
  relatedToId: string;
}) {
  const db = await getArchiveDb();
  return db
    .collection(COLLECTIONS.FILE_ATTACHMENTS)
    .find({ "relatedTo._id": options.relatedToId })
    .sort({ uploadedAt: -1 })
    .toArray();
}

// ─── Internal Transfers ────────────────────────────────────────────────────────

export async function getArchivedTransfers(options: {
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
  limit?: number;
  skip?: number;
}) {
  const db = await getArchiveDb();
  let filter: Filter<any> = {};
  if (!options.canAccessMultipleSites && options.userSiteId) {
    filter = {
      $or: [
        { "fromBin.site._id": options.userSiteId },
        { "toBin.site._id": options.userSiteId },
      ],
    };
  } else if (!options.canAccessMultipleSites) {
    filter = { _id: null };
  }

  return db
    .collection(COLLECTIONS.INTERNAL_TRANSFERS)
    .find(filter)
    .sort({ transferDate: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 500)
    .toArray();
}

export async function getArchivedTransferById(id: string) {
  const db = await getArchiveDb();
  return db
    .collection(COLLECTIONS.INTERNAL_TRANSFERS)
    .findOne({ _sanityId: id });
}

// ─── Transaction History (for stock calculations) ──────────────────────────────

export interface ArchivedTransaction {
  type: "receipt" | "dispatch" | "transferIn" | "transferOut" | "count";
  date: string;
  documentNumber: string;
  quantity: number;
  isNegative: boolean;
}

export async function getArchivedTransactionsForItem(
  stockItemId: string,
  binId: string,
): Promise<ArchivedTransaction[]> {
  const db = await getArchiveDb();
  const transactions: ArchivedTransaction[] = [];

  // Goods Receipts: item received into this bin
  // Status filter matches the live-data equivalents in stockCalculations.ts —
  // draft/pending-approval documents must not count toward stock once archived.
  const receipts = await db
    .collection(COLLECTIONS.GOODS_RECEIPTS)
    .find({
      status: { $in: ["completed", "processed"] },
      receivedItems: {
        $elemMatch: {
          "stockItem._id": stockItemId,
          "receivingBin._id": binId,
        },
      },
    })
    .toArray();

  for (const r of receipts) {
    for (const item of r.receivedItems || []) {
      if (
        item.stockItem?._id === stockItemId &&
        item.receivingBin?._id === binId
      ) {
        transactions.push({
          type: "receipt",
          date: r.receiptDate,
          documentNumber: r.receiptNumber,
          quantity: item.receivedQuantity || 0,
          isNegative: false,
        });
      }
    }
  }

  // Dispatch Logs: item dispatched from this bin
  const dispatches = await db
    .collection(COLLECTIONS.DISPATCH_LOGS)
    .find({
      status: { $in: ["completed", "processed"] },
      dispatchedItems: {
        $elemMatch: {
          "stockItem._id": stockItemId,
          "sourceBin._id": binId,
        },
      },
    })
    .toArray();

  for (const d of dispatches) {
    for (const item of d.dispatchedItems || []) {
      if (
        item.stockItem?._id === stockItemId &&
        item.sourceBin?._id === binId
      ) {
        const qty = item.dispatchedQuantity || 0;
        transactions.push({
          type: "dispatch",
          date: d.dispatchDate,
          documentNumber: d.dispatchNumber,
          quantity: -qty,
          isNegative: true,
        });
      }
    }
  }

  // Transfers Out: item transferred from this bin
  const transfersOut = await db
    .collection(COLLECTIONS.INTERNAL_TRANSFERS)
    .find({
      status: "completed",
      "fromBin._id": binId,
      transferredItems: {
        $elemMatch: { "stockItem._id": stockItemId },
      },
    })
    .toArray();

  for (const t of transfersOut) {
    for (const item of t.transferredItems || []) {
      if (item.stockItem?._id === stockItemId) {
        const qty = item.transferredQuantity || 0;
        transactions.push({
          type: "transferOut",
          date: t.transferDate,
          documentNumber: t.transferNumber,
          quantity: -qty,
          isNegative: true,
        });
      }
    }
  }

  // Transfers In: item transferred into this bin
  const transfersIn = await db
    .collection(COLLECTIONS.INTERNAL_TRANSFERS)
    .find({
      status: "completed",
      "toBin._id": binId,
      transferredItems: {
        $elemMatch: { "stockItem._id": stockItemId },
      },
    })
    .toArray();

  for (const t of transfersIn) {
    for (const item of t.transferredItems || []) {
      if (item.stockItem?._id === stockItemId) {
        transactions.push({
          type: "transferIn",
          date: t.transferDate,
          documentNumber: t.transferNumber,
          quantity: item.transferredQuantity || 0,
          isNegative: false,
        });
      }
    }
  }

  // Inventory Counts: absolute stock set
  const counts = await db
    .collection(COLLECTIONS.INVENTORY_COUNTS)
    .find({
      status: "completed",
      "bin._id": binId,
      countedItems: {
        $elemMatch: { "stockItem._id": stockItemId },
      },
    })
    .toArray();

  for (const c of counts) {
    for (const item of c.countedItems || []) {
      if (item.stockItem?._id === stockItemId) {
        transactions.push({
          type: "count",
          date: c.countDate,
          documentNumber: c.countNumber,
          quantity: item.countedQuantity || 0,
          isNegative: false,
        });
      }
    }
  }

  // Sort chronologically
  transactions.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return transactions;
}

// ─── Archive Run Logs ──────────────────────────────────────────────────────────

export async function getRecentArchiveRuns(limit = 10) {
  const db = await getArchiveDb();
  return db
    .collection(COLLECTIONS.ARCHIVE_RUNS)
    .find({
      // Exclude both live-progress singleton docs — the archive engine's is
      // kind: "progress" (_id: "archive-progress"), the cleanup engine's is
      // kind: "cleanup-progress" (_id: "cleanup-progress"). The cleanup one
      // was missing here: it isn't a completed run record, it's the SAME
      // one document being upserted in place while a cleanup is running, so
      // it leaked into "history" as a duplicate, constantly-mutating row —
      // and since its kind is "cleanup-progress" (not "cleanup"), it also
      // rendered as an "Archive" run in the admin UI, not "Delete".
      kind: { $nin: ["progress", "cleanup-progress"] },
    })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}

// ─── Latest Stock Baseline ─────────────────────────────────────────────────────

export async function getLatestStockBaseline() {
  const db = await getArchiveDb();
  return db
    .collection(COLLECTIONS.STOCK_BASELINES)
    .findOne({}, { sort: { capturedAt: -1 } });
}
