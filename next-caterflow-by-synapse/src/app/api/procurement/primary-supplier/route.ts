import { withInvalidation } from '@/lib/lookupCache';
// src/app/api/procurement/primary-supplier/route.ts
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

        // Optional: verify supplier exists
        const supplierExists = await client.fetch(
            groq`*[_type=="Supplier" && _id==$supplierId][0]`,
            { supplierId }
        );
        if (!supplierExists) {
            return NextResponse.json(
                { error: 'Supplier does not exist' },
                { status: 404 }
            );
        }

        const result = await writeClient
            .patch(itemId)
            .set({
                primarySupplier: {
                    _type: 'reference',
                    _ref: supplierId,
                },
            })
            .commit();

        return NextResponse.json({ success: true, updatedItem: result });
    } catch (error) {
        console.error('Failed to set primary supplier:', error);
        return NextResponse.json(
            { error: 'Failed to set primary supplier' },
            { status: 500 }
        );
    }
}

export const POST = withInvalidation(_POST, ['stock-items']);
