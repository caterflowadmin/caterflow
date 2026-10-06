import { logger } from '@/lib/logger';
/**
 * Shared unit price resolution helpers for consistent pricing across inventory flows.
 * Centralized to avoid duplicating price lookup logic across modals.
 */

/**
 * Batch fetch the most recent received unit price for items in a bin.
 *
 * Asks the server for just those prices (POST /api/goods-receipts/recent-prices)
 * instead of downloading the entire goods-receipt history and scanning it in
 * the browser. Receipts are the source of truth; items without a receipt price
 * are simply absent from the result so callers can fall back to the item's
 * default price via `resolveUnitPrice`.
 */
export async function getRecentUnitPricesForItemsInBin(
  itemIds: string[],
  binId: string,
): Promise<Record<string, number>> {
  if (!itemIds.length || !binId) return {};

  try {
    const response = await fetch("/api/goods-receipts/recent-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ binId, itemIds }),
    });
    if (!response.ok) throw new Error(`Failed to fetch prices (${response.status})`);

    const { prices } = await response.json();
    logger.debug("📊 Unit prices fetched from receipts:", prices);
    return prices || {};
  } catch (error) {
    console.error(
      `Failed to batch fetch unit prices for items in bin ${binId}:`,
      error,
    );
    return {};
  }
}

/** Single-item convenience wrapper around the batch lookup. */
export async function getRecentUnitPriceForItemInBin(
  itemId: string,
  binId: string,
  fallbackPrice?: number,
): Promise<number> {
  const prices = await getRecentUnitPricesForItemsInBin([itemId], binId);
  return prices[itemId] ?? fallbackPrice ?? 0;
}

/**
 * Resolve unit price using the standard fallback chain:
 * 1. Receipt price (most recent actual received price for item in bin)
 * 2. Item stock price (fallback default)
 * 3. Provided fallback or 0
 *
 * Uses nullish coalescing (??) to allow zero as a valid price.
 */
export function resolveUnitPrice(
  receiptPrice: number | undefined,
  itemPrice: number | undefined,
  fallback: number = 0,
): number {
  return receiptPrice ?? itemPrice ?? fallback;
}
