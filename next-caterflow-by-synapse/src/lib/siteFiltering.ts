import { logger } from '@/lib/logger';
// lib/siteFiltering.ts
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export interface UserSiteInfo {
  userId: string;
  userRole: string;
  userSiteId: string | null;
  canAccessMultipleSites: boolean;
}

export async function getUserSiteInfo(request?: Request): Promise<UserSiteInfo> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    throw new Error('User not authenticated');
  }

  const userRole = session.user.role;
  const userSiteId = session.user.associatedSite?._id || null;

  // Users who can see multiple sites: admin, auditor, procurer
  const canAccessMultipleSites = ['admin', 'auditor', 'procurer'].includes(userRole);

  logger.debug('🔐 User session info:', {
    userId: session.user.id,
    userRole,
    userSiteId,
    canAccessMultipleSites
  });

  return {
    userId: session.user.id,
    userRole,
    userSiteId,
    canAccessMultipleSites
  };
}

export function buildSiteFilter(userSiteInfo: UserSiteInfo, fieldPath: string = 'site._ref'): string {
  if (userSiteInfo.canAccessMultipleSites) {
    logger.debug('🌐 Multi-site user - no filter applied');
    return ''; // No filter for multi-site users
  }

  if (userSiteInfo.userSiteId) {
    const filter = `&& ${fieldPath} == "${userSiteInfo.userSiteId}"`;
    logger.debug('📍 Single-site user filter:', filter);
    return filter;
  }

  // If user has no site association and can't access multiple sites, return no results
  logger.debug('🚫 No site access - returning false filter');
  return '&& false';
}

export function buildBinSiteFilter(userSiteInfo: UserSiteInfo): string {
  // For bin counts, we filter by the bin's site reference
  // The path in InventoryCount is: bin->site._ref
  return buildSiteFilter(userSiteInfo, 'bin->site._ref');
}

export function buildTransactionSiteFilter(userSiteInfo: UserSiteInfo): string {
  if (userSiteInfo.canAccessMultipleSites) {
    return '';
  }

  if (userSiteInfo.userSiteId) {
    return `&& (
      receivingBin->site._ref == "${userSiteInfo.userSiteId}" ||
      fromBin->site._ref == "${userSiteInfo.userSiteId}" ||
      toBin->site._ref == "${userSiteInfo.userSiteId}" ||
      sourceBin->site._ref == "${userSiteInfo.userSiteId}" ||
      sourceSite._ref == "${userSiteInfo.userSiteId}" ||
      bin->site._ref == "${userSiteInfo.userSiteId}"
    )`;
  }

  return '&& false';
}

// Add this function to your lib/siteFiltering.ts file
export function buildGoodsReceiptSiteFilter(userSiteInfo: UserSiteInfo): string {
  if (userSiteInfo.canAccessMultipleSites) {
    logger.debug('🌐 Multi-site user - no filter applied for goods receipts');
    return ''; // No filter for multi-site users
  }

  if (userSiteInfo.userSiteId) {
    const siteId = userSiteInfo.userSiteId;

    logger.debug(`📍 Building goods receipt filter for site ID: ${siteId}`);

    // Goods receipts should be visible if:
    // 1. Purchase order is for this site (through PO->site)
    // 2. OR any item-level receiving bin is for this site
    const filter = `&& (
      purchaseOrder->site._ref == "${siteId}" ||
      count(receivedItems[defined(receivingBin) && receivingBin->site._ref == "${siteId}"]) > 0
    )`;

    logger.debug('🔧 Goods receipt site filter:', filter);
    return filter;
  }

  logger.debug('🚫 No site access - returning false filter for goods receipts');
  return '&& false';
}