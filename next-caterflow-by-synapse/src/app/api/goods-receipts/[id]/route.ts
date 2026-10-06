import { logger } from '@/lib/logger';
// src/app/api/goods-receipts/[id]/route.ts
import { client, writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logSanityInteraction } from "@/lib/sanityLogger";
import { NextResponse } from "next/server";
import { updateStockForTransaction } from "@/lib/stockCalculations";
import { v4 as uuidv4 } from "uuid";
import {
  getUserSiteInfo,
  buildGoodsReceiptSiteFilter,
} from "@/lib/siteFiltering";
import { getArchivedGoodsReceiptById } from "@/lib/archiveQueries";

// Helper function to extract supplier names
const extractSupplierNames = (orderedItems: any[]): string => {
  if (!orderedItems || orderedItems.length === 0) return "No suppliers";

  const supplierNames = orderedItems
    .map((item: any) => item.supplier?.name)
    .filter((name: string | undefined) => name && name.trim() !== "");

  const uniqueSupplierNames = [...new Set(supplierNames)];

  if (uniqueSupplierNames.length === 0) return "No suppliers";
  if (uniqueSupplierNames.length <= 2) return uniqueSupplierNames.join(", ");

  return `${uniqueSupplierNames.slice(0, 2).join(", ")} +${uniqueSupplierNames.length - 2} more`;
};

// Helper to normalize references
const resolveRef = (val: any): string | null => {
  if (!val && val !== 0) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    if (typeof val._ref === "string") return val._ref;
    if (typeof val._id === "string") return val._id;
  }
  return null;
};

// GET function - Fetch goods receipt with item-level bins
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userSiteInfo = await getUserSiteInfo();
    const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

    logger.debug(
      `🔍 Getting individual goods receipt ${id} with site filter:`,
      siteFilter,
    );

    if (!id) {
      return NextResponse.json(
        { error: "Goods receipt ID is required" },
        { status: 400 },
      );
    }

    const query = groq`*[_type == "GoodsReceipt" && _id == $id ${siteFilter}][0] {
            _id,
            _type,
            receiptNumber,
            receiptDate,
            status,
            evidenceStatus,
            notes,
            createdAt,
            updatedAt,
            completedAt,
            purchaseOrder->{
                _id,
                poNumber,
                status,
                orderDate,
                supplier->{
                    _id,
                    name,
                    contactPerson,
                    phoneNumber,
                    email
                },
                site->{
                    _id,
                    name,
                    location,
                    contactNumber
                },
                orderedItems[] {
                    _key,
                    orderedQuantity,
                    unitPrice,
                    stockItem->{
                        _id,
                        name,
                        sku,
                        unitOfMeasure
                    },
                    supplier->{
                        _id,
                        name,
                        contactPerson,
                        phoneNumber,
                        email
                    }
                }
            },
            // Document-level receivingBin (legacy support)
            receivingBin->{
                _id,
                name,
                binType,
                site->{
                    _id,
                    name
                }
            },
            receivedItems[] {
                _key,
                stockItem->{
                    _id,
                    name,
                    sku,
                    unitOfMeasure,
                    unitPrice
                },
                orderedQuantity,
                receivedQuantity,
                totalPrice,
                unitPrice,
                condition,
                batchNumber,
                expiryDate,
                // ✅ Item-level receiving bin
                receivingBin->{
                    _id,
                    name,
                    binType,
                    site->{
                        _id,
                        name
                    }
                }
            },
            attachments[]->{
                _id,
                fileName,
                fileType,
                description,
                uploadedAt,
                "file": file{
                    "asset": asset->{
                        _id,
                        _type,
                        url,
                        originalFilename,
                        mimeType
                    }
                }
            }
        }`;

    let goodsReceipt = await client.fetch(query, { id });

    if (!goodsReceipt) {
      logger.debug(
        `❌ Goods receipt ${id} not found or user doesn't have access`,
      );
      const archived = await getArchivedGoodsReceiptById(id);
      if (!archived) {
        return NextResponse.json(
          { error: "Goods receipt not found or you do not have access" },
          { status: 404 },
        );
      }
      goodsReceipt = {
        ...archived,
        _id: archived._sanityId || archived._id?.toString(),
        _isArchived: true,
      };
    }

    logger.debug(
      `✅ Found goods receipt ${goodsReceipt.receiptNumber} for user`,
    );

    // Extract supplier names from purchase order's ordered items
    const supplierNames = goodsReceipt.purchaseOrder?.orderedItems
      ? extractSupplierNames(goodsReceipt.purchaseOrder.orderedItems)
      : "No suppliers";

    // Transform old receipts to include item-level bins if missing
    if (
      goodsReceipt.receivingBin &&
      !goodsReceipt.receivedItems?.every((item: any) => item.receivingBin)
    ) {
      logger.debug(
        `🔄 Transforming old receipt ${goodsReceipt.receiptNumber} to item-level bin structure`,
      );
      goodsReceipt.receivedItems = (goodsReceipt.receivedItems || []).map(
        (item: any) => ({
          ...item,
          receivingBin: item.receivingBin || goodsReceipt.receivingBin,
        }),
      );
    }

    const processedReceipt = {
      ...goodsReceipt,
      supplierNames,
    };

    return NextResponse.json(processedReceipt);
  } catch (error: any) {
    console.error("Error fetching goods receipt:", error);
    return NextResponse.json(
      { error: "Failed to fetch goods receipt", details: error.message },
      { status: 500 },
    );
  }
}

// PUT function - Update goods receipt with item-level bins
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Goods receipt ID is required" },
        { status: 400 },
      );
    }

    // First check if user has access to this receipt
    const userSiteInfo = await getUserSiteInfo();
    const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

    const accessCheck = await client.fetch(
      groq`count(*[_type == "GoodsReceipt" && _id == $id ${siteFilter}])`,
      { id },
    );

    if (accessCheck === 0) {
      return NextResponse.json(
        { error: "Goods receipt not found or you do not have access" },
        { status: 404 },
      );
    }

    const updateData = await request.json();

    logger.debug("🔄 PUT goods receipt update:", {
      id,
      status: updateData.status,
      receivedItemsCount: updateData.receivedItems?.length || 0,
    });

    // Get existing receipt to check previous status
    const existingReceipt = await client.fetch(
      groq`*[_type == "GoodsReceipt" && _id == $id][0] { 
                status,
                receiptNumber,
                evidenceStatus,
                "receivedItems": receivedItems[]{
                    "hasBin": defined(receivingBin._ref),
                    "quantity": receivedQuantity
                }
            }`,
      { id },
    );

    if (!existingReceipt) {
      return NextResponse.json(
        { error: "Goods receipt not found" },
        { status: 400 },
      );
    }

    const wasCompleted = existingReceipt?.status === "completed";
    const willBeCompleted = updateData.status === "completed";
    const isStatusChangeToCompleted = !wasCompleted && willBeCompleted;

    // Validate before completing: all items with quantity must have bins
    if (isStatusChangeToCompleted) {
      const itemsWithoutBins = (updateData.receivedItems || []).filter(
        (item: any) => item.receivedQuantity > 0 && !item.receivingBin,
      );

      if (itemsWithoutBins.length > 0) {
        return NextResponse.json(
          {
            error:
              "Cannot complete goods receipt: Some items with quantity are missing receiving bins",
            details: `${itemsWithoutBins.length} items with quantity need bins assigned`,
          },
          { status: 400 },
        );
      }
    }

    // Process receivedItems to include receivingBin references
    let processedReceivedItems;
    if (updateData.receivedItems) {
      logger.debug(
        "📦 Processing received items for bins:",
        updateData.receivedItems.length,
      );

      processedReceivedItems = (updateData.receivedItems || []).map(
        (item: any) => {
          const processedItem: any = {
            _type: "ReceivedItem",
            _key: item._key || uuidv4(),
            stockItem: {
              _type: "reference",
              _ref:
                resolveRef(item.stockItem) ||
                resolveRef(item.stockItem?._id) ||
                null,
            },
            orderedQuantity: Number(item.orderedQuantity) || 0,
            receivedQuantity: Number(item.receivedQuantity) || 0,
            totalPrice: Number(item.totalPrice) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            condition: item.condition || "good",
            batchNumber: item.batchNumber || "",
            expiryDate: item.expiryDate || "",
          };

          // ADD RECEIVING BIN AT ITEM LEVEL
          if (item.receivingBin) {
            const binRef =
              resolveRef(item.receivingBin) ||
              resolveRef(item.receivingBin?._id);
            if (binRef) {
              processedItem.receivingBin = {
                _type: "reference",
                _ref: binRef,
              };
              logger.debug(`   Item has bin: ${binRef}`);
            }
          } else {
            logger.debug("   Item missing bin");
          }

          return processedItem;
        },
      );

      logger.debug(
        `✅ Processed ${processedReceivedItems.length} items, ${processedReceivedItems.filter((item: any) => item.receivingBin).length} with bins`,
      );
    }

    // Create patch with processed items
    const patchData: any = {
      updatedAt: new Date().toISOString(),
    };

    // Copy simple fields
    if (updateData.receiptDate) patchData.receiptDate = updateData.receiptDate;
    if (updateData.status) patchData.status = updateData.status;
    if (updateData.evidenceStatus !== undefined)
      patchData.evidenceStatus = updateData.evidenceStatus;
    if (updateData.notes !== undefined) patchData.notes = updateData.notes;
    if (updateData.completedAt) patchData.completedAt = updateData.completedAt;

    // Add processed items if they exist
    if (processedReceivedItems) {
      patchData.receivedItems = processedReceivedItems;
    }

    // Handle purchase order reference
    if (updateData.purchaseOrder) {
      const poRef = resolveRef(updateData.purchaseOrder);
      if (poRef) {
        patchData.purchaseOrder = {
          _type: "reference",
          _ref: poRef,
        };
      }
    }

    // Handle document-level receivingBin (optional, for legacy)
    if (updateData.receivingBin) {
      const binRef = resolveRef(updateData.receivingBin);
      if (binRef) {
        patchData.receivingBin = {
          _type: "reference",
          _ref: binRef,
        };
      }
    }

    // Handle attachments
    if (updateData.attachments) {
      patchData.attachments = updateData.attachments;
    }

    logger.debug("📝 Patch data:", {
      itemCount: patchData.receivedItems?.length || 0,
      status: patchData.status,
      itemsWithBins:
        processedReceivedItems?.filter((item: any) => item.receivingBin)
          .length || 0,
    });

    // Apply the patch
    const patch = writeClient.patch(id).set(patchData);
    const result = await patch.commit();

    // Update stock if status changed TO 'completed'
    if (patchData.status === "completed") {
      logger.debug(
        "📦 Updating stock for status change to completed:",
        existingReceipt.receiptNumber,
      );
      await updateStockForTransaction("procurement", id);
    }

    await logSanityInteraction(
      "update",
      `Updated goods receipt: ${existingReceipt.receiptNumber || id} with ${processedReceivedItems?.length || 0} items`,
      "GoodsReceipt",
      id,
      session.user.email || "system",
      true,
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Failed to update goods receipt:", error);
    return NextResponse.json(
      { error: "Failed to update goods receipt", details: error.message },
      { status: 500 },
    );
  }
}

// DELETE function
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 },
      );
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Goods receipt ID is required" },
        { status: 400 },
      );
    }

    // Check if user has access to this receipt
    const userSiteInfo = await getUserSiteInfo();
    const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

    const accessCheck = await client.fetch(
      groq`count(*[_type == "GoodsReceipt" && _id == $id ${siteFilter}])`,
      { id },
    );

    if (accessCheck === 0) {
      return NextResponse.json(
        { error: "Goods receipt not found or you do not have access" },
        { status: 404 },
      );
    }

    // Check if receipt is completed before deletion
    const existingReceipt = await client.fetch(
      groq`*[_type == "GoodsReceipt" && _id == $id][0] { 
                status 
            }`,
      { id },
    );

    if (existingReceipt?.status === "completed") {
      return NextResponse.json(
        { error: "Completed goods receipt cannot be deleted" },
        { status: 400 },
      );
    }

    const result = await writeClient.delete(id);

    await logSanityInteraction(
      "delete",
      `Deleted goods receipt: ${id}`,
      "GoodsReceipt",
      id,
      session.user.email || "system",
      true,
    );

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("Failed to delete goods receipt:", error);
    return NextResponse.json(
      { error: "Failed to delete goods receipt", details: error.message },
      { status: 500 },
    );
  }
}
