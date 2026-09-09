import * as fs from "fs";
import * as path from "path";
function loadEnv(file: string) {
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.resolve(__dirname, ".env"));

async function main() {
  const { MongoClient } = await import("mongodb");
  const mongo = new MongoClient(process.env.MONGODB_URL!);
  await mongo.connect();
  const db = mongo.db(process.env.DATABASE_NAME);

  const counts: Record<string, number> = {};
  for (const c of ["archived_dispatch_logs","archived_purchase_orders","archived_goods_receipts","archived_internal_transfers","archived_stock_adjustments","archived_inventory_counts","archived_file_attachments","archived_stock_snapshots"]) {
    counts[c] = await db.collection(c).countDocuments({});
  }
  console.log("COUNTS:", JSON.stringify(counts));

  const progress = await db.collection("archive_runs").findOne({ _id: "archive-progress" as any });
  console.log("PROGRESS:", JSON.stringify({ status: progress?.status, currentStep: progress?.currentStep, lastUpdatedAt: progress?.lastUpdatedAt, errors: progress?.errors }));

  const incompleteCount = await db.collection("archive_runs").countDocuments({ incomplete: true });
  console.log("INCOMPLETE_COUNT:", incompleteCount);

  await mongo.close();
}
main().catch(e => { console.error("FAILED:", e); process.exit(1); });
