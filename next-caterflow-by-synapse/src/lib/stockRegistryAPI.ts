import { logger } from '@/lib/logger';
/**
 * Client-side API for stock registry updates
 * Calls server-side API routes instead of using writeClient directly
 */

export async function bulkUpdateStockRegistryAPI(
	updates: Array<{
		stockItemId: string;
		binId: string;
		quantity: number;
		transactionType: 'procurement' | 'dispatch' | 'transfer' | 'inventoryCount' | 'adjustment';
		transactionId: string;
		isAbsolute?: boolean;
	}>,
	options?: {
		onProgress?: (progress: { processed: number; total: number }) => void;
		maxRetries?: number;
	}
): Promise<{
	success: number;
	failed: number;
}> {
	const maxRetries = options?.maxRetries || 3;
	let retryCount = 0;

	while (retryCount <= maxRetries) {
		try {
			logger.debug(`📤 Calling API for ${updates.length} registry updates (attempt ${retryCount + 1}/${maxRetries + 1})`);

			const response = await fetch('/api/stock/registry/bulk-update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ updates }),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || `API returned ${response.status}`);
			}

			const result = await response.json();

			if (result.success) {
				logger.debug(`✅ API call successful: ${result.results.success} succeeded, ${result.results.failed} failed`);
				return result.results;
			} else {
				throw new Error(result.error || 'API returned unsuccessful');
			}

		} catch (error) {
			console.error(`❌ API call failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
			retryCount++;

			if (retryCount <= maxRetries) {
				logger.debug(`🔄 Retrying in ${1000 * retryCount}ms...`);
				await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
			} else {
				console.error('❌ All API retries failed');
				return { success: 0, failed: updates.length };
			}
		}
	}

	return { success: 0, failed: updates.length };
}