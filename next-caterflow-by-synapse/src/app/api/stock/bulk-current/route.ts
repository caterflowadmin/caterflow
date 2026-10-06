import { logger } from '@/lib/logger';
// src/app/api/stock/bulk-current/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { calculateBulkStock } from '@/lib/stockCalculations';

export async function POST(request: NextRequest) {
	try {
		const { stockItems, binId } = await request.json();

		if (!stockItems || !Array.isArray(stockItems) || !binId) {
			return NextResponse.json(
				{ error: 'Missing stockItems array or binId' },
				{ status: 400 }
			);
		}

		logger.debug(`📊 Batch fetching current stock for ${stockItems.length} items in bin ${binId}`);

		// Use the same function as the current stock page
		const stockResults = await calculateBulkStock(stockItems, [binId]);

		// Format results: stockResults is { "itemId-binId": quantity }
		// We want to map it to { itemId: quantity }
		const results: Record<string, number> = {};

		stockItems.forEach(itemId => {
			const key = `${itemId}-${binId}`;
			results[itemId] = stockResults[key] || 0;
		});

		// Log for debugging
		logger.debug('📊 Batch results:', {
			totalItems: stockItems.length,
			itemsWithStock: Object.values(results).filter(qty => qty > 0).length,
			sample: Object.entries(results).slice(0, 5)
		});

		return NextResponse.json({
			success: true,
			results,
			binId,
			timestamp: new Date().toISOString(),
			summary: {
				totalItems: stockItems.length,
				itemsWithStock: Object.values(results).filter(qty => qty > 0).length
			}
		});
	} catch (error: any) {
		console.error('❌ Error in bulk current stock API:', error);
		return NextResponse.json(
			{
				error: 'Failed to get bulk current stock',
				details: error.message
			},
			{ status: 500 }
		);
	}
}