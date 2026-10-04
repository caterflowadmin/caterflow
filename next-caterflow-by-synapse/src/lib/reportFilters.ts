// src/lib/reportFilters.ts
// Site scoping for report data. Shared by the reports page and the server-side
// financials endpoint so both include exactly the same documents.

export type ReportItemType =
  | "purchaseOrder"
  | "goodsReceipt"
  | "dispatch"
  | "transfer"
  | "binCount"
  | "stockItem"
  | "supplier"
  | "user";

const sameSite = (ref: any, siteId: string): boolean =>
  !!ref && (ref._id === siteId || ref === siteId);

export function filterDataBySite<T extends any[]>(
  data: T,
  siteId: string | null | undefined,
  itemType: ReportItemType,
): T {
  if (!siteId || siteId === "all" || !data || !Array.isArray(data)) {
    return data;
  }

  return data.filter((item: any) => {
    try {
      switch (itemType) {
        case "purchaseOrder":
          return sameSite(item.site, siteId);

        case "goodsReceipt":
          // PO site, document-level receiving bin, or any item-level bin
          return (
            sameSite(item.purchaseOrder?.site, siteId) ||
            sameSite(item.receivingBin?.site, siteId) ||
            !!item.receivedItems?.some((ri: any) =>
              sameSite(ri.receivingBin?.site, siteId),
            )
          );

        case "dispatch":
          // Current structure stamps `sourceSite` on the dispatch and the
          // item bins are optional, so check it first; older documents only
          // carry bin -> site.
          return (
            sameSite(item.sourceSite, siteId) ||
            sameSite(item.sourceBin?.site, siteId) ||
            !!item.dispatchedItems?.some((di: any) =>
              sameSite(di.sourceBin?.site, siteId),
            )
          );

        case "transfer":
          return (
            sameSite(item.fromBin?.site, siteId) ||
            sameSite(item.toBin?.site, siteId)
          );

        case "binCount":
          return sameSite(item.bin?.site, siteId);

        case "stockItem":
          if (item.site?._id) return item.site._id === siteId;
          if (item.bins) {
            return item.bins.some((b: any) => sameSite(b.site, siteId));
          }
          // No site info on the item: keep it and let the per-site stock
          // calculation decide the quantity.
          return true;

        case "supplier":
          return true;

        case "user":
          return sameSite(item.associatedSite, siteId);

        default:
          return true;
      }
    } catch {
      return false;
    }
  }) as T;
}
