import { logger } from '@/lib/logger';
import { clearStockCache } from '@/lib/cache';
// src/app/api/stock/snapshots/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function POST(request: NextRequest) {
	try {
		const { stockItemId, binId, quantity, transactionType, transactionId } = await request.json();

		if (!stockItemId || !binId) {
			return NextResponse.json(
				{ error: 'stockItemId and binId are required' },
				{ status: 400 }
			);
		}

		logger.debug('📝 Updating stock registry:', {
			stockItemId,
			binId,
			quantity,
			transactionType,
			transactionId
		});

		// Get the stock registry document
		const registryQuery = groq`*[_type == "stockRegistry"][0] {
            _id,
            stockData
        }`;

		const registry = await client.fetch(registryQuery);
		const now = new Date().toISOString();

		let registryData = registry?.stockData || { items: [] };
		let itemIndex = registryData.items.findIndex((item: any) => item.stockItemId === stockItemId);

		if (itemIndex === -1) {
			// Create new item entry
			registryData.items.push({
				stockItemId,
				binQuantities: { bins: [] }
			});
			itemIndex = registryData.items.length - 1;
		}

		const itemEntry = registryData.items[itemIndex];
		let binIndex = itemEntry.binQuantities?.bins?.findIndex((bin: any) => bin.binId === binId) || -1;

		if (binIndex === -1) {
			// Create new bin entry
			itemEntry.binQuantities = itemEntry.binQuantities || { bins: [] };
			itemEntry.binQuantities.bins.push({
				binId,
				quantity,
				lastUpdated: now,
				lastTransactionId: transactionId,
				lastTransactionType: transactionType
			});
		} else {
			// Update existing bin entry
			itemEntry.binQuantities.bins[binIndex] = {
				binId,
				quantity,
				lastUpdated: now,
				lastTransactionId: transactionId,
				lastTransactionType: transactionType
			};
		}

		// Save to database
		if (registry) {
			await writeClient
				.patch(registry._id)
				.set({
					stockData: registryData,
					lastUpdated: now
				})
				.commit();
		} else {
			await writeClient.create({
				_type: 'stockRegistry',
				title: 'Stock Registry v1',
				stockData: registryData,
				lastUpdated: now,
				version: 1
			});
		}

		logger.debug(`✅ Updated registry for ${stockItemId}-${binId}: ${quantity}`);

		clearStockCache(); // registry changed: drop the parsed-registry cache
		return NextResponse.json(
			{
				success: true,
				message: 'Registry updated',
				stockItemId,
				binId,
				quantity
			},
			{ status: 200 }
		);
	} catch (error: any) {
		console.error('Failed to update stock registry:', error);
		return NextResponse.json(
			{
				success: false,
				error: error.message || 'Failed to update stock registry'
			},
			{ status: 500 }
		);
	}
}