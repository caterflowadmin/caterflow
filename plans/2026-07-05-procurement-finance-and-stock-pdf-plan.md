Implementation guide — Procurement → Finance approval + Stock Count PDF export

Summary

- Two one-time adjustments quoted in `gs.html`:
  - Procurement → Finance approval workflow (SZL 5,000)
  - Stock Count PDF export including all variances (SZL 3,000)

Goals

1. After the requisition summary is generated, Procurement can "Send to Finance" to create an approval request for the Finance Manager.
2. Stock Count (bin-counts) page / modal can export the count, including every variance row, into a printer-friendly PDF (client-side) or a server-side PDF if required.

Files touched (exact paths)

- Procurement UI (add button & client call):
  - next-caterflow-by-synapse/src/app/operations/procurement/requisition-summary/page.tsx
- Procurement API (new route):
  - next-caterflow-by-synapse/src/app/api/procurement/requisition-summary/send-to-finance/route.ts
- Approvals (consume or create approval record):
  - next-caterflow-by-synapse/src/app/approvals/\* (existing approvals page)
- Stock Count UI (export hook):
  - next-caterflow-by-synapse/src/app/operations/bin-counts/page.tsx (or) src/components/BinCountModal.tsx
- Reuse existing HTML → PDF pattern from:
  - next-caterflow-by-synapse/src/app/operations/procurement/requisition-summary/page.tsx (search for "generateEnhancedRequisitionHTML")
- Utility (optional):
  - next-caterflow-by-synapse/src/lib/pdfExport.ts (new file) — small helper to build printable HTML and open a print window

Implementation steps — Procurement → Finance approval

1. UI: Add "Send to Finance" button
   - File: `src/app/operations/procurement/requisition-summary/page.tsx`
   - Place the button near the existing "Export PDF" control (there is already an export flow around lines ~740–780).
   - Example client-side handler (React):
     - POST to `/api/procurement/requisition-summary/send-to-finance` with the summary id and filters.
     - Show success/failure toast.

   Minimal example (inside component):

   ```tsx
   async function sendToFinance() {
     const res = await fetch(
       "/api/procurement/requisition-summary/send-to-finance",
       {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ summaryId: summary?.id, filters }),
       },
     );
     if (!res.ok) throw new Error(await res.text());
     // show toast / refresh
   }
   ```

2. API: Create server route to record approval request
   - Path: `src/app/api/procurement/requisition-summary/send-to-finance/route.ts`
   - Responsibility:
     - Validate user session and role (allow `procurer`, `admin` at minimum).
     - Build an approval object (title, payload, requester reference, links to summary data).
     - Persist approval (either insert into existing approvals store or call internal approvals API). The codebase already has an `approvals` page; reuse its API if available.
     - Optionally dispatch a notification/email to Finance (recommended: send to internal queue or trigger email worker).

   Minimal server code sketch (Next.js route handler):

   ```ts
   import { getSession } from "@/lib/session"; // adapt to repo conventions
   import { createApproval } from "@/lib/approvals"; // or call internal API

   export async function POST(req: Request) {
     const body = await req.json();
     const user = await getSession(req);
     if (!user || !["admin", "procurer"].includes(user.role))
       return new Response("Unauthorized", { status: 401 });

     // build approval payload
     const approval = {
       title: `Requisition Summary approval: ${body.summaryId || "manual"}`,
       type: "requisition-summary",
       payload: body,
       requestedBy: user.id,
       status: "pending",
       assignedToRole: "finance",
     };

     await createApproval(approval);
     // optionally call email/notification worker here
     return new Response(JSON.stringify({ ok: true }), { status: 200 });
   }
   ```

3. Approvals UI / Workflow
   - Ensure the approvals UI shows items assignedToRole `finance` or an approvals queue the Finance Manager can review.
   - The approvals page is in `src/app/approvals` — verify it accepts `type` and displays `payload`/attachments; if not, add a compact view for requisition summaries including a link to the exported PDF (reuse Export PDF HTML builder).

4. Notifications
   - Minimal: Add a log entry or write the approval record. Better: send an email using existing mailer or enqueue message to notifications system.

Implementation steps — Stock Count PDF export (including variances)

1. Identify UI location
   - Preferred edit target: `src/app/operations/bin-counts/page.tsx` or the modal `src/components/BinCountModal.tsx` (both referenced in the repo).
   - Add an "Export PDF" button near existing controls. There are existing Export PDF controls in other modals (GoodsReceiptModal, DispatchModal) — mirror their approach.

2. Data to include
   - Use the same calculations used by reports: `src/app/reports/page.tsx` computes net variances and period bin counts.
   - Include per-bin variances, item totals, and a summary (net variances). Fetch endpoints used by the page (e.g., `/api/stock/audit` or `/api/stock-snapshots`) as needed.

3. Generate printable HTML and open print window
   - Reuse the pattern from `generateEnhancedRequisitionHTML` in `requisition-summary/page.tsx` (it builds HTML and opens a new window, then triggers print).
   - Create a helper `src/lib/pdfExport.ts` with a function `openPrintableWindow(html: string, fileName?: string)` that opens a window, writes content, and focuses/prints.

   Minimal client-side snippet:

   ```ts
   function buildStockCountHTML(data) {
     // build a simple HTML table with header, rows (item, expected, counted, variance)
     // style with embedded CSS to be printer-friendly
     return `<!doctype html><html><head><meta charset="utf-8"><title>Stock Count</title><style>/* compact print styles */</style></head><body>${tableHtml}</body></html>`;
   }

   async function exportStockCountToPdf() {
     const data = await fetch("/api/stock/audit?siteId=...").then((r) =>
       r.json(),
     );
     const html = buildStockCountHTML(data);
     openPrintableWindow(
       html,
       `Stock-Count-${new Date().toISOString().slice(0, 10)}.pdf`,
     );
   }
   ```

4. Server-side PDF (optional)
   - If Finance requires a server-generated PDF (attachmentable), add an API endpoint using a headless renderer (e.g., `puppeteer` or `playwright`) to convert the HTML to PDF and return `application/pdf`.
   - Note: this adds infra and devops cost and is optional. Client-side print avoids dependency changes and is fast to implement.

Testing & verification

- Run dev server:
  ```bash
  cd next-caterflow-by-synapse
  npm install
  npm run dev
  ```
- Manual tests:
  - Log in as a `procurer` user → open `Operations → Procurement → Requisition Summary` → generate summary → click `Send to Finance` → confirm a new approval shows in `Approvals` (assign to Finance role).
  - On Stock Count page → run a count → click `Export PDF` → preview/print window should include all variance rows and net totals.

Rollout notes

- Add automated unit/integration tests around the new API route (authorization + approval creation).
- If adding email notifications, ensure credentials and secrets are configured in the environment and documented in `README`.

Estimated effort & risk

- Estimated dev time: ~20 hours total (breakdown: 12h procurement workflow & approvals integration; 8h stock count export HTML & QA).
- Risk: low. Biggest friction is approvals model compatibility and whether Finance needs server-generated PDFs.

Contact

- If you want, I can implement the server route and UI changes now and open a PR. Tell me whether you prefer client-side PDF or server-generated PDF for the Stock Count export.
