import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { calculateStockWithHistory } from '@/lib/stockCalculations';

export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;
		const stockItemId = searchParams.get('stockItemId');
		const binId = searchParams.get('binId');

		if (!stockItemId || !binId) {
			return NextResponse.json(
				{ error: 'Missing stockItemId or binId' },
				{ status: 400 }
			);
		}

		logger.debug(`🔍 Fetching accurate stock history for ${stockItemId} in ${binId}`);

		// Use the new accurate calculation function
		const result = await calculateStockWithHistory(stockItemId, binId);

		// Format for display
		const formattedTransactions = result.transactions.map((tx, index) => {
			// Get badge color and text
			let badgeColor = 'gray';
			let badgeText = '';
			let icon = '📦';

			switch (tx.type) {
				case 'receipt':
					badgeColor = 'green';
					badgeText = 'RECEIPT';
					icon = '📥';
					break;
				case 'dispatch':
					badgeColor = 'red';
					badgeText = 'DISPATCH';
					icon = '📤';
					break;
				case 'transferIn':
					badgeColor = 'blue';
					badgeText = 'TRANSFER IN';
					icon = '🔄';
					break;
				case 'transferOut':
					badgeColor = 'orange';
					badgeText = 'TRANSFER OUT';
					icon = '🔄';
					break;
				case 'count':
					badgeColor = 'purple';
					badgeText = 'COUNT';
					icon = '📋';
					break;
			}

			// Format quantity display
			let quantityDisplay = '';
			if (tx.type === 'count') {
				quantityDisplay = `SET TO ${tx.quantity}`;
			} else if (tx.quantity > 0) {
				quantityDisplay = `+${tx.quantity}`;
			} else {
				quantityDisplay = `${tx.quantity}`; // Already negative
			}

			return {
				id: `${tx.type}-${index}`,
				date: new Date(tx.date).toLocaleDateString(),
				time: new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
				type: tx.type,
				badgeColor,
				badgeText,
				icon,
				documentNumber: tx.documentNumber,
				quantity: quantityDisplay,
				rawQuantity: tx.quantity,
				runningTotal: tx.runningTotal,
				isNegative: tx.isNegative
			};
		});

		return NextResponse.json({
			success: true,
			currentStock: result.currentStock,
			transactions: formattedTransactions,
			summary: result.summary,
			calculation: {
				method: 'Chronological transaction processing',
				rulesApplied: [
					'Inventory counts set absolute stock value',
					'Receipts add to stock (reset negative stock to 0 first)',
					'Dispatches reduce stock (can create negative values)',
					'Transfers follow same rules as receipts/dispatches'
				]
			}
		});

	} catch (error: any) {
		console.error('Error in transaction history API:', error);
		return NextResponse.json(
			{
				error: error.message || 'Failed to fetch transaction history',
				success: false,
				details: 'Check console for error details'
			},
			{ status: 500 }
		);
	}
}