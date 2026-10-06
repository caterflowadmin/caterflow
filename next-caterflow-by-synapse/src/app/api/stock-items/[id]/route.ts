import { withInvalidation } from '@/lib/lookupCache';
// app/api/stock-items/[id]/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';

// --- GET single stock item ---
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;

		if (!id) {
			return NextResponse.json(
				{ error: 'Stock item ID is required' },
				{ status: 400 }
			);
		}

		const query = `*[_type == "StockItem" && _id == $id][0] {
            _id,
            name,
            sku,
            unitOfMeasure,
            unitPrice,
            minimumStockLevel,
            reorderQuantity,
            category->{
                _id,
                title
            },
            suppliers[]->{
                _id,
                name
            },
            primarySupplier->{
                _id,
                name
            }
        }`;

		const stockItem = await client.fetch(query, { id });

		if (!stockItem) {
			return NextResponse.json(
				{ error: 'Stock item not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json(stockItem);
	} catch (error) {
		console.error('Failed to fetch stock item:', error);
		return NextResponse.json(
			{ error: 'Failed to fetch stock item' },
			{ status: 500 }
		);
	}
}

// --- PATCH single stock item ---
async function _PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;

		if (!id) {
			return NextResponse.json(
				{ error: 'Stock item ID is required' },
				{ status: 400 }
			);
		}

		const body = await request.json();
		const { updates } = body;

		if (!updates || typeof updates !== 'object') {
			return NextResponse.json(
				{ error: 'Missing updates object' },
				{ status: 400 }
			);
		}

		// Only allow specific fields to be updated
		const allowedUpdates = ['unitPrice', 'name', 'sku', 'minimumStockLevel', 'reorderQuantity'];
		const updateData: any = {};

		Object.keys(updates).forEach(key => {
			if (allowedUpdates.includes(key)) {
				updateData[key] = updates[key];
			}
		});

		if (Object.keys(updateData).length === 0) {
			return NextResponse.json(
				{ error: 'No valid fields to update' },
				{ status: 400 }
			);
		}

		const result = await writeClient
			.patch(id)
			.set(updateData)
			.commit();

		return NextResponse.json(result);
	} catch (error) {
		console.error('Failed to update stock item:', error);
		return NextResponse.json(
			{ error: 'Failed to update stock item' },
			{ status: 500 }
		);
	}
}

// --- DELETE single stock item ---
async function _DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;

		if (!id) {
			return NextResponse.json(
				{ error: 'Stock item ID is required' },
				{ status: 400 }
			);
		}

		await writeClient.delete(id);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Failed to delete stock item:', error);
		return NextResponse.json(
			{ error: 'Failed to delete stock item' },
			{ status: 500 }
		);
	}
}

export const PATCH = withInvalidation(_PATCH, ['stock-items']);
export const DELETE = withInvalidation(_DELETE, ['stock-items']);
