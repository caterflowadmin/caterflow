// src/app/api/archive/run/route.ts
// Cron trigger endpoint — called daily at midnight by Vercel Cron
// Also accepts manual POST from admin users

import { NextResponse, after } from "next/server";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  runArchive,
  resumeIncompleteArchives,
  cleanupOldArchiveMetadata,
  cleanupArchivedSanityData,
  resumeIncompleteCleanup,
  ARCHIVE_PROGRESS_STALE_MS,
} from "@/lib/archiveService";
import { getArchiveDb, COLLECTIONS } from "@/lib/mongoClient";

export const maxDuration = 300; // 5 minutes — Vercel Pro allows up to 300s

// Retry a momentary MongoDB connection blip instead of failing the whole
// request immediately. This is exactly what produced "MongoServerSelectionError:
// Server selection timed out after 30000 ms" / "Socket 'secureConnect' timed
// out after ...ms (connectTimeoutMS: 8000)" -> 500 in production even when
// the cluster recovered seconds later — reproduced live against this same
// deleteOld path, which used to call cleanupOldArchiveMetadata() with no
// retry at all (unlike the manual-archive path below, which already had
// this). Shared by every manual (browser-facing) trigger path in this file.
async function pingArchiveDbWithRetry(): Promise<Awaited<ReturnType<typeof getArchiveDb>>> {
  const dbRef = await getArchiveDb();
  let pingErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await dbRef.admin().ping();
      return dbRef;
    } catch (err: any) {
      pingErr = err;
      if (attempt < 3) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * Math.pow(2, attempt - 1)),
        );
      }
    }
  }
  throw pingErr;
}

export async function POST(request: Request) {
  // ── Authentication: Accept either Vercel Cron secret OR admin session ──

  const headersList = await headers();
  const cronSecret =
    headersList.get("x-cron-secret") || headersList.get("authorization");
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;

  const isCronCall = cronSecret === expectedSecret;

  if (!isCronCall) {
    // Check for authenticated admin session (manual trigger)
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const deleteOld = searchParams.get("deleteOld") === "true";

  // console.log(
  //   `\n🚀 Archive run triggered by: ${isCronCall ? "Vercel Cron" : "Admin user"}${deleteOld ? " (cleanup mode)" : ""}`,
  // );

  try {
    if (deleteOld) {
      try {
        await pingArchiveDbWithRetry();
      } catch (err: any) {
        console.error("Manual cleanup startup failed:", err);
        return NextResponse.json(
          {
            success: false,
            status: "failed",
            error:
              err?.message ||
              "Unable to connect to archive MongoDB. Check MONGODB_URL / MONGODB_URI and network access.",
            errorMessage:
              err?.message ||
              "Unable to connect to archive MongoDB. Check MONGODB_URL / MONGODB_URI and network access.",
          },
          { status: 500 },
        );
      }

      const metadataCleanup = await cleanupOldArchiveMetadata();

      // Cleanup used to run entirely synchronously in this handler — same
      // exposure the main archive run had: a large backlog could exceed
      // Vercel's function timeout with nothing recorded. It's now batched
      // and checkpointed internally (see cleanupArchivedSanityData), but a
      // sufficiently large backlog can still take more than one invocation
      // to finish, so this is queued and run in the background exactly
      // like a manual archive trigger, with its own progress doc.

      // Mirrors the manual archive-trigger flow below: try to resume a
      // previously-interrupted (`incomplete`) run first, rather than
      // treating "incomplete" as a reason to block a new attempt — it's
      // paused and resumable, not actively in flight elsewhere.
      //
      // IMPORTANT: resumeIncompleteCleanup() calls cleanupArchivedSanityData()
      // directly, which is itself allowed to run close to the full
      // ARCHIVE_MAX_SECONDS (~270s) budget per attempt. For a large backlog
      // that routinely needs resuming, `await`ing that here — inline in the
      // request handler, for a *manual* (browser-facing) trigger — blocks
      // the HTTP response for that entire duration, which either looks like
      // a hang to the admin or genuinely exceeds Vercel's 300s maxDuration
      // and gets hard-killed: a 504, with the response never sent. That is
      // the same failure this whole batching system exists to avoid — it
      // just moved from "the initial run" to "every resume of it," which
      // for a backlog needing multiple resumes is most clicks, not a rare
      // one. So: just detect that a resume is needed (a cheap query) and
      // hand the actual work to after(), exactly like starting a fresh run.
      const dbRef = await getArchiveDb();
      const progressId = "cleanup-progress";

      // This guard must run BEFORE the pending-resume check below, not
      // after it — a stray extra request (e.g. the admin double-clicking,
      // or two admin tabs open) landing while a resume dispatched by an
      // earlier request is already working through the backlog in the
      // background must not dispatch a SECOND concurrent
      // resumeIncompleteCleanup() call racing on the same progress doc.
      const existingCleanupProgress = await dbRef
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .findOne({ _id: progressId } as any);
      if (existingCleanupProgress?.status === "running") {
        const lastUpdatedTs = existingCleanupProgress.lastUpdatedAt
          ? new Date(existingCleanupProgress.lastUpdatedAt).getTime()
          : null;
        const isStale =
          !lastUpdatedTs ||
          Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;
        if (!isStale) {
          return NextResponse.json(
            {
              success: false,
              status: "failed",
              cleanupInProgress: true,
              error: `A cleanup run is already running (started ${existingCleanupProgress.startedAt}). Please wait for it to finish.`,
              errorMessage: `A cleanup run is already running (started ${existingCleanupProgress.startedAt}). Please wait for it to finish.`,
              currentRunId: existingCleanupProgress.runId,
              deletedArchiveRuns: metadataCleanup.deletedRuns,
              deletedBaselineSnapshots: metadataCleanup.deletedBaselines,
            },
            { status: 409 },
          );
        }
      }

      const pendingCleanupResume = await dbRef
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .findOne({ incomplete: true, kind: "cleanup" } as any, {
          sort: { startedAt: -1 },
        });

      if (pendingCleanupResume) {
        after(() =>
          resumeIncompleteCleanup(5).catch((backgroundError: any) => {
            console.error("Background cleanup resume failed:", backgroundError);
          }),
        );

        return NextResponse.json({
          success: true,
          resumed: true,
          started: true,
          status: "started",
          cleanup: true,
          runId: pendingCleanupResume.runId,
          deletedArchiveRuns: metadataCleanup.deletedRuns,
          deletedBaselineSnapshots: metadataCleanup.deletedBaselines,
          message:
            "Resuming incomplete cleanup run in the background.",
        });
      }

      const runId = `cleanup-${Date.now()}`;

      after(() =>
        cleanupArchivedSanityData(runId).catch((backgroundError: any) => {
          console.error("Background cleanup run failed:", backgroundError);
        }),
      );

      return NextResponse.json({
        success: true,
        started: true,
        status: "started",
        cleanup: true,
        runId,
        deletedArchiveRuns: metadataCleanup.deletedRuns,
        deletedBaselineSnapshots: metadataCleanup.deletedBaselines,
        message:
          "Cleanup run queued successfully and will continue in the background.",
      });
    }

    if (isCronCall) {
      const resumeResult = await resumeIncompleteArchives(5);
      // A previously-interrupted cleanup run is just as worth resuming
      // automatically as an interrupted archive run — otherwise it sits
      // stuck until an admin happens to manually re-trigger deleteOld.
      const resumeCleanupResult = await resumeIncompleteCleanup(5);
      if (resumeResult.attempts > 0 || resumeCleanupResult.attempts > 0) {
        return NextResponse.json({
          success: true,
          resumed: true,
          attempts: resumeResult.attempts,
          finished: resumeResult.finished,
          cleanupAttempts: resumeCleanupResult.attempts,
          cleanupFinished: resumeCleanupResult.finished,
          message: resumeResult.finished
            ? "Resumed incomplete archive run and it has completed."
            : "Resumed incomplete archive run; it will continue on the next available cycle.",
        });
      }
    }

    if (!isCronCall) {
      // For manual admin triggers: validate the archive DB connection and create a queued progress document so the UI sees a run immediately.
      //
      // IMPORTANT: this used to `await resumeIncompleteArchives(5)` directly
      // here. resumeIncompleteArchives() calls runArchive() inline, and
      // runArchive() is itself allowed to run close to the full
      // ARCHIVE_MAX_SECONDS (~270s) budget on its first attempt (the outer
      // time-budget guard inside resumeIncompleteArchives only kicks in
      // *between* attempts, not before the first one). Awaiting that here —
      // in a manual, browser-facing request handler — blocked the HTTP
      // response for up to ~270s every time an admin clicked "Run Archive
      // Now" while an incomplete run existed, and any batch running long
      // pushed it past Vercel's 300s maxDuration for a hard-killed 504 with
      // no response ever sent. For the large backlogs this batching system
      // exists to handle, an incomplete run is the common case after the
      // first click, not a rare one — so this was reproducing the exact
      // failure it was built to prevent on effectively every subsequent
      // click. Fix: just detect a pending resume (a cheap query) and hand
      // the actual work to after(), exactly like starting a fresh run does.
      //
      // This must also guard against an already-active run: the admin
      // page's auto-resume effect (POST /api/archive/resume) fires on every
      // page load while an incomplete run exists, independent of this
      // endpoint. Without checking here too, a "Run Archive Now" click
      // landing while that resume is already working through the backlog in
      // the background would dispatch a SECOND concurrent
      // resumeIncompleteArchives() call racing on the same progress doc —
      // which is what produced bursts of "Starting archive run: <same
      // runId>" a few seconds apart in production logs.
      const archiveResumePrecheckDb = await getArchiveDb();
      const existingArchiveProgressForResume = await archiveResumePrecheckDb
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .findOne({ _id: "archive-progress" } as any);
      if (existingArchiveProgressForResume?.status === "running") {
        const lastUpdatedTs = existingArchiveProgressForResume.lastUpdatedAt
          ? new Date(existingArchiveProgressForResume.lastUpdatedAt).getTime()
          : null;
        const isStale =
          !lastUpdatedTs ||
          Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;
        if (!isStale) {
          return NextResponse.json(
            {
              success: false,
              status: "failed",
              archiveInProgress: true,
              error: `An archive run is already running (started ${existingArchiveProgressForResume.startedAt}). Please wait for it to finish.`,
              errorMessage: `An archive run is already running (started ${existingArchiveProgressForResume.startedAt}). Please wait for it to finish.`,
              currentRunId: existingArchiveProgressForResume.runId,
            },
            { status: 409 },
          );
        }
      }

      const pendingArchiveResume = await archiveResumePrecheckDb
        .collection(COLLECTIONS.ARCHIVE_RUNS)
        .findOne({ incomplete: true } as any, { sort: { startedAt: -1 } });
      if (pendingArchiveResume) {
        after(() =>
          resumeIncompleteArchives(5).catch((backgroundError: any) => {
            console.error("Background archive resume failed:", backgroundError);
          }),
        );

        return NextResponse.json({
          success: true,
          resumed: true,
          started: true,
          status: "started",
          runId: pendingArchiveResume.runId,
          message: "Resuming incomplete archive run in the background.",
        });
      }
      let dbRef: any = null;
      try {
        dbRef = await pingArchiveDbWithRetry();
      } catch (err: any) {
        console.error("Manual archive startup failed:", err);
        return NextResponse.json(
          {
            success: false,
            status: "failed",
            error:
              err?.message ||
              "Unable to connect to archive MongoDB. Check MONGODB_URL / MONGODB_URI and network access.",
            errorMessage:
              err?.message ||
              "Unable to connect to archive MongoDB. Check MONGODB_URL / MONGODB_URI and network access.",
          },
          { status: 500 },
        );
      }

      try {
        const queuedRunId = `archive-queued-${Date.now()}`;
        const progressId = "archive-progress";

        // ── Concurrency guard ──────────────────────────────────────────
        // Nothing previously checked whether a run was already active
        // before overwriting this same document with a brand-new runId.
        // A double-click, two admin tabs open at once, or an impatient
        // retry (very plausible given the original "click and nothing
        // happens" symptom) could start two concurrent runArchive() calls
        // racing on the same progress doc — corrupting the displayed
        // progress and doubling the Sanity/Mongo load for no benefit.
        // Only block on a run that's genuinely still active: a run whose
        // progress hasn't been updated in ARCHIVE_PROGRESS_STALE_MS is
        // presumed dead (matches the staleness logic runArchive() itself
        // uses) and is safe to supersede.
        const existingProgress = await dbRef
          .collection(COLLECTIONS.ARCHIVE_RUNS)
          .findOne({ _id: progressId } as any);
        if (
          existingProgress &&
          ["queued", "running", "incomplete"].includes(
            existingProgress.status,
          )
        ) {
          const lastUpdatedTs = existingProgress.lastUpdatedAt
            ? new Date(existingProgress.lastUpdatedAt).getTime()
            : null;
          const isStale =
            !lastUpdatedTs ||
            Date.now() - lastUpdatedTs > ARCHIVE_PROGRESS_STALE_MS;
          if (!isStale) {
            console.warn(
              `⚠️ Rejected new archive run — one is already ${existingProgress.status} (runId: ${existingProgress.runId}, last updated ${existingProgress.lastUpdatedAt}).`,
            );
            return NextResponse.json(
              {
                success: false,
                status: "failed",
                archiveInProgress: true,
                error: `An archive run is already ${existingProgress.status} (started ${existingProgress.startedAt}). Please wait for it to finish.`,
                errorMessage: `An archive run is already ${existingProgress.status} (started ${existingProgress.startedAt}). Please wait for it to finish.`,
                currentRunId: existingProgress.runId,
              },
              { status: 409 },
            );
          }
          console.warn(
            `⚠️ Superseding a stale archive run (runId: ${existingProgress.runId}, status: ${existingProgress.status}, last updated ${existingProgress.lastUpdatedAt}) — starting a new one.`,
          );
        }

        await dbRef.collection(COLLECTIONS.ARCHIVE_RUNS).updateOne(
          { _id: progressId } as any,
          {
            $set: {
              _id: progressId,
              kind: "progress",
              owner: queuedRunId,
              status: "queued",
              startedAt: new Date().toISOString(),
              runId: queuedRunId,
              currentStep: null,
              currentStepIndex: 0,
              totalSteps: 0,
              completedSteps: [],
              pendingSteps: [],
              errors: [],
              progressPercent: 0,
              lastUpdatedAt: new Date().toISOString(),
            },
            $push: { progressMessages: "Archive run queued by admin" },
          } as any,
          { upsert: true },
        );

        // Start the archive run in the background so the HTTP request does not timeout.
        // IMPORTANT: a bare `void runArchive(...)` is not safe here — on Vercel the
        // serverless function can be frozen/terminated as soon as the response below
        // is sent, which kills this promise before it does any real work. `after()`
        // tells the platform to keep the function alive until this callback settles.
        after(() =>
          runArchive(queuedRunId).catch((backgroundError: any) => {
            console.error("Background archive run failed:", backgroundError);
          }),
        );

        return NextResponse.json(
          {
            success: true,
            started: true,
            status: "started",
            runId: queuedRunId,
            message:
              "Archive run queued successfully and will continue in the background.",
          },
          { status: 200 },
        );
      } catch (err: any) {
        console.error("Manual archive run failed:", err);
        try {
          const progressId = "archive-progress";
          await dbRef.collection(COLLECTIONS.ARCHIVE_RUNS).updateOne(
            { _id: progressId } as any,
            {
              $set: {
                status: "failed",
                completedAt: new Date().toISOString(),
                currentStep: null,
                currentStepIndex: 0,
                pendingSteps: [],
                errors: [err?.message || "Manual archive run failed"],
                progressPercent: 0,
                lastUpdatedAt: new Date().toISOString(),
              },
              $push: {
                progressMessages: `Manual archive run failed: ${err?.message || "unknown error"}`,
              },
            } as any,
          );
        } catch (updateErr: any) {
          console.error(
            "Failed to mark archive progress as failed:",
            updateErr,
          );
        }

        return NextResponse.json(
          {
            success: false,
            status: "failed",
            error: err?.message || "Failed to queue archive run",
            errorMessage: err?.message || "Failed to queue archive run",
          },
          { status: 500 },
        );
      }
    }

    const result = await runArchive();

    const totalArchived = Object.values(result.archived).reduce(
      (a, b) => a + b,
      0,
    );

    // documentsDeleted is approximated as totalArchived (archive implementation stores counts)
    const documentsDeleted = totalArchived;

    return NextResponse.json({
      success: true,
      status: result.errors?.length
        ? "failed"
        : result.incomplete
          ? "incomplete"
          : "success",
      runId: result.runId,
      totalArchived,
      documentsDeleted,
      breakdown: result.archived,
      // Steps and assetsDeleted are optional in current implementation
      errors: result.errors,
      warnings: result.warnings,
      totalInserted: result.totalInserted,
      totalUpdated: result.totalUpdated,
      totalSkipped: result.totalSkipped,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    });
  } catch (error: any) {
    console.error("❌ Archive run failed:", error);
    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: error?.message || "Archive run failed",
        errorMessage: error?.message || "Archive run failed",
      },
      { status: 500 },
    );
  }
}

// Allow GET for quick health check
export async function GET() {
  return NextResponse.json({
    status: "Archive endpoint ready",
    schedule: "Daily at midnight (UTC)",
    threshold: `${process.env.ARCHIVE_DAYS_THRESHOLD || 90} days`,
  });
}
