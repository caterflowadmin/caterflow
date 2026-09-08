"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Heading,
  Text,
  Button,
  VStack,
  HStack,
  Stack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  useToast,
  useColorModeValue,
  Flex,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Checkbox,
  Card,
  CardBody,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  SimpleGrid,
  useTheme,
  Icon,
  IconButton,
  CardHeader,
  Tooltip,
  Code,
  FormControl,
  FormLabel,
  Input,
  Progress,
} from "@chakra-ui/react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FiDownload,
  FiUpload,
  FiPlay,
  FiRefreshCw,
  FiTrash2,
  FiChevronDown,
} from "react-icons/fi";

interface ArchiveStepResult {
  name: string;
  count: number;
  deletedCount: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  status: "success" | "partial" | "failed";
  errors: string[];
  warnings: string[];
  assetsDeleted?: number;
  message?: string;
}

interface ArchiveLog {
  _id: string;
  runDate: string;
  status: "success" | "partial" | "failed";
  documentsArchived: number;
  documentsDeleted: number;
  assetsDeleted: number;
  archived?: Record<string, number>;
  totalInserted?: number;
  totalUpdated?: number;
  totalSkipped?: number;
  steps?: ArchiveStepResult[];
  errors?: string[];
  warnings?: string[];
  durationMs?: number;
}

interface ArchiveCurrentRun {
  runId: string;
  status: "running" | "failed" | "success" | "incomplete";
  startedAt: string;
  currentStep: string | null;
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: string[];
  pendingSteps: string[];
  errors: string[];
  progressPercent: number;
  lastUpdatedAt: string;
  logs: string[];
}

interface CleanupCurrentRun {
  runId: string;
  status: "running" | "failed" | "success" | "incomplete";
  startedAt: string;
  lastUpdatedAt: string;
  completedCollections: string[];
  totalCollections?: number;
  errors: string[];
}

const CHUNK_SIZE_BYTES = Number(
  process.env.NEXT_PUBLIC_CHUNK_SIZE_BYTES || String(1 * 1024 * 1024),
); // default 1MB chunk size for uploads (safe for Vercel limits)

export default function ArchiveManagementPage() {
  const { data: session, status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const isAdmin = session?.user?.role === "admin";
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();

  const [logs, setLogs] = useState<ArchiveLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [archiveInProgress, setArchiveInProgress] = useState(false);
  const [currentRun, setCurrentRun] = useState<ArchiveCurrentRun | null>(null);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);
  const [currentCleanupRun, setCurrentCleanupRun] =
    useState<CleanupCurrentRun | null>(null);
  const [previousCleanupInProgress, setPreviousCleanupInProgress] =
    useState(false);
  const [previousArchiveInProgress, setPreviousArchiveInProgress] =
    useState(false);
  const [staleDetected, setStaleDetected] = useState(false);
  const [staleResolution, setStaleResolution] = useState<string | null>(null);
  const [resumeTriggered, setResumeTriggered] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showRawLog, setShowRawLog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationInProgress, setValidationInProgress] = useState(false);
  const [validationReport, setValidationReport] = useState<any | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationProgress, setValidationProgress] = useState<{
    linesProcessed: number;
    batchLines?: number;
    validDocuments: number;
    missingDocuments: number;
    invalidLines: number;
    unknownTypes: number;
    message: string;
  } | null>(null);
  const rowsPerPage = 10;
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isRunDetailsModalOpen,
    onOpen: onRunDetailsModalOpen,
    onClose: onRunDetailsModalClose,
  } = useDisclosure();
  const {
    isOpen: isProgressModalOpen,
    onOpen: onProgressModalOpen,
    onClose: onProgressModalClose,
  } = useDisclosure();
  const [deleteOld, setDeleteOld] = useState(false);
  const [insertMissing, setInsertMissing] = useState(false);

  // --- Restore from backup (computeDiffAndApply) ---
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreviewInProgress, setRestorePreviewInProgress] =
    useState(false);
  const [restoreApplyInProgress, setRestoreApplyInProgress] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{
    diff: Record<
      string,
      {
        added: number;
        removed: number;
        updated: number;
        skippedNotInBackup?: boolean;
      }
    >;
  } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const RESTORE_CONFIRM_PHRASE = "RESTORE";
  const {
    isOpen: isRestoreModalOpen,
    onOpen: onRestoreModalOpen,
    onClose: onRestoreModalCloseRaw,
  } = useDisclosure();

  const ARCHIVE_DAYS = Number(process.env.NEXT_PUBLIC_ARCHIVE_DAYS || "90");

  const bgColor = useColorModeValue(
    theme.colors.neutral?.light?.["bg-primary"] || "gray.50",
    theme.colors.neutral?.dark?.["bg-primary"] || "gray.900",
  );
  const headerBg = useColorModeValue(
    "linear-gradient(135deg, #e0e7ff, #cfe2ff)",
    "linear-gradient(135deg, #2a4365, #405c8a)",
  );
  const cardBgColor = useColorModeValue(
    theme.colors.neutral?.light?.["bg-card"] || "white",
    theme.colors.neutral?.dark?.["bg-card"] || "gray.800",
  );
  const textColor = useColorModeValue(
    theme.colors.neutral?.light?.["text-primary"] || "gray.800",
    theme.colors.neutral?.dark?.["text-primary"] || "white",
  );
  const tableHeaderBg = useColorModeValue("gray.100", "gray.700");
  const tableBorderColor = useColorModeValue("gray.200", "gray.600");
  const textColorSecondary = useColorModeValue(
    theme.colors.neutral?.light?.["text-secondary"] || "gray.600",
    theme.colors.neutral?.dark?.["text-secondary"] || "gray.400",
  );

  const wait = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/archive/status");
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLogs(data.recentRuns || data.runs || []);
      setArchiveInProgress(data.archiveInProgress === true);
      setCurrentRun(data.currentRun || null);
      setCleanupInProgress(data.cleanupInProgress === true);
      setCurrentCleanupRun(data.currentCleanupRun || null);

      const isStale = data.staleDetected === true;
      if (isStale && !staleDetected) {
        toast({
          title: "Stale archive run cleared",
          description:
            data.staleResolution ||
            "A stale archive run was detected and automatically marked as failed.",
          status: "warning",
          duration: 8000,
          isClosable: true,
        });
      }
      setStaleDetected(isStale);
      setStaleResolution(data.staleResolution || null);

      return data;
    } catch (error) {
      console.error("Failed to fetch archive logs:", error);
      toast({
        title: "Error",
        description: "Failed to load archive history.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      setArchiveInProgress(false);
      setCurrentRun(null);
      setCleanupInProgress(false);
      setCurrentCleanupRun(null);
      setStaleDetected(false);
      setStaleResolution(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast, staleDetected]);

  const pollArchiveStart = useCallback(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wait(1500);
      try {
        const res = await fetch("/api/archive/status");
        if (!res.ok) continue;
        const data = await res.json();
        setLogs(data.recentRuns || data.runs || []);
        setArchiveInProgress(data.archiveInProgress === true);
        setCurrentRun(data.currentRun || null);
        if (data.archiveInProgress || data.currentRun) {
          return true;
        }
      } catch (err) {
        console.warn("Archive status poll failed:", err);
      }
    }
    return false;
  }, []);

  const pollCleanupStart = useCallback(async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wait(1500);
      try {
        const res = await fetch("/api/archive/status");
        if (!res.ok) continue;
        const data = await res.json();
        setLogs(data.recentRuns || data.runs || []);
        setCleanupInProgress(data.cleanupInProgress === true);
        setCurrentCleanupRun(data.currentCleanupRun || null);
        if (data.cleanupInProgress || data.currentCleanupRun) {
          return true;
        }
      } catch (err) {
        console.warn("Cleanup status poll failed:", err);
      }
    }
    return false;
  }, []);

  const handleRefreshStatus = useCallback(async () => {
    await fetchLogs();
  }, [fetchLogs]);

  const handleAutoResume = useCallback(async () => {
    if (resumeTriggered || isResuming) return;
    if (currentRun?.status !== "incomplete") return;

    setIsResuming(true);
    toast({
      title: "Resuming archive run",
      description:
        "An incomplete archive run was detected and resume has started.",
      status: "info",
      duration: 5000,
      isClosable: true,
    });

    try {
      const res = await fetch("/api/archive/resume", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || "Failed to resume incomplete archive run.",
        );
      }

      setResumeTriggered(true);
      toast({
        title: data.alreadyRunning
          ? "Archive already running"
          : data.finished
            ? "Nothing to resume"
            : "Archive resume triggered",
        description:
          data.message ||
          "Resume started. The archive will continue in the background.",
        status: "info",
        duration: 7000,
        isClosable: true,
      });
      await fetchLogs();
    } catch (error: any) {
      console.error("Failed to resume archive run:", error);
      toast({
        title: "Resume failed",
        description:
          error.message || "Could not resume incomplete archive run.",
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setIsResuming(false);
    }
  }, [currentRun, fetchLogs, isResuming, resumeTriggered, toast]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin || !archiveInProgress) return;

    const intervalId = window.setInterval(fetchLogs, 15000);
    return () => window.clearInterval(intervalId);
  }, [archiveInProgress, fetchLogs, isAuthenticated, isAdmin]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin || !cleanupInProgress) return;

    const intervalId = window.setInterval(fetchLogs, 15000);
    return () => window.clearInterval(intervalId);
  }, [cleanupInProgress, fetchLogs, isAuthenticated, isAdmin]);

  useEffect(() => {
    if (previousCleanupInProgress && !cleanupInProgress) {
      toast({
        title:
          currentCleanupRun?.status === "failed"
            ? "Cleanup Failed"
            : "Cleanup Complete",
        description:
          currentCleanupRun?.status === "failed"
            ? "Cleanup finished with errors. Check the run details."
            : "Sanity document cleanup has finished.",
        status: currentCleanupRun?.status === "failed" ? "error" : "success",
        duration: 8000,
        isClosable: true,
      });
    }
    setPreviousCleanupInProgress(cleanupInProgress);
  }, [cleanupInProgress, previousCleanupInProgress, currentCleanupRun, toast]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    if (currentRun?.status === "incomplete") {
      void handleAutoResume();
    }
  }, [currentRun, handleAutoResume, isAuthenticated, isAdmin]);

  useEffect(() => {
    if (previousArchiveInProgress && !archiveInProgress) {
      const latestRun = logs[0];
      if (latestRun) {
        const runStatus = latestRun.status || "success";
        toast({
          title:
            runStatus === "success"
              ? "Archive Complete"
              : runStatus === "failed"
                ? "Archive Failed"
                : "Archive Finished",
          description:
            runStatus === "success"
              ? `Archive completed successfully. ${latestRun.documentsArchived} documents archived.`
              : runStatus === "failed"
                ? `Archive failed. Check run details for errors.`
                : `Archive finished with status: ${runStatus}.`,
          status: runStatus === "success" ? "success" : "error",
          duration: 8000,
          isClosable: true,
        });
      }

      // Must still reset here, before the early return below — this branch
      // used to return without ever calling setPreviousArchiveInProgress,
      // so it stayed stuck at `true` forever after the first completion.
      // Every later poll where archiveInProgress was momentarily false
      // (including the bursts from the resume-loop bug fixed in
      // archiveService.ts) then re-triggered this exact same toast again.
      setPreviousArchiveInProgress(archiveInProgress);
      const refreshTimer = window.setTimeout(fetchLogs, 2000);
      return () => window.clearTimeout(refreshTimer);
    }

    setPreviousArchiveInProgress(archiveInProgress);
  }, [archiveInProgress, previousArchiveInProgress, logs, toast, fetchLogs]);

  useEffect(() => {
    if (
      staleDetected &&
      !archiveInProgress &&
      currentRun?.status === "failed"
    ) {
      setPreviousArchiveInProgress(false);
    }
  }, [archiveInProgress, currentRun, staleDetected]);

  useEffect(() => {
    if (sessionStatus === "loading") return;

    if (isAuthenticated && isAdmin) {
      fetchLogs();
    } else if (isAuthenticated && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      router.push("/");
    }
  }, [isAuthenticated, isAdmin, router, toast, fetchLogs, sessionStatus]);

  const handleRunArchive = async (options?: { deleteOld?: boolean }) => {
    // Confirmation for the deleteOld path already happens in the "Delete Old
    // Archived Sanity Data" Modal (see confirmDeleteOld) before this is ever
    // called — no second confirmation needed here.

    if (!options?.deleteOld) {
      setCurrentRun(null);
      onProgressModalOpen();
    }

    setIsRunning(true);
    try {
      const query = options?.deleteOld ? "?deleteOld=true" : "";
      const res = await fetch(`/api/archive/run${query}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (!res.ok) {
        if (!options?.deleteOld) {
          onProgressModalClose();
        }
        const customMessage =
          data.status === "failed"
            ? data.errorMessage || data.error || "Archive failed"
            : data.archiveInProgress || res.status === 409
              ? data.cleanupInProgress
                ? "Cleanup already in progress. Please wait for the current run to finish."
                : "Archive already in progress. Please wait for the current run to finish."
              : data.errorMessage || data.error || "Failed to complete action";
        throw new Error(customMessage);
      }

      if (!options?.deleteOld && data.status === "started") {
        toast({
          title: "Archive Started",
          description:
            data.message ||
            "Archive run has been queued and will start shortly.",
          status: "success",
          duration: 5000,
          isClosable: true,
        });
      }

      if (options?.deleteOld) {
        // Cleanup now runs in the background (see archiveService.ts —
        // cleanupArchivedSanityData is batched/checkpointed and can span
        // more than one invocation on a large backlog), the same way an
        // archive run does. It no longer returns deletedSanityDocuments/
        // errors synchronously in this response, since that work hasn't
        // happened yet by the time this request returns — only the
        // metadata cleanup (old run-history/baseline records) has.
        toast({
          title: "Cleanup Started",
          description:
            data.message ||
            `Cleanup run has been queued and will continue in the background. Cleaned up ${data.deletedArchiveRuns || 0} old archive run record(s) and ${data.deletedBaselineSnapshots || 0} baseline snapshot(s) so far; Sanity document cleanup will proceed in batches.`,
          status: "success",
          duration: 7000,
          isClosable: true,
        });
      }

      const statusData = await fetchLogs();
      if (
        !options?.deleteOld &&
        statusData &&
        !statusData.archiveInProgress &&
        !statusData.currentRun
      ) {
        const started = await pollArchiveStart();
        if (!started) {
          toast({
            title: "Archive start pending",
            description:
              "No active archive run was immediately detected. The archive status will continue to update if the run begins.",
            status: "warning",
            duration: 7000,
            isClosable: true,
          });
        }
      }

      if (
        options?.deleteOld &&
        statusData &&
        !statusData.cleanupInProgress &&
        !statusData.currentCleanupRun
      ) {
        await pollCleanupStart();
      }
    } catch (error: any) {
      toast({
        title: options?.deleteOld ? "Archive Cleanup Failed" : "Archive Failed",
        description: error.message,
        status: "error",
        duration: 7000,
        isClosable: true,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const openDeleteModal = () => {
    setDeleteOld(true);
    onOpen();
  };

  // Runs a fresh archive pass to completion (queueing it, then explicitly
  // resuming it — not relying on the admin page's auto-resume effect, which
  // only fires once per page load and would leave a multi-resume backlog
  // stuck) before cleanup is allowed to touch Sanity. This makes sure the
  // Mongo copies cleanup's completeness check reads (see DELETE_SAFE_STATUS
  // in archiveService.ts) reflect Sanity's current state, not a stale
  // snapshot from whenever a record was last archived.
  // Bounded to ~5 minutes of polling — if a very large backlog needs more
  // than that, cleanup still proceeds (its own DB-level safety filter is
  // what actually protects unfinished records, not this step), and the
  // admin is told archiving is still catching up.
  const runFreshArchiveToCompletion = async (): Promise<boolean> => {
    const startRes = await fetch("/api/archive/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const startData = await startRes.json();
    if (!startRes.ok) {
      throw new Error(
        startData.errorMessage || startData.error || "Failed to start archive",
      );
    }

    const maxAttempts = 60; // ~5 minutes at 5s intervals
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await wait(5000);
      const res = await fetch("/api/archive/status");
      if (!res.ok) continue;
      const data = await res.json();
      setLogs(data.recentRuns || data.runs || []);
      setArchiveInProgress(data.archiveInProgress === true);
      setCurrentRun(data.currentRun || null);

      if (data.archiveInProgress) continue;

      if (data.currentRun?.status === "incomplete") {
        // Explicitly resume rather than waiting for another trigger —
        // a backlog this size can need several resume cycles.
        await fetch("/api/archive/resume", { method: "POST" });
        continue;
      }

      return true; // no longer in progress and not incomplete — done
    }

    return false; // timed out — cleanup proceeds anyway, see comment above
  };

  const confirmDeleteOld = async () => {
    setIsRunning(true);
    try {
      toast({
        title: "Archiving before cleanup",
        description:
          "Running a fresh archive pass first so MongoDB reflects Sanity's current state before anything is deleted.",
        status: "info",
        duration: 6000,
        isClosable: true,
      });
      const completed = await runFreshArchiveToCompletion();
      if (!completed) {
        toast({
          title: "Archive still catching up",
          description:
            "The pre-cleanup archive pass is still running after 5 minutes. Proceeding to cleanup anyway — its own safety check will still skip any document that isn't completed or cancelled.",
          status: "warning",
          duration: 8000,
          isClosable: true,
        });
      }
    } catch (error: any) {
      toast({
        title: "Pre-cleanup archive failed",
        description:
          (error?.message || "Could not run archive before cleanup.") +
          " Proceeding to cleanup anyway — its own safety check will still skip any document that isn't completed or cancelled.",
        status: "warning",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setIsRunning(false);
    }

    await handleRunArchive({ deleteOld: true });
    onClose();
    setDeleteOld(false);
  };

  const handleDownloadBackup = () => {
    // Just navigate to the endpoint to trigger the browser download
    window.location.href = "/api/archive/export";
  };

  const resetRestoreState = () => {
    setRestoreFile(null);
    setRestorePreview(null);
    setRestoreError(null);
    setRestoreConfirmText("");
  };

  const onRestoreModalClose = () => {
    if (restorePreviewInProgress || restoreApplyInProgress) return;
    resetRestoreState();
    onRestoreModalCloseRaw();
  };

  const handleRestoreFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setRestorePreview(null);
    setRestoreError(null);
    setRestoreConfirmText("");
    setRestoreFile(event.target.files?.[0] || null);
  };

  // Reads the selected backup file and POSTs it to /api/archive/import for a
  // DRY RUN (no apply param -> applyIfTrue=false server-side) — nothing is
  // written yet. The admin has to review this diff and type the confirm
  // phrase before handleApplyRestore is reachable at all.
  const handlePreviewRestore = async () => {
    if (!restoreFile) return;
    setRestorePreviewInProgress(true);
    setRestoreError(null);
    setRestorePreview(null);
    try {
      const text = await restoreFile.text();
      const payload = JSON.parse(text); // the encrypted {iv, data, tag} envelope from the export file
      const res = await fetch("/api/archive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.details || "Preview failed");
      }
      setRestorePreview(data);
    } catch (err: any) {
      setRestoreError(err?.message || "Failed to preview backup file");
    } finally {
      setRestorePreviewInProgress(false);
    }
  };

  const handleApplyRestore = async () => {
    if (!restoreFile || restoreConfirmText !== RESTORE_CONFIRM_PHRASE) return;
    setRestoreApplyInProgress(true);
    setRestoreError(null);
    try {
      const text = await restoreFile.text();
      const payload = JSON.parse(text);
      const res = await fetch("/api/archive/import?apply=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.details || "Restore failed");
      }
      toast({
        title: "Restore applied",
        description: `Backup restored (audit ID: ${data.auditId || "n/a"}).`,
        status: "success",
        duration: 7000,
        isClosable: true,
      });
      resetRestoreState();
      onRestoreModalCloseRaw();
    } catch (err: any) {
      setRestoreError(err?.message || "Failed to apply restore");
    } finally {
      setRestoreApplyInProgress(false);
    }
  };

  const selectedRun = selectedRunId
    ? logs.find((log) => log._id === selectedRunId) || null
    : null;

  const handleSelectRun = (runId: string) => {
    setSelectedRunId(runId);
    setShowRawLog(false);
    onRunDetailsModalOpen();
  };

  const handleCopyRawLog = async () => {
    if (!selectedRun) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedRun, null, 2));
      toast({
        title: "Raw log copied",
        description: "The full archive run JSON has been copied to clipboard.",
        status: "success",
        duration: 4000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Unable to copy raw log to clipboard.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValidationReport(null);
    setValidationError(null);
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
  };

  const sliceFileChunks = async (file: File, chunkSize: number) => {
    const chunks: Blob[] = [];
    let start = 0;

    while (start < file.size) {
      let end = Math.min(start + chunkSize, file.size);
      let chunk = file.slice(start, end);

      if (end < file.size) {
        const text = await chunk.text();
        const lastNewline = text.lastIndexOf("\n");
        if (lastNewline === -1) {
          throw new Error(
            "Unable to split file into newline-delimited chunks. Please use a smaller file or ensure each line ends with a newline.",
          );
        }
        end = start + lastNewline + 1;
        chunk = file.slice(start, end);
      }

      chunks.push(chunk);
      start = end;
    }

    return chunks;
  };

  const parseStreamedValidation = async (
    response: Response,
    onProgress: (event: any) => void,
  ) => {
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const errorText = contentType.includes("application/json")
        ? await response
            .json()
            .then((data) => data.error || data.message || JSON.stringify(data))
        : await response.text();
      throw new Error(errorText || response.statusText || "Validation failed");
    }

    if (!response.body) {
      throw new Error("No response body from archive validation.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: any = null;
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (rawLine) {
            const event = JSON.parse(rawLine);
            if (event.type === "progress") {
              onProgress(event);
            } else if (event.type === "final") {
              finalResult = event.result;
            } else if (event.type === "error") {
              throw new Error(event.error || "Validation stream error");
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }
      done = readerDone;
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer.trim());
      if (event.type === "progress") {
        onProgress(event);
      } else if (event.type === "final") {
        finalResult = event.result;
      } else if (event.type === "error") {
        throw new Error(event.error || "Validation stream error");
      }
    }

    if (!finalResult) {
      throw new Error("File validation did not return a final result.");
    }

    return finalResult;
  };

  const handleValidateArchiveFile = async () => {
    if (!selectedFile) {
      toast({
        title: "No file selected",
        description: "Please choose a data.ndjson file to validate.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    setValidationInProgress(true);
    setValidationError(null);
    setValidationReport(null);
    setValidationProgress(null);

    const query = insertMissing ? "?stream=true&insert=true" : "?stream=true";
    const useChunkedUpload = selectedFile.size > CHUNK_SIZE_BYTES;
    const aggregatedReport: any = {
      totalLines: 0,
      parsedLines: 0,
      validDocuments: 0,
      missingDocuments: 0,
      invalidLines: 0,
      unknownTypes: 0,
      durationMs: 0,
      summary: {
        totalLines: 0,
        parsedLines: 0,
        validDocuments: 0,
        missingDocuments: 0,
        invalidLines: 0,
        unknownTypes: 0,
      },
      lineResults: [],
    };

    try {
      const chunks = useChunkedUpload
        ? await sliceFileChunks(selectedFile, CHUNK_SIZE_BYTES)
        : [selectedFile];
      const startTime = Date.now();

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const response = await fetch(`/api/archive/verify-upload${query}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
          },
          body: chunk,
        });

        const chunkResult = await parseStreamedValidation(response, (event) => {
          setValidationProgress({
            ...event,
            message: useChunkedUpload
              ? `Chunk ${index + 1}/${chunks.length}: ${event.message}`
              : event.message,
          });
        });

        aggregatedReport.totalLines += chunkResult.totalLines;
        aggregatedReport.parsedLines += chunkResult.parsedLines;
        aggregatedReport.validDocuments += chunkResult.validDocuments;
        aggregatedReport.missingDocuments += chunkResult.missingDocuments;
        aggregatedReport.invalidLines += chunkResult.invalidLines;
        aggregatedReport.unknownTypes += chunkResult.unknownTypes;
        aggregatedReport.durationMs = Date.now() - startTime;
        aggregatedReport.summary.totalLines = aggregatedReport.totalLines;
        aggregatedReport.summary.parsedLines = aggregatedReport.parsedLines;
        aggregatedReport.summary.validDocuments =
          aggregatedReport.validDocuments;
        aggregatedReport.summary.missingDocuments =
          aggregatedReport.missingDocuments;
        aggregatedReport.summary.invalidLines = aggregatedReport.invalidLines;
        aggregatedReport.summary.unknownTypes = aggregatedReport.unknownTypes;

        if (
          chunkResult.lineResults?.length &&
          aggregatedReport.lineResults.length < 200
        ) {
          aggregatedReport.lineResults.push(
            ...chunkResult.lineResults.slice(
              0,
              200 - aggregatedReport.lineResults.length,
            ),
          );
        }
      }

      aggregatedReport.lineResults = aggregatedReport.lineResults.slice(0, 200);
      setValidationReport(aggregatedReport);
      toast({
        title: "Archive validation complete",
        description: `Checked ${aggregatedReport.totalLines} lines and found ${aggregatedReport.validDocuments} archived documents.`,
        status: "success",
        duration: 6000,
        isClosable: true,
      });
    } catch (error: any) {
      console.error("Archive file validation failed:", error);
      setValidationError(error?.message || "Validation failed");
      toast({
        title: "Validation failed",
        description: error?.message || "Unable to validate the uploaded file.",
        status: "error",
        duration: 7000,
        isClosable: true,
      });
    } finally {
      setValidationInProgress(false);
    }
  };

  const handleClearValidation = () => {
    setSelectedFile(null);
    setValidationReport(null);
    setValidationError(null);
    setValidationProgress(null);
  };

  const closeProgressModal = () => {
    if (currentRun?.status === "running" || archiveInProgress) return;
    onProgressModalClose();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge colorScheme="green">Success</Badge>;
      case "partial":
        return <Badge colorScheme="orange">Partial</Badge>;
      case "failed":
        return <Badge colorScheme="red">Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const renderIncomplete = (run: ArchiveLog) => {
    // Highlight incomplete runs if present
    // Some runs include `incomplete: true` in their payload
    // Type may be missing on older entries
    const anyRun: any = run as any;
    if (anyRun.incomplete) {
      return <Badge colorScheme="yellow">Incomplete</Badge>;
    }
    return null;
  };

  if (sessionStatus === "loading") {
    return (
      <Flex justifyContent="center" alignItems="center" height="50vh">
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (!isAdmin) return null;

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgColor} minH="100vh">
      <Flex
        justifyContent="space-between"
        alignItems="center"
        mb={6}
        flexWrap="wrap"
        gap={4}
      >
        <Box>
          <Heading as="h1" size="xl" color={textColor} mb={2}>
            Archive Management
          </Heading>
          <Text color={textColorSecondary}>
            Manage your historical transaction data, run manual archives, and
            download backups.
          </Text>
        </Box>
        <Flex
          direction={{ base: "column", sm: "row" }}
          gap={3}
          w={{ base: "100%", md: "auto" }}
          wrap="wrap"
        >
          <Button
            leftIcon={<FiDownload />}
            colorScheme="gray"
            variant="outline"
            onClick={handleDownloadBackup}
            w={{ base: "100%", sm: "auto" }}
          >
            Download Backup
          </Button>
          <Button
            leftIcon={<FiUpload />}
            colorScheme="orange"
            variant="outline"
            onClick={() => {
              resetRestoreState();
              onRestoreModalOpen();
            }}
            isDisabled={archiveInProgress || isRunning}
            w={{ base: "100%", sm: "auto" }}
          >
            Restore from Backup
          </Button>
          <Button
            leftIcon={<FiRefreshCw />}
            colorScheme="gray"
            variant="ghost"
            onClick={handleRefreshStatus}
            isLoading={isLoading}
            w={{ base: "100%", sm: "auto" }}
          >
            Refresh Status
          </Button>
          <Button
            leftIcon={<FiPlay />}
            colorScheme="brand"
            onClick={() => handleRunArchive()}
            isLoading={isRunning}
            isDisabled={archiveInProgress || isRunning}
            loadingText="Running..."
            w={{ base: "100%", sm: "auto" }}
          >
            {archiveInProgress ? "Archive Running" : "Run Archive Now"}
          </Button>
          <Button
            leftIcon={<FiTrash2 />}
            colorScheme="red"
            onClick={openDeleteModal}
            isLoading={isRunning && deleteOld}
            isDisabled={archiveInProgress || isRunning}
            loadingText="Deleting..."
            w={{ base: "100%", sm: "auto" }}
          >
            Delete Old Archived Sanity Data
          </Button>
        </Flex>
      </Flex>

      <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
        <CardHeader pb={0}>
          <Heading as="h2" size="md" color={textColor}>
            Archive Upload Verification
          </Heading>
        </CardHeader>
        <CardBody>
          <FormControl mb={4}>
            <FormLabel>Upload data.ndjson</FormLabel>
            <Input
              type="file"
              accept=".ndjson,.json,text/plain"
              onChange={handleFileChange}
            />
            <HStack mt={2}>
              <Checkbox
                isChecked={insertMissing}
                onChange={(e) => setInsertMissing(e.target.checked)}
              >
                Insert missing documents into archive
              </Checkbox>
            </HStack>
          </FormControl>
          <HStack spacing={3} wrap="wrap">
            <Button
              colorScheme="blue"
              onClick={handleValidateArchiveFile}
              isLoading={validationInProgress}
              isDisabled={!selectedFile || validationInProgress}
            >
              Validate Upload
            </Button>
            <Button
              variant="outline"
              onClick={handleClearValidation}
              isDisabled={!selectedFile && !validationReport}
            >
              Clear
            </Button>
          </HStack>
          {selectedFile ? (
            <Text mt={3} color={textColorSecondary} fontSize="sm">
              Selected file: {selectedFile.name} ({selectedFile.size} bytes)
            </Text>
          ) : null}
          {validationProgress ? (
            <Box mt={3} p={3} borderRadius="md" bg={cardBgColor}>
              <Text fontWeight="bold">Validation progress</Text>
              <Text fontSize="sm" color={textColorSecondary}>
                {validationProgress.message}
              </Text>
              <Text fontSize="sm">
                Processed: {validationProgress.linesProcessed} lines
              </Text>
              <Text fontSize="sm">
                Valid: {validationProgress.validDocuments} · Missing:{" "}
                {validationProgress.missingDocuments} · Invalid:{" "}
                {validationProgress.invalidLines}
              </Text>
              <Text fontSize="sm" color={textColorSecondary}>
                Unknown types: {validationProgress.unknownTypes}
              </Text>
            </Box>
          ) : null}
          {validationError ? (
            <Alert status="error" borderRadius="md" mt={4}>
              <AlertIcon />
              <Text>{validationError}</Text>
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      {validationReport ? (
        <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
          <CardHeader pb={0}>
            <Flex justify="space-between" align="center">
              <Heading as="h2" size="md" color={textColor}>
                Upload Validation Results
              </Heading>
              <Badge
                colorScheme={
                  validationReport.missingDocuments > 0 ||
                  validationReport.invalidLines > 0
                    ? "red"
                    : "green"
                }
              >
                {validationReport.missingDocuments > 0 ||
                validationReport.invalidLines > 0
                  ? "Issues found"
                  : "All good"}
              </Badge>
            </Flex>
          </CardHeader>
          <CardBody>
            <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
              <Stat>
                <StatLabel>Total lines</StatLabel>
                <StatNumber>{validationReport.totalLines}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Parsed docs</StatLabel>
                <StatNumber>{validationReport.parsedLines}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Archived</StatLabel>
                <StatNumber>{validationReport.validDocuments}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Missing / invalid</StatLabel>
                <StatNumber>
                  {validationReport.missingDocuments +
                    validationReport.invalidLines}
                </StatNumber>
              </Stat>
            </SimpleGrid>
            <Box mb={4}>
              <Text color={textColorSecondary} fontSize="sm">
                Validation took {validationReport.durationMs} ms.{" "}
                {validationReport.unknownTypes} documents had an unknown or
                unrecognized type and were checked across archive collections.
              </Text>
            </Box>
            <Box mb={4}>
              <Heading as="h4" size="sm" mb={2} color={textColor}>
                Results preview
              </Heading>
              <Box
                maxH="320px"
                overflowY="auto"
                p={3}
                bg={tableHeaderBg}
                borderRadius="md"
              >
                {validationReport.lineResults.slice(0, 200).map((line: any) => (
                  <Text
                    key={`${line.lineNumber}-${line.sanityId}`}
                    whiteSpace="pre-wrap"
                    fontSize="sm"
                    mb={2}
                  >
                    Line {line.lineNumber}: {line.status.toUpperCase()} —{" "}
                    {line.reason}
                  </Text>
                ))}
                {validationReport.lineResults.length > 200 ? (
                  <Text color={textColorSecondary} fontSize="sm" mt={2}>
                    Showing first 200 of {validationReport.lineResults.length}{" "}
                    results.
                  </Text>
                ) : null}
              </Box>
            </Box>
          </CardBody>
        </Card>
      ) : null}

      {staleDetected && staleResolution ? (
        <Alert status="warning" borderRadius="lg" mb={6}>
          <AlertIcon />
          <Box>
            <AlertTitle>Stale archive run cleared</AlertTitle>
            <AlertDescription>{staleResolution}</AlertDescription>
          </Box>
        </Alert>
      ) : null}

      {currentRun ? (
        <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
          <CardHeader pb={0}>
            <Flex justify="space-between" align="center">
              <Box>
                <Heading as="h2" size="md" color={textColor}>
                  Current Archive Status
                </Heading>
                <Text color={textColorSecondary} fontSize="sm">
                  Run ID: {currentRun.runId}
                </Text>
              </Box>
              <Badge
                colorScheme={
                  currentRun.status === "running"
                    ? "blue"
                    : currentRun.status === "success"
                      ? "green"
                      : currentRun.status === "failed"
                        ? "red"
                        : "yellow"
                }
              >
                {currentRun.status.toUpperCase()}
              </Badge>
            </Flex>
          </CardHeader>
          <CardBody>
            <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
              <Stat>
                <StatLabel>Started</StatLabel>
                <StatNumber>
                  {new Date(currentRun.startedAt).toLocaleString()}
                </StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Step</StatLabel>
                <StatNumber>
                  {currentRun.currentStep || "Starting..."}
                </StatNumber>
                <StatHelpText>
                  {currentRun.currentStepIndex}/{currentRun.totalSteps}
                </StatHelpText>
              </Stat>
              <Stat>
                <StatLabel>Progress</StatLabel>
                <StatNumber>{currentRun.progressPercent}%</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Last updated</StatLabel>
                <StatNumber>
                  {new Date(currentRun.lastUpdatedAt).toLocaleString()}
                </StatNumber>
              </Stat>
            </SimpleGrid>
            <Progress
              value={currentRun.progressPercent}
              size="sm"
              colorScheme={currentRun.status === "failed" ? "red" : "blue"}
              mb={4}
            />
            <HStack spacing={3} wrap="wrap">
              <Badge colorScheme="green">
                Completed: {currentRun.completedSteps.length}
              </Badge>
              <Badge colorScheme="yellow">
                Pending: {currentRun.pendingSteps.length}
              </Badge>
              {currentRun.errors.length > 0 && (
                <Badge colorScheme="red">
                  Errors: {currentRun.errors.length}
                </Badge>
              )}
            </HStack>
          </CardBody>
        </Card>
      ) : null}

      {currentCleanupRun ? (
        <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
          <CardHeader pb={0}>
            <Flex justify="space-between" align="center">
              <Box>
                <Heading as="h2" size="md" color={textColor}>
                  Current Cleanup Status
                </Heading>
                <Text color={textColorSecondary} fontSize="sm">
                  Run ID: {currentCleanupRun.runId}
                </Text>
              </Box>
              <Badge
                colorScheme={
                  currentCleanupRun.status === "running"
                    ? "blue"
                    : currentCleanupRun.status === "success"
                      ? "green"
                      : currentCleanupRun.status === "failed"
                        ? "red"
                        : "yellow"
                }
              >
                {currentCleanupRun.status.toUpperCase()}
              </Badge>
            </Flex>
          </CardHeader>
          <CardBody>
            <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
              <Stat>
                <StatLabel>Started</StatLabel>
                <StatNumber>
                  {new Date(currentCleanupRun.startedAt).toLocaleString()}
                </StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Collections</StatLabel>
                <StatNumber>
                  {currentCleanupRun.completedCollections.length}
                  {currentCleanupRun.totalCollections
                    ? `/${currentCleanupRun.totalCollections}`
                    : ""}
                </StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Last updated</StatLabel>
                <StatNumber>
                  {new Date(currentCleanupRun.lastUpdatedAt).toLocaleString()}
                </StatNumber>
              </Stat>
            </SimpleGrid>
            <Progress
              value={
                currentCleanupRun.totalCollections
                  ? (currentCleanupRun.completedCollections.length /
                      currentCleanupRun.totalCollections) *
                    100
                  : 0
              }
              size="sm"
              colorScheme={
                currentCleanupRun.status === "failed" ? "red" : "blue"
              }
              mb={4}
            />
            <HStack spacing={3} wrap="wrap">
              <Badge colorScheme="green">
                Completed: {currentCleanupRun.completedCollections.length}
              </Badge>
              {currentCleanupRun.errors.length > 0 && (
                <Badge colorScheme="red">
                  Errors: {currentCleanupRun.errors.length}
                </Badge>
              )}
            </HStack>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        isOpen={isProgressModalOpen}
        onClose={closeProgressModal}
        size={{ base: "full", md: "xl" }}
        closeOnEsc={currentRun?.status !== "running"}
        closeOnOverlayClick={currentRun?.status !== "running"}
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Archive Run Progress</ModalHeader>
          {currentRun?.status !== "running" ? <ModalCloseButton /> : null}
          <ModalBody>
            {currentRun ? (
              <Box>
                <Flex justify="space-between" align="center" mb={4}>
                  <Box>
                    <Text color={textColorSecondary} mb={2}>
                      Run ID: {currentRun.runId}
                    </Text>
                    <Heading as="h3" size="md" color={textColor}>
                      {currentRun.status === "running"
                        ? "Archive is running"
                        : currentRun.status === "success"
                          ? "Archive completed"
                          : "Archive finished"}
                    </Heading>
                  </Box>
                  <Badge
                    colorScheme={
                      currentRun.status === "running"
                        ? "blue"
                        : currentRun.status === "success"
                          ? "green"
                          : "red"
                    }
                    fontSize="sm"
                  >
                    {currentRun.status.toUpperCase()}
                  </Badge>
                </Flex>
                <Progress
                  value={currentRun.progressPercent}
                  size="sm"
                  colorScheme={currentRun.status === "failed" ? "red" : "blue"}
                  mb={4}
                />
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={4}>
                  <Stat>
                    <StatLabel>Started</StatLabel>
                    <StatNumber>
                      {new Date(currentRun.startedAt).toLocaleString()}
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Last updated</StatLabel>
                    <StatNumber>
                      {new Date(currentRun.lastUpdatedAt).toLocaleString()}
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Current step</StatLabel>
                    <StatNumber>
                      {currentRun.currentStep || "Starting..."}
                    </StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Step progress</StatLabel>
                    <StatNumber>
                      {currentRun.currentStepIndex}/{currentRun.totalSteps}
                    </StatNumber>
                  </Stat>
                </SimpleGrid>
                <Box mb={4}>
                  <HStack spacing={3} wrap="wrap">
                    <Badge colorScheme="green">
                      Completed: {currentRun.completedSteps.length}
                    </Badge>
                    <Badge colorScheme="yellow">
                      Pending: {currentRun.pendingSteps.length}
                    </Badge>
                    {currentRun.errors.length > 0 && (
                      <Badge colorScheme="red">
                        Errors: {currentRun.errors.length}
                      </Badge>
                    )}
                  </HStack>
                </Box>
                <Box mb={4}>
                  <Heading as="h4" size="sm" mb={2} color={textColor}>
                    Archive logs
                  </Heading>
                  <Box
                    maxH="320px"
                    overflowY="auto"
                    p={3}
                    bg={tableHeaderBg}
                    borderRadius="md"
                  >
                    {currentRun.logs && currentRun.logs.length > 0 ? (
                      currentRun.logs.map((message, index) => (
                        <Text
                          key={`${message}-${index}`}
                          whiteSpace="pre-wrap"
                          fontSize="sm"
                          mb={2}
                        >
                          {message}
                        </Text>
                      ))
                    ) : (
                      <Text color={textColorSecondary}>
                        Waiting for archive progress...
                      </Text>
                    )}
                  </Box>
                </Box>
              </Box>
            ) : archiveInProgress ? (
              <Flex direction="column" align="center" justify="center" py={12}>
                <Spinner size="xl" mb={4} />
                <Text color={textColorSecondary}>
                  Starting archive run... please wait.
                </Text>
              </Flex>
            ) : (
              <Flex direction="column" align="center" justify="center" py={12}>
                <Text color={textColorSecondary} textAlign="center" maxW="xl">
                  No active archive run was detected. If the run was just
                  started, it may take a few seconds to appear. If this
                  persists, verify the archive service and MongoDB connection.
                </Text>
              </Flex>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={closeProgressModal}
              isDisabled={currentRun?.status === "running" || archiveInProgress}
            >
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
        <CardHeader pb={0}>
          <Flex justify="space-between" align="center">
            <Heading as="h2" size="md" color={textColor}>
              Archive Run History
            </Heading>
            <HStack>
              <Tooltip label="Refresh archive logs" placement="top">
                <IconButton
                  aria-label="Refresh logs"
                  icon={<FiRefreshCw />}
                  size="sm"
                  variant="ghost"
                  onClick={fetchLogs}
                  isLoading={isLoading}
                />
              </Tooltip>
            </HStack>
          </Flex>
        </CardHeader>
        <CardBody>
          {isLoading && logs.length === 0 ? (
            <Flex justify="center" p={8}>
              <Spinner />
            </Flex>
          ) : logs.length === 0 ? (
            <Text color={textColorSecondary} textAlign="center" p={8}>
              No archive history found.
            </Text>
          ) : (
            <Box overflowX="auto">
              <Table variant="simple" size="md">
                <Thead bg={tableHeaderBg}>
                  <Tr>
                    <Th color={textColor}>Date</Th>
                    <Th color={textColor}>Status</Th>
                    <Th color={textColor} isNumeric>
                      Docs Archived
                    </Th>
                    <Th color={textColor} isNumeric>
                      Docs Deleted
                    </Th>
                    <Th color={textColor} isNumeric>
                      <Tooltip
                        label="Prefers run.totalInserted; falls back to summing step.inserted"
                        placement="top"
                      >
                        <Box as="span">Docs Inserted</Box>
                      </Tooltip>
                    </Th>
                    <Th color={textColor} isNumeric>
                      <Tooltip
                        label="Prefers run.totalUpdated; falls back to summing step.updated"
                        placement="top"
                      >
                        <Box as="span">Docs Updated</Box>
                      </Tooltip>
                    </Th>
                    <Th color={textColor} isNumeric>
                      <Tooltip
                        label="Prefers run.totalSkipped; falls back to summing step.skipped"
                        placement="top"
                      >
                        <Box as="span">Docs Skipped</Box>
                      </Tooltip>
                    </Th>
                    <Th color={textColor} isNumeric>
                      Assets Deleted
                    </Th>
                    <Th color={textColor}>Details</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {logs
                    .slice((page - 1) * rowsPerPage, page * rowsPerPage)
                    .map((log) => (
                      <Tr
                        key={log._id}
                        borderBottom="1px solid"
                        borderColor={tableBorderColor}
                      >
                        <Td color={textColorSecondary} whiteSpace="nowrap">
                          {new Date(log.runDate).toLocaleString()}
                        </Td>
                        <Td>
                          <HStack spacing={2}>
                            {getStatusBadge(log.status)}
                            {renderIncomplete(log)}
                          </HStack>
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.documentsArchived ??
                            (log.steps
                              ? log.steps.reduce(
                                  (s: number, st: any) => s + (st.count || 0),
                                  0,
                                )
                              : Object.values(log.archived || {}).reduce(
                                  (s: number, v: any) => s + (v || 0),
                                  0,
                                ))}
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.documentsDeleted ??
                            (log.steps
                              ? log.steps.reduce(
                                  (s: number, st: any) =>
                                    s + (st.deletedCount || 0),
                                  0,
                                )
                              : 0)}
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.totalInserted ??
                            (log.steps
                              ? log.steps.reduce(
                                  (s: number, st: any) =>
                                    s + (st.inserted || 0),
                                  0,
                                )
                              : 0)}
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.totalUpdated ??
                            (log.steps
                              ? log.steps.reduce(
                                  (s: number, st: any) =>
                                    s + (st.updated || 0),
                                  0,
                                )
                              : 0)}
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.totalSkipped ??
                            (log.steps
                              ? log.steps.reduce(
                                  (s: number, st: any) => s + (st.skipped || 0),
                                  0,
                                )
                              : 0)}
                        </Td>
                        <Td color={textColorSecondary} isNumeric>
                          {log.assetsDeleted}
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            variant="outline"
                            rightIcon={<FiChevronDown />}
                            onClick={() => handleSelectRun(log._id)}
                          >
                            Details
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  {/* Pagination Controls */}
                  {logs.length > rowsPerPage && (
                    <Tr>
                      <Td colSpan={9} textAlign="right">
                        <Button
                          size="sm"
                          onClick={() => setPage((p) => Math.max(p - 1, 1))}
                          disabled={page === 1}
                          mr={2}
                        >
                          Prev
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setPage((p) =>
                              p * rowsPerPage < logs.length ? p + 1 : p,
                            )
                          }
                          disabled={page * rowsPerPage >= logs.length}
                        >
                          Next
                        </Button>
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          )}
        </CardBody>
      </Card>

      {selectedRun && (
        <Card bg={cardBgColor} borderRadius="lg" boxShadow="sm" mb={8}>
          <CardHeader pb={0}>
            <Heading as="h3" size="md" color={textColor}>
              Run details for {new Date(selectedRun.runDate).toLocaleString()}
            </Heading>
          </CardHeader>
          <CardBody>
            <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
              <Stat>
                <StatLabel>Documents Archived</StatLabel>
                <StatNumber>{selectedRun.documentsArchived}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Documents Deleted</StatLabel>
                <StatNumber>{selectedRun.documentsDeleted}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Assets Deleted</StatLabel>
                <StatNumber>{selectedRun.assetsDeleted}</StatNumber>
              </Stat>
              <Stat>
                <StatLabel>Duration</StatLabel>
                <StatNumber>
                  {selectedRun.durationMs
                    ? `${selectedRun.durationMs} ms`
                    : "n/a"}
                </StatNumber>
              </Stat>
            </SimpleGrid>

            {selectedRun.steps?.length ? (
              <Box overflowX="auto" mb={4}>
                <Table variant="simple" size="sm">
                  <Thead bg={tableHeaderBg}>
                    <Tr>
                      <Th>Step</Th>
                      <Th isNumeric>Count</Th>
                      <Th isNumeric>Deleted</Th>
                      <Th isNumeric>Inserted</Th>
                      <Th isNumeric>Updated</Th>
                      <Th isNumeric>Skipped</Th>
                      <Th>Status</Th>
                      <Th>Errors</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {selectedRun.steps.map((step) => (
                      <Tr
                        key={step.name}
                        borderBottom="1px solid"
                        borderColor={tableBorderColor}
                      >
                        <Td>{step.name}</Td>
                        <Td isNumeric>{step.count}</Td>
                        <Td isNumeric>{step.deletedCount}</Td>
                        <Td isNumeric>{step.inserted ?? 0}</Td>
                        <Td isNumeric>{step.updated ?? 0}</Td>
                        <Td isNumeric>{step.skipped ?? 0}</Td>
                        <Td>{getStatusBadge(step.status)}</Td>
                        <Td>{step.errors?.length || 0}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            ) : null}

            {selectedRun.steps?.length ? (
              <Box mb={4}>
                <Flex justify="space-between" align="center" mb={3}>
                  <Heading as="h4" size="sm" color={textColor}>
                    Raw run payload
                  </Heading>
                  <HStack spacing={2}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowRawLog((value) => !value)}
                    >
                      {showRawLog ? "Hide raw" : "Show raw"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyRawLog}
                    >
                      Copy JSON
                    </Button>
                  </HStack>
                </Flex>
                {showRawLog ? (
                  <Box
                    maxH="420px"
                    overflowY="auto"
                    overflowX="auto"
                    p={3}
                    bg={tableHeaderBg}
                    borderRadius="md"
                  >
                    <Code whiteSpace="pre" width="100%" fontSize={{ base: "xs", md: "sm" }}>
                      {JSON.stringify(selectedRun, null, 2)}
                    </Code>
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {selectedRun.errors?.length ? (
              <Alert status="error" borderRadius="md">
                <AlertIcon />
                <Box>
                  <AlertTitle>Archive run errors</AlertTitle>
                  <AlertDescription display="block">
                    {selectedRun.errors.slice(0, 5).map((message, index) => (
                      <Text key={index}>{message}</Text>
                    ))}
                    {selectedRun.errors.length > 5 && (
                      <Text mt={2} fontStyle="italic">
                        And {selectedRun.errors.length - 5} more errors.
                      </Text>
                    )}
                  </AlertDescription>
                </Box>
              </Alert>
            ) : null}

            {selectedRun.warnings?.length ? (
              <Alert status="warning" borderRadius="md" mt={selectedRun.errors?.length ? 3 : 0}>
                <AlertIcon />
                <Box>
                  <AlertTitle>Archive run warnings (non-fatal)</AlertTitle>
                  <AlertDescription display="block">
                    {selectedRun.warnings.slice(0, 5).map((message, index) => (
                      <Text key={index}>{message}</Text>
                    ))}
                    {selectedRun.warnings.length > 5 && (
                      <Text mt={2} fontStyle="italic">
                        And {selectedRun.warnings.length - 5} more warnings.
                      </Text>
                    )}
                  </AlertDescription>
                </Box>
              </Alert>
            ) : null}
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={isRunDetailsModalOpen}
        onClose={onRunDetailsModalClose}
        size={{ base: "full", md: "xl" }}
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Archive Run Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRun ? (
              <Box>
                <Text mb={4} color={textColorSecondary}>
                  {new Date(selectedRun.runDate).toLocaleString()}
                </Text>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={4}>
                  <Stat>
                    <StatLabel>Status</StatLabel>
                    <StatNumber>{selectedRun.status}</StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Documents Archived</StatLabel>
                    <StatNumber>{selectedRun.documentsArchived}</StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Documents Deleted</StatLabel>
                    <StatNumber>{selectedRun.documentsDeleted}</StatNumber>
                  </Stat>
                  <Stat>
                    <StatLabel>Duration</StatLabel>
                    <StatNumber>
                      {selectedRun.durationMs
                        ? `${selectedRun.durationMs} ms`
                        : "n/a"}
                    </StatNumber>
                  </Stat>
                </SimpleGrid>
                {selectedRun.steps?.length ? (
                  <Box overflowX="auto" mb={4}>
                    <Table variant="simple" size="sm">
                      <Thead bg={tableHeaderBg}>
                        <Tr>
                          <Th>Step</Th>
                          <Th isNumeric>Count</Th>
                          <Th isNumeric>Deleted</Th>
                          <Th isNumeric>Inserted</Th>
                          <Th isNumeric>Updated</Th>
                          <Th isNumeric>Skipped</Th>
                          <Th>Status</Th>
                          <Th>Errors</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {selectedRun.steps.map((step) => (
                          <Tr key={step.name}>
                            <Td>{step.name}</Td>
                            <Td isNumeric>{step.count}</Td>
                            <Td isNumeric>{step.deletedCount}</Td>
                            <Td isNumeric>{step.inserted ?? 0}</Td>
                            <Td isNumeric>{step.updated ?? 0}</Td>
                            <Td isNumeric>{step.skipped ?? 0}</Td>
                            <Td>{getStatusBadge(step.status)}</Td>
                            <Td>{step.errors?.length || 0}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                ) : null}
                {selectedRun.errors?.length ? (
                  <Alert status="error" borderRadius="md">
                    <AlertIcon />
                    <Box>
                      <AlertTitle>Archive run errors</AlertTitle>
                      <AlertDescription display="block">
                        {selectedRun.errors
                          .slice(0, 5)
                          .map((message, index) => (
                            <Text key={index}>{message}</Text>
                          ))}
                        {selectedRun.errors.length > 5 && (
                          <Text mt={2} fontStyle="italic">
                            And {selectedRun.errors.length - 5} more errors.
                          </Text>
                        )}
                      </AlertDescription>
                    </Box>
                  </Alert>
                ) : null}
                {selectedRun.warnings?.length ? (
                  <Alert
                    status="warning"
                    borderRadius="md"
                    mt={selectedRun.errors?.length ? 3 : 0}
                  >
                    <AlertIcon />
                    <Box>
                      <AlertTitle>Archive run warnings (non-fatal)</AlertTitle>
                      <AlertDescription display="block">
                        {selectedRun.warnings
                          .slice(0, 5)
                          .map((message, index) => (
                            <Text key={index}>{message}</Text>
                          ))}
                        {selectedRun.warnings.length > 5 && (
                          <Text mt={2} fontStyle="italic">
                            And {selectedRun.warnings.length - 5} more
                            warnings.
                          </Text>
                        )}
                      </AlertDescription>
                    </Box>
                  </Alert>
                ) : null}
              </Box>
            ) : (
              <Text>No run selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onRunDetailsModalClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Delete Old Archived Sanity Data</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={3}>
              This will run a fresh archive pass first, then permanently
              delete Sanity documents that were already archived to MongoDB
              more than {ARCHIVE_DAYS} days ago (this is time since the
              document was copied to Mongo, not its original date).
              Documents become eligible for the Mongo copy almost as soon as
              they're finalized, so in practice this is roughly{" "}
              {ARCHIVE_DAYS} days after a document was finalized.
            </Text>
            <Text mb={3}>
              Documents that are still draft, pending approval, or otherwise
              in progress are never deleted, regardless of age — only ones
              marked completed (or cancelled) are eligible.
            </Text>
            <Text>
              This will also clean up old archive metadata records. This
              action cannot be undone.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorScheme="red"
              onClick={confirmDeleteOld}
              isLoading={isRunning && deleteOld}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Restore from Backup Modal */}
      <Modal
        isOpen={isRestoreModalOpen}
        onClose={onRestoreModalClose}
        isCentered
        size={{ base: "full", md: "xl" }}
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Restore from Backup</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing={4}>
              <Alert status="warning" borderRadius="md">
                <AlertIcon />
                <AlertDescription>
                  Restoring replaces the current contents of every archive
                  collection mentioned in the backup file with the file's
                  contents. This cannot be undone. Preview the diff below
                  before applying anything.
                </AlertDescription>
              </Alert>

              <FormControl>
                <FormLabel>Backup file (.json.enc)</FormLabel>
                <Input
                  type="file"
                  accept=".enc,.json,application/json"
                  onChange={handleRestoreFileChange}
                  isDisabled={restorePreviewInProgress || restoreApplyInProgress}
                />
              </FormControl>

              {restoreError ? (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  <AlertDescription>{restoreError}</AlertDescription>
                </Alert>
              ) : null}

              {restorePreview ? (
                <Box>
                  <Text fontWeight="medium" mb={2}>
                    Diff preview (nothing has been written yet):
                  </Text>
                  <Box overflowX="auto">
                    <Table size="sm">
                      <Thead>
                        <Tr>
                          <Th>Collection</Th>
                          <Th isNumeric>Added</Th>
                          <Th isNumeric>Removed</Th>
                          <Th isNumeric>Updated</Th>
                          <Th>Note</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {Object.entries(restorePreview.diff).map(
                          ([collName, d]) => (
                            <Tr key={collName}>
                              <Td>{collName}</Td>
                              <Td isNumeric>{d.added}</Td>
                              <Td isNumeric>{d.removed}</Td>
                              <Td isNumeric>{d.updated}</Td>
                              <Td>
                                {d.skippedNotInBackup ? (
                                  <Badge colorScheme="gray">
                                    not in backup — will be left untouched
                                  </Badge>
                                ) : d.removed > 0 ? (
                                  <Badge colorScheme="red">
                                    {d.removed} would be deleted
                                  </Badge>
                                ) : null}
                              </Td>
                            </Tr>
                          ),
                        )}
                      </Tbody>
                    </Table>
                  </Box>

                  <FormControl mt={4}>
                    <FormLabel>
                      Type {RESTORE_CONFIRM_PHRASE} to enable Apply Restore
                    </FormLabel>
                    <Input
                      value={restoreConfirmText}
                      onChange={(e) => setRestoreConfirmText(e.target.value)}
                      placeholder={RESTORE_CONFIRM_PHRASE}
                      isDisabled={restoreApplyInProgress}
                    />
                  </FormControl>
                </Box>
              ) : null}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={onRestoreModalClose}
              isDisabled={restorePreviewInProgress || restoreApplyInProgress}
            >
              Cancel
            </Button>
            {restorePreview ? (
              <Button
                colorScheme="red"
                onClick={handleApplyRestore}
                isLoading={restoreApplyInProgress}
                isDisabled={restoreConfirmText !== RESTORE_CONFIRM_PHRASE}
              >
                Apply Restore
              </Button>
            ) : (
              <Button
                colorScheme="orange"
                onClick={handlePreviewRestore}
                isLoading={restorePreviewInProgress}
                isDisabled={!restoreFile || restorePreviewInProgress}
              >
                Preview Restore
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
