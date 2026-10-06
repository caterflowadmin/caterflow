// src/lib/fetchRecentThenArchive.ts
// Two-phase loader for list endpoints that merge live (Sanity) and archived
// (MongoDB) records. Phase 1 returns only the recent records so the page can
// render immediately; phase 2 quietly fetches the archive (`archived=only`)
// and re-emits the merged, date-sorted list. A newer call for the same URL
// supersedes any still-running phase 2 of an older call.
const latestCall = new Map<string, number>();

function withArchived(url: string, mode: 'false' | 'only') {
  return `${url}${url.includes('?') ? '&' : '?'}archived=${mode}`;
}

export async function fetchRecentThenArchive<T extends { _id?: string }>(
  url: string,
  opts: {
    /** Field used to sort the merged list, newest first. */
    dateField: keyof T & string;
    /** Called with the recent list, then again with recent + archived. */
    onData: (items: T[], phase: 'recent' | 'merged') => void;
  },
): Promise<T[]> {
  const callId = (latestCall.get(url) ?? 0) + 1;
  latestCall.set(url, callId);

  const res = await fetch(withArchived(url, 'false'));
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const recent: T[] = (await res.json()) || [];
  if (latestCall.get(url) === callId) opts.onData(recent, 'recent');

  // Phase 2 runs in the background; the caller's await resolves after phase 1.
  void (async () => {
    try {
      const archivedRes = await fetch(withArchived(url, 'only'));
      if (!archivedRes.ok) return;
      const archived: T[] = (await archivedRes.json()) || [];
      if (archived.length === 0 || latestCall.get(url) !== callId) return;

      const seen = new Set(recent.map((r) => r._id));
      const merged = [...recent, ...archived.filter((a) => !seen.has(a._id))].sort(
        (a, b) =>
          new Date((b as any)[opts.dateField] ?? 0).getTime() -
          new Date((a as any)[opts.dateField] ?? 0).getTime(),
      );
      opts.onData(merged, 'merged');
    } catch {
      // The archive is a progressive enhancement; the recent list is already shown.
    }
  })();

  return recent;
}
