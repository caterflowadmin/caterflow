// GET /api/reports/suggest-opening-balance?site=<id|all>
//
// Administrators only. Works out, from the documents already recorded, how
// much stock must have existed before the first document (see
// suggestOpeningBalance). Read-only: nothing is saved until an administrator
// records the opening balance through /api/reports/period-close.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserSiteInfo } from "@/lib/siteFiltering";
import { canManagePeriods } from "@/lib/reportAccess";
import { loadLedgerDocs, loadLiveInventoryValue } from "@/lib/reportData";
import { suggestOpeningBalance } from "@/lib/financialReport";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
  }
  if (!canManagePeriods(session.user.role)) {
    return NextResponse.json({ error: "Only administrators can do this" }, { status: 403 });
  }

  const info = await getUserSiteInfo();
  const requested = new URL(request.url).searchParams.get("site");
  const siteId = info.canAccessMultipleSites
    ? requested && requested !== "all"
      ? requested
      : null
    : info.userSiteId;

  const docs = await loadLedgerDocs(siteId);
  if (docs.failed.length) {
    return NextResponse.json(
      { error: `Cannot calculate: failed to load ${docs.failed.join(", ")}` },
      { status: 503 },
    );
  }

  const live = siteId ? null : await loadLiveInventoryValue();
  const suggestion = suggestOpeningBalance({ ...docs, siteId, liveInventoryValue: live });
  return NextResponse.json({ siteKey: siteId || "all", ...suggestion });
}
