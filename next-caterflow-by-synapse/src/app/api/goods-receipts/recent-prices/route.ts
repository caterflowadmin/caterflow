// POST /api/goods-receipts/recent-prices   { binId, itemIds: string[] }
//
// Returns { prices: { [itemId]: number } } — the most recent received unit
// price per item for receipts into the given bin. Replaces modals downloading
// the ENTIRE goods-receipt history (every receipt, every nested projection,
// plus the whole MongoDB archive) just to read a handful of prices.
//
// Rules mirror the old client-side logic: a receipt counts for a bin when any
// item resolves to that bin (item-level receivingBin, else the document-level
// one); newest receipt wins; zero/missing prices are ignored. Site access is
// enforced with the same filter as the receipts list.
import { NextResponse } from "next/server";
import { groq } from "next-sanity";
import { client } from "@/lib/sanity";
import { getUserSiteInfo, buildGoodsReceiptSiteFilter } from "@/lib/siteFiltering";
import { getArchivedReceiptPrices } from "@/lib/archiveQueries";
import { timed, withServerTiming, Timings } from "@/lib/perf";

const MAX_ITEMS = 2000;

export async function POST(request: Request) {
  const timings: Timings = {};
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const binId = typeof body?.binId === "string" ? body.binId : "";
    const itemIds: string[] = Array.isArray(body?.itemIds)
      ? Array.from(new Set(body.itemIds.filter((i: unknown): i is string => typeof i === "string"))).slice(0, MAX_ITEMS) as string[]
      : [];

    if (!binId || itemIds.length === 0) {
      return NextResponse.json({ prices: {} });
    }

    const userSiteInfo = await getUserSiteInfo();
    const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

    const query = groq`*[
      _type == "GoodsReceipt"
      && (
        (receivingBin._ref == $binId && count(receivedItems[!defined(receivingBin)]) > 0)
        || count(receivedItems[receivingBin._ref == $binId]) > 0
      )
      ${siteFilter}
    ] | order(receiptDate desc) {
      "items": receivedItems[stockItem._ref in $itemIds && defined(unitPrice) && unitPrice > 0]{
        "itemId": stockItem._ref,
        unitPrice
      }
    }`;

    const receipts: Array<{ items?: Array<{ itemId: string; unitPrice: number }> }> =
      await timed("receipt-prices", () => client.fetch(query, { binId, itemIds }), timings);

    const prices: Record<string, number> = {};
    for (const r of receipts || []) {
      for (const it of r.items || []) {
        if (it.unitPrice && prices[it.itemId] === undefined) prices[it.itemId] = it.unitPrice;
      }
    }

    // Older receipts may only exist in the archive: look there for the rest.
    const unresolved = itemIds.filter((id) => prices[id] === undefined);
    if (unresolved.length > 0) {
      try {
        const archived = await timed(
          "archive-prices",
          () =>
            getArchivedReceiptPrices({
              binId,
              itemIds: unresolved,
              userSiteId: userSiteInfo.userSiteId,
              canAccessMultipleSites: userSiteInfo.canAccessMultipleSites,
            }),
          timings,
        );
        for (const [id, price] of Object.entries(archived)) {
          if (prices[id] === undefined) prices[id] = price;
        }
      } catch (err) {
        console.warn("recent-prices: archive lookup failed (using recent receipts only)", err);
      }
    }

    return withServerTiming(NextResponse.json({ prices }), timings, Date.now() - t0);
  } catch (error: any) {
    if (error?.message === "User not authenticated") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("recent-prices failed:", error);
    return NextResponse.json({ error: "Failed to load recent prices" }, { status: 500 });
  }
}
