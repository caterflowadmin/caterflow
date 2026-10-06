import { cachedFetch, invalidateClientCache } from "@/lib/clientCache";

const ok = (body: any, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => invalidateClientCache());
afterEach(() => jest.restoreAllMocks());

describe("cachedFetch", () => {
  it("reuses a successful response and de-duplicates concurrent calls", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation((() => ok([1, 2])) as any);
    const [a, b] = await Promise.all([cachedFetch("/api/sites"), cachedFetch("/api/sites")]);
    expect(await a.json()).toEqual([1, 2]);
    expect(await b.json()).toEqual([1, 2]);
    await cachedFetch("/api/sites");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cache error responses", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation((() => ok({ error: "x" }, 500)) as any);
    const r = await cachedFetch("/api/bins");
    expect(r.ok).toBe(false);
    await cachedFetch("/api/bins");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("refetches after invalidation", async () => {
    const spy = jest.spyOn(global, "fetch").mockImplementation((() => ok([])) as any);
    await cachedFetch("/api/suppliers");
    invalidateClientCache();
    await cachedFetch("/api/suppliers");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
