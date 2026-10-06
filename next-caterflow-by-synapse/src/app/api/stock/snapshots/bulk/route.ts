import { logger } from '@/lib/logger';
// src/app/api/stock/snapshots/bulk/route.ts
import { NextResponse } from "next/server";
import { client } from "@/lib/sanity";
import { groq } from "next-sanity";

export async function POST(request: Request) {
  try {
    const { stockItemIds, binIds } = await request.json();

    if (
      !stockItemIds ||
      !binIds ||
      stockItemIds.length === 0 ||
      binIds.length === 0
    ) {
      return NextResponse.json(
        {
          error: "Missing stockItemIds or binIds",
        },
        { status: 400 },
      );
    }

    logger.debug(
      `📊 API: Requested ${stockItemIds.length} items, ${binIds.length} bins`,
    );

    const totalCombinations = stockItemIds.length * binIds.length;
    if (totalCombinations > 5000) {
      console.warn(
        `⚠️ Large snapshot request: ${totalCombinations} combinations requested. Processing safely.`,
      );
    }

    // Get from single registry document
    const query = groq`*[_type == "stockRegistry"][0] {
			_id,
			lastUpdated,
			stockData
		}`;

    const registry = await client.fetch(query);

    // 🚨 CRITICAL FIX: Check if registry exists
    if (!registry) {
      logger.debug("⚠️ No registry found - returning all zeros");

      // Return all zeros
      const results: { [key: string]: number } = {};
      for (const binId of binIds) {
        for (const itemId of stockItemIds) {
          results[`${itemId}-${binId}`] = 0;
        }
      }

      return NextResponse.json({
        snapshots: results,
        missingCount: totalCombinations, // All are "missing" because no registry
        totalCount: totalCombinations,
        hasAllSnapshots: false,
        existingSnapshots: 0,
        registryExists: false,
      });
    }

    logger.debug(
      `✅ Registry found: ${registry._id}, last updated: ${registry.lastUpdated}`,
    );

    const results: { [key: string]: number } = {};
    let foundInRegistry = 0;

    // Fill in from registry if data exists
    if (registry?.stockData?.items) {
      logger.debug(`📋 Registry has ${registry.stockData.items.length} items`);

      // Create lookup map for faster access
      const registryMap = new Map<string, number>();
      registry.stockData.items.forEach((item: any) => {
        if (item.stockItemId && item.binQuantities?.bins) {
          item.binQuantities.bins.forEach((bin: any) => {
            if (bin.binId) {
              const key = `${item.stockItemId}-${bin.binId}`;
              registryMap.set(key, bin.quantity || 0);
            }
          });
        }
      });

      // Only return combinations that actually exist in the registry
      registryMap.forEach((quantity, key) => {
        results[key] = quantity;
        foundInRegistry++;
      });
    } else {
      logger.debug("⚠️ Registry has no stockData items");
    }

    const missingFromRegistry = totalCombinations - foundInRegistry;
    logger.debug(
      `✅ API: ${foundInRegistry} found in registry, ${missingFromRegistry} not in registry of ${totalCombinations} requested`,
    );

    return NextResponse.json({
      snapshots: results,
      missingCount: missingFromRegistry, // Only count items NOT IN REGISTRY
      totalCount: totalCombinations,
      hasAllSnapshots: missingFromRegistry === 0,
      existingSnapshots: foundInRegistry,
      registryExists: true,
      registryId: registry._id,
      registryLastUpdated: registry.lastUpdated,
      // Add summary
      summary: {
        itemsWithStock: Object.values(results).filter((qty) => qty > 0).length,
        itemsWithZeroStock: Object.values(results).filter((qty) => qty === 0)
          .length,
        itemsMissingFromRegistry: missingFromRegistry,
      },
    });
  } catch (error: any) {
    console.error("❌ Error in bulk snapshots API:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch snapshots",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
