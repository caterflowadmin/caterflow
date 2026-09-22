import { NextResponse } from "next/server";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(request: Request) {
  // Allow either an authenticated admin session OR the cron/admin secret header
  const session = await getServerSession(authOptions);
  if (!(session?.user && session.user.role === "admin")) {
    const headersList = await headers();
    const adminSecret =
      headersList.get("x-admin-secret") || headersList.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const adminSecretEnv = process.env.ADMIN_SECRET;
    // Require the env var to actually be configured — otherwise
    // `Bearer ${undefined}` becomes the literal string "Bearer undefined",
    // which anyone could send as a header value to bypass this check.
    const matchesCron =
      !!cronSecret && adminSecret === `Bearer ${cronSecret}`;
    const matchesAdmin =
      !!adminSecretEnv && adminSecret === `Bearer ${adminSecretEnv}`;

    if (!matchesCron && !matchesAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const db = await getArchiveDb();
    const { searchParams } = new URL(request.url);
    // "archive" (default) and "cleanup" are two DISTINCT lock singletons —
    // the archive-run engine's _id: "archive-progress" and the cleanup
    // engine's _id: "cleanup-progress" (see archiveService.ts). This
    // endpoint used to only ever clear "archive-progress", so a stuck
    // cleanup lock (the one archiveQueries.ts's getRecentArchiveRuns filter
    // and archiveService.ts's cleanupArchivedSanityData write) silently
    // survived a "clear" call that still returned success: true.
    const target = searchParams.get("target") || "archive";
    const targets =
      target === "all" ? ["archive", "cleanup"] : [target];

    const cleared: string[] = [];
    for (const t of targets) {
      const progressId = t === "cleanup" ? "cleanup-progress" : "archive-progress";
      await db.collection(COLLECTIONS.ARCHIVE_RUNS).updateOne(
        { _id: progressId } as any,
        {
          $set: {
            status: "failed",
            currentStep: null,
            completedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
          },
          $push: {
            progressMessages: `${t === "cleanup" ? "Cleanup" : "Archive"} lock manually cleared by admin`,
          },
        } as any,
        { upsert: true },
      );
      cleared.push(progressId);
    }

    return NextResponse.json({ success: true, cleared });
  } catch (err: any) {
    console.error("Failed to clear archive lock:", err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: "Archive lock clear endpoint" });
}
