import { logger } from '@/lib/logger';
/**
 * Shared unit price resolution helpers for consistent pricing across inventory flows.
 * Centralized to avoid duplicating price lookup logic across modals.
 */

/**
 * Fetch the most recent unit price for an item from goods receipts in a specific bin.
 * Uses receipts as the source of truth (latest received price).
 * Falls back to stock item default price if not found in receipts.
 */
export async function getRecentUnitPriceForItemInBin(
  itemId: string,
  binId: string,
  fallbackPrice?: number,
): Promise<number> {
  try {
    const response = await fetch("/api/goods-receipts");
    if (!response.ok) throw new Error("Failed to fetch receipts");

    const receipts = await response.json();

    // Filter receipts for this bin
    const receiptsForBin = receipts.filter((receipt: any) => {
      if (!receipt.receivedItems || !Array.isArray(receipt.receivedItems))
        return false;
      return receipt.receivedItems.some((item: any) => {
        const itemBin = item.receivingBin
          ? item.receivingBin._id || item.receivingBin
          : receipt.receivingBin
            ? receipt.receivingBin._id || receipt.receivingBin
            : null;
        return itemBin === binId;
      });
    });

    // Find the most recent price for this item
    for (const receipt of receiptsForBin) {
      const receivedItem = receipt.receivedItems.find((item: any) => {
        const itemId_ =
          typeof item.stockItem === "string"
            ? item.stockItem
            : item.stockItem?._id;
        return itemId_ === itemId && item.unitPrice;
      });
      if (receivedItem?.unitPrice) {
        return receivedItem.unitPrice;
      }
    }
  } catch (error) {
    console.error(
      `Failed to fetch unit price for item ${itemId} in bin ${binId}:`,
      error,
    );
  }

  return fallbackPrice ?? 0;
}

/**
 * Batch fetch recent unit prices for multiple items in a bin.
 * More efficient than calling getRecentUnitPriceForItemInBin for each item.
 */
export async function getRecentUnitPricesForItemsInBin(
  itemIds: string[],
  binId: string,
): Promise<Record<string, number>> {
  const priceMap: Record<string, number> = {};

  if (!itemIds.length) return priceMap;

  try {
    const response = await fetch("/api/goods-receipts");
    if (!response.ok) throw new Error("Failed to fetch receipts");

    const receipts = await response.json();

    // Filter receipts for this bin
    const receiptsForBin = receipts.filter((receipt: any) => {
      if (!receipt.receivedItems || !Array.isArray(receipt.receivedItems))
        return false;
      return receipt.receivedItems.some((item: any) => {
        const itemBin = item.receivingBin
          ? item.receivingBin._id || item.receivingBin
          : receipt.receivingBin
            ? receipt.receivingBin._id || receipt.receivingBin
            : null;
        return itemBin === binId;
      });
    });

    // Find prices for requested items (receipts are sorted newest first)
    receiptsForBin.forEach((receipt: any) => {
      if (receipt.receivedItems && Array.isArray(receipt.receivedItems)) {
        receipt.receivedItems.forEach((receivedItem: any) => {
          const itemId =
            typeof receivedItem.stockItem === "string"
              ? receivedItem.stockItem
              : receivedItem.stockItem?._id;

          // Only use the first (most recent) price found for each item
          if (
            itemIds.includes(itemId) &&
            receivedItem.unitPrice &&
            !priceMap[itemId]
          ) {
            priceMap[itemId] = receivedItem.unitPrice;
          }
        });
      }
    });

    logger.debug("📊 Unit prices fetched from receipts:", priceMap);
    return priceMap;
  } catch (error) {
    console.error(
      `Failed to batch fetch unit prices for items in bin ${binId}:`,
      error,
    );
    return {};
  }
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
