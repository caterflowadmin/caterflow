// Read-only scan for PurchaseOrder documents in Sanity that share a poNumber.
// Does NOT write anything — reports duplicates so a human can decide how to
// renumber them.
//
// Usage: node --env-file=.env scripts/find_duplicate_po_numbers.mjs

import { createClient } from "next-sanity";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2025-08-20",
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN,
});

async function run() {
  const orders = await client.fetch(
    `*[_type == "PurchaseOrder" && defined(poNumber)]{
      _id, _createdAt, poNumber, status, orderDate, totalAmount
    } | order(poNumber asc)`,
  );

  console.log(`Fetched ${orders.length} PurchaseOrder document(s) with a poNumber.`);

  const byNumber = new Map();
  for (const order of orders) {
    if (!byNumber.has(order.poNumber)) byNumber.set(order.poNumber, []);
    byNumber.get(order.poNumber).push(order);
  }

  const duplicates = [...byNumber.entries()].filter(([, docs]) => docs.length > 1);

  if (!duplicates.length) {
    console.log("No duplicate poNumbers found.");
    return;
  }

  console.log(`\nFound ${duplicates.length} poNumber(s) shared by more than one document:\n`);
  for (const [poNumber, docs] of duplicates) {
    console.log(`poNumber: ${poNumber} (${docs.length} documents)`);
    for (const doc of docs) {
      console.log(
        `  - _id: ${doc._id}, createdAt: ${doc._createdAt}, orderDate: ${doc.orderDate || "n/a"}, status: ${doc.status || "n/a"}, totalAmount: ${doc.totalAmount ?? "n/a"}`,
      );
    }
  }
}

run().catch((err) => {
  console.error("Failed to scan for duplicate PO numbers:", err);
  process.exit(1);
});
