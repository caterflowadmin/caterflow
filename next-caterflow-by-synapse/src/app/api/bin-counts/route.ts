// src/app/api/bin-counts/route.ts
import { NextResponse } from "next/server";
import { client, writeClient } from "@/lib/sanity";
import { groq } from "next-sanity";
import { logSanityInteraction } from "@/lib/sanityLogger";
import { getUserSiteInfo, buildBinSiteFilter } from "@/lib/siteFiltering";
import {
  updateStockForTransaction,
  calculateStock,
} from "@/lib/stockCalculations";
import { getArchivedBinCounts } from "@/lib/archiveQueries";
import { mergeById } from "@/lib/financialReport";

const getCurrentStockForItem = async (
  stockItemId: string,
  binId: string,
): Promise<number> => {
  try {
    const stockResult = await calculateStock(stockItemId, binId);
    return stockResult.quantity || 0;
  } catch (error) {
    console.error(
      `Error calculating stock for ${stockItemId} in ${binId}:`,
      error,
    );
    return 0;
  }
};

export async function GET() {
  try {
    console.log("🔍 Starting bin counts fetch...");
    const userSiteInfo = await getUserSiteInfo();
    console.log("👤 User site info:", userSiteInfo);

    const siteFilter = buildBinSiteFilter(userSiteInfo);
    console.log("🎯 Site filter:", siteFilter);

    // Fixed GROQ query with proper field paths
    const query = groq`*[_type == "InventoryCount" ${siteFilter}] | order(countDate desc) {
            _id,
            countNumber,
            countDate,
            status,
            notes,
            totalVariance,
            totalVarianceCost,
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
                    unitPrice, // ADD THIS LINE
                    unitOfMeasure,
                    "category": category->{
                        _id,
                        title
                    }
                },
                countedQuantity,
                systemQuantityAtCountTime,
                variance,
                varianceCost,
                unitPrice
            }
        }`;

    console.log("📊 Executing GROQ query...");
    const binCounts = await client.fetch(query);
    console.log("✅ Found bin counts:", binCounts?.length || 0);

    const countsWithTotals = binCounts.map((count: any) => {
      const totalItems = count.countedItems?.length || 0;

      // Use stored totals if available, otherwise calculate
      const totalVariance =
        count.totalVariance !== undefined
          ? count.totalVariance
          : count.countedItems?.reduce(
              (sum: number, item: any) => sum + (item.variance || 0),
              0,
            ) || 0;

      const totalVarianceCost =
        count.totalVarianceCost !== undefined
          ? count.totalVarianceCost
          : count.countedItems?.reduce((sum: number, item: any) => {
              // Use stored varianceCost if available
              if (item.varianceCost !== undefined) {
                return sum + (item.varianceCost || 0);
              }
              // Calculate from variance and unitPrice
              const variance = item.variance || 0;
              const unitPrice =
                item.unitPrice ?? item.stockItem?.unitPrice ?? 0;
              return sum + variance * unitPrice;
            }, 0) || 0;

      return {
        ...count,
        totalItems,
        totalVariance,
        totalVarianceCost,
      };
    });

    // ── Fetch archived bin counts from MongoDB ──
    let archivedCounts: any[] = [];
    try {
        const raw = await getArchivedBinCounts({
            userSiteId: userSiteInfo.userSiteId,
            canAccessMultipleSites: userSiteInfo.canAccessMultipleSites,
        });
        archivedCounts = raw.map(c => ({
            ...c,
            _id: c._sanityId || c._id?.toString(),
            _isArchived: true,
            totalItems: c.countedItems?.length || 0,
        }));
    } catch (mongoErr) {
        console.warn('⚠️  Could not fetch archived bin counts from MongoDB:', mongoErr);
    }

    // Merge: Sanity (recent) + MongoDB (archived), sorted by date descending
    const merged = mergeById(countsWithTotals, archivedCounts).sort(
        (a, b) => new Date(b.countDate).getTime() - new Date(a.countDate).getTime()
    );

    console.log("📦 Returning counts with totals");
    return NextResponse.json(merged);
  } catch (error) {
    console.error("❌ Failed to fetch bin counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch bin counts" },
      { status: 500 },
    );
  }
}

// In src/app/api/bin-counts/route.ts, update the getNextCountNumber function:
const getNextCountNumber = async (): Promise<string> => {
  try {
    const query = groq`*[_type == "InventoryCount"] | order(countNumber desc)[0].countNumber`;
    const lastCountNumber = await client.fetch(query);

    if (!lastCountNumber) {
      return "BC-00001"; // First count
    }

    // Extract the numeric part from the count number (e.g., "BC-00023" -> 23)
    const match = lastCountNumber.match(/BC-(\d+)/);
    if (!match) {
      return "BC-00001"; // Fallback if format is unexpected
    }

    const lastNumber = parseInt(match[1], 10);
    const nextNumber = lastNumber + 1;
    return `BC-${String(nextNumber).padStart(5, "0")}`;
  } catch (error) {
    console.error("Error generating count number:", error);
    // Fallback: generate a timestamp-based ID
    return `BC-${Date.now().toString().slice(-5)}`;
  }
};

// Add this function to generate bin count numbers
const getNextBinCountNumber = async (): Promise<string> => {
  try {
    // Get all bin count numbers and find the maximum
    const query = groq`*[_type == "InventoryCount"].countNumber`;
    const allCountNumbers = await client.fetch(query);

    let maxNumber = 0;

    if (allCountNumbers && allCountNumbers.length > 0) {
      allCountNumbers.forEach((countNumber: string) => {
        if (countNumber && countNumber.startsWith("BC-")) {
          const numberPart = countNumber.split("-")[1];
          const currentNumber = parseInt(numberPart);
          if (!isNaN(currentNumber) && currentNumber > maxNumber) {
            maxNumber = currentNumber;
          }
        }
      });
    }

    // Generate the next number
    const nextNumber = maxNumber + 1;
    const newCountNumber = `BC-${String(nextNumber).padStart(5, "0")}`;

    // Double-check this number doesn't already exist
    const checkQuery = groq`count(*[_type == "InventoryCount" && countNumber == $newNumber])`;
    const existingCount = await client.fetch(checkQuery, {
      newNumber: newCountNumber,
    });

    if (existingCount > 0) {
      // If it exists, try the next number
      return `BC-${String(nextNumber + 1).padStart(5, "0")}`;
    }

    return newCountNumber;
  } catch (error) {
    console.error("Error generating bin count number:", error);
    // Fallback with timestamp to ensure uniqueness
    const timestamp = new Date().getTime();
    return `BC-${String(timestamp).slice(-5)}`;
  }
};

// src/app/api/bin-counts/route.ts
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { _id, ...updateData } = body;

    // Validate that a bin is provided
    if (!updateData.bin) {
      return NextResponse.json({ error: "Bin is required" }, { status: 400 });
    }

    // In the PUT function, update the countedItems processing:
    let countedItems;
    if (updateData.countedItems) {
      countedItems = updateData.countedItems.map((item: any) => {
        console.log("Processing counted item for PUT:", item);
        return {
          _type: "CountedItem",
          _key: item._key,
          stockItem: {
            _type: "reference",
            _ref: item.stockItem,
          },
          countedQuantity: item.countedQuantity,
          systemQuantityAtCountTime: item.systemQuantityAtCountTime,
          variance: item.variance || 0,
          varianceCost: item.varianceCost || 0, // ADD THIS
          unitPrice: item.unitPrice || 0, // ADD THIS
        };
      });
      delete updateData.countedItems;
    }

    // Also include totalVarianceCost in the patch
    let patch = writeClient.patch(_id).set({
      ...updateData,
      ...(countedItems && { countedItems }),
      totalVariance: updateData.totalVariance || 0,
      totalVarianceCost: updateData.totalVarianceCost || 0, // ADD THIS
    });

    // Always set the bin reference
    patch = patch.set({
      bin: {
        _type: "reference",
        _ref: updateData.bin,
      },
    });

    if (updateData.countedBy) {
      patch = patch.set({
        countedBy: {
          _type: "reference",
          _ref: updateData.countedBy,
        },
      });
    }

    // Add this at the beginning of the PUT function, after getting the updateData:
    // Fetch existing doc to check if we need to revert stock changes
    const existingCount = await client.fetch(
      groq`*[_type == "InventoryCount" && _id == $id][0] { 
        status
    }`,
      { id: _id },
    );

    // If count was completed and is being edited, revert previous stock changes
    const wasCompleted = existingCount?.status === "completed";
    const willBeCompleted =
      updateData.status === "completed" || (!updateData.status && wasCompleted);

    /*        if (wasCompleted && (updateData.countedItems || updateData.bin)) {
                    console.log('↩️ Reverting previous stock changes for count edit');
                    await revertPreviousStockChanges(_id);
                }
        */
    const result = await patch.commit();

    // ✅ KEEP ONLY ONE: Check actual result status
    if (result.status === "completed") {
      await updateStockForTransaction("inventoryCount", result._id);
    }

    await logSanityInteraction(
      "update",
      `Updated bin count: ${updateData.countNumber || _id}`,
      "InventoryCount",
      _id,
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

export async function POST(request: Request) {
  try {
    console.log("📝 Starting bin count creation...");
    const newBinCount = await request.json();
    console.log("📦 Received payload:", JSON.stringify(newBinCount, null, 2));

    // Use the count number generator
    const countNumber = await getNextBinCountNumber();
    console.log("🔢 Generated count number:", countNumber);

    // Validate that a bin is provided
    if (!newBinCount.bin) {
      console.error("❌ Missing bin in payload");
      return NextResponse.json({ error: "Bin is required" }, { status: 400 });
    }

    // Process countedItems correctly
    // In the POST function, update the countedItems processing:
    const countedItems =
      newBinCount.countedItems?.map((item: any, index: number) => {
        console.log(`📊 Processing counted item ${index + 1}:`, item);

        // Validate item structure
        if (!item.stockItem) {
          console.error(`❌ Missing stockItem in item ${index + 1}:`, item);
          throw new Error(`Item ${index + 1} is missing stockItem`);
        }

        return {
          _type: "CountedItem",
          _key: item._key || `item-${index}`,
          stockItem: {
            _type: "reference",
            _ref: item.stockItem,
          },
          countedQuantity: item.countedQuantity || 0,
          systemQuantityAtCountTime: item.systemQuantityAtCountTime || 0,
          variance: item.variance || 0,
          varianceCost: item.varianceCost || 0, // ADD THIS
          unitPrice: item.unitPrice || 0, // ADD THIS
        };
      }) || [];

    // Create the document with totalVarianceCost
    const doc = {
      _type: "InventoryCount",
      ...newBinCount,
      countNumber,
      status: newBinCount.status || "draft",
      countDate: newBinCount.countDate || new Date().toISOString(),
      bin: {
        _type: "reference",
        _ref: newBinCount.bin,
      },
      ...(newBinCount.countedBy && {
        countedBy: {
          _type: "reference",
          _ref: newBinCount.countedBy,
        },
      }),
      countedItems: countedItems,
      totalVariance: newBinCount.totalVariance || 0,
      totalVarianceCost: newBinCount.totalVarianceCost || 0, // ADD THIS
    };

    console.log(`✅ Processed ${countedItems.length} counted items`);

    console.log("📄 Creating document:", JSON.stringify(doc, null, 2));

    const result = await writeClient.create(doc);
    console.log("✅ Bin count created:", result._id);

    // Update stock calculations
    if (result.status === "completed") {
      console.log("📊 Updating stock for completed count...");
      await updateStockForTransaction("inventoryCount", result._id);
    }

    await logSanityInteraction(
      "create",
      `Created new bin count: ${countNumber}`,
      "InventoryCount",
      result._id,
      "system",
      true,
    );

    console.log("🎉 Bin count creation complete");
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("❌ Failed to create new bin count:", error);
    console.error("Error stack:", error.stack);
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      cause: error.cause,
    });

    return NextResponse.json(
      {
        error: "Failed to create new bin count",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Bin count ID is required" },
        { status: 400 },
      );
    }

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
