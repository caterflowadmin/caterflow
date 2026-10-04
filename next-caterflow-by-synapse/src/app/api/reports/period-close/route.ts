// /api/reports/period-close
//   GET  ?site=<id|all>            list closes / opening balances (finance roles)
//   POST {action:"close", month:"YYYY-MM", site?, force?}
//   POST {action:"opening-balance", asOf:"YYYY-MM-DD", value, note?, site?}
//   POST {action:"reopen", id}
// Mutations are admin-only. Nothing is ever deleted: reopening is recorded.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserSiteInfo } from "@/lib/siteFiltering";
import { canManagePeriods, canViewFinance } from "@/lib/reportAccess";
import {
  getLatestAnchor,
  listAnchors,
  reopenAnchor,
  saveAnchor,
  toLedgerAnchor,
} from "@/lib/reportAnchors";
import { loadLedgerDocs } from "@/lib/reportData";
import {
  PeriodCloseError,
  buildClose,
  buildOpeningBalance,
} from "@/lib/periodClose";
import { monthRange } from "@/lib/financialReport";

const siteKeyFor = (
  info: Awaited<ReturnType<typeof getUserSiteInfo>>,
  requested: string | null | undefined,
): string | null => {
  if (!info.canAccessMultipleSites) return info.userSiteId;
  return requested && requested !== "all" ? requested : "all";
};

export async function GET(request: Request) {
  let info;
  try {
    info = await getUserSiteInfo();
  } catch {
    return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
  }
  if (!canViewFinance(info.userRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const siteKey = siteKeyFor(info, new URL(request.url).searchParams.get("site"));
  if (!siteKey) return NextResponse.json({ anchors: [] });
  try {
    const anchors = await listAnchors(siteKey);
    return NextResponse.json({ siteKey, anchors });
  } catch (error) {
    console.error("period-close GET failed", error);
    return NextResponse.json({ error: "Could not read closed periods" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
  }
  if (!canManagePeriods(session.user.role)) {
    return NextResponse.json({ error: "Only administrators can close periods" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const info = await getUserSiteInfo();
  const siteKey = siteKeyFor(info, body.site);
  if (!siteKey) return NextResponse.json({ error: "No site" }, { status: 400 });
  const userId = session.user.id;

  try {
    switch (body.action) {
      case "close": {
        const month = String(body.month || "");
        const siteId = siteKey === "all" ? null : siteKey;
        const docs = await loadLedgerDocs(siteId);
        if (docs.failed.length) {
          return NextResponse.json(
            { error: `Cannot close: failed to load ${docs.failed.join(", ")}` },
            { status: 503 },
          );
        }
        const prior = await getLatestAnchor(
          siteKey,
          /^\d{4}-\d{2}$/.test(month) ? monthRange(month).start : new Date(0),
        );
        const { anchor, result } = buildClose({
          month,
          siteKey,
          docs,
          anchor: prior ? toLedgerAnchor(prior) : null,
          userId,
          force: body.force === true,
        });
        await saveAnchor(anchor);
        return NextResponse.json({ anchor, integrity: result.integrity });
      }

      case "opening-balance": {
        const anchor = buildOpeningBalance({
          asOf: String(body.asOf || ""),
          value: Number(body.value),
          siteKey,
          note: body.note,
          userId,
        });
        await saveAnchor(anchor);
        return NextResponse.json({ anchor });
      }

      case "reopen": {
        const ok = await reopenAnchor(String(body.id || ""), userId);
        if (!ok) {
          return NextResponse.json({ error: "Nothing to reopen" }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof PeriodCloseError) {
      return NextResponse.json(
        { error: error.message, code: error.code, issues: error.issues },
        { status: error.code === "blocking-issues" ? 409 : 400 },
      );
    }
    console.error("period-close POST failed", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
