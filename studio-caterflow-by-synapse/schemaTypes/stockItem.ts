// schemas/stockItem.ts
import { defineType, defineField, ValidationContext } from 'sanity';
import client from '../lib/client';

const isUniqueSku = async (sku: string | undefined, context: ValidationContext) => {
    const { document, getClient } = context;
    if (!sku) {
        return true;
    }

    const id = document?._id.replace('drafts.', '');
    const client = getClient({ apiVersion: '2025-08-20' });

    const query = `
        !defined(*[_type == "StockItem" && sku == $sku && _id != $draft && _id != $published][0]._id)
    `;

    const params = {
        draft: `drafts.${id}`,
        published: id,
        sku,
    };

    const result = await client.fetch(query, params);
    return result;
};

export default defineType({
    name: 'StockItem',
    title: 'Stock Item',
    type: 'document',
    fields: [
        defineField({
            name: 'name',
            title: 'Item Name',
            type: 'string',
            validation: (Rule) => Rule.required(),
        }),
        defineField({
            name: 'sku',
            title: 'SKU (Stock Keeping Unit)',
            type: 'string',
            readOnly: ({ document }) => !!document?.sku,
            description: 'A unique identifier for this stock item.',
            initialValue: async () => {
                const query = `
                    *[_type == "StockItem"]|order(_createdAt desc)[0]{
                        sku
                    }
                `;
                const lastItem = await client.fetch(query);
                let nextNumber = 1;
                if (lastItem && lastItem.sku) {
                    const lastNumber = parseInt(lastItem.sku.split('-')[1]);
                    if (!isNaN(lastNumber)) {
                        nextNumber = lastNumber + 1;
                    }
                }
                const paddedNumber = String(nextNumber).padStart(3, '0');
                return `sku-${paddedNumber}`;
            },
        }),
        defineField({
            name: 'itemType',
            title: 'Item Type',
            type: 'string',
            options: {
                list: [
                    { title: 'Food Item', value: 'food' },
                    { title: 'Non-Food Item', value: 'nonFood' },
                ],
            },
            validation: (Rule) => Rule.required(),
        }),
        defineField({
            name: 'category',
            title: 'Category',
            type: 'reference',
            to: [{ type: 'Category' }],
            validation: (Rule) => Rule.required(),
        }),
        defineField({
            name: 'unitOfMeasure',
            title: 'Unit of Measure',
            type: 'string',
            options: {
                list: [
                    { title: 'Kilogram (kg)', value: 'kg' },
                    { title: 'Gram (g)', value: 'g' },
                    { title: 'Liter (l)', value: 'l' },
                    { title: 'Milliliter (ml)', value: 'ml' },
                    { title: 'Each', value: 'each' },
                    { title: 'Box', value: 'box' },
                    { title: 'Case', value: 'case' },
                    { title: 'Bag', value: 'bag' },
                ],
            },
            validation: (Rule) => Rule.required(),
        }),
        defineField({
            name: 'imageUrl',
            title: 'Image URL',
            type: 'url',
            description: 'URL to the stock item image.',
        }),
        defineField({
            name: 'description',
            title: 'Description',
            type: 'text',
            rows: 3,
        }),
        defineField({
            name: 'unitPrice',
            title: 'Unit Price',
            type: 'number',
            validation: (Rule) => Rule.required().min(0),
            description: 'Price per unit.',
        }),
        defineField({
            name: 'isVATApplicable',
            title: 'VAT Applicable',
            type: 'boolean',
            initialValue: true,
            description: 'Untick for zero-rated or exempt items. Reports charge VAT on every item unless this is explicitly off.',
        }),
        defineField({
            name: 'suppliers',
            title: 'Suppliers',
            type: 'array',
            of: [
                {
                    type: 'reference',
                    to: [{ type: 'Supplier' }],
                },
            ],
            description: 'List of suppliers that provide this item.',
        }),
        defineField({
            name: 'minimumStockLevel',
            title: 'Minimum Stock Level',
            type: 'number',
            description: 'Set a minimum quantity to trigger low stock alerts.',
            validation: (Rule) => Rule.required().min(0),
        }),
        defineField({
            name: 'reorderQuantity',
            title: 'Reorder Quantity',
            type: 'number',
            description: 'Suggested quantity to reorder when stock is low.',
            validation: (Rule) => Rule.min(0),
        }),
    ],
    preview: {
        select: {
            title: 'name',
            subtitle: 'sku',
            media: 'imageUrl',
            minStock: 'minimumStockLevel',
            unit: 'unitOfMeasure',
        },
        prepare({ title, subtitle, media, minStock, unit }) {
            return {
                title: title,
                subtitle: `${subtitle || 'No SKU'} | Min: ${minStock || 0} ${unit || ''}`,
                media: media,
            };
        },
    },
    orderings: [
        {
            name: 'nameAsc',
            title: 'Name (A-Z)',
            by: [{ field: 'name', direction: 'asc' }],
        },
        {
            name: 'nameDesc',
            title: 'Name (Z-A)',
            by: [{ field: 'name', direction: 'desc' }],
        },
        {
            name: 'skuAsc',
            title: 'SKU (Ascending)',
            by: [{ field: 'sku', direction: 'asc' }],
        },
        {
            name: 'minStockLevelAsc',
            title: 'Min Stock Level (Low to High)',
            by: [{ field: 'minimumStockLevel', direction: 'asc' }],
        },
        {
            name: 'minStockLevelDesc',
            title: 'Min Stock Level (High to Low)',
            by: [{ field: 'minimumStockLevel', direction: 'desc' }],
        },
        {
            name: 'createdAt',
            title: 'Newest First',
            by: [{ field: '_createdAt', direction: 'desc' }],
        },
        {
            name: 'updatedAt',
            title: 'Recently Updated',
            by: [{ field: '_updatedAt', direction: 'desc' }],
        },
    ],
});