import { logger } from '@/lib/logger';
// src/app/api/dispatches/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { getUserSiteInfo, buildTransactionSiteFilter } from '@/lib/siteFiltering';
import { updateStockForTransaction } from '@/lib/stockCalculations';
import { getArchivedDispatchLogs } from '@/lib/archiveQueries';
import { getMaxSequenceNumber } from '@/lib/archiveService';
import { mergeById } from '@/lib/financialReport';

// normalize refs to string ids
const resolveRef = (val: any): string | null => {
    if (!val && val !== 0) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
        if (typeof val._ref === 'string') return val._ref;
        if (typeof val._id === 'string') return val._id;
    }
    return null;
};

const getNextDispatchNumber = async (): Promise<string> => {
    try {
        // 1. Get max from Sanity
        const query = groq`*[_type == "DispatchLog" && defined(dispatchNumber)].dispatchNumber`;
        const allDispatchNumbers = await client.fetch(query);

        let maxNumber = 0;

        if (allDispatchNumbers && allDispatchNumbers.length > 0) {
            allDispatchNumbers.forEach((dispatchNumber: string) => {
                if (dispatchNumber && dispatchNumber.startsWith('DL-')) {
                    const numberPart = dispatchNumber.split('-')[1];
                    const currentNumber = parseInt(numberPart);
                    if (!isNaN(currentNumber) && currentNumber > maxNumber) {
                        maxNumber = currentNumber;
                    }
                }
            });
        }

        // 2. Also check MongoDB archived max (answer 7b)
        try {
            const mongoMax = await getMaxSequenceNumber('DispatchLog');
            if (mongoMax > maxNumber) maxNumber = mongoMax;
        } catch { /* MongoDB unavailable — use Sanity max */ }

        // Generate the next number
        const nextNumber = maxNumber + 1;
        const newDispatchNumber = `DL-${String(nextNumber).padStart(5, '0')}`;

        // Double-check this number doesn't already exist in Sanity (concurrency safety)
        const checkQuery = groq`count(*[_type == "DispatchLog" && dispatchNumber == $newNumber])`;
        const existingCount = await client.fetch(checkQuery, { newNumber: newDispatchNumber });

        if (existingCount > 0) {
            return `DL-${String(nextNumber + 1).padStart(5, '0')}`;
        }

        return newDispatchNumber;
    } catch (error) {
        console.error('Error generating dispatch number:', error);
        const timestamp = new Date().getTime();
        return `DL-${String(timestamp).slice(-5)}`;
    }
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

// GET: fetches from Sanity AND MongoDB archive, merges and returns unified list
export async function GET(request: Request) {
    // ?archived=false skips the (unbounded) MongoDB archive merge for fast operational lists.
    const includeArchived = new URL(request.url).searchParams.get('archived') !== 'false';
    const onlyArchived = new URL(request.url).searchParams.get('archived') === 'only';
    try {
        const userSiteInfo = await getUserSiteInfo();
        const siteFilter = buildTransactionSiteFilter(userSiteInfo);

        const query = groq`*[_type == "DispatchLog" ${siteFilter}] | order(dispatchDate desc) {
            _id,
            dispatchNumber,
            dispatchDate,
            status,
            evidenceStatus,
            peopleFed,
            notes,
            totalCost,
            costPerPerson,
            sellingPrice,
            totalSales,
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
            // Handle both old (sourceBin) and new (sourceSite) structures
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
                // Handle both old (no sourceBin) and new (sourceBin) structures
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
                    unitPrice,
                    isVATApplicable,
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
        }`;

        const dispatches = onlyArchived ? [] : await client.fetch(query);

        // Filter out incomplete dispatches (missing required refs)
        const validDispatches = dispatches.filter((dispatch: any) =>
            dispatch.sourceSite !== null &&
            dispatch.dispatchType !== null
        );

        // Transform old dispatches to new structure for UI consistency
        const transformedDispatches = validDispatches.map((dispatch: any) => {
            if (dispatch.sourceSite?._id && dispatch.sourceSite?._id.startsWith('drafts.')) {
                const oldSourceBin = dispatch.sourceSite;
                return {
                    ...dispatch,
                    sourceSite: oldSourceBin.site || { _id: '', name: 'Unknown Site' },
                    dispatchedItems: (dispatch.dispatchedItems || []).map((item: any) => ({
                        ...item,
                        sourceBin: item.sourceBin || oldSourceBin
                    }))
                };
            }
            return dispatch;
        });

        // ── Fetch archived dispatches from MongoDB ──
        let archivedDispatches: any[] = [];
        if (includeArchived) try {
            const raw = await getArchivedDispatchLogs({
                userSiteId: userSiteInfo.userSiteId,
                canAccessMultipleSites: userSiteInfo.canAccessMultipleSites,
            });
            archivedDispatches = raw.map(d => ({
                ...d,
                _id: d._sanityId || d._id?.toString(),
                _isArchived: true,
            }));
        } catch (mongoErr) {
            console.warn('⚠️  Could not fetch archived dispatches from MongoDB:', mongoErr);
        }

        // Merge: Sanity (recent) + MongoDB (archived), sorted by date descending
        const merged = mergeById(transformedDispatches, archivedDispatches).sort(
            (a, b) => new Date(b.dispatchDate).getTime() - new Date(a.dispatchDate).getTime()
        );

        return NextResponse.json(merged);
    } catch (error) {
        console.error('Failed to fetch dispatches:', error);
        return NextResponse.json({ error: 'Failed to fetch dispatches' }, { status: 500 });
    }
}

// --- POST create dispatch ---
// --- POST create dispatch ---
export async function POST(request: Request) {
    logger.debug('🚀 POST /api/dispatches - Starting dispatch creation');

    try {
        const session = await getServerSession(authOptions);
        logger.debug('🔐 Session check:', session ? `User ${session.user.email} authenticated` : 'No session');

        if (!session || !session.user) {
            logger.debug('❌ User not authenticated');
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const body = await request.json();
        logger.debug('📦 Request body received:', {
            hasDispatchType: !!body.dispatchType,
            hasSourceSite: !!body.sourceSite,
            hasDispatchDate: !!body.dispatchDate,
            dispatchedItemsCount: body.dispatchedItems?.length || 0,
            peopleFed: body.peopleFed
        });

        const { _id, ...createData } = body;

        if (!createData.dispatchType || !createData.sourceSite || !createData.dispatchDate) {
            logger.debug('❌ Missing required fields:', {
                dispatchType: !!createData.dispatchType,
                sourceSite: !!createData.sourceSite,
                dispatchDate: !!createData.dispatchDate
            });
            return NextResponse.json({ error: 'Missing required fields (dispatchType, sourceSite, dispatchDate)' }, { status: 400 });
        }

        logger.debug('✅ Required fields present');

        // Get selling price for this dispatch type and site
        const dispatchTypeId = resolveRef(createData.dispatchType);
        const siteId = resolveRef(createData.sourceSite);

        if (!dispatchTypeId || !siteId) {
            return NextResponse.json({ error: 'Invalid dispatch type or site reference' }, { status: 400 });
        }

        const sellingPrice = await getSellingPriceForSite(dispatchTypeId, siteId);
        logger.debug('💰 Selling price:', sellingPrice);

        // Process dispatched items with sourceBin
        logger.debug('📋 Processing dispatched items...');
        const dispatchedItems = (createData.dispatchedItems || []).map((item: any, index: number) => {
            // Explicitly convert to Number for safe calculation
            const unitPrice = Number(item.unitPrice) || 0;
            const dispatchedQuantity = Number(item.dispatchedQuantity) || 0;
            const totalCost = unitPrice * dispatchedQuantity;

            logger.debug(`   Item ${index + 1}:`, {
                stockItem: resolveRef(item.stockItem),
                sourceBin: resolveRef(item.sourceBin),
                quantity: dispatchedQuantity,
                unitPrice,
                totalCost
            });

            return {
                _type: 'DispatchedItem',
                _key: item._key || uuidv4(),
                stockItem: {
                    _type: 'reference',
                    _ref: resolveRef(item.stockItem) || resolveRef(item.stockItem?._id) || null,
                },
                sourceBin: item.sourceBin ? {
                    _type: 'reference',
                    _ref: resolveRef(item.sourceBin) || resolveRef(item.sourceBin?._id) || null,
                } : undefined,
                dispatchedQuantity: dispatchedQuantity,
                unitPrice: unitPrice,
                totalCost: totalCost,
                notes: item.notes || '',
            };
        });

        // Calculate totals
        const totalCost = dispatchedItems.reduce((sum: number, item: any) => sum + (item.totalCost || 0), 0);
        const peopleFed = Number(createData.peopleFed) || 0;
        const costPerPerson = peopleFed > 0 ? totalCost / peopleFed : 0;
        const totalSales = peopleFed > 0 ? peopleFed * (sellingPrice || 0) : 0;

        logger.debug('💰 Calculations:', {
            totalCost,
            peopleFed,
            costPerPerson,
            sellingPrice,
            totalSales
        });

        // Generate dispatch number
        logger.debug('🔢 Generating dispatch number...');
        const dispatchNumber = await getNextDispatchNumber();
        logger.debug('✅ Dispatch number generated:', dispatchNumber);

        // ✅ CRITICAL FIX: Sync completion fields
        const evidenceStatus = createData.evidenceStatus || 'pending';
        const status = createData.status || 'draft';

        // If dispatch is being created as completed, set BOTH fields
        let finalEvidenceStatus = evidenceStatus;
        let finalStatus = status;

        if (evidenceStatus === 'complete' || status === 'completed') {
            logger.debug('🔄 Syncing completion fields for new dispatch');
            finalEvidenceStatus = 'complete';
            finalStatus = 'completed';
        }

        const newDoc: any = {
            _type: 'DispatchLog',
            dispatchNumber,
            _id: uuidv4(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            dispatchDate: createData.dispatchDate,
            evidenceStatus: finalEvidenceStatus,
            status: finalStatus, // ✅ SYNCED
            peopleFed: peopleFed,
            totalCost: totalCost,
            costPerPerson: costPerPerson,
            sellingPrice: sellingPrice,
            totalSales: totalSales,
            notes: createData.notes || '',
            dispatchType: { _type: 'reference', _ref: dispatchTypeId },
            sourceSite: { _type: 'reference', _ref: siteId },
            dispatchedBy: { _type: 'reference', _ref: resolveRef(createData.dispatchedBy) || session.user.id },
            dispatchedItems,
            attachments: createData.attachments || [],
        };

        // ✅ Set completedAt if dispatch is being created as completed
        if (finalEvidenceStatus === 'complete') {
            newDoc.completedAt = createData.completedAt || new Date().toISOString();
        }

        logger.debug('📄 Document to create:', {
            _id: newDoc._id,
            dispatchNumber: newDoc.dispatchNumber,
            evidenceStatus: newDoc.evidenceStatus,
            status: newDoc.status,
            hasDispatchType: !!newDoc.dispatchType,
            hasSourceSite: !!newDoc.sourceSite,
            sellingPrice: newDoc.sellingPrice
        });

        logger.debug('💾 Creating document in Sanity...');
        const result = await writeClient.create(newDoc);
        logger.debug('✅ Document created successfully:', {
            _id: result._id,
            dispatchNumber: result.dispatchNumber,
            evidenceStatus: result.evidenceStatus,
            status: result.status
        });

        // Only update stock if dispatch is being completed
        // (This used to compare against 'complete', but the schema value is
        // 'completed', so dispatches created as completed never deducted stock.
        // Both fields are synced above, so either identifies a completed dispatch.)
        if (result.status === 'completed') {
            logger.debug('📦 Updating stock for newly created completed dispatch');
            await updateStockForTransaction('dispatch', result._id);
        }

        logger.debug('📝 Logging interaction...');
        await logSanityInteraction(
            'create',
            `Created new dispatch: ${newDoc.dispatchNumber} with total cost: E ${totalCost.toFixed(2)}`,
            'DispatchLog',
            result._id,
            session.user.id,
            true
        );
        logger.debug('✅ Interaction logged');

        logger.debug('🎉 Dispatch creation completed successfully');
        return NextResponse.json(result);

    } catch (error) {
        console.error('❌ Failed to create dispatch:', error);

        // Log additional error details
        if (error instanceof Error) {
            console.error('📛 Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
        }

        // Check if it's a Sanity-specific error
        if (error && typeof error === 'object') {
            const sanityError = error as any;
            console.error('🏥 Sanity API error:', {
                statusCode: sanityError.statusCode,
                message: sanityError.message,
                details: sanityError.details
            });
        }
        return NextResponse.json({ error: 'Failed to create dispatch' }, { status: 500 });
    }
}

// --- PATCH update by body (legacy / optional) ---
export async function PATCH(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const body = await request.json();
        const { _id, ...updateData } = body;

        if (!_id) {
            return NextResponse.json({ error: 'Dispatch ID is required' }, { status: 400 });
        }

        // Fetch existing doc to check evidenceStatus
        const existingDispatch = await client.fetch(
            groq`*[_type == "DispatchLog" && _id == $id][0] { 
                evidenceStatus,
                status,
                sourceSite
            }`,
            { id: _id }
        );

        if (!existingDispatch) {
            return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });
        }

        // Check evidenceStatus for editability
        if (existingDispatch?.evidenceStatus === 'complete') {
            return NextResponse.json({ error: 'Dispatch is completed and cannot be edited' }, { status: 400 });
        }

        let patch = writeClient.patch(_id).set({ updatedAt: new Date().toISOString() });

        // ✅ CRITICAL: Track if we're completing the dispatch
        const wasCompleted = existingDispatch?.evidenceStatus === 'complete';
        const willBeCompleted = updateData.evidenceStatus === 'complete' ||
            (updateData.status === 'completed' && !wasCompleted);

        // Basic fields
        if (updateData.dispatchDate) patch = patch.set({ dispatchDate: updateData.dispatchDate });

        // Handle evidenceStatus and status updates - sync them when completing
        if (updateData.evidenceStatus) {
            patch = patch.set({ evidenceStatus: updateData.evidenceStatus });
        }

        if (updateData.status) {
            patch = patch.set({ status: updateData.status });
        }

        // ✅ SYNC COMPLETION FIELDS
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

        if (updateData.hasOwnProperty('peopleFed')) patch = patch.set({ peopleFed: updateData.peopleFed });
        if (updateData.notes) patch = patch.set({ notes: updateData.notes });

        // References
        if (updateData.dispatchType) {
            const ref = resolveRef(updateData.dispatchType);
            if (ref) patch = patch.set({ dispatchType: { _type: 'reference', _ref: ref } });
        }

        if (updateData.sourceSite) {
            const ref = resolveRef(updateData.sourceSite);
            if (ref) patch = patch.set({ sourceSite: { _type: 'reference', _ref: ref } });
        }

        if (updateData.dispatchedBy) {
            const ref = resolveRef(updateData.dispatchedBy);
            if (ref) patch = patch.set({ dispatchedBy: { _type: 'reference', _ref: ref } });
        } else {
            patch = patch.set({ dispatchedBy: { _type: 'reference', _ref: session.user.id } });
        }

        // Dispatched items - recalculate totals
        if (updateData.dispatchedItems) {
            const normalizedItems = (updateData.dispatchedItems || []).map((item: any) => {
                const stockRef = resolveRef(item.stockItem) || resolveRef(item.stockItem?._id) || resolveRef(item.stockItem?._ref);
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
                if (item.sourceBin) {
                    const binRef = resolveRef(item.sourceBin);
                    if (binRef) {
                        itemData.sourceBin = {
                            _type: 'reference',
                            _ref: binRef
                        };
                    }
                }

                return itemData;
            });
            patch = patch.set({ dispatchedItems: normalizedItems });

            // Recalculate total cost and cost per person
            const totalCost = normalizedItems.reduce((sum: number, item: any) => sum + (item.totalCost || 0), 0);
            const peopleFed = updateData.peopleFed || 0;
            const costPerPerson = peopleFed > 0 ? totalCost / peopleFed : 0;

            patch = patch.set({ totalCost: totalCost });
            patch = patch.set({ costPerPerson: costPerPerson });

            // Recalculate selling price and total sales if dispatch type or site changed
            if (updateData.dispatchType || updateData.sourceSite) {
                const dispatchTypeId = resolveRef(updateData.dispatchType) || existingDispatch.dispatchType?._ref;
                const siteId = resolveRef(updateData.sourceSite) || existingDispatch.sourceSite?._ref;

                if (dispatchTypeId && siteId) {
                    const sellingPrice = await getSellingPriceForSite(dispatchTypeId, siteId);
                    const totalSales = peopleFed > 0 ? peopleFed * sellingPrice : 0;

                    patch = patch.set({ sellingPrice: sellingPrice });
                    patch = patch.set({ totalSales: totalSales });
                }
            }
        }

        // Attachments
        if (updateData.attachments) {
            patch = patch.set({ attachments: updateData.attachments });
        }

        // Completion fields
        if (updateData.completedAt && updateData.completedAt !== existingDispatch.completedAt) {
            patch = patch.set({ completedAt: updateData.completedAt });
        }

        const result = await patch.commit();

        // ✅ Deduct stock only on the transition TO completed. Checking just
        // result.status re-deducted on every later edit of a document whose
        // status was 'completed' but whose evidenceStatus was not yet 'complete'
        // (the edit guard above only blocks evidenceStatus === 'complete').
        if (willBeCompleted && !wasCompleted) {
            logger.debug('📦 Updating stock for completed dispatch:', result.dispatchNumber);
            await updateStockForTransaction('dispatch', result._id);
        }

        await logSanityInteraction(
            'update',
            `Updated dispatch: ${result.dispatchNumber || _id}`,
            'DispatchLog',
            _id,
            session.user.id,
            true
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to update dispatch:', error);
        return NextResponse.json({ error: 'Failed to update dispatch' }, { status: 500 });
    }
}

// --- DELETE by query param ?id=... ---
export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Dispatch ID is required' }, { status: 400 });
        }

        // Fetch existing doc to check evidenceStatus
        const existingDispatch = await client.fetch(
            groq`*[_type == "DispatchLog" && _id == $id][0] { 
                evidenceStatus 
            }`,
            { id }
        );

        if (!existingDispatch) {
            return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });
        }

        // prevent deletion of completed dispatches
        if (existingDispatch?.evidenceStatus === 'complete') {
            return NextResponse.json({ error: 'Completed dispatch cannot be deleted' }, { status: 400 });
        }

        await writeClient.delete(id);

        await logSanityInteraction(
            'delete',
            `Deleted dispatch: ${id}`,
            'DispatchLog',
            id,
            session.user.id,
            true
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete dispatch:', error);
        return NextResponse.json({ error: 'Failed to delete dispatch' }, { status: 500 });
    }
}