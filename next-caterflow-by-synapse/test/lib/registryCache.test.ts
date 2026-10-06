import {
  getRegistryMap,
  invalidateRegistryMap,
  invalidateStockCache,
  clearStockCache,
} from "@/lib/cache";

const registry = (qty: number) => ({
  stockData: { items: [{ stockItemId: "i1", binQuantities: { bins: [{ binId: "b1", quantity: qty }] } }] },
});

beforeEach(() => invalidateRegistryMap());

describe("getRegistryMap", () => {
  it("parses once and serves later calls from cache", async () => {
    const fetcher = jest.fn().mockResolvedValue(registry(5));
    const a = await getRegistryMap(fetcher);
    const b = await getRegistryMap(fetcher);
    expect(a?.get("i1-b1")).toBe(5);
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight fetch between concurrent callers", async () => {
    const fetcher = jest.fn().mockImplementation(
      () => new Promise((r) => setTimeout(() => r(registry(1)), 10)),
    );
    const [a, b] = await Promise.all([getRegistryMap(fetcher), getRegistryMap(fetcher)]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no registry document", async () => {
    expect(await getRegistryMap(async () => null)).toBeNull();
  });

  it.each([
    ["invalidateStockCache", () => invalidateStockCache("i1")],
    ["clearStockCache", () => clearStockCache()],
    ["invalidateRegistryMap", () => invalidateRegistryMap()],
  ])("refetches after %s", async (_n, invalidate) => {
    const fetcher = jest.fn().mockResolvedValueOnce(registry(1)).mockResolvedValueOnce(registry(2));
    expect((await getRegistryMap(fetcher))?.get("i1-b1")).toBe(1);
    invalidate();
    expect((await getRegistryMap(fetcher))?.get("i1-b1")).toBe(2);
  });

  it("does not cache a result that was invalidated while fetching", async () => {
    let release!: (v: any) => void;
    const slow = jest.fn().mockImplementationOnce(() => new Promise((r) => (release = r)));
    const p = getRegistryMap(slow);
    invalidateRegistryMap(); // a write lands mid-fetch
    release(registry(1));
    await p;
    const fresh = jest.fn().mockResolvedValue(registry(9));
    expect((await getRegistryMap(fresh))?.get("i1-b1")).toBe(9);
  });
});
