// src/lib/perf.ts
// Lightweight server-side timing (Phase 0). Wrap Sanity/Mongo calls with
// `timed()` and attach the collected metrics to a response with
// `withServerTiming()` so they show in DevTools -> Network -> Timing and in
// Vercel logs. Calls slower than SLOW_QUERY_MS are logged as warnings.
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 1500);

export type Timings = Record<string, number>;

export async function timed<T>(name: string, fn: () => Promise<T>, timings?: Timings): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    if (timings) timings[name] = (timings[name] || 0) + ms;
    if (ms >= SLOW_QUERY_MS) logger.warn(`[perf] slow: ${name} took ${ms}ms`);
    else logger.debug(`[perf] ${name} ${ms}ms`);
  }
}

export function withServerTiming<T extends NextResponse>(res: T, timings: Timings, total?: number): T {
  const parts = Object.entries(timings).map(([k, v]) => `${k.replace(/[^a-zA-Z0-9_-]/g, '_')};dur=${v}`);
  if (total !== undefined) parts.push(`total;dur=${total}`);
  if (parts.length) res.headers.set('Server-Timing', parts.join(', '));
  return res;
}

/** Cache headers for small, rarely changing lookup responses. */
export function withLookupCache<T extends NextResponse>(res: T, maxAge = 30, swr = 120): T {
  res.headers.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${swr}`);
  return res;
}
