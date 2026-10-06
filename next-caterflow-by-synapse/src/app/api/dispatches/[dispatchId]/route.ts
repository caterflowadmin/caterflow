import { logger } from '@/lib/logger';
// src/app/api/dispatches/[dispatchId]/route.ts (REPLACE ENTIRE FILE)
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { updateStockForTransaction } from '@/lib/stockCalculations';

// Helper to normalize incoming reference values to a plain string id
const resolveRef = (val: any): string | null => {
    if (!val && val !== 0) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
        if (typeof val._ref === 'string') return val._ref;
        if (typeof val._id === 'string') return val._id;
    }
    return null;
};

// Get selling price for dispatch type and site
const getSellingPriceForSite = async (dispatchTypeId: string, siteId: string): Promise<number> => {
    try {
        const query = groq`*[_type == "DispatchType" && _id == $dispatchTypeId][0] {
            sellingPrice,
            sitePrices[]{
                site->{_id},
                price
            }
        }`;

        const dispatchType = await client.fetch(query, { dispatchTypeId });

        if (!dispatchType) return 0;

        // Check for site-specific price
        const sitePrice = dispatchType.sitePrices?.find(
            (sp: any) => sp.site?._id === siteId
        );

        return sitePrice ? sitePrice.price : dispatchType.sellingPrice;
    } catch (error) {
        console.error('Error getting selling price:', error);
        return 0;
    }
};

// In the GET function, update the query (around line 50-60):
export async function GET(request: Request, { params }: { params: Promise<{ dispatchId: string }> }) {
    try {
        const { dispatchId } = await params;

        if (!dispatchId) {
            return NextResponse.json({ error: 'Dispatch ID is required' }, { status: 400 });
        }

        const query = groq`{
            "dispatch": *[_type == "DispatchLog" && _id == $dispatchId][0] {
                _id,
                dispatchNumber,
                dispatchDate,
                evidenceStatus,
                peopleFed,
                notes,
                status,
                totalCost,
                costPerPerson,
                sellingPrice,
                totalSales,
                completedAt,
                "dispatchType": dispatchType->{
                    _id,
                    name,
                    description,
                    defaultTime,
                    sellingPrice,
                    sitePrices[]{
                        _key,
                        "site": site->{
                            _id,
                            name
                        },
                        price
                    }
                },
                // Handle both old and new structures
                "sourceSite": coalesce(sourceSite->{
                    _id,
                    name,
                    location,
                    code
                }, sourceBin->site->{
                    _id,
                    name,
                    location,
                    code
                }),
                "sourceBin": sourceBin->{
                    _id,
                    name,
                    "site": site->{
                        _id,
                        name
                    }
                },
                "dispatchedBy": dispatchedBy->{
                    _id,
                    name,
                    email,
                    role,
                    "assignedSite": associatedSite->{
                        _id,
                        name
                    }
                },
                "dispatchedItems": coalesce(dispatchedItems[]{
                    _key,
                    dispatchedQuantity,
                    unitPrice,
                    totalCost,
                    notes,
                    // Handle both old and new structures
                    "sourceBin": coalesce(
                        sourceBin->{
                            _id,
                            name,
                            "site": site->{
                                _id,
                                name
                            }
                        },
                        ^.sourceBin->{
                            _id,
                            name,
                            "site": site->{
                                _id,
                                name
                            }
                        }
                    ),
                    "stockItem": stockItem->{
                        _id,
                        name,
                        sku,
                        unitOfMeasure,
                        "category": category->{
                            _id,
                            title
                        }
                    }
                }, []),
                "attachments": coalesce(attachments[]->{
                    _id,
                    fileName,
                    fileType,
                    description,
                    uploadedAt,
                    "file": file{
                        "asset": asset->{
                            _id,
                            _type,
                            url,
                            originalFilename,
                            mimeType
                        }
                    }
                }, [])
            },
            "registry": *[_type == "stockRegistry"][0] {
                stockData
            }
        }`;

        const data = await client.fetch(query, { dispatchId });
        const dispatch = data.dispatch;

        if (!dispatch) {
            return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });
        }

        // Transform old dispatches to new structure
        if (dispatch.sourceBin && !dispatch.dispatchedItems?.every((item: any) => item.sourceBin)) {
            // This is an old dispatch with sourceBin at document level but not at item level
            dispatch.dispatchedItems = (dispatch.dispatchedItems || []).map((item: any) => ({
                ...item,
                sourceBin: item.sourceBin || dispatch.sourceBin
            }));
        }

        // Add current stock from registry to each item
        if (data.registry?.stockData?.items && dispatch.dispatchedItems) {
            dispatch.dispatchedItems = dispatch.dispatchedItems.map((item: any) => {
                if (item.stockItem?._id && item.sourceBin?._id) {
                    const itemEntry = data.registry.stockData.items.find(
                        (i: any) => i.stockItemId === item.stockItem._id
                    );

                    if (itemEntry?.binQuantities?.bins) {
                        const binEntry = itemEntry.binQuantities.bins.find(
                            (b: any) => b.binId === item.sourceBin._id
                        );

                        if (binEntry) {
                            return {
                                ...item,
                                stockItem: {
                                    ...item.stockItem,
                                    currentStock: binEntry.quantity || 0
                                }
                            };
                        }
                    }
                }
                return {
                    ...item,
                    stockItem: {
                        ...item.stockItem,
                        currentStock: 0
                    }
                };
            });
        }

        return NextResponse.json(dispatch);
    } catch (error) {
        console.error('Failed to fetch dispatch:', error);
        return NextResponse.json({ error: 'Failed to fetch dispatch' }, { status: 500 });
    }
}

// --- PATCH single dispatch ---
// --- PATCH single dispatch ---
export async function PATCH(request: Request, { params }: { params: Promise<{ dispatchId: string }> }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { dispatchId } = await params;
        const updateData = await request.json();

        if (!dispatchId) {
            return NextResponse.json({ error: 'Dispatch ID is required' }, { status: 400 });
        }

        // fetch existing dispatch to get current state
        const existing = await client.fetch(
            `*[_type=="DispatchLog" && _id == $id][0]{ 
                evidenceStatus, 
                status,
                dispatchedItems, 
                peopleFed,
                dispatchType,
                sourceSite,
                dispatchNumber,
                completedAt
            }`,
            { id: dispatchId }
        );

        if (!existing) {
            return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });
        }

        if (existing?.evidenceStatus === 'complete') {
            return NextResponse.json({ error: 'Dispatch is completed and cannot be edited' }, { status: 400 });
        }

        let patch = writeClient.patch(dispatchId).set({ updatedAt: new Date().toISOString() });

        // Initialize with existing data
        let normalizedItems = existing?.dispatchedItems || [];
        let peopleFed = existing?.peopleFed || 0;
        let dispatchTypeId = resolveRef(existing.dispatchType);
        let siteId = resolveRef(existing.sourceSite);

        // ✅ CRITICAL: Track if we're completing the dispatch
        const wasCompleted = existing?.evidenceStatus === 'complete';
        const willBeCompleted = updateData.evidenceStatus === 'complete' ||
            (updateData.status === 'completed' && !wasCompleted);

        // simple fields
        if (updateData.dispatchDate) patch = patch.set({ dispatchDate: updateData.dispatchDate });

        // Handle evidenceStatus and status updates
        if (updateData.evidenceStatus) {
            patch = patch.set({ evidenceStatus: updateData.evidenceStatus });
        }

        if (updateData.status) {
            patch = patch.set({ status: updateData.status });
        }

        // ✅ SYNC COMPLETION FIELDS WHEN COMPLETING
        if (willBeCompleted && !wasCompleted) {
            logger.debug('🔄 Syncing completion fields for dispatch completion');
            patch = patch.set({
                evidenceStatus: 'complete',
                status: 'completed'
            });

            if (!updateData.completedAt) {
                patch = patch.set({ completedAt: new Date().toISOString() });
            }
        }

        if (updateData.hasOwnProperty('peopleFed')) {
            const newPeopleFed = Number(updateData.peopleFed) || 0;
            patch = patch.set({ peopleFed: newPeopleFed });
            peopleFed = newPeopleFed;
        }

        if (updateData.notes) patch = patch.set({ notes: updateData.notes });

        // references - robustly resolve to string ids
        if (updateData.dispatchType) {
            const ref = resolveRef(updateData.dispatchType);
            if (ref) {
                patch = patch.set({ dispatchType: { _type: 'reference', _ref: ref } });
                dispatchTypeId = ref;
            }
        }

        if (updateData.sourceSite) {
            const ref = resolveRef(updateData.sourceSite);
            if (ref) {
                patch = patch.set({ sourceSite: { _type: 'reference', _ref: ref } });
                siteId = ref;
            }
        }

        if (updateData.dispatchedBy) {
            const ref = resolveRef(updateData.dispatchedBy);
            if (ref) {
                patch = patch.set({ dispatchedBy: { _type: 'reference', _ref: ref } });
            }
        } else if (session?.user?.id) {
            patch = patch.set({ dispatchedBy: { _type: 'reference', _ref: session.user.id } });
        }

        // dispatchedItems - ensure _ref is a string and include unitPrice, totalCost, and sourceBin
        if (updateData.dispatchedItems) {
            normalizedItems = (updateData.dispatchedItems || []).map((item: any) => {
                const stockRef = resolveRef(item.stockItem) || resolveRef(item.stockItem?._ref) || resolveRef(item.stockItem?._id);
                const binRef = item.sourceBin ? resolveRef(item.sourceBin) || resolveRef(item.sourceBin?._ref) || resolveRef(item.sourceBin?._id) : null;

                const unitPrice = Number(item.unitPrice) || 0;
                const dispatchedQuantity = Number(item.dispatchedQuantity) || 0;
                const totalCost = unitPrice * dispatchedQuantity;

                const itemData: any = {
                    _type: 'DispatchedItem',
                    _key: item._key || uuidv4(),
                    stockItem: {
                        _type: 'reference',
                        _ref: stockRef,
                    },
                    dispatchedQuantity: dispatchedQuantity,
                    unitPrice: unitPrice,
                    totalCost: totalCost,
                    notes: item.notes || '',
                };

                // Add sourceBin if provided
                if (binRef) {
                    itemData.sourceBin = {
                        _type: 'reference',
                        _ref: binRef
                    };
                }

                return itemData;
            });
            patch = patch.set({ dispatchedItems: normalizedItems });
        }

        // Recalculate total cost and cost per person
        const totalCost = normalizedItems.reduce((sum: number, item: any) => sum + (Number(item.totalCost) || 0), 0);
        const costPerPerson = peopleFed > 0 ? totalCost / peopleFed : 0;

        // Set the final calculated grand totals
        patch = patch.set({ totalCost: totalCost });
        patch = patch.set({ costPerPerson: costPerPerson });

        // Recalculate selling price and total sales if needed
        if ((updateData.dispatchType || updateData.sourceSite) && dispatchTypeId && siteId) {
            const sellingPrice = await getSellingPriceForSite(dispatchTypeId, siteId);
            const totalSales = peopleFed > 0 ? peopleFed * sellingPrice : 0;

            patch = patch.set({ sellingPrice: sellingPrice });
            patch = patch.set({ totalSales: totalSales });
        } else if (updateData.hasOwnProperty('peopleFed') && existing.sellingPrice) {
            // Only update total sales if peopleFed changed and we have a selling price
            const totalSales = peopleFed > 0 ? peopleFed * existing.sellingPrice : 0;
            patch = patch.set({ totalSales: totalSales });
        }

        if (updateData.attachments) {
            patch = patch.set({ attachments: updateData.attachments });
        }

        if (updateData.completedAt && updateData.completedAt !== existing.completedAt) {
            patch = patch.set({ completedAt: updateData.completedAt });
        }

        // Validate items have source bins before completing
        if (willBeCompleted && !wasCompleted) {
            // Get the dispatch items to validate
            const validationQuery = groq`*[_type == "DispatchLog" && _id == $id][0] {
                "dispatchedItems": dispatchedItems[]{
                    "hasBin": defined(sourceBin._ref),
                    "quantity": dispatchedQuantity
                }
            }`;

            const validation = await client.fetch(validationQuery, { id: dispatchId });

            if (validation?.dispatchedItems) {
                const itemsWithoutBins = validation.dispatchedItems.filter((item: any) => !item.hasBin);
                if (itemsWithoutBins.length > 0) {
                    console.error(`❌ Dispatch ${dispatchId} has ${itemsWithoutBins.length} items without source bins`);
                    return NextResponse.json({
                        error: 'Cannot complete dispatch: Some items are missing source bins',
                        details: `${itemsWithoutBins.length} items need to have bins assigned`
                    }, { status: 400 });
                }
            }

            // ✅ REMOVED: Do NOT call updateStockForTransaction here
            // This was causing double deductions
        }

        const result = await patch.commit();

        // ✅ Update stock if dispatch is completed (ONLY HERE, not in validation)
        if (willBeCompleted && !wasCompleted) {
            logger.debug('📦 Updating stock for completed dispatch:', result.dispatchNumber);
            await updateStockForTransaction('dispatch', dispatchId);
        }

        await logSanityInteraction(
            'update',
            `Updated dispatch: ${existing.dispatchNumber || dispatchId}`,
            'DispatchLog',
            dispatchId,
            session.user.id,
            true
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to update dispatch:', error);
        return NextResponse.json({ error: 'Failed to update dispatch' }, { status: 500 });
    }
}

// --- DELETE single dispatch ---
export async function DELETE(request: Request, { params }: { params: Promise<{ dispatchId: string }> }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { dispatchId } = await params;

        if (!dispatchId) {
            return NextResponse.json({ error: 'Dispatch ID is required' }, { status: 400 });
        }

        // prevent deletion if already completed
        const existing = await client.fetch(`*[_type=="DispatchLog" && _id == $id][0]{ evidenceStatus }`, { id: dispatchId });
        if (existing?.evidenceStatus === 'complete') {
            return NextResponse.json({ error: 'Completed dispatch cannot be deleted' }, { status: 400 });
        }

        await writeClient.delete(dispatchId);

        await logSanityInteraction(
            'delete',
            `Deleted dispatch: ${dispatchId}`,
            'DispatchLog',
            dispatchId,
            session.user.id,
            true
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete dispatch:', error);
        return NextResponse.json({ error: 'Failed to delete dispatch' }, { status: 500 });
    }
}