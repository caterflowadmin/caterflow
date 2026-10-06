// src/lib/clientCache.ts
// Browser-side cache for small, widely shared lookup GETs (sites, bins,
// suppliers, stock items, categories, dispatch types).
//
// Before this, every page and modal fetched the same lists on mount, so
// navigating around re-downloaded them dozens of times. `cachedFetch` is a
// drop-in for `fetch(url)`: concurrent callers share one request, successful
// responses are reused for TTL_MS, and any mutating request that touches a
// lookup (see `installFetchInvalidation`) clears the cache so edits show up
// immediately.
const TTL_MS = 30_000;

type Entry = { ts: number; status: number; statusText: string; body: string; contentType: string };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

const toResponse = (e: Entry) =>
  new Response(e.body, {
    status: e.status,
    statusText: e.statusText,
    headers: { 'Content-Type': e.contentType },
  });

export async function cachedFetch(url: string): Promise<Response> {
  const hit = store.get(url);
  if (hit && Date.now() - hit.ts < TTL_MS) return toResponse(hit);

  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(url);
      const entry: Entry = {
        ts: Date.now(),
        status: res.status,
        statusText: res.statusText,
        body: await res.text(),
        contentType: res.headers.get('Content-Type') || 'application/json',
      };
      // Only successful responses are reusable.
      if (res.ok) {
        if (store.size >= 100) store.clear(); // bound memory (e.g. many distinct searches)
        store.set(url, entry);
      }
      return entry;
    })().finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return toResponse(await pending);
}

export function invalidateClientCache() {
  store.clear();
}

// Mutating requests to these prefixes can change what the cached lookups return.
const LOOKUP_WRITE_PREFIXES = [
  '/api/sites',
  '/api/bins',
  '/api/suppliers',
  '/api/stock-items',
  '/api/dispatch-types',
  '/api/categories',
  '/api/locations',
  '/api/procurement',
  '/api/purchase-orders/update-price',
  '/api/users',
];

let installed = false;

/** Wrap window.fetch once so lookup-affecting writes clear the cache. */
export function installFetchInvalidation() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
      if (LOOKUP_WRITE_PREFIXES.some((p) => path.startsWith(p))) {
        try {
          return await original(input, init);
        } finally {
          invalidateClientCache();
        }
      }
    }
    return original(input, init);
  };
}
