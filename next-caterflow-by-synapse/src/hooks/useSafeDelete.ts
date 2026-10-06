import { logger } from '@/lib/logger';
// src/hooks/useSafeDelete.ts
// React hook for safe deletion with automatic backup enforcement
// Ensures a recent backup exists before allowing Sanity data deletion

import { useState, useCallback } from "react";

export interface BackupStatus {
  hasRecentBackup: boolean;
  lastBackupTime: string | null;
  minutesSinceLastBackup: number;
  requiresBackupBeforeDelete: boolean;
  message: string;
}

export interface SafeDeleteResponse {
  success: boolean;
  canProceed: boolean;
  backup: BackupStatus;
  archiveRunId?: string;
  message: string;
  documentIds: string[];
  documentType: string;
  timestamp?: string;
  nextStep?: string;
}

export interface SafeDeleteCheckResponse {
  success: boolean;
  canDelete: boolean;
  backup: BackupStatus;
  timestamp: string;
}

export interface UseSafeDeleteOptions {
  onBackupTriggered?: (archiveRunId: string) => void;
  onDeleteBlocked?: (reason: string) => void;
  verbose?: boolean;
}

/**
 * Hook for safe deletion with automatic backup enforcement
 *
 * Usage:
 * const { checkBackupStatus, prepareSafeDeletion, isLoading, error } = useSafeDelete();
 *
 * // Check if safe to delete
 * const status = await checkBackupStatus();
 * if (status.canDelete) {
 *   // Safe to delete
 * }
 *
 * // Prepare deletion (auto-triggers backup if needed)
 * const result = await prepareSafeDeletion(
 *   ["doc-id-1", "doc-id-2"],
 *   "bin",
 *   "user cleanup"
 * );
 * if (result.canProceed) {
 *   // Now proceed with actual deletion
 * }
 */
export function useSafeDelete(options: UseSafeDeleteOptions = {}) {
  const { onBackupTriggered, onDeleteBlocked, verbose = false } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<SafeDeleteResponse | null>(
    null,
  );

  const log = useCallback(
    (message: string) => {
      if (verbose) {
        logger.debug(`[useSafeDelete] ${message}`);
      }
    },
    [verbose],
  );

  /**
   * Check backup status without modifying anything
   */
  const checkBackupStatus =
    useCallback(async (): Promise<SafeDeleteCheckResponse | null> => {
      try {
        setIsLoading(true);
        setError(null);
        log("Checking backup status...");

        const response = await fetch("/api/archive/safe-delete", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message ||
              `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data: SafeDeleteCheckResponse = await response.json();
        log(
          `Backup status: ${data.canDelete ? "Safe to delete" : "Backup required"}`,
        );
        return data;
      } catch (err: any) {
        const errorMsg = err?.message || "Failed to check backup status";
        setError(errorMsg);
        log(`❌ Error: ${errorMsg}`);
        return null;
      } finally {
        setIsLoading(false);
      }
    }, [log]);

  /**
   * Prepare safe deletion (enforces backup check, auto-triggers archive if needed)
   */
  const prepareSafeDeletion = useCallback(
    async (
      documentIds: string[],
      documentType: string = "unknown",
      reason: string = "user-initiated",
    ): Promise<SafeDeleteResponse | null> => {
      try {
        setIsLoading(true);
        setError(null);

        if (!Array.isArray(documentIds) || documentIds.length === 0) {
          throw new Error("documentIds must be a non-empty array");
        }

        log(
          `Preparing safe deletion of ${documentIds.length} ${documentType} document(s)`,
        );
        log(`Reason: ${reason}`);

        const response = await fetch("/api/archive/safe-delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentIds,
            documentType,
            reason,
            deleteNow: false,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          const errorMsg =
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText}`;

          if (response.status === 409) {
            // Precondition not met - backup required
            log(`❌ Deletion blocked: ${errorMsg}`);
            onDeleteBlocked?.(errorMsg);
          } else {
            log(`❌ Error: ${errorMsg}`);
          }

          throw new Error(errorMsg);
        }

        const data: SafeDeleteResponse = await response.json();
        setLastResponse(data);

        if (data.canProceed) {
          log(`✅ ${data.message}`);
          if (data.archiveRunId) {
            log(`Archive triggered with ID: ${data.archiveRunId}`);
            onBackupTriggered?.(data.archiveRunId);
          }
        } else {
          log(`❌ Deletion blocked: ${data.message}`);
          onDeleteBlocked?.(data.message);
        }

        return data;
      } catch (err: any) {
        const errorMsg = err?.message || "Failed to prepare safe deletion";
        setError(errorMsg);
        log(`❌ Error: ${errorMsg}`);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [log, onBackupTriggered, onDeleteBlocked],
  );

  /**
   * Get status of the last safe delete check
   */
  const getLastResponse = useCallback(() => lastResponse, [lastResponse]);

  /**
   * Get the backup status from the last response
   */
  const getLastBackupStatus = useCallback(
    (): BackupStatus | null => lastResponse?.backup || null,
    [lastResponse],
  );

  /**
   * Check if a recent backup exists
   */
  const hasRecentBackup = useCallback(
    (): boolean => lastResponse?.backup?.hasRecentBackup ?? false,
    [lastResponse],
  );

  /**
   * Get minutes since last backup
   */
  const minutesSinceBackup = useCallback(
    (): number => lastResponse?.backup?.minutesSinceLastBackup ?? Infinity,
    [lastResponse],
  );

  return {
    // Methods
    checkBackupStatus,
    prepareSafeDeletion,
    getLastResponse,
    getLastBackupStatus,
    hasRecentBackup,
    minutesSinceBackup,

    // State
    isLoading,
    error,
    lastResponse,
  };
}

/**
 * Standalone function to check if safe to delete
 * Use this if you don't need the full hook
 */
export async function checkIfSafeToDelete(): Promise<SafeDeleteCheckResponse | null> {
  try {
    const response = await fetch("/api/archive/safe-delete", {
      method: "GET",
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * Standalone function to prepare safe deletion
 * Use this if you don't need the full hook
 */
export async function prepareSafeDeletion(
  documentIds: string[],
  documentType: string = "unknown",
  reason: string = "user-initiated",
): Promise<SafeDeleteResponse | null> {
  try {
    const response = await fetch("/api/archive/safe-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentIds,
        documentType,
        reason,
        deleteNow: false,
      }),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
