import { client as sanityClient, writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";
import type { Db } from "mongodb";

const ARCHIVE_DAYS = parseInt(process.env.ARCHIVE_DAYS_THRESHOLD || "60", 10);

export interface ValidationResult {
  passed: boolean;
  checks: CheckResult[];
  summary: string;
  timestamp: string;
}

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: Record<string, any>;
}

// ─── Environment Validation ───────────────────────────────────────────────────

async function validateEnvironment(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check MONGODB_URI
  if (!process.env.MONGODB_URL && !process.env.MONGODB_URI) {
    results.push({
      name: "MongoDB URI",
      status: "fail",
      message: "MONGODB_URL or MONGODB_URI environment variable not set",
    });
  } else {
    results.push({
      name: "MongoDB URI",
      status: "pass",
      message: "MongoDB connection URI is configured",
    });
  }

  // Check ARCHIVE_DAYS_THRESHOLD
  if (!process.env.ARCHIVE_DAYS_THRESHOLD) {
    results.push({
      name: "Archive Days Threshold",
      status: "warn",
      message: `ARCHIVE_DAYS_THRESHOLD not set, using default: ${ARCHIVE_DAYS} days`,
    });
  } else {
    const days = parseInt(process.env.ARCHIVE_DAYS_THRESHOLD, 10);
    if (isNaN(days) || days < 1) {
      results.push({
        name: "Archive Days Threshold",
        status: "fail",
        message: `Invalid ARCHIVE_DAYS_THRESHOLD: "${process.env.ARCHIVE_DAYS_THRESHOLD}" (must be a positive integer)`,
      });
    } else if (days < 30) {
      results.push({
        name: "Archive Days Threshold",
        status: "warn",
        message: `ARCHIVE_DAYS_THRESHOLD is ${days} days (very short—risk of archiving recent data)`,
      });
    } else {
      results.push({
        name: "Archive Days Threshold",
        status: "pass",
        message: `Archive threshold set to ${days} days`,
      });
    }
  }

  // Check CRON_SECRET
  if (!process.env.CRON_SECRET) {
    results.push({
      name: "Cron Secret",
      status: "warn",
      message: "CRON_SECRET not set (cron triggers will fail)",
    });
  } else {
    results.push({
      name: "Cron Secret",
      status: "pass",
      message: "Cron secret is configured",
    });
  }

  // Check ARCHIVE_ENCRYPTION_KEY
  // NOTE: this is NOT optional in practice — /api/archive/export always
  // calls encryptData() unconditionally, so a missing or malformed key
  // makes Export/Import fail on every single call. This used to be
  // reported as "warn" with "(backups will not be encrypted)", which
  // wrongly implied there's a working unencrypted fallback — there isn't.
  if (!process.env.ARCHIVE_ENCRYPTION_KEY) {
    results.push({
      name: "Encryption Key",
      status: "fail",
      message:
        "ARCHIVE_ENCRYPTION_KEY not set — /api/archive/export and /api/archive/import will fail on every request until this is set to a 32-byte base64 key.",
    });
  } else {
    const keyLength = Buffer.from(
      process.env.ARCHIVE_ENCRYPTION_KEY,
      "base64",
    ).length;
    if (keyLength !== 32) {
      results.push({
        name: "Encryption Key",
        status: "fail",
        message: `Encryption key is ${keyLength} bytes (expected 32 for AES-256) — /api/archive/export and /api/archive/import will fail on every request until this is corrected.`,
      });
    } else {
      results.push({
        name: "Encryption Key",
        status: "pass",
        message: "Encryption key is 32 bytes (AES-256)",
      });
    }
  }

  return results;
}

// ─── MongoDB Connection & Permissions ──────────────────────────────────────────

async function validateMongoDBConnection(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const db = await getArchiveDb();
    const adminDb = db.admin();

    // Test connection with ping
    await adminDb.ping();
    results.push({
      name: "MongoDB Connection",
      status: "pass",
      message: "Successfully connected to MongoDB",
    });

    // Check collections exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    const requiredCollections = [
      COLLECTIONS.ARCHIVE_RUNS,
      COLLECTIONS.DISPATCH_LOGS,
      COLLECTIONS.PURCHASE_ORDERS,
      COLLECTIONS.GOODS_RECEIPTS,
      COLLECTIONS.INTERNAL_TRANSFERS,
      COLLECTIONS.STOCK_ADJUSTMENTS,
      COLLECTIONS.INVENTORY_COUNTS,
      COLLECTIONS.FILE_ATTACHMENTS,
      COLLECTIONS.STOCK_SNAPSHOTS,
    ];

    const missingCollections = requiredCollections.filter(
      (c) => !collectionNames.includes(c),
    );

    if (missingCollections.length > 0) {
      results.push({
        name: "Archive Collections",
        status: "warn",
        message: `${missingCollections.length} collection(s) do not exist yet (will be created on first archive)`,
        details: { missing: missingCollections },
      });
    } else {
      results.push({
        name: "Archive Collections",
        status: "pass",
        message: `All ${requiredCollections.length} required collections exist`,
      });
    }

    // Test write permission with a test document
    const testCollection = db.collection("_archive_validation_test");
    const testDoc = { _test: true, timestamp: new Date().toISOString() };
    const insertResult = await testCollection.insertOne(testDoc);
    const deleteResult = await testCollection.deleteOne({
      _id: insertResult.insertedId,
    });

    if (deleteResult.deletedCount === 1) {
      results.push({
        name: "MongoDB Write Permissions",
        status: "pass",
        message: "MongoDB read/write permissions verified",
      });
    } else {
      results.push({
        name: "MongoDB Write Permissions",
        status: "fail",
        message: "MongoDB write test succeeded but delete failed",
      });
    }
  } catch (err: any) {
    results.push({
      name: "MongoDB Connection",
      status: "fail",
      message: `MongoDB connection failed: ${err?.message}`,
    });
  }

  return results;
}

// ─── Sanity Client & Permissions ───────────────────────────────────────────────

async function validateSanityClient(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    // Test read access
    const testQuery = groq`*[_type == "DispatchLog"][0...1]{"_id": _id}`;
    const docs = await sanityClient.fetch(testQuery);

    results.push({
      name: "Sanity Read Access",
      status: "pass",
      message: "Sanity client can read documents",
      details: { sampleDocsFound: Array.isArray(docs) ? docs.length : 0 },
    });
  } catch (err: any) {
    results.push({
      name: "Sanity Read Access",
      status: "fail",
      message: `Sanity read test failed: ${err?.message}`,
    });
  }

  try {
    // Test write client with a draft
    const testDraft = {
      _type: "_archive_validation_test",
      message: "Archive validation test",
      timestamp: new Date().toISOString(),
    };

    const result = await writeClient.create(testDraft);
    await writeClient.delete(result._id);

    results.push({
      name: "Sanity Write Access",
      status: "pass",
      message: "Sanity write client can create and delete documents",
    });
  } catch (err: any) {
    results.push({
      name: "Sanity Write Access",
      status: "fail",
      message: `Sanity write test failed: ${err?.message}`,
    });
  }

  return results;
}

// ─── Archive Data Validation ────────────────────────────────────────────────────

async function validateArchiveData(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_DAYS);

    // Check for documents older than cutoff in each type.
    // The `exclude` clause for each type MUST mirror the exclusion filter the
    // corresponding archiveXxx() step in archiveService.ts actually uses —
    // otherwise this reports an "eligible" count that doesn't match what a
    // real archive run will process (e.g. counting draft/pending-approval
    // documents that the real run skips).
    const types = [
      {
        name: "DispatchLog",
        field: "dispatchDate",
        exclude: '!(evidenceStatus in ["pending", "partial"])',
      },
      {
        name: "PurchaseOrder",
        field: "orderDate",
        exclude: '!(status in ["draft", "pending-approval"])',
      },
      {
        name: "GoodsReceipt",
        field: "receiptDate",
        exclude: '!(evidenceStatus in ["pending", "partial"])',
      },
      {
        name: "InternalTransfer",
        field: "transferDate",
        exclude: '!(status in ["draft", "pending-approval"])',
      },
      {
        name: "StockAdjustment",
        field: "adjustmentDate",
        exclude: '!(evidenceStatus in ["pending", "partial"])',
      },
      {
        name: "InventoryCount",
        field: "countDate",
        exclude: '!(status in ["draft", "in-progress"])',
      },
      { name: "FileAttachment", field: "uploadedAt", exclude: null },
    ];

    for (const type of types) {
      const query = groq`count(*[_type == "${type.name}" && ${type.field} < $cutoff${
        type.exclude ? ` && ${type.exclude}` : ""
      }])`;
      const count = await sanityClient.fetch(query, {
        cutoff: cutoffDate.toISOString(),
      });

      if (count === 0) {
        results.push({
          name: `${type.name} Candidates`,
          status: "warn",
          message: `No ${type.name} documents found older than ${ARCHIVE_DAYS} days`,
        });
      } else {
        results.push({
          name: `${type.name} Candidates`,
          status: "pass",
          message: `${count} ${type.name}(s) eligible for archival`,
          details: { count },
        });
      }
    }
  } catch (err: any) {
    results.push({
      name: "Archive Data Validation",
      status: "fail",
      message: `Failed to check archive candidates: ${err?.message}`,
    });
  }

  return results;
}

// ─── Archive Runs Validation ────────────────────────────────────────────────────

async function validateArchiveRuns(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const db = await getArchiveDb();
    const runsCollection = db.collection(COLLECTIONS.ARCHIVE_RUNS);

    const recentRuns = await runsCollection
      .find({ kind: { $ne: "progress" } })
      .sort({ startedAt: -1 })
      .limit(5)
      .toArray();

    if (recentRuns.length === 0) {
      results.push({
        name: "Archive Run History",
        status: "warn",
        message:
          "No archive runs found yet (this is normal for new deployments)",
      });
    } else {
      const lastRun = recentRuns[0];
      const lastRunTime = new Date(lastRun.startedAt);
      const hoursAgo = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);

      const status = hoursAgo < 48 ? "pass" : "warn";
      results.push({
        name: "Archive Run History",
        status: status,
        message: `Last archive run: ${hoursAgo.toFixed(1)} hours ago`,
        details: {
          runId: lastRun.runId,
          status: lastRun.archived
            ? Object.values(lastRun.archived).reduce(
                (a: number, b: any) => a + b,
                0,
              )
            : 0,
          errors: lastRun.errors?.length || 0,
        },
      });
    }
  } catch (err: any) {
    results.push({
      name: "Archive Run History",
      status: "fail",
      message: `Failed to check archive runs: ${err?.message}`,
    });
  }

  return results;
}

// ─── Main Validation Runner ────────────────────────────────────────────────────

export async function validateArchiveSetup(): Promise<ValidationResult> {
  console.log("\n🔍 Starting comprehensive archive validation...\n");

  const checks: CheckResult[] = [];

  // Run all validation checks in parallel
  const [envChecks, mongoChecks, sanityChecks, dataChecks, runChecks] =
    await Promise.all([
      validateEnvironment(),
      validateMongoDBConnection(),
      validateSanityClient(),
      validateArchiveData(),
      validateArchiveRuns(),
    ]);

  checks.push(
    ...envChecks,
    ...mongoChecks,
    ...sanityChecks,
    ...dataChecks,
    ...runChecks,
  );

  // Determine overall pass/fail
  const failures = checks.filter((c) => c.status === "fail");
  const passed = failures.length === 0;

  // Print results
  console.log("\n📋 Archive Validation Report:");
  console.log("═".repeat(60));
  checks.forEach((check) => {
    const icon =
      check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️ ";
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.message}`);
    if (check.details) {
      console.log(`   Details: ${JSON.stringify(check.details)}`);
    }
  });
  console.log("═".repeat(60));

  const summary = passed
    ? `✅ All checks passed. Archive is ready for production.`
    : `❌ ${failures.length} check(s) failed. Review the errors above before deploying.`;

  console.log(`\n${summary}\n`);

  return {
    passed,
    checks,
    summary,
    timestamp: new Date().toISOString(),
  };
}
