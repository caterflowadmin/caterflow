// src/lib/lookupCache.ts
// Cross-instance server cache for small, read-mostly lookup data (sites, bins,
// suppliers, stock-item catalogue, dispatch types ...) using Next's tagged
// data cache. Mutating handlers are wrapped with `withInvalidation` so a write
// drops the affected tags immediately; `revalidate` is only the safety net for
// edits made outside the app (e.g. in Sanity Studio).
import { unstable_cache, revalidateTag } from 'next/cache';

export function cachedLookup<T>(
  tag: string | string[],
  keyParts: Array<string | number | null | undefined>,
  fn: () => Promise<T>,
  revalidate = 60,
): Promise<T> {
  const tags = Array.isArray(tag) ? tag : [tag];
  return unstable_cache(fn, ['lookup', ...tags, ...keyParts.map((k) => String(k ?? ''))], {
    tags,
    revalidate,
  })();
}

export function invalidateLookups(...tags: string[]) {
  for (const t of tags) {
    try {
      revalidateTag(t);
    } catch {
      // revalidateTag can throw outside a request scope (e.g. unit tests); safe to ignore.
    }
  }
}

/** Wrap a mutating route handler so the given cache tags are dropped after it runs. */
export function withInvalidation<A extends any[], R>(
  handler: (...args: A) => Promise<R>,
  tags: string[],
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } finally {
      invalidateLookups(...tags);
    }
  };
}
