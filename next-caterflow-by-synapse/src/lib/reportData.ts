// src/lib/reportData.ts
// Server-side loader for the ledger documents behind the financial report.
//
// Reuses the GET handlers of the existing API routes so the report sees
// exactly what the rest of the app sees: Sanity + archive merged, de-duplicated,
// and scoped to the signed-in user's sites.

import { filterDataBySite } from "@/lib/reportFilters";

export interface LedgerDocs {
  receipts: any[];
  dispatches: any[];
  counts: any[];
  transfers: any[];
  failed: string[];
}

async function readJson(
  name: string,
  load: () => Promise<Response>,
  failed: string[],
): Promise<any[]> {
  try {
    const res = await load();
    if (!res.ok) throw new Error(`${name} responded ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  } catch (error) {
    console.error(`reportData: failed to load ${name}`, error);
    failed.push(name);
    return [];
  }
}

// Reports need the COMPLETE history (archive included), so no `archived=false`.
const internalRequest = () => new Request("http://internal/ledger");

export async function loadLedgerDocs(
  siteId: string | null,
): Promise<LedgerDocs> {
  const failed: string[] = [];
  // Dynamic imports keep these heavy route modules out of unit tests and out
  // of any bundle that does not call the loader.
  const [gr, dp, bc, tr] = await Promise.all([
    import("@/app/api/goods-receipts/route"),
    import("@/app/api/dispatches/route"),
    import("@/app/api/bin-counts/route"),
    import("@/app/api/transfers/route"),
  ]);

  const [receipts, dispatches, counts, transfers] = await Promise.all([
    readJson("goods receipts", () => gr.GET(internalRequest()) as Promise<Response>, failed),
    readJson("dispatches", () => dp.GET(internalRequest()) as Promise<Response>, failed),
    readJson("bin counts", () => bc.GET(internalRequest()) as Promise<Response>, failed),
    readJson("transfers", () => tr.GET() as Promise<Response>, failed),
  ]);

  return {
    receipts: filterDataBySite(receipts, siteId, "goodsReceipt"),
    dispatches: filterDataBySite(dispatches, siteId, "dispatch"),
    counts: filterDataBySite(counts, siteId, "binCount"),
    transfers: filterDataBySite(transfers, siteId, "transfer"),
    failed,
  };
}

/**
 * Live inventory value (sum of current stock x unit price) across all sites,
 * or null when it cannot be read. Only used to estimate a missing opening
 * baseline, so a failure degrades to "no estimate" rather than an error.
 */
export async function loadLiveInventoryValue(): Promise<number | null> {
  try {
    const sv = await import("@/app/api/analytics/stock-values/route");
    const res = (await sv.GET()) as Response;
    if (!res.ok) throw new Error(`stock-values responded ${res.status}`);
    const body = await res.json();
    const value = Number(body?.summary?.totalInventoryValue);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.warn("reportData: could not read live inventory value", error);
    return null;
  }
}
