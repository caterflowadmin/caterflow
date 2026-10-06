import { fetchRecentThenArchive } from "@/lib/fetchRecentThenArchive";

const json = (body: any, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);

afterEach(() => jest.restoreAllMocks());

describe("fetchRecentThenArchive", () => {
  it("emits recent first, then a merged, date-sorted, de-duplicated list", async () => {
    const calls: string[] = [];
    jest.spyOn(global, "fetch").mockImplementation(((url: string) => {
      calls.push(url);
      if (url.endsWith("archived=false")) return json([{ _id: "a", d: "2026-03-01" }]);
      return json([{ _id: "a", d: "stale" }, { _id: "b", d: "2025-01-01" }]);
    }) as any);

    const seen: Array<[string[], string]> = [];
    const recent = await fetchRecentThenArchive<any>("/api/x", {
      dateField: "d",
      onData: (items, phase) => seen.push([items.map((i) => i._id), phase]),
    });
    expect(recent).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toEqual(["/api/x?archived=false", "/api/x?archived=only"]);
    expect(seen).toEqual([[["a"], "recent"], [["a", "b"], "merged"]]);
  });

  it("throws when the recent request fails, ignores archive failures", async () => {
    jest.spyOn(global, "fetch").mockImplementation((() => json({}, false)) as any);
    await expect(
      fetchRecentThenArchive<any>("/api/y", { dateField: "d", onData: () => {} }),
    ).rejects.toThrow();
  });

  it("a newer call supersedes an older call's archive phase", async () => {
    let resolveFirstArchive!: (v: any) => void;
    let n = 0;
    jest.spyOn(global, "fetch").mockImplementation(((url: string) => {
      if (url.endsWith("archived=false")) return json([{ _id: `r${++n}`, d: "2026-01-01" }]);
      if (n === 1) return new Promise((r) => (resolveFirstArchive = r));
      return json([]);
    }) as any);
    const emitted: string[] = [];
    await fetchRecentThenArchive<any>("/api/z", { dateField: "d", onData: (_i, p) => emitted.push(`1:${p}`) });
    await fetchRecentThenArchive<any>("/api/z", { dateField: "d", onData: (_i, p) => emitted.push(`2:${p}`) });
    resolveFirstArchive({ ok: true, json: () => Promise.resolve([{ _id: "old", d: "2020-01-01" }]) });
    await new Promise((r) => setTimeout(r, 5));
    expect(emitted).toEqual(["1:recent", "2:recent"]);
  });
});
