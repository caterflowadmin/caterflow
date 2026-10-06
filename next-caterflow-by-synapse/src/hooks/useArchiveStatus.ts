"use client";

import { useState, useEffect } from "react";

export interface ArchiveSummary {
  recentRuns: any[];
  count: number;
}

declare global {
  interface Window {
    __ARCHIVE_STATUS__?: ArchiveSummary | null;
  }
}

// Simple hook that fetches /api/archive/status and caches in window for reuse
export function useArchiveStatus(pollMs: number | null = 60_000) {
  const [data, setData] = useState<ArchiveSummary | null>(
    typeof window !== "undefined" ? window.__ARCHIVE_STATUS__ || null : null,
  );
  const [loading, setLoading] = useState(!data);

  useEffect(() => {
    let mounted = true;

    async function fetchStatus() {
      setLoading(true);
      try {
        const res = await fetch("/api/archive/status");
        if (!res.ok) throw new Error("Failed to fetch archive status");
        const json = await res.json();
        if (!mounted) return;
        setData(json);
        if (typeof window !== "undefined") window.__ARCHIVE_STATUS__ = json;
      } catch (err) {
        console.error("Failed to fetch archive status:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchStatus();
    // Don't poll while the tab is hidden; catch up as soon as it is visible again.
    const poll = () => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    let id: any = null;
    if (pollMs) {
      id = setInterval(poll, pollMs);
      document.addEventListener("visibilitychange", poll);
    }
    return () => {
      mounted = false;
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [pollMs]);

  return { data, loading };
}
