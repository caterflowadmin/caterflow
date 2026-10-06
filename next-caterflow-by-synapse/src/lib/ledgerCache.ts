// src/lib/ledgerCache.ts
import { loadLedgerDocs } from "@/lib/reportData";

// Loading the full ledger (Sanity + whole archive) dominates this route, and
// it is identical for every date range a user tries. Keep one load per
// (user scope, site) for a short window, shared by concurrent requests.
const LEDGER_TTL_MS = 45_000;
const ledgerCache = new Map<string, { ts: number; promise: ReturnType<typeof loadLedgerDocs> }>();

export function loadLedgerCached(scope: string, siteId: string | null) {
  const key = `${scope}|${siteId ?? "all"}`;
  const hit = ledgerCache.get(key);
  if (hit && Date.now() - hit.ts < LEDGER_TTL_MS) return hit.promise;

  const promise = loadLedgerDocs(siteId);
  ledgerCache.set(key, { ts: Date.now(), promise });
  // Never keep a partial/failed load around.
  promise
    .then((d) => {
      if (d.failed.length) ledgerCache.delete(key);
    })
    .catch(() => ledgerCache.delete(key));
  if (ledgerCache.size > 50) ledgerCache.delete(ledgerCache.keys().next().value as string);
  return promise;
}


/** Test hook / manual flush. */
export function resetLedgerCache() {
  ledgerCache.clear();
}
