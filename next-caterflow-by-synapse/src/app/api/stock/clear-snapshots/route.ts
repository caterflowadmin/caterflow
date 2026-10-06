import { logger } from '@/lib/logger';
import { clearStockCache } from '@/lib/cache';
// src/app/api/stock/clear-snapshots/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function POST(request: Request) {
	try {
		logger.debug('🧹 Starting stock snapshots clearance...');

		// 1. Fetch all old StockSnapshot documents
		const snapshots = await client.fetch(`
            *[_type == "stockSnapshot"] {
                _id,
                stockItem->{name, sku},
                bin->{name}
            }
        `);

		logger.debug(`📊 Found ${snapshots.length} old stock snapshots to clear`);

		// 2. Delete all old snapshots if any exist
		if (snapshots.length > 0) {
			// Delete in one transaction (Sanity can handle up to 1000 mutations)
			const transaction = writeClient.transaction();

			snapshots.forEach((snapshot: any) => {
				transaction.delete(snapshot._id);
			});

			await transaction.commit();
			logger.debug(`✅ Deleted ${snapshots.length} old stock snapshots`);
		}

		// 3. Create empty stock registry if it doesn't exist
		const existingRegistry = await client.fetch(groq`*[_type == "stockRegistry"][0] { _id }`);

		if (!existingRegistry) {
			await writeClient.create({
				_type: 'stockRegistry',
				title: 'Stock Registry v1',
				stockData: { items: [] },
				lastUpdated: new Date().toISOString(),
				version: 1
			});
			logger.debug('✅ Created new empty stock registry');
		} else {
			logger.debug('✅ Stock registry already exists');
		}

		clearStockCache(); // registry changed: drop the parsed-registry cache
		return NextResponse.json({
			success: true,
			message: `Successfully cleared ${snapshots.length} old stock snapshots and ensured registry exists`,
			snapshotsCleared: snapshots.length,
			registryExists: true
		});

	} catch (error: any) {
		console.error('❌ Failed to clear snapshots:', error);
		return NextResponse.json(
			{
				error: 'Failed to clear stock snapshots',
				details: error.message
			},
			{ status: 500 }
		);
	}
}

// Optional: Simple GET to check registry status
export async function GET() {
	try {
		const snapshotCount = await client.fetch(`count(*[_type == "stockSnapshot"])`);
		const registry = await client.fetch(groq`*[_type == "stockRegistry"][0] {
			_id,
			lastUpdated,
			version
		}`);

		return NextResponse.json({
			legacySnapshotCount: snapshotCount,
			hasRegistry: !!registry,
			registryLastUpdated: registry?.lastUpdated,
			registryVersion: registry?.version,
			usingNewSystem: !!registry
		});
	} catch (error) {
		return NextResponse.json(
			{ error: 'Failed to get snapshot count' },
			{ status: 500 }
		);
	}
}