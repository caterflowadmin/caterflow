import { NextResponse } from 'next/server';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { cachedLookup } from '@/lib/lookupCache';

export async function GET() {
    try {
        const query = groq`*[_type == "Category"] {
            _id,
            title,
            description
        } | order(title asc)`;

        const categories = await cachedLookup('categories', [], () => client.fetch(query), 120);
        return NextResponse.json(categories);
    } catch (error) {
        console.error('Failed to fetch categories:', error);
        return NextResponse.json(
            { error: 'Failed to fetch categories' },
            { status: 500 }
        );
    }
}