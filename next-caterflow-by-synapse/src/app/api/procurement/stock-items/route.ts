import { withInvalidation } from '@/lib/lookupCache';
// src/app/api/procurement/stock-items/route.ts
import { NextResponse } from 'next/server';
import { client, writeClient } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (id) {
            // Fetch single stock item by id (client expects this shape)
            const query = groq`
        *[_type == "StockItem" && _id == $id][0] {
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
          "suppliers": suppliers[]->{
            _id,
            name,
            "isPrimary": _id == ^.primarySupplier._ref
          },
          primarySupplier->{
            _id,
            name
          },
          isArchived
        }
      `;
            const item = await client.fetch(query, { id });
            if (!item) {
                return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
            }
            return NextResponse.json(item);
        }

        // No id: return all stock items
        const allQuery = groq`
      *[_type == "StockItem"] {
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
        "suppliers": suppliers[]->{
          _id,
          name,
          "isPrimary": _id == ^.primarySupplier._ref
        },
        primarySupplier->{
          _id,
          name
        },
        isArchived
      } | order(name asc)
    `;

        const stockItems = await client.fetch(allQuery);
        return NextResponse.json(stockItems);
    } catch (error) {
        console.error('Failed to fetch stock items:', error);
        return NextResponse.json(
            { error: 'Failed to fetch stock items', details: (error as any)?.message || String(error) },
            { status: 500 }
        );
    }
}

async function _PATCH(request: Request) {
    try {
        const body = await request.json();
        const { itemId, updates } = body || {};

        if (!itemId || !updates || typeof updates !== 'object') {
            return NextResponse.json(
                { error: 'Item ID and updates are required' },
                { status: 400 }
            );
        }

        // Allowed / supported update keys and how we'll apply them
        // primarySupplier: string | null  -> reference set / unset
        // unitPrice: number >= 0
        // minimumStockLevel: number
        // reorderQuantity: number
        // name, sku, isArchived, category (category should be reference id if provided)
        const allowedKeys = new Set([
            'primarySupplier',
            'unitPrice',
            'minimumStockLevel',
            'reorderQuantity',
            'name',
            'sku',
            'isArchived',
            'category'
        ]);

        const transaction = writeClient.transaction();

        // Handle primarySupplier specially (null => unset)
        if (Object.prototype.hasOwnProperty.call(updates, 'primarySupplier')) {
            const val = updates.primarySupplier;
            if (val === null) {
                // Remove the primarySupplier reference
                transaction.patch(itemId, patch => patch.unset(['primarySupplier']));
            } else if (typeof val === 'string' && val.trim()) {
                // Set to a reference
                transaction.patch(itemId, patch =>
                    patch.set({
                        primarySupplier: { _type: 'reference', _ref: val }
                    })
                );
            } else {
                return NextResponse.json({ error: 'Invalid primarySupplier value' }, { status: 400 });
            }
        }

        // Validate and collect other allowed fields for a single .set()
        const setFields: Record<string, any> = {};

        for (const [k, v] of Object.entries(updates)) {
            if (!allowedKeys.has(k) || k === 'primarySupplier') continue;

            switch (k) {
                case 'unitPrice': {
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setFields.unitPrice = n;
                    else return NextResponse.json({ error: 'unitPrice must be a non-negative number' }, { status: 400 });
                    break;
                }
                case 'minimumStockLevel': {
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setFields.minimumStockLevel = n;
                    else return NextResponse.json({ error: 'minimumStockLevel must be a non-negative number' }, { status: 400 });
                    break;
                }
                case 'reorderQuantity': {
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) setFields.reorderQuantity = n;
                    else return NextResponse.json({ error: 'reorderQuantity must be a non-negative number' }, { status: 400 });
                    break;
                }
                case 'category': {
                    if (typeof v === 'string' && v.trim()) {
                        setFields.category = { _type: 'reference', _ref: v };
                    } else {
                        return NextResponse.json({ error: 'category must be a reference id string' }, { status: 400 });
                    }
                    break;
                }
                case 'name': {
                    if (typeof v === 'string') setFields.name = v;
                    break;
                }
                case 'sku': {
                    if (typeof v === 'string') setFields.sku = v;
                    break;
                }
                case 'isArchived': {
                    setFields.isArchived = Boolean(v);
                    break;
                }
                default:
                    break;
            }
        }

        if (Object.keys(setFields).length > 0) {
            transaction.patch(itemId, patch => patch.set(setFields));
        }

        const result = await transaction.commit();

        return NextResponse.json({ success: true, updatedItem: result });
    } catch (error) {
        console.error('Failed to update stock item:', error);
        return NextResponse.json(
            { error: 'Failed to update stock item', details: (error as any)?.message || String(error) },
            { status: 500 }
        );
    }
}

export const PATCH = withInvalidation(_PATCH, ['stock-items']);
