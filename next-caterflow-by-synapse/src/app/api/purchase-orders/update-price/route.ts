import { withInvalidation } from '@/lib/lookupCache';
// api/purchase-orders/update-price/route.tsx
import { NextResponse } from 'next/server';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';

async function _POST(request: Request) {
    try {
        // Correctly destructure both newPrice and newQuantity
        const { poId, itemKey, newPrice, newQuantity } = await request.json();

        // Validate both newPrice and newQuantity
        if (!poId || !itemKey || newPrice === undefined || newQuantity === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Update the price and quantity on the Purchase Order document
        const poPatch = client.patch(poId).set({
            [`orderedItems[_key=="${itemKey}"].unitPrice`]: newPrice,
            [`orderedItems[_key=="${itemKey}"].orderedQuantity`]: newQuantity,
        });

        // 2. Fetch the stock item reference to update its price
        const poQuery = groq`
            *[_type == "PurchaseOrder" && _id == $poId][0] {
                orderedItems[_key == $itemKey][0] {
                    "stockItemId": stockItem._ref
                }
            }
        `;
        const poData = await client.fetch(poQuery, { poId, itemKey });
        const stockItemId = poData?.orderedItems?.stockItemId;

        // Note: It's good practice to only update the StockItem's unitPrice
        // as the ordered quantity is specific to the purchase order.
        if (!stockItemId) {
            return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
        }

        // 3. Update the price on the StockItem document
        const stockItemPatch = client.patch(stockItemId).set({
            unitPrice: newPrice,
        });

        // Use a transaction to ensure both updates succeed or fail together
        const transaction = client.transaction();
        transaction.patch(poPatch);
        transaction.patch(stockItemPatch);

        await transaction.commit();

        return NextResponse.json({ success: true, message: 'Price and quantity updated successfully' });
    } catch (error) {
        console.error('Failed to update price:', error);
        return NextResponse.json(
            { error: 'Failed to update price' },
            { status: 500 }
        );
    }
}

export const POST = withInvalidation(_POST, ['stock-items']);
