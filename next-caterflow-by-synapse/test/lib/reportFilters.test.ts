import { filterDataBySite } from "@/lib/reportFilters";

describe("filterDataBySite", () => {
  it("returns everything for the all-sites view", () => {
    const data = [{ a: 1 }];
    expect(filterDataBySite(data, null, "dispatch")).toBe(data);
    expect(filterDataBySite(data, "all", "dispatch")).toBe(data);
  });

  it("keeps dispatches that only carry sourceSite (items have no bin)", () => {
    const d = [
      { _id: "1", sourceSite: { _id: "s1" }, dispatchedItems: [{}] },
      { _id: "2", sourceSite: { _id: "s2" }, dispatchedItems: [{}] },
    ];
    expect(filterDataBySite(d, "s1", "dispatch").map((x: any) => x._id)).toEqual(["1"]);
  });

  it("still matches legacy dispatches by bin site", () => {
    const d = [{ _id: "1", dispatchedItems: [{ sourceBin: { site: { _id: "s1" } } }] }];
    expect(filterDataBySite(d, "s1", "dispatch")).toHaveLength(1);
  });

  it("matches receipts by item-level bin site", () => {
    const r = [{ receivedItems: [{ receivingBin: { site: { _id: "s1" } } }] }, { receivedItems: [] }];
    expect(filterDataBySite(r, "s1", "goodsReceipt")).toHaveLength(1);
  });

  it("matches counts and transfers", () => {
    expect(filterDataBySite([{ bin: { site: { _id: "s1" } } }], "s1", "binCount")).toHaveLength(1);
    expect(
      filterDataBySite([{ fromBin: { site: { _id: "s2" } }, toBin: { site: { _id: "s1" } } }], "s1", "transfer"),
    ).toHaveLength(1);
  });
});
