import { withInvalidation } from '@/lib/lookupCache';
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

async function _POST(request: Request) {
    try {
        const { itemId, supplierId } = await request.json();

        if (!itemId || !supplierId) {
            return NextResponse.json(
                { error: 'Item ID and Supplier ID are required' },
                { status: 400 }
            );
        }

        // Verify Supplier exists
        const supplier = await client.fetch(
            groq`*[_type == "Supplier" && _id == $supplierId][0]`,
            { supplierId }
        );
        if (!supplier) {
            return NextResponse.json(
                { error: 'Supplier not found' },
                { status: 404 }
            );
        }

        // Verify StockItem exists
        const stockItem = await client.fetch(
            groq`*[_type == "StockItem" && _id == $itemId][0] {
        _id,
        suppliers[]->{_id},
        primarySupplier->{_id}
      }`,
            { itemId }
        );

        if (!stockItem) {
            return NextResponse.json(
                { error: 'Stock item not found' },
                { status: 404 }
            );
        }

        // Check if supplier already exists for this item
        const exists = stockItem.suppliers?.some((s: any) => s._id === supplierId);
        if (exists) {
            return NextResponse.json(
                { success: true, message: 'Supplier already exists for this item' }
            );
        }

        // Append supplier reference
        const result = await writeClient
            .patch(itemId)
            .append('suppliers', [{ _ref: supplierId, _type: 'reference' }])
            .commit();

        return NextResponse.json({ success: true, updatedItem: result });
    } catch (error: any) {
        console.error('Failed to add supplier:', error);
        return NextResponse.json(
            {
                error: 'Failed to add supplier',
                details: error?.message || String(error)
            },
            { status: 500 }
        );
    }
}

export const POST = withInvalidation(_POST, ['stock-items']);
