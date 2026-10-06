import { logger } from '@/lib/logger';
import { clearStockCache } from '@/lib/cache';
// /api/stock/emergency-recalculate/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { bulkUpdateStockRegistry } from '@/lib/stockCalculations';

export async function POST(request: Request) {
	try {
		const session = await getServerSession(authOptions);

		// Optional: Only allow admins or specific roles
		if (!session?.user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}

		logger.debug('🚨 Starting emergency stock recalculation via API...');

		// 1. Clear existing stock registry
		const existingRegistry = await client.fetch(groq`*[_type == "stockRegistry"][0] { _id }`);

		if (existingRegistry) {
			await writeClient
				.patch(existingRegistry._id)
				.set({
					stockData: { items: [] },
					lastUpdated: new Date().toISOString(),
					version: (existingRegistry.version || 0) + 1
				})
				.commit();
			logger.debug('✅ Cleared existing stock registry');
		} else {
			await writeClient.create({
				_type: 'stockRegistry',
				title: 'Stock Registry v1',
				stockData: { items: [] },
				lastUpdated: new Date().toISOString(),
				version: 1
			});
			logger.debug('✅ Created new empty stock registry');
		}

		// 2. Reset BinStock quantities
		const binStockCount = await client.fetch(`count(*[_type == "BinStock"])`);
		await writeClient
			.patch({ query: '*[_type == "BinStock"]' })
			.set({ quantity: 0 })
			.commit();

		// 3. Process all completed goods receipts using REGISTRY updates
		logger.debug('📦 Collecting all goods receipt items for bulk processing...');
		const receipts = await client.fetch(`
				*[_type == "GoodsReceipt" && status == "completed"] {
					_id,
					receiptNumber,
					receivingBin->{_id},
					receivedItems[] {
						stockItem->{_id},
						receivedQuantity
					}
				}
			`);

		let itemsProcessed = 0;
		const bulkUpdates = [];

		// Collect ALL items for bulk update
		for (const receipt of receipts) {
			for (const item of receipt.receivedItems) {
				if (item.stockItem && item.receivedQuantity > 0 && receipt.receivingBin) {
					bulkUpdates.push({
						stockItemId: item.stockItem._id,
						binId: receipt.receivingBin._id,
						quantity: item.receivedQuantity,
						transactionType: 'procurement' as const,
						transactionId: receipt._id,
						isAbsolute: false // Add to existing (but since we cleared, this is initial)
					});
					itemsProcessed++;
				}
			}
		}

		logger.debug(`🚀 Bulk processing ${bulkUpdates.length} items from ${receipts.length} receipts...`);

		// Use REGISTRY bulk update for maximum efficiency
		if (bulkUpdates.length > 0) {
			const bulkResult = await bulkUpdateStockRegistry(bulkUpdates, {
				onProgress: (progress) => {
					if (progress.processed % 50 === 0 || progress.processed === progress.total) {
						logger.debug(`📈 Emergency recalculation: ${progress.processed}/${progress.total} items`);
					}
				}
			});

			logger.debug(`✅ Emergency registry update: ${bulkResult.success} succeeded, ${bulkResult.failed} failed`);
		}

		// Still process BinStock separately if needed (for backward compatibility)
		logger.debug('🔄 Updating BinStock quantities...');
		for (const receipt of receipts) {
			for (const item of receipt.receivedItems) {
				if (item.stockItem && item.receivedQuantity > 0 && receipt.receivingBin) {
					const existingBinStock = await client.fetch(`
							*[_type == "BinStock" && 
							  bin._ref == $binId && 
							  stockItem._ref == $itemId][0] { _id }
						`, {
						binId: receipt.receivingBin._id,
						itemId: item.stockItem._id
					});

					if (existingBinStock) {
						await writeClient
							.patch(existingBinStock._id)
							.inc({ quantity: item.receivedQuantity })
							.commit();
					} else {
						await writeClient.create({
							_type: 'BinStock',
							bin: { _type: 'reference', _ref: receipt.receivingBin._id },
							stockItem: { _type: 'reference', _ref: item.stockItem._id },
							quantity: item.receivedQuantity,
							lastUpdated: new Date().toISOString()
						});
					}
				}
			}
		}

		const receiptsProcessed = receipts.length;

		clearStockCache(); // registry changed: drop the parsed-registry cache
		return NextResponse.json({
			success: true,
			message: 'Emergency recalculation complete',
			stats: {
				registryReset: true,
				binStockReset: binStockCount,
				receiptsProcessed,
				itemsProcessed
			},
			timestamp: new Date().toISOString()
		});

	} catch (error: any) {
		console.error('Emergency recalculation failed:', error);
		return NextResponse.json(
			{ error: 'Emergency recalculation failed', details: error.message },
			{ status: 500 }
		);
	}
}