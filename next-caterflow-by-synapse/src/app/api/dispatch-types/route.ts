import { cachedLookup } from '@/lib/lookupCache';
import { withInvalidation } from '@/lib/lookupCache';
// src/app/api/dispatch-types/route.ts (REPLACE ENTIRE FILE)
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';


// src/app/api/dispatch-types/route.ts (UPDATE the POST and GET functions)

// GET all dispatch types
export async function GET() {
    try {
        const query = `*[_type == "DispatchType"] | order(name asc) {
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
            },
            isActive
        }`;

        const dispatchTypes = await cachedLookup('dispatch-types', [], () => client.fetch(query), 120);
        return NextResponse.json(dispatchTypes);
    } catch (error) {
        console.error('Failed to fetch dispatch types:', error);
        return NextResponse.json({ error: 'Failed to fetch dispatch types' }, { status: 500 });
    }
}

// POST create new dispatch type
async function _POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || session.user.role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, description, defaultTime, sellingPrice = 0, sitePrices = [], isActive = true } = body;

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        // Prepare sitePrices array with proper structure
        const formattedSitePrices = sitePrices.map((sp: any) => ({
            _key: sp._key || `site-price-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            _type: 'object',
            site: {
                _type: 'reference',
                _ref: sp.site._id
            },
            price: sp.price
        }));

        const newDoc = {
            _type: 'DispatchType',
            name,
            description,
            defaultTime,
            sellingPrice,
            sitePrices: formattedSitePrices,
            isActive,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const result = await writeClient.create(newDoc);
        return NextResponse.json(result);
    } catch (error) {
        console.error('Failed to create dispatch type:', error);
        return NextResponse.json({ error: 'Failed to create dispatch type' }, { status: 500 });
    }
}

export const POST = withInvalidation(_POST, ['dispatch-types']);
