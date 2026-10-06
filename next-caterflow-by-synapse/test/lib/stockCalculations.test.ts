// Unit tests for the three stock-calculation code paths that had
// inconsistent negative-stock handling (see stockCalculations.ts). All three
// now allow stock to go negative rather than clamping to 0, and all three
// warn when it happens — these tests lock that consistency in as a
// regression guard. No live Sanity/Mongo connection is ever made.

jest.mock("@/lib/sanity", () => ({
  client: { fetch: jest.fn() },
  writeClient: {},
}));

jest.mock("next-sanity", () => ({
  groq: (strings: TemplateStringsArray, ...values: any[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), ""),
}));

// stockCalculations.ts pulls in @/app/actions/archiveActions for archived
// transaction history, which transitively imports @/lib/mongoClient (and,
// through it, the mongodb driver's ESM-only bson dependency, which Jest
// can't parse). None of that is needed for these tests, so stub it —
// "no archived transactions" for every case.
jest.mock("@/app/actions/archiveActions", () => ({
  fetchArchivedTransactions: jest.fn().mockResolvedValue([]),
  fetchLatestStockBaseline: jest.fn().mockResolvedValue(null),
}));

import { client } from "@/lib/sanity";
import {
  calculateStockFromTransactions,
  calculateStockForBin,
  calculateStockExactLogic,
} from "@/lib/stockCalculations";

const mockFetch = client.fetch as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("calculateStockFromTransactions", () => {
  it("accumulates receipts and dispatches within available stock", async () => {
    mockFetch.mockResolvedValue({
      allEvents: [
        {
          _type: "GoodsReceipt",
          date: "2026-01-01",
          receivedItems: [{ itemId: "item1", quantity: 10 }],
        },
        {
          _type: "DispatchLog",
          date: "2026-01-02",
          dispatchedItems: [{ itemId: "item1", quantity: 4 }],
        },
      ],
    });

    const result = await calculateStockFromTransactions(
      "item1",
      "bin1",
      false,
    );

    expect(result).toBe(6);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("allows negative stock when a dispatch exceeds available stock, and warns", async () => {
    mockFetch.mockResolvedValue({
      allEvents: [
        {
          _type: "GoodsReceipt",
          date: "2026-01-01",
          receivedItems: [{ itemId: "item1", quantity: 5 }],
        },
        {
          _type: "DispatchLog",
          date: "2026-01-02",
          dispatchedItems: [{ itemId: "item1", quantity: 8 }],
        },
      ],
    });

    const result = await calculateStockFromTransactions(
      "item1",
      "bin1",
      false,
    );

    expect(result).toBe(-3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Dispatch exceeds available stock"),
    );
  });
});

describe("calculateStockForBin", () => {
  function mockBinData(overrides: Record<string, any> = {}) {
    mockFetch.mockResolvedValue({
      goodsReceipts: [],
      dispatches: [],
      transfersOut: [],
      transfersIn: [],
      inventoryCounts: [],
      itemDetails: [],
      ...overrides,
    });
  }

  it("accumulates receipts and dispatches within available stock", async () => {
    mockBinData({
      goodsReceipts: [
        {
          receiptDate: "2026-01-01",
          receivedItems: [{ itemId: "item1", receivedQuantity: 10 }],
        },
      ],
      dispatches: [
        {
          dispatchDate: "2026-01-02",
          dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 4 }],
        },
      ],
    });

    const result = await calculateStockForBin("binA", ["item1"]);

    expect(result["item1-binA"]).toBe(6);
  });

  it("allows negative stock when a dispatch exceeds available stock", async () => {
    mockBinData({
      goodsReceipts: [
        {
          receiptDate: "2026-01-01",
          receivedItems: [{ itemId: "item1", receivedQuantity: 5 }],
        },
      ],
      dispatches: [
        {
          dispatchDate: "2026-01-02",
          dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 8 }],
        },
      ],
    });

    const result = await calculateStockForBin("binB", ["item1"]);

    expect(result["item1-binB"]).toBe(-3);
  });

  it("resets to the counted quantity at an inventory count", async () => {
    mockBinData({
      goodsReceipts: [
        {
          receiptDate: "2026-01-01",
          receivedItems: [{ itemId: "item1", receivedQuantity: 10 }],
        },
      ],
      inventoryCounts: [
        {
          countDate: "2026-01-05",
          countedItems: [{ itemId: "item1", countedQuantity: 2 }],
        },
      ],
      dispatches: [
        {
          dispatchDate: "2026-01-06",
          dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 1 }],
        },
      ],
    });

    const result = await calculateStockForBin("binC", ["item1"]);

    // The count on 01-05 resets the baseline to 2, ignoring the earlier
    // receipt; the 01-06 dispatch then applies on top of that.
    expect(result["item1-binC"]).toBe(1);
  });
});

describe("calculateStockExactLogic", () => {
  it("accumulates receipts and dispatches with no prior count", async () => {
    mockFetch
      .mockResolvedValueOnce([]) // countQuery: no inventory counts
      .mockResolvedValueOnce({
        receipts: [
          {
            receiptDate: "2026-01-01",
            receivedItems: [{ itemId: "item1", receivedQuantity: 10 }],
          },
        ],
        dispatches: [
          {
            dispatchDate: "2026-01-02",
            dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 4 }],
          },
        ],
        transfersIn: [],
        transfersOut: [],
      });

    const result = await calculateStockExactLogic("item1", "bin1", false);

    expect(result).toBe(6);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("allows negative stock when a dispatch exceeds available stock, and warns", async () => {
    mockFetch
      .mockResolvedValueOnce([]) // countQuery: no inventory counts
      .mockResolvedValueOnce({
        receipts: [
          {
            receiptDate: "2026-01-01",
            receivedItems: [{ itemId: "item1", receivedQuantity: 5 }],
          },
        ],
        dispatches: [
          {
            dispatchDate: "2026-01-02",
            dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 8 }],
          },
        ],
        transfersIn: [],
        transfersOut: [],
      });

    const result = await calculateStockExactLogic("item1", "bin1", false);

    expect(result).toBe(-3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("exceeds available stock"),
    );
  });

  it("starts from the latest inventory count for this item", async () => {
    mockFetch
      .mockResolvedValueOnce([
        {
          _id: "count-1",
          countDate: "2026-01-05",
          countNumber: "IC-1",
          countedItems: [{ itemId: "item1", countedQuantity: 20 }],
        },
      ])
      .mockResolvedValueOnce({
        receipts: [],
        dispatches: [
          {
            dispatchDate: "2026-01-06",
            dispatchedItems: [{ itemId: "item1", dispatchedQuantity: 5 }],
          },
        ],
        transfersIn: [],
        transfersOut: [],
      });

    const result = await calculateStockExactLogic("item1", "bin1", false);

    expect(result).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// calculateBulkStock: registry-backed reads + bounded backfill
// ---------------------------------------------------------------------------
import { calculateBulkStock } from "@/lib/stockCalculations";
import { invalidateRegistryMap } from "@/lib/cache";

describe("calculateBulkStock", () => {
  beforeEach(() => invalidateRegistryMap());

  it("serves known pairs from the registry without replaying transactions", async () => {
    mockFetch.mockResolvedValue({
      stockData: {
        items: [{ stockItemId: "i1", binQuantities: { bins: [{ binId: "b1", quantity: 7 }] } }],
      },
    });
    const res = await calculateBulkStock(["i1"], ["b1"]);
    expect(res).toEqual({ "i1-b1": 7 });
    expect(mockFetch).toHaveBeenCalledTimes(1); // just the registry
  });

  it("does not mutate the caller's id arrays", async () => {
    mockFetch.mockResolvedValue({
      stockData: { items: [{ stockItemId: "z", binQuantities: { bins: [{ binId: "b", quantity: 1 }] } }] },
    });
    const items = ["z", "a"];
    const bins = ["b"];
    await calculateBulkStock(items, bins);
    expect(items).toEqual(["z", "a"]);
  });

  it("returns zeros (and never creates a registry) when the registry read fails", async () => {
    mockFetch.mockRejectedValue(new Error("timeout"));
    const res = await calculateBulkStock(["i1"], ["b1"]);
    expect(res).toEqual({ "i1-b1": 0 });
  });
});
