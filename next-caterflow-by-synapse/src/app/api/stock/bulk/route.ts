// src/app/api/stock/bulk/route.ts
// Server-side stock lookup for the browser: item × bin quantities from the
// shared registry cache (and exact recalculation for missing pairs). Browser
// code must call this instead of importing `@/lib/stockCalculations`, which
// drags the Sanity client and the whole stock engine into the client bundle.
import { NextRequest, NextResponse } from 'next/server';
import { calculateBulkStock } from '@/lib/stockCalculations';

const MAX_ITEMS = 2000;
const MAX_BINS = 500;

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

export async function POST(request: NextRequest) {
  try {
    const { stockItemIds, binIds } = await request.json();

    if (!isIdList(stockItemIds) || !isIdList(binIds)) {
      return NextResponse.json({ error: 'stockItemIds and binIds must be string arrays' }, { status: 400 });
    }
    if (stockItemIds.length > MAX_ITEMS || binIds.length > MAX_BINS) {
      return NextResponse.json({ error: 'Too many ids in one request' }, { status: 413 });
    }

    const results = await calculateBulkStock(stockItemIds, binIds);
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('Error in bulk stock API:', error);
    return NextResponse.json({ error: 'Failed to calculate stock', details: error?.message }, { status: 500 });
  }
}
