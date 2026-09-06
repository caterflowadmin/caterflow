import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  resumeIncompleteArchives,
  ARCHIVE_PROGRESS_STALE_MS,
} from "@/lib/archiveService";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // This used to `await resumeIncompleteArchives(5)` directly here, with
    // no guard against concurrent calls. The admin page's auto-resume
    // effect calls this endpoint on every page load/reload while
    // currentRun.status === "incomplete" — so an admin reloading the page
    // (or opening a second tab) while a previous resume triggered by an
    // earlier load was still working through the backlog in the background
    // caused two overlapping resumeIncompleteArchives() calls to both find
    // the same incomplete run and both call runArchive() on it at once,
    // racing on the same progress doc. That's exactly what produced bursts
    // of "Starting archive run: <same runId>" a few seconds apart in the
    // logs. Also: resumeIncompleteArchives() calls runArchive() inline,
    // which is itself allowed to run close to the full ~270s budget on its
    // first attempt — awaiting that here blocked the HTTP response for that
    // long, the same issue already fixed in /api/archive/run.
    const db = await getArchiveDb();
    const progressId = "archive-progress";
    const existingProgress = await db
      .collection(COLLECTIONS.ARCHIVE_RUNS)
      .findOne({ _id: progressId } as any);

    if (existingProgress?.status === "running") {
      const lastUpdatedTs = existingProgress.lastUpdatedAt
        ? new Date(existingProgress.lastUpdatedAt).getTime()
        : null;
      const isStale =
        !lastUpdatedTs ||
        Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;
      if (!isStale) {
        return NextResponse.json({
          success: true,
          alreadyRunning: true,
          runId: existingProgress.runId,
          message: "An archive run is already actively running in the background.",
        });
      }
    }

    const incompleteRun = await db
      .collection(COLLECTIONS.ARCHIVE_RUNS)
      .findOne({ incomplete: true } as any, { sort: { startedAt: -1 } });

    if (!incompleteRun) {
      return NextResponse.json({
        success: true,
        finished: true,
        message: "No incomplete archive run to resume.",
      });
    }

    after(() =>
      resumeIncompleteArchives(5).catch((backgroundError: any) => {
        console.error("Background archive resume failed:", backgroundError);
      }),
    );

    return NextResponse.json({
      success: true,
      started: true,
      runId: incompleteRun.runId,
      message: "Resuming incomplete archive run in the background.",
    });
  } catch (error: any) {
    console.error("Failed to resume incomplete archives:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to resume incomplete archive run",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: "Archive resume endpoint" });
}
