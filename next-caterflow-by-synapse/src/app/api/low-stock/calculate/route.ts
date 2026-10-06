import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { calculateBulkStock, getStockAsOfDate } from '@/lib/stockCalculations';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const siteId = searchParams.get('siteId') || 'all';
		const dateParam = searchParams.get('date');

		logger.debug('🔍 Low-stock calculate API called with:', { siteId, dateParam });

		// Get all stock items directly from Sanity
		const stockItemsQuery = groq`*[_type == "StockItem"] {
            _id,
            name,
            sku,
            unitPrice,
            minimumStockLevel,
            unitOfMeasure,
            "category": category->title,
            isVATApplicable
        }`;
		const stockItems = await client.fetch(stockItemsQuery);
		const stockItemIds = stockItems.map((item: any) => item._id);

		logger.debug(`📦 Found ${stockItems.length} stock items`);

		// Get bins based on site
		let bins;
		if (siteId !== 'all') {
			const binsQuery = groq`*[_type == "Bin" && site._ref == $siteId] {
                _id,
                name,
                "siteId": site._ref,
                "siteName": site->name
            }`;
			bins = await client.fetch(binsQuery, { siteId });
		} else {
			const binsQuery = groq`*[_type == "Bin"] {
                _id,
                name,
                "siteId": site._ref,
                "siteName": site->name
            }`;
			bins = await client.fetch(binsQuery);
		}

		const binIds = bins.map((bin: any) => bin._id);
		logger.debug(`🗄️ Found ${bins.length} bins`);

		let stockResults;
		let totalInventoryValue = 0;

		if (dateParam) {
			// Historical date calculation
			const targetDate = new Date(dateParam);
			logger.debug(`📅 Calculating historical stock as of: ${targetDate.toDateString()}`);
			logger.debug(`📊 Will calculate for ${stockItemIds.length} items in ${binIds.length} bins`);

			stockResults = await getStockAsOfDate(stockItemIds, binIds, targetDate);

			// If historical calculation returns empty results, try current calculation as fallback
			const nonZeroResults = Object.values(stockResults).filter((q: any) => q > 0).length;
			logger.debug(`📈 Historical calculation found ${nonZeroResults} non-zero results`);

			if (nonZeroResults === 0) {
				logger.debug('⚠️ Historical calculation returned 0 results, trying current stock...');
				stockResults = await calculateBulkStock(stockItemIds, binIds);
				logger.debug(`📊 Current calculation found ${Object.values(stockResults).filter((q: any) => q > 0).length} non-zero results`);
			}
		} else {
			// Current stock calculation (same as low-stock page)
			logger.debug('📊 Calculating current stock');
			stockResults = await calculateBulkStock(stockItemIds, binIds);
		}

		// Calculate total value
		logger.debug(`📈 Processing ${Object.keys(stockResults).length} stock results`);
		const itemsWithStock: any[] = [];

		for (const [key, quantity] of Object.entries(stockResults)) {
			if (typeof quantity === 'number' && quantity > 0) {
				const [itemId] = key.split('-');
				const item = stockItems.find((i: any) => i._id === itemId);
				if (item) {
					const itemValue = quantity * (item.unitPrice || 0);
					totalInventoryValue += itemValue;
					itemsWithStock.push({
						name: item.name,
						quantity,
						unitPrice: item.unitPrice || 0,
						value: itemValue
					});
				}
			}
		}

		logger.debug(`💰 Total inventory value: ${totalInventoryValue}`);
		logger.debug(`📦 Items with stock: ${itemsWithStock.length}`);

		// Show sample of items with stock
		if (itemsWithStock.length > 0) {
			logger.debug('📋 Sample items with stock:');
			itemsWithStock.slice(0, 5).forEach(item => {
				logger.debug(`  • ${item.name}: ${item.quantity} × $${item.unitPrice} = $${item.value}`);
			});
		}

		return NextResponse.json({
			success: true,
			summary: {
				totalInventoryValue,
				totalItems: stockItemIds.length,
				totalBins: binIds.length,
				itemsWithStock: itemsWithStock.length,
				date: dateParam || new Date().toISOString()
			},
			calculationMethod: dateParam ? 'historical' : 'current',
			debug: {
				stockItemsCount: stockItems.length,
				binsCount: bins.length,
				stockResultsCount: Object.keys(stockResults).length,
				nonZeroResults: Object.values(stockResults).filter((q: any) => q > 0).length
			}
		});

	} catch (error: any) {
		console.error('❌ Error in low-stock calculate API:', error);
		return NextResponse.json(
			{
				error: 'Calculation failed',
				details: error.message,
				stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
			},
			{ status: 500 }
		);
	}
}