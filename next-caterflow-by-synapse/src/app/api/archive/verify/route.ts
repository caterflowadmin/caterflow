// src/app/api/archive/verify/route.ts
// Verify archive integrity by comparing archived and live document counts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { client as sanityClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";

const ARCHIVE_DAYS = parseInt(process.env.ARCHIVE_DAYS_THRESHOLD || "60", 10);

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !["admin", "auditor"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // console.log("\n🔍 Starting archive integrity verification...");

    const db = await getArchiveDb();
    const verification: Record<string, any> = {
      timestamp: new Date().toISOString(),
      checks: [],
    };

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_DAYS);
    const cutoff = cutoffDate.toISOString();

    // Check each document type
    const types = [
      {
        name: "DispatchLog",
        sanityType: "DispatchLog",
        collectionName: COLLECTIONS.DISPATCH_LOGS,
        eligibleQuery: groq`*[_type == "DispatchLog" && dispatchDate < $cutoff && !(evidenceStatus in ["pending", "partial"])] {_id}`,
      },
      {
        name: "PurchaseOrder",
        sanityType: "PurchaseOrder",
        collectionName: COLLECTIONS.PURCHASE_ORDERS,
        eligibleQuery: groq`*[_type == "PurchaseOrder" && orderDate < $cutoff && !(status in ["draft", "pending-approval"])] {_id}`,
      },
      {
        name: "GoodsReceipt",
        sanityType: "GoodsReceipt",
        collectionName: COLLECTIONS.GOODS_RECEIPTS,
        eligibleQuery: groq`*[_type == "GoodsReceipt" && receiptDate < $cutoff && !(evidenceStatus in ["pending", "partial"])] {_id}`,
      },
      {
        name: "InternalTransfer",
        sanityType: "InternalTransfer",
        collectionName: COLLECTIONS.INTERNAL_TRANSFERS,
        eligibleQuery: groq`*[_type == "InternalTransfer" && transferDate < $cutoff && !(status in ["draft", "pending-approval"])] {_id}`,
      },
      {
        name: "StockAdjustment",
        sanityType: "StockAdjustment",
        collectionName: COLLECTIONS.STOCK_ADJUSTMENTS,
        eligibleQuery: groq`*[_type == "StockAdjustment" && adjustmentDate < $cutoff && !(evidenceStatus in ["pending", "partial"])] {_id}`,
      },
      {
        name: "InventoryCount",
        sanityType: "InventoryCount",
        collectionName: COLLECTIONS.INVENTORY_COUNTS,
        eligibleQuery: groq`*[_type == "InventoryCount" && countDate < $cutoff && !(status in ["draft", "in-progress"])] {_id}`,
      },
      {
        name: "FileAttachment",
        sanityType: "FileAttachment",
        collectionName: COLLECTIONS.FILE_ATTACHMENTS,
        eligibleQuery: groq`*[_type == "FileAttachment" && uploadedAt < $cutoff] {_id}`,
      },
      {
        name: "StockSnapshot",
        sanityType: "stockSnapshot",
        collectionName: COLLECTIONS.STOCK_SNAPSHOTS,
        eligibleQuery: groq`*[_type == "stockSnapshot" && _createdAt < $cutoff] {_id}`,
      },
    ];

    let allMatched = true;

    for (const type of types) {
      try {
        const [sanityCount, eligibleDocs] = await Promise.all([
          sanityClient.fetch(groq`count(*[_type == $sanityType])`, {
            sanityType: type.sanityType,
          }),
          sanityClient.fetch(type.eligibleQuery, { cutoff }),
        ]);

        const eligibleIds = ((eligibleDocs as Array<{ _id: string }>) || [])
          .map((doc) => doc._id)
          .filter(Boolean);

        const archivedDocs = await db
          .collection(type.collectionName)
          .find(
            { _sanityId: { $in: eligibleIds } },
            { projection: { _sanityId: 1 } },
          )
          .toArray();

        const archivedSanityIds = new Set(
          archivedDocs.map((doc: any) => doc._sanityId).filter(Boolean),
        );
        const missingIds = eligibleIds
          .filter((id) => !archivedSanityIds.has(id))
          .slice(0, 20);

        const mongoCount = await db
          .collection(type.collectionName)
          .countDocuments();

        const mongoResult = await db
          .collection(type.collectionName)
          .aggregate([
            { $group: { _id: "$_sanityId", count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
          ])
          .toArray();

        const hasDuplicates = mongoResult.length > 0;
        const hasMissingCoverage = missingIds.length > 0;

        verification.checks.push({
          type: type.name,
          sanityLiveCount: sanityCount,
          sanityEligibleCount: eligibleIds.length,
          mongoArchivedCount: mongoCount,
          coveredEligibleCount: archivedDocs.length,
          missingCount: missingIds.length,
          missingExamples: missingIds,
          duplicateRecords: hasDuplicates ? mongoResult.length : 0,
          status: hasMissingCoverage || hasDuplicates ? "warn" : "ok",
        });

        if (hasDuplicates || hasMissingCoverage) {
          allMatched = false;
          if (hasDuplicates) {
            // console.warn(
            //   `⚠️  ${type.name}: Found ${mongoResult.length} duplicated _sanityId values`,
            // );
          }
          if (hasMissingCoverage) {
            // console.warn(
            //   `⚠️  ${type.name}: ${missingIds.length} eligible Sanity documents are not present in the archive collection`,
            // );
          }
        } else {
          // console.log(
          //   `✅ ${type.name}: ${eligibleIds.length} eligible Sanity docs, ${mongoCount} archived`,
          // );
        }
      } catch (err: any) {
        verification.checks.push({
          type: type.name,
          error: err?.message,
          status: "error",
        });
        allMatched = false;
        console.error(`❌ ${type.name}: ${err?.message}`);
      }
    }

    // Check ARCHIVE_RUNS collection integrity
    try {
      // Exclude the "archive-progress" singleton doc — it isn't a run
      // record, and its startedAt is refreshed on every run, so leaving it
      // in would both inflate totalRuns by one and could get picked as
      // "lastRun" instead of an actual completed/partial run.
      const runsFilter = { kind: { $ne: "progress" } };
      const runsCount = await db
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .countDocuments(runsFilter);
      const runs = await db
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .find(runsFilter)
        .sort({ startedAt: -1 })
        .limit(1)
        .toArray();

      verification.checks.push({
        type: "ArchiveRuns",
        totalRuns: runsCount,
        lastRun: runs[0]
          ? {
              runId: runs[0].runId,
              startedAt: runs[0].startedAt,
              status: runs[0].errors?.length ? "partial" : "success",
              docsArchived: Object.values(runs[0].archived || {}).reduce(
                (sum: number, val: any) =>
                  sum + (typeof val === "number" ? val : 0),
                0,
              ),
            }
          : null,
        status: "ok",
      });
      // console.log(`✅ ArchiveRuns: ${runsCount} total runs`);
    } catch (err: any) {
      verification.checks.push({
        type: "ArchiveRuns",
        error: err?.message,
        status: "error",
      });
      allMatched = false;
    }

    verification.passed = allMatched;
    verification.summary = allMatched
      ? "✅ All archive integrity checks passed"
      : "⚠️  Some issues detected—review missing coverage, duplicates and errors";

    return NextResponse.json(verification);
  } catch (error: any) {
    console.error("❌ Archive verification failed:", error);
    return NextResponse.json(
      {
        error: "Verification failed",
        message: error?.message,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "Archive verification endpoint",
    method: "POST",
    requires: "Admin or auditor authentication",
    description:
      "Verify archive data integrity and check for missing eligible Sanity documents",
  });
}
