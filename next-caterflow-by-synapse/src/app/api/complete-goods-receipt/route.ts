import { logger } from '@/lib/logger';
// src/app/api/complete-goods-receipt/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { updateStockForTransaction } from '@/lib/stockCalculations';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserSiteInfo, buildGoodsReceiptSiteFilter } from '@/lib/siteFiltering';

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return NextResponse.json(
                { error: 'User not authenticated' },
                { status: 401 }
            );
        }

        const { receiptId, poId, attachmentIds } = await request.json();

        logger.debug("🔧 Complete goods receipt request:", {
            receiptId,
            poId,
            attachmentCount: attachmentIds?.length || 0
        });

        if (!receiptId || !poId) {
            return NextResponse.json(
                { error: 'Receipt ID and PO ID are required' },
                { status: 400 }
            );
        }

        // Check if user has access to this receipt
        const userSiteInfo = await getUserSiteInfo();
        const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

        const accessCheck = await client.fetch(
            groq`count(*[_type == "GoodsReceipt" && _id == $receiptId ${siteFilter}])`,
            { receiptId }
        );

        if (accessCheck === 0) {
            return NextResponse.json(
                { error: 'Goods receipt not found or you do not have access' },
                { status: 404 }
            );
        }

        // CRITICAL: Validate that all items with quantity have receiving bins
        logger.debug('🔍 Validating receipt items have bins...');
        const validationQuery = groq`*[_type == "GoodsReceipt" && _id == $receiptId][0] {
            receiptNumber,
            status,
            evidenceStatus,
            "receivedItems": receivedItems[]{
                "hasBin": defined(receivingBin._ref),
                "quantity": receivedQuantity,
                "stockItemName": stockItem->name,
                "binName": receivingBin->name
            }
        }`;

        const validation = await client.fetch(validationQuery, { receiptId });

        if (!validation) {
            return NextResponse.json(
                { error: 'Goods receipt not found' },
                { status: 404 }
            );
        }

        // Check if already completed
        if (validation.status === 'completed' || validation.evidenceStatus === 'complete') {
            return NextResponse.json(
                { error: 'Goods receipt is already completed' },
                { status: 400 }
            );
        }

        // Check for items without bins - ONLY if they have quantity
        const itemsWithoutBins = validation.receivedItems?.filter((item: any) =>
            item.quantity > 0 && !item.hasBin
        ) || [];

        // Check for items with 0 quantity
        const itemsWithZeroQuantity = validation.receivedItems?.filter((item: any) =>
            item.quantity === 0
        ) || [];

        if (itemsWithZeroQuantity.length > 0) {
            console.warn(`⚠️ Goods receipt ${validation.receiptNumber} has ${itemsWithZeroQuantity.length} items with 0 quantity`);

            // If ALL items have 0 quantity, that's an error
            const allItemsHaveZeroQuantity = validation.receivedItems?.every((item: any) =>
                item.quantity === 0
            );

            if (allItemsHaveZeroQuantity) {
                return NextResponse.json({
                    error: 'Cannot complete goods receipt: All items have 0 received quantity',
                    details: 'You must receive at least some quantity of items'
                }, { status: 400 });
            }
        }

        if (itemsWithoutBins.length > 0) {
            const itemNames = itemsWithoutBins.map((item: any) => item.stockItemName).join(', ');
            console.error(`❌ Goods receipt ${validation.receiptNumber} has ${itemsWithoutBins.length} items without bins:`, itemNames);

            return NextResponse.json({
                error: 'Cannot complete goods receipt: Some items with quantity are missing receiving bins',
                details: `${itemsWithoutBins.length} items with quantity need bins assigned`,
                itemsWithoutBins: itemsWithoutBins.map((item: any) => ({
                    itemName: item.stockItemName,
                    quantity: item.quantity,
                    binName: item.binName || 'Not assigned'
                }))
            }, { status: 400 });
        }

        logger.debug(`✅ Validation passed: All items with quantity have bins`);

        // Start a transaction
        const transaction = writeClient.transaction();

        // 1. Update the goods receipt status to 'completed'
        transaction.patch(receiptId, (patch) =>
            patch.set({
                status: 'completed',
                evidenceStatus: 'complete',
                completedAt: new Date().toISOString(),
            })
        );

        // 2. Update the purchase order status to 'complete'
        transaction.patch(poId, (patch) =>
            patch.set({
                status: 'complete',
                evidenceStatus: 'complete',
            })
        );

        // 3. Add attachments to receipt if provided
        if (attachmentIds && attachmentIds.length > 0) {
            logger.debug(`📎 Adding ${attachmentIds.length} attachments to receipt`);

            // First check if the attachments already exist in the receipt
            const currentReceipt = await writeClient.fetch(
                groq`*[_type == "GoodsReceipt" && _id == $receiptId][0] {
                    attachments[]
                }`,
                { receiptId }
            );

            const existingAttachmentRefs = currentReceipt.attachments?.map((att: any) => att._ref) || [];

            // Add only new attachments that don't already exist
            const newAttachments = attachmentIds
                .filter((attachmentId: string) => !existingAttachmentRefs.includes(attachmentId))
                .map((attachmentId: string) => ({
                    _type: 'reference',
                    _ref: attachmentId,
                    _key: Math.random().toString(36).substr(2, 9)
                }));

            if (newAttachments.length > 0) {
                transaction.patch(receiptId, (patch) =>
                    patch.append('attachments', newAttachments)
                );
                logger.debug(`✅ Added ${newAttachments.length} new attachments`);
            }
        }

        // Execute the transaction
        logger.debug('💾 Executing transaction...');
        const result = await transaction.commit();
        logger.debug('✅ Transaction completed');



        // Update evidence status after transaction
        await updateEvidenceStatus(receiptId, attachmentIds);

        // Update stock after transaction (for procurement)
        logger.debug('🔄 Updating stock snapshots for procurement...');
        try {
            await updateStockForTransaction('procurement', receiptId);
            logger.debug('✅ Stock snapshots updated');
        } catch (stockError: any) {
            console.error('❌ Failed to update stock:', stockError);
            // Don't fail the whole request if stock update fails
            // The receipt is already marked as completed
        }

        return NextResponse.json({
            success: true,
            message: `Goods receipt ${validation.receiptNumber} completed successfully with ${attachmentIds?.length || 0} attachment(s)`,
            details: {
                receiptNumber: validation.receiptNumber,
                itemsProcessed: validation.receivedItems?.length || 0,
                itemsWithQuantity: validation.receivedItems?.filter((item: any) => item.quantity > 0).length || 0,
                allItemsHaveBins: true,
                attachmentCount: attachmentIds?.length || 0
            },
            result
        });
    } catch (error: any) {
        console.error('❌ Failed to complete goods receipt:', error);
        return NextResponse.json(
            {
                error: 'Failed to complete goods receipt',
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}

// Helper function to handle multiple attachments and item-level bins
async function updateEvidenceStatus(receiptId: string, attachmentIds: string[] = []) {
    try {
        const receipt = await writeClient.fetch(
            groq`*[_type == "GoodsReceipt" && _id == $receiptId][0] {
                attachments[]->{_id},
                notes,
                "receivedItems": receivedItems[]{
                    "hasBin": defined(receivingBin._ref),
                    "quantity": receivedQuantity
                }
            }`,
            { receiptId }
        );

        let evidenceStatus = 'pending';

        // Check if we have attachments (either from the receipt or newly provided ones)
        const hasAttachments = (receipt.attachments?.length > 0) || (attachmentIds.length > 0);
        const hasNotes = receipt.notes;

        // Check if all items with quantity have bins assigned
        const itemsWithQuantity = receipt.receivedItems?.filter((item: any) => item.quantity > 0) || [];
        const allItemsHaveBins = itemsWithQuantity.length > 0
            ? itemsWithQuantity.every((item: any) => item.hasBin)
            : true; // If no items with quantity, consider it valid

        // Updated evidence status logic that considers item-level bins
        if (hasAttachments && hasNotes && allItemsHaveBins) {
            evidenceStatus = 'complete';
        } else if (hasAttachments || allItemsHaveBins) {
            evidenceStatus = 'partial';
        }

        logger.debug('📊 Evidence status calculation:', {
            hasAttachments,
            hasNotes,
            allItemsHaveBins,
            itemsWithQuantity: itemsWithQuantity.length,
            finalEvidenceStatus: evidenceStatus
        });

        await writeClient
            .patch(receiptId)
            .set({ evidenceStatus })
            .commit();

        logger.debug(`✅ Evidence status updated to: ${evidenceStatus}`);
    } catch (error) {
        console.error('❌ Error updating evidence status:', error);
    }
}