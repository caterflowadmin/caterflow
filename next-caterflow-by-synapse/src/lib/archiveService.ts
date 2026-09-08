import { client as sanityClient, writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

// ARCHIVE_DAYS governs when a document's Sanity copy becomes eligible for
// PERMANENT DELETION from Sanity (see cleanupArchivedSanityData) — kept at
// 90 days by default; deletion is destructive, so this stays conservative.
const ARCHIVE_DAYS = parseInt(process.env.ARCHIVE_DAYS_THRESHOLD || "90", 10);
// ARCHIVE_MIN_AGE_DAYS governs a separate, much cheaper question: when is a
// document old enough to get a non-destructive COPY written into MongoDB?
// Copying is safe to do aggressively (it never removes anything from
// Sanity), so this defaults to 0 — a document becomes archive-eligible as
// soon as it's finalized (see each step's status filter below), regardless
// of age. Deliberately decoupled from ARCHIVE_DAYS so lowering this can't
// accidentally also widen what's eligible for deletion.
const ARCHIVE_MIN_AGE_DAYS = parseInt(
  process.env.ARCHIVE_MIN_AGE_DAYS ?? "0",
  10,
);
let appendProgress:
  | ((message: string | { skippedItem?: any }) => void)
  | undefined;

export interface ArchiveStepResult {
  name: string;
  count: number;
  deletedCount: number;
  // `inserted` = brand-new documents written to Mongo for the first time.
  // `updated` = documents that already existed in Mongo and were changed.
  // These were previously conflated under `inserted` (i.e. it meant
  // "inserted or updated"), which mislabeled the admin UI's "Inserted"
  // column. Kept both as separate optional counts so old readers of
  // `inserted` still get a number, just now an accurate one.
  inserted?: number;
  updated?: number;
  skipped?: number;
  status: "success" | "partial" | "failed";
  errors: string[];
  warnings: string[];
  assetsDeleted?: number;
  message?: string;
}

export interface ArchiveRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  archived: Record<string, number>;
  errors: string[];
  warnings: string[];
  skipped: number;
  totalInserted?: number;
  totalUpdated?: number;
  totalSkipped?: number;
  steps: ArchiveStepResult[];
  assetsDeleted: number;
  incomplete?: boolean;
  // Per-step resume position for a step that was interrupted mid-way
  // (not just between whole steps). Keyed by step name; value is the
  // last successfully-archived Sanity _id for that step, so a resumed
  // run can pick up immediately after it instead of re-fetching and
  // re-comparing everything from the start of that step's dataset.
  stepCursors?: Record<string, string | null>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createArchiveStepResult(options: {
  name: string;
  count: number;
  deletedCount: number;
  errors?: string[];
  warnings?: string[];
  assetsDeleted?: number;
  message?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
}): ArchiveStepResult {
  return {
    name: options.name,
    count: options.count,
    deletedCount: options.deletedCount,
    status: options.errors && options.errors.length ? "partial" : "success",
    errors: options.errors || [],
    warnings: options.warnings || [],
    assetsDeleted: options.assetsDeleted || 0,
    inserted: options.inserted || 0,
    updated: options.updated || 0,
    skipped: options.skipped || 0,
    message: options.message,
  };
}

// Deletion cutoff — see ARCHIVE_DAYS above. Used only by
// cleanupArchivedSanityData() (deleting from Sanity) and
// cleanupOldArchiveMetadata() (trimming old run-history/baseline records).
function getCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - ARCHIVE_DAYS);
  return d.toISOString();
}

// Archive-to-Mongo cutoff — see ARCHIVE_MIN_AGE_DAYS above. Used only by
// runArchive() to decide which documents are old enough to copy into
// MongoDB. Independent of getCutoffDate() by design.
function getArchiveCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - ARCHIVE_MIN_AGE_DAYS);
  return d.toISOString();
}

/** Safely resolve a Sanity reference string */
function refId(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val;
  return val._ref || val._id || null;
}

/** Remove Sanity-only metadata fields not needed in MongoDB */
function sanitizeForMongo(doc: any): any {
  const cleaned = { ...doc };
  delete cleaned._rev; // Sanity revision (irrelevant in Mongo)
  delete cleaned._updatedAt; // Sanity internal update timestamp
  delete cleaned._id; // Preserve original ID separately as _sanityId
  return cleaned;
}

export function normalizeForComparison(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item));
  }
  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = normalizeForComparison(value[key]);
          return acc;
        },
        {} as Record<string, any>,
      );
  }
  return value;
}

export function stableSerialize(value: any): string {
  return JSON.stringify(normalizeForComparison(value));
}

function buildArchivedDocumentPayload(doc: any): any {
  return {
    ...sanitizeForMongo(doc),
    _sanityId: doc._sanityId || doc._id,
    _isArchived: true,
  };
}

function getArchivePayloadLabel(payload: any): string {
  if (!payload || typeof payload !== "object") return "document";
  const fallbackId = payload._sanityId || payload._id || "document";
  return (
    payload.file?.asset?.originalFilename ||
    payload.fileName ||
    payload.poNumber ||
    payload.dispatchNumber ||
    payload.receiptNumber ||
    payload.transferNumber ||
    payload.adjustmentNumber ||
    payload.countNumber ||
    payload.title ||
    payload.name ||
    fallbackId
  );
}

function buildArchiveProgressMessage(
  payload: any,
  action: "inserted" | "updated" | "skipped",
): string {
  const type = payload._type || payload.type || "document";
  const label = getArchivePayloadLabel(payload);
  return `${action.charAt(0).toUpperCase() + action.slice(1)} ${type} ${label}`;
}

function isDuplicateKeyError(err: any): boolean {
  return (
    err?.code === 11000 ||
    (typeof err?.message === "string" &&
      err.message.toLowerCase().includes("duplicate key error"))
  );
}

function getAlternateUniqueQuery(payload: any): Record<string, any> | null {
  const uniqueKeys = [
    "dispatchNumber",
    "poNumber",
    "receiptNumber",
    "transferNumber",
    "adjustmentNumber",
    "countNumber",
  ];
  for (const key of uniqueKeys) {
    if (payload[key]) {
      return { [key]: payload[key] };
    }
  }
  return null;
}

async function resolveDuplicateKeyConflict(
  collection: any,
  payload: any,
  progress?: (message: string | { skippedItem?: any }) => void,
): Promise<boolean> {
  if (!payload._sanityId) {
    try {
      progress?.({
        skippedItem: {
          collection: collection.collectionName || null,
          reason: "no_sanity_id",
          label: getArchivePayloadLabel(payload),
          message: buildArchiveProgressMessage(payload, "skipped"),
        },
      });
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  const altQuery = getAlternateUniqueQuery(payload);
  if (!altQuery) return false;

  const existingByAlt = await collection.findOne(altQuery);
  if (!existingByAlt) return false;

  // This is a genuine duplicate business number — two *different* Sanity
  // documents (different _sanityId) both landed on the same poNumber/
  // dispatchNumber/etc, most likely from a historical double-submit before
  // the number was assigned server-side. Only one can occupy this unique
  // slot in the archive, so keep whichever one's underlying Sanity data was
  // actually edited more recently, rather than whichever happens to be
  // processed later in this run's _id-ordered cursor — that ordering has no
  // relationship to which document reflects the current, correct state.
  if (existingByAlt._sanityId && existingByAlt._sanityId !== payload._sanityId) {
    const incomingUpdatedAt = payload._sanityUpdatedAt
      ? new Date(payload._sanityUpdatedAt).getTime()
      : 0;
    const existingUpdatedAt = existingByAlt._sanityUpdatedAt
      ? new Date(existingByAlt._sanityUpdatedAt).getTime()
      : 0;

    if (existingUpdatedAt > incomingUpdatedAt) {
      try {
        progress?.({
          skippedItem: {
            collection: collection.collectionName || null,
            reason: "older_duplicate_number",
            label: getArchivePayloadLabel(payload),
            message: `Skipped ${getArchivePayloadLabel(payload)} — a more recently updated document already occupies this number`,
          },
        });
      } catch (e) {
        /* ignore */
      }
      return true;
    }
  }

  await collection.replaceOne(
    { _id: existingByAlt._id },
    {
      ...payload,
      _archivedAt: new Date().toISOString(),
      _lastSyncedAt: new Date().toISOString(),
    },
    { upsert: true },
  );
  progress?.(buildArchiveProgressMessage(payload, "updated"));
  return true;
}

/**
 * Sync Sanity documents into Mongo using _sanityId as the identity key.
 * New documents are inserted, existing documents with changed content are updated,
 * and unchanged documents are skipped.
 */
export async function insertIfNotExists(
  db: Db,
  collectionName: string,
  docs: any[],
  errors: string[],
  progress?: (message: string | { skippedItem?: any }) => void,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  if (!docs.length) return { inserted: 0, updated: 0, skipped: 0 };

  const collection = db.collection(collectionName);
  const payloads = docs
    .map(buildArchivedDocumentPayload)
    .filter((p) => p._sanityId);
  const skippedNoId = docs.length - payloads.length;
  if (skippedNoId > 0) {
    // console.warn(
    //   `⚠️  Skipping ${skippedNoId} documents without valid Sanity IDs in ${collectionName}`,
    // );
    try {
      progress?.({
        skippedItem: {
          collection: collectionName,
          reason: "no_sanity_id",
          count: skippedNoId,
          message: `Skipped ${skippedNoId} documents without valid Sanity IDs in ${collectionName}`,
        },
      });
    } catch (e) {
      /* ignore progress callback errors */
    }
  }

  if (!payloads.length) return { inserted: 0, updated: 0, skipped: skippedNoId };

  const sanityIds = payloads
    .map((payload) => payload._sanityId)
    .filter(Boolean);

  const existingDocs = await collection
    .find({ _sanityId: { $in: sanityIds } })
    .toArray();
  const existingById = new Map(
    existingDocs.map((doc: any) => [doc._sanityId, doc]),
  );

  const operations: any[] = [];
  const progressMessages: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const payload of payloads) {
    const existing = existingById.get(payload._sanityId);
    const archivedAt = new Date().toISOString();
    const isUpdate = Boolean(existing);

    if (!existing) {
      operations.push({
        insertOne: {
          document: {
            ...payload,
            _archivedAt: archivedAt,
          },
        },
      });
      progressMessages.push(buildArchiveProgressMessage(payload, "inserted"));
      inserted += 1;
      continue;
    }

    const existingComparable = { ...existing };
    const payloadComparable = { ...payload };
    delete (existingComparable as any)._id;
    delete (existingComparable as any)._archivedAt;
    delete (existingComparable as any)._lastSyncedAt;
    delete (existingComparable as any)._sanityUpdatedAt;
    delete (payloadComparable as any)._archivedAt;
    delete (payloadComparable as any)._lastSyncedAt;
    delete (payloadComparable as any)._sanityUpdatedAt;

    if (
      stableSerialize(existingComparable) === stableSerialize(payloadComparable)
    ) {
      // Record structured skipped item (unchanged)
      try {
        progress?.({
          skippedItem: {
            collection: collectionName,
            _sanityId: payload._sanityId,
            label: getArchivePayloadLabel(payload),
            reason: "unchanged",
            message: buildArchiveProgressMessage(payload, "skipped"),
          },
        });
      } catch (e) {
        /* ignore */
      }
      skipped += 1;
      continue;
    }

    operations.push({
      replaceOne: {
        filter: { _sanityId: payload._sanityId },
        replacement: {
          ...payload,
          _archivedAt: archivedAt,
          _lastSyncedAt: new Date().toISOString(),
        },
        upsert: true,
      },
    });
    progressMessages.push(buildArchiveProgressMessage(payload, "updated"));
    updated += 1;
  }

  if (operations.length) {
    try {
      await withRetry(() =>
        collection.bulkWrite(operations, { ordered: false }),
      );
      progressMessages.forEach((message) => progress?.(message));
    } catch (err: any) {
      // Log full detail before falling back — a BulkWriteError carries a
      // per-operation `.writeErrors` array (each with its own index/errmsg)
      // that was previously discarded entirely in favor of one generic
      // message, making it impossible to tell which document(s) actually
      // caused the failure.
      console.error(
        `❌ Bulk write failed for ${collectionName} (${operations.length} ops):`,
        err?.message || err,
      );
      if (Array.isArray(err?.writeErrors) && err.writeErrors.length) {
        console.error(
          `   ${err.writeErrors.length} individual write error(s):`,
          err.writeErrors.map((we: any) => ({
            index: we.index,
            code: we.code,
            errmsg: we.errmsg,
          })),
        );
      }
      // NOTE: this used to unconditionally `errors.push(...)` right here,
      // before even attempting the per-document fallback below. Every
      // consumer of these errors keys the whole run's success/failure off
      // errors.length (see runArchive()/route.ts), so a bulk write hitting
      // a transient conflict — e.g. a duplicate-key collision on one
      // document — flipped the ENTIRE run to "failed" even when the
      // fallback loop went on to recover every single document without
      // any actual data loss. Only record a real error below if the
      // fallback itself couldn't recover something.

      // Fallback to single-document writes for robustness.
      inserted = 0;
      updated = 0;
      skipped = 0;
      let failedDocs = 0;

      for (const doc of docs) {
        // Each document gets its OWN try/catch: a genuine (non-duplicate-key)
        // failure on one document must NOT abort the remaining documents in
        // this batch. Previously a single `throw err` here propagated out of
        // the whole `for` loop, so every document after the failing one was
        // silently never attempted — with only the one failing document's
        // error ever surfacing, and no indication anything else was skipped.
        try {
          const payload = buildArchivedDocumentPayload(doc);
          const existing = await collection.findOne({
            _sanityId: payload._sanityId,
          });

          if (!existing) {
            try {
              await collection.insertOne({
                ...payload,
                _archivedAt: new Date().toISOString(),
              });
              inserted += 1;
              progress?.(buildArchiveProgressMessage(payload, "inserted"));
              continue;
            } catch (insertErr: any) {
              if (
                isDuplicateKeyError(insertErr) &&
                (await resolveDuplicateKeyConflict(
                  collection,
                  payload,
                  progress,
                ))
              ) {
                updated += 1;
                continue;
              }
              throw insertErr;
            }
          }

          const existingComparable = { ...existing };
          const payloadComparable = { ...payload };
          delete (existingComparable as any)._id;
          delete (existingComparable as any)._archivedAt;
          delete (existingComparable as any)._lastSyncedAt;
          delete (existingComparable as any)._sanityUpdatedAt;
          delete (payloadComparable as any)._archivedAt;
          delete (payloadComparable as any)._lastSyncedAt;
          delete (payloadComparable as any)._sanityUpdatedAt;

          if (
            stableSerialize(existingComparable) ===
            stableSerialize(payloadComparable)
          ) {
            // record structured skipped item (unchanged)
            try {
              progress?.({
                skippedItem: {
                  collection: collectionName,
                  _sanityId: payload._sanityId,
                  label: getArchivePayloadLabel(payload),
                  reason: "unchanged",
                  message: buildArchiveProgressMessage(payload, "skipped"),
                },
              });
            } catch (progressErr) {
              // console.warn(
              //   "Progress callback threw while reporting a skipped item (non-fatal):",
              //   progressErr,
              // );
            }
            skipped += 1;
            continue;
          }

          try {
            await collection.replaceOne(
              { _sanityId: payload._sanityId },
              {
                ...payload,
                _archivedAt: new Date().toISOString(),
                _lastSyncedAt: new Date().toISOString(),
              },
              { upsert: true },
            );
            updated += 1;
            progress?.(buildArchiveProgressMessage(payload, "updated"));
          } catch (replaceErr: any) {
            if (
              isDuplicateKeyError(replaceErr) &&
              (await resolveDuplicateKeyConflict(
                collection,
                payload,
                progress,
              ))
            ) {
              updated += 1;
              continue;
            }
            throw replaceErr;
          }
        } catch (docErr: any) {
          // This document genuinely failed and was NOT recovered above.
          // Log it in full and record it, then move on to the next
          // document — do not let one bad document silently swallow the
          // rest of the batch.
          failedDocs += 1;
          const identifier =
            doc?._id || doc?._sanityId || getArchivePayloadLabel(doc) || "unknown";
          console.error(
            `❌ Failed to archive document ${identifier} in ${collectionName}:`,
            docErr,
          );
          errors.push(
            `Failed to archive ${collectionName} document ${identifier}: ${docErr?.message || docErr}`,
          );
        }
      }

      if (failedDocs > 0) {
        console.error(
          `❌ ${failedDocs}/${docs.length} document(s) in ${collectionName} failed to archive even after per-document fallback — see errors above and in the run's errors list.`,
        );
      } else {
        console.warn(
          `⚠️ Bulk write for ${collectionName} hit a conflict but all ${docs.length} document(s) were recovered via per-document fallback — not treating this run as failed.`,
        );
      }
    }
  } else {
    progressMessages.forEach((message) => progress?.(message));
  }

  return { inserted, updated, skipped };
}

// ─── Sequence Counter Management ──────────────────────────────────────────────

async function updateSequenceCounter(
  db: Db,
  type: string,
  prefix: string,
  numbers: string[],
): Promise<void> {
  let maxSeen = 0;
  for (const num of numbers) {
    if (num && num.startsWith(prefix + "-")) {
      const n = parseInt(num.split("-")[1], 10);
      if (!isNaN(n) && n > maxSeen) maxSeen = n;
    }
  }
  if (maxSeen === 0) return;

  await db.collection(COLLECTIONS.SEQUENCE_COUNTERS).updateOne(
    { type },
    {
      $max: { maxSeen },
      $set: { prefix, updatedAt: new Date().toISOString() },
    },
    { upsert: true },
  );
}

export async function getMaxSequenceNumber(type: string): Promise<number> {
  const db = await getArchiveDb();
  const doc = await db
    .collection(COLLECTIONS.SEQUENCE_COUNTERS)
    .findOne({ type });
  return doc?.maxSeen || 0;
}

// ─── Stock Baseline Snapshot ───────────────────────────────────────────────────

async function captureStockBaseline(db: Db): Promise<void> {
  try {
    const registry = await sanityClient.fetch(
      groq`*[_type == "stockRegistry"][0]{ stockData, lastUpdated }`,
    );
    if (!registry?.stockData) {
      // console.log("⚠️  No stockRegistry found — skipping baseline capture");
      return;
    }

    await db.collection(COLLECTIONS.STOCK_BASELINES).insertOne({
      capturedAt: new Date().toISOString(),
      cutoffDate: getArchiveCutoffDate(),
      stockData: registry.stockData,
      lastRegistryUpdate: registry.lastUpdated,
    });

    // console.log("📸 Stock baseline captured before archival");
  } catch (err) {
    console.error("❌ Failed to capture stock baseline:", err);
    // Non-fatal — archival continues
  }
}

// ─── Sanity Asset Deletion ─────────────────────────────────────────────────────

async function deleteSanityAsset(assetId: string): Promise<void> {
  try {
    await writeClient.delete(assetId);
    // console.log(`🗑️  Deleted Sanity asset: ${assetId}`);
  } catch (err: any) {
    // 404 is fine — asset already gone
    if (err?.statusCode !== 404) {
      console.error(
        `❌ Failed to delete Sanity asset ${assetId}:`,
        err?.message,
      );
    }
  }
}

// ─── Batched Per-type Archive Engine ───────────────────────────────────────────
//
// Every archive step (DispatchLogs, PurchaseOrders, ...) used to run a single
// unbounded `sanityClient.fetch(...)` that pulled in EVERY matching document
// at once, then wrote them all in one go. On a large backlog (e.g. the first
// real run, or after archiving was broken for a while) that single fetch+write
// can itself take longer than the whole function's time budget — and because
// there's nothing checkpointing progress *inside* a step, if Vercel kills the
// function mid-step, nothing gets persisted: no history record, no partial
// progress, nothing. That's exactly what produced the silent-looking
// "504 after 300s, and the run never showed up" behavior.
//
// This engine fixes that by processing each type in small batches (default
// 200 docs) and checking the remaining time budget BEFORE every batch, not
// just between whole steps. If time is running low, it stops cleanly and
// reports exactly how far it got (as a Sanity `_id` cursor) so the next
// invocation resumes from that exact point instead of re-scanning everything
// from scratch.
//
// Pagination uses a `_id > $lastId` cursor (keyset pagination), not a numeric
// offset. This matters: an offset shifts if new eligible documents appear
// between invocations, which can silently skip or double-process rows near
// the boundary. A cursor on `_id` doesn't have that problem — anything with a
// smaller `_id` than the cursor is simply never fetched again, and anything
// newly eligible with a larger `_id` is naturally picked up in a later batch.
// Even in the rare case a document's ordering shifts oddly, `insertIfNotExists`
// is idempotent (it upserts by `_sanityId` and skips unchanged documents), so
// nothing is lost — at worst a document is picked up on the next day's run,
// which is immaterial for data that's already 90+ days old.

const DEFAULT_ARCHIVE_BATCH_SIZE = parseInt(
  process.env.ARCHIVE_BATCH_SIZE || "200",
  10,
);
// Before starting a new batch, require at least this much time left. Combined
// with the adaptive check below (based on how long the last batch actually
// took), this keeps every batch comfortably inside the remaining budget
// instead of relying on a single fixed guess.
const MIN_BATCH_TIME_BUFFER_MS = 8000;

interface BatchedStepResult extends ArchiveStepResult {
  done: boolean;
  resumeCursor: string | null;
}

async function archiveTypeBatched(options: {
  db: Db;
  name: string;
  // Raw GROQ filter body, e.g. `_type == "DispatchLog" && dispatchDate < $cutoff && !(evidenceStatus in ["pending","partial"])`
  filter: string;
  // Raw GROQ projection body (without the surrounding `{ }`)
  projection: string;
  cutoff: string;
  collectionName: string;
  errors: string[];
  // Optional sequence-counter bookkeeping (dispatchNumber/poNumber/etc.)
  numberField?: string;
  sequenceType?: string;
  sequencePrefix?: string;
  resumeCursor: string | null;
  checkTimeBudget: (lastBatchDurationMs: number) => boolean;
  batchSize?: number;
}): Promise<BatchedStepResult> {
  const batchSize = options.batchSize || DEFAULT_ARCHIVE_BATCH_SIZE;
  let cursor = options.resumeCursor || null;
  let totalCount = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  // Mirrors what actually landed in options.errors (the run-level shared
  // array — insertIfNotExists must keep writing into THAT one, same as
  // before batching, so a document-level failure still flips the whole
  // run's success/failure status). This local copy is just so the
  // ArchiveStepResult we return also reports its own errors, instead of
  // always coming back empty like the pre-batching version did.
  const stepErrors: string[] = [];
  let lastBatchDurationMs = 0;

  while (true) {
    if (options.checkTimeBudget(lastBatchDurationMs)) {
      return {
        name: options.name,
        count: totalCount,
        deletedCount: 0,
        status: "partial",
        errors: stepErrors,
        warnings: [],
        assetsDeleted: 0,
        inserted: totalInserted,
        updated: totalUpdated,
        skipped: totalSkipped,
        message: `Paused mid-step after ${totalCount} document(s) (time budget reached)`,
        done: false,
        resumeCursor: cursor,
      };
    }

    const batchStartedMs = Date.now();
    const idFilter = cursor ? ` && _id > $lastId` : "";
    const query = `*[${options.filter}${idFilter}] | order(_id asc) [0...$batchSize] { ${options.projection} }`;

    const batch = await withRetry(() =>
      sanityClient.fetch(query, {
        cutoff: options.cutoff,
        lastId: cursor || "",
        batchSize,
      }),
    );

    if (!batch.length) break; // no more matching documents — step complete

    if (options.numberField && options.sequenceType && options.sequencePrefix) {
      const numbers = batch.map((d: any) => d[options.numberField!]);
      await updateSequenceCounter(
        options.db,
        options.sequenceType,
        options.sequencePrefix,
        numbers,
      );
    }

    const toInsert = batch.map((d: any) => ({
      ...sanitizeForMongo(d),
      _sanityId: d._id,
      _isArchived: true,
      _archivedAt: new Date().toISOString(),
      // sanitizeForMongo() strips the raw _updatedAt (deliberately excluded
      // from content-equality comparisons — see insertIfNotExists). Carried
      // through under a different name so a genuine duplicate business
      // number (two different Sanity documents, not a resumed re-fetch of
      // the same one) can be resolved by keeping whichever is actually the
      // more recently edited Sanity document, not just whichever happens to
      // be processed later.
      _sanityUpdatedAt: d._updatedAt || d._createdAt || null,
    }));

    const errorsBefore = options.errors.length;
    const { inserted, updated, skipped } = await insertIfNotExists(
      options.db,
      options.collectionName,
      toInsert,
      options.errors,
      appendProgress,
    );
    // Mirror anything insertIfNotExists just pushed into the shared
    // run-level errors array so this step's own result reflects it too.
    stepErrors.push(...options.errors.slice(errorsBefore));

    totalCount += batch.length;
    totalInserted += inserted;
    totalUpdated += updated;
    totalSkipped += skipped;
    cursor = batch[batch.length - 1]._id;
    lastBatchDurationMs = Date.now() - batchStartedMs;

    if (batch.length < batchSize) break; // last (partial) page — done
  }

  // console.log(`✅ Synced ${totalCount} ${options.name}`);
  return {
    name: options.name,
    count: totalCount,
    deletedCount: 0,
    status: stepErrors.length ? "partial" : "success",
    errors: stepErrors,
    warnings: [],
    assetsDeleted: 0,
    inserted: totalInserted,
    updated: totalUpdated,
    skipped: totalSkipped,
    message: totalCount ? undefined : `No ${options.name} to archive`,
    done: true,
    resumeCursor: cursor,
  };
}

// ─── Per-type Archive Functions ────────────────────────────────────────────────

async function archiveDispatchLogs(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "DispatchLogs",
    // Status filter deliberately removed — every DispatchLog older than
    // cutoff is archived, drafts/pending-evidence included. Since
    // insertIfNotExists() always re-reads and replaceOne's on content
    // change, a record that later gets finalized will simply overwrite its
    // Mongo copy on the next run rather than being missed.
    filter: `_type == "DispatchLog" && dispatchDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, dispatchNumber, dispatchDate, evidenceStatus, status,
            peopleFed, totalCost, costPerPerson, sellingPrice, totalSales, notes,
            "dispatchType": dispatchType->{_id, name, description, defaultTime, sellingPrice},
            "sourceSite": sourceSite->{_id, name, location, code},
            "dispatchedBy": dispatchedBy->{_id, name, email, role},
            "dispatchedItems": dispatchedItems[]{
                _key, dispatchedQuantity, unitPrice, totalCost, notes,
                "sourceBin": sourceBin->{_id, name, "site": site->{_id, name}},
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure, "category": category->{_id, title}}
            },
            "attachments": attachments[]->{_id, fileName, fileType, description, uploadedAt,
                "file": file{"asset": asset->{_id, url, originalFilename, mimeType}}}
    `,
    cutoff,
    collectionName: COLLECTIONS.DISPATCH_LOGS,
    errors,
    numberField: "dispatchNumber",
    sequenceType: "DispatchLog",
    sequencePrefix: "DL",
    resumeCursor,
    checkTimeBudget,
  });
}

async function archivePurchaseOrders(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "PurchaseOrders",
    // Status filter deliberately removed — see DispatchLogs above.
    filter: `_type == "PurchaseOrder" && orderDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, poNumber, orderDate, status, totalAmount, notes,
            evidenceStatus, approvedAt,
            "site": site->{_id, name, location},
            "orderedBy": orderedBy->{_id, name, email},
            "approvedBy": approvedBy->{_id, name, email},
            "orderedItems": orderedItems[]{
                _key, orderedQuantity, unitPrice, totalPrice, priceManuallyUpdated,
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure},
                "supplier": supplier->{_id, name, contactPerson, phoneNumber, email}
            },
            "attachments": attachments[]->{_id, fileName, fileType, description, uploadedAt,
                "file": file{"asset": asset->{_id, url, originalFilename, mimeType}}}
    `,
    cutoff,
    collectionName: COLLECTIONS.PURCHASE_ORDERS,
    errors,
    numberField: "poNumber",
    sequenceType: "PurchaseOrder",
    sequencePrefix: "PO",
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveGoodsReceipts(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "GoodsReceipts",
    // Status filter deliberately removed — see DispatchLogs above.
    filter: `_type == "GoodsReceipt" && receiptDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, receiptNumber, receiptDate, status, evidenceStatus, notes,
            completedAt,
            "purchaseOrder": purchaseOrder->{
                _id, poNumber, status, orderDate, totalAmount,
                "site": site->{_id, name, location},
                "orderedItems": orderedItems[]{
                    _key, orderedQuantity, unitPrice,
                    "stockItem": stockItem->{_id, name, sku},
                    "supplier": supplier->{_id, name}
                }
            },
            "receivedBy": receivedBy->{_id, name, email},
            "receivedItems": receivedItems[]{
                _key, orderedQuantity, receivedQuantity, batchNumber, expiryDate, condition,
                unitPrice, totalPrice,
                "receivingBin": receivingBin->{_id, name, binType, "site": site->{_id, name}},
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure, "category": category->{_id, title}}
            },
            "attachments": attachments[]->{_id, fileName, fileType, description, uploadedAt,
                "file": file{"asset": asset->{_id, url, originalFilename, mimeType}}}
    `,
    cutoff,
    collectionName: COLLECTIONS.GOODS_RECEIPTS,
    errors,
    numberField: "receiptNumber",
    sequenceType: "GoodsReceipt",
    sequencePrefix: "GR",
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveInternalTransfers(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "InternalTransfers",
    // Status filter deliberately removed — see DispatchLogs above.
    filter: `_type == "InternalTransfer" && transferDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, transferNumber, transferDate, status, notes,
            approvedAt,
            "fromBin": fromBin->{_id, name, "site": site->{_id, name}},
            "toBin": toBin->{_id, name, "site": site->{_id, name}},
            "transferredBy": transferredBy->{_id, name, email},
            "approvedBy": approvedBy->{_id, name, email},
            "transferredItems": transferredItems[]{
                _key, transferredQuantity,
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure}
            }
    `,
    cutoff,
    collectionName: COLLECTIONS.INTERNAL_TRANSFERS,
    errors,
    numberField: "transferNumber",
    sequenceType: "InternalTransfer",
    sequencePrefix: "TRF",
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveStockAdjustments(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "StockAdjustments",
    // Status filter deliberately removed — see DispatchLogs above.
    filter: `_type == "StockAdjustment" && adjustmentDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, adjustmentNumber, adjustmentDate, adjustmentType,
            status, evidenceStatus, notes,
            "adjustedBy": adjustedBy->{_id, name, email},
            "bin": bin->{_id, name, "site": site->{_id, name}},
            "adjustedItems": adjustedItems[]{
                _key, adjustedQuantity, reason,
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure}
            },
            "attachments": attachments[]->{_id, fileName, fileType, description, uploadedAt,
                "file": file{"asset": asset->{_id, url, originalFilename, mimeType}}}
    `,
    cutoff,
    collectionName: COLLECTIONS.STOCK_ADJUSTMENTS,
    errors,
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveInventoryCounts(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "InventoryCounts",
    // Status filter deliberately removed — see DispatchLogs above.
    filter: `_type == "InventoryCount" && countDate < $cutoff`,
    projection: `
            _id, _type, _createdAt, _updatedAt, countNumber, countDate, status, notes,
            "countedBy": countedBy->{_id, name, email},
            "bin": bin->{_id, name, "site": site->{_id, name}},
            "countedItems": countedItems[]{
                _key, countedQuantity, systemQuantityAtCountTime, variance,
                "stockItem": stockItem->{_id, name, sku, unitOfMeasure}
            }
    `,
    cutoff,
    collectionName: COLLECTIONS.INVENTORY_COUNTS,
    errors,
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveFileAttachments(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "FileAttachments",
    filter: `_type == "FileAttachment" && uploadedAt < $cutoff`,
    projection: `
            _id, _type, _createdAt, fileName, fileType, uploadedAt, description, isArchived,
            "uploadedBy": uploadedBy->{_id, name, email},
            "relatedTo": relatedTo->{_id, _type},
            "file": file{"asset": asset->{_id, _type, url, originalFilename, mimeType, size}}
    `,
    cutoff,
    collectionName: COLLECTIONS.FILE_ATTACHMENTS,
    errors,
    resumeCursor,
    checkTimeBudget,
  });
}

async function archiveStockSnapshots(
  db: Db,
  cutoff: string,
  errors: string[],
  resumeCursor: string | null,
  checkTimeBudget: (lastBatchDurationMs: number) => boolean,
): Promise<BatchedStepResult> {
  return archiveTypeBatched({
    db,
    name: "StockSnapshots",
    filter: `_type == "stockSnapshot" && _createdAt < $cutoff`,
    projection: `
            _id, _type, _createdAt, quantity, lastUpdated,
            "stockItem": stockItem->{_id, name, sku},
            "bin": bin->{_id, name, "site": site->{_id, name}}
    `,
    cutoff,
    collectionName: COLLECTIONS.STOCK_SNAPSHOTS,
    errors,
    resumeCursor,
    checkTimeBudget,
  });
}

// ─── Index Creation ────────────────────────────────────────────────────────────

// Each index is its own [collection, spec, options] tuple, created
// independently. Previously all ~20 createIndex calls ran in one try block
// where the FIRST failure silently aborted every index after it, and the
// single catch discarded the real error entirely, logging only "likely
// already exist" — which is frequently false (auth issues, conflicting
// index options, bad field paths, timeouts all land here too) and gave no
// way to tell which index, or how many, actually failed.
async function ensureIndexes(
  db: Db,
): Promise<{ created: number; failed: { spec: string; error: string }[] }> {
  const indexSpecs: {
    collection: string;
    spec: Record<string, 1 | -1>;
    options?: Record<string, any>;
  }[] = [
    { collection: COLLECTIONS.DISPATCH_LOGS, spec: { dispatchDate: -1 } },
    {
      collection: COLLECTIONS.DISPATCH_LOGS,
      spec: { dispatchNumber: 1 },
      options: { unique: true, sparse: true },
    },
    { collection: COLLECTIONS.DISPATCH_LOGS, spec: { "sourceSite._id": 1 } },
    {
      collection: COLLECTIONS.DISPATCH_LOGS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.PURCHASE_ORDERS, spec: { orderDate: -1 } },
    {
      collection: COLLECTIONS.PURCHASE_ORDERS,
      spec: { poNumber: 1 },
      options: { unique: true, sparse: true },
    },
    { collection: COLLECTIONS.PURCHASE_ORDERS, spec: { "site._id": 1 } },
    {
      collection: COLLECTIONS.PURCHASE_ORDERS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.GOODS_RECEIPTS, spec: { receiptDate: -1 } },
    {
      collection: COLLECTIONS.GOODS_RECEIPTS,
      spec: { receiptNumber: 1 },
      options: { unique: true, sparse: true },
    },
    {
      collection: COLLECTIONS.GOODS_RECEIPTS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.INTERNAL_TRANSFERS, spec: { transferDate: -1 } },
    {
      collection: COLLECTIONS.INTERNAL_TRANSFERS,
      spec: { transferNumber: 1 },
      options: { unique: true, sparse: true },
    },
    {
      collection: COLLECTIONS.INTERNAL_TRANSFERS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.STOCK_ADJUSTMENTS, spec: { adjustmentDate: -1 } },
    {
      collection: COLLECTIONS.STOCK_ADJUSTMENTS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.INVENTORY_COUNTS, spec: { countDate: -1 } },
    {
      collection: COLLECTIONS.INVENTORY_COUNTS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.FILE_ATTACHMENTS, spec: { uploadedAt: -1 } },
    {
      collection: COLLECTIONS.FILE_ATTACHMENTS,
      spec: { _sanityId: 1 },
      options: { unique: true },
    },

    { collection: COLLECTIONS.ARCHIVE_RUNS, spec: { startedAt: -1 } },
    {
      collection: COLLECTIONS.SEQUENCE_COUNTERS,
      spec: { type: 1 },
      options: { unique: true },
    },
    { collection: COLLECTIONS.STOCK_BASELINES, spec: { capturedAt: -1 } },
  ];

  let created = 0;
  const failed: { spec: string; error: string }[] = [];

  for (const { collection, spec, options } of indexSpecs) {
    const label = `${collection}.createIndex(${JSON.stringify(spec)}${
      options ? `, ${JSON.stringify(options)}` : ""
    })`;
    try {
      await db.collection(collection).createIndex(spec, options as any);
      created += 1;
    } catch (err: any) {
      const message = err?.message || String(err);
      // A genuine "index already exists with the same spec" is fine and
      // expected on every run after the first — don't log that as a
      // problem. Anything else (conflicting options, bad field path, auth,
      // timeout) is a real failure and gets logged in full, individually,
      // without blocking the remaining indexes.
      const isBenignExisting = /already exists/i.test(message);
      if (!isBenignExisting) {
        console.error(`❌ Failed to create index ${label}:`, err);
        failed.push({ spec: label, error: message });
      }
    }
  }

  if (failed.length) {
    console.error(
      `❌ ${failed.length}/${indexSpecs.length} archive indexes failed to create — see errors above.`,
    );
  } else {
    // console.log(`📋 MongoDB indexes ensured (${created}/${indexSpecs.length})`);
  }

  return { created, failed };
}

export async function cleanupOldArchiveMetadata(): Promise<{
  deletedRuns: number;
  deletedBaselines: number;
  cutoff: string;
}> {
  const db = await getArchiveDb();
  const cutoff = getCutoffDate();

  const deletedRunsResult = await db
    .collection(COLLECTIONS.ARCHIVE_RUNS)
    .deleteMany({ startedAt: { $lt: cutoff } });

  const deletedBaselinesResult = await db
    .collection(COLLECTIONS.STOCK_BASELINES)
    .deleteMany({ capturedAt: { $lt: cutoff } });

  return {
    deletedRuns: deletedRunsResult.deletedCount || 0,
    deletedBaselines: deletedBaselinesResult.deletedCount || 0,
    cutoff,
  };
}

// ─── Batched Sanity Cleanup Engine ─────────────────────────────────────────────
//
// This had the exact same exposure as the archive step functions: it looped
// over every already-archived, cutoff-eligible document across 8 collections
// and deleted each one from Sanity, synchronously, in the request handler,
// with no batching and no checkpoint. A large backlog (very plausible right
// after the archive itself had been silently failing) could blow past
// Vercel's function timeout with nothing recorded — no partial count, no
// history, nothing. It was also never called via `after()`, so even a
// moderate-length run risked the browser/client just seeing a hung request.
//
// It also had a smaller but real bug: the query that finds "documents due
// for cleanup" never excluded documents that were already cleaned up in a
// previous pass (no `_sanityDeletedAt` exclusion). That meant every cleanup
// run re-scanned and re-attempted deletion of every document ever cleaned,
// not just the new backlog — the candidate set only ever grew, making each
// run slower over time and more likely to time out as the archive matures.
// Fixed below.

const DEFAULT_CLEANUP_BATCH_SIZE = parseInt(
  process.env.ARCHIVE_CLEANUP_BATCH_SIZE || "100",
  10,
);

export interface CleanupRunResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  deletedSanityDocuments: number;
  scanned: number;
  collectionsProcessed: number;
  totalCollections: number;
  cutoff: string;
  errors: string[];
  incomplete: boolean;
  completedCollections: string[];
  // Mongo `_id` (as a string) of the last document successfully processed
  // in each not-yet-finished collection, so a resumed run can pick up
  // exactly there instead of re-scanning from the start of that collection.
  collectionCursors: Record<string, string | null>;
}

const CLEANUP_COLLECTIONS_TO_PROCESS = [
  { collectionName: COLLECTIONS.DISPATCH_LOGS, sanityType: "DispatchLog" },
  { collectionName: COLLECTIONS.PURCHASE_ORDERS, sanityType: "PurchaseOrder" },
  { collectionName: COLLECTIONS.GOODS_RECEIPTS, sanityType: "GoodsReceipt" },
  {
    collectionName: COLLECTIONS.INTERNAL_TRANSFERS,
    sanityType: "InternalTransfer",
  },
  {
    collectionName: COLLECTIONS.STOCK_ADJUSTMENTS,
    sanityType: "StockAdjustment",
  },
  {
    collectionName: COLLECTIONS.INVENTORY_COUNTS,
    sanityType: "InventoryCount",
  },
  { collectionName: COLLECTIONS.FILE_ATTACHMENTS, sanityType: "FileAttachment" },
  { collectionName: COLLECTIONS.STOCK_SNAPSHOTS, sanityType: "stockSnapshot" },
];

// Safety gate for permanent Sanity deletion: a document is only eligible
// once its own workflow `status` shows it's actually finished (completed /
// adjusted) or explicitly cancelled — never while it's still draft,
// pending-approval, in-progress, or otherwise unresolved. This is checked
// against the ARCHIVED MONGO COPY's `status` field (populated by each
// step's projection above), not a fresh Sanity read — which is exactly why
// the delete flow triggers a fresh archive run first (see handleRunArchive
// in the admin UI): that guarantees the Mongo copy reflects Sanity's
// current status before this filter is applied.
// FileAttachments/StockSnapshots have no such field — they're not
// workflow records, so they aren't gated here.
const DELETE_SAFE_STATUS: Partial<
  Record<string, { field: string; safeValues: string[] }>
> = {
  [COLLECTIONS.DISPATCH_LOGS]: { field: "status", safeValues: ["completed", "cancelled"] },
  [COLLECTIONS.PURCHASE_ORDERS]: { field: "status", safeValues: ["complete", "cancelled"] },
  [COLLECTIONS.GOODS_RECEIPTS]: { field: "status", safeValues: ["completed", "cancelled"] },
  [COLLECTIONS.INTERNAL_TRANSFERS]: { field: "status", safeValues: ["completed", "cancelled"] },
  [COLLECTIONS.STOCK_ADJUSTMENTS]: { field: "status", safeValues: ["completed", "cancelled"] },
  [COLLECTIONS.INVENTORY_COUNTS]: { field: "status", safeValues: ["completed", "adjusted"] },
};

async function cleanupCollectionBatched(options: {
  db: Db;
  collectionName: string;
  cutoffDate: string;
  resumeCursor: string | null;
  checkTimeBudget: (lastBatchDurationMs: number) => boolean;
  errors: string[];
  batchSize?: number;
}): Promise<{
  deletedCount: number;
  scanned: number;
  done: boolean;
  resumeCursor: string | null;
}> {
  const batchSize = options.batchSize || DEFAULT_CLEANUP_BATCH_SIZE;
  let cursor = options.resumeCursor || null;
  let deletedCount = 0;
  let scanned = 0;
  let lastBatchDurationMs = 0;

  while (true) {
    if (options.checkTimeBudget(lastBatchDurationMs)) {
      return { deletedCount, scanned, done: false, resumeCursor: cursor };
    }

    const batchStartedMs = Date.now();
    const query: Record<string, any> = {
      _isArchived: true,
      _archivedAt: { $lt: options.cutoffDate },
      // Skip anything already cleaned up in a previous pass — see comment
      // above the engine header for why this matters.
      _sanityDeletedAt: { $exists: false },
    };
    const safeStatus = DELETE_SAFE_STATUS[options.collectionName];
    if (safeStatus) {
      // Never permanently delete a record that isn't actually finished —
      // draft/pending-approval/in-progress documents are still live
      // business data, not archival backlog.
      query[safeStatus.field] = { $in: safeStatus.safeValues };
    }
    if (cursor) {
      query._id = { $gt: new ObjectId(cursor) };
    }

    let batch: any[];
    try {
      batch = await options.db
        .collection(options.collectionName)
        .find(query)
        .sort({ _id: 1 })
        .limit(batchSize)
        .project({ _sanityId: 1 })
        .toArray();
    } catch (err: any) {
      options.errors.push(
        `Failed to query ${options.collectionName} for cleanup candidates: ${err?.message || err}`,
      );
      // Can't page through this collection at all — stop here rather than
      // spin, but report it as "done" with whatever cursor we already had
      // so the overall cleanup run moves on to the next collection instead
      // of getting stuck retrying a broken query forever.
      return { deletedCount, scanned, done: true, resumeCursor: cursor };
    }

    if (!batch.length) break; // no more candidates — this collection is done

    for (const doc of batch) {
      scanned += 1;
      if (!doc._sanityId) {
        cursor = String(doc._id);
        continue;
      }
      try {
        await withRetry(() => writeClient.delete(doc._sanityId));
        deletedCount += 1;
      } catch (err: any) {
        if (err?.statusCode === 404) {
          deletedCount += 1;
        } else {
          console.error(
            `❌ Failed to delete Sanity document ${doc._sanityId} from ${options.collectionName}:`,
            err,
          );
          options.errors.push(
            `Failed to delete Sanity document ${doc._sanityId} (${options.collectionName}): ${err?.message || err}`,
          );
          cursor = String(doc._id);
          continue;
        }
      }

      try {
        await options.db
          .collection(options.collectionName)
          .updateOne(
            { _sanityId: doc._sanityId },
            { $set: { _sanityDeletedAt: new Date().toISOString() } },
          );
      } catch (err: any) {
        console.error(
          `❌ Deleted Sanity document ${doc._sanityId} but failed to mark it deleted in Mongo (${options.collectionName}):`,
          err,
        );
        options.errors.push(
          `Deleted Sanity document ${doc._sanityId} (${options.collectionName}) but failed to record it in Mongo: ${err?.message || err}`,
        );
      }

      cursor = String(doc._id);
    }

    lastBatchDurationMs = Date.now() - batchStartedMs;
    if (batch.length < batchSize) break; // last (partial) page — done
  }

  return { deletedCount, scanned, done: true, resumeCursor: cursor };
}

export async function cleanupArchivedSanityData(
  providedRunId?: string,
): Promise<CleanupRunResult> {
  const db = await getArchiveDb();
  const cutoff = getCutoffDate();
  const runId = providedRunId || `cleanup-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const maxSeconds = parseInt(process.env.ARCHIVE_MAX_SECONDS || "270", 10);
  const allowedMs = maxSeconds * 1000;
  const progressId = "cleanup-progress";
  const progressCollection = db.collection(COLLECTIONS.ARCHIVE_RUNS);

  // Resuming a specific run: pick up completed-collection list and per-
  // collection cursors from the most recent partial record for this runId.
  const lastRun = providedRunId
    ? await progressCollection.findOne(
        { runId: providedRunId, kind: "cleanup" } as any,
        { sort: { startedAt: -1 } },
      )
    : null;
  const completedCollections = new Set<string>(
    lastRun?.completedCollections || [],
  );
  const collectionCursors: Record<string, string | null> = {
    ...(lastRun?.collectionCursors || {}),
  };

  const errors: string[] = [];
  let deletedSanityDocuments = 0;
  let scanned = 0;

  await progressCollection.updateOne(
    { _id: progressId } as any,
    {
      $set: {
        _id: progressId,
        kind: "cleanup-progress",
        runId,
        status: "running",
        startedAt,
        cutoff,
        completedCollections: Array.from(completedCollections),
        totalCollections: CLEANUP_COLLECTIONS_TO_PROCESS.length,
        lastUpdatedAt: new Date().toISOString(),
      },
    } as any,
    { upsert: true },
  );

  for (const { collectionName } of CLEANUP_COLLECTIONS_TO_PROCESS) {
    if (completedCollections.has(collectionName)) continue;

    const elapsedBeforeCollection = Date.now() - startMs;
    if (elapsedBeforeCollection >= allowedMs - MIN_BATCH_TIME_BUFFER_MS) {
      return await writeIncompleteCleanupPartial({
        progressCollection,
        progressId,
        runId,
        startedAt,
        startMs,
        cutoff,
        deletedSanityDocuments,
        scanned,
        errors,
        completedCollections,
        collectionCursors,
        reason: `Paused before starting cleanup of ${collectionName} — time limit reached`,
      });
    }

    const checkTimeBudget = (lastBatchDurationMs: number): boolean => {
      const remainingMs = allowedMs - (Date.now() - startMs);
      const requiredMs = Math.max(
        MIN_BATCH_TIME_BUFFER_MS,
        lastBatchDurationMs * 1.5,
      );
      return remainingMs <= requiredMs;
    };

    const result = await cleanupCollectionBatched({
      db,
      collectionName,
      cutoffDate: cutoff,
      resumeCursor: collectionCursors[collectionName] ?? null,
      checkTimeBudget,
      errors,
    });

    deletedSanityDocuments += result.deletedCount;
    scanned += result.scanned;

    if (!result.done) {
      collectionCursors[collectionName] = result.resumeCursor;
      return await writeIncompleteCleanupPartial({
        progressCollection,
        progressId,
        runId,
        startedAt,
        startMs,
        cutoff,
        deletedSanityDocuments,
        scanned,
        errors,
        completedCollections,
        collectionCursors,
        reason: `Paused mid-collection during ${collectionName} cleanup — will resume from where it left off`,
      });
    }

    delete collectionCursors[collectionName];
    completedCollections.add(collectionName);

    await progressCollection.updateOne(
      { _id: progressId } as any,
      {
        $set: {
          completedCollections: Array.from(completedCollections),
          lastUpdatedAt: new Date().toISOString(),
        },
      } as any,
    );
  }

  const completedAt = new Date().toISOString();
  const result: CleanupRunResult = {
    runId,
    startedAt,
    completedAt,
    durationMs: Date.now() - startMs,
    deletedSanityDocuments,
    scanned,
    collectionsProcessed: completedCollections.size,
    totalCollections: CLEANUP_COLLECTIONS_TO_PROCESS.length,
    cutoff,
    errors,
    incomplete: false,
    completedCollections: Array.from(completedCollections),
    collectionCursors: {},
  };

  await progressCollection.insertOne({ ...result, kind: "cleanup" } as any);
  await progressCollection.updateOne(
    { _id: progressId } as any,
    {
      $set: {
        status: errors.length ? "failed" : "success",
        completedAt,
        errors,
        lastUpdatedAt: new Date().toISOString(),
      },
    } as any,
  );

  return result;
}

async function writeIncompleteCleanupPartial(options: {
  progressCollection: any;
  progressId: string;
  runId: string;
  startedAt: string;
  startMs: number;
  cutoff: string;
  deletedSanityDocuments: number;
  scanned: number;
  errors: string[];
  completedCollections: Set<string>;
  collectionCursors: Record<string, string | null>;
  reason: string;
}): Promise<CleanupRunResult> {
  const partial: CleanupRunResult = {
    runId: options.runId,
    startedAt: options.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startMs,
    deletedSanityDocuments: options.deletedSanityDocuments,
    scanned: options.scanned,
    collectionsProcessed: options.completedCollections.size,
    totalCollections: CLEANUP_COLLECTIONS_TO_PROCESS.length,
    cutoff: options.cutoff,
    errors: options.errors,
    incomplete: true,
    completedCollections: Array.from(options.completedCollections),
    collectionCursors: options.collectionCursors,
  };

  await options.progressCollection.insertOne({ ...partial, kind: "cleanup" } as any);
  await options.progressCollection.updateOne(
    { _id: options.progressId } as any,
    {
      $set: {
        status: "incomplete",
        completedCollections: partial.completedCollections,
        errors: partial.errors,
        lastUpdatedAt: new Date().toISOString(),
      },
    } as any,
  );
  // console.log(`⚠️ Cleanup run paused — ${options.reason}`);
  return partial;
}

export async function getCleanupProgress(): Promise<{
  inProgress: boolean;
  currentRun: any | null;
  staleDetected?: boolean;
}> {
  const db = await getArchiveDb();
  const progressId = "cleanup-progress";
  const progressCollection = db.collection(COLLECTIONS.ARCHIVE_RUNS);
  const progressDoc = await progressCollection.findOne({
    _id: progressId,
    kind: "cleanup-progress",
  } as any);

  if (!progressDoc) return { inProgress: false, currentRun: null };

  const lastUpdatedAt = progressDoc.lastUpdatedAt || progressDoc.startedAt || null;
  const lastUpdatedTs = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : null;
  const isStale =
    lastUpdatedTs && Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;
  const inProgress = ["running", "incomplete"].includes(progressDoc.status);

  if (inProgress && isStale) {
    await progressCollection.updateOne(
      { _id: progressId } as any,
      {
        $set: {
          status: "failed",
          errors: [
            ...(progressDoc.errors || []),
            "Cleanup progress has been stale for more than 5 minutes and has been marked failed.",
          ],
          lastUpdatedAt: new Date().toISOString(),
        },
      } as any,
    );
    return { inProgress: false, staleDetected: true, currentRun: progressDoc };
  }

  return { inProgress, currentRun: progressDoc };
}

// Mirrors resumeIncompleteArchives() — called from the cron path so an
// interrupted cleanup doesn't just sit forgotten until an admin happens to
// re-trigger it manually.
export async function resumeIncompleteCleanup(
  maxAttempts = 5,
): Promise<{ attempts: number; finished: boolean }> {
  const db = await getArchiveDb();
  let attempts = 0;
  // Same outer time-budget guard as resumeIncompleteArchives(), and for the
  // same reason: cleanupArchivedSanityData() can itself run for close to
  // the full per-invocation budget, so looping unconditionally here could
  // exceed Vercel's hard timeout.
  const outerStartMs = Date.now();
  const outerBudgetMs =
    parseInt(process.env.ARCHIVE_MAX_SECONDS || "270", 10) * 1000;

  while (attempts < maxAttempts) {
    if (
      attempts > 0 &&
      Date.now() - outerStartMs >= outerBudgetMs - MIN_BATCH_TIME_BUFFER_MS
    ) {
      return { attempts, finished: false };
    }

    const incompleteRun = await db
      .collection(COLLECTIONS.ARCHIVE_RUNS)
      .findOne({ incomplete: true, kind: "cleanup" } as any, {
        sort: { startedAt: -1 },
      });

    if (!incompleteRun) return { attempts, finished: true };

    // console.log(`🔁 Resuming incomplete cleanup run (found: ${incompleteRun.runId})`);
    attempts += 1;
    const res = await cleanupArchivedSanityData(incompleteRun.runId);

    if (!res.incomplete) {
      // Clear the incomplete flag on THIS run's own checkpoint doc(s) now
      // that it has finished — matching on runId, not excluding it. The
      // previous `$ne: res.runId` here excluded exactly the docs that
      // needed clearing, so the run's last incomplete checkpoint was never
      // marked done: the next resume attempt (here, the next cron tick, or
      // the admin page's auto-resume) kept finding it and re-running the
      // same already-finished cleanup indefinitely.
      await db.collection(COLLECTIONS.ARCHIVE_RUNS).updateMany(
        { incomplete: true, kind: "cleanup", runId: res.runId } as any,
        { $set: { incomplete: false } } as any,
      );
      const stillIncomplete = await db
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .findOne({ incomplete: true, kind: "cleanup" } as any);
      if (!stillIncomplete) return { attempts, finished: true };
    }
  }

  return { attempts, finished: false };
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function isRetryableError(err: any): boolean {
  if (!err) return false;

  // MongoDB driver-level transient errors. These are exactly the errors
  // seen in production ("MongoServerSelectionError: Server selection timed
  // out after 30000 ms", "connection <monitor> ... closed" with the
  // driver's own 'RetryableError'/'ResetPool' labels) — the driver itself
  // is telling us these are momentary blips, not permanent failures. They
  // typically carry no `.code` string and no HTTP-style `.statusCode`, so
  // the checks below (originally written with Sanity's HTTP API in mind)
  // never matched them, meaning this function silently returned false for
  // the single most common real-world failure this system hits.
  const labels: Set<string> | undefined = err.errorLabelSet;
  if (labels && (labels.has("RetryableError") || labels.has("ResetPool"))) {
    return true;
  }
  const errorName = err.name || "";
  if (
    errorName === "MongoServerSelectionError" ||
    errorName === "MongoNetworkError" ||
    errorName === "MongoNotConnectedError" ||
    errorName === "MongoTopologyClosedError"
  ) {
    return true;
  }
  const errorMessage = err.message || String(err);
  if (
    /server selection timed out/i.test(errorMessage) ||
    /connection.*closed/i.test(errorMessage) ||
    /topology.*closed/i.test(errorMessage) ||
    /pool.*destroyed/i.test(errorMessage)
  ) {
    return true;
  }

  if (typeof err.code === "string") {
    const code = err.code.toLowerCase();
    return [
      "etimedout",
      "econnreset",
      "enotfound",
      "eai_again",
      "sockettimeout",
    ].some((candidate) => code.includes(candidate));
  }
  const statusCode = err.statusCode || err.status;
  return statusCode === 429 || statusCode >= 500;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  delayMs = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt >= attempts || !isRetryableError(err)) break;
      const backoff = delayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

async function updateArchiveProgress(
  progressCollection: any,
  progressId: string,
  updates: Record<string, any>,
  message?: string | { skippedItem?: any },
): Promise<void> {
  const update: any = {
    $set: {
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    },
  };

  // Support either a plain message string or a structured skippedItem object
  if (message) {
    if (typeof message === "string") {
      update.$push = { progressMessages: message };
    } else if (typeof message === "object" && message.skippedItem) {
      update.$push = {
        progressMessages: message.skippedItem.message || "Skipped item",
        skippedItems: message.skippedItem,
      };
    }
  }

  try {
    await progressCollection.updateOne({ _id: progressId } as any, update, {
      upsert: true,
    });
  } catch (err: any) {
    console.error("Failed to update archive progress:", err?.message || err);
  }
}

// Builds the ArchiveRunResult shape shared by the between-step and mid-step
// checkpoint paths, so both write a consistent, complete partial record.
function buildRunResult(options: {
  runId: string;
  startedAt: string;
  startMs: number;
  archived: Record<string, number>;
  errors: string[];
  warnings: string[];
  totalSkipped: number;
  steps: ArchiveStepResult[];
  incomplete: boolean;
  stepCursors: Record<string, string | null>;
}): ArchiveRunResult {
  return {
    runId: options.runId,
    startedAt: options.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startMs,
    archived: options.archived,
    errors: options.errors,
    warnings: options.warnings,
    skipped: options.totalSkipped,
    steps: options.steps,
    assetsDeleted: options.steps.reduce(
      (sum, st) => sum + (st.assetsDeleted || 0),
      0,
    ),
    incomplete: options.incomplete,
    stepCursors: options.stepCursors,
  };
}

// Persists a partial/"incomplete" checkpoint — used both when we're pausing
// between whole steps and when a single step itself ran out of time
// mid-way. Writing this (rather than letting the process just get killed)
// is the whole point: it guarantees every run either finishes or leaves a
// clear, resumable trail, and is never silently lost.
async function writeIncompletePartial(options: {
  db: Db;
  runId: string;
  startedAt: string;
  startMs: number;
  archived: Record<string, number>;
  errors: string[];
  warnings: string[];
  totalSkipped: number;
  steps: ArchiveStepResult[];
  stepFns: { name: string }[];
  stepCursors: Record<string, string | null>;
  progressCollection: any;
  progressId: string;
  pausedStepName: string;
  pausedStepIndex: number;
  reason: string;
}): Promise<void> {
  const partialResult = buildRunResult({
    runId: options.runId,
    startedAt: options.startedAt,
    startMs: options.startMs,
    archived: options.archived,
    errors: options.errors,
    warnings: options.warnings,
    totalSkipped: options.totalSkipped,
    steps: options.steps,
    incomplete: true,
    stepCursors: options.stepCursors,
  });

  await options.db.collection(COLLECTIONS.ARCHIVE_RUNS).insertOne(partialResult);

  const completedStepNames = options.steps
    .filter((s) => s.status === "success")
    .map((s) => s.name);
  await updateArchiveProgress(
    options.progressCollection,
    options.progressId,
    {
      status: "incomplete",
      currentStep: options.pausedStepName,
      currentStepIndex: options.pausedStepIndex,
      completedSteps: completedStepNames,
      pendingSteps: options.stepFns
        .map((s) => s.name)
        .filter((name) => !completedStepNames.includes(name)),
      errors: options.errors,
      progressPercent: Math.min(
        100,
        Math.round((completedStepNames.length / options.stepFns.length) * 100),
      ),
    },
    options.reason,
  );
  // console.log(`⚠️ Archive run paused — ${options.reason}`);
}

export interface ArchiveCurrentRunStatus {
  runId: string;
  status: "queued" | "running" | "failed" | "success" | "incomplete";
  startedAt: string;
  currentStep: string | null;
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: string[];
  pendingSteps: string[];
  errors: string[];
  progressPercent: number;
  lastUpdatedAt: string;
  logs: string[];
  skippedItems?: any[];
}

export const ARCHIVE_PROGRESS_STALE_MS = 5 * 60 * 1000;

async function markStaleArchiveProgressFailed(
  progressCollection: any,
  progressId: string,
  progressDoc: any,
) {
  const staleMessage =
    "Archive progress has been stale for more than 5 minutes and has been marked failed.";
  await progressCollection.updateOne(
    { _id: progressId } as any,
    {
      $set: {
        status: "failed",
        completedAt: new Date().toISOString(),
        currentStep: null,
        currentStepIndex: progressDoc?.currentStepIndex || 0,
        completedSteps: progressDoc?.completedSteps || [],
        pendingSteps: progressDoc?.pendingSteps || [],
        errors: [...(progressDoc?.errors || []), staleMessage],
        progressPercent: progressDoc?.progressPercent || 0,
        lastUpdatedAt: new Date().toISOString(),
      },
      $push: {
        progressMessages: staleMessage,
      },
    } as any,
  );
}

function buildArchiveCurrentRunStatus(
  progressDoc: any,
): ArchiveCurrentRunStatus {
  return {
    runId: progressDoc.owner || progressDoc.runId || "archive-progress",
    status: progressDoc.status || "failed",
    startedAt:
      progressDoc.startedAt ||
      progressDoc.acquiredAt ||
      new Date().toISOString(),
    currentStep: progressDoc.currentStep || null,
    currentStepIndex: progressDoc.currentStepIndex || 0,
    totalSteps: progressDoc.totalSteps || 0,
    completedSteps: progressDoc.completedSteps || [],
    pendingSteps: progressDoc.pendingSteps || [],
    errors: progressDoc.errors || [],
    progressPercent: progressDoc.progressPercent || 0,
    lastUpdatedAt:
      progressDoc.lastUpdatedAt ||
      progressDoc.acquiredAt ||
      progressDoc.startedAt ||
      new Date().toISOString(),
    logs: progressDoc.progressMessages || [],
    skippedItems: progressDoc.skippedItems || [],
  };
}

export async function getArchiveProgress(): Promise<{
  inProgress: boolean;
  currentRun: ArchiveCurrentRunStatus | null;
  staleDetected?: boolean;
}> {
  const db = await getArchiveDb();
  const progressId = "archive-progress";
  const progressCollection = db.collection(COLLECTIONS.ARCHIVE_RUNS);
  const progressDoc = await progressCollection.findOne({
    _id: progressId,
    kind: "progress",
  } as any);

  if (!progressDoc) {
    return { inProgress: false, currentRun: null };
  }

  const lastUpdatedAt =
    progressDoc.lastUpdatedAt || progressDoc.startedAt || null;
  const lastUpdatedTs = lastUpdatedAt
    ? new Date(lastUpdatedAt).getTime()
    : null;
  const isStale =
    lastUpdatedTs && Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;

  const inProgress = ["queued", "running", "incomplete"].includes(
    progressDoc.status,
  );
  if (inProgress && isStale) {
    await markStaleArchiveProgressFailed(
      progressCollection,
      progressId,
      progressDoc,
    );

    const updatedDoc = await progressCollection.findOne({
      _id: progressId,
      kind: "progress",
    } as any);

    return {
      inProgress: false,
      staleDetected: true,
      currentRun: updatedDoc ? buildArchiveCurrentRunStatus(updatedDoc) : null,
    };
  }

  if (!inProgress) {
    return { inProgress: false, currentRun: null };
  }

  return {
    inProgress,
    currentRun: buildArchiveCurrentRunStatus(progressDoc),
  };
}

export async function runArchive(
  providedRunId?: string,
): Promise<ArchiveRunResult> {
  const startedAt = new Date().toISOString();
  const runId = providedRunId || `archive-${Date.now()}`;
  const errors: string[] = [];
  // Non-fatal issues (e.g. stock baseline capture) are tracked separately so
  // they don't flip the whole run's status to "failed" — every consumer of
  // ArchiveRunResult (the run route, backup-safety gate, UI) currently keys
  // success/failure off `errors.length`, so anything pushed there IS treated
  // as fatal regardless of comments claiming otherwise.
  const warnings: string[] = [];

  console.log(`\n🗂️  Starting archive run: ${runId}`);
  console.log(
    `📅 Archive-to-Mongo cutoff: ${getArchiveCutoffDate()} (documents older than ${ARCHIVE_MIN_AGE_DAYS} days)`,
  );

  const db = await getArchiveDb();
  const indexResult = await ensureIndexes(db);
  if (indexResult.failed.length) {
    for (const f of indexResult.failed) {
      warnings.push(`Index creation failed for ${f.spec}: ${f.error}`);
    }
  }

  const progressId = "archive-progress";
  const progressCollection = db.collection(COLLECTIONS.ARCHIVE_RUNS);

  await progressCollection.updateOne(
    { _id: progressId } as any,
    {
      $set: {
        _id: progressId,
        kind: "progress",
        owner: runId,
        status: "running",
        startedAt,
        runId,
        currentStep: null,
        currentStepIndex: 0,
        totalSteps: 0,
        completedSteps: [],
        pendingSteps: [],
        errors: [],
        progressPercent: 0,
        lastUpdatedAt: new Date().toISOString(),
      },
      $push: {
        progressMessages: "Archive run started",
      },
    } as any,
    { upsert: true },
  );

  await updateArchiveProgress(
    progressCollection,
    progressId,
    {
      status: "running",
      runId,
      startedAt,
    },
    "Preparing archive run",
  );

  let steps: ArchiveStepResult[] = [];
  let archived: Record<string, number> = {};
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let startMs = Date.now();
  // Declared here (not inside `try`) so it's still reachable from the
  // `catch` block below — a genuine exception should still preserve
  // whatever per-step resume positions were known at that point.
  let stepCursors: Record<string, string | null> = {};
  let stepFns: {
    key: string;
    name: string;
    fn: (
      db: Db,
      cutoff: string,
      errors: string[],
      resumeCursor: string | null,
      checkTimeBudget: (lastBatchDurationMs: number) => boolean,
    ) => Promise<BatchedStepResult>;
  }[] = [];

  // appendProgress fires once PER DOCUMENT processed (see
  // insertIfNotExists's progressMessages.forEach(...)) — up to hundreds of
  // times per batch. It used to call updateArchiveProgress() directly,
  // unawaited, on every single call: a 200-document batch fired up to 200
  // concurrent, un-throttled writes at the SAME single progress document
  // ($push on an unbounded array), all competing for the driver's
  // maxPoolSize:10 connection pool. That write storm is what actually
  // produced the "Failed to update archive progress: connection N ...
  // timed out" cascades seen in production — not a resource-starved
  // environment, a self-inflicted one. Progress messages are purely
  // informational (the admin UI's live log), not correctness-critical, so
  // they're now buffered in memory and flushed as a single coalesced write
  // at most once per PROGRESS_FLUSH_INTERVAL_MS, with the stored array
  // capped via $slice so a long, multi-thousand-document run can't grow
  // the progress document without bound either.
  const PROGRESS_FLUSH_INTERVAL_MS = 1000;
  const PROGRESS_MAX_STORED_MESSAGES = 200;
  let pendingProgressMessages: string[] = [];
  let pendingSkippedItems: any[] = [];
  let lastProgressFlushMs = 0;
  let progressFlushInFlight: Promise<void> | null = null;

  const flushProgressMessages = async (force = false): Promise<void> => {
    if (!pendingProgressMessages.length && !pendingSkippedItems.length) return;
    if (progressFlushInFlight) return; // a flush is already in-flight; next tick will pick up anything new
    if (!force && Date.now() - lastProgressFlushMs < PROGRESS_FLUSH_INTERVAL_MS) return;

    const messagesToFlush = pendingProgressMessages;
    const skippedToFlush = pendingSkippedItems;
    pendingProgressMessages = [];
    pendingSkippedItems = [];
    lastProgressFlushMs = Date.now();

    const pushOps: Record<string, any> = {};
    if (messagesToFlush.length) {
      pushOps.progressMessages = {
        $each: messagesToFlush,
        $slice: -PROGRESS_MAX_STORED_MESSAGES,
      };
    }
    if (skippedToFlush.length) {
      pushOps.skippedItems = {
        $each: skippedToFlush,
        $slice: -PROGRESS_MAX_STORED_MESSAGES,
      };
    }

    progressFlushInFlight = progressCollection
      .updateOne(
        { _id: progressId } as any,
        {
          $set: { lastUpdatedAt: new Date().toISOString() },
          $push: pushOps,
        } as any,
        { upsert: true },
      )
      .then(() => undefined)
      .catch((err: any) => {
        console.error("Failed to update archive progress:", err?.message || err);
      })
      .finally(() => {
        progressFlushInFlight = null;
      });
    await progressFlushInFlight;
  };

  appendProgress = (message: string | { skippedItem?: any }) => {
    if (typeof message === "string") {
      pendingProgressMessages.push(message);
    } else if (message?.skippedItem) {
      pendingSkippedItems.push(message.skippedItem);
      pendingProgressMessages.push(
        message.skippedItem.message || "Skipped item",
      );
    }
    void flushProgressMessages(false);
  };

  try {
    await captureStockBaseline(db).catch((err: any) => {
      const message = err?.message || String(err);
      console.error("Failed to capture stock baseline:", message);
      warnings.push(`Stock baseline capture failed: ${message}`);
      return Promise.resolve();
    });

    const cutoff = getArchiveCutoffDate();
    const maxSeconds = parseInt(process.env.ARCHIVE_MAX_SECONDS || "270", 10);
    const allowedMs = maxSeconds * 1000;
    startMs = Date.now();

    // Only skip steps that already succeeded within THIS SAME run (i.e. we are
    // resuming a specific incomplete run after a timeout). Must not match any
    // other historical run — otherwise, once a step type succeeds once, it
    // would be skipped in every future run forever, and newly-eligible
    // documents of that type would never get archived again. Must also
    // exclude the "archive-progress" singleton doc, which carries the same
    // runId (it was just stamped a few lines above) but has no `.steps`.
    const lastRun = await db.collection(COLLECTIONS.ARCHIVE_RUNS).findOne(
      { runId, _id: { $ne: progressId } } as any,
      { sort: { startedAt: -1 } },
    );
    const completedSteps = new Set<string>();
    if (lastRun && Array.isArray(lastRun.steps)) {
      for (const s of lastRun.steps) {
        if (s?.status === "success") completedSteps.add(s.name);
      }
    }
    // Per-step resume cursors carried over from a previous partial attempt at
    // THIS SAME runId (e.g. a step that itself got interrupted mid-way, not
    // just a whole step boundary). Mutated as we go so every partial write
    // below (both the between-step and mid-step checkpoints) always persists
    // the latest known position for every step, not just the one currently
    // in flight.
    stepCursors = { ...(lastRun?.stepCursors || {}) };

    stepFns = [
      { key: "dispatchLogs", name: "DispatchLogs", fn: archiveDispatchLogs },
      {
        key: "purchaseOrders",
        name: "PurchaseOrders",
        fn: archivePurchaseOrders,
      },
      { key: "goodsReceipts", name: "GoodsReceipts", fn: archiveGoodsReceipts },
      {
        key: "internalTransfers",
        name: "InternalTransfers",
        fn: archiveInternalTransfers,
      },
      {
        key: "stockAdjustments",
        name: "StockAdjustments",
        fn: archiveStockAdjustments,
      },
      {
        key: "inventoryCounts",
        name: "InventoryCounts",
        fn: archiveInventoryCounts,
      },
      {
        key: "fileAttachments",
        name: "FileAttachments",
        fn: archiveFileAttachments,
      },
      {
        key: "stockSnapshots",
        name: "StockSnapshots",
        fn: archiveStockSnapshots,
      },
    ];

    await updateArchiveProgress(
      progressCollection,
      progressId,
      {
        totalSteps: stepFns.length,
        completedSteps: [],
        pendingSteps: stepFns.map((step) => step.name),
      },
      `Archive has ${stepFns.length} steps`,
    );

    steps = [];
    archived = {};
    totalInserted = 0;
    totalUpdated = 0;
    totalSkipped = 0;

    for (const [index, step] of stepFns.entries()) {
      if (completedSteps.has(step.name)) {
        const skippedStep = createArchiveStepResult({
          name: step.name,
          count: 0,
          deletedCount: 0,
          message: "Already archived in previous successful run",
        });
        skippedStep.status = "success";
        steps.push(skippedStep);
        archived[step.key] = 0;
        continue;
      }

      // Coarse between-step guard (defense in depth) — the fine-grained,
      // mid-step guard inside archiveTypeBatched() is what actually protects
      // against a single oversized step, but this still catches the case
      // where a step is about to start with almost no time left at all.
      const elapsedBeforeStep = Date.now() - startMs;
      if (elapsedBeforeStep >= allowedMs - MIN_BATCH_TIME_BUFFER_MS) {
        await writeIncompletePartial({
          db,
          runId,
          startedAt,
          startMs,
          archived,
          errors,
          warnings,
          totalSkipped,
          steps,
          stepFns,
          stepCursors,
          progressCollection,
          progressId,
          pausedStepName: step.name,
          pausedStepIndex: index + 1,
          reason: `Paused before starting ${step.name} — time limit reached after ${steps.length} completed step(s)`,
        });
        return buildRunResult({
          runId,
          startedAt,
          startMs,
          archived,
          errors,
          warnings,
          totalSkipped,
          steps,
          incomplete: true,
          stepCursors,
        });
      }

      await updateArchiveProgress(
        progressCollection,
        progressId,
        {
          currentStep: step.name,
          currentStepIndex: index + 1,
        },
        `Starting step: ${step.name}`,
      );

      // Adaptive per-batch time budget, passed down into the step so it can
      // checkpoint DURING its own work, not just between whole steps. Stops
      // a batch from starting unless there's comfortably enough time left
      // for one more (using the previous batch's real duration once we have
      // one, or a conservative fixed floor before that).
      const checkTimeBudget = (lastBatchDurationMs: number): boolean => {
        const remainingMs = allowedMs - (Date.now() - startMs);
        const requiredMs = Math.max(
          MIN_BATCH_TIME_BUFFER_MS,
          lastBatchDurationMs * 1.5,
        );
        return remainingMs <= requiredMs;
      };

      const resumeCursorForStep = stepCursors[step.name] ?? null;

      const stepRes = await step
        .fn(db, cutoff, errors, resumeCursorForStep, checkTimeBudget)
        .catch((err: any) => {
          const message = err?.message || String(err);
          errors.push(`${step.name} batch failed: ${message}`);
          return {
            ...createArchiveStepResult({
              name: step.name,
              count: 0,
              deletedCount: 0,
              errors: [message],
              message: "Step failed",
            }),
            done: true,
            resumeCursor: resumeCursorForStep,
          } as BatchedStepResult;
        });

      if (!stepRes.done) {
        // This step itself ran out of time mid-way (not just a step
        // boundary). Persist exactly how far it got — as a Sanity `_id`
        // cursor — so the very next invocation resumes this step from
        // there instead of re-scanning it from the beginning.
        stepCursors[step.name] = stepRes.resumeCursor;
        steps.push(stepRes);
        totalInserted += stepRes.inserted || 0;
        totalUpdated += stepRes.updated || 0;
        totalSkipped += stepRes.skipped || 0;
        archived[step.key] = (archived[step.key] || 0) + (stepRes.count || 0);

        await writeIncompletePartial({
          db,
          runId,
          startedAt,
          startMs,
          archived,
          errors,
          warnings,
          totalSkipped,
          steps,
          stepFns,
          stepCursors,
          progressCollection,
          progressId,
          pausedStepName: step.name,
          pausedStepIndex: index + 1,
          reason: `Paused mid-step during ${step.name} after ${stepRes.count} document(s) — will resume from where it left off`,
        });
        return buildRunResult({
          runId,
          startedAt,
          startMs,
          archived,
          errors,
          warnings,
          totalSkipped,
          steps,
          incomplete: true,
          stepCursors,
        });
      }

      // Step finished fully — clear its cursor so a future re-run of this
      // step (a genuinely new day's archive, not a resume) starts fresh.
      delete stepCursors[step.name];

      steps.push(stepRes);
      totalInserted += stepRes.inserted || 0;
      totalUpdated += stepRes.updated || 0;
      totalSkipped += stepRes.skipped || 0;
      archived[step.key] = stepRes.count || 0;

      const completedStepNames = steps
        .filter((runStep) => runStep.status === "success")
        .map((runStep) => runStep.name);
      const pendingStepNames = stepFns
        .map((s) => s.name)
        .filter((name) => !completedStepNames.includes(name));
      const progressPercent = Math.min(
        100,
        Math.round(((index + 1) / stepFns.length) * 100),
      );

      await updateArchiveProgress(
        progressCollection,
        progressId,
        {
          currentStep: step.name,
          currentStepIndex: index + 1,
          stepStatus: stepRes.status,
          completedSteps: completedStepNames,
          pendingSteps: pendingStepNames,
          errors,
          progressPercent,
        },
        `Finished step: ${step.name} — archived ${stepRes.count}, inserted ${stepRes.inserted || 0}, updated ${stepRes.updated || 0}, skipped ${stepRes.skipped || 0}`,
      );
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const totalArchived = Object.values(archived).reduce(
      (sum, value) => sum + value,
      0,
    );

    const result: ArchiveRunResult = {
      runId,
      startedAt,
      completedAt,
      durationMs,
      archived,
      errors,
      warnings,
      skipped: totalSkipped,
      totalInserted,
      totalUpdated,
      totalSkipped,
      steps,
      assetsDeleted: steps.reduce(
        (sum, step) => sum + (step.assetsDeleted || 0),
        0,
      ),
      incomplete: false,
      // Every step finished fully in this run, so there's nothing left to
      // resume — an empty map here (rather than omitting the field) makes
      // that explicit for anything reading run history.
      stepCursors: {},
    };

    await db.collection(COLLECTIONS.ARCHIVE_RUNS).insertOne(result);
    await updateArchiveProgress(
      progressCollection,
      progressId,
      {
        status: result.errors.length ? "failed" : "success",
        completedAt: result.completedAt,
        currentStep: null,
        currentStepIndex: stepFns.length,
        completedSteps: stepFns.map((step) => step.name),
        pendingSteps: [],
        errors,
        progressPercent: 100,
      },
      `Archive run complete: ${totalArchived} documents archived.`,
    );

    console.log(
      `\n🎉 Archive run complete: ${totalArchived} documents archived in ${durationMs}ms`,
    );
    if (errors.length)
      console.error(`⚠️  ${errors.length} errors occurred:`, errors);

    return result;
  } catch (err: any) {
    const message = err?.message || String(err);
    // Log the FULL error — stack trace, name, and any structured detail
    // (MongoDB errors carry .code / .errorLabelSet, Sanity errors carry
    // .statusCode / .response) — not just `.message`, which frequently
    // isn't enough on its own to diagnose why a run actually failed.
    console.error("❌ Archive run failed with exception:", err);
    if (err?.stack) console.error(err.stack);
    errors.push(`Archive run failed: ${message}`);

    const failedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const failedResult: ArchiveRunResult = {
      runId,
      startedAt,
      completedAt: failedAt,
      durationMs,
      archived,
      errors,
      warnings,
      skipped: totalSkipped,
      totalInserted,
      totalUpdated,
      totalSkipped,
      steps,
      assetsDeleted: steps.reduce(
        (sum, step) => sum + (step.assetsDeleted || 0),
        0,
      ),
      incomplete: false,
      // Preserve whatever per-step resume positions were known when the
      // exception hit — not auto-resumed by cron (only `incomplete: true`
      // runs are), but still available if this runId is retried manually.
      stepCursors,
    };

    await db.collection(COLLECTIONS.ARCHIVE_RUNS).insertOne(failedResult);
    await updateArchiveProgress(
      progressCollection,
      progressId,
      {
        status: "failed",
        completedAt: failedAt,
        currentStep: null,
        currentStepIndex: steps.length,
        completedSteps: steps.map((s) => s.name),
        pendingSteps: stepFns
          .map((s) => s.name)
          .filter((name) => !steps.map((s) => s.name).includes(name)),
        errors,
        progressPercent: Math.min(
          100,
          Math.round((steps.length / stepFns.length) * 100),
        ),
      },
      `Archive run failed: ${message}`,
    );

    throw err;
  } finally {
    // Flush whatever's still buffered — otherwise the last (sub-second)
    // batch of progress messages is silently dropped when the run ends.
    await flushProgressMessages(true).catch(() => {});
    appendProgress = undefined;
  }
}

export async function resumeIncompleteArchives(
  maxAttempts: number = 5,
): Promise<{ attempts: number; finished: boolean }> {
  const db = await getArchiveDb();
  let attempts = 0;
  // Each runArchive() call is itself allowed to run for close to the full
  // per-invocation time budget (that's the whole point of its internal
  // checkpointing). Looping up to maxAttempts times here WITHOUT a matching
  // outer time check would just reproduce the exact same "silently killed
  // by Vercel's hard timeout" failure one level up, the moment a backlog
  // needs more than one resume cycle to finish — up to 5 x ~270s is nearly
  // 23 minutes against a 300-second hard limit. Only attempt another
  // iteration if there's still comfortable headroom left in THIS
  // invocation; otherwise stop cleanly (nothing lost — runArchive() has
  // already checkpointed) and let the next cron tick continue.
  const outerStartMs = Date.now();
  const outerBudgetMs =
    parseInt(process.env.ARCHIVE_MAX_SECONDS || "270", 10) * 1000;

  for (; attempts < maxAttempts; attempts += 1) {
    if (
      attempts > 0 &&
      Date.now() - outerStartMs >= outerBudgetMs - MIN_BATCH_TIME_BUFFER_MS
    ) {
      return { attempts, finished: false };
    }

    const incompleteRun = await db
      .collection(COLLECTIONS.ARCHIVE_RUNS)
      .findOne({ incomplete: true }, { sort: { startedAt: -1 } });

    if (!incompleteRun) return { attempts, finished: true };

    // console.log(
    //   `🔁 Resuming incomplete archive run (found: ${incompleteRun.runId})`,
    // );

    // Pass the original runId so resumed run updates the same progress record
    const res = await runArchive(incompleteRun.runId);

    if (!res.incomplete) {
      // See the identical fix/comment in resumeIncompleteCleanup() above:
      // this must match runId (the run that just finished), not exclude
      // it — excluding it left this run's own checkpoint doc(s) stuck at
      // incomplete: true forever, so every subsequent resume attempt (next
      // cron tick, admin page auto-resume, or "Run Archive Now" click)
      // found the same already-finished run "incomplete" again and
      // re-ran it from scratch, producing repeated duplicate success
      // entries in the archive history every few seconds.
      await db
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .updateMany(
          { incomplete: true, runId: res.runId },
          { $set: { incomplete: false } },
        );
    }

    const remaining = await db
      .collection(COLLECTIONS.ARCHIVE_RUNS)
      .findOne({ incomplete: true });
    if (!remaining) return { attempts: attempts + 1, finished: true };
  }

  return { attempts, finished: false };
}
