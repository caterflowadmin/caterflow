import { NextResponse } from "next/server";
import { resumeIncompleteArchives, resumeIncompleteCleanup } from "@/lib/archiveService";
import { headers } from "next/headers";

export const maxDuration = 300;

// Frequent (every ~5 minutes, see vercel.json) resume-only cron target.
// Deliberately never imports runArchive/cleanupArchivedSanityData — this
// file can only ever resume an already-started, interrupted run, never
// start a fresh full sync. That's what keeps a fresh sync daily-only (via
// /api/archive/run's own cron entry) while still letting an interrupted run
// get picked back up within minutes instead of waiting up to 24h.
async function handleCronResumeRequest(request: Request) {
  const headersList = await headers();
  const cronSecret =
    headersList.get("x-cron-secret") || headersList.get("authorization");
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;
  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [archiveResult, cleanupResult] = await Promise.all([
      resumeIncompleteArchives(5),
      resumeIncompleteCleanup(5),
    ]);
    return NextResponse.json({
      success: true,
      attempts: archiveResult.attempts,
      finished: archiveResult.finished,
      cleanupAttempts: cleanupResult.attempts,
      cleanupFinished: cleanupResult.finished,
    });
  } catch (err: any) {
    console.error("Failed to resume incomplete archive/cleanup runs:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "resume failed" },
      { status: 500 },
    );
  }
}

// Vercel Cron calls this via GET — see the P0 fix note in
// src/app/api/archive/run/route.ts for why GET (not POST) is what actually
// matters here.
export async function GET(request: Request) {
  return handleCronResumeRequest(request);
}

// Kept for manual/curl testing — Vercel Cron itself never calls this.
export async function POST(request: Request) {
  return handleCronResumeRequest(request);
}
