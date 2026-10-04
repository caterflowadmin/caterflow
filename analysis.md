## 📊 **UPDATED SYSTEM DATA REPORT**

**Project**: Caterflow by Synapse (v3sfsmld)  
**Total Documents (estimated)**: ~12,448  
**Date**: March 31, 2026  
**Note**: `sanityLog` query returned no results, indicating those system logs have likely been removed.

---

### 📈 **DOCUMENT COUNT BY TYPE** (New vs Previous)

| Document Type | New Count | Previous Count | Change | % of Total |
|---------------|-----------|----------------|--------|------------|
| **FileAttachment** | 4,973 | 2,487 | +2,486 ▲ | 40.0% |
| **sanity.fileAsset** | 3,545 | 1,769 | +1,776 ▲ | 28.5% |
| **DispatchLog** | 1,644 | 848 | +796 ▲ | 13.2% |
| **PurchaseOrder** | 708 | 379 | +329 ▲ | 5.7% |
| **GoodsReceipt** | 683 | 364 | +319 ▲ | 5.5% |
| **StockItem** | 502 | 454 | +48 ▲ | 4.0% |
| **BinStock** | 180 | 180 | 0 | 1.4% |
| **InventoryCount** | 94 | 65 | +29 ▲ | 0.8% |
| **AppUser** | 32 | 30 | +2 ▲ | 0.3% |
| **DispatchType** | 20 | 17 | +3 ▲ | 0.2% |
| **Bin** | 18 | 18 | 0 | 0.1% |
| **Category** | 16 | 16 | 0 | 0.1% |
| **Supplier** | 13 | 13 | 0 | 0.1% |
| **StockAdjustment** | 9 | 9 | 0 | 0.1% |
| **Site** | 8 | 8 | 0 | 0.1% |
| **InternalTransfer** | 2 | 2 | 0 | 0.02% |
| **stockRegistry** | 1 | 1 | 0 | 0.01% |
| **sanityLog** | 0 | 4,942 | -4,942 ▼ | 0% |
| **Total** | **12,448** | **11,613** | **+835** | **100%** |

---

### 📂 **DATA CATEGORY SUMMARY**

| Category | Total Documents | % of Total | Change from Previous |
|----------|----------------|------------|----------------------|
| **Files & Assets** | 8,518 | 68.4% | +4,262 ▲ |
| **Transactions** | 3,139 | 25.2% | +1,472 ▲ |
| **Master Data** | 677 | 5.4% | -20 ▼ |
| **Inventory** | 181 | 1.5% | 0 |
| **Users** | 32 | 0.3% | +2 ▲ |
| **System Logs** | 0 | 0% | -4,942 ▼ |

---

### 🔍 **KEY OBSERVATIONS**

1. **Files & Assets now dominate** (68% of total) – `FileAttachment` and `sanity.fileAsset` have nearly doubled, likely due to uploads.
2. **Transaction volumes increased significantly** – DispatchLog, PurchaseOrder, GoodsReceipt all grew by 300–800 documents.
3. **System logs removed** – `sanityLog` went from 4,942 to 0, which freed up space but was offset by growth elsewhere.
4. **Overall total increased by 835 documents** – despite deleting all logs, the system is now at ~12,448 documents.

---

### ⚠️ **QUOTA STATUS**

- **CaterFlow's Sanity plan limit is 25,000 documents** (confirmed by Gee, 2026-10-04). This is not the public free-plan figure of 10,000, which an earlier version of this note wrongly assumed.
- At the time of this report (March 2026) the project held **~12,448 documents, about 50% of the 25,000 limit**, so it was not over quota.
- Headroom was about 12,500 documents. Re-measure before relying on this: transaction volume has grown since March (see the accuracy plan, section 0).
- Keep the archive and cleanup jobs running: the limit is enforced by Sanity, and a free-style plan blocks requests at the cap instead of billing the overage.

---

### 🗑️ **CLEANUP PRIORITIES**

| Priority | Action | Documents to Free | Impact |
|----------|--------|-------------------|--------|
| 1 | **Delete old/unused file attachments** – review files, especially large or duplicate uploads. | Up to 8,518 | 🔴 High |
| 2 | **Archive old transactions** – delete DispatchLogs, PurchaseOrders, GoodsReceipts older than 90 days. | ~1,000–2,000 | 🟡 Medium |
| 3 | **Remove duplicate BinStock records** – if each StockItem has multiple BinStock entries, consider consolidating. | Up to 180 | 🟢 Low |

---

### 📋 **NEXT STEPS**

1. **Inspect file attachments** – run this query to see when they were created and their sizes:
   ```bash
   npx sanity documents query '*[_type == "sanity.fileAsset"]{_createdAt, originalFilename, size} | order(_createdAt desc)[0..20]'
   ```

2. **Delete old transaction documents** (example for 90 days):
   ```bash
   npx sanity documents delete '*[_type == "DispatchLog" && _createdAt < now() - 60*60*24*90]'
   npx sanity documents delete '*[_type == "PurchaseOrder" && _createdAt < now() - 60*60*24*90]'
   npx sanity documents delete '*[_type == "GoodsReceipt" && _createdAt < now() - 60*60*24*90]'
   ```

3. **Consider upgrading to Growth plan** if you need to keep all data.

Would you like me to help you craft precise deletion queries for the largest categories?
