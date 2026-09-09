// src/app/api/archive/status/route.ts
// Returns recent archive run logs for monitoring

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRecentArchiveRuns } from "@/lib/archiveQueries";
import { getArchiveProgress, getCleanupProgress } from "@/lib/archiveService";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !["admin", "auditor"].includes(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const runs = await getRecentArchiveRuns(Math.min(limit, 50));

    const progress = await getArchiveProgress();
    const inProgress = progress.inProgress;
    const cleanupProgress = await getCleanupProgress();
    const serialized = runs.map((run) => {
      // Cleanup (delete) runs and archive runs are different shapes: a
      // cleanup run's real deleted-count lives in `deletedSanityDocuments`
      // (see CleanupRunResult in archiveService.ts) — it has no `steps` or
      // `archived` fields at all. Reading only the archive-run fields below
      // meant every cleanup run showed "Docs Deleted: 0" regardless of how
      // many documents were actually deleted, and — since the
      // partial-vs-failed check also only looked at `documentsArchived` —
      // a cleanup run that deleted thousands of documents but hit a few
      // legitimate per-document errors (e.g. Sanity refusing to delete a
      // still-referenced document) was unconditionally reported "failed"
      // instead of "partial".
      const isCleanupRun = run.kind === "cleanup";
      const documentsArchived = Object.values(run.archived || {}).reduce(
        (sum: number, value: any) =>
          sum + (typeof value === "number" ? value : 0),
        0,
      );
      const totalInserted =
        typeof run.totalInserted === "number"
          ? run.totalInserted
          : run.steps
            ? run.steps.reduce(
                (s: number, st: any) => s + (st.inserted || 0),
                0,
              )
            : 0;
      const totalSkipped =
        typeof run.totalSkipped === "number"
          ? run.totalSkipped
          : run.steps
            ? run.steps.reduce((s: number, st: any) => s + (st.skipped || 0), 0)
            : 0;
      const documentsDeleted = isCleanupRun
        ? run.deletedSanityDocuments || 0
        : run.steps
          ? run.steps.reduce(
              (sum: number, step: any) => sum + (step.deletedCount || 0),
              0,
            )
          : documentsArchived;
      const successCount = isCleanupRun ? documentsDeleted : documentsArchived;
      const status = run.errors?.length
        ? successCount > 0
          ? "partial"
          : "failed"
        : "success";

      return {
        ...run,
        _id: run._id?.toString(),
        runDate: run.startedAt,
        status,
        documentsArchived,
        totalInserted,
        totalSkipped,
        documentsDeleted,
        assetsDeleted: run.assetsDeleted || 0,
        steps: run.steps || [],
        errors: run.errors || [],
      };
    });

    const recentRuns = [...serialized];
    if (progress.currentRun) {
      const currentRunId = progress.currentRun.runId;
      // Check if this run already exists in the list by comparing runId
      const hasExistingRun = recentRuns.some((run: any) => {
        return (
          run.runId === currentRunId ||
          (run.owner && run.owner === currentRunId)
        );
      });

      if (!hasExistingRun) {
        // Only add synthetic entry if this is an active run (not completed)
        if (
          progress.currentRun.status === "queued" ||
          progress.currentRun.status === "running" ||
          progress.currentRun.status === "incomplete"
        ) {
          recentRuns.unshift({
            _id: `current-${currentRunId}`,
            runId: currentRunId,
            runDate: progress.currentRun.startedAt,
            status: progress.currentRun.status,
            documentsArchived: 0,
            documentsDeleted: 0,
            assetsDeleted: 0,
            archived: {},
            totalInserted: 0,
            totalSkipped: 0,
            steps: [],
            errors: progress.currentRun.errors || [],
            durationMs: progress.currentRun.lastUpdatedAt
              ? Math.max(
                  0,
                  new Date(progress.currentRun.lastUpdatedAt).getTime() -
                    new Date(progress.currentRun.startedAt).getTime(),
                )
              : undefined,
            incomplete: progress.currentRun.status === "incomplete",
          } as any);
        }
      }
    }

    return NextResponse.json({
      recentRuns,
      count: recentRuns.length,
      archiveInProgress: inProgress,
      currentRun: progress.currentRun,
      staleDetected: progress.staleDetected === true,
      staleResolution: progress.staleDetected
        ? "Detected stale active archive progress and automatically marked the run as failed."
        : "No stale archive action taken.",
      cleanupInProgress: cleanupProgress.inProgress,
      currentCleanupRun: cleanupProgress.currentRun,
      cleanupStaleDetected: cleanupProgress.staleDetected === true,
    });
  } catch (error: any) {
    console.error("Failed to fetch archive status:", error);
    return NextResponse.json(
      { error: "Failed to fetch archive runs", details: error?.message },
      { status: 500 },
    );
  }
}
