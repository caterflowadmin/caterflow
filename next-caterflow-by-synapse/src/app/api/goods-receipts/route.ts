import { logger } from '@/lib/logger';
// src/app/api/goods-receipts/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserSiteInfo, buildGoodsReceiptSiteFilter } from '@/lib/siteFiltering';
import { getArchivedGoodsReceipts } from '@/lib/archiveQueries';
import { getMaxSequenceNumber } from '@/lib/archiveService';
import { mergeById } from '@/lib/financialReport';

const getNextReceiptNumber = async (): Promise<string> => {
    try {
        // 1. Get max from Sanity
        const query = groq`*[_type == "GoodsReceipt"].receiptNumber`;
        const allReceiptNumbers = await client.fetch(query);

        let maxNumber = 0;

        if (allReceiptNumbers && allReceiptNumbers.length > 0) {
            allReceiptNumbers.forEach((receiptNumber: string) => {
                if (receiptNumber && receiptNumber.startsWith('GR-')) {
                    const numberPart = receiptNumber.split('-')[1];
                    const currentNumber = parseInt(numberPart);
                    if (!isNaN(currentNumber) && currentNumber > maxNumber) {
                        maxNumber = currentNumber;
                    }
                }
            });
        }

        // 2. Check MongoDB archived max (answer 7b)
        try {
            const mongoMax = await getMaxSequenceNumber('GoodsReceipt');
            if (mongoMax > maxNumber) maxNumber = mongoMax;
        } catch { /* MongoDB unavailable — use Sanity max */ }

        const nextNumber = maxNumber + 1;
        const newReceiptNumber = `GR-${String(nextNumber).padStart(5, '0')}`;

        const checkQuery = groq`count(*[_type == "GoodsReceipt" && receiptNumber == $newNumber])`;
        const existingCount = await client.fetch(checkQuery, { newNumber: newReceiptNumber });

        if (existingCount > 0) {
            return `GR-${String(nextNumber + 1).padStart(5, '0')}`;
        }

        return newReceiptNumber;
    } catch (error) {
        console.error('Error generating receipt number:', error);
        const timestamp = new Date().getTime();
        return `GR-${String(timestamp).slice(-5)}`;
    }
};

// Helper function to extract supplier names from ordered items
const extractSupplierNames = (orderedItems: any[]): string => {
    if (!orderedItems || orderedItems.length === 0) return 'No suppliers';

    const supplierNames = orderedItems
        .map((item: any) => item.supplier?.name)
        .filter((name: string | undefined) => name && name.trim() !== '');

    const uniqueSupplierNames = [...new Set(supplierNames)];

    if (uniqueSupplierNames.length === 0) return 'No suppliers';
    if (uniqueSupplierNames.length <= 2) return uniqueSupplierNames.join(', ');

    return `${uniqueSupplierNames.slice(0, 2).join(', ')} +${uniqueSupplierNames.length - 2} more`;
};

// Helper function to resolve references
const resolveRef = (val: any): string | null => {
    if (!val && val !== 0) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
        if (typeof val._ref === 'string') return val._ref;
        if (typeof val._id === 'string') return val._id;
    }
    return null;
};

export async function GET() {
    try {
        const userSiteInfo = await getUserSiteInfo();
        const siteFilter = buildGoodsReceiptSiteFilter(userSiteInfo);

        logger.debug('🔍 Goods Receipt - User Site Info:', {
            userId: userSiteInfo.userId,
            userRole: userSiteInfo.userRole,
            userSiteId: userSiteInfo.userSiteId,
            canAccessMultipleSites: userSiteInfo.canAccessMultipleSites,
            siteFilter
        });

        const query = groq`*[_type == "GoodsReceipt" ${siteFilter}] | order(receiptDate desc) {
            _id,
            receiptNumber,
            receiptDate,
            status,
            evidenceStatus,
            notes,
            createdAt,
            updatedAt,
            completedAt,
            "purchaseOrder": purchaseOrder->{
                _id,
                poNumber,
                status,
                orderDate,
                totalAmount,
                "site": site->{
                    _id,
                    name,
                    location,
                    contactNumber
                },
                "supplier": supplier->{
                    _id,
                    name,
                    contactPerson,
                    phoneNumber,
                    email
                },
                orderedItems[]{
                    _key,
                    orderedQuantity,
                    unitPrice,
                    totalPrice,
                    stockItem->{
                        _id,
                        name,
                        sku,
                        unitPrice
                    },
                    supplier->{
                        _id,
                        name,
                        contactPerson,
                        phoneNumber,
                        email
                    }
                }
            },
            // Document-level receivingBin (legacy support)
            receivingBin->{
                _id,
                name,
                "site": site->{
                    _id,
                    name
                }
            },
            "receivedItems": receivedItems[] {
                _key,
                orderedQuantity,
                receivedQuantity,
                batchNumber,
                expiryDate,
                condition,
                unitPrice,
                totalPrice,
                // ✅ Item-level receiving bin
                receivingBin->{
                    _id,
                    name,
                    binType,
                    "site": site->{
                        _id,
                        name
                    }
                },
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
            },
            "attachments": attachments[]->{
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
            }
        }`;

        const goodsReceipts = await client.fetch(query);

        logger.debug(`📊 Found ${goodsReceipts?.length || 0} goods receipts after site filtering`);

        // Filter out invalid receipts (missing purchase order)
        const validReceipts = goodsReceipts.filter((receipt: any) =>
            receipt.purchaseOrder !== null
        );

        // Transform old receipts to include item-level bins if missing
        const transformedReceipts = validReceipts.map((receipt: any) => {
            // For old receipts with document-level receivingBin but no item-level bins
            if (receipt.receivingBin && !receipt.receivedItems?.every((item: any) => item.receivingBin)) {
                logger.debug(`🔄 Transforming old receipt ${receipt.receiptNumber} to item-level bin structure`);

                return {
                    ...receipt,
                    receivedItems: (receipt.receivedItems || []).map((item: any) => ({
                        ...item,
                        receivingBin: item.receivingBin || receipt.receivingBin
                    }))
                };
            }

            return receipt;
        });

        // Add supplier names to receipts
        const processedReceipts = transformedReceipts.map((receipt: any) => {
            const supplierNames = receipt.purchaseOrder?.orderedItems
                ? extractSupplierNames(receipt.purchaseOrder.orderedItems)
                : 'No suppliers';
            return { ...receipt, supplierNames };
        });

        // ── Fetch archived goods receipts from MongoDB ──
        let archivedReceipts: any[] = [];
        try {
            const raw = await getArchivedGoodsReceipts({
                userSiteId: userSiteInfo.userSiteId,
                canAccessMultipleSites: userSiteInfo.canAccessMultipleSites,
            });
            archivedReceipts = raw.map(r => ({
                ...r,
                _id: r._sanityId || r._id?.toString(),
                _isArchived: true,
                supplierNames: r.purchaseOrder?.orderedItems
                    ? extractSupplierNames(r.purchaseOrder.orderedItems)
                    : 'No suppliers',
            }));
        } catch (mongoErr) {
            console.warn('⚠️  Could not fetch archived goods receipts from MongoDB:', mongoErr);
        }

        // Merge and sort by receiptDate descending
        const merged = mergeById(processedReceipts, archivedReceipts).sort(
            (a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime()
        );

        return NextResponse.json(merged);
    } catch (error) {
        console.error('Failed to fetch goods receipts:', error);
        return NextResponse.json(
            { error: 'Failed to fetch goods receipts' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return NextResponse.json(
                { error: 'User not authenticated' },
                { status: 401 }
            );
        }

        const payload = await request.json();
        const { _id, ...createData } = payload;

        logger.debug('goods-receipt/route.ts - 📥 Receiving goods receipt creation with payload:', {
            status: payload.status,
            receiptNumber: payload.receiptNumber,
            hasStatus: 'status' in payload,
            receivedItemsCount: payload.receivedItems?.length || 0
        });

        // Process receivedItems to include receivingBin references at item level
        const processedReceivedItems = (createData.receivedItems || []).map((item: any) => {
            const processedItem: any = {
                _key: item._key || uuidv4(),
                stockItem: {
                    _type: 'reference',
                    _ref: resolveRef(item.stockItem) || resolveRef(item.stockItem?._id) || null
                },
                orderedQuantity: Number(item.orderedQuantity) || 0,
                receivedQuantity: Number(item.receivedQuantity) || 0,
                totalPrice: Number(item.totalPrice) || 0,
                unitPrice: Number(item.unitPrice) || 0,
                condition: item.condition || 'good',
                batchNumber: item.batchNumber || '',
                expiryDate: item.expiryDate || ''
            };

            // ✅ ADD ITEM-LEVEL RECEIVING BIN
            if (item.receivingBin) {
                const binRef = resolveRef(item.receivingBin) || resolveRef(item.receivingBin?._id);
                if (binRef) {
                    processedItem.receivingBin = {
                        _type: 'reference',
                        _ref: binRef
                    };
                }
            }

            return processedItem;
        });

        logger.debug('📦 Processed items with bins:', {
            totalItems: processedReceivedItems.length,
            itemsWithBins: processedReceivedItems.filter((item: any) => item.receivingBin).length,
            itemsWithoutBins: processedReceivedItems.filter((item: any) => !item.receivingBin).length
        });

        // Remove document-level receivingBin if it exists
        const { receivingBin, ...dataWithoutDocBin } = createData;

        const newDoc = {
            ...dataWithoutDocBin,
            receivedItems: processedReceivedItems,
            _type: 'GoodsReceipt',
            receiptNumber: await getNextReceiptNumber(),
            _id: uuidv4(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            evidenceStatus: 'pending',
        };

        logger.debug('📄 Final document to create:', {
            receiptNumber: newDoc.receiptNumber,
            itemCount: newDoc.receivedItems?.length || 0,
            itemsWithBins: processedReceivedItems.filter((item: any) => item.receivingBin).length,
            status: newDoc.status
        });

        const result = await writeClient.create(newDoc);

        await logSanityInteraction(
            'create',
            `Created new goods receipt: ${newDoc.receiptNumber} with ${processedReceivedItems.length} items`,
            'GoodsReceipt',
            result._id,
            session.user.email || 'system',
            true
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to create goods receipt:', error);
        return NextResponse.json(
            { error: 'Failed to create goods receipt', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}