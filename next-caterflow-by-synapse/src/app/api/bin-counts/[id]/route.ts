import { logger } from '@/lib/logger';
// src/app/api/bin-counts/[id]/route.ts
import { NextResponse } from "next/server";
import { client, writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { logSanityInteraction } from "@/lib/sanityLogger";
import { updateStockForTransaction } from "@/lib/stockCalculations";
import { getArchivedBinCountById } from "@/lib/archiveQueries";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    const query = groq`*[_type == "InventoryCount" && _id == $id][0] {
          _id,
          countNumber,
          countDate,
          status,
          notes,
          "bin": bin->{
              _id,
              name,
              "site": site->{
                  _id,
                  name
              }
          },
          "countedBy": countedBy->{
              _id,
              name
          },
          "countedItems": countedItems[]{
              _key,
              "stockItem": stockItem->{
                  _id,
                  name,
                  sku,
                  unitPrice
              },
              countedQuantity,
              systemQuantityAtCountTime,
              variance
          }
      }`;

    let binCount = await client.fetch(query, { id });

    if (!binCount) {
      const archived = await getArchivedBinCountById(id);
      if (!archived) {
        return NextResponse.json(
          { error: "Bin count not found" },
          { status: 404 },
        );
      }
      binCount = {
        ...archived,
        _id: archived._sanityId || archived._id?.toString(),
        _isArchived: true,
      };
    }

    return NextResponse.json(binCount);
  } catch (error) {
    console.error("Failed to fetch bin count:", error);
    return NextResponse.json(
      { error: "Failed to fetch bin count" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const updateData = await request.json();

    // Add this at the beginning of the PUT function, after getting the updateData:
    // Fetch existing doc to check if we need to revert stock changes
    const existingCount = await client.fetch(
      groq`*[_type == "InventoryCount" && _id == $id][0] { 
    status
}`,
      { id: id },
    );

    const wasCompleted = existingCount?.status === "completed";
    const willBeCompleted =
      updateData.status === "completed" || (!updateData.status && wasCompleted);

    /*    if (wasCompleted && (updateData.countedItems || updateData.bin)) {
          logger.debug('↩️ Reverting previous stock changes for count edit');
          await revertPreviousStockChanges(id);
        }*/

    const result = await writeClient.patch(id).set(updateData).commit();

    // ✅ KEEP ONLY ONE: Check actual result status
    if (result.status === "completed") {
      await updateStockForTransaction("inventoryCount", result._id);
    }

    await logSanityInteraction(
      "update",
      `Updated bin count: ${id}`,
      "InventoryCount",
      id,
      "system",
      true,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to update bin count:", error);
    return NextResponse.json(
      { error: "Failed to update bin count" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    await writeClient.delete(id);

    await logSanityInteraction(
      "delete",
      `Deleted bin count: ${id}`,
      "InventoryCount",
      id,
      "system",
      true,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete bin count:", error);
    return NextResponse.json(
      { error: "Failed to delete bin count" },
      { status: 500 },
    );
  }
}
