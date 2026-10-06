// src/lib/stockCalculations.ts - UX-OPTIMIZED VERSION (V2: WITH CONCURRENCY FIXES)
import { client, writeClient } from "@/lib/sanity";
import { bulkUpdateStockRegistryAPI } from "@/lib/stockRegistryAPI";
import { groq } from "next-sanity";
import Decimal from "decimal.js";
import {
  getCachedStock,
  setCachedStock,
  getCachedStockItem,
  setCachedStockItem,
  invalidateStockCache,
  getRegistryMap,
  type StockDataCache,
} from "@/lib/cache";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logger } from "@/lib/logger";

// Add at the top of the file, after imports:
import { Mutex } from "async-mutex";
import {
  fetchArchivedTransactions as getArchivedTransactionsForItem,
  fetchLatestStockBaseline as getLatestStockBaseline,
} from "@/app/actions/archiveActions";

Decimal.set({ precision: 10, rounding: Decimal.ROUND_HALF_UP });

// Add this function to stockCalculations.ts, after the imports but before updateStockForTransaction

/**
 * 🚀 BULK UPDATE STOCK SNAPSHOTS - Optimized for all transaction types
 * Updates multiple stock snapshots in minimal API calls
 */
export async function bulkUpdateStockSnapshots(
  updates: Array<{
    stockItemId: string;
    binId: string;
    quantity: number; // Can be positive (add), negative (deduct), or absolute (set)
    transactionType:
      | "procurement"
      | "dispatch"
      | "transfer"
      | "inventoryCount"
      | "adjustment";
    transactionId: string;
    isAbsolute?: boolean; // true for inventoryCount (SET value), false for others (ADJUST value)
  }>,
  options?: {
    onProgress?: (progress: {
      processed: number;
      total: number;
      batch: number;
    }) => void;
    maxRetries?: number;
  },
): Promise<{
  success: number;
  failed: number;
  results: Array<{
    stockItemId: string;
    binId: string;
    success: boolean;
    error?: string;
  }>;
}> {
  const startTime = Date.now();

  if (!updates || updates.length === 0) {
    logger.debug("📭 No updates to process");
    return { success: 0, failed: 0, results: [] };
  }

  logger.debug(
    `🚀 Starting bulk update for ${updates.length} items (using registry)`,
  );

  try {
    // Use the new registry-based bulk update
    const registryResult = await bulkUpdateStockRegistry(updates, {
      onProgress: (progress) => {
        options?.onProgress?.({
          processed: progress.processed,
          total: progress.total,
          batch: 1,
        });
      },
      maxRetries: options?.maxRetries,
    });

    // Convert to the expected response format
    const results = updates.map((update) => ({
      stockItemId: update.stockItemId,
      binId: update.binId,
      success: true, // Registry updates all or nothing
      error: undefined,
    }));

    const duration = Date.now() - startTime;
    logger.debug(`⏱️ Bulk update completed in ${duration}ms`);

    return {
      success: registryResult.success,
      failed: registryResult.failed,
      results,
    };
  } catch (error) {
    console.error("❌ Bulk update failed:", error);

    // Return all as failed
    return {
      success: 0,
      failed: updates.length,
      results: updates.map((update) => ({
        stockItemId: update.stockItemId,
        binId: update.binId,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })),
    };
  }
}

// ========== PRIVATE HELPER FUNCTIONS ==========

/**
 * Query stock registry for multiple items efficiently
 */
const queryStockRegistry = async (
  stockItemIds: string[],
  binIds: string[],
): Promise<{ [key: string]: number }> => {
  try {
    const query = groq`*[_type == "stockRegistry"][0] {
      stockData
    }`;

    const registry = await client.fetch(query);
    const results: { [key: string]: number } = {};

    if (registry?.stockData?.items) {
      // Create lookup sets for faster checking
      const itemIdSet = new Set(stockItemIds);
      const binIdSet = new Set(binIds);

      registry.stockData.items.forEach((item: any) => {
        if (itemIdSet.has(item.stockItemId) && item.binQuantities?.bins) {
          item.binQuantities.bins.forEach((bin: any) => {
            if (binIdSet.has(bin.binId)) {
              const key = `${item.stockItemId}-${bin.binId}`;
              results[key] = bin.quantity || 0;
            }
          });
        }
      });
    }

    // Fill in missing combinations with 0
    for (const binId of binIds) {
      for (const itemId of stockItemIds) {
        const key = `${itemId}-${binId}`;
        if (results[key] === undefined) {
          results[key] = 0;
        }
      }
    }

    return results;
  } catch (error) {
    console.error("Error querying stock registry:", error);

    // Return zeros for all combinations
    const results: { [key: string]: number } = {};
    for (const binId of binIds) {
      for (const itemId of stockItemIds) {
        results[`${itemId}-${binId}`] = 0;
      }
    }
    return results;
  }
};

/**
 * ATTEMPT 1: Use Sanity transaction API for maximum efficiency
 * ONE API call for ALL updates
 */
async function attemptBulkTransaction(
  updates: any[],
  options?: { onProgress?: (progress: any) => void },
): Promise<any> {
  logger.debug(`🔄 Attempting bulk transaction for ${updates.length} items`);

  // Group by bin for more efficient queries
  const updatesByBin = groupUpdatesByBin(updates);

  const allResults: any[] = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  // Process each bin group separately (bin-level locking)
  for (const [binId, binUpdates] of updatesByBin) {
    logger.debug(`📦 Processing bin ${binId}: ${binUpdates.length} items`);

    try {
      const binResults = await processBinBulkTransaction(binUpdates, binId);
      allResults.push(...binResults.results);
      totalSuccess += binResults.success;
      totalFailed += binResults.failed;

      // Report progress
      options?.onProgress?.({
        processed: totalSuccess + totalFailed,
        total: updates.length,
        batch: 1,
      });
    } catch (binError) {
      console.error(`❌ Failed to process bin ${binId}:`, binError);
      // Mark all items in this bin as failed for now
      binUpdates.forEach((update) => {
        allResults.push({
          stockItemId: update.stockItemId,
          binId: update.binId,
          success: false,
          error: `Bin processing failed: ${binError}`,
        });
        totalFailed++;
      });
    }
  }

  return {
    success: totalSuccess,
    failed: totalFailed,
    results: allResults,
  };
}

/**
 * Process all updates for a single bin in one transaction
 */
async function processBinBulkTransaction(
  updates: any[],
  binId: string,
): Promise<any> {
  // STEP 1: Get ALL existing snapshots for this bin in ONE query
  const itemIds = updates.map((u) => u.stockItemId);

  const existingSnapshots = await client.fetch(
    groq`*[_type == "stockSnapshot" && 
          stockItem._ref in $itemIds && 
          bin._ref == $binId] {
      _id,
      "itemId": stockItem._ref,
      quantity
    }`,
    { itemIds, binId },
  );

  // Create lookup map
  const snapshotMap = new Map();
  existingSnapshots.forEach((snapshot: any) => {
    snapshotMap.set(snapshot.itemId, snapshot);
  });

  // STEP 2: Build transaction with ALL operations
  const now = new Date().toISOString();
  let transactionBuilder = writeClient.transaction();

  const cacheUpdates: Array<{ key: string; quantity: number }> = [];
  const results: any[] = [];

  updates.forEach((update) => {
    try {
      const existing = snapshotMap.get(update.stockItemId);
      const currentQty = existing?.quantity || 0;

      // Calculate new quantity based on transaction type
      let newQuantity: number;
      if (update.isAbsolute || update.transactionType === "inventoryCount") {
        // SET absolute value (inventory counts)
        newQuantity = update.quantity;
      } else {
        // ADJUST by amount (procurement, dispatch, transfer)
        newQuantity = currentQty + update.quantity;

        // For safety: don't go below 0 for dispatches unless explicitly allowed
        if (update.transactionType === "dispatch" && newQuantity < 0) {
          console.warn(
            `⚠️ Dispatch would make stock negative: ${update.stockItemId} in ${binId}`,
          );
          // Decide what to do: set to 0 or allow negative?
          newQuantity = 0; // or newQuantity = currentQty + update.quantity to allow negative
        }
      }

      const snapshotData: any = {
        _type: "stockSnapshot",
        stockItem: {
          _type: "reference",
          _ref: update.stockItemId,
        },
        bin: {
          _type: "reference",
          _ref: binId,
        },
        quantity: newQuantity,
        lastUpdated: now,
      };

      if (existing) {
        // Update existing
        transactionBuilder = transactionBuilder.patch(existing._id, {
          set: snapshotData,
        });
      } else {
        // Create new
        transactionBuilder = transactionBuilder.create(snapshotData);
      }

      // Track cache updates
      const cacheKey = `${update.stockItemId}-${binId}`;
      cacheUpdates.push({ key: cacheKey, quantity: newQuantity });

      // Track result
      results.push({
        stockItemId: update.stockItemId,
        binId,
        success: true,
        previousQuantity: currentQty,
        newQuantity,
      });
    } catch (itemError) {
      console.error(
        `❌ Failed to prepare update for ${update.stockItemId}:`,
        itemError,
      );
      results.push({
        stockItemId: update.stockItemId,
        binId,
        success: false,
        error: itemError,
      });
    }
  });

  // STEP 3: Execute transaction (ONE API call for all items in this bin)
  if (results.some((r) => r.success)) {
    logger.debug(
      `🚀 Executing transaction for bin ${binId}: ${results.filter((r) => r.success).length} operations`,
    );
    await transactionBuilder.commit();

    // Update caches after successful commit
    cacheUpdates.forEach(({ key, quantity }) => {
      snapshotCache.set(key, quantity, {
        confidence: "high",
        transactionType: updates[0]?.transactionType,
      });
      invalidateStockCache(key.split("-")[0]); // itemId
      invalidateStockCache(key.split("-")[1]); // binId
    });
  }

  return {
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

/**
 * Migrate from old stockSnapshot documents to new single registry
 */
export const migrateToStockRegistry = async (): Promise<{
  migrated: number;
  errors: number;
  registryId?: string;
}> => {
  logger.debug("🚚 Starting migration to stock registry...");

  try {
    // 1. Get all existing stock snapshots
    const oldSnapshots = await client.fetch(groq`*[_type == "stockSnapshot"] {
      _id,
      "stockItemId": stockItem._ref,
      "binId": bin._ref,
      quantity,
      lastUpdated,
      lastTransaction,
      lastTransactionType
    }`);

    logger.debug(`📊 Found ${oldSnapshots.length} old snapshots to migrate`);

    if (oldSnapshots.length === 0) {
      logger.debug("✅ No snapshots to migrate");
      return { migrated: 0, errors: 0 };
    }

    // 2. Organize by stock item
    const itemsMap = new Map<string, any>();

    oldSnapshots.forEach((snapshot: any) => {
      const {
        stockItemId,
        binId,
        quantity,
        lastUpdated,
        lastTransaction,
        lastTransactionType,
      } = snapshot;

      if (!itemsMap.has(stockItemId)) {
        itemsMap.set(stockItemId, {
          stockItemId,
          binQuantities: { bins: [] },
        });
      }

      const item = itemsMap.get(stockItemId);
      item.binQuantities.bins.push({
        binId,
        quantity,
        lastUpdated,
        lastTransactionId: lastTransaction?._ref,
        lastTransactionType,
      });
    });

    // 3. Create registry data
    const registryData = {
      _type: "stockRegistry",
      title: "Stock Registry v1",
      stockData: {
        items: Array.from(itemsMap.values()),
      },
      lastUpdated: new Date().toISOString(),
      version: 1,
    };

    // 4. Check if registry already exists
    const existingRegistry = await client.fetch(
      groq`*[_type == "stockRegistry"][0] { _id }`,
    );

    let registryId: string;

    if (existingRegistry) {
      // Update existing
      await writeClient.patch(existingRegistry._id).set(registryData).commit();
      registryId = existingRegistry._id;
      logger.debug(`✅ Updated existing registry with ${itemsMap.size} items`);
    } else {
      // Create new
      const result = await writeClient.create(registryData);
      registryId = result._id;
      logger.debug(`✅ Created new registry with ${itemsMap.size} items`);
    }

    // 5. Count how many old snapshots were migrated
    const migrated = oldSnapshots.length;

    logger.debug(
      `🎉 Migration complete! Migrated ${migrated} snapshots to single registry`,
    );

    return {
      migrated,
      errors: 0,
      registryId,
    };
  } catch (error) {
    console.error("❌ Migration failed:", error);
    return {
      migrated: 0,
      errors: 1,
    };
  }
};

/**
 * ATTEMPT 2: Fallback to batched updates if bulk transaction fails
 */
async function attemptBatchedUpdates(
  updates: any[],
  maxRetries: number,
  options?: { onProgress?: (progress: any) => void },
): Promise<any> {
  logger.debug(`🔄 Starting batched fallback for ${updates.length} items`);

  const BATCH_SIZE = 5; // Small batches to avoid rate limits
  const BASE_DELAY = 100; // ms between batches

  const allResults: any[] = [];
  let totalProcessed = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

    logger.debug(
      `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`,
    );

    let retryCount = 0;
    let batchCompleted = false;
    let batchResults: any[] = [];

    while (!batchCompleted && retryCount <= maxRetries) {
      try {
        // Process batch with individual updates
        batchResults = await Promise.all(
          batch.map((update) => processSingleItemUpdate(update, retryCount)),
        );

        batchCompleted = true;
      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed:`, batchError);
        retryCount++;

        if (retryCount <= maxRetries) {
          logger.debug(
            `  🔄 Retrying batch (attempt ${retryCount}/${maxRetries})`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          ); // Exponential backoff
        } else {
          console.error(
            `❌ Batch ${batchNumber} failed after ${maxRetries} retries`,
          );
          // Mark all as failed
          batchResults = batch.map((update) => ({
            stockItemId: update.stockItemId,
            binId: update.binId,
            success: false,
            error: `Failed after ${maxRetries} retries`,
          }));
          batchCompleted = true;
        }
      }
    }

    allResults.push(...batchResults);
    totalProcessed += batch.length;

    // Report progress
    options?.onProgress?.({
      processed: totalProcessed,
      total: updates.length,
      batch: batchNumber,
    });

    // Delay between batches
    if (i + BATCH_SIZE < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY));
    }
  }

  const success = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;

  logger.debug(
    `✅ Batched fallback complete: ${success} succeeded, ${failed} failed`,
  );

  return {
    success,
    failed,
    results: allResults,
  };
}

/**
 * Process a single item update (for fallback mode)
 */
async function processSingleItemUpdate(
  update: any,
  retryCount: number,
): Promise<any> {
  const lockKey = `${update.stockItemId}-${update.binId}`;
  const mutex = getMutexForKey(lockKey);

  return mutex.runExclusive(async () => {
    try {
      // Get current snapshot
      const currentSnapshot = await client.fetch(
        groq`*[_type == "stockSnapshot" && 
              stockItem._ref == $itemId && 
              bin._ref == $binId][0]`,
        { itemId: update.stockItemId, binId: update.binId },
      );

      const currentQty = currentSnapshot?.quantity || 0;

      // Calculate new quantity
      let newQuantity: number;
      if (update.isAbsolute || update.transactionType === "inventoryCount") {
        newQuantity = update.quantity;
      } else {
        newQuantity = currentQty + update.quantity;

        // Safety check for dispatches
        if (update.transactionType === "dispatch" && newQuantity < 0) {
          console.warn(
            `⚠️ Dispatch makes stock negative: ${update.stockItemId} in ${update.binId}`,
          );
          newQuantity = 0; // or handle differently
        }
      }

      const now = new Date().toISOString();
      const snapshotData: any = {
        _type: "stockSnapshot",
        stockItem: {
          _type: "reference",
          _ref: update.stockItemId,
        },
        bin: {
          _type: "reference",
          _ref: update.binId,
        },
        quantity: newQuantity,
        lastUpdated: now,
      };

      if (currentSnapshot) {
        await writeClient.patch(currentSnapshot._id).set(snapshotData).commit();
      } else {
        await writeClient.create(snapshotData);
      }

      // Update cache
      const cacheKey = `${update.stockItemId}-${update.binId}`;
      snapshotCache.set(cacheKey, newQuantity, {
        confidence: "high",
        fallback: true,
        retryCount,
      });
      invalidateStockCache(update.stockItemId);
      invalidateStockCache(update.binId);

      return {
        stockItemId: update.stockItemId,
        binId: update.binId,
        success: true,
        previousQuantity: currentQty,
        newQuantity,
        retryCount,
      };
    } catch (error) {
      console.error(
        `❌ Failed to update ${update.stockItemId}-${update.binId}:`,
        error,
      );
      return {
        stockItemId: update.stockItemId,
        binId: update.binId,
        success: false,
        error: error,
        retryCount,
      };
    }
  });
}

/**
 * Group updates by bin for more efficient processing
 */
function groupUpdatesByBin(updates: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();

  updates.forEach((update) => {
    if (!map.has(update.binId)) {
      map.set(update.binId, []);
    }
    map.get(update.binId)!.push(update);
  });

  return map;
}

// Validation function for dispatch items
export const validateDispatchItems = async (
  dispatchId: string,
): Promise<{
  valid: boolean;
  items: Array<{
    stockItemId: string;
    binId: string | null;
    quantity: number;
    itemName?: string;
    binName?: string;
  }>;
  missingBins: string[];
}> => {
  try {
    const query = groq`*[_type == "DispatchLog" && _id == $dispatchId][0] {
            "dispatchedItems": dispatchedItems[]{
                "stockItemId": stockItem._ref,
                "stockItemName": stockItem->name,
                dispatchedQuantity,
                "sourceBinId": sourceBin._ref,
                "sourceBinName": sourceBin->name
            }
        }`;

    const dispatch = await client.fetch(query, { dispatchId });

    if (!dispatch || !dispatch.dispatchedItems) {
      return {
        valid: false,
        items: [],
        missingBins: ["Dispatch not found"],
      };
    }

    const items = dispatch.dispatchedItems.map((item: any) => ({
      stockItemId: item.stockItemId,
      binId: item.sourceBinId,
      quantity: item.dispatchedQuantity || 0,
      itemName: item.stockItemName,
      binName: item.sourceBinName,
    }));

    const missingBins = items
      .filter((item: { binId: any }) => !item.binId)
      .map(
        (item: { itemName: any }) =>
          `Item "${item.itemName}" missing source bin`,
      );

    return {
      valid: missingBins.length === 0,
      items,
      missingBins,
    };
  } catch (error) {
    console.error("Error validating dispatch items:", error);
    return {
      valid: false,
      items: [],
      missingBins: [`Validation error: ${error}`],
    };
  }
};

export const debugDispatchStock = async (dispatchId: string): Promise<void> => {
  logger.debug(`🔍 Debugging dispatch ${dispatchId} stock deduction...`);

  // Get the dispatch
  const dispatch = await client.fetch(
    groq`*[_type == "DispatchLog" && _id == $dispatchId][0] {
          dispatchNumber,
          evidenceStatus,
          status,
          "dispatchedItems": dispatchedItems[]{
              "stockItemId": stockItem._ref,
              "stockItemName": stockItem->name,
              dispatchedQuantity,
              "sourceBinId": sourceBin._ref,
              "sourceBinName": sourceBin->name
          }
      }`,
    { id: dispatchId },
  );

  if (!dispatch) {
    console.error(`❌ Dispatch ${dispatchId} not found`);
    return;
  }

  logger.debug(
    `📋 Dispatch ${dispatch.dispatchNumber} (${dispatch.evidenceStatus}, ${dispatch.status})`,
  );
  logger.debug(`📦 ${dispatch.dispatchedItems?.length || 0} items to process:`);

  // Check each item
  for (const item of dispatch.dispatchedItems || []) {
    logger.debug(`  └─ ${item.stockItemName}:`, {
      quantity: item.dispatchedQuantity,
      bin: item.sourceBinName || "NO BIN!",
      binId: item.sourceBinId || "MISSING",
    });

    if (item.sourceBinId) {
      // Check current stock
      const currentStock = await calculateStock(
        item.stockItemId,
        item.sourceBinId,
      );
      logger.debug(`     Current stock: ${currentStock.quantity}`);
      logger.debug(
        `     After dispatch: ${currentStock.quantity - item.dispatchedQuantity}`,
      );
    }
  }
};

// Replace the old mutex system with a new one that prevents timer conflicts
class StockCalculationManager {
  private static instance: StockCalculationManager;
  private calculationLocks = new Map<string, boolean>();
  private activeTimers = new Map<string, number>();
  private calculationQueue = new Map<string, Array<() => void>>();

  private constructor() {}

  static getInstance(): StockCalculationManager {
    if (!StockCalculationManager.instance) {
      StockCalculationManager.instance = new StockCalculationManager();
    }
    return StockCalculationManager.instance;
  }

  async acquireCalculationLock(key: string): Promise<() => void> {
    // If calculation is already in progress, queue this request
    if (this.calculationLocks.has(key)) {
      return new Promise((resolve) => {
        if (!this.calculationQueue.has(key)) {
          this.calculationQueue.set(key, []);
        }
        // Push a function that will resolve with the release function
        this.calculationQueue.get(key)!.push(async () => {
          const release = await this.acquireCalculationLock(key);
          resolve(release);
        });
      });
    }

    this.calculationLocks.set(key, true);
    return () => this.releaseCalculationLock(key);
  }

  private releaseCalculationLock(key: string): void {
    this.calculationLocks.delete(key);

    // Process next request in queue if any
    const queue = this.calculationQueue.get(key);
    if (queue && queue.length > 0) {
      const nextCallback = queue.shift()!;
      setTimeout(nextCallback, 0); // Process next in queue asynchronously
    }
  }

  startTimer(key: string): void {
    const timerId = Date.now();
    this.activeTimers.set(key, timerId);
    logger.time(key);
  }

  endTimer(key: string): boolean {
    const timerId = this.activeTimers.get(key);
    if (timerId) {
      logger.timeEnd(key);
      this.activeTimers.delete(key);
      return true;
    }
    return false;
  }

  hasActiveTimer(key: string): boolean {
    return this.activeTimers.has(key);
  }

  clearAllTimers(): void {
    this.activeTimers.clear();
  }

  // Expose lock state for getActiveCalculations
  getLockKeys(): string[] {
    return Array.from(this.calculationLocks.keys());
  }
}

// Global instance
const calculationManager = StockCalculationManager.getInstance();

// Create a mutex for stock updates (keep existing for write operations)
const stockUpdateMutexes = new Map<string, Mutex>();

const getMutexForKey = (key: string): Mutex => {
  if (!stockUpdateMutexes.has(key)) {
    stockUpdateMutexes.set(key, new Mutex());
  }
  return stockUpdateMutexes.get(key)!;
};

// Clean up old mutexes periodically
setInterval(() => {
  // Remove mutexes older than 1 hour
  // (In a real app, you'd track usage)
}, 3600000);
// ========== UX ENHANCEMENTS & METRICS ==========

interface CalculationMetrics {
  timestamp: number;
  duration: number;
  cacheHit: boolean;
  itemsProcessed: number;
  fromCache: number;
  calculated: number;
  error?: string;
}

// Store recent calculation metrics for performance insights
const recentMetrics: CalculationMetrics[] = [];
const MAX_METRICS_HISTORY = 100;

// Track performance for user feedback
const trackMetric = (metric: CalculationMetrics) => {
  recentMetrics.unshift(metric);
  if (recentMetrics.length > MAX_METRICS_HISTORY) {
    recentMetrics.pop();
  }
};

// Get average calculation time for user feedback
export const getPerformanceStats = () => {
  if (recentMetrics.length === 0) return null;

  const avgDuration =
    recentMetrics.reduce((sum, m) => sum + m.duration, 0) /
    recentMetrics.length;
  const cacheHitRate =
    (recentMetrics.filter((m) => m.cacheHit).length / recentMetrics.length) *
    100;

  return {
    avgDuration: Math.round(avgDuration),
    cacheHitRate: Math.round(cacheHitRate),
    totalCalculations: recentMetrics.length,
    lastCalculation: recentMetrics[0]?.timestamp || null,
  };
};

// ========== ENHANCED CACHE MANAGEMENT ==========

// Replace the existing snapshotCache with a better implementation
class OptimizedSnapshotCache {
  private cache = new Map<
    string,
    {
      quantity: number;
      timestamp: number;
      metadata?: {
        confidence?: "high" | "medium" | "low";
        transactionCount?: number;
      };
    }
  >();
  private readonly MAX_SIZE = 1000;
  private readonly TTL = 30000; // 30 seconds
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Clean up every minute
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.TTL) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`🧹 Cleaned ${cleaned} expired cache entries`);
    }
  }

  get(
    key: string,
  ): { quantity: number; timestamp: number; metadata?: any } | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    // Check TTL
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return undefined;
    }

    return cached;
  }

  set(key: string, quantity: number, metadata?: any): void {
    // Clean up if cache is too large (simple LIFO eviction)
    if (this.cache.size >= this.MAX_SIZE) {
      const oldestKey = Array.from(this.cache.keys())[0];
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      quantity,
      timestamp: Date.now(),
      metadata,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Replace the old snapshotCache with the new class
const snapshotCache = new OptimizedSnapshotCache();

// Replace the old cleanupSnapshotCache function
const cleanupSnapshotCache = () => {
  // The OptimizedSnapshotCache class handles its own cleanup
  // We keep the setInterval but simplify the function to only log cache size
  logger.debug(`📊 Snapshot cache size: ${snapshotCache.size()}`);
};

// Run cleanup every minute (now only logs size)
setInterval(cleanupSnapshotCache, 60000);

// ========== PRIVATE HELPER FUNCTIONS ==========

// Get or create stock snapshot with enhanced caching
// Get or create stock snapshot with enhanced caching - NEW SINGLE DOCUMENT VERSION
const getStockSnapshot = async (
  stockItemId: string,
  binId: string,
): Promise<number> => {
  const cacheKey = `${stockItemId}-${binId}`;

  // 1. Check cache first
  const cached = snapshotCache.get(cacheKey);
  if (cached) {
    return cached.quantity;
  }

  try {
    // 2. Get from single stock registry document
    const query = groq`*[_type == "stockRegistry"][0] {
      stockData
    }`;

    const registry = await client.fetch(query);

    if (registry?.stockData?.items) {
      // Find the item
      const itemEntry = registry.stockData.items.find(
        (item: any) => item.stockItemId === stockItemId,
      );

      if (itemEntry?.binQuantities?.bins) {
        // Find the bin
        const binEntry = itemEntry.binQuantities.bins.find(
          (bin: any) => bin.binId === binId,
        );

        if (binEntry) {
          const quantity = binEntry.quantity || 0;
          snapshotCache.set(cacheKey, quantity, { confidence: "high" });
          return quantity;
        }
      }
    }

    // 3. No entry found - calculate and create
    logger.debug(
      `🔍 No registry entry for ${stockItemId}-${binId}, calculating...`,
    );
    const calculatedStock = await calculateStockExactLogic(
      stockItemId,
      binId,
      true,
    );

    // 4. Update registry
    await updateStockRegistry(
      stockItemId,
      binId,
      calculatedStock,
      "auto_init",
      null,
    );

    // 5. Cache and return
    snapshotCache.set(cacheKey, calculatedStock, { confidence: "high" });
    return calculatedStock;
  } catch (error) {
    console.error("Error getting stock from registry:", error);
    return 0;
  }
};

// Update single stock registry document
const updateStockRegistry = async (
  stockItemId: string,
  binId: string,
  quantity: number,
  transactionType: string,
  transactionId: string | null,
): Promise<void> => {
  const startTime = Date.now();

  try {
    // 1. Get existing registry
    const query = groq`*[_type == "stockRegistry"][0] {
      _id,
      stockData
    }`;

    const existingRegistry = await client.fetch(query);
    const now = new Date().toISOString();

    // 2. Prepare update
    let registryData: any;

    if (existingRegistry) {
      // Update existing
      registryData = existingRegistry.stockData || { items: [] };
    } else {
      // Create new
      registryData = { items: [] };
    }

    // 3. Find or create item entry
    let itemIndex = registryData.items.findIndex(
      (item: any) => item.stockItemId === stockItemId,
    );

    if (itemIndex === -1) {
      // Create new item entry
      registryData.items.push({
        stockItemId,
        binQuantities: { bins: [] },
      });
      itemIndex = registryData.items.length - 1;
    }

    // 4. Find or create bin entry
    const itemEntry = registryData.items[itemIndex];
    let binIndex = itemEntry.binQuantities.bins.findIndex(
      (bin: any) => bin.binId === binId,
    );

    if (binIndex === -1) {
      // Create new bin entry
      itemEntry.binQuantities.bins.push({
        binId,
        quantity,
        lastUpdated: now,
        lastTransactionId: transactionId,
        lastTransactionType: transactionType,
      });
      binIndex = itemEntry.binQuantities.bins.length - 1;
    } else {
      // Update existing bin entry
      itemEntry.binQuantities.bins[binIndex] = {
        binId,
        quantity,
        lastUpdated: now,
        lastTransactionId: transactionId,
        lastTransactionType: transactionType,
      };
    }

    // 5. Save to database
    if (existingRegistry) {
      await writeClient
        .patch(existingRegistry._id)
        .set({
          stockData: registryData,
          lastUpdated: now,
        })
        .commit();
    } else {
      await writeClient.create({
        _type: "stockRegistry",
        title: "Stock Registry v1",
        stockData: registryData,
        lastUpdated: now,
        version: 1,
      });
    }

    // 6. Update cache
    const cacheKey = `${stockItemId}-${binId}`;
    snapshotCache.set(cacheKey, quantity, { confidence: "high" });
    invalidateStockCache(stockItemId);
    invalidateStockCache(binId);

    const duration = Date.now() - startTime;
    logger.debug(
      `📝 Updated registry for ${stockItemId}-${binId}: ${quantity} (${duration}ms)`,
    );
  } catch (error) {
    console.error("Error updating stock registry:", error);
    throw error;
  }
};

/**
 * Create a new stock entry in registry (doesn't update existing)
 */
const createStockSnapshot = async (
  stockItemId: string,
  binId: string,
  quantity: number,
): Promise<void> => {
  // Use registry system
  return updateStockRegistry(stockItemId, binId, quantity, "initial", null);
};

// Calculate stock from transactions (for initial snapshot or validation)
// Calculate stock from transactions (for initial snapshot or validation)
// Calculate stock from transactions (for initial snapshot or validation)
// In the calculateStockFromTransactions function, update the dispatch processing:
// In the calculateStockFromTransactions function, update the dispatch processing:

export const calculateStockFromTransactions = async (
  stockItemId: string,
  binId: string,
  verbose: boolean = true,
  asOfDate?: Date,
): Promise<number> => {
  const startTime = Date.now();

  if (verbose) {
    const dateStr = asOfDate
      ? ` as of ${asOfDate.toISOString().split("T")[0]}`
      : "";
    logger.debug(
      `🧮 Calculating stock for ${stockItemId} in ${binId}${dateStr} from transactions`,
    );
  }

  try {
    const dateFilter = asOfDate ? `&& date <= $asOfDate` : "";
    const asOfDateStr = asOfDate?.toISOString();

    const query = groq`{
      "allEvents": *[_type in ["GoodsReceipt", "DispatchLog", "InternalTransfer", "InventoryCount"] && 
        ((_type == "GoodsReceipt" && receivingBin._ref == $binId && status in ["completed", "processed"]) ||
         (_type == "DispatchLog" && sourceBin._ref == $binId && status in ["completed", "processed"]) ||
         (_type == "InternalTransfer" && status == "completed" && (fromBin._ref == $binId || toBin._ref == $binId)) ||
         (_type == "InventoryCount" && bin._ref == $binId && status == "completed"))
        ${dateFilter}
      ] | order(date asc) {
        _type,
        "date": coalesce(receiptDate, dispatchDate, transferDate, countDate),
        receivedItems[] {
          "itemId": stockItem._ref,
          "quantity": receivedQuantity
        },
        dispatchedItems[] {
          "itemId": stockItem._ref,
          "quantity": dispatchedQuantity
        },
        transferredItems[] {
          "itemId": stockItem._ref,
          "quantity": transferredQuantity,
          "fromBinId": ^.fromBin._ref,
          "toBinId": ^.toBin._ref
        },
        countedItems[] {
          "itemId": stockItem._ref,
          "quantity": countedQuantity
        }
      }
    }`;

    const data = await client.fetch(query, {
      binId,
      stockItemId,
      asOfDate: asOfDateStr,
    });

    logger.debug(`📊 Found ${data.allEvents?.length || 0} events`);

    // Log each goods receipt to check for duplicates
    data.allEvents?.forEach((event: any, index: number) => {
      if (event._type === "GoodsReceipt") {
        logger.debug(`📝 Goods Receipt ${index}: ${event._id}`);
        event.receivedItems?.forEach((item: any) => {
          if (item.itemId === stockItemId) {
            logger.debug(`   Item: ${item.itemId}, Quantity: ${item.quantity}`);
          }
        });
      }
    });

    let stock = new Decimal(0);
    let lastCountDate: Date | null = null;

    // --- Add Archived Transactions ---
    try {
      const archived = await getArchivedTransactionsForItem(stockItemId, binId);
      if (!data.allEvents) data.allEvents = [];

      archived.forEach((tx) => {
        const mappedTx: any = { _type: "", date: tx.date };
        if (tx.type === "receipt") {
          mappedTx._type = "GoodsReceipt";
          mappedTx.receivedItems = [
            { itemId: stockItemId, quantity: tx.quantity },
          ];
        } else if (tx.type === "dispatch") {
          mappedTx._type = "DispatchLog";
          mappedTx.dispatchedItems = [
            { itemId: stockItemId, quantity: Math.abs(tx.quantity) },
          ];
        } else if (tx.type === "transferOut") {
          mappedTx._type = "InternalTransfer";
          mappedTx.transferredItems = [
            {
              itemId: stockItemId,
              quantity: Math.abs(tx.quantity),
              fromBinId: binId,
              toBinId: "",
            },
          ];
        } else if (tx.type === "transferIn") {
          mappedTx._type = "InternalTransfer";
          mappedTx.transferredItems = [
            {
              itemId: stockItemId,
              quantity: tx.quantity,
              fromBinId: "",
              toBinId: binId,
            },
          ];
        } else if (tx.type === "count") {
          mappedTx._type = "InventoryCount";
          mappedTx.countedItems = [
            { itemId: stockItemId, quantity: tx.quantity },
          ];
        }
        data.allEvents.push(mappedTx);
      });

      // Re-sort to include archived transactions
      data.allEvents.sort((a: any, b: any) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateA - dateB;
      });
    } catch (e) {
      console.warn("⚠️ Could not fetch archived transactions:", e);
    }

    // Process events in chronological order
    data.allEvents?.forEach((event: any) => {
      const eventDate = event.date ? new Date(event.date) : null;

      // Check if we should skip this event
      if (lastCountDate && eventDate && eventDate < lastCountDate) {
        return; // Skip transactions that happened before the last count
      }

      // Process goods receipts
      event.receivedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          stock = stock.plus(item.quantity || 0);
        }
      });

      // Process dispatches - ONLY if status is "completed" or "processed"
      event.dispatchedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          const dispatchQty = new Decimal(item.quantity || 0);
          // NOTE: negative stock is allowed here to stay consistent with
          // calculateStockForBin/calculateStockExactLogic, which both let
          // stock go negative rather than clamping to 0 — clamping would
          // silently hide over-dispatch instead of surfacing it.
          if (dispatchQty.greaterThan(stock)) {
            console.warn(
              `⚠️ Dispatch exceeds available stock for ${stockItemId} in ${binId}. Available: ${stock.toNumber()}, Dispatch: ${dispatchQty.toNumber()}`,
            );
          }
          stock = stock.minus(dispatchQty);
        }
      });

      // Process transfers
      event.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          // Transfer OUT from this bin
          if (event.fromBinId === binId) {
            const transferQty = new Decimal(item.quantity || 0);
            if (transferQty.greaterThan(stock)) {
              console.warn(
                `⚠️ Transfer out exceeds available stock for ${stockItemId} in ${binId}. Available: ${stock.toNumber()}, Transfer: ${transferQty.toNumber()}`,
              );
            }
            stock = stock.minus(transferQty);
          }
          // Transfer IN to this bin
          if (event.toBinId === binId) {
            stock = stock.plus(item.quantity || 0);
          }
        }
      });

      // Process inventory counts - these SET the stock level
      event.countedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          stock = new Decimal(item.quantity || 0);
          if (eventDate) {
            lastCountDate = eventDate;
          }
        }
      });
    });

    const duration = Date.now() - startTime;

    if (verbose) {
      logger.debug(
        `✅ Calculated stock for ${stockItemId} in ${binId}: ${stock.toNumber()} (${duration}ms)`,
      );

      if (lastCountDate !== null && lastCountDate !== undefined) {
        const date: Date = lastCountDate;
        if (!isNaN(date.getTime())) {
          logger.debug(
            `   📅 Last inventory count: ${date.toISOString().split("T")[0]}`,
          );
        }
      }
    }

    return stock.toNumber();
  } catch (error) {
    console.error("Error calculating stock from transactions:", error);
    return 0;
  }
};

// Update stock snapshot (internal use)
// Update stock registry (replaces old updateStockSnapshot)
const updateStockSnapshot = async (
  stockItemId: string,
  binId: string,
  quantity: number,
  transactionType: string,
  transactionId: string | null,
): Promise<void> => {
  // Use new registry system
  return updateStockRegistry(
    stockItemId,
    binId,
    quantity,
    transactionType,
    transactionId,
  );
};

// Helper function to calculate stock for multiple items in one bin
// Helper function to calculate stock for multiple items in one bin
export const calculateStockForBin = async (
  binId: string,
  itemIds: string[],
  onProgress?: (progress: number) => void,
): Promise<{ [key: string]: number }> => {
  const startTime = Date.now();

  // Use calculation manager to prevent duplicate calculations
  const lockKey = `bin-calculation-${binId}`;
  const releaseLock = await calculationManager.acquireCalculationLock(lockKey);

  try {
    const timerKey = `📥 Fetching transactions for bin ${binId}`;
    // Use manager to check/start timer
    if (!calculationManager.hasActiveTimer(timerKey)) {
      calculationManager.startTimer(timerKey);
    }

    const transactionQuery = groq`{
      "goodsReceipts": *[
        _type == "GoodsReceipt" && 
        receivingBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(receiptDate asc) {
        receiptDate,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity
        }
      },
      
      "dispatches": *[
        _type == "DispatchLog" && 
        sourceBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(dispatchDate asc) {
        dispatchDate,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity
        }
      },
      
      "transfersOut": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        fromBin._ref == $binId
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "transfersIn": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        toBin._ref == $binId
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "inventoryCounts": *[
        _type == "InventoryCount" && 
        bin._ref == $binId &&
        status == "completed"
      ] | order(countDate asc) { 
        countDate,
        countedItems[] {
          "itemId": stockItem._ref,
          countedQuantity
        }
      },
      
      // Get item names for better logging
      "itemDetails": *[_type == "StockItem" && _id in $itemIds]{
        _id,
        name,
        sku
      }
    }`;

    const data = await client.fetch(transactionQuery, { binId, itemIds });

    calculationManager.endTimer(timerKey); // End timer if we started it

    // Initialize results with Decimals
    const results: { [key: string]: Decimal } = {};
    const itemMap = new Map<string, string>();

    data.itemDetails?.forEach((item: any) => {
      itemMap.set(item._id, item.name || item.sku || item._id);
    });

    itemIds.forEach((itemId) => {
      results[`${itemId}-${binId}`] = new Decimal(0);
    });

    // Progress tracking
    let processedItems = 0;
    const totalItems = itemIds.length * 5; // 4 transaction types + inventory counts

    // Process all transactions efficiently
    const processTimerKey = `⚡ Processing transactions for bin ${binId}`;
    if (!calculationManager.hasActiveTimer(processTimerKey)) {
      calculationManager.startTimer(processTimerKey);
    }

    // Helper function to update progress
    const updateProgress = () => {
      processedItems++;
      if (onProgress && totalItems > 0) {
        onProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100)),
        );
      }
    };

    // Process goods receipts
    data.goodsReceipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId && itemIds.includes(item.itemId)) {
          const key = `${item.itemId}-${binId}`;
          results[key] = results[key].plus(item.receivedQuantity || 0);
          updateProgress();
        }
      });
    });

    // Process transfers out
    data.transfersOut?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId && itemIds.includes(item.itemId)) {
          const key = `${item.itemId}-${binId}`;
          const transferQty = new Decimal(item.transferredQuantity || 0);
          // Prevent negative stock
          if (results[key].greaterThanOrEqualTo(transferQty)) {
            results[key] = results[key].minus(transferQty);
          } else {
            results[key] = new Decimal(0);
          }
          updateProgress();
        }
      });
    });

    // Process transfers in
    data.transfersIn?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId && itemIds.includes(item.itemId)) {
          const key = `${item.itemId}-${binId}`;
          results[key] = results[key].plus(item.transferredQuantity || 0);
          updateProgress();
        }
      });
    });

    // **CRITICAL FIX: Process ALL transactions chronologically for each item**
    // This ensures inventory counts work correctly AND items not in counts keep their value

    // **FIXED: Process ALL transactions chronologically with proper inventory count logic**
    itemIds.forEach((itemId) => {
      const key = `${itemId}-${binId}`;

      // Collect ALL transactions for this item
      const itemTransactions: Array<{
        date: Date;
        type: "receipt" | "dispatch" | "transferOut" | "transferIn" | "count";
        quantity: Decimal;
      }> = [];

      // Add goods receipts
      data.goodsReceipts?.forEach((receipt: any) => {
        receipt.receivedItems?.forEach((item: any) => {
          if (item.itemId === itemId) {
            itemTransactions.push({
              date: new Date(receipt.receiptDate),
              type: "receipt",
              quantity: new Decimal(item.receivedQuantity || 0),
            });
          }
        });
      });

      // Add dispatches
      data.dispatches?.forEach((dispatch: any) => {
        dispatch.dispatchedItems?.forEach((item: any) => {
          if (item.itemId === itemId) {
            itemTransactions.push({
              date: new Date(dispatch.dispatchDate),
              type: "dispatch",
              quantity: new Decimal(item.dispatchedQuantity || 0),
            });
          }
        });
      });

      // Add transfers out
      data.transfersOut?.forEach((transfer: any) => {
        transfer.transferredItems?.forEach((item: any) => {
          if (item.itemId === itemId) {
            itemTransactions.push({
              date: new Date(transfer.transferDate),
              type: "transferOut",
              quantity: new Decimal(item.transferredQuantity || 0),
            });
          }
        });
      });

      // Add transfers in
      data.transfersIn?.forEach((transfer: any) => {
        transfer.transferredItems?.forEach((item: any) => {
          if (item.itemId === itemId) {
            itemTransactions.push({
              date: new Date(transfer.transferDate),
              type: "transferIn",
              quantity: new Decimal(item.transferredQuantity || 0),
            });
          }
        });
      });

      // Add inventory counts - ONLY if this item was counted
      data.inventoryCounts?.forEach((count: any) => {
        count.countedItems?.forEach((item: any) => {
          if (item.itemId === itemId) {
            itemTransactions.push({
              date: new Date(count.countDate),
              type: "count",
              quantity: new Decimal(item.countedQuantity || 0),
            });
          }
        });
      });

      // Sort ALL transactions chronologically
      itemTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Process in chronological order with FIXED inventory count logic
      let currentStock = new Decimal(0);
      const countTimeline: Array<{ date: Date; quantity: Decimal }> = [];

      // First pass: collect all inventory counts
      itemTransactions.forEach((tx) => {
        if (tx.type === "count") {
          countTimeline.push({ date: tx.date, quantity: tx.quantity });
        }
      });

      // Find the most recent count before each transaction
      itemTransactions.forEach((tx) => {
        // Find the most recent count that happened ON or BEFORE this transaction
        let applicableCount: Decimal | null = null;
        let applicableCountDate: Date | null = null;

        for (let i = countTimeline.length - 1; i >= 0; i--) {
          if (countTimeline[i].date <= tx.date) {
            applicableCount = countTimeline[i].quantity;
            applicableCountDate = countTimeline[i].date;
            break;
          }
        }

        // If this transaction is a count, it becomes the new baseline
        if (tx.type === "count") {
          currentStock = tx.quantity;
        }
        // Only process regular transactions if they happen AFTER the most recent count
        else if (
          applicableCountDate === null ||
          tx.date > applicableCountDate
        ) {
          switch (tx.type) {
            case "receipt":
            case "transferIn":
              currentStock = currentStock.plus(tx.quantity);
              break;
            case "dispatch":
            case "transferOut":
              currentStock = currentStock.minus(tx.quantity); // ALLOW NEGATIVE
              break;
          }
        }
        // If transaction happened BEFORE the most recent count, skip it
        // (it's already accounted for in the count)
      });

      results[key] = currentStock;
      updateProgress();
    });

    calculationManager.endTimer(processTimerKey); // End timer if we started it

    // Convert Decimal results to numbers and cache
    const finalResults: { [key: string]: number } = {};
    Object.entries(results).forEach(([key, decimalQuantity]) => {
      const quantity = decimalQuantity.toNumber();
      finalResults[key] = quantity;

      // Cache individual results for faster single-item lookups
      const [itemId, binId] = key.split("-");
      setCachedStockItem(`single-${itemId}-${binId}`, key, quantity);
    });

    const duration = Date.now() - startTime;
    logger.debug(
      `✅ Calculated ${itemIds.length} items for bin ${binId} in ${duration}ms`,
    );

    return finalResults;
  } catch (error) {
    console.error(`❌ Error calculating stock for bin ${binId}:`, error);
    // Return zeros but track the error
    const results: { [key: string]: number } = {};
    itemIds.forEach((itemId) => {
      results[`${itemId}-${binId}`] = 0;
    });
    return results;
  } finally {
    releaseLock();
  }
};

// Original method as fallback
const calculateBulkStockOriginal = async (
  stockItemIds: string[],
  binIds: string[],
): Promise<{ [key: string]: number }> => {
  const results: { [key: string]: number } = {};

  for (const binId of binIds) {
    for (const itemId of stockItemIds) {
      const key = `${itemId}-${binId}`;
      results[key] = await getStockSnapshot(itemId, binId);
    }
  }

  return results;
};

// ========== ENHANCED PUBLIC API FUNCTIONS ==========

// Input validation helper
const validateStockInput = (stockItemId: string, binId: string): void => {
  if (!stockItemId || typeof stockItemId !== "string") {
    throw new Error("Invalid stockItemId: must be a non-empty string");
  }
  if (!binId || typeof binId !== "string") {
    throw new Error("Invalid binId: must be a non-empty string");
  }
};

type StockRegistryBulkUpdate = {
  stockItemId: string;
  binId: string;
  quantity: number;
  transactionType:
    | "procurement"
    | "dispatch"
    | "transfer"
    | "inventoryCount"
    | "adjustment";
  transactionId: string;
  isAbsolute?: boolean;
};

const validBulkRegistryTransactionTypes = new Set([
  "procurement",
  "dispatch",
  "transfer",
  "inventoryCount",
  "adjustment",
]);

const validateBulkStockRegistryUpdate = (
  update: any,
): update is StockRegistryBulkUpdate => {
  if (!update || typeof update !== "object") {
    return false;
  }

  if (!update.stockItemId || typeof update.stockItemId !== "string") {
    return false;
  }

  if (!update.binId || typeof update.binId !== "string") {
    return false;
  }

  if (typeof update.quantity !== "number" || Number.isNaN(update.quantity)) {
    return false;
  }

  if (!validBulkRegistryTransactionTypes.has(update.transactionType)) {
    return false;
  }

  if (!update.transactionId || typeof update.transactionId !== "string") {
    return false;
  }

  if (
    update.isAbsolute !== undefined &&
    typeof update.isAbsolute !== "boolean"
  ) {
    return false;
  }

  return true;
};

const normalizeBulkStockRegistryUpdate = (
  update: StockRegistryBulkUpdate,
): StockRegistryBulkUpdate => ({
  stockItemId: update.stockItemId,
  binId: update.binId,
  quantity: update.quantity,
  transactionType: update.transactionType,
  transactionId: update.transactionId,
  isAbsolute: update.isAbsolute ?? update.transactionType === "inventoryCount",
});

// 1. Single item calculation with detailed error reporting
// Then in the calculateStock function, add validation at the beginning:
export const calculateStock = async (
  stockItemId: string,
  binId: string,
): Promise<{ quantity: number; metadata?: any; error?: string }> => {
  const startTime = Date.now();

  try {
    validateStockInput(stockItemId, binId); // Add this line

    if (!stockItemId || !binId) {
      throw new Error("Missing itemId or binId");
    }

    const results = await calculateBulkStock([stockItemId], [binId]);
    const key = `${stockItemId}-${binId}`;
    const quantity = results[key] || 0;

    const duration = Date.now() - startTime;

    trackMetric({
      timestamp: Date.now(),
      duration,
      cacheHit: false, // Will be tracked in calculateBulkStock
      itemsProcessed: 1,
      fromCache: 0,
      calculated: 1,
    });

    return {
      quantity,
      metadata: {
        calculationTime: duration,
        cached: false,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    trackMetric({
      timestamp: Date.now(),
      duration,
      cacheHit: false,
      itemsProcessed: 1,
      fromCache: 0,
      calculated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      quantity: 0,
      error:
        error instanceof Error ? error.message : "Failed to calculate stock",
    };
  }
};

// 2. Bulk calculation: reads the (cached, parsed) registry and only falls back
// to transaction replay for item/bin pairs the registry has never seen.
const BACKFILL_CONCURRENCY = 8;

export const calculateBulkStock = async (
  stockItemIds: string[],
  binIds: string[],
  onProgress?: (progress: { stage: string; percentage: number }) => void,
): Promise<{ [key: string]: number }> => {
  const startTime = Date.now();

  if (stockItemIds.length === 0 || binIds.length === 0) {
    return {};
  }

  try {
    onProgress?.({ stage: "Fetching from registry...", percentage: 10 });

    const registryMap = await getRegistryMap(() =>
      client.fetch(groq`*[_type == "stockRegistry"][0] { stockData }`),
    );

    onProgress?.({ stage: "Processing registry data...", percentage: 30 });

    const results: { [key: string]: number } = {};
    const itemsWithoutSnapshots: Array<{ itemId: string; binId: string }> = [];

    for (const binId of binIds) {
      for (const itemId of stockItemIds) {
        const key = `${itemId}-${binId}`;
        const qty = registryMap?.get(key);
        if (qty !== undefined) {
          results[key] = qty;
        } else {
          results[key] = 0;
          itemsWithoutSnapshots.push({ itemId, binId });
        }
      }
    }

    if (itemsWithoutSnapshots.length > 0) {
      onProgress?.({ stage: "Calculating missing data...", percentage: 50 });
      logger.debug(`Backfilling ${itemsWithoutSnapshots.length} missing snapshots`);

      // Serialise backfills so concurrent requests don't recompute (and
      // double-write) the same missing pairs.
      const releaseLock = await calculationManager.acquireCalculationLock("bulk-backfill");
      try {
        // A concurrent request may have just filled some of them in.
        const fresh = await getRegistryMap(() =>
          client.fetch(groq`*[_type == "stockRegistry"][0] { stockData }`),
        );
        const stillMissing = itemsWithoutSnapshots.filter(({ itemId, binId }) => {
          const qty = fresh?.get(`${itemId}-${binId}`);
          if (qty !== undefined) results[`${itemId}-${binId}`] = qty;
          return qty === undefined;
        });

        // Bounded parallelism: previously one unbounded Promise.all, i.e.
        // two Sanity queries per missing pair all at once.
        const calculationResults = await mapWithConcurrency(
          stillMissing,
          BACKFILL_CONCURRENCY,
          async ({ itemId, binId }) => {
            try {
              const calculatedStock = await calculateStockExactLogic(itemId, binId, false);
              return { itemId, binId, calculatedStock, success: true };
            } catch (error) {
              logger.error(`Failed to calculate for ${itemId}-${binId}:`, error);
              return { itemId, binId, calculatedStock: 0, success: false };
            }
          },
        );

        const validUpdates = calculationResults
          .filter((r) => r.success)
          .map((r) => ({
            stockItemId: r.itemId,
            binId: r.binId,
            quantity: r.calculatedStock,
            transactionType: "inventoryCount" as const,
            transactionId: "bulk-calculation",
            isAbsolute: true,
          }));

        if (validUpdates.length > 0) {
          const bulkResult = await bulkUpdateStockSnapshots(validUpdates, { maxRetries: 2 });
          logger.debug(`Bulk created ${bulkResult.success} snapshots, ${bulkResult.failed} failed`);
        }

        calculationResults.forEach((r) => {
          if (r.success) results[`${r.itemId}-${r.binId}`] = r.calculatedStock;
        });
      } finally {
        releaseLock();
      }
    }

    onProgress?.({ stage: "Complete", percentage: 100 });

    trackMetric({
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      cacheHit: itemsWithoutSnapshots.length === 0,
      itemsProcessed: stockItemIds.length * binIds.length,
      fromCache: stockItemIds.length * binIds.length - itemsWithoutSnapshots.length,
      calculated: itemsWithoutSnapshots.length,
    });

    return results;
  } catch (error) {
    // NOTE: this used to also create a brand-new, empty stockRegistry document
    // on ANY error (e.g. a transient timeout). That could shadow the real
    // registry, so a missing registry is now only created by
    // bulkUpdateStockSnapshots when a fetch positively returns nothing.
    logger.error("Error in calculateBulkStock:", error);

    trackMetric({
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      cacheHit: false,
      itemsProcessed: stockItemIds.length * binIds.length,
      fromCache: 0,
      calculated: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    onProgress?.({ stage: "Error occurred", percentage: 100 });

    const emptyResults: { [key: string]: number } = {};
    for (const binId of binIds) {
      for (const itemId of stockItemIds) {
        emptyResults[`${itemId}-${binId}`] = 0;
      }
    }
    return emptyResults;
  }
};

// 3. Enhanced getBinStock with metadata
export const getBinStock = async (
  stockItemIds: string[],
  binId: string,
): Promise<{
  [key: string]: {
    quantity: number;
    lastUpdated?: string;
    confidence?: "high" | "medium" | "low";
  };
}> => {
  logger.debug(
    `📊 Getting bin stock for ${stockItemIds.length} items in bin ${binId}`,
  );

  if (!binId || stockItemIds.length === 0) {
    return {};
  }

  const results = await calculateBulkStock(stockItemIds, [binId]);

  // Enhanced results with metadata
  const enhancedResults: { [key: string]: any } = {};
  let foundItems = 0;

  // Get additional metadata for each item
  for (const itemId of stockItemIds) {
    const compositeKey = `${itemId}-${binId}`;
    const quantity = results[compositeKey] || 0;

    if (quantity > 0) {
      foundItems++;
    }

    // Get cache confidence if available
    const cacheKey = `${itemId}-${binId}`;
    const cached = snapshotCache.get(cacheKey);

    enhancedResults[itemId] = {
      quantity,
      lastUpdated: cached?.timestamp
        ? new Date(cached.timestamp).toISOString()
        : undefined,
      confidence: cached?.metadata?.confidence,
    };
  }

  logger.debug(`✅ Found stock for ${foundItems}/${stockItemIds.length} items`);
  return enhancedResults;
};

// 4. Transaction-based calculation (for validation)
export const calculateBulkStockFromTransactions = async (
  stockItemIds: string[],
  binIds: string[],
): Promise<{ [key: string]: number }> => {
  logger.debug("🧮 Starting calculateBulkStockFromTransactions...");

  if (stockItemIds.length === 0 || binIds.length === 0) {
    return {};
  }

  try {
    // Get ALL transactions in chronological order
    const query = groq`{
      "goodsReceipts": *[
        _type == "GoodsReceipt" && 
        receivingBin._ref in $binIds &&
        status in ["completed", "processed"]
      ] | order(receiptDate asc) {
        _type,
        _id,
        receiptDate,
        "binId": receivingBin._ref,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity
        }
      },
      
      "dispatches": *[
        _type == "DispatchLog" && 
        sourceBin._ref in $binIds &&
        status in ["completed", "processed"]
      ] | order(dispatchDate asc) {
        _type,
        _id,
        dispatchDate,
        "binId": sourceBin._ref,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity
        }
      },
      
      "transfers": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        (fromBin._ref in $binIds || toBin._ref in $binIds)
      ] | order(transferDate asc) {
        _type,
        _id,
        transferDate,
        "fromBinId": fromBin._ref,
        "toBinId": toBin._ref,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "allCounts": *[
        _type == "InventoryCount" && 
        bin._ref in $binIds &&
        status == "completed"
      ] | order(countDate asc) {
        _id,
        "binId": bin._ref,
        countDate,
        countedItems[] {
          "itemId": stockItem._ref,
          countedQuantity
        }
      }
    }`;

    const data = await client.fetch(query, { binIds, stockItemIds });

    logger.debug("📊 Transaction data counts:");
    logger.debug("- Goods Receipts:", data.goodsReceipts?.length || 0);
    logger.debug("- Dispatches:", data.dispatches?.length || 0);
    logger.debug("- Transfers:", data.transfers?.length || 0);
    logger.debug("- Inventory Counts:", data.allCounts?.length || 0);

    // Initialize with 0
    const results: { [key: string]: Decimal } = {};
    binIds.forEach((binId) => {
      stockItemIds.forEach((itemId) => {
        const key = `${itemId}-${binId}`;
        results[key] = new Decimal(0);
      });
    });

    // Build transaction timeline
    const allTransactions: Array<{
      type:
        | "goodsReceipt"
        | "dispatch"
        | "transferOut"
        | "transferIn"
        | "inventoryCount";
      date: string;
      binId: string;
      itemId: string;
      quantity: number;
    }> = [];

    // Add Goods Receipts
    data.goodsReceipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId && stockItemIds.includes(item.itemId)) {
          allTransactions.push({
            type: "goodsReceipt",
            date: receipt.receiptDate,
            binId: receipt.binId,
            itemId: item.itemId,
            quantity: item.receivedQuantity || 0,
          });
        }
      });
    });

    // Add Dispatches
    data.dispatches?.forEach((dispatch: any) => {
      dispatch.dispatchedItems?.forEach((item: any) => {
        if (item.itemId && stockItemIds.includes(item.itemId)) {
          allTransactions.push({
            type: "dispatch",
            date: dispatch.dispatchDate,
            binId: dispatch.binId,
            itemId: item.itemId,
            quantity: item.dispatchedQuantity || 0,
          });
        }
      });
    });

    // Add Transfers
    // NEW (fixed - prevents double counting for same bin):
    // Add Transfers - WITH double-counting prevention
    data.transfers?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        const quantity = item.transferredQuantity || 0;

        if (item.itemId && stockItemIds.includes(item.itemId)) {
          // Prevent processing same bin transfers (shouldn't happen but defensive)
          if (transfer.fromBinId !== transfer.toBinId) {
            // For EACH bin, add ONE transaction
            if (transfer.fromBinId && binIds.includes(transfer.fromBinId)) {
              allTransactions.push({
                type: "transferOut",
                date: transfer.transferDate,
                binId: transfer.fromBinId,
                itemId: item.itemId,
                quantity: quantity,
              });
            }

            if (transfer.toBinId && binIds.includes(transfer.toBinId)) {
              allTransactions.push({
                type: "transferIn",
                date: transfer.transferDate,
                binId: transfer.toBinId,
                itemId: item.itemId,
                quantity: quantity,
              });
            }
          }
        }
      });
    });

    // Add Inventory Counts
    data.allCounts?.forEach((count: any) => {
      count.countedItems?.forEach((item: any) => {
        if (item.itemId && stockItemIds.includes(item.itemId)) {
          allTransactions.push({
            type: "inventoryCount",
            date: count.countDate,
            binId: count.binId,
            itemId: item.itemId,
            quantity: item.countedQuantity || 0,
          });
        }
      });
    });

    // Sort by date
    allTransactions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // In calculateBulkStockFromTransactions function, replace the processing logic:
    logger.debug(`📊 Processing ${allTransactions.length} transactions...`);

    // Track last inventory count per item-bin
    const lastCountMap: { [key: string]: Date } = {};

    // Process transactions
    allTransactions.forEach((tx, index) => {
      const key = `${tx.itemId}-${tx.binId}`;
      const lastCountDate = lastCountMap[key];

      // Skip if transaction is before last inventory count
      if (lastCountDate && new Date(tx.date) < lastCountDate) {
        return;
      }

      switch (tx.type) {
        case "goodsReceipt":
        case "transferIn":
          results[key] = results[key].plus(tx.quantity);
          break;
        case "dispatch":
        case "transferOut":
          results[key] = results[key].minus(tx.quantity); // ALLOW NEGATIVE
          break;
        case "inventoryCount":
          // Inventory count SETS the absolute value
          results[key] = new Decimal(tx.quantity);
          lastCountMap[key] = new Date(tx.date); // Update last count date
          break;
      }
    });

    // Convert to final results
    const finalResults: { [key: string]: number } = {};
    for (const key in results) {
      finalResults[key] = results[key].toNumber();
    }

    logger.debug("✅ calculateBulkStockFromTransactions complete");
    return finalResults;
  } catch (error) {
    console.error("❌ Error in calculateBulkStockFromTransactions:", error);
    return {};
  }
};

async function fallbackToIndividualUpdates(
  countedItems: any[],
  transaction: any,
  transactionId: string,
): Promise<void> {
  logger.debug(
    `🔄 Falling back to batched individual updates for ${countedItems.length} items`,
  );

  const BATCH_SIZE = 5;
  const MAX_RETRIES = 2;

  for (let i = 0; i < countedItems.length; i += BATCH_SIZE) {
    const batch = countedItems.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

    logger.debug(
      `📦 Processing fallback batch ${batchNumber} (${batch.length} items)`,
    );

    let retryCount = 0;
    let batchCompleted = false;

    while (!batchCompleted && retryCount <= MAX_RETRIES) {
      try {
        const batchPromises = batch.map(async (item: any) => {
          const countedQty = item.countedQuantity || 0;

          // Get existing snapshot
          const existing = await client.fetch(
            groq`*[_type == "stockSnapshot" && 
                            stockItem._ref == $itemId && 
                            bin._ref == $binId][0]`,
            { itemId: item.stockItemId, binId: transaction.bin },
          );

          const snapshotData: any = {
            _type: "stockSnapshot",
            stockItem: {
              _type: "reference",
              _ref: item.stockItemId,
            },
            bin: {
              _type: "reference",
              _ref: transaction.bin,
            },
            quantity: countedQty,
            lastUpdated: new Date().toISOString(),
          };

          if (existing) {
            await writeClient.patch(existing._id).set(snapshotData).commit();
          } else {
            await writeClient.create(snapshotData);
          }

          // Update cache
          const cacheKey = `${item.stockItemId}-${transaction.bin}`;
          snapshotCache.set(cacheKey, countedQty, {
            confidence: "high",
            fallback: true,
          });
          invalidateStockCache(item.stockItemId);

          return { success: true, itemId: item.stockItemId };
        });

        await Promise.all(batchPromises);
        logger.debug(`  ✅ Fallback batch ${batchNumber} completed`);
        batchCompleted = true;
      } catch (batchError) {
        console.error(`❌ Fallback batch ${batchNumber} failed:`, batchError);
        retryCount++;

        if (retryCount <= MAX_RETRIES) {
          logger.debug(
            `  🔄 Retrying batch (attempt ${retryCount}/${MAX_RETRIES})`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          );
        } else {
          console.error(
            `❌ Fallback batch ${batchNumber} failed after ${MAX_RETRIES} retries`,
          );
          batchCompleted = true;
        }
      }
    }

    // Small delay between batches
    if (i + BATCH_SIZE < countedItems.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  logger.debug(`✅ Fallback updates completed for ${countedItems.length} items`);
}

/**
 * 🚀 BULK UPDATE STOCK REGISTRY - Optimized for single document updates
 * Updates multiple stock entries in ONE document
 */
export async function bulkUpdateStockRegistry(
  updates: Array<{
    stockItemId: string;
    binId: string;
    quantity: number; // Can be positive (add), negative (deduct), or absolute (set)
    transactionType:
      | "procurement"
      | "dispatch"
      | "transfer"
      | "inventoryCount"
      | "adjustment";
    transactionId: string;
    isAbsolute?: boolean; // true for inventoryCount (SET value), false for others (ADJUST value)
  }>,
  options?: {
    onProgress?: (progress: { processed: number; total: number }) => void;
    maxRetries?: number;
  },
): Promise<{
  success: number;
  failed: number;
}> {
  const startTime = Date.now();
  const maxRetries = options?.maxRetries || 3;

  if (!updates || updates.length === 0) {
    logger.debug("📭 No updates to process");
    return { success: 0, failed: 0 };
  }

  logger.debug(
    `🚀 Starting bulk registry update for ${updates.length} items (${updates[0]?.transactionType})`,
  );

  const validUpdates: StockRegistryBulkUpdate[] = [];
  const validationResults: { success: number; failed: number } = {
    success: 0,
    failed: 0,
  };

  updates.forEach((update, index) => {
    if (!validateBulkStockRegistryUpdate(update)) {
      console.warn(
        `⚠️ Invalid stock registry update at index ${index}:`,
        update,
      );
      validationResults.failed += 1;
      return;
    }

    validUpdates.push(normalizeBulkStockRegistryUpdate(update));
  });

  if (validUpdates.length === 0) {
    logger.debug("⚠️ No valid registry updates after validation");
    return validationResults;
  }

  logger.debug(
    `📊 Valid updates to apply: ${validUpdates.length} (failed validation: ${validationResults.failed})`,
  );

  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      // 1. Get the current registry document
      const registryQuery = groq`*[_type == "stockRegistry"][0] {
        _id,
        stockData,
        version
      }`;

      const existingRegistry = await client.fetch(registryQuery);
      const now = new Date().toISOString();

      // 2. Prepare registry data
      let registryData = existingRegistry?.stockData || { items: [] };

      // Create lookup maps for faster updates
      const itemMap = new Map<string, { item: any; index: number }>();
      registryData.items?.forEach((item: any, index: number) => {
        if (item.stockItemId) {
          itemMap.set(item.stockItemId, { item, index });
        }
      });

      // 3. Apply all updates
      const results: { success: number; failed: number } = {
        success: 0,
        failed: 0,
      };

      for (let i = 0; i < validUpdates.length; i++) {
        const update = validUpdates[i];

        try {
          const {
            stockItemId,
            binId,
            quantity,
            transactionType,
            transactionId,
            isAbsolute,
          } = update;

          // Find or create item entry
          let itemEntry = itemMap.get(stockItemId);
          if (!itemEntry) {
            // Create new item
            const newItem = {
              stockItemId,
              binQuantities: { bins: [] },
            };
            registryData.items.push(newItem);
            const itemIndex = registryData.items.length - 1;
            itemMap.set(stockItemId, { item: newItem, index: itemIndex });
            itemEntry = { item: newItem, index: itemIndex };
          }

          // Find or create bin entry
          const item = itemEntry.item;
          let binEntry = item.binQuantities?.bins?.find(
            (b: any) => b.binId === binId,
          );

          // Calculate new quantity
          let currentQty = binEntry?.quantity || 0;
          let newQuantity: number;

          if (isAbsolute || transactionType === "inventoryCount") {
            // SET absolute value
            newQuantity = quantity;
          } else {
            // ADJUST by amount
            newQuantity = currentQty + quantity;

            // Safety check for dispatches
            if (transactionType === "dispatch" && newQuantity < 0) {
              console.warn(
                `⚠️ Dispatch would make stock negative: ${stockItemId} in ${binId}`,
              );
              newQuantity = 0; // or handle differently
            }
          }

          // Update or create bin entry
          const updatedBinEntry = {
            binId,
            quantity: newQuantity,
            lastUpdated: now,
            lastTransactionId: transactionId,
            lastTransactionType: transactionType,
          };

          if (binEntry) {
            // Update existing bin
            const binIndex = item.binQuantities.bins.findIndex(
              (b: any) => b.binId === binId,
            );
            if (binIndex !== -1) {
              item.binQuantities.bins[binIndex] = updatedBinEntry;
            }
          } else {
            // Create new bin
            if (!item.binQuantities) {
              item.binQuantities = { bins: [] };
            }
            if (!item.binQuantities.bins) {
              item.binQuantities.bins = [];
            }
            item.binQuantities.bins.push(updatedBinEntry);
          }

          // Update cache
          const cacheKey = `${stockItemId}-${binId}`;
          snapshotCache.set(cacheKey, newQuantity, {
            confidence: "high",
            transactionType,
            timestamp: Date.now(),
          });
          invalidateStockCache(stockItemId);
          invalidateStockCache(binId);

          results.success++;

          // Report progress
          if (options?.onProgress && i % 10 === 0) {
            options.onProgress({
              processed: i + 1,
              total: validUpdates.length,
            });
          }
        } catch (error) {
          console.error(
            `❌ Failed to process update for ${update.stockItemId}-${update.binId}:`,
            error,
          );
          results.failed++;
        }
      }

      // 4. Save to database
      const updateData = {
        stockData: registryData,
        lastUpdated: now,
        version: (existingRegistry?.version || 0) + 1,
      };

      if (existingRegistry) {
        await writeClient.patch(existingRegistry._id).set(updateData).commit();
      } else {
        await writeClient.create({
          _type: "stockRegistry",
          title: "Stock Registry v1",
          ...updateData,
        });
      }

      const duration = Date.now() - startTime;
      logger.debug(
        `✅ Registry bulk update: ${results.success} succeeded, ${results.failed} failed in ${duration}ms`,
      );

      const finalResults = {
        success: results.success,
        failed: results.failed + validationResults.failed,
      };
      return finalResults;
    } catch (error) {
      console.error(
        `❌ Registry bulk update failed (attempt ${retryCount + 1}/${maxRetries + 1}):`,
        error,
      );
      retryCount++;

      if (retryCount <= maxRetries) {
        logger.debug(`🔄 Retrying in ${1000 * retryCount}ms...`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      } else {
        throw error;
      }
    }
  }

  return { success: 0, failed: validUpdates.length + validationResults.failed };
}

// 5. Hook to update snapshots when transactions occur
// 5. Hook to update snapshots when transactions occur
export async function updateStockForTransaction(
  transactionType:
    | "dispatch"
    | "transfer"
    | "inventoryCount"
    | "procurement"
    | "adjustment",
  transactionId: string,
) {
  try {
    logger.debug(
      `📊 Updating stock snapshots for ${transactionType}:`,
      transactionId,
    );

    let transaction: any;
    let bulkUpdates: Array<{
      stockItemId: string;
      binId: string;
      quantity: number;
      transactionType:
        | "dispatch"
        | "transfer"
        | "inventoryCount"
        | "procurement"
        | "adjustment"; // ← SPECIFIC
      transactionId: string;
      isAbsolute?: boolean;
    }> = [];

    // ========== FETCH TRANSACTION DATA BASED ON TYPE ==========
    switch (transactionType) {
      // ========== PROCUREMENT (Goods Receipt) ==========
      case "procurement":
        transaction = await client.fetch(
          groq`*[_type == "GoodsReceipt" && _id == $id][0] {
            _id,
            receiptNumber,
            status,
            "receivedItems": receivedItems[]{
                "stockItemId": stockItem._ref,
                receivedQuantity,
                "binId": receivingBin._ref
            }
          }`,
          { id: transactionId },
        );

        if (!transaction) {
          console.error(`❌ Goods receipt ${transactionId} not found`);
          return;
        }

        if (
          !transaction.receivedItems ||
          transaction.receivedItems.length === 0
        ) {
          console.error(
            `❌ Goods receipt ${transaction.receiptNumber} has no received items`,
          );
          return;
        }

        // Prepare bulk updates - POSITIVE quantities (adding stock)
        bulkUpdates = transaction.receivedItems
          .filter((item: any) => {
            const isValid =
              item.stockItemId && item.binId && item.receivedQuantity > 0;
            if (!isValid) {
              console.warn("⚠️ Skipping invalid procurement item:", {
                stockItemId: item.stockItemId,
                binId: item.binId,
                quantity: item.receivedQuantity,
                receiptNumber: transaction.receiptNumber,
              });
            }
            return isValid;
          })
          .map((item: any) => ({
            stockItemId: item.stockItemId,
            binId: item.binId,
            quantity: item.receivedQuantity || 0, // POSITIVE (adding stock)
            transactionType: "procurement",
            transactionId,
            isAbsolute: false, // ADJUSTMENT: add to current stock
          }));

        logger.debug(
          `📋 Processing ${bulkUpdates.length} procurement items for receipt ${transaction.receiptNumber}`,
        );
        break;

      // ========== DISPATCH ==========
      case "dispatch":
        transaction = await client.fetch(
          groq`*[_type == "DispatchLog" && _id == $id][0] {
            _id,
            dispatchNumber,
            evidenceStatus,
            status,
            "dispatchedItems": dispatchedItems[]{
                "stockItemId": stockItem._ref,
                dispatchedQuantity,
                "sourceBinId": sourceBin._ref
            }
          }`,
          { id: transactionId },
        );

        if (!transaction) {
          console.error(`❌ Dispatch ${transactionId} not found`);
          return;
        }

        // Prepare bulk updates - NEGATIVE quantities (removing stock)
        bulkUpdates = transaction.dispatchedItems
          .filter((item: any) => {
            const isValid =
              item.stockItemId &&
              item.sourceBinId &&
              item.dispatchedQuantity > 0;
            if (!isValid) {
              console.warn("⚠️ Skipping invalid dispatch item:", {
                stockItemId: item.stockItemId,
                sourceBinId: item.sourceBinId,
                quantity: item.dispatchedQuantity,
                dispatchNumber: transaction.dispatchNumber,
              });
            }
            return isValid;
          })
          .map((item: any) => ({
            stockItemId: item.stockItemId,
            binId: item.sourceBinId,
            quantity: -(item.dispatchedQuantity || 0), // NEGATIVE (removing stock)
            transactionType: "dispatch",
            transactionId,
            isAbsolute: false, // ADJUSTMENT: subtract from current stock
          }));

        logger.debug(
          `📋 Processing ${bulkUpdates.length} dispatch items for ${transaction.dispatchNumber}`,
        );
        break;

      // ========== TRANSFER ==========
      case "transfer":
        transaction = await client.fetch(
          groq`*[_type == "InternalTransfer" && _id == $id][0] {
            _id,
            transferNumber,
            status,
            "fromBin": fromBin._ref,
            "toBin": toBin._ref,
            "transferredItems": transferredItems[]{
              "stockItemId": stockItem._ref,
              transferredQuantity
            }
          }`,
          { id: transactionId },
        );

        if (!transaction) {
          console.error(`❌ Transfer ${transactionId} not found`);
          return;
        }

        // Make sure the transfer has status 'completed'
        if (transaction.status !== "completed") {
          console.warn(
            `⚠️ Transfer ${transactionId} is not completed (status: ${transaction.status}). Stock won't be updated.`,
          );
          return;
        }

        // Debug log
        logger.debug("🔍 TRANSFER DEBUG:", {
          transactionId,
          fromBin: transaction.fromBin,
          toBin: transaction.toBin,
          transferredItems: transaction.transferredItems,
          status: transaction.status,
        });

        // Prepare bulk updates for BOTH source and destination bins
        bulkUpdates = [];

        (transaction.transferredItems || []).forEach((item: any) => {
          if (item.stockItemId && item.transferredQuantity > 0) {
            // Source bin: NEGATIVE (removing stock)
            if (transaction.fromBin) {
              bulkUpdates.push({
                stockItemId: item.stockItemId,
                binId: transaction.fromBin,
                quantity: -(item.transferredQuantity || 0), // NEGATIVE
                transactionType: "transfer",
                transactionId,
                isAbsolute: false,
              });
            }

            // Destination bin: POSITIVE (adding stock)
            if (transaction.toBin) {
              bulkUpdates.push({
                stockItemId: item.stockItemId,
                binId: transaction.toBin,
                quantity: item.transferredQuantity || 0, // POSITIVE
                transactionType: "transfer",
                transactionId,
                isAbsolute: false,
              });
            }
          } else {
            console.warn("⚠️ Skipping invalid transfer item:", {
              stockItemId: item.stockItemId,
              transferredQuantity: item.transferredQuantity,
              transferNumber: transaction.transferNumber,
            });
          }
        });

        // Filter items to ensure they have valid binIds
        bulkUpdates = bulkUpdates.filter((item: any) => {
          const isValid = item.stockItemId && item.binId;
          if (!isValid) {
            console.warn("⚠️ Skipping transfer item with missing IDs:", {
              stockItemId: item.stockItemId,
              binId: item.binId,
              quantity: item.quantity,
            });
          }
          return isValid;
        });

        logger.debug(
          `📋 Processing ${bulkUpdates.length} transfer items for ${transaction.transferNumber}`,
        );
        break;

      // ========== INVENTORY COUNT ==========
      case "inventoryCount":
        transaction = await client.fetch(
          groq`*[_type == "InventoryCount" && _id == $id][0] {
            _id,
            countNumber,
            status,
            "bin": bin._ref,
            "countedItems": countedItems[]{
              "stockItemId": stockItem._ref,
              countedQuantity
            }
          }`,
          { id: transactionId },
        );

        if (!transaction) {
          console.error(`❌ Inventory Count ${transactionId} not found`);
          return;
        }

        // Only update stock if count is completed
        if (transaction.status !== "completed") {
          logger.debug(
            `⚠️ Inventory count ${transactionId} is not completed (status: ${transaction.status}). Stock won't be updated.`,
          );
          return;
        }

        // Prepare bulk updates - SET absolute values
        bulkUpdates = (transaction.countedItems || [])
          .filter((item: any) => {
            const isValid = item.stockItemId && item.countedQuantity >= 0;
            if (!isValid) {
              console.warn("⚠️ Skipping invalid inventory count item:", {
                stockItemId: item.stockItemId,
                countedQuantity: item.countedQuantity,
                countNumber: transaction.countNumber,
              });
            }
            return isValid;
          })
          .map((item: any) => ({
            stockItemId: item.stockItemId,
            binId: transaction.bin,
            quantity: item.countedQuantity || 0,
            transactionType: "inventoryCount",
            transactionId,
            isAbsolute: true, // SET absolute value (not adjustment)
          }));

        logger.debug(
          `📋 Processing ${bulkUpdates.length} inventory count items for ${transaction.countNumber}`,
        );
        break;

      default:
        console.error(`❌ Unsupported transaction type: ${transactionType}`);
        return;
    }

    // ========== EXECUTE BULK UPDATE ==========
    if (bulkUpdates.length === 0) {
      logger.debug(
        `⚠️ No valid items to update for ${transactionType} ${transactionId}`,
      );
      return;
    }

    logger.debug(
      `🚀 Processing ${bulkUpdates.length} items for ${transactionType} ${transactionId}`,
    );

    // Use the bulk update function
    // Use the new registry-based bulk update
    const result = await bulkUpdateStockRegistry(bulkUpdates, {
      onProgress: (progress) => {
        // Optional: Could emit event for UI progress bar here
        if (
          progress.processed % 10 === 0 ||
          progress.processed === progress.total
        ) {
          logger.debug(
            `📈 Progress: ${progress.processed}/${progress.total} items processed`,
          );
        }
      },
      maxRetries: 3,
    });

    // Log final results
    const successRate = ((result.success / bulkUpdates.length) * 100).toFixed(
      1,
    );

    logger.debug(
      `🎉 ${transactionType.toUpperCase()} ${transactionId} PROCESSING COMPLETE:`,
      {
        totalItems: bulkUpdates.length,
        successful: result.success,
        failed: result.failed,
        successRate: `${successRate}%`,
        transactionType,
        transactionId,
      },
    );

    // Report failed items if any
    if (result.failed > 0) {
      console.warn(`⚠️ ${result.failed} items failed to update:`, {
        failedItems: result,
        transactionType,
        transactionId,
      });

      // Optionally send notification/alert to admins
      // await sendStockUpdateFailureAlert(transactionType, transactionId, failedItems);
    }

    // Invalidate all related caches for immediate UI updates
    bulkUpdates.forEach((update) => {
      invalidateStockCache(update.stockItemId);
      invalidateStockCache(update.binId);
    });
  } catch (error) {
    console.error(
      `❌ CRITICAL ERROR: Failed to update stock for ${transactionType} ${transactionId}:`,
      error,
    );

    // Re-throw to let calling code handle the error (e.g., show toast to user)
    throw new Error(`Failed to update stock for ${transactionType}: ${error}`);
  }
}

// 6. Initialize all stock snapshots (run once)
export const initializeAllStockSnapshots = async (): Promise<void> => {
  logger.debug("🏁 Initializing all stock snapshots...");

  // Get all stock items and bins
  const [stockItems, bins] = await Promise.all([
    client.fetch(groq`*[_type == "StockItem"] { _id, name }`),
    client.fetch(groq`*[_type == "Bin"] { _id, name }`),
  ]);

  const stockItemIds = stockItems.map((item: any) => item._id);
  const binIds = bins.map((bin: any) => bin._id);

  let count = 0;
  const total = stockItemIds.length * binIds.length;

  logger.debug(`📊 Initializing ${total} snapshots...`);

  // Create/update snapshots for all combinations with progress logging
  for (const binId of binIds) {
    for (const itemId of stockItemIds) {
      try {
        const stock = await calculateStockFromTransactions(
          itemId,
          binId,
          false,
        );
        await updateStockSnapshot(itemId, binId, stock, "inventoryCount", null);
        count++;

        if (count % 100 === 0 || count === total) {
          const percentage = Math.round((count / total) * 100);
          logger.debug(
            `  📈 Created ${count}/${total} snapshots (${percentage}%)...`,
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed to initialize snapshot for ${itemId}-${binId}:`,
          error,
        );
      }
    }
  }

  logger.debug(`✅ Initialized ${count} stock snapshots`);
};

// 7. Validate stock consistency (debugging tool)
export const validateStockConsistency = async (
  stockItemIds: string[],
  binIds: string[],
): Promise<{
  valid: boolean;
  issues: Array<{
    itemId: string;
    binId: string;
    snapshotStock: number;
    calculatedStock: number;
    difference: number;
  }>;
}> => {
  logger.debug("🔍 Validating stock consistency...");

  try {
    // Get stock from snapshots
    const snapshotResults = await calculateBulkStock(stockItemIds, binIds);

    // Calculate stock from transactions
    const calculatedResults = await calculateBulkStockFromTransactions(
      stockItemIds,
      binIds,
    );

    const issues: Array<{
      itemId: string;
      binId: string;
      snapshotStock: number;
      calculatedStock: number;
      difference: number;
    }> = [];

    // Compare results
    for (const key in snapshotResults) {
      const snapshotStock = snapshotResults[key];
      const calculatedStock = calculatedResults[key] || 0;
      const difference = Math.abs(snapshotStock - calculatedStock);

      if (difference > 0.01) {
        // Allow for floating-point precision
        const [itemId, binId] = key.split("-");
        issues.push({
          itemId,
          binId,
          snapshotStock,
          calculatedStock,
          difference,
        });
      }
    }

    logger.debug(
      `✅ Stock consistency check complete. Issues: ${issues.length}`,
    );

    return {
      valid: issues.length === 0,
      issues,
    };
  } catch (error) {
    console.error("❌ Error validating stock consistency:", error);
    return {
      valid: false,
      issues: [],
    };
  }
};

// 8. Get stock as of specific date (for historical reports)
export const getStockAsOfDate = async (
  stockItemIds: string[],
  binIds: string[],
  asOfDate: Date,
): Promise<{ [key: string]: number }> => {
  logger.debug(
    `📅 Getting stock as of ${asOfDate.toISOString().split("T")[0]}...`,
  );

  if (stockItemIds.length === 0 || binIds.length === 0) {
    return {};
  }

  try {
    const dateString = asOfDate.toISOString();
    const results: { [key: string]: number } = {};

    // Initialize all combinations with 0
    binIds.forEach((binId) => {
      stockItemIds.forEach((itemId) => {
        results[`${itemId}-${binId}`] = 0;
      });
    });

    // Process each bin separately for better performance
    for (const binId of binIds) {
      logger.time(`📥 Processing bin ${binId}`);

      const binQuery = groq`{
        "goodsReceipts": *[
          _type == "GoodsReceipt" && 
          receivingBin._ref == $binId &&
          status in ["completed", "processed"] &&
          receiptDate <= $dateString
        ] | order(receiptDate asc) {
          receiptDate,
          receivedItems[] {
            "itemId": stockItem._ref,
            receivedQuantity
          }
        },
        
        "dispatches": *[
          _type == "DispatchLog" && 
          sourceBin._ref == $binId &&
          status in ["completed", "processed"] &&
          dispatchDate <= $dateString
        ] | order(dispatchDate asc) {
          dispatchDate,
          dispatchedItems[] {
            "itemId": stockItem._ref,
            dispatchedQuantity
          }
        }
          ,
        
        "transfersOut": *[
          _type == "InternalTransfer" && 
          status == "completed" && 
          fromBin._ref == $binId &&
          transferDate <= $dateString
        ] | order(transferDate asc) {
          transferDate,
          transferredItems[] {
            "itemId": stockItem._ref,
            transferredQuantity
          }
        },
        
        "transfersIn": *[
          _type == "InternalTransfer" && 
          status == "completed" && 
          toBin._ref == $binId &&
          transferDate <= $dateString
        ] | order(transferDate asc) {
          transferDate,
          transferredItems[] {
            "itemId": stockItem._ref,
            transferredQuantity
          }
        },
        
        "lastCount": *[
          _type == "InventoryCount" && 
          bin._ref == $binId &&
          status == "completed" &&
          countDate <= $dateString
        ] | order(countDate desc)[0] {
          countDate,
          countedItems[] {
            "itemId": stockItem._ref,
            countedQuantity
          }
        }
      }`;

      const data = await client.fetch(binQuery, {
        binId,
        dateString,
        stockItemIds,
      });

      // Process each item in the bin
      stockItemIds.forEach((itemId) => {
        const key = `${itemId}-${binId}`;
        let stock = 0;
        let lastCountDate: Date | null = null;

        // Process goods receipts
        data.goodsReceipts?.forEach((receipt: any) => {
          const receiptDate = new Date(receipt.receiptDate);
          // Skip if before last inventory count
          if (lastCountDate && receiptDate < lastCountDate) return;

          receipt.receivedItems?.forEach((item: any) => {
            if (item.itemId === itemId) {
              stock += item.receivedQuantity || 0;
            }
          });
        });

        // Process dispatches
        data.dispatches?.forEach((dispatch: any) => {
          const dispatchDate = new Date(dispatch.dispatchDate);
          // Skip if before last inventory count
          if (lastCountDate && dispatchDate < lastCountDate) return;

          dispatch.dispatchedItems?.forEach((item: any) => {
            if (item.itemId === itemId) {
              stock = stock - (item.dispatchedQuantity || 0);
            }
          });
        });

        // Process transfers out
        data.transfersOut?.forEach((transfer: any) => {
          const transferDate = new Date(transfer.transferDate);
          // Skip if before last inventory count
          if (lastCountDate && transferDate < lastCountDate) return;

          transfer.transferredItems?.forEach((item: any) => {
            if (item.itemId === itemId) {
              stock = stock - (item.transferredQuantity || 0);
            }
          });
        });

        // Process transfers in
        data.transfersIn?.forEach((transfer: any) => {
          const transferDate = new Date(transfer.transferDate);
          // Skip if before last inventory count
          if (lastCountDate && transferDate < lastCountDate) return;

          transfer.transferredItems?.forEach((item: any) => {
            if (item.itemId === itemId) {
              stock += item.transferredQuantity || 0;
            }
          });
        });

        // Process inventory counts (in chronological order)
        const sortedCounts = (data.allCounts || []).sort(
          (a: any, b: any) =>
            new Date(a.countDate).getTime() - new Date(b.countDate).getTime(),
        );

        sortedCounts.forEach((count: any) => {
          const countDate = new Date(count.countDate);
          count.countedItems?.forEach((item: any) => {
            if (item.itemId === itemId) {
              // Inventory count SETS the stock at that point
              stock = item.countedQuantity || 0;
              lastCountDate = countDate; // Update last count date
            }
          });
        });

        results[key] = stock;
      });

      logger.timeEnd(`📥 Processing bin ${binId}`);
    }

    logger.debug("✅ Historical stock calculation complete");
    return results;
  } catch (error) {
    console.error("❌ Error in getStockAsOfDate:", error);
    return {};
  }
};

// 9. Force refresh stock snapshot for specific item-bin
export const refreshStockSnapshot = async (
  stockItemId: string,
  binId: string,
): Promise<number> => {
  logger.debug(`🔄 Refreshing stock snapshot for ${stockItemId} in ${binId}`);

  const calculatedStock = await calculateStockFromTransactions(
    stockItemId,
    binId,
  );
  await updateStockSnapshot(
    stockItemId,
    binId,
    calculatedStock,
    "refresh",
    null,
  );

  logger.debug(`✅ Snapshot refreshed: ${calculatedStock}`);
  return calculatedStock;
};

// 10. Get all stock snapshots (admin/debugging)
export const getAllStockSnapshots = async (): Promise<
  Array<{
    _id: string;
    stockItem: { _ref: string };
    bin: { _ref: string };
    quantity: number;
    lastUpdated: string;
  }>
> => {
  const query = groq`*[_type == "stockSnapshot"] {
    _id,
    stockItem->{ _id, name },
    bin->{ _id, name },
    quantity,
    lastUpdated
  } | order(lastUpdated desc)`;

  return await client.fetch(query);
};

// 11. Get stock with freshness indicator
export const getStockWithFreshness = async (
  stockItemId: string,
  binId: string,
): Promise<{
  quantity: number;
  freshness: "fresh" | "stale" | "calculating";
  lastUpdated?: string;
  cached: boolean;
}> => {
  const cacheKey = `${stockItemId}-${binId}`;
  const cached = snapshotCache.get(cacheKey); // OptimizedSnapshotCache handles TTL

  if (cached) {
    const age = Date.now() - cached.timestamp;
    const freshness =
      age < 10000 ? "fresh" : age < 30000 ? "stale" : "calculating";

    return {
      quantity: cached.quantity,
      freshness,
      lastUpdated: new Date(cached.timestamp).toISOString(),
      cached: true,
    };
  }

  // Not cached, calculate fresh
  const result = await calculateStock(stockItemId, binId);

  return {
    quantity: result.quantity,
    freshness: "fresh",
    cached: false,
  };
};

// 12. Batch update stock with transaction batching
export const batchUpdateStock = async (
  updates: Array<{
    stockItemId: string;
    binId: string;
    quantity: number;
    transactionType: string;
    transactionId: string;
  }>,
): Promise<void> => {
  logger.debug(`🔄 Batch updating ${updates.length} stock items`);

  // Group by transaction to optimize database operations
  const updatesByTransaction = new Map<string, typeof updates>();

  updates.forEach((update) => {
    if (!updatesByTransaction.has(update.transactionId)) {
      updatesByTransaction.set(update.transactionId, []);
    }
    updatesByTransaction.get(update.transactionId)!.push(update);
  });

  // Process each transaction's updates
  for (const [transactionId, transactionUpdates] of updatesByTransaction) {
    try {
      // Optimistic cache updates
      transactionUpdates.forEach((update) => {
        const cacheKey = `${update.stockItemId}-${update.binId}`;
        snapshotCache.set(cacheKey, update.quantity, { confidence: "high" });
      });

      // Batch database operations
      const operations = transactionUpdates.map((update) =>
        writeClient
          .patch(`stockSnapshot-${update.stockItemId}-${update.binId}`)
          .set({
            quantity: update.quantity,
            lastUpdated: new Date().toISOString(),
          })
          .commit(),
      );

      await Promise.all(operations);

      logger.debug(
        `✅ Batch updated ${transactionUpdates.length} items for transaction ${transactionId}`,
      );
    } catch (error) {
      console.error(
        `❌ Failed to batch update for transaction ${transactionId}:`,
        error,
      );

      // Revert optimistic updates on error
      transactionUpdates.forEach((update) => {
        const cacheKey = `${update.stockItemId}-${update.binId}`;
        snapshotCache.delete(cacheKey);
      });

      throw error;
    }
  }
};

// 13. Get low stock predictions (UX enhancement)
export const getLowStockPredictions = async (
  stockItemIds: string[],
  binIds: string[],
  daysAhead: number = 7,
): Promise<{
  [key: string]: {
    current: number;
    predicted: number;
    confidence: number;
    willRunOut: boolean;
    estimatedDaysUntilOut: number | null;
  };
}> => {
  logger.debug(
    `🔮 Predicting low stock for ${stockItemIds.length} items over ${daysAhead} days`,
  );

  const results: any = {};

  // Get current stock
  const currentStock = await calculateBulkStock(stockItemIds, binIds);

  // Simple prediction based on average daily usage (you can enhance this)
  for (const binId of binIds) {
    for (const itemId of stockItemIds) {
      const key = `${itemId}-${binId}`;
      const current = currentStock[key] || 0;

      // TODO: Implement actual prediction algorithm based on historical data
      // For now, return placeholder predictions
      const averageDailyUsage = 5; // Placeholder
      const predicted = Math.max(0, current - averageDailyUsage * daysAhead);
      const estimatedDaysUntilOut =
        current > 0 ? Math.floor(current / averageDailyUsage) : 0;

      results[key] = {
        current,
        predicted,
        confidence: 0.7, // Placeholder confidence score
        willRunOut: predicted <= 0,
        estimatedDaysUntilOut:
          estimatedDaysUntilOut > 0 ? estimatedDaysUntilOut : null,
      };
    }
  }

  return results;
};

// 14. Stock History with enhanced UX
export interface StockHistoryEntry {
  date: string;
  stock: number;
  events?: Array<{
    type: string;
    quantity: number;
    description?: string;
  }>;
}

export const getStockHistory = async (
  stockItemId: string,
  binId: string,
  startDate: Date,
  endDate: Date,
): Promise<StockHistoryEntry[]> => {
  logger.debug(
    `📊 Getting stock history for ${stockItemId} in ${binId} from ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`,
  );

  try {
    const query = groq`{
      "goodsReceipts": *[
        _type == "GoodsReceipt" && 
        receivingBin._ref == $binId &&
        stockItem._ref == $stockItemId &&
        status in ["completed", "processed"] &&
        receiptDate >= $startDate &&
        receiptDate <= $endDate
      ] | order(receiptDate asc) {
        receiptDate,
        receiptNumber,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity
        }
      },
      
      "dispatches": *[
        _type == "DispatchLog" && 
        sourceBin._ref == $binId &&
        stockItem._ref == $stockItemId &&
        status in ["completed", "processed"] &&
        dispatchDate >= $startDate &&
        dispatchDate <= $endDate
      ] | order(dispatchDate asc) {
        dispatchDate,
        dispatchNumber,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity
        }
      },
      
      "transfersOut": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        fromBin._ref == $binId &&
        stockItem._ref == $stockItemId &&
        transferDate >= $startDate &&
        transferDate <= $endDate
      ] | order(transferDate asc) {
        transferDate,
        transferNumber,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "transfersIn": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        toBin._ref == $binId &&
        stockItem._ref == $stockItemId &&
        transferDate >= $startDate &&
        transferDate <= $endDate
      ] | order(transferDate asc) {
        transferDate,
        transferNumber,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "inventoryCounts": *[
        _type == "InventoryCount" && 
        bin._ref == $binId &&
        stockItem._ref == $stockItemId &&
        status == "completed" &&
        countDate >= $startDate &&
        countDate <= $endDate
      ] | order(countDate asc) {
        countDate,
        countNumber,
        countedItems[] {
          "itemId": stockItem._ref,
          countedQuantity
        }
      }
    }`;

    const data = await client.fetch(query, {
      stockItemId,
      binId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    // Build timeline of events
    const events: Array<{
      date: Date;
      type: string;
      quantity: number;
      description?: string;
    }> = [];

    // Add all events to timeline
    data.goodsReceipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          events.push({
            date: new Date(receipt.receiptDate),
            type: "goodsReceipt",
            quantity: item.receivedQuantity || 0,
            description: `Goods Receipt #${receipt.receiptNumber}`,
          });
        }
      });
    });

    data.dispatches?.forEach((dispatch: any) => {
      dispatch.dispatchedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          events.push({
            date: new Date(dispatch.dispatchDate),
            type: "dispatch",
            quantity: -(item.dispatchedQuantity || 0),
            description: `Dispatch #${dispatch.dispatchNumber}`,
          });
        }
      });
    });

    data.transfersOut?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          events.push({
            date: new Date(transfer.transferDate),
            type: "transferOut",
            quantity: -(item.transferredQuantity || 0),
            description: `Transfer Out #${transfer.transferNumber}`,
          });
        }
      });
    });

    data.transfersIn?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          events.push({
            date: new Date(transfer.transferDate),
            type: "transferIn",
            quantity: item.transferredQuantity || 0,
            description: `Transfer In #${transfer.transferNumber}`,
          });
        }
      });
    });

    data.inventoryCounts?.forEach((count: any) => {
      count.countedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          events.push({
            date: new Date(count.countDate),
            type: "inventoryCount",
            quantity: item.countedQuantity || 0,
            description: `Inventory Count #${count.countNumber}`,
          });
        }
      });
    });

    // Sort events by date
    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Generate daily stock levels
    const history: StockHistoryEntry[] = [];
    let currentStock = 0;
    let currentDate = new Date(startDate);

    // Add initial stock (get stock at start date)
    const initialStock = await getStockAsOfDate(
      [stockItemId],
      [binId],
      startDate,
    );
    currentStock = initialStock[`${stockItemId}-${binId}`] || 0;

    history.push({
      date: currentDate.toISOString().split("T")[0],
      stock: currentStock,
    });

    // Process each day
    let eventIndex = 0;
    currentDate.setDate(currentDate.getDate() + 1);

    while (currentDate <= endDate) {
      const dayEvents: StockHistoryEntry["events"] = [];

      // Apply any events that happened on this day
      while (
        eventIndex < events.length &&
        events[eventIndex].date.toISOString().split("T")[0] <=
          currentDate.toISOString().split("T")[0]
      ) {
        const event = events[eventIndex];
        if (event.type === "inventoryCount") {
          currentStock = event.quantity;
        } else {
          currentStock = currentStock + event.quantity;
        }

        dayEvents.push({
          type: event.type,
          quantity: event.quantity,
          description: event.description,
        });

        eventIndex++;
      }

      history.push({
        date: currentDate.toISOString().split("T")[0],
        stock: currentStock,
        events: dayEvents.length > 0 ? dayEvents : undefined,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    logger.debug(`✅ Generated ${history.length} days of stock history`);
    return history;
  } catch (error) {
    console.error("❌ Error in getStockHistory:", error);
    return [];
  }
};

/*/ 15. Revert previous stock changes (with enhanced UX)
export async function revertPreviousStockChanges(transactionId: string) {
  try {
    logger.debug(`↩️ Reverting previous stock changes for transaction:`, transactionId);

    // Fetch all stock movements for this transaction
    const movements = await client.fetch(
      groq`*[_type == "StockMovement" && transactionId == $transactionId] {
        _id,
        stockItem->{
          _id,
          currentStock,
          name
        },
        quantity,
        previousStock,
        bin->{
          _id
        }
      }`,
      { transactionId }
    );

    logger.debug(`Found ${movements.length} stock movements to revert`);

    const revertPromises = movements.map(async (movement: any) => {
      if (!movement.stockItem?._id || !movement.bin?._id) return;

      const stockItemId = movement.stockItem._id;
      const binId = movement.bin._id;
      const quantityToRevert = Number(movement.quantity) || 0;
      const currentStock = Number(movement.stockItem.currentStock) || 0;

      // Revert the change
      const revertedStock = currentStock - quantityToRevert;

      // Update both systems:

      // 1. Update the stock item directly
      await writeClient
        .patch(stockItemId)
        .set({
          currentStock: revertedStock,
          updatedAt: new Date().toISOString()
        })
        .commit();

      // 2. ALSO update the stock snapshot
      await updateStockSnapshot(
        stockItemId,
        binId,
        revertedStock,
        'revert',
        transactionId
      );

      logger.debug(`↩️ Reverted ${movement.stockItem.name} stock:`, {
        current: currentStock,
        revertedBy: quantityToRevert,
        new: revertedStock
      });

      // Delete the movement record
      await writeClient.delete(movement._id);
    });

    await Promise.all(revertPromises);

    logger.debug(`✅ Reverted all previous stock changes for transaction ${transactionId}`);

  } catch (error) {
    console.error('❌ Failed to revert stock changes:', error);
    throw error;
  }
}*/

// 16. Utility function to clear all active timers (debugging)
export const clearAllTimers = (): void => {
  calculationManager.clearAllTimers();
  logger.debug("🧹 Cleared all active timers");
};

// 17. Utility function to get active calculation status (debugging)
export const getActiveCalculations = (): string[] => {
  return calculationManager.getLockKeys();
};

// Atomic cache update to prevent race conditions
const atomicCacheUpdate = async (
  key: string,
  quantity: number,
  metadata?: any,
): Promise<void> => {
  const mutex = getMutexForKey(`cache-${key}`);
  return mutex.runExclusive(() => {
    snapshotCache.set(key, quantity, metadata);
  });
};

// Emergency verification and fix function
export const verifyAndFixStock = async (
  stockItemId: string,
  binId: string,
): Promise<{ before: number; after: number; fixed: boolean }> => {
  logger.debug(`🔍 Verifying ${stockItemId} in ${binId}...`);

  // Get current calculated stock
  const currentResults = await calculateBulkStock([stockItemId], [binId]);
  const currentKey = `${stockItemId}-${binId}`;
  const currentStock = currentResults[currentKey] || 0;

  // Calculate from scratch using fixed logic
  const fixedStock = await calculateStockFromTransactionsFixed(
    stockItemId,
    binId,
    true,
  );

  // If different, fix it
  if (Math.abs(currentStock - fixedStock) > 0.001) {
    logger.debug(
      `⚠️ Fixing ${stockItemId} in ${binId}: ${currentStock} → ${fixedStock}`,
    );

    await updateStockSnapshot(
      stockItemId,
      binId,
      fixedStock,
      "verification_fix",
      null,
    );

    return {
      before: currentStock,
      after: fixedStock,
      fixed: true,
    };
  }

  return {
    before: currentStock,
    after: fixedStock,
    fixed: false,
  };
};

// Use this fixed version for recalculations
const calculateStockFromTransactionsFixed = async (
  stockItemId: string,
  binId: string,
  verbose: boolean = true,
): Promise<number> => {
  if (verbose) {
    logger.debug(`🧮 Fixed calculation for ${stockItemId} in ${binId}`);
  }

  try {
    // Get ALL transactions in proper chronological order WITH STATUS FILTERING
    const query = groq`{
      // Get goods receipts (only completed/processed)
      "goodsReceipts": *[
        _type == "GoodsReceipt" && 
        receivingBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(receiptDate asc) {
        _id,
        receiptDate,
        receiptNumber,
        status,
        receivedItems[] {
          "itemId": stockItem._ref,
          "quantity": receivedQuantity
        }
      },
      
      // Get dispatches (only completed/processed)
      "dispatches": *[
        _type == "DispatchLog" && 
        sourceBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(dispatchDate asc) {
        _id,
        dispatchDate,
        dispatchNumber,
        evidenceStatus,
        status,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          "quantity": dispatchedQuantity
        }
      },
      
      // Get transfers (only completed)          
      "transfers": *[
        _type == "InternalTransfer" && 
        (status == "completed" || _id == $currentTransferId) &&  // ADD THIS LINE
        (fromBin._ref == $binId || toBin._ref == $binId)
      ] | order(transferDate asc) {
        _type,
        _id,  // Make sure _id is included
        transferDate,
        "fromBinId": fromBin._ref,
        "toBinId": toBin._ref,
        transferredItems[] {
          "itemId": stockItem._ref,
          "quantity": transferredQuantity
        }
      },
      
      // Get inventory counts (only completed)
      "inventoryCounts": *[
        _type == "InventoryCount" && 
        bin._ref == $binId &&
        status == "completed"
      ] | order(countDate asc) {
        _id,
        countDate,
        countNumber,
        status,
        countedItems[] {
          "itemId": stockItem._ref,
          "quantity": countedQuantity
        }
      }
    }`;

    const data = await client.fetch(query, { binId, stockItemId });

    // Debug: Log what we found
    if (verbose) {
      logger.debug(`📊 Found events:`);
      logger.debug(`  Goods receipts: ${data.goodsReceipts?.length || 0}`);
      logger.debug(`  Dispatches: ${data.dispatches?.length || 0}`);
      logger.debug(`  Transfers: ${data.transfers?.length || 0}`);
      logger.debug(`  Inventory counts: ${data.inventoryCounts?.length || 0}`);

      // Log specific receipts for debugging
      data.goodsReceipts?.forEach((receipt: any, index: number) => {
        const item = receipt.receivedItems?.find(
          (i: any) => i.itemId === stockItemId,
        );
        if (item) {
          logger.debug(
            `  Receipt ${index}: ${receipt.receiptNumber} - ${item.quantity} units (${receipt.status})`,
          );
        }
      });
    }

    // Combine all events into one timeline
    const allEvents: Array<{
      _id: string;
      type:
        | "goodsReceipt"
        | "dispatch"
        | "transferOut"
        | "transferIn"
        | "inventoryCount";
      date: Date;
      documentNumber: string;
      status: string;
      itemQuantity: number;
      fromBinId?: string;
      toBinId?: string;
    }> = [];

    // Add goods receipts
    data.goodsReceipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.quantity > 0) {
          allEvents.push({
            _id: receipt._id,
            type: "goodsReceipt",
            date: new Date(receipt.receiptDate),
            documentNumber: receipt.receiptNumber,
            status: receipt.status,
            itemQuantity: item.quantity || 0,
          });
        }
      });
    });

    // Add dispatches
    data.dispatches?.forEach((dispatch: any) => {
      dispatch.dispatchedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.quantity > 0) {
          allEvents.push({
            _id: dispatch._id,
            type: "dispatch",
            date: new Date(dispatch.dispatchDate),
            documentNumber: dispatch.dispatchNumber,
            status: dispatch.evidenceStatus || dispatch.status,
            itemQuantity: -(item.quantity || 0), // Negative for outbound
          });
        }
      });
    });

    // Add transfers
    data.transfers?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.quantity > 0) {
          // Transfer OUT from this bin
          if (transfer.fromBinId === binId) {
            allEvents.push({
              _id: transfer._id,
              type: "transferOut",
              date: new Date(transfer.transferDate),
              documentNumber: transfer.transferNumber,
              status: transfer.status,
              itemQuantity: -(item.quantity || 0), // Negative for outbound
              fromBinId: transfer.fromBinId,
              toBinId: transfer.toBinId,
            });
          }

          // Transfer IN to this bin
          if (transfer.toBinId === binId) {
            allEvents.push({
              _id: transfer._id,
              type: "transferIn",
              date: new Date(transfer.transferDate),
              documentNumber: transfer.transferNumber,
              status: transfer.status,
              itemQuantity: item.quantity || 0, // Positive for inbound
              fromBinId: transfer.fromBinId,
              toBinId: transfer.toBinId,
            });
          }
        }
      });
    });

    // Add inventory counts
    data.inventoryCounts?.forEach((count: any) => {
      count.countedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          allEvents.push({
            _id: count._id,
            type: "inventoryCount",
            date: new Date(count.countDate),
            documentNumber: count.countNumber,
            status: count.status,
            itemQuantity: item.quantity || 0,
          });
        }
      });
    });

    // Sort all events by date
    allEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

    if (verbose && allEvents.length > 0) {
      logger.debug(`📅 Timeline of ${allEvents.length} events:`);
      allEvents.forEach((event, index) => {
        const dateStr = event.date.toISOString().split("T")[0];
        logger.debug(
          `  ${index + 1}. ${dateStr} - ${event.type} ${event.documentNumber}: ${event.itemQuantity > 0 ? "+" : ""}${event.itemQuantity}`,
        );
      });
    }

    let stock = new Decimal(0);
    let lastCountDate: Date | null = null;
    let lastCountStock: number = 0;

    // Track processed event IDs to avoid duplicates
    const processedEventIds = new Set<string>();

    // Process in strict chronological order
    for (const event of allEvents) {
      // Skip if we've already processed this event
      if (processedEventIds.has(event._id)) {
        if (verbose) {
          logger.debug(
            `⚠️ Skipping duplicate event: ${event.type} ${event.documentNumber} (${event._id})`,
          );
        }
        continue;
      }

      processedEventIds.add(event._id);

      // Skip if before last inventory count (unless it's another count)
      if (
        lastCountDate &&
        event.date < lastCountDate &&
        event.type !== "inventoryCount"
      ) {
        if (verbose) {
          logger.debug(
            `⏭️ Skipping event before last count: ${event.type} ${event.documentNumber} (${event.date.toISOString().split("T")[0]}) < ${lastCountDate.toISOString().split("T")[0]}`,
          );
        }
        continue;
      }

      const stockBefore = stock.toNumber();

      switch (event.type) {
        case "goodsReceipt":
        case "transferIn":
          stock = stock.plus(event.itemQuantity);
          if (verbose) {
            logger.debug(
              `📥 ${event.type} ${event.documentNumber}: +${event.itemQuantity} units (${stockBefore} → ${stock.toNumber()})`,
            );
          }
          break;

        case "dispatch":
        case "transferOut":
          const dispatchQty = new Decimal(Math.abs(event.itemQuantity));
          if (stock.greaterThanOrEqualTo(dispatchQty)) {
            stock = stock.minus(dispatchQty);
          } else {
            if (verbose) {
              console.warn(
                `⚠️ ${event.type} would cause negative stock. Available: ${stock.toNumber()}, ${event.type}: ${dispatchQty.toNumber()}`,
              );
            }
            stock = new Decimal(0);
          }

          if (verbose) {
            logger.debug(
              `📤 ${event.type} ${event.documentNumber}: ${event.itemQuantity} units (${stockBefore} → ${stock.toNumber()})`,
            );
          }
          break;

        case "inventoryCount":
          // Count SETS the absolute stock
          stock = new Decimal(event.itemQuantity);
          lastCountDate = event.date;
          lastCountStock = event.itemQuantity;

          if (verbose) {
            logger.debug(
              `📋 Inventory Count ${event.documentNumber}: SET to ${event.itemQuantity} units (was ${stockBefore})`,
            );
          }
          break;
      }
    }

    const finalStock = stock.toNumber();

    if (verbose) {
      logger.debug(`✅ Fixed calculation result: ${finalStock}`);
      if (lastCountDate !== null && lastCountDate !== undefined) {
        const date: Date = lastCountDate;

        // Check if it's a valid date before calling toISOString
        if (!isNaN(date.getTime())) {
          logger.debug(
            `   📅 Last inventory count: ${date.toISOString().split("T")[0]} (stock: ${lastCountStock})`,
          );
        } else {
          logger.debug(`   📅 Last inventory count: Invalid date`);
        }
      }

      // Summary
      logger.debug(`📊 Processing Summary:`);
      logger.debug(`   Total events: ${allEvents.length}`);
      logger.debug(`   Processed events: ${processedEventIds.size}`);
      logger.debug(`   Final stock: ${finalStock}`);
    }

    return finalStock;
  } catch (error) {
    console.error("Error in fixed calculation:", error);
    return 0;
  }
};

/**
 * 🎯 EXACT CALCULATION LOGIC AS SPECIFIED
 * 1. Find latest inventory count for this item-bin
 * 2. Start from count value (or 0)
 * 3. Add receipts after count
 * 4. Add transfers IN after count
 * 5. Deduct dispatches after count
 * 6. Deduct transfers OUT after count
 * 7. Return calculated stock
 */
export const calculateStockExactLogic = async (
  stockItemId: string,
  binId: string,
  verbose: boolean = false,
): Promise<number> => {
  const startTime = Date.now();

  if (verbose) {
    logger.debug(`🎯 Calculating exact stock for ${stockItemId} in ${binId}`);
  }

  try {
    // STEP 1: Find latest inventory count for this specific item in this bin
    const countQuery = groq`*[
      _type == "InventoryCount" && 
      bin._ref == $binId &&
      status == "completed"
    ] | order(countDate desc) {
      _id,
      countDate,
      countNumber,
      countedItems[] {
        "itemId": stockItem._ref,
        countedQuantity
      }
    }`;

    const counts = await client.fetch(countQuery, { binId });

    let startingStock = 0;
    let lastCountDate: Date | null = null;

    // Find if this specific item was counted
    for (const count of counts) {
      const countedItem = count.countedItems?.find(
        (item: any) => item.itemId === stockItemId,
      );

      if (countedItem) {
        startingStock = countedItem.countedQuantity || 0;
        lastCountDate = new Date(count.countDate);

        if (verbose) {
          logger.debug(
            `📋 Found inventory count: ${count.countNumber} on ${count.countDate}`,
          );
          logger.debug(`   Starting stock: ${startingStock}`);
        }
        break;
      }
    }

    if (verbose && !lastCountDate) {
      logger.debug(
        `📋 No inventory count found for ${stockItemId} in ${binId}, starting from 0`,
      );
    }

    // STEP 2: Get all transactions AFTER the last count (or all if no count)
    const dateFilter = lastCountDate ? `&& date > $lastCountDate` : "";

    const transactionsQuery = groq`{
      // Goods receipts INTO this bin
      "receipts": *[
        _type == "GoodsReceipt" && 
        status in ["completed", "processed"] &&
        receivingBin._ref == $binId
        ${dateFilter}
      ] | order(receiptDate asc) {
        receiptDate,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity
        }
      },
      
      // Dispatches FROM this bin
      "dispatches": *[
        _type == "DispatchLog" && 
        status in ["completed", "processed"] &&
        sourceBin._ref == $binId
        ${dateFilter}
      ] | order(dispatchDate asc) {
        dispatchDate,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity
        }
      },
      
      // Transfers INTO this bin
      "transfersIn": *[
        _type == "InternalTransfer" && 
        status == "completed" &&
        toBin._ref == $binId
        ${dateFilter}
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      // Transfers OUT OF this bin
      "transfersOut": *[
        _type == "InternalTransfer" && 
        status == "completed" &&
        fromBin._ref == $binId
        ${dateFilter}
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      }
    }`;

    const params = lastCountDate
      ? { stockItemId, binId, lastCountDate: lastCountDate.toISOString() }
      : { stockItemId, binId };

    const data = await client.fetch(transactionsQuery, params);

    let currentStock = new Decimal(startingStock);

    // STEP 3: Process ALL transactions in chronological order
    const allTransactions: Array<{
      date: Date;
      type: "receipt" | "dispatch" | "transferIn" | "transferOut" | "count";
      quantity: number;
    }> = [];

    // --- Add Archived Transactions ---
    try {
      const archived = await getArchivedTransactionsForItem(stockItemId, binId);
      archived.forEach((tx) => {
        if (lastCountDate && new Date(tx.date) <= lastCountDate) return;
        if (tx.type === "count") return; // Handled as starting point in count logic

        allTransactions.push({
          date: new Date(tx.date),
          type: tx.type as any,
          quantity: tx.quantity,
        });
      });
    } catch (e) {
      console.warn("⚠️ Could not fetch archived transactions:", e);
    }

    // Add receipts
    data.receipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.receivedQuantity > 0) {
          allTransactions.push({
            date: new Date(receipt.receiptDate),
            type: "receipt",
            quantity: item.receivedQuantity,
          });
        }
      });
    });

    // Add dispatches
    data.dispatches?.forEach((dispatch: any) => {
      dispatch.dispatchedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.dispatchedQuantity > 0) {
          allTransactions.push({
            date: new Date(dispatch.dispatchDate),
            type: "dispatch",
            quantity: -item.dispatchedQuantity, // Negative for deduction
          });
        }
      });
    });

    // Add transfers IN
    data.transfersIn?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.transferredQuantity > 0) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferIn",
            quantity: item.transferredQuantity,
          });
        }
      });
    });

    // Add transfers OUT
    data.transfersOut?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.transferredQuantity > 0) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferOut",
            quantity: -item.transferredQuantity, // Negative for deduction
          });
        }
      });
    });

    // Sort by date (chronological order)
    allTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    // STEP 4: Apply transactions
    allTransactions.forEach((tx, index) => {
      const stockBefore = currentStock.toNumber();
      currentStock = currentStock.plus(tx.quantity);

      // Negative stock is allowed (consistent with calculateStockForBin /
      // calculateStockFromTransactions), but still surfaced as a warning
      // rather than silently going unnoticed.
      if (tx.quantity < 0 && currentStock.isNegative()) {
        console.warn(
          `⚠️ ${tx.type} exceeds available stock for ${stockItemId} in ${binId}. Available: ${stockBefore}, Change: ${tx.quantity}`,
        );
      }

      if (verbose) {
        logger.debug(
          `  ${index + 1}. ${tx.date.toISOString().split("T")[0]} ${tx.type}: ${tx.quantity > 0 ? "+" : ""}${tx.quantity} (${stockBefore} → ${currentStock.toNumber()})`,
        );
      }
    });

    const finalStock = currentStock.toNumber();

    if (verbose) {
      const duration = Date.now() - startTime;
      logger.debug(
        `✅ Final stock: ${finalStock} (calculated in ${duration}ms)`,
      );
      logger.debug(`   Transactions processed: ${allTransactions.length}`);
      logger.debug(
        `   Starting point: ${startingStock} ${lastCountDate ? `(from count on ${lastCountDate.toISOString().split("T")[0]})` : "(no count)"}`,
      );
    }

    return finalStock;
  } catch (error) {
    console.error(
      `❌ Error in exact calculation for ${stockItemId}-${binId}:`,
      error,
    );
    return 0;
  }
};

/**
 * 🎯 CORRECT STOCK CALCULATION LOGIC:
 * 1. Find last inventory count for this item in this bin
 * 2. Start from that count value (or 0 if no count)
 * 3. Apply all transactions chronologically SINCE the count
 * 4. Handle negative stock properly: reset to 0 when receiving new stock
 */
export const calculateStockWithHistory = async (
  stockItemId: string,
  binId: string,
): Promise<{
  currentStock: number;
  transactions: Array<{
    date: string;
    type: "receipt" | "dispatch" | "transferIn" | "transferOut" | "count";
    documentNumber: string;
    quantity: number;
    runningTotal: number;
    isNegative: boolean;
  }>;
  summary: {
    lastCount?: { date: string; quantity: number; documentNumber: string };
    startingPoint: string;
    transactionCount: number;
  };
}> => {
  logger.debug(`🧮 Calculating accurate stock for ${stockItemId} in ${binId}`);

  try {
    // STEP 1: Find the most recent inventory count for this exact item-bin
    const countQuery = groq`*[
      _type == "InventoryCount" && 
      bin._ref == $binId &&
      status == "completed"
    ] | order(countDate desc) {
      _id,
      countDate,
      countNumber,
      countedItems[] {
        "itemId": stockItem._ref,
        countedQuantity
      }
    }`;

    const counts = await client.fetch(countQuery, { binId });

    let lastCount = null;
    let lastCountDate = null;

    // Find if this specific item was counted
    for (const count of counts) {
      const countedItem = count.countedItems?.find(
        (item: any) => item.itemId === stockItemId,
      );
      if (countedItem) {
        lastCount = {
          date: count.countDate,
          quantity: countedItem.countedQuantity,
          documentNumber: count.countNumber,
          countId: count._id,
        };
        lastCountDate = new Date(count.countDate);
        break;
      }
    }

    // STEP 2: Get all transactions that could affect this item-bin
    // If we have a last count, only get transactions AFTER that date
    // If no count, get ALL transactions
    const dateFilter = lastCountDate ? `&& date > $lastCountDate` : "";

    const transactionQuery = groq`{
      // Goods Receipts that put stock INTO this bin
      "receipts": *[
        _type == "GoodsReceipt" && 
        status in ["completed", "processed"]
        ${dateFilter}
      ] | order(receiptDate asc) {
        _id,
        receiptDate,
        receiptNumber,
        status,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity,
          "binId": receivingBin._ref  // CRITICAL: Get bin at item level
        }
      },
      
      // Dispatches that take stock OUT OF this bin
      "dispatches": *[
        _type == "DispatchLog" && 
        status in ["completed", "processed"]
        ${dateFilter}
      ] | order(dispatchDate asc) {
        _id,
        dispatchDate,
        dispatchNumber,
        evidenceStatus,
        status,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity,
          "binId": sourceBin._ref  // CRITICAL: Get bin at item level
        }
      },
      
      // Transfers INTO this bin
      "transfersIn": *[
        _type == "InternalTransfer" && 
        status == "completed" &&
        toBin._ref == $binId
        ${dateFilter}
      ] | order(transferDate asc) {
        _id,
        transferDate,
        transferNumber,
        status,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      // Transfers OUT OF this bin
      "transfersOut": *[
        _type == "InternalTransfer" && 
        status == "completed" &&
        fromBin._ref == $binId
        ${dateFilter}
      ] | order(transferDate asc) {
        _id,
        transferDate,
        transferNumber,
        status,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      // Get item details for reference
      "itemDetails": *[_type == "StockItem" && _id == $stockItemId][0] {
        name,
        sku,
        unitOfMeasure
      }
    }`;

    const params = { binId, stockItemId, lastCountDate };
    const data = await client.fetch(transactionQuery, params);

    // STEP 3: Process all transactions in chronological order
    const allTransactions: Array<{
      date: Date;
      type: "receipt" | "dispatch" | "transferIn" | "transferOut" | "count";
      documentId: string;
      documentNumber: string;
      quantity: number;
    }> = [];

    // --- Add Archived Transactions ---
    try {
      const archived = await getArchivedTransactionsForItem(stockItemId, binId);
      archived.forEach((tx) => {
        // Only include transactions after the last Sanity count if one exists
        if (lastCountDate && new Date(tx.date) <= lastCountDate) return;

        allTransactions.push({
          date: new Date(tx.date),
          type: tx.type,
          documentId: `archived-${tx.documentNumber}`,
          documentNumber: tx.documentNumber,
          quantity: tx.quantity,
        });
      });
    } catch (e) {
      console.warn("⚠️ Could not fetch archived transactions:", e);
    }

    // Add the last count as starting point
    if (lastCount) {
      allTransactions.push({
        date: new Date(lastCount.date),
        type: "count",
        documentId: lastCount.countId,
        documentNumber: `COUNT-${lastCount.documentNumber}`,
        quantity: lastCount.quantity,
      });
    }

    // Add receipts for THIS bin only
    data.receipts?.forEach((receipt: any) => {
      receipt.receivedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.binId === binId) {
          allTransactions.push({
            date: new Date(receipt.receiptDate),
            type: "receipt",
            documentId: receipt._id,
            documentNumber: receipt.receiptNumber,
            quantity: item.receivedQuantity || 0,
          });
        }
      });
    });

    // Add dispatches from THIS bin only
    data.dispatches?.forEach((dispatch: any) => {
      dispatch.dispatchedItems?.forEach((item: any) => {
        if (item.itemId === stockItemId && item.binId === binId) {
          allTransactions.push({
            date: new Date(dispatch.dispatchDate),
            type: "dispatch",
            documentId: dispatch._id,
            documentNumber: dispatch.dispatchNumber,
            quantity: -(item.dispatchedQuantity || 0), // NEGATIVE for outbound
          });
        }
      });
    });

    // Add transfers INTO this bin
    data.transfersIn?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferIn",
            documentId: transfer._id,
            documentNumber: transfer.transferNumber,
            quantity: item.transferredQuantity || 0,
          });
        }
      });
    });

    // Add transfers OUT OF this bin
    data.transfersOut?.forEach((transfer: any) => {
      transfer.transferredItems?.forEach((item: any) => {
        if (item.itemId === stockItemId) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferOut",
            documentId: transfer._id,
            documentNumber: transfer.transferNumber,
            quantity: -(item.transferredQuantity || 0), // NEGATIVE for outbound
          });
        }
      });
    });

    // Sort by date
    allTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    // STEP 4: Apply transactions with CORRECT logic
    const transactionHistory: Array<{
      date: string;
      type: "receipt" | "dispatch" | "transferIn" | "transferOut" | "count";
      documentNumber: string;
      quantity: number;
      runningTotal: number;
      isNegative: boolean;
    }> = [];

    let currentStock = lastCount ? lastCount.quantity : 0;

    // Add starting point
    if (lastCount) {
      transactionHistory.push({
        date: lastCount.date,
        type: "count",
        documentNumber: `COUNT-${lastCount.documentNumber}`,
        quantity: lastCount.quantity,
        runningTotal: currentStock,
        isNegative: currentStock < 0,
      });
    }

    // Process each transaction
    for (const tx of allTransactions) {
      // Skip the count if we already added it as starting point
      if (
        tx.type === "count" &&
        lastCount &&
        tx.documentId === lastCount.countId
      ) {
        continue;
      }

      const previousStock = currentStock;

      // APPLY THE CORRECT LOGIC:
      if (tx.type === "count") {
        // Inventory count SETS the absolute value
        currentStock = tx.quantity;
      } else if (tx.type === "receipt" || tx.type === "transferIn") {
        // If stock is negative, reset to 0 then add
        if (currentStock < 0) {
          logger.debug(
            `🔄 Resetting negative stock ${currentStock} to 0, then adding ${tx.quantity}`,
          );
          currentStock = tx.quantity; // 0 + quantity
        } else {
          currentStock += tx.quantity;
        }
      } else if (tx.type === "dispatch" || tx.type === "transferOut") {
        // Dispatches and transfers out can make stock negative
        currentStock += tx.quantity; // quantity is negative
      }

      // Add to history
      transactionHistory.push({
        date: tx.date.toISOString(),
        type: tx.type,
        documentNumber: tx.documentNumber,
        quantity: tx.quantity,
        runningTotal: currentStock,
        isNegative: currentStock < 0,
      });

      logger.debug(
        `📝 ${tx.type} ${tx.documentNumber}: ${tx.quantity > 0 ? "+" : ""}${tx.quantity} (${previousStock} → ${currentStock})`,
      );
    }

    // STEP 5: Return everything
    return {
      currentStock,
      transactions: transactionHistory,
      summary: {
        lastCount: lastCount
          ? {
              date: lastCount.date,
              quantity: lastCount.quantity,
              documentNumber: lastCount.documentNumber,
            }
          : undefined,
        startingPoint: lastCount
          ? `Inventory Count ${lastCount.documentNumber} on ${new Date(lastCount.date).toLocaleDateString()}`
          : "Beginning of records (no inventory count found)",
        transactionCount: transactionHistory.length,
      },
    };
  } catch (error) {
    console.error("Error in accurate stock calculation:", error);
    return {
      currentStock: 0,
      transactions: [],
      summary: {
        startingPoint: "Error in calculation",
        transactionCount: 0,
      },
    };
  }
};

// Update the existing emergency function to use this fixed version
export const emergencyRecalculateAllStock = async (): Promise<void> => {
  logger.debug("🚨 Emergency recalculating ALL stock...");

  // Get all bins
  const bins = await client.fetch(groq`*[_type == "Bin"] { _id, name }`);
  // Get all stock items
  const items = await client.fetch(groq`*[_type == "StockItem"] { _id, name }`);

  let fixed = 0;
  let errors = 0;

  for (const bin of bins) {
    logger.debug(`📦 Processing bin: ${bin.name}`);

    for (const item of items) {
      try {
        // Use the FIXED calculation
        const stock = await calculateStockFromTransactionsFixed(
          item._id,
          bin._id,
          false,
        );

        // Update snapshot
        await updateStockSnapshot(
          item._id,
          bin._id,
          stock,
          "emergency_fix",
          null,
        );

        fixed++;

        if (fixed % 50 === 0) {
          logger.debug(`  Fixed ${fixed} items...`);
        }
      } catch (error) {
        errors++;
        console.error(`❌ Error fixing ${item.name} in ${bin.name}:`, error);
      }
    }
  }

  logger.debug(`✅ Emergency fix complete: ${fixed} fixed, ${errors} errors`);
};

// 18. Diagnostic tool for stock calculation analysis
export const auditStockCalculations = async (
  stockItemId: string,
  binId: string,
): Promise<{
  rawTransactions: any[];
  chronologicalCalculation: number;
  snapshotCalculation: number;
  differences: Array<{
    date: string;
    transaction: string;
    impact: number;
    cumulative: number;
    notes?: string;
  }>;
  issues: string[];
}> => {
  logger.debug(`🔍 Auditing ${stockItemId} in ${binId} (ALLOWING NEGATIVES)`);

  const issues: string[] = [];

  // 1. Get raw transaction data
  const rawData = await client.fetch(
    groq`{
    "goodsReceipts": *[_type == "GoodsReceipt" && receivingBin._ref == $binId] | order(receiptDate asc) {
      _id,
      receiptDate,
      receiptNumber,
      status,
      receivedItems[] {
        "itemId": stockItem._ref,
        receivedQuantity
      }
    },
    "dispatches": *[_type == "DispatchLog" && sourceBin._ref == $binId] | order(dispatchDate asc) {
      _id,
      dispatchDate,
      dispatchNumber,
      evidenceStatus,
      status,
      dispatchedItems[] {
        "itemId": stockItem._ref,
        dispatchedQuantity
      }
    },
    "transfers": *[_type == "InternalTransfer" && (fromBin._ref == $binId || toBin._ref == $binId)] | order(transferDate asc) {
      _id,
      transferDate,
      transferNumber,
      status,
      "fromBinId": fromBin._ref,
      "toBinId": toBin._ref,
      transferredItems[] {
        "itemId": stockItem._ref,
        transferredQuantity
      }
    },
    "counts": *[_type == "InventoryCount" && bin._ref == $binId] | order(countDate asc) {
      _id,
      countDate,
      countNumber,
      status,
      countedItems[] {
        "itemId": stockItem._ref,
        countedQuantity
      }
    }
  }`,
    { binId, stockItemId },
  );

  // 2. Flatten and sort all transactions
  const allTransactions: Array<{
    date: Date;
    type: "receipt" | "dispatch" | "transferOut" | "transferIn" | "count";
    documentId: string;
    documentNumber: string;
    quantity: number;
    status: string;
  }> = [];

  // Process goods receipts
  rawData.goodsReceipts?.forEach((receipt: any) => {
    receipt.receivedItems?.forEach((item: any) => {
      if (item.itemId === stockItemId) {
        allTransactions.push({
          date: new Date(receipt.receiptDate),
          type: "receipt",
          documentId: receipt._id,
          documentNumber: receipt.receiptNumber,
          quantity: item.receivedQuantity || 0,
          status: receipt.status,
        });
      }
    });
  });

  // Process dispatches
  rawData.dispatches?.forEach((dispatch: any) => {
    dispatch.dispatchedItems?.forEach((item: any) => {
      if (item.itemId === stockItemId) {
        allTransactions.push({
          date: new Date(dispatch.dispatchDate),
          type: "dispatch",
          documentId: dispatch._id,
          documentNumber: dispatch.dispatchNumber,
          quantity: -(item.dispatchedQuantity || 0),
          status: dispatch.evidenceStatus || dispatch.status,
        });
      }
    });
  });

  // Process transfers
  rawData.transfers?.forEach((transfer: any) => {
    transfer.transferredItems?.forEach((item: any) => {
      if (item.itemId === stockItemId) {
        // Transfer OUT from this bin
        if (transfer.fromBinId === binId) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferOut",
            documentId: transfer._id,
            documentNumber: transfer.transferNumber,
            quantity: -(item.transferredQuantity || 0),
            status: transfer.status,
          });
        }
        // Transfer IN to this bin
        if (transfer.toBinId === binId) {
          allTransactions.push({
            date: new Date(transfer.transferDate),
            type: "transferIn",
            documentId: transfer._id,
            documentNumber: transfer.transferNumber,
            quantity: item.transferredQuantity || 0,
            status: transfer.status,
          });
        }
      }
    });
  });

  // Process inventory counts
  rawData.counts?.forEach((count: any) => {
    count.countedItems?.forEach((item: any) => {
      if (item.itemId === stockItemId) {
        allTransactions.push({
          date: new Date(count.countDate),
          type: "count",
          documentId: count._id,
          documentNumber: count.countNumber,
          quantity: item.countedQuantity || 0,
          status: count.status,
        });
      }
    });
  });

  // Sort by date
  allTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

  // 3. Calculate chronologically (with proper inventory count logic)
  let chronologicalStock = 0;
  const differences: {
    date: string;
    transaction: string;
    impact: number;
    cumulative: number;
    notes: string | undefined;
  }[] = [];
  const countTimeline: Array<{ date: Date; quantity: number }> = [];

  // First pass: collect inventory counts
  allTransactions.forEach((tx) => {
    if (tx.type === "count") {
      countTimeline.push({ date: tx.date, quantity: tx.quantity });
    }
  });

  // Second pass: process all transactions
  allTransactions.forEach((tx) => {
    const stockBefore = chronologicalStock;

    // Find the most recent count that happened ON or BEFORE this transaction
    let applicableCount: number | null = null;
    let applicableCountDate: Date | null = null;

    for (let i = countTimeline.length - 1; i >= 0; i--) {
      if (countTimeline[i].date <= tx.date) {
        applicableCount = countTimeline[i].quantity;
        applicableCountDate = countTimeline[i].date;
        break;
      }
    }

    if (tx.type === "count") {
      // Count sets the absolute stock
      chronologicalStock = tx.quantity;
      differences.push({
        date: tx.date.toISOString(),
        transaction: `${tx.type} #${tx.documentNumber}`,
        impact: tx.quantity - stockBefore,
        cumulative: chronologicalStock,
        notes: `RESET: Count sets stock to ${tx.quantity}`,
      });
    } else if (applicableCountDate === null || tx.date > applicableCountDate) {
      // Transaction happens AFTER the most recent count (or no count yet)
      chronologicalStock += tx.quantity;
      differences.push({
        date: tx.date.toISOString(),
        transaction: `${tx.type} #${tx.documentNumber}`,
        impact: tx.quantity,
        cumulative: chronologicalStock,
        notes: tx.quantity < 0 ? `Negative allowed for analysis` : undefined,
      });
    } else {
      // Transaction happened BEFORE the most recent count - should be ignored
      differences.push({
        date: tx.date.toISOString(),
        transaction: `${tx.type} #${tx.documentNumber}`,
        impact: tx.quantity,
        cumulative: chronologicalStock,
        notes: `IGNORED: Happened before count on ${applicableCountDate.toISOString().split("T")[0]}`,
      });
    }

    // Check for data quality issues
    if (
      tx.status &&
      !["completed", "complete", "processed"].includes(tx.status)
    ) {
      issues.push(
        `Transaction ${tx.type} #${tx.documentNumber} has status "${tx.status}" - might be excluded from calculations`,
      );
    }
  });

  // 4. Get current snapshot calculation for comparison
  const snapshotResult = await calculateStock(stockItemId, binId);

  // 5. Identify discrepancies
  if (Math.abs(chronologicalStock - snapshotResult.quantity) > 0.01) {
    issues.push(
      `CALCULATION MISMATCH: Chronological=${chronologicalStock}, Snapshot=${snapshotResult.quantity}, Difference=${chronologicalStock - snapshotResult.quantity}`,
    );
  }

  // 6. Check for negative stock patterns
  if (chronologicalStock < 0) {
    const negativeTransactions = differences.filter((d) => d.cumulative < 0);
    if (negativeTransactions.length > 0) {
      issues.push(
        `NEGATIVE STOCK DETECTED: ${chronologicalStock} units missing. Check transactions around ${negativeTransactions[0].date}`,
      );
    }
  }

  return {
    rawTransactions: allTransactions,
    chronologicalCalculation: chronologicalStock,
    snapshotCalculation: snapshotResult.quantity,
    differences,
    issues,
  };
};

export const getCurrentStockSnapshots = async (
  stockItemIds?: string[],
  binIds?: string[],
): Promise<
  Array<{
    _id: string;
    stockItem: {
      _id: string;
      name: string;
      sku?: string;
    };
    bin: {
      _id: string;
      name: string;
      site?: {
        _id: string;
        name: string;
      };
    };
    quantity: number;
    lastUpdated: string;
  }>
> => {
  try {
    logger.debug("📊 Fetching current stock from registry...");

    // Get registry data
    const registryQuery = groq`*[_type == "stockRegistry"][0] {
      stockData
    }`;

    const registry = await client.fetch(registryQuery);
    const snapshots: any[] = [];

    if (registry?.stockData?.items) {
      // Get item and bin details for the ones we need
      const itemIds = stockItemIds || [];
      const binIdsList = binIds || [];

      // Fetch item details
      let itemQuery = groq`*[_type == "StockItem"]`;
      if (itemIds.length > 0) {
        itemQuery += `[_id in $itemIds]`;
      }
      itemQuery += ` { _id, name, sku, unitOfMeasure, minimumStockLevel }`;

      const items = await client.fetch(itemQuery, { itemIds });

      // Fetch bin details
      let binQuery = groq`*[_type == "Bin"]`;
      if (binIdsList.length > 0) {
        binQuery += `[_id in $binIds]`;
      }
      binQuery += ` { _id, name, "site": site->{ _id, name } }`;

      const bins = await client.fetch(binQuery, { binIds: binIdsList });

      // Create lookup maps
      const itemMap = new Map(items.map((item: any) => [item._id, item]));
      const binMap = new Map(bins.map((bin: any) => [bin._id, bin]));

      // Build snapshots from registry
      registry.stockData.items.forEach((item: any) => {
        // Skip if filtering by itemIds and this item isn't included
        if (itemIds.length > 0 && !itemIds.includes(item.stockItemId)) {
          return;
        }

        if (item.binQuantities?.bins) {
          item.binQuantities.bins.forEach((bin: any) => {
            // Skip if filtering by binIds and this bin isn't included
            if (binIdsList.length > 0 && !binIdsList.includes(bin.binId)) {
              return;
            }

            const itemDetails = itemMap.get(item.stockItemId);
            const binDetails = binMap.get(bin.binId);

            if (itemDetails && binDetails) {
              snapshots.push({
                _id: `registry-${item.stockItemId}-${bin.binId}`,
                stockItem: itemDetails,
                bin: binDetails,
                quantity: bin.quantity || 0,
                lastUpdated: bin.lastUpdated || new Date().toISOString(),
              });
            }
          });
        }
      });
    }

    logger.debug(`✅ Found ${snapshots.length} stock entries in registry`);
    return snapshots;
  } catch (error) {
    console.error("❌ Error fetching from stock registry:", error);
    return [];
  }
};

// Add after the previous function
export const compareSnapshotsWithCalculated = async (
  stockItemIds: string[],
  binIds: string[],
): Promise<
  Array<{
    stockItemId: string;
    binId: string;
    snapshotQuantity: number;
    calculatedQuantity: number;
    difference: number;
    matches: boolean;
    stockItemName?: string;
    binName?: string;
  }>
> => {
  try {
    logger.debug("🔍 Comparing snapshots with calculated stock...");

    // Get snapshots
    const snapshots = await getCurrentStockSnapshots(stockItemIds, binIds);

    // Calculate from transactions
    const calculatedResults = await calculateBulkStockFromTransactions(
      stockItemIds,
      binIds,
    );

    // Create comparison
    const comparison = [];

    for (const snapshot of snapshots) {
      const key = `${snapshot.stockItem._id}-${snapshot.bin._id}`;
      const calculatedQuantity = calculatedResults[key] || 0;
      const snapshotQuantity = snapshot.quantity || 0;
      const difference = Math.abs(snapshotQuantity - calculatedQuantity);
      const matches = difference < 0.01; // Allow small floating point differences

      comparison.push({
        stockItemId: snapshot.stockItem._id,
        binId: snapshot.bin._id,
        stockItemName: snapshot.stockItem.name,
        binName: snapshot.bin.name,
        snapshotQuantity,
        calculatedQuantity,
        difference,
        matches,
      });
    }

    // Also check for items that should have snapshots but don't
    const missingSnapshots = [];

    for (const binId of binIds) {
      for (const itemId of stockItemIds) {
        const key = `${itemId}-${binId}`;
        const calculatedQuantity = calculatedResults[key] || 0;

        // If there's stock but no snapshot
        if (calculatedQuantity > 0) {
          const hasSnapshot = snapshots.some(
            (s) => s.stockItem._id === itemId && s.bin._id === binId,
          );

          if (!hasSnapshot) {
            missingSnapshots.push({
              stockItemId: itemId,
              binId,
              calculatedQuantity,
              snapshotQuantity: 0,
              difference: calculatedQuantity,
              matches: false,
              status: "MISSING_SNAPSHOT",
            });
          }
        }
      }
    }

    const allResults = [...comparison, ...missingSnapshots];

    logger.debug("📊 Comparison results:", {
      totalSnapshots: snapshots.length,
      compared: comparison.length,
      missing: missingSnapshots.length,
      matches: allResults.filter((r) => r.matches).length,
      mismatches: allResults.filter((r) => !r.matches).length,
    });

    return allResults;
  } catch (error) {
    console.error("❌ Error comparing snapshots:", error);
    return [];
  }
};

// Add to exports section at the bottom or near other export functions:
export const getStockTransactionHistory = auditStockCalculations;
