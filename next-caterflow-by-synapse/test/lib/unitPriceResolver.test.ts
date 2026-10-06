import { getRecentUnitPricesForItemsInBin, getRecentUnitPriceForItemInBin, resolveUnitPrice } from "@/lib/unitPriceResolver";

const ok = (body: any) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
afterEach(() => jest.restoreAllMocks());

describe("unitPriceResolver", () => {
  it("asks the server for just the needed prices (not the whole receipt list)", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation((() => ok({ prices: { a: 4 } })) as any);
    const prices = await getRecentUnitPricesForItemsInBin(["a", "b"], "bin1");
    expect(prices).toEqual({ a: 4 });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/goods-receipts/recent-prices");
    expect(JSON.parse(init.body as string)).toEqual({ binId: "bin1", itemIds: ["a", "b"] });
  });

  it("skips the request for empty input and degrades to {} on failure", async () => {
    const spy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await getRecentUnitPricesForItemsInBin([], "bin1")).toEqual({});
    expect(spy).not.toHaveBeenCalled();
    expect(await getRecentUnitPricesForItemsInBin(["a"], "bin1")).toEqual({});
  });

  it("single-item helper falls back to the provided price", async () => {
    jest.spyOn(global, "fetch").mockImplementation((() => ok({ prices: {} })) as any);
    expect(await getRecentUnitPriceForItemInBin("a", "bin1", 7)).toBe(7);
  });

  it("resolveUnitPrice allows zero as a valid price", () => {
    expect(resolveUnitPrice(0, 5)).toBe(0);
    expect(resolveUnitPrice(undefined, 5)).toBe(5);
    expect(resolveUnitPrice(undefined, undefined, 2)).toBe(2);
  });
});
