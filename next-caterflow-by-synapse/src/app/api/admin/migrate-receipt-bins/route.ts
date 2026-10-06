import { logger } from '@/lib/logger';
// src/app/api/admin/migrate-receipt-bins/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function POST() {
	try {
		logger.debug('🔄 Starting receipt bin migration...');

		// Find receipts with document-level bins but no item-level bins
		const oldReceipts = await client.fetch(
			groq`*[_type == "GoodsReceipt" && defined(receivingBin._ref) && count(receivedItems[defined(receivingBin._ref)]) == 0]{
        _id,
        receiptNumber,
        "documentBinId": receivingBin._ref,
        "documentBinName": receivingBin->name,
        "receivedItems": receivedItems[]{
          _key,
          stockItem->{_id, name},
          receivedQuantity,
          unitPrice,
          totalPrice,
          condition,
          batchNumber,
          expiryDate
        }
      }`
		);

		logger.debug(`Found ${oldReceipts.length} receipts with document-level bins only`);

		const results = [];
		let migrated = 0;
		let errors = 0;

		for (const receipt of oldReceipts) {
			logger.debug(`Migrating ${receipt.receiptNumber}...`);

			try {
				// Update each item to have the document-level bin
				const updatedItems = receipt.receivedItems.map((item: any) => ({
					_key: item._key,
					stockItem: {
						_type: 'reference',
						_ref: item.stockItem._id
					},
					orderedQuantity: item.orderedQuantity || 0,
					receivedQuantity: item.receivedQuantity || 0,
					unitPrice: item.unitPrice || 0,
					totalPrice: item.totalPrice || 0,
					condition: item.condition || 'good',
					batchNumber: item.batchNumber || '',
					expiryDate: item.expiryDate || '',
					receivingBin: {
						_type: 'reference',
						_ref: receipt.documentBinId
					}
				}));

				await writeClient
					.patch(receipt._id)
					.set({
						receivedItems: updatedItems
					})
					.commit();

				migrated++;
				results.push({
					receiptNumber: receipt.receiptNumber,
					status: 'success',
					itemsMigrated: receipt.receivedItems.length
				});

				logger.debug(`✅ Migrated ${receipt.receiptNumber} (${receipt.receivedItems.length} items)`);
			} catch (error) {
				errors++;
				results.push({
					receiptNumber: receipt.receiptNumber,
					status: 'error',
					error: error instanceof Error ? error.message : 'Unknown error'
				});
				console.error(`❌ Failed to migrate ${receipt.receiptNumber}:`, error);
			}
		}

		return NextResponse.json({
			success: true,
			summary: {
				totalReceipts: oldReceipts.length,
				migrated,
				errors,
				results
			}
		});

	} catch (error) {
		console.error('Migration error:', error);
		return NextResponse.json(
			{ error: 'Migration failed', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
}