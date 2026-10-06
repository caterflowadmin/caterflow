import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { bulkUpdateStockRegistry } from '@/lib/stockCalculations';

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const updates = body?.updates;

		if (!updates || !Array.isArray(updates)) {
			return NextResponse.json(
				{ error: 'Invalid updates array' },
				{ status: 400 }
			);
		}

		logger.debug(`📝 API: Received ${updates.length} registry updates`);

		const results = await bulkUpdateStockRegistry(updates, {
			onProgress: ({ processed, total }) => {
				if (processed % 100 === 0 || processed === total) {
					logger.debug(`📈 Bulk update progress: ${processed}/${total}`);
				}
			}
		});

		const now = new Date().toISOString();

		return NextResponse.json({
			success: true,
			results,
			timestamp: now
		});

	} catch (error: any) {
		console.error('❌ API Error updating stock registry:', error);
		return NextResponse.json(
			{
				success: false,
				error: error.message || 'Failed to update stock registry'
			},
			{ status: 500 }
		);
	}
}
