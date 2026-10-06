import { logger } from '@/lib/logger';
// app/api/stock/create-zero-snapshots/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeClient } from '@/lib/sanity';

export async function POST(request: Request) {
	try {
		const session = await getServerSession(authOptions);

		if (!session?.user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { items } = await request.json();

		if (!items || !Array.isArray(items)) {
			return NextResponse.json(
				{ error: 'Missing items array' },
				{ status: 400 }
			);
		}

		logger.debug(`📝 Creating ${items.length} zero stock snapshots via API...`);

		const now = new Date().toISOString();
		const batchSize = 50;
		let createdCount = 0;

		for (let i = 0; i < items.length; i += batchSize) {
			const batch = items.slice(i, i + batchSize);
			const transaction = writeClient.transaction();

			batch.forEach(({ itemId, binId }) => {
				transaction.create({
					_type: 'stockSnapshot',
					stockItem: { _type: 'reference', _ref: itemId },
					bin: { _type: 'reference', _ref: binId },
					quantity: 0,
					lastUpdated: now,
					transactionType: 'auto_init',
					transactionId: null,
					createdAt: now
				});
			});

			await transaction.commit();
			createdCount += batch.length;
			logger.debug(`✅ Created batch ${Math.floor(i / batchSize) + 1} (${batch.length} snapshots)`);
		}

		return NextResponse.json({
			success: true,
			message: `Created ${createdCount} zero stock snapshots`,
			created: createdCount
		});

	} catch (error: any) {
		console.error('Failed to create zero snapshots:', error);
		return NextResponse.json(
			{ error: 'Failed to create zero snapshots', details: error.message },
			{ status: 500 }
		);
	}
}