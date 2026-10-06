import { logger } from '@/lib/logger';
// src/app/api/operations/transfers/route.ts

import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserSiteInfo, buildTransactionSiteFilter } from '@/lib/siteFiltering';
import { updateStockForTransaction } from '@/lib/stockCalculations';
import { id } from 'date-fns/locale';

// Helper function to generate the next unique transfer number
const getNextTransferNumber = async (): Promise<string> => {
    try {
        const query = groq`*[_type == "InternalTransfer"] | order(transferNumber desc)[0].transferNumber`;
        const lastTransferNumber = await client.fetch(query);

        if (!lastTransferNumber) {
            return 'TRF-00001'; // First transfer
        }

        // Extract the numeric part from the transfer number (e.g., "TRF-00023" -> 23)
        const match = lastTransferNumber.match(/TRF-(\d+)/);
        if (!match) {
            return 'TRF-00001'; // Fallback if format is unexpected
        }

        const lastNumber = parseInt(match[1], 10);
        const nextNumber = lastNumber + 1;
        return `TRF-${String(nextNumber).padStart(5, '0')}`;
    } catch (error) {
        console.error('Error generating transfer number:', error);
        // Fallback: generate a timestamp-based ID
        return `TRF-${Date.now().toString().slice(-5)}`;
    }
};

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        // Get user site info for filtering
        const userSiteInfo = await getUserSiteInfo(request);
        const siteFilter = buildTransactionSiteFilter(userSiteInfo);

        let statusFilter = '';
        if (status) {
            statusFilter = `&& status == "${status}"`;
        }

        const query = groq`*[_type == "InternalTransfer" ${statusFilter} ${siteFilter}] | order(transferDate desc) {
            _id,
            transferNumber,
            transferDate,
            status,
            notes,
            "fromBin": fromBin->{
                _id,
                name,
                "site": site->{name, _id}
            },
            "toBin": toBin->{
                _id,
                name,
                "site": site->{name, _id}
            },
            "transferredBy": transferredBy->{_id, name, email},
            "approvedBy": approvedBy->{_id, name, email},
            approvedAt,
            "totalItems": count(transferredItems),
            "items": transferredItems[]{
                _key,
                "stockItem": stockItem->{
                    _id,
                    name,
                    sku,
                    unitOfMeasure
                },
                transferredQuantity
            }
        }`;

        const transfers = await client.fetch(query);
        return NextResponse.json(transfers);
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
        const session = await getServerSession(authOptions);
        const userSiteInfo = await getUserSiteInfo(request);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check if user has permission to create transfers for these bins
        if (body.fromBin) {
            const fromBin = await client.fetch(
                groq`*[_type == "Bin" && _id == $binId][0] { "siteId": site->_id }`,
                { binId: body.fromBin._id || body.fromBin }
            );

            if (!userSiteInfo.canAccessMultipleSites && fromBin?.siteId !== userSiteInfo.userSiteId) {
                return NextResponse.json(
                    { error: 'Access denied to create transfer from this bin' },
                    { status: 403 }
                );
            }
        }

        if (body.toBin) {
            const toBin = await client.fetch(
                groq`*[_type == "Bin" && _id == $binId][0] { "siteId": site->_id }`,
                { binId: body.toBin._id || body.toBin }
            );

            if (!userSiteInfo.canAccessMultipleSites && toBin?.siteId !== userSiteInfo.userSiteId) {
                return NextResponse.json(
                    { error: 'Access denied to create transfer to this bin' },
                    { status: 403 }
                );
            }
        }

        // Generate a unique transfer number
        const transferNumber = await getNextTransferNumber();

        // Create the transferred items array
        const transferredItems = (body.transferredItems || body.items || []).map((item: any) => ({
            _type: 'TransferredItem',
            _key: item._key || undefined,
            stockItem: {
                _type: 'reference',
                _ref: item.stockItem?._id || item.stockItem,
            },
            transferredQuantity: item.transferredQuantity,
        }));

        const transfer = {
            _type: 'InternalTransfer',
            transferNumber,
            transferDate: body.transferDate || new Date().toISOString(),
            status: 'draft', // Always start as draft
            fromBin: {
                _type: 'reference',
                _ref: body.fromBin?._id || body.fromBin,
            },
            toBin: {
                _type: 'reference',
                _ref: body.toBin?._id || body.toBin,
            },
            transferredBy: {
                _type: 'reference',
                _ref: session.user.id,
            },
            transferredItems,
            notes: body.notes || '',
        };

        const result = await writeClient.create(transfer);

        if (result.status === 'completed') {
            await updateStockForTransaction('transfer', result._id);
        }

        await logSanityInteraction(
            'create',
            `Created transfer: ${transferNumber}`,
            'InternalTransfer',
            result._id,
            session.user.id,
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
        const { _id, fromBin, toBin, transferredItems, items, ...updateData } = body;
        const session = await getServerSession(authOptions);
        const userSiteInfo = await getUserSiteInfo(request);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!_id) {
            return NextResponse.json({ error: 'Transfer ID is required' }, { status: 400 });
        }

        // Get current transfer to check status and enforce workflow rules
        const currentTransfer = await client.fetch(
            groq`*[_type == "InternalTransfer" && _id == $_id][0] {
                status,
                transferNumber,
                "fromSiteId": fromBin->site->_id,
                "toSiteId": toBin->site->_id
            }`,
            { _id }
        );

        if (!currentTransfer) {
            return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
        }

        // Check if user has permission to update this transfer
        const canAccessFromSite = userSiteInfo.canAccessMultipleSites || currentTransfer.fromSiteId === userSiteInfo.userSiteId;
        const canAccessToSite = userSiteInfo.canAccessMultipleSites || currentTransfer.toSiteId === userSiteInfo.userSiteId;

        if (!canAccessFromSite && !canAccessToSite) {
            return NextResponse.json(
                { error: 'Access denied to update this transfer' },
                { status: 403 }
            );
        }

        // Enforce workflow rules - only allow editing drafts and pending-approval
        if (!['draft', 'pending-approval'].includes(currentTransfer.status)) {
            return NextResponse.json(
                { error: `Cannot edit a transfer with status: ${currentTransfer.status}` },
                { status: 403 }
            );
        }

        const patchedData: any = { ...updateData };

        // Handle status transitions and validation
        if (patchedData.status === 'pending-approval') {
            // When submitting for approval, validate required fields
            if (!fromBin || !toBin || !(transferredItems || items) || (transferredItems || items).length === 0) {
                return NextResponse.json(
                    { error: 'All fields are required when submitting for approval' },
                    { status: 400 }
                );
            }
        }

        // When approving, set approvedBy and approvedAt
        if (patchedData.status === 'approved') {
            patchedData.approvedBy = {
                _type: 'reference',
                _ref: session.user.id,
            };
            patchedData.approvedAt = new Date().toISOString();
        }

        // When completing, validate that it's approved first
        if (patchedData.status === 'completed') {
            if (currentTransfer.status !== 'approved') {
                return NextResponse.json(
                    { error: 'Only approved transfers can be completed' },
                    { status: 400 }
                );
            }
        }

        // Handle bin references
        if (fromBin) {
            patchedData.fromBin = {
                _type: 'reference',
                _ref: fromBin._id || fromBin,
            };
        }

        if (toBin) {
            patchedData.toBin = {
                _type: 'reference',
                _ref: toBin._id || toBin,
            };
        }

        // Handle items (support both transferredItems and items for backward compatibility)
        const itemsToUse = transferredItems || items;
        if (itemsToUse) {
            patchedData.transferredItems = itemsToUse.map((item: any) => ({
                _type: 'TransferredItem',
                _key: item._key || undefined,
                stockItem: {
                    _type: 'reference',
                    _ref: item.stockItem?._id || item.stockItem,
                },
                transferredQuantity: item.transferredQuantity,
            }));
        }

        /*/ In PATCH function, add revert logic:
        const wasCompleted = currentTransfer?.status === 'completed';
        if (wasCompleted && (body.transferredItems || body.fromBin || body.toBin)) {
            logger.debug('↩️ Reverting previous stock changes for transfer edit');
            await revertPreviousStockChanges(currentTransfer.id);
        }*/

        const result = await writeClient.patch(_id).set(patchedData).commit();

        // ✅ ADD THIS: Update stock if transfer is completed
        if (result.status === 'completed') {
            await updateStockForTransaction('transfer', result._id);
        }

        await logSanityInteraction(
            'update',
            `Updated transfer: ${currentTransfer.transferNumber || _id}`,
            'InternalTransfer',
            _id,
            session.user.id,
            true
        );

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
        const session = await getServerSession(authOptions);
        const userSiteInfo = await getUserSiteInfo(request);

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!id) {
            return NextResponse.json(
                { error: 'Transfer ID is required' },
                { status: 400 }
            );
        }

        // Check if transfer exists and user has access
        const currentTransfer = await client.fetch(
            groq`*[_type == "InternalTransfer" && _id == $id][0] { 
                status, 
                transferNumber,
                "fromSiteId": fromBin->site->_id,
                "toSiteId": toBin->site->_id
            }`,
            { id }
        );

        if (!currentTransfer) {
            return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
        }

        // Check if user has permission to delete this transfer
        const canAccessFromSite = userSiteInfo.canAccessMultipleSites || currentTransfer.fromSiteId === userSiteInfo.userSiteId;
        const canAccessToSite = userSiteInfo.canAccessMultipleSites || currentTransfer.toSiteId === userSiteInfo.userSiteId;

        if (!canAccessFromSite && !canAccessToSite) {
            return NextResponse.json(
                { error: 'Access denied to delete this transfer' },
                { status: 403 }
            );
        }

        // Check if transfer can be deleted (only drafts)
        if (currentTransfer.status !== 'draft') {
            return NextResponse.json(
                { error: 'Only draft transfers can be deleted' },
                { status: 403 }
            );
        }

        await writeClient.delete(id);

        await logSanityInteraction(
            'delete',
            `Deleted transfer: ${currentTransfer.transferNumber || id}`,
            'InternalTransfer',
            id,
            session.user.id,
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