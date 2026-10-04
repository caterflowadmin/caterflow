// src/lib/reportAnchors.ts
// Persistence for ledger anchors: closed periods and opening balances.
//
// Stored in the archive MongoDB (not Sanity) so they do not count against the
// Sanity document quota and cannot be removed by the archive/cleanup jobs.
// A document is never deleted: reopening marks it `reopenedAt`, which keeps an
// audit trail of who closed and reopened what.

import { getArchiveDb } from "@/lib/mongoClient";
import type { LedgerAnchor } from "@/lib/financialReport";

export const ANCHOR_COLLECTION = "report_anchors";

export interface StoredAnchor {
  _id: string;
  kind: "close" | "opening-balance";
  /** Site id, or "all". */
  siteKey: string;
  /** "YYYY-MM" for a close; omitted for an opening balance. */
  periodKey?: string;
  /** Ledger resumes at this instant. */
  asOf: Date;
  /** Stock value at `asOf`. */
  value: number;
  recordedAt: Date;
  recordedBy: string;
  note?: string;
  /** Figures at the time of closing, for later comparison. */
  snapshot?: Record<string, number>;
  reopenedAt?: Date | null;
  reopenedBy?: string | null;
}

export const anchorId = (
  kind: StoredAnchor["kind"],
  siteKey: string,
  key: string,
): string => `${kind}:${siteKey}:${key}`;

export const toLedgerAnchor = (a: StoredAnchor): LedgerAnchor => ({
  kind: a.kind,
  asOf: new Date(a.asOf),
  value: a.value,
  recordedAt: a.recordedAt ? new Date(a.recordedAt) : null,
});

export async function listAnchors(siteKey: string): Promise<StoredAnchor[]> {
  const db = await getArchiveDb();
  return db
    .collection<StoredAnchor>(ANCHOR_COLLECTION)
    .find({ siteKey })
    .sort({ asOf: -1, recordedAt: -1 })
    .toArray();
}

/** The active anchor with the latest `asOf` at or before `before`. */
export async function getLatestAnchor(
  siteKey: string,
  before: Date,
): Promise<StoredAnchor | null> {
  const db = await getArchiveDb();
  return db
    .collection<StoredAnchor>(ANCHOR_COLLECTION)
    .find({
      siteKey,
      asOf: { $lte: before },
      reopenedAt: { $in: [null, undefined] },
    } as any)
    .sort({ asOf: -1, recordedAt: -1 })
    .limit(1)
    .next();
}

export async function saveAnchor(anchor: StoredAnchor): Promise<void> {
  const db = await getArchiveDb();
  await db
    .collection<StoredAnchor>(ANCHOR_COLLECTION)
    .replaceOne({ _id: anchor._id }, anchor, { upsert: true });
}

/** Soft-delete (reopen). Returns false when nothing active matched. */
export async function reopenAnchor(
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const db = await getArchiveDb();
  const res = await db
    .collection<StoredAnchor>(ANCHOR_COLLECTION)
    .updateOne(
      { _id: id, reopenedAt: { $in: [null, undefined] } } as any,
      { $set: { reopenedAt: now, reopenedBy: userId } },
    );
  return res.modifiedCount > 0;
}
