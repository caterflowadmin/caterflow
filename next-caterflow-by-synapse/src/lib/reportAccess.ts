// src/lib/reportAccess.ts
// Who sees and can do what on the reports page. Kept pure so the page and the
// API routes enforce the same rules (the API is the authority; the page only
// hides controls).

export type ReportRole = string | null | undefined;

/** Full financial view: VAT, reconciliation, drill-down into values. */
export const canViewFinance = (role: ReportRole): boolean =>
  role === "admin" || role === "auditor" || role === "siteManager";

/** Close periods, record opening balances, reopen. */
export const canManagePeriods = (role: ReportRole): boolean => role === "admin";

/** Reconciliation compares whole-business ledgers, so it is an all-sites tool. */
export const canViewReconciliation = (role: ReportRole): boolean =>
  role === "admin" || role === "auditor";
