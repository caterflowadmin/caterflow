/**
 * @jest-environment node
 */
jest.mock("@/lib/mongoClient", () => ({ getArchiveDb: jest.fn() }));
import { getArchiveDb } from "@/lib/mongoClient";
import { getLatestAnchor, reopenAnchor, saveAnchor, listAnchors, toLedgerAnchor } from "@/lib/reportAnchors";

const setup = () => {
  const next = jest.fn().mockResolvedValue({ _id: "a" });
  const limit = jest.fn().mockReturnValue({ next });
  const toArray = jest.fn().mockResolvedValue([]);
  const sort = jest.fn().mockReturnValue({ limit, toArray });
  const find = jest.fn().mockReturnValue({ sort });
  const replaceOne = jest.fn().mockResolvedValue({});
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  (getArchiveDb as jest.Mock).mockResolvedValue({
    collection: jest.fn().mockReturnValue({ find, replaceOne, updateOne }),
  });
  return { find, sort, limit, replaceOne, updateOne };
};

describe("report anchors store", () => {
  it("finds the latest active anchor at or before a date, newest first", async () => {
    const { find, sort } = setup();
    const before = new Date("2026-10-01T00:00:00Z");
    await getLatestAnchor("all", before);
    const q = find.mock.calls[0][0];
    expect(q.siteKey).toBe("all");
    expect(q.asOf).toEqual({ $lte: before });
    expect(q.reopenedAt).toBeDefined(); // reopened anchors are ignored
    expect(sort).toHaveBeenCalledWith({ asOf: -1, recordedAt: -1 });
  });
  it("upserts by id and never deletes on reopen", async () => {
    const { replaceOne, updateOne } = setup();
    await saveAnchor({ _id: "x" } as any);
    expect(replaceOne).toHaveBeenCalledWith({ _id: "x" }, { _id: "x" }, { upsert: true });
    expect(await reopenAnchor("x", "u1", new Date("2026-10-04T00:00:00Z"))).toBe(true);
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({ reopenedBy: "u1" });
  });
  it("lists a site's anchors and maps them to ledger anchors", async () => {
    const { find } = setup();
    await listAnchors("s1");
    expect(find).toHaveBeenCalledWith({ siteKey: "s1" });
    const a = toLedgerAnchor({ kind: "close", asOf: "2026-10-01T00:00:00Z", value: 5, recordedAt: "2026-10-02T00:00:00Z" } as any);
    expect(a.asOf).toBeInstanceOf(Date);
    expect(a.recordedAt).toBeInstanceOf(Date);
  });
});
