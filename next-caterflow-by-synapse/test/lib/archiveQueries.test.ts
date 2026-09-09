// Regression test for a real bug found live: getRecentArchiveRuns() only
// excluded the archive engine's live-progress singleton (kind: "progress"),
// not the cleanup engine's equivalent (kind: "cleanup-progress"). That doc
// is the SAME one document being upserted in place while a cleanup runs —
// not a completed run record — so it leaked into "history" as a duplicate,
// constantly-mutating row, and (since its kind isn't exactly "cleanup")
// rendered as an "Archive" run in the admin UI instead of "Delete".

jest.mock("@/lib/mongoClient", () => ({
  getArchiveDb: jest.fn(),
  COLLECTIONS: {
    ARCHIVE_RUNS: "archive_runs",
  },
}));

import { getRecentArchiveRuns } from "@/lib/archiveQueries";
import { getArchiveDb } from "@/lib/mongoClient";

describe("getRecentArchiveRuns", () => {
  it("excludes both the archive and cleanup live-progress singleton docs", async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const db = { collection: jest.fn().mockReturnValue({ find }) } as any;
    (getArchiveDb as jest.Mock).mockResolvedValue(db);

    await getRecentArchiveRuns(10);

    const query = find.mock.calls[0][0];
    expect(query.kind.$nin).toEqual(
      expect.arrayContaining(["progress", "cleanup-progress"]),
    );
  });
});
