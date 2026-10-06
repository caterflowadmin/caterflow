/** @jest-environment node */
jest.mock("@/lib/sanity", () => ({ client: { fetch: jest.fn() }, writeClient: {} }));
jest.mock("next-sanity", () => ({
  groq: (s: TemplateStringsArray, ...v: any[]) => s.reduce((a, c, i) => a + c + (v[i] ?? ""), ""),
}));
jest.mock("@/lib/siteFiltering", () => ({
  getUserSiteInfo: jest.fn(),
  buildGoodsReceiptSiteFilter: jest.fn(() => ""),
}));
jest.mock("@/lib/archiveQueries", () => ({ getArchivedReceiptPrices: jest.fn() }));

import { client } from "@/lib/sanity";
import { getUserSiteInfo, buildGoodsReceiptSiteFilter } from "@/lib/siteFiltering";
import { getArchivedReceiptPrices } from "@/lib/archiveQueries";
import { POST } from "@/app/api/goods-receipts/recent-prices/route";

const post = (body: any) =>
  POST(new Request("http://x/api/goods-receipts/recent-prices", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  (getUserSiteInfo as jest.Mock).mockResolvedValue({ userSiteId: "s1", canAccessMultipleSites: true });
  (getArchivedReceiptPrices as jest.Mock).mockResolvedValue({});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("POST /api/goods-receipts/recent-prices", () => {
  it("returns the newest price per item (receipts arrive newest first)", async () => {
    (client.fetch as jest.Mock).mockResolvedValue([
      { items: [{ itemId: "a", unitPrice: 12 }, { itemId: "b", unitPrice: 5 }] },
      { items: [{ itemId: "a", unitPrice: 9 }] }, // older -> ignored for "a"
    ]);
    const res = await post({ binId: "bin1", itemIds: ["a", "b"] });
    expect(await res.json()).toEqual({ prices: { a: 12, b: 5 } });
    expect(getArchivedReceiptPrices).not.toHaveBeenCalled(); // everything resolved
  });

  it("falls back to the archive only for unresolved items", async () => {
    (client.fetch as jest.Mock).mockResolvedValue([{ items: [{ itemId: "a", unitPrice: 12 }] }]);
    (getArchivedReceiptPrices as jest.Mock).mockResolvedValue({ b: 3, a: 1 });
    const res = await post({ binId: "bin1", itemIds: ["a", "b"] });
    expect(await res.json()).toEqual({ prices: { a: 12, b: 3 } });
    expect((getArchivedReceiptPrices as jest.Mock).mock.calls[0][0]).toMatchObject({ itemIds: ["b"], binId: "bin1" });
  });

  it("still answers from recent receipts when the archive lookup fails", async () => {
    (client.fetch as jest.Mock).mockResolvedValue([{ items: [{ itemId: "a", unitPrice: 2 }] }]);
    (getArchivedReceiptPrices as jest.Mock).mockRejectedValue(new Error("mongo down"));
    const res = await post({ binId: "bin1", itemIds: ["a", "z"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prices: { a: 2 } });
  });

  it("returns empty prices without querying for empty input", async () => {
    const res = await post({ binId: "", itemIds: ["a"] });
    expect(await res.json()).toEqual({ prices: {} });
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it("applies the same site filter as the receipts list", async () => {
    (buildGoodsReceiptSiteFilter as jest.Mock).mockReturnValue('&& purchaseOrder->site._ref == "s1"');
    (client.fetch as jest.Mock).mockResolvedValue([]);
    await post({ binId: "bin1", itemIds: ["a"] });
    expect((client.fetch as jest.Mock).mock.calls[0][0]).toContain('purchaseOrder->site._ref == "s1"');
  });

  it("returns 401 when unauthenticated", async () => {
    (getUserSiteInfo as jest.Mock).mockRejectedValue(new Error("User not authenticated"));
    expect((await post({ binId: "bin1", itemIds: ["a"] })).status).toBe(401);
  });
});
