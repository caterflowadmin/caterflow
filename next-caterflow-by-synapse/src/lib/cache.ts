// src/lib/cache.ts
import { LRUCache } from 'lru-cache';

// Types for our cache
export type StockDataCache = { [key: string]: number };

// Create LRU cache for stock data
const stockCache = new LRUCache<string, StockDataCache>({
	max: 100, // Maximum number of items
	ttl: 30000, // 30 seconds TTL
});

export const getCachedStock = (key: string): StockDataCache | undefined => {
	return stockCache.get(key);
};

export const setCachedStock = (key: string, value: StockDataCache): void => {
	stockCache.set(key, value);
};

export const clearStockCache = (): void => {
	stockCache.clear();
	invalidateRegistryMap();
};

export const invalidateStockCache = (pattern: string): void => {
	// Any stock write means the parsed registry is stale.
	invalidateRegistryMap();
	const keys = Array.from(stockCache.keys());
	for (const key of keys) {
		if (key.includes(pattern)) {
			stockCache.delete(key);
		}
	}
};

// Additional helper functions
export const getCachedStockItem = (key: string, itemBinKey: string): number | undefined => {
	const cachedData = stockCache.get(key);
	return cachedData ? cachedData[itemBinKey] : undefined;
};

export const setCachedStockItem = (key: string, itemBinKey: string, value: number): void => {
	const cachedData = stockCache.get(key) || {};
	cachedData[itemBinKey] = value;
	stockCache.set(key, cachedData);
};

// ---------------------------------------------------------------------------
// Parsed stock-registry cache
//
// Every stock read used to download the entire `stockRegistry` document from
// Sanity and re-parse it. We now keep one parsed `"itemId-binId" -> quantity`
// map per server instance, refreshed at most every REGISTRY_TTL_MS, with a
// single in-flight fetch shared by concurrent callers. Any stock write calls
// invalidateStockCache()/clearStockCache(), which drops the map.
// ---------------------------------------------------------------------------
export type RegistryMap = Map<string, number>;

const REGISTRY_TTL_MS = 15000;
let registryMapCache: { map: RegistryMap | null; ts: number } | null = null;
let registryInflight: Promise<RegistryMap | null> | null = null;
let registryEpoch = 0;

export const invalidateRegistryMap = (): void => {
	registryMapCache = null;
	registryEpoch++;
};

function buildRegistryMap(registry: any): RegistryMap | null {
	if (!registry) return null;
	const map: RegistryMap = new Map();
	for (const item of registry?.stockData?.items || []) {
		for (const bin of item?.binQuantities?.bins || []) {
			if (item.stockItemId && bin.binId) {
				map.set(`${item.stockItemId}-${bin.binId}`, bin.quantity || 0);
			}
		}
	}
	return map;
}

/**
 * Returns the parsed registry (null when no registry document exists).
 * `fetchRegistry` must resolve to the raw `{ stockData }` document or null.
 */
export async function getRegistryMap(fetchRegistry: () => Promise<any>): Promise<RegistryMap | null> {
	if (registryMapCache && Date.now() - registryMapCache.ts < REGISTRY_TTL_MS) {
		return registryMapCache.map;
	}
	if (registryInflight) return registryInflight;

	const epochAtStart = registryEpoch;
	registryInflight = (async () => {
		try {
			const map = buildRegistryMap(await fetchRegistry());
			// Don't store a result that a write invalidated while we were fetching.
			if (epochAtStart === registryEpoch) registryMapCache = { map, ts: Date.now() };
			return map;
		} finally {
			registryInflight = null;
		}
	})();
	return registryInflight;
}
