import { logger } from '@/lib/logger';
// src/app/api/approvals/route.ts - UPDATED
import { NextResponse } from 'next/server';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { getUserSiteInfo } from '@/lib/siteFiltering';

// Purchase orders pending approval - SIMPLIFIED and FIXED
const purchaseOrderApprovalQuery = (siteFilter: string) => groq`
  *[_type == "PurchaseOrder" && status == "pending-approval" ${siteFilter}] {
    _id,
    _type,
    _createdAt,
    "createdAt": _createdAt,
    "title": "Approve Purchase Order",
    "description": "Purchase order for items",
    "priority": "high",
    "site": site->{name, _id},
    "poNumber": poNumber,
    "orderedBy": orderedBy->{ // FIXED: Make sure to fetch the user object
      _id,
      name,
      email
    },
    orderedItems[]{
        _key,
        orderedQuantity,
        unitPrice,
        "stockItem": stockItem->{name, unitOfMeasure},
        "supplier": supplier->{name}
    }
  }
`;

// Internal transfers pending approval - SIMPLIFIED and FIXED
const internalTransferApprovalQuery = (siteFilter: string) => groq`
  *[_type == "InternalTransfer" && status == "pending-approval" ${siteFilter}] {
    _id,
    _type,
    _createdAt,
    "createdAt": _createdAt,
    "title": "Approve Internal Transfer",
    "description": "Transfer request from " + coalesce(fromBin->site->name, "Unknown") + " to " + coalesce(toBin->site->name, "Unknown"),
    "priority": "high",
    "fromSite": fromBin->site->{name, _id},
    "toSite": toBin->site->{name, _id},
    "fromBin": fromBin->{name, _id, site->{name, _id}},
    "toBin": toBin->{name, _id, site->{name, _id}},
    "transferredBy": transferredBy->{ // FIXED: Make sure to fetch the user object
      _id,
      name,
      email
    },
    "transferredItems": items[]{
        _key,
        transferredQuantity,
        "stockItem": stockItem->{name, unitOfMeasure}
    },
    transferNumber,
    transferDate,
    notes
  }
`;

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userSite = searchParams.get('userSite');
        const userRole = searchParams.get('userRole');

        logger.debug('Approvals API called with:', { userRole, userSite });

        let siteFilter = '';

        if (userRole === 'siteManager' && userSite) {
            logger.debug('Building site filter for site manager with site:', userSite);
            siteFilter = `&& site._ref == "${userSite}"`;
        } else if (userRole === 'admin' || userRole === 'auditor' || userRole === 'procurer') {
            siteFilter = '';
        } else {
            return NextResponse.json([]);
        }

        logger.debug('Site filter being used:', siteFilter);

        // Fetch both types of approvals
        const [purchaseOrders, internalTransfers] = await Promise.all([
            client.fetch(purchaseOrderApprovalQuery(siteFilter)),
            client.fetch(internalTransferApprovalQuery('')), // Transfers filtered client-side
        ]);

        // Add debug logging
        logger.debug('Purchase orders raw data:', JSON.stringify(purchaseOrders, null, 2));
        logger.debug('Internal transfers raw data:', JSON.stringify(internalTransfers, null, 2));

        let approvals = [...purchaseOrders, ...internalTransfers];

        logger.debug('Raw approvals fetched:', {
            purchaseOrders: purchaseOrders.length,
            internalTransfers: internalTransfers.length,
            total: approvals.length
        });

        // Normalize items with better debugging
        approvals = approvals.map((approval: any) => {
            if (approval._type === 'PurchaseOrder') {
                const supplierNames = [...new Set((approval.orderedItems || []).map((i: any) => i.supplier?.name).filter(Boolean))];

                logger.debug('PO approval:', {
                    poNumber: approval.poNumber,
                    orderedBy: approval.orderedBy,
                    orderedByName: approval.orderedBy?.name,
                    hasOrderedBy: !!approval.orderedBy
                });

                return {
                    ...approval,
                    siteName: approval.site?.name || 'Unknown Site',
                    description: supplierNames.length > 0
                        ? `Purchase order from ${supplierNames.join(', ')}`
                        : (approval.description || 'Purchase order'),
                    supplierNames: supplierNames.join(', '),
                    // Extract the name from orderedBy object
                    requestedBy: approval.orderedBy?.name || 'Unknown'
                };
            } else if (approval._type === 'InternalTransfer') {
                logger.debug('Transfer approval:', {
                    transferNumber: approval.transferNumber,
                    transferredBy: approval.transferredBy,
                    transferredByName: approval.transferredBy?.name,
                    hasTransferredBy: !!approval.transferredBy
                });

                return {
                    ...approval,
                    siteName: approval.fromSite?.name || 'Unknown Site',
                    // Extract the name from transferredBy object
                    requestedBy: approval.transferredBy?.name || 'Unknown'
                };
            }
            return approval;
        });

        // Additional client-side filtering for site managers
        if (userRole === 'siteManager' && userSite) {
            approvals = approvals.filter((approval: any) => {
                if (approval._type === 'PurchaseOrder') {
                    return approval.site?._id === userSite;
                }
                if (approval._type === 'InternalTransfer') {
                    return approval.fromSite?._id === userSite;
                }
                return false;
            });

            logger.debug('After site manager filtering:', approvals.length, 'approvals');
        }

        // Sort by creation date, newest first
        approvals.sort((a: any, b: any) => new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime());

        logger.debug('Final approvals to return (first 2):', approvals.slice(0, 2));

        return NextResponse.json(approvals);
    } catch (error: any) {
        console.error('Failed to fetch pending approvals:', error);
        return NextResponse.json({ error: 'Failed to fetch pending approvals', details: error.message }, { status: 500 });
    }
}