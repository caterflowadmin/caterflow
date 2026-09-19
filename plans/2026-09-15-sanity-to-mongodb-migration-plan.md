Implementation plan — Full Sanity-to-MongoDB migration

Quoted in `quotes/2026-09-15-sanity-to-mongodb-migration/quote.html` (ref CATERFLOW-MIGRATION-2026-09-15) as a **fixed project fee of SZL 20,000**, estimated at 96–139 hours (~170 SZL/hr blended project rate, discounted from the standard rate given the size/duration of the engagement). Billed in 3 milestones: SZL 10,000 (50%) deposit before work starts, SZL 5,000 on Phase 2 completion, SZL 5,000 on go-live.

Status: not started. This is a plan, not yet authorised — begin only after the client has both signed the migration quote and paid the 50% deposit.

## Current state (as found in the codebase, Sept 2026)

- **Sanity coupling**: 64 files under `next-caterflow-by-synapse/src/` import Sanity (`createClient`, `next-sanity`, `@sanity/image-url`), covering essentially the whole `src/app/api/**` tree (54 route files) plus `lib/sanity.ts`, `lib/auth.ts`, `lib/queries.ts`, `lib/stockCalculations.ts`, `lib/archiveValidation.ts`, `lib/archiveService.ts`. There are ~194 GROQ query blocks and ~211 `.fetch()` calls.
- **Sanity Studio schema** (`studio-caterflow-by-synapse/schemaTypes/`): 24 document/object types — StockItem, AppUser, Bin, Category, DispatchType, Site, Supplier, PurchaseOrder, GoodsReceipt, InventoryCount, DispatchLog, InternalTransfer, StockAdjustment, StockSnapshot, StockRegistry, FileAttachment, plus nested item subtypes (CountedItem, DispatchedItem, ReceivedItem, OrderedItem, AdjustedItem, TransferredItem, NotificationPreference).
- **Auth**: `lib/auth.ts` reads/writes the `AppUser` Sanity document directly — login, password reset, and verification codes are Sanity-backed. This is in scope, not incidental.
- **Existing Mongo footprint**: native `mongodb` driver (not Mongoose) is already used, but only for the Archive Run History side-feature — `lib/mongoClient.ts`, `archiveService.ts`, `archiveQueries.ts`, `archiveImporter.ts`, and the standalone scripts `scripts/{export,import,migrate,verify}_mongo.js`. None of the live operational data (stock, procurement, dispatch, etc.) is modeled in Mongo yet. This gives us a working connection pattern and ETL script shape to extend, not a head start on the domain model.
- **Data volume**: latest production export (`studio-caterflow-by-synapse/production-export-2026-06-28t21-26-26-994z/data.ndjson`) has ~24,784 documents: 601 StockItem, 34 AppUser, 18 Bin, 17 Supplier, 16 Category, 8 Site as top-level masters, plus thousands of nested transaction records (CountedItem, DispatchedItem, ReceivedItem, FileAttachment, DispatchLog, etc.) inside parent documents. No binary image assets found in the export — confirm per-record before cutover whether any FileAttachment still points at Sanity's CDN.
- **No evidence the client uses Sanity Studio directly** — all Sanity access is mediated through the Next.js app. Studio is a developer tool today, which simplifies the "replace the admin UI" workstream (no client retraining), but a minimal replacement is still needed for one-off manual data fixes.

## Phase 1 — Foundation (target: ~26–36 hrs)

1. **Schema design.** For each of the 24 Sanity types, define an equivalent MongoDB collection: field mapping, which Sanity `reference` fields become ObjectId references vs. embedded subdocuments (line items like CountedItem/ReceivedItem/DispatchedItem are strong candidates for embedding rather than separate collections, since they're always accessed through their parent).
2. **Referential integrity strategy.** Sanity enforces reference validity at the schema level; Mongo does not. Decide and document: app-level validation on write, or a lightweight ORM (Mongoose) to get schema validation back. Given 54 routes will be touching this, favor Mongoose here to avoid re-implementing validation ad hoc in every route.
3. **Auth rewrite.** New `users` collection (mirroring AppUser fields: role, password hash, verification code). Rewrite `lib/auth.ts` against Mongo. Re-test: login, password reset flow, verification codes, and role-gate checks used across API routes.
4. **Migration scripts.** Extend the existing `scripts/{export,import,migrate,verify}_mongo.js` pattern to read from a Sanity NDJSON export (instead of a source Mongo cluster) and write into the new collections, remapping Sanity `_id`/`_ref` values to Mongo ObjectIds and preserving reference links. Run against a staging Mongo instance first; do not touch production data in this phase.
5. **Validate** row counts and spot-check referential integrity (e.g. every PurchaseOrder's supplier reference resolves) against the 24,784-document export before moving to Phase 2.

## Phase 2 — Core operations (target: ~30–40 hrs)

Rewrite the highest-traffic API routes first, replacing GROQ queries with Mongo queries/aggregation pipelines (`$lookup` for what were GROQ joins):
- Stock (`stockCalculations.ts` and stock-related routes)
- Procurement / requisition summary
- Purchase orders
- Goods receipt

Each route needs: query rewrite, response shape kept identical (so the frontend doesn't need parallel changes unless a field genuinely can't be modeled the same way), and a manual smoke test against the corresponding UI page.

## Phase 3 — Remaining routes & admin UI (target: ~20–29 hrs)

- Dispatch, internal transfers, stock adjustments, reports.
- Minimal internal admin screen(s) — list/detail/edit views over the new Mongo collections — to replace Sanity Studio's role as the tool for one-off manual data corrections. Does not need Studio's full editing UX, just enough to unblock support without direct DB access.
- File/image storage replacement: pick a provider (S3, Cloudinary, or UploadThing are the natural fits given this is a Next.js/Vercel app), wire up upload + retrieval, and migrate any FileAttachment records that still point at Sanity's CDN.

## Phase 4 — QA & cutover (target: ~16–24 hrs)

1. Full regression pass across procurement, stock counts, dispatch, transfers, purchase orders, and reports — the same areas exercised in prior manual test passes for this app.
2. Run the migration scripts against production data (not just staging), verify counts/integrity again.
3. Cut the app over to Mongo-only (remove Sanity env vars / client init), keep the old Sanity dataset read-only as a rollback fallback for an agreed period.
4. Once confirmed stable, decommission the Sanity project and cancel its subscription.

## Risks / open questions to resolve with the client before Phase 1 starts

- Does any FileAttachment record currently rely on Sanity's image CDN transforms (resizing, format conversion) that the app depends on at render time? If so, the new storage provider needs equivalent capability or the frontend needs a small adjustment.
- Confirm no external system or client-side tool depends on Sanity Studio access today (support has assumed no based on code inspection, but this should be confirmed directly with the client).
- Decide acceptable downtime/rollback window for the Phase 4 cutover.

## Testing

```bash
cd next-caterflow-by-synapse
npm install
npm run dev
```
Manual regression matrix: login/password-reset/role checks; procurement → requisition summary → purchase order → goods receipt; bin counts / stock adjustments; dispatch and internal transfers; reports page (net variances). Re-run this matrix at the end of each phase, not just at the end of the project.
