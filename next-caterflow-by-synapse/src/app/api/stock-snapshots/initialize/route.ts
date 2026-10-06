import { logger } from '@/lib/logger';
// src/app/api/stock-snapshots/initialize/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function POST(request: Request) {
	try {
		logger.debug('🏁 Initializing stock snapshots via API...');

		// Get all stock items and bins
		const [stockItems, bins] = await Promise.all([
			client.fetch(groq`*[_type == "StockItem"] { _id, name }`),
			client.fetch(groq`*[_type == "Bin"] { _id, name }`)
		]);

		const stockItemIds = stockItems.map((item: any) => item._id);
		const binIds = bins.map((bin: any) => bin._id);

		logger.debug(`📊 Found ${stockItems.length} stock items and ${bins.length} bins`);

		let successCount = 0;
		let errorCount = 0;
		const errors: string[] = [];

		// Process each combination
		for (const binId of binIds) {
			for (const itemId of stockItemIds) {
				try {
					// Calculate stock from transactions
					const stock = await calculateStockFromTransactions(itemId, binId);

					// Check if snapshot already exists
					const existingSnapshot = await client.fetch(
						groq`*[_type == "stockSnapshot" && stockItem._ref == $itemId && bin._ref == $binId][0]`,
						{ itemId, binId }
					);

					const now = new Date().toISOString();

					if (existingSnapshot) {
						// Update existing snapshot
						await writeClient
							.patch(existingSnapshot._id)
							.set({
								quantity: stock,
								lastUpdated: now,
								transactionType: 'inventoryCount',
								transactionId: null
							})
							.commit();
					} else {
						// Create new snapshot
						await writeClient.create({
							_type: 'stockSnapshot',
							stockItem: {
								_type: 'reference',
								_ref: itemId,
							},
							bin: {
								_type: 'reference',
								_ref: binId,
							},
							quantity: stock,
							lastUpdated: now,
							transactionType: 'inventoryCount',
							transactionId: null
						});
					}

					successCount++;

					if (successCount % 50 === 0) {
						logger.debug(`  Created ${successCount} snapshots...`);
					}
				} catch (error: any) {
					errorCount++;
					errors.push(`Error for item ${itemId} in bin ${binId}: ${error.message}`);
					console.error(`❌ Error creating snapshot for ${itemId}-${binId}:`, error.message);
				}
			}
		}

		logger.debug(`✅ Initialization complete: ${successCount} created, ${errorCount} errors`);

		return NextResponse.json({
			success: true,
			message: `Initialized stock snapshots`,
			stats: {
				totalItems: stockItems.length,
				totalBins: bins.length,
				totalCombinations: stockItems.length * bins.length,
				created: successCount,
				errors: errorCount
			},
			errors: errors.length > 0 ? errors.slice(0, 5) : [] // Return first 5 errors
		});
	} catch (error: any) {
		console.error('❌ Error initializing snapshots:', error);
		return NextResponse.json(
			{
				error: 'Failed to initialize snapshots',
				details: error.message
			},
			{ status: 500 }
		);
	}
}

// Calculate stock from transactions (for initial snapshot or validation)
const calculateStockFromTransactions = async (stockItemId: string, binId: string): Promise<number> => {
	try {
		logger.debug(`🧮 Calculating stock for ${stockItemId} in ${binId} from transactions`);

		const query = groq`{
      "goodsReceipts": *[
        _type == "GoodsReceipt" && 
        receivingBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(receiptDate asc) {
        receiptDate,
        receivedItems[] {
          "itemId": stockItem._ref,
          receivedQuantity
        }
      },
      
      "dispatches": *[
        _type == "DispatchLog" && 
        sourceBin._ref == $binId &&
        status in ["completed", "processed"]
      ] | order(dispatchDate asc) {
        dispatchDate,
        dispatchedItems[] {
          "itemId": stockItem._ref,
          dispatchedQuantity
        }
      },
      
      "transfersOut": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        fromBin._ref == $binId
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "transfersIn": *[
        _type == "InternalTransfer" && 
        status == "completed" && 
        toBin._ref == $binId
      ] | order(transferDate asc) {
        transferDate,
        transferredItems[] {
          "itemId": stockItem._ref,
          transferredQuantity
        }
      },
      
      "lastCount": *[
        _type == "InventoryCount" && 
        bin._ref == $binId &&
        status == "completed"
      ] | order(countDate desc)[0] {
        countDate,
        countedItems[] {
          "itemId": stockItem._ref,
          countedQuantity
        }
      }
    }`;

		const data = await client.fetch(query, { binId, stockItemId });

		let stock = 0;

		// Process goods receipts
		data.goodsReceipts?.forEach((receipt: any) => {
			receipt.receivedItems?.forEach((item: any) => {
				if (item.itemId === stockItemId) {
					stock += item.receivedQuantity || 0;
				}
			});
		});

		// Process dispatches
		data.dispatches?.forEach((dispatch: any) => {
			dispatch.dispatchedItems?.forEach((item: any) => {
				if (item.itemId === stockItemId) {
					stock -= item.dispatchedQuantity || 0;
				}
			});
		});

		// Process transfers out
		data.transfersOut?.forEach((transfer: any) => {
			transfer.transferredItems?.forEach((item: any) => {
				if (item.itemId === stockItemId) {
					stock -= item.transferredQuantity || 0;
				}
			});
		});

		// Process transfers in
		data.transfersIn?.forEach((transfer: any) => {
			transfer.transferredItems?.forEach((item: any) => {
				if (item.itemId === stockItemId) {
					stock += item.transferredQuantity || 0;
				}
			});
		});

		// Apply last inventory count (if exists and after all transactions)
		if (data.lastCount?.countedItems) {
			data.lastCount.countedItems.forEach((item: any) => {
				if (item.itemId === stockItemId) {
					stock = item.countedQuantity || 0; // Override with counted quantity
				}
			});
		}

		// Ensure non-negative
		stock = Math.max(0, stock);

		return stock;

	} catch (error) {
		console.error('Error calculating stock from transactions:', error);
		return 0;
	}
};