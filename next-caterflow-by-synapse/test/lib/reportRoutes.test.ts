/**
 * @jest-environment node
 */
jest.mock("@/lib/siteFiltering", () => ({ getUserSiteInfo: jest.fn() }));
jest.mock("@/lib/reportData", () => ({
  loadLedgerDocs: jest.fn(),
  loadLiveInventoryValue: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/reportAnchors", () => ({
  getLatestAnchor: jest.fn(),
  listAnchors: jest.fn(),
  saveAnchor: jest.fn(),
  reopenAnchor: jest.fn(),
  toLedgerAnchor: (a: any) => ({ kind: a.kind, asOf: new Date(a.asOf), value: a.value, recordedAt: null }),
}));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET as financialsGET } from "@/app/api/reports/financials/route";
import { GET as closeGET, POST as closePOST } from "@/app/api/reports/period-close/route";
import { getUserSiteInfo } from "@/lib/siteFiltering";
import { loadLedgerDocs } from "@/lib/reportData";
import { getLatestAnchor, listAnchors, saveAnchor, reopenAnchor } from "@/lib/reportAnchors";
import { getServerSession } from "next-auth";

const docs = (over: any = {}) => ({
  receipts: [{ _id: "r", status: "completed", receiptDate: "2026-10-02T00:00:00Z", receivedItems: [{ receivedQuantity: 10, unitPrice: 10 }] }],
  dispatches: [{ _id: "d", status: "completed", evidenceStatus: "complete", dispatchDate: "2026-10-03T00:00:00Z", totalCost: 40, peopleFed: 5, totalSales: 100 }],
  counts: [], transfers: [], failed: [], ...over,
});
const admin = { userId: "u1", userRole: "admin", userSiteId: null, canAccessMultipleSites: true };
const req = (url: string, init?: any) => new Request(`http://x${url}`, init);

beforeEach(() => {
  jest.clearAllMocks();
  (getUserSiteInfo as jest.Mock).mockResolvedValue(admin);
  (loadLedgerDocs as jest.Mock).mockResolvedValue(docs());
  (getLatestAnchor as jest.Mock).mockResolvedValue(null);
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: "u1", role: "admin" } });
});

describe("GET /api/reports/financials", () => {
  it("returns the summary, previous period and anchor", async () => {
    const res = await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.financial.periodPurchases).toBe(100);
    expect(body.financial.periodConsumption).toBe(40);
    expect(body.financial.periodSales).toBe(100);
    expect(body.previous).toBeDefined();
    expect(body.anchor).toBeNull();
    expect(res.headers.get("Cache-Control")).toContain("max-age");
  });
  it("uses the latest period close as the opening", async () => {
    (getLatestAnchor as jest.Mock).mockResolvedValue({ _id: "a", kind: "close", asOf: "2026-10-01T00:00:00Z", value: 5000, recordedAt: "2026-10-01T00:00:00Z", periodKey: "2026-09" });
    const body = await (await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04"))).json();
    expect(body.financial.openingStock).toBe(5000);
    expect(body.anchor.periodKey).toBe("2026-09");
  });
  it("flags incomplete data when a source failed to load", async () => {
    (loadLedgerDocs as jest.Mock).mockResolvedValue(docs({ failed: ["dispatches"] }));
    const body = await (await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04"))).json();
    expect(body.integrity.some((i: any) => i.id === "load-failed")).toBe(true);
  });
  it("reports when closed periods cannot be read", async () => {
    (getLatestAnchor as jest.Mock).mockRejectedValue(new Error("mongo down"));
    const body = await (await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04"))).json();
    expect(body.integrity.some((i: any) => i.id === "anchors-unavailable")).toBe(true);
  });
  it("hides VAT from operational roles", async () => {
    (getUserSiteInfo as jest.Mock).mockResolvedValue({ ...admin, userRole: "dispatchStaff", canAccessMultipleSites: false, userSiteId: "s1" });
    const body = await (await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04&site=other"))).json();
    expect(body.financial.netVATPayable).toBeNull();
    expect(body.siteKey).toBe("s1"); // pinned to own site regardless of the query
    expect(loadLedgerDocs).toHaveBeenCalledWith("s1");
  });
  it("validates the dates and the session", async () => {
    expect((await financialsGET(req("/api/reports/financials?start=bad&end=2026-10-04"))).status).toBe(400);
    expect((await financialsGET(req("/api/reports/financials?start=2026-10-05&end=2026-10-01"))).status).toBe(400);
    (getUserSiteInfo as jest.Mock).mockRejectedValue(new Error("no"));
    expect((await financialsGET(req("/api/reports/financials?start=2026-10-01&end=2026-10-04"))).status).toBe(401);
  });
});

describe("/api/reports/period-close", () => {
  const post = (body: any) => closePOST(req("/api/reports/period-close", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

  it("lists anchors for finance roles only", async () => {
    (listAnchors as jest.Mock).mockResolvedValue([{ _id: "a" }]);
    expect((await (await closeGET(req("/api/reports/period-close"))).json()).anchors).toHaveLength(1);
    (getUserSiteInfo as jest.Mock).mockResolvedValue({ ...admin, userRole: "dispatchStaff" });
    expect((await closeGET(req("/api/reports/period-close"))).status).toBe(403);
  });

  it("only administrators can change anything", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: "u2", role: "siteManager" } });
    expect((await post({ action: "reopen", id: "x" })).status).toBe(403);
    (getServerSession as jest.Mock).mockResolvedValue(null);
    expect((await post({ action: "reopen", id: "x" })).status).toBe(401);
  });

  it("records an opening balance", async () => {
    const res = await post({ action: "opening-balance", asOf: "2026-01-01", value: 1500 });
    expect(res.status).toBe(200);
    expect((saveAnchor as jest.Mock).mock.calls[0][0]).toMatchObject({ kind: "opening-balance", value: 1500, siteKey: "all" });
  });

  it("rejects an invalid opening balance", async () => {
    expect((await post({ action: "opening-balance", asOf: "nope", value: 1 })).status).toBe(400);
    expect((await post({ action: "opening-balance", asOf: "2026-01-01", value: -5 })).status).toBe(400);
  });

  it("refuses to close when a source failed to load", async () => {
    (loadLedgerDocs as jest.Mock).mockResolvedValue(docs({ failed: ["goods receipts"] }));
    expect((await post({ action: "close", month: "2026-09" })).status).toBe(503);
    expect(saveAnchor).not.toHaveBeenCalled();
  });

  it("closes a finished month and stores its closing stock", async () => {
    (loadLedgerDocs as jest.Mock).mockResolvedValue(docs({
      receipts: [{ _id: "r", status: "completed", receiptDate: "2026-09-05T00:00:00Z", receivedItems: [{ receivedQuantity: 10, unitPrice: 10 }] }],
      dispatches: [],
    }));
    const res = await post({ action: "close", month: "2026-09" });
    expect(res.status).toBe(200);
    expect((saveAnchor as jest.Mock).mock.calls[0][0]).toMatchObject({ kind: "close", periodKey: "2026-09", value: 100 });
  });

  it("returns 409 with the findings when critical problems block a close", async () => {
    (loadLedgerDocs as jest.Mock).mockResolvedValue(docs({
      receipts: [],
      dispatches: [{ _id: "d", status: "completed", evidenceStatus: "complete", dispatchDate: "2026-09-05T00:00:00Z", totalCost: 40 }],
    }));
    const res = await post({ action: "close", month: "2026-09" });
    expect(res.status).toBe(409);
    expect((await res.json()).issues.length).toBeGreaterThan(0);
    expect(saveAnchor).not.toHaveBeenCalled();
    expect((await post({ action: "close", month: "2026-09", force: true })).status).toBe(200);
  });

  it("reopens, or 404s when nothing matches", async () => {
    (reopenAnchor as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await post({ action: "reopen", id: "a" })).status).toBe(200);
    expect((await post({ action: "reopen", id: "gone" })).status).toBe(404);
  });
});
