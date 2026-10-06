import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { updateStockForTransaction } from '@/lib/stockCalculations';
import { getArchivedTransfers } from '@/lib/archiveQueries';
import { getMaxSequenceNumber } from '@/lib/archiveService';
import { mergeById } from '@/lib/financialReport';

// Helper function to generate the next unique transfer number
const getNextTransferNumber = async (): Promise<string> => {
    try {
        // 1. Get max from Sanity
        const query = groq`*[_type == "InternalTransfer"] | order(transferNumber desc)[0].transferNumber`;
        const lastTransferNumber = await client.fetch(query);

        let lastNumber = 0;
        if (lastTransferNumber) {
            const match = lastTransferNumber.match(/TRF-(\d+)/);
            if (match) lastNumber = parseInt(match[1], 10);
        }

        // 2. Check MongoDB archived max (answer 7b)
        try {
            const mongoMax = await getMaxSequenceNumber('InternalTransfer');
            if (mongoMax > lastNumber) lastNumber = mongoMax;
        } catch { /* MongoDB unavailable — use Sanity max */ }

        const nextNumber = lastNumber + 1;
        return `TRF-${String(nextNumber).padStart(5, '0')}`;
    } catch (error) {
        console.error('Error generating transfer number:', error);
        return `TRF-${Date.now().toString().slice(-5)}`;
    }
};

export async function GET() {
    try {
        const query = groq`*[_type == "InternalTransfer"] | order(transferDate desc) {
            _id,
            transferNumber,
            transferDate,
            status,
            notes,
            "fromBin": fromBin->{
                _id,
                name,
                "site": site->{_id, name}
            },
            "toBin": toBin->{
                _id,
                name,
                "site": site->{_id, name}
            },
            "totalItems": count(transferredItems),
            "items": transferredItems[]{
                "stockItem": stockItem->{
                    _id,
                    name,
                    sku,
                    unitPrice
                },
                transferredQuantity
            }
        }`;

        const transfers = await client.fetch(query);

        // ── Fetch archived transfers from MongoDB ──
        let archivedTransfers: any[] = [];
        try {
            // Get user site info for filtering — transfers route doesn’t currently filter by site,
            // but we apply it in MongoDB for consistency
            let userSiteId: string | null = null;
            let canAccessMultipleSites = true;
            try {
                const { getUserSiteInfo } = await import('@/lib/siteFiltering');
                const info = await getUserSiteInfo();
                userSiteId = info.userSiteId;
                canAccessMultipleSites = info.canAccessMultipleSites;
            } catch { /* session may not be present */ }

            const raw = await getArchivedTransfers({ userSiteId, canAccessMultipleSites });
            archivedTransfers = raw.map(t => ({
                ...t,
                _id: t._sanityId || t._id?.toString(),
                _isArchived: true,
                totalItems: (t.transferredItems || []).length,
                items: t.transferredItems || [],
            }));
        } catch (mongoErr) {
            console.warn('⚠️  Could not fetch archived transfers from MongoDB:', mongoErr);
        }

        // Merge and sort by transferDate descending
        const merged = mergeById(transfers, archivedTransfers).sort(
            (a, b) => new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime()
        );

        return NextResponse.json(merged);
    } catch (error) {
        console.error('Failed to fetch transfers:', error);
        return NextResponse.json(
            { error: 'Failed to fetch transfers' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Generate a unique transfer number using the new function
        const transferNumber = await getNextTransferNumber();

        // Create the transferred items array
        const transferredItems = (body.items || []).map((item: any) => ({
            _type: 'TransferredItem',
            stockItem: {
                _type: 'reference',
                _ref: item.stockItem,
            },
            transferredQuantity: item.transferredQuantity,
        }));

        const transfer = {
            _type: 'InternalTransfer',
            transferNumber,
            transferDate: body.transferDate || new Date().toISOString().split('T')[0],
            status: body.status || 'pending',
            fromBin: {
                _type: 'reference',
                _ref: body.fromBin,
            },
            toBin: {
                _type: 'reference',
                _ref: body.toBin,
            },
            transferredItems,
            notes: body.notes || '',
        };

        const result = await writeClient.create(transfer);

        // Update stock calculations
        if (result.status === 'completed') {
            await updateStockForTransaction('transfer', result._id);
        }

        await logSanityInteraction(
            'create',
            `Created transfer: ${transferNumber}`,
            'InternalTransfer',
            result._id,
            'system',
            true
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to create transfer:', error);
        return NextResponse.json(
            { error: 'Failed to create transfer' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { _id, ...updateData } = body;

        // Create the transferred items array if provided
        let transferredItems;
        if (updateData.items) {
            transferredItems = updateData.items.map((item: any) => ({
                _type: 'TransferredItem',
                stockItem: {
                    _type: 'reference',
                    _ref: item.stockItem,
                },
                transferredQuantity: item.transferredQuantity,
            }));
            delete updateData.items;
        }

        // Start the patch operation
        let patch = writeClient.patch(_id).set({
            ...updateData,
            ...(transferredItems && { transferredItems }),
        });

        // If fromBin is being updated, convert to reference
        if (updateData.fromBin) {
            patch = patch.set({
                fromBin: {
                    _type: 'reference',
                    _ref: updateData.fromBin,
                },
            });
        }

        // If toBin is being updated, convert to reference
        if (updateData.toBin) {
            patch = patch.set({
                toBin: {
                    _type: 'reference',
                    _ref: updateData.toBin,
                },
            });
        }

        const wasCompleted = updateData?.status === 'completed';
        const willBeCompleted = updateData.status === 'completed' || (!updateData.status && wasCompleted);

        /*        if (wasCompleted && (updateData.transferredItems || updateData.fromBin || updateData.toBin)) {
                    logger.debug('↩️ Reverting previous stock changes for transfer edit');
                    await revertPreviousStockChanges(_id);
                }*/

        const result = await patch.commit();

        if (result.status === 'completed') {
            await updateStockForTransaction('transfer', result._id);
        }


        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to update transfer:', error);
        return NextResponse.json(
            { error: 'Failed to update transfer' },
            { status: 500 }
        );
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: 'Transfer ID is required' },
                { status: 400 }
            );
        }

        await writeClient.delete(id);

        await logSanityInteraction(
            'delete',
            `Deleted transfer: ${id}`,
            'InternalTransfer',
            id,
            'system',
            true
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete transfer:', error);
        return NextResponse.json(
            { error: 'Failed to delete transfer' },
            { status: 500 }
        );
    }
}