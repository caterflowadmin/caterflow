import { cachedLookup } from '@/lib/lookupCache';
import { withInvalidation } from '@/lib/lookupCache';
// src/app/api/suppliers/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { logSanityInteraction } from '@/lib/sanityLogger';

export async function GET() {
    try {
        const query = groq`*[_type == "Supplier"] | order(name asc) {
      _id, name, contactPerson, phoneNumber, email, address, terms
    }`;

        const suppliers = await cachedLookup('suppliers', [], () => client.fetch(query), 120);
        return NextResponse.json(suppliers);
    } catch (error) {
        console.error('Failed to fetch suppliers:', error);
        return NextResponse.json(
            { error: 'Failed to fetch suppliers' },
            { status: 500 }
        );
    }
}

async function _POST(request: Request) {
    try {
        const body = await request.json();

        const supplier = await writeClient.create({
            _type: 'Supplier',
            ...body
        });

        await logSanityInteraction(
            'create',
            `Created supplier: ${body.name}`,
            'Supplier',
            supplier._id,
            'system',
            true
        );

        return NextResponse.json(supplier);
    } catch (error) {
        console.error('Failed to create supplier:', error);
        return NextResponse.json(
            { error: 'Failed to create supplier' },
            { status: 500 }
        );
    }
}

async function _PATCH(request: Request) {
    try {
        const body = await request.json();
        const { _id, ...updateData } = body;

        const supplier = await writeClient
            .patch(_id)
            .set(updateData)
            .commit();

        await logSanityInteraction(
            'update',
            `Updated supplier: ${updateData.name}`,
            'Supplier',
            _id,
            'system',
            true
        );

        return NextResponse.json(supplier);
    } catch (error) {
        console.error('Failed to update supplier:', error);
        return NextResponse.json(
            { error: 'Failed to update supplier' },
            { status: 500 }
        );
    }
}

async function _DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: 'Supplier ID is required' },
                { status: 400 }
            );
        }

        await writeClient.delete(id);

        await logSanityInteraction(
            'delete',
            `Deleted supplier: ${id}`,
            'Supplier',
            id,
            'system',
            true
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete supplier:', error);
        return NextResponse.json(
            { error: 'Failed to delete supplier' },
            { status: 500 }
        );
    }
}

export const POST = withInvalidation(_POST, ['suppliers']);
export const PATCH = withInvalidation(_PATCH, ['suppliers']);
export const DELETE = withInvalidation(_DELETE, ['suppliers']);
