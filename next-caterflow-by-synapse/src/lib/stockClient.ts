// src/lib/stockClient.ts
// Browser-safe stock lookups. Talks to /api/stock/bulk so pages never import
// the server stock engine (and the Sanity client with it).
const CHUNK_SIZE = 250;
const CONCURRENCY = 3;

export type StockProgress = { stage: string; percentage: number };

/** Same contract as the server `calculateBulkStock`: `{ "<itemId>-<binId>": qty }`. */
export async function fetchBulkStock(
  stockItemIds: string[],
  binIds: string[],
  onProgress?: (progress: StockProgress) => void,
): Promise<Record<string, number>> {
  if (stockItemIds.length === 0 || binIds.length === 0) return {};

  const chunks: string[][] = [];
  for (let i = 0; i < stockItemIds.length; i += CHUNK_SIZE) {
    chunks.push(stockItemIds.slice(i, i + CHUNK_SIZE));
  }

  const results: Record<string, number> = {};
  let done = 0;
  let next = 0;
  onProgress?.({ stage: 'Calculating stock...', percentage: 0 });

  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const res = await fetch('/api/stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemIds: chunk, binIds }),
      });
      if (!res.ok) throw new Error(`Stock lookup failed (${res.status})`);
      Object.assign(results, (await res.json()).results);
      done++;
      onProgress?.({
        stage: `Calculating ${Math.round((done / chunks.length) * 100)}%...`,
        percentage: (done / chunks.length) * 100,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return results;
}

/** Quantities for many items in one bin, keyed by item id. */
export async function fetchBinStock(
  stockItemIds: string[],
  binId: string,
): Promise<Record<string, { quantity: number }>> {
  if (!binId || stockItemIds.length === 0) return {};
  const raw = await fetchBulkStock(stockItemIds, [binId]);
  const out: Record<string, { quantity: number }> = {};
  for (const id of stockItemIds) out[id] = { quantity: raw[`${id}-${binId}`] || 0 };
  return out;
}
