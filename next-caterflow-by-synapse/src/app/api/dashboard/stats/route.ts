import { NextRequest, NextResponse } from 'next/server';
import { calculateBulkStock } from '@/lib/stockCalculations';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import Decimal from 'decimal.js';
import { getUserSiteInfo } from '@/lib/siteFiltering';
import { timed, withServerTiming, Timings } from '@/lib/perf';

// Cache for dashboard data
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

// Helper function to get empty stats
function getEmptyStats() {
  return {
    monthlyReceiptsCount: 0,
    receiptsTrend: 0,
    monthlyDispatchesCount: 0,
    todaysDispatchesCount: 0,
    pendingActionsCount: 0,
    pendingTransfersCount: 0,
    draftOrdersCount: 0,
    lowStockItemsCount: 0,
    outOfStockItemsCount: 0,
    weeklyActivityCount: 0,
    todayActivityCount: 0,
    totalStockCount: 0
  };
}

// Fetch all sites user can access
async function fetchAllUserSites(userSiteInfo: any) {
  if (userSiteInfo.canAccessMultipleSites) {
    // Admin/auditor can access all sites
    const query = groq`*[_type == "Site"] | order(name asc) { _id, name }`;
    return await client.fetch(query);
  } else if (userSiteInfo.userSiteId) {
    // Site manager can only access their site
    const query = groq`*[_type == "Site" && _id == $siteId] { _id, name }`;
    return await client.fetch(query, { siteId: userSiteInfo.userSiteId });
  }
  return [];
}

// Main POST function with legacy support
export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const timings: Timings = {};
  try {
    const { siteIds } = await request.json();
    const userSiteInfo = await getUserSiteInfo(request);

    // Determine which site IDs the user is allowed to access
    let allowedSiteIds: string[] = [];

    if (userSiteInfo.canAccessMultipleSites) {
      // Admin/auditor can access all requested sites or all sites if none specified
      if (siteIds && Array.isArray(siteIds) && siteIds.length > 0) {
        allowedSiteIds = siteIds;
      } else {
        const allSites = await timed('sites', () => fetchAllUserSites(userSiteInfo), timings);
        allowedSiteIds = allSites.map((site: { _id: any; }) => site._id);
      }
    } else if (userSiteInfo.userSiteId) {
      // Site manager - can only access their associated site
      allowedSiteIds = [userSiteInfo.userSiteId];
    }

    if (allowedSiteIds.length === 0) {
      return NextResponse.json({
        transactions: [],
        stats: getEmptyStats()
      });
    }

    // Check cache with allowed site IDs
    const cacheKey = JSON.stringify([...allowedSiteIds].sort());
    const cachedData = cache.get(cacheKey);

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return withServerTiming(NextResponse.json(cachedData.data), { cache: 0 }, Date.now() - t0);
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // Everything runs in parallel: one list query, one combined counts query,
    // and the stock-level calculation (which needs items + bins first).
    const [transactions, counts, [lowStockItemsCount, outOfStockItemsCount]] = await Promise.all([
      timed('transactions', () => fetchTransactions(allowedSiteIds), timings),
      timed('counts', () => fetchCounts(allowedSiteIds, { startOfMonth, startOfPrevMonth, startOfWeek, startOfToday }), timings),
      timed('lowStock', async () => {
        const [stockItems, bins] = await Promise.all([fetchStockItems(), fetchBins(allowedSiteIds)]);
        return calculateLowStockCounts(stockItems, bins, allowedSiteIds);
      }, timings),
    ]);

    const result = {
      transactions,
      stats: {
        // Card 1: Receipts This Month
        monthlyReceiptsCount: counts.monthlyReceipts,
        receiptsTrend: Math.max(0, counts.monthlyReceipts - counts.prevMonthReceipts),

        // Card 2: Dispatches This Month
        monthlyDispatchesCount: counts.monthlyDispatches,
        todaysDispatchesCount: counts.todaysDispatches,

        // Card 3: Pending Actions
        pendingActionsCount: counts.pendingTransfers + counts.draftOrders,
        pendingTransfersCount: counts.pendingTransfers,
        draftOrdersCount: counts.draftOrders,

        // Card 4: Low Stock Items
        lowStockItemsCount,
        outOfStockItemsCount,

        // Card 5: Recent Activity
        weeklyActivityCount: counts.weeklyActivity,
        todayActivityCount: counts.todayActivity,

        // Card 6: Total Stock Count
        totalStockCount: counts.totalStock
      }
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return withServerTiming(NextResponse.json(result), timings, Date.now() - t0);

  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate dashboard stats' },
      { status: 500 }
    );
  }
}

// Original low stock calculation method
async function calculateLowStockCounts(stockItems: any[], bins: any[], siteIds: string[]) {
  // Filter bins to only include those from selected sites
  const relevantBins = bins.filter(bin => siteIds.includes(bin.siteId));

  const stockItemIds = stockItems.map(item => item._id);
  const binIds = relevantBins.map(bin => bin._id);

  if (stockItemIds.length === 0 || binIds.length === 0) {
    return [0, 0];
  }

  // Use bulk calculation from original code
  const stockQuantities = await calculateBulkStock(stockItemIds, binIds);

  let lowStockCount = 0;
  let outOfStockCount = 0;

  stockItems.forEach(item => {
    let totalQuantity = new Decimal(0);

    relevantBins.forEach(bin => {
      const key = `${item._id}-${bin._id}`;
      totalQuantity = totalQuantity.plus(new Decimal(stockQuantities[key] || 0));
    });

    const totalQty = totalQuantity.toNumber();

    if (totalQty <= item.minimumStockLevel) {
      lowStockCount++;
    }

    if (totalQty === 0) {
      outOfStockCount++;
    }
  });

  return [lowStockCount, outOfStockCount];
}

// LEGACY-SUPPORTING TRANSACTION FETCH
async function fetchTransactions(siteIds: string[]) {
  if (siteIds.length === 0) return [];

  // COMPREHENSIVE query that handles ALL cases:
  // 1. Old GoodsReceipts with only document-level receivingBin
  // 2. New GoodsReceipts with purchaseOrder->site reference
  // 3. Old DispatchLogs with only document-level sourceBin
  // 4. New DispatchLogs with sourceSite reference
  // 5. InternalTransfers with fromBin/toBin
  const query = groq`*[_type in ["GoodsReceipt", "DispatchLog", "InternalTransfer"] 
    && (
      // CASE 1: Old GoodsReceipts - document-level receivingBin
      (_type == "GoodsReceipt" && defined(receivingBin) && receivingBin->site._ref in $siteIds) ||
      
      // CASE 2: New GoodsReceipts - purchaseOrder->site
      (_type == "GoodsReceipt" && defined(purchaseOrder) && purchaseOrder->site._ref in $siteIds) ||
      
      // CASE 3: Old DispatchLogs - document-level sourceBin
      (_type == "DispatchLog" && defined(sourceBin) && sourceBin->site._ref in $siteIds) ||
      
      // CASE 4: New DispatchLogs - sourceSite reference
      (_type == "DispatchLog" && defined(sourceSite) && sourceSite._ref in $siteIds) ||
      
      // CASE 5: InternalTransfers
      (_type == "InternalTransfer" && 
        (fromBin->site._ref in $siteIds || toBin->site._ref in $siteIds))
    )
  ] | order(_updatedAt desc) [0..10] {
    _id,
    _type,
    "createdAt": coalesce(receiptDate, dispatchDate, transferDate),
    "description": coalesce("Receipt: " + receiptNumber, "Dispatch: " + dispatchNumber, "Transfer: " + transferNumber),
    "siteName": coalesce(
      // For GoodsReceipts - try purchaseOrder site first, then receivingBin site
      purchaseOrder->site->name,
      receivingBin->site->name,
      // For DispatchLogs - try sourceSite first, then sourceBin site
      sourceSite->name,
      sourceBin->site->name,
      // For InternalTransfers - fromBin site
      fromBin->site->name
    )
  }`;

  const transactions = await client.fetch(query, { siteIds });

  // Process and deduplicate transactions (some might appear twice due to multiple conditions)
  const seenIds = new Set();
  const uniqueTransactions = [];

  for (const tx of transactions) {
    if (!seenIds.has(tx._id)) {
      seenIds.add(tx._id);
      uniqueTransactions.push(tx);
    }
  }

  return uniqueTransactions.slice(0, 10);
}

async function fetchStockItems() {
  const query = groq`*[_type == "StockItem"] {
    _id,
    name,
    minimumStockLevel,
    unitOfMeasure
  }`;
  return await client.fetch(query);
}

async function fetchBins(siteIds: string[]) {
  if (siteIds.length === 0) return [];

  const query = groq`*[_type == "Bin" && site._ref in $siteIds] {
    _id,
    "siteId": site._ref
  }`;
  return await client.fetch(query, { siteIds });
}

// Receipts / dispatches belonging to the requested sites (legacy + current document shapes).
const RECEIPT_SITE_MATCH = `(
  (defined(receivingBin) && receivingBin->site._ref in $siteIds) ||
  (defined(purchaseOrder) && purchaseOrder->site._ref in $siteIds) ||
  count(receivedItems[defined(receivingBin) && receivingBin->site._ref in $siteIds]) > 0
)`;
const DISPATCH_SITE_MATCH = `(
  (defined(sourceBin) && sourceBin->site._ref in $siteIds) ||
  (defined(sourceSite) && sourceSite._ref in $siteIds) ||
  count(dispatchedItems[defined(sourceBin) && sourceBin->site._ref in $siteIds]) > 0
)`;
const TRANSFER_SITE_MATCH = `(fromBin->site._ref in $siteIds || toBin->site._ref in $siteIds)`;

// All dashboard counters in ONE Sanity round trip (previously ~9 separate queries).
async function fetchCounts(
  siteIds: string[],
  d: { startOfMonth: string; startOfPrevMonth: string; startOfWeek: string; startOfToday: string },
) {
  const query = groq`{
    "monthlyReceipts": count(*[_type == "GoodsReceipt" && receiptDate >= $startOfMonth && ${RECEIPT_SITE_MATCH}]),
    "prevMonthReceipts": count(*[_type == "GoodsReceipt" && receiptDate >= $startOfPrevMonth && receiptDate < $startOfMonth && ${RECEIPT_SITE_MATCH}]),
    "monthlyDispatches": count(*[_type == "DispatchLog" && dispatchDate >= $startOfMonth && ${DISPATCH_SITE_MATCH}]),
    "todaysDispatches": count(*[_type == "DispatchLog" && dispatchDate >= $startOfToday && status != "completed" && ${DISPATCH_SITE_MATCH}]),
    "pendingTransfers": count(*[_type == "InternalTransfer" && status == "pending" && ${TRANSFER_SITE_MATCH}]),
    "draftOrders": count(*[_type == "PurchaseOrder" && status == "draft"]),
    "weeklyActivity": count(*[
      (_type == "GoodsReceipt" && ${RECEIPT_SITE_MATCH} && receiptDate >= $startOfWeek) ||
      (_type == "DispatchLog" && ${DISPATCH_SITE_MATCH} && dispatchDate >= $startOfWeek) ||
      (_type == "InternalTransfer" && ${TRANSFER_SITE_MATCH} && transferDate >= $startOfWeek) ||
      (_type == "StockAdjustment" && bin->site._ref in $siteIds && adjustmentDate >= $startOfWeek)
    ]),
    "todayActivity": count(*[
      (_type == "GoodsReceipt" && ${RECEIPT_SITE_MATCH} && receiptDate >= $startOfToday) ||
      (_type == "DispatchLog" && ${DISPATCH_SITE_MATCH} && dispatchDate >= $startOfToday) ||
      (_type == "InternalTransfer" && ${TRANSFER_SITE_MATCH} && transferDate >= $startOfToday) ||
      (_type == "StockAdjustment" && bin->site._ref in $siteIds && adjustmentDate >= $startOfToday)
    ]),
    "totalStock": count(*[_type == "StockItem"])
  }`;

  const r = await client.fetch(query, { siteIds, ...d });
  return {
    monthlyReceipts: r.monthlyReceipts || 0,
    prevMonthReceipts: r.prevMonthReceipts || 0,
    monthlyDispatches: r.monthlyDispatches || 0,
    todaysDispatches: r.todaysDispatches || 0,
    pendingTransfers: r.pendingTransfers || 0,
    draftOrders: r.draftOrders || 0,
    weeklyActivity: r.weeklyActivity || 0,
    todayActivity: r.todayActivity || 0,
    totalStock: r.totalStock || 0,
  };
}
