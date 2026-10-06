This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Performance conventions

See `PERFORMANCE_PLAN.md` for the full plan. Rules of thumb when adding code:

**API routes**
- All `/api/*` routes require a session — enforced centrally in `src/middleware.ts` (public: `/api/auth/*`, `/api/archive/health`, `/api/archive/cron/*`; `/api/admin/*` and `/api/debug` are admin-only). Don't add a public route without adding it to `PUBLIC_API_PREFIXES`.
- List endpoints must not be unbounded. Endpoints that merge the MongoDB archive accept `?archived=false` (recent only) and `?archived=only` (archive only); use `fetchRecentThenArchive()` on the client for a fast first paint.
- Small, read-mostly lookups go through `cachedLookup()` (`src/lib/lookupCache.ts`); wrap their mutating handlers with `withInvalidation()` so edits show up immediately.
- Never write `*[_type == ...]` queries that deref (`->`) inside filters on large collections when a denormalised field (e.g. `site._ref`) will do; prefer one combined GROQ object query over many round trips.
- Wrap slow calls with `timed()` / `withServerTiming()` (`src/lib/perf.ts`) — timings show up in the `Server-Timing` response header. Queries over `SLOW_QUERY_MS` (default 1500) are logged.

**Stock**
- Read stock through `calculateBulkStock()`; it uses a parsed, single-flight registry cache (`getRegistryMap`). Anything that writes the `stockRegistry` document must call `clearStockCache()` / `invalidateStockCache()`.
- Backfills are bounded (`BACKFILL_CONCURRENCY`); never fan out unbounded `Promise.all` over item×bin pairs.

**Client**
- Use `cachedFetch()` (`src/lib/clientCache.ts`) for shared lookups (sites, bins, suppliers, stock items, categories, dispatch types). Writes to those prefixes invalidate it automatically.
- Don't read the session in the root layout — it would make every route dynamic and lose static delivery.
- Use `logger.debug` (silent in production unless `LOG_LEVEL=debug`) instead of `console.log`.
- Pause polling while the tab is hidden (`document.visibilityState`).
