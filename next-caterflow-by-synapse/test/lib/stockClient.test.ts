import { fetchBulkStock, fetchBinStock } from '@/lib/stockClient';

describe('stockClient', () => {
  const calls: { stockItemIds: string[]; binIds: string[] }[] = [];

  beforeEach(() => {
    calls.length = 0;
    (global as any).fetch = jest.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const results: Record<string, number> = {};
      for (const b of body.binIds) for (const i of body.stockItemIds) results[`${i}-${b}`] = 2;
      return { ok: true, status: 200, json: async () => ({ results }) };
    });
  });

  it('returns {} without calling the server for empty input', async () => {
    expect(await fetchBulkStock([], ['b1'])).toEqual({});
    expect(await fetchBulkStock(['i1'], [])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('splits large item lists into chunks and merges results', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `i${i}`);
    const progress: number[] = [];
    const out = await fetchBulkStock(ids, ['b1'], (p) => progress.push(p.percentage));
    expect(calls).toHaveLength(3);
    expect(Object.keys(out)).toHaveLength(600);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('throws when the server rejects the request', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchBulkStock(['i1'], ['b1'])).rejects.toThrow('500');
  });

  it('fetchBinStock maps results by item id with 0 for missing', async () => {
    (global as any).fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ results: { 'i1-b1': 5 } }),
    }));
    expect(await fetchBinStock(['i1', 'i2'], 'b1')).toEqual({ i1: { quantity: 5 }, i2: { quantity: 0 } });
  });
});
