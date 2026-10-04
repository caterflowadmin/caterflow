// src/app/reports/page.tsx - COMPREHENSIVE FIX: correct stock math, normalized VAT, robust filtering
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Box,
  Heading,
  Text,
  Flex,
  Spinner,
  Button,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Card,
  CardBody,
  VStack,
  HStack,
  Select,
  Input,
  InputGroup,
  InputLeftElement,
  Badge,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  useColorModeValue,
  Icon,
  Alert,
  AlertIcon,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Grid,
  GridItem,
  Progress,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Radio,
  RadioGroup,
  Stack,
  Wrap,
  WrapItem,
  Skeleton,
  SkeletonText,
} from "@chakra-ui/react";
import { useSession } from "next-auth/react";
import {
  FiDownload,
  FiSearch,
  FiCalendar,
  FiFilter,
  FiTrendingUp,
  FiPackage,
  FiTruck,
  FiRepeat,
  FiBarChart2,
  FiPieChart,
  FiUsers,
  FiShoppingCart,
  FiArchive,
  FiAlertTriangle,
  FiDollarSign,
  FiUser,
  FiRefreshCw,
  FiPercent,
  FiEye,
  FiEyeOff,
} from "react-icons/fi";

import dynamic from "next/dynamic";

// Excel export utilities
// xlsx and file-saver are loaded on demand inside exportToExcel so they stay
// out of the initial page bundle.
import {
  format,
  subDays,
  subMonths,
  startOfMonth,
  endOfMonth,
  parseISO,
  isWithinInterval,
} from "date-fns";
import { calculateBulkStock } from "@/lib/stockCalculations";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";
import {
  parseDateRangeBoundary,
  isDateWithinRange,
} from "@/lib/dateRangeUtils";
import { VAT_CONFIG } from "@/lib/vatConfig";
import FinancialSummary from "./FinancialSummary";
import { CHART_COLORS } from "./chartConstants";
import type { EnhancedAnalyticsData } from "./types";
import { ChartSkeleton } from "./skeletons";
import PeriodBar from "./PeriodBar";
import PeriodControls from "./PeriodControls";
import DrillDownDrawer from "./DrillDownDrawer";
import ReconciliationPanel from "./ReconciliationPanel";
import { ErrorCard, LoadFailureBanner } from "./DataStatus";
import {
  buildDrillRows,
  buildIntegrityRows,
  buildReconciliation,
  toSummaryShape,
  type DrillKind,
} from "@/lib/financialReport";
import {
  canManagePeriods,
  canViewFinance,
  canViewReconciliation,
} from "@/lib/reportAccess";
import { filterDataBySite } from "@/lib/reportFilters";
import {
  computeFinancials,
  dispatchSales,
  isEffectiveCount,
  isEffectiveDispatch,
  isEffectiveReceipt,
  type IntegrityIssue,
} from "@/lib/financialReport";

// Removed: unused filterTransitionStyle, filterLoadingStyle, useChartReady hook


// Charts are code-split: recharts loads the first time a chart renders.
const chartLoading = () => <ChartSkeleton />;
const StatusPieChart = dynamic(
  () => import("./charts").then((m) => m.StatusPieChart),
  { ssr: false, loading: chartLoading },
) as typeof import("./charts").StatusPieChart;
const BarChartComponent = dynamic(
  () => import("./charts").then((m) => m.BarChartComponent),
  { ssr: false, loading: chartLoading },
) as typeof import("./charts").BarChartComponent;
const VisualAnalyticsTab = dynamic(
  () => import("./charts").then((m) => m.VisualAnalyticsTab),
  { ssr: false, loading: chartLoading },
) as typeof import("./charts").VisualAnalyticsTab;
const DataExportTab = dynamic(
  () => import("./charts").then((m) => m.DataExportTab),
  { ssr: false, loading: chartLoading },
) as typeof import("./charts").DataExportTab;

// Types based on your Sanity schemas
interface AppUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  associatedSite?: { _id: string; name: string };
  isActive: boolean;
}

interface Site {
  _id: string;
  name: string;
  code: { current: string };
  location: string;
  manager?: { _id: string; name: string };
  patientCount: number;
}

interface StockItem {
  _id: string;
  name: string;
  sku: string;
  itemType: string;
  category: { _id: string; title: string };
  unitOfMeasure: string;
  unitPrice: number;
  minimumStockLevel: number;
  reorderQuantity: number;
  primarySupplier?: { _id: string; name: string };
  suppliers: Array<{ _id: string; name: string }>;
  currentStock?: number;
  isVATApplicable?: boolean; // New field for VAT applicability
}

interface PurchaseOrder {
  _id: string;
  poNumber: string;
  orderDate: string;
  status: string;
  orderedItems: Array<{
    stockItem: StockItem;
    supplier?: { _id: string; name: string };
    orderedQuantity: number;
    unitPrice: number;
    totalPrice: number;
    vatAmount?: number; // New field for VAT
    totalWithVAT?: number; // New field for total with VAT
  }>;
  totalAmount: number;
  vatAmount?: number; // New field for VAT
  totalWithVAT?: number; // New field for total with VAT
  orderedBy: AppUser;
  site: Site;
  evidenceStatus: string;
}

interface GoodsReceipt {
  _id: string;
  receiptNumber: string;
  receiptDate: string;
  status: string;
  purchaseOrder?: { _id: string; poNumber: string; site: Site };
  receivingBin: { _id: string; name: string; site: Site };
  receivedItems: Array<{
    stockItem: StockItem;
    receivedQuantity: number;
    batchNumber?: string;
    expiryDate?: string;
    condition: string;
    unitPrice?: number;
    vatAmount?: number; // New field for VAT
    totalWithVAT?: number; // New field for total with VAT
  }>;
  evidenceStatus: string;
}

interface DispatchLog {
  _id: string;
  dispatchNumber: string;
  dispatchDate: string;
  dispatchType: {
    _id: string;
    name: string;
    description: string;
    sellingPrice: number;
  };
  sourceBin: { _id: string; name: string; site: Site };
  dispatchedBy: AppUser;
  dispatchedItems: Array<{
    stockItem: StockItem;
    dispatchedQuantity: number;
    unitPrice: number;
    totalCost: number;
    vatAmount?: number; // New field for VAT
    totalWithVAT?: number; // New field for total with VAT
  }>;
  peopleFed: number;
  totalCost: number;
  vatAmount?: number; // New field for VAT
  totalWithVAT?: number; // New field for total with VAT
  costPerPerson: number;
  sellingPrice: number;
  totalSales: number;
  evidenceStatus: string;
}

interface InternalTransfer {
  _id: string;
  transferNumber: string;
  transferDate: string;
  fromBin: { _id: string; name: string; site: Site };
  toBin: { _id: string; name: string; site: Site };
  transferredBy: AppUser;
  transferredItems: Array<{
    stockItem: StockItem;
    transferredQuantity: number;
  }>;
  status: string;
  approvedBy?: AppUser;
  approvedAt?: string;
}

interface InventoryCount {
  _id: string;
  countNumber: string;
  countDate: string;
  bin: { _id: string; name: string; site: Site };
  countedBy: AppUser;
  status: string;
  countedItems: Array<{
    stockItem: StockItem;
    countedQuantity: number;
    systemQuantityAtCountTime: number;
    variance: number;
  }>;
}

interface Supplier {
  _id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
  vatNumber?: string; // New field for VAT registration
}

// Enhanced Analytics Data Interface with VAT

// OLD REPORTS INTERFACES
interface ReportData {
  [key: string]: any;
}

interface ReportConfig {
  title: string;
  description: string;
  endpoint: string;
  columns: string[];
  filters?: {
    dateRange?: boolean;
    site?: boolean;
    status?: boolean;
  };
}


// Add these helper functions after VAT_CONFIG

// Helper to get site from dispatch (compatibility layer)
const getDispatchSite = (dispatch: any): any => {
  // Try to get site from first item's bin
  const firstItemBin = dispatch.dispatchedItems?.[0]?.sourceBin;
  if (firstItemBin?.site) {
    return firstItemBin.site;
  }

  // Fallback to old structure
  return (
    dispatch.sourceSite || dispatch.sourceBin?.site || { name: "Unknown Site" }
  );
};

// Helper to get bin from goods receipt (compatibility layer)
const getGoodsReceiptBin = (receipt: any): any => {
  // Try to get bin from first item
  const firstItemBin = receipt.receivedItems?.[0]?.receivingBin;
  if (firstItemBin) {
    return firstItemBin;
  }

  // Fallback to old structure
  return receipt.receivingBin || { name: "Unknown Bin" };
};

// Helper to get site from goods receipt (compatibility layer)
const getGoodsReceiptSite = (receipt: any): any => {
  // Try to get site from first item's bin
  const firstItemBin = receipt.receivedItems?.[0]?.receivingBin;
  if (firstItemBin?.site) {
    return firstItemBin.site;
  }

  // Fallback to purchase order site
  return (
    receipt.receivingBin?.site ||
    receipt.purchaseOrder?.site || { name: "Unknown Site" }
  );
};

// ADD THIS HELPER FUNCTION HERE
const getEmptyAnalyticsData = (): EnhancedAnalyticsData => ({
  summary: {
    totalPurchaseOrders: 0,
    totalGoodsReceipts: 0,
    totalDispatches: 0,
    totalTransfers: 0,
    totalBinCounts: 0,
    totalStockItems: 0,
    totalSuppliers: 0,
    totalUsers: 0,
    totalSites: 0,
    totalInventoryValue: 0,
    totalPeopleFed: 0,
    lowStockItems: 0,
    criticalStockItems: 0,
    totalVATCollected: 0,
    totalVATPaid: 0,
    netVATLiability: 0,
  },
  purchaseOrders: {
    byStatus: [],
    bySite: [],
    byMonth: [],
    totalValue: 0,
    vatAmount: 0,
    totalWithVAT: 0,
    avgOrderValue: 0,
    topItems: [],
    statusBreakdown: {},
  },
  goodsReceipts: {
    byStatus: [],
    bySite: [],
    efficiency: 0,
    conditionBreakdown: {},
    totalValue: 0,
    vatAmount: 0,
    totalWithVAT: 0,
  },
  dispatches: {
    byType: [],
    bySite: [],
    totalPeopleFed: 0,
    totalCost: 0,
    vatAmount: 0,
    totalWithVAT: 0,
    costPerPerson: 0,
    topItems: [],
    totalSales: 0,
    salesVAT: 0,
    salesWithVAT: 0,
  },
  transfers: {
    byStatus: [],
    bySite: [],
    approvalRate: 0,
  },
  inventory: {
    byCategory: [],
    totalValue: 0,
    vatIncluded: 0,
    lowStockBreakdown: {
      critical: 0,
      warning: 0,
      healthy: 0,
    },
  },
  binCounts: {
    byStatus: [],
    accuracy: 0,
    varianceAnalysis: {
      positive: { quantity: 0, cost: 0 },
      negative: { quantity: 0, cost: 0 },
      zero: { quantity: 0, cost: 0 },
    },
  },
  financial: {
    monthlySpending: [],
    costPerPersonTrend: [],
    inventoryTurnover: 0,
    totalReceivedGoodsValue: 0,
    totalSales: 0,
    consumption: 0,
    profit: 0,
    profitPercentage: 0,
    closingStockValue: 0,
    periodPurchases: 0,
    periodConsumption: 0,
    periodSales: 0,
    openingStock: 0,
    netVariances: 0,
    vatOnPurchases: 0,
    vatOnSales: 0,
    netVATPayable: 0,
    grossProfitBeforeVAT: 0,
    grossProfitAfterVAT: 0,
  },
  suppliers: {
    performance: [],
    activeCount: 0,
    vatRegisteredCount: 0,
  },
  users: {
    byRole: [],
    activity: [],
  },
  vat: {
    summary: {
      totalOutputVAT: 0,
      totalInputVAT: 0,
      netVATPayable: 0,
      vatRate: VAT_CONFIG.ratePercentage,
    },
    breakdown: {
      purchases: { vatAmount: 0, totalWithVAT: 0 },
      sales: { vatAmount: 0, totalWithVAT: 0 },
      inventory: { vatAmount: 0, totalWithVAT: 0 },
    },
  },
});

// Add this helper function after the existing getEmptyAnalyticsData function
// This will filter any array of items by site ID on the client side
// In-memory stale-while-revalidate cache for the (range-independent) raw
// documents. Survives client-side navigation, so returning to the page shows
// the last numbers immediately while a background refresh runs.
const RAW_CACHE_TTL_MS = 5 * 60 * 1000;
let rawDataCache: { userId: string; at: number; data: { [key: string]: any[] } } | null =
  null;

const TAB_KEYS = ["overview", "charts", "export"] as const;

// Skeleton components for better loading states
const MetricSkeleton = () => (
  <Card>
    <CardBody>
      <Skeleton height="20px" mb={2} />
      <Skeleton height="30px" mb={2} />
      <Skeleton height="16px" />
    </CardBody>
  </Card>
);


const TableSkeleton = () => (
  <Card>
    <CardBody>
      <Skeleton height="24px" mb={4} width="200px" />
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} height="40px" mb={2} />
      ))}
    </CardBody>
  </Card>
);

export default function ComprehensiveReportsPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState(0);
  const [analyticsTab, setAnalyticsTab] = useState(0);

  // Analytics states
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  // Names of data sources that failed to load (shown as a banner instead of
  // silently becoming empty lists).
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [loadProgress, setLoadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Fast-path answer from /api/reports/financials, shown while the full
  // document download is still in flight.
  const [serverFin, setServerFin] = useState<ReturnType<
    typeof toSummaryShape
  > | null>(null);
  const [serverAnchor, setServerAnchor] = useState<{
    kind: "close" | "opening-balance";
    asOf: string;
    value: number;
    recordedAt?: string | null;
  } | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  // Latest period close / opening balance, read synchronously by the
  // calculation (state would lag one render behind).
  const anchorRef = useRef<typeof serverAnchor>(null);
  const loadSeqRef = useRef(0);
  const initialLoadRef = useRef(false);
  const lastScopeRef = useRef("");
  const [drill, setDrill] = useState<{ kind: DrillKind; title: string } | null>(
    null,
  );
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [analyticsData, setAnalyticsData] =
    useState<EnhancedAnalyticsData | null>(null);
  const [rawData, setRawData] = useState<{ [key: string]: any[] }>({});

  // Old Reports states
  const [loading, setLoading] = useState<{ [key: string]: boolean }>({});
  const [reportData, setReportData] = useState<{ [key: string]: ReportData[] }>(
    {},
  );
  const [filteredData, setFilteredData] = useState<{
    [key: string]: ReportData[];
  }>({});
  const [sites, setSites] = useState<any[]>([]);
  const [searchTerms, setSearchTerms] = useState<{ [key: string]: string }>({});

  // Site filtering states
  const [userSiteInfo, setUserSiteInfo] = useState<{
    userSiteId: string | null;
    userRole: string;
    canAccessMultipleSites: boolean;
    userSiteName?: string;
  }>({
    userSiteId: null,
    userRole: "",
    canAccessMultipleSites: false,
  });
  const [showSiteFilter, setShowSiteFilter] = useState(false);
  const [availableSites, setAvailableSites] = useState<any[]>([]);
  const [selectedFilterSite, setSelectedFilterSite] = useState<string | null>(
    null,
  );

  // Filter states for old reports
  const [selectedSites, setSelectedSites] = useState<{ [key: string]: string }>(
    {},
  );
  const [dateRanges, setDateRanges] = useState<{
    [key: string]: { start: string; end: string };
  }>({});

  // Date ranges for new analytics
  const [primaryDateRange, setPrimaryDateRange] = useState<{
    start: string;
    end: string;
  }>({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [comparisonDateRange, setComparisonDateRange] = useState<{
    start: string;
    end: string;
  }>({
    start: format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
    end: format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
  });
  const [compareMode, setCompareMode] = useState(false);


  const toast = useToast();

  // Theme colors
  const bgPrimary = useColorModeValue(
    "neutral.light.bg-primary",
    "neutral.dark.bg-primary",
  );
  const bgCard = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const borderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const primaryTextColor = useColorModeValue(
    "neutral.light.text-primary",
    "neutral.dark.text-primary",
  );
  const secondaryTextColor = useColorModeValue(
    "neutral.light.text-secondary",
    "neutral.dark.text-secondary",
  );
  const tableHeaderBg = useColorModeValue("gray.50", "gray.700");
  const tableRowHoverBg = useColorModeValue("gray.50", "gray.700");

  // FIXED REPORTS CONFIGURATION - using correct API endpoints
  const reportConfigs: ReportConfig[] = useMemo(
    () => [
      {
        title: "Purchase Orders",
        description: "Detailed purchase order history and status",
        endpoint: "/api/purchase-orders",
        columns: [
          "poNumber",
          "orderDate",
          "status",
          "supplierNames",
          "site.name",
          "totalAmount",
          "vatAmount",
          "totalWithVAT",
          "orderedItems",
        ],
        filters: {
          dateRange: true,
          site: true,
          status: true,
        },
      },
      {
        title: "Goods Receipts",
        description: "Goods receipt transactions and inventory updates",
        endpoint: "/api/goods-receipts",
        columns: [
          "receiptNumber",
          "receiptDate",
          "status",
          "purchaseOrder.poNumber",
          "purchaseOrder.site.name",
          "receivedItems",
          "receivingBin.name",
          "vatAmount",
          "totalWithVAT",
        ],
        filters: {
          dateRange: true,
          site: true,
          status: true,
        },
      },
      {
        title: "Dispatches",
        description: "Dispatch records and consumption tracking",
        endpoint: "/api/dispatches",
        columns: [
          "dispatchNumber",
          "dispatchDate",
          "dispatchType.name",
          "sourceBin.site.name",
          "peopleFed",
          "totalCost",
          "vatAmount",
          "totalWithVAT",
          "evidenceStatus",
          "dispatchedBy.name",
        ],
        filters: {
          dateRange: true,
          site: true,
          status: true,
        },
      },
      {
        title: "Transfers",
        description: "Internal stock transfers between bins and sites",
        endpoint: "/api/transfers",
        columns: [
          "transferNumber",
          "transferDate",
          "status",
          "fromBin.site.name",
          "toBin.site.name",
          "transferredItems",
          "requestedBy.name",
        ],
        filters: {
          dateRange: true,
          site: true,
          status: true,
        },
      },
      {
        title: "Bin Counts",
        description: "Stock counting and variance reports",
        endpoint: "/api/bin-counts",
        columns: [
          "countNumber",
          "countDate",
          "status",
          "bin.name",
          "bin.site.name",
          "countedItems",
          "totalVariance",
          "countedBy.name",
        ],
        filters: {
          dateRange: true,
          site: true,
          status: true,
        },
      },
    ],
    [],
  );

  const currentReport = activeTab > 0 ? reportConfigs[activeTab - 1] : null;

  // Use refs for the filter function to avoid circular dependencies for old reports
  const filterStateRef = useRef({
    reportData,
    dateRanges,
    selectedSites,
    searchTerms,
    reportConfigs,
  });

  // Update the ref when state changes for old reports
  useEffect(() => {
    filterStateRef.current = {
      reportData,
      dateRanges,
      selectedSites,
      searchTerms,
      reportConfigs,
    };
  }, [reportData, dateRanges, selectedSites, searchTerms, reportConfigs]);

  // Quick date range presets for better UX
  const quickDateRanges = useMemo(
    () => [
      {
        label: "This Month",
        start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
        end: format(new Date(), "yyyy-MM-dd"),
      },
      {
        label: "Last Month",
        start: format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
        end: format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"),
      },
      {
        label: "Last 30 Days",
        start: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        end: format(new Date(), "yyyy-MM-dd"),
      },
      {
        label: "Last 90 Days",
        start: format(subMonths(new Date(), 3), "yyyy-MM-dd"),
        end: format(new Date(), "yyyy-MM-dd"),
      },
    ],
    [],
  );

  // Memoized date range for performance
  const dateRangeMemo = useMemo(
    () => ({
      start: parseDateRangeBoundary(primaryDateRange.start, "start"),
      end: parseDateRangeBoundary(primaryDateRange.end, "end"),
    }),
    [primaryDateRange.start, primaryDateRange.end],
  );

  // ========== VAT CALCULATION FUNCTIONS ==========

  // Calculate VAT for purchase order items
  const calculatePurchaseOrderVAT = useCallback(
    (purchaseOrders: any[]): any[] => {
      return purchaseOrders.map((po) => {
        let totalVAT = 0;
        let totalWithVAT = 0;

        const itemsWithVAT =
          po.orderedItems?.map((item: any) => {
            // DEFENSIVE: Check if VAT field exists
            const isVATApplicable = item.stockItem?.isVATApplicable !== false;
            const itemTotal =
              (item.orderedQuantity || 0) *
              resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
            const { vatAmount, totalWithVAT: itemTotalWithVAT } =
              VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

            totalVAT += vatAmount;
            totalWithVAT += itemTotalWithVAT;

            return {
              ...item,
              vatAmount,
              totalWithVAT: itemTotalWithVAT,
              isVATApplicable, // Add this for clarity
            };
          }) || [];

        return {
          ...po,
          orderedItems: itemsWithVAT,
          vatAmount: totalVAT,
          totalWithVAT: totalWithVAT || po.totalAmount,
          hasVATCalculations: true, // Flag to track
        };
      });
    },
    [],
  );

  // Calculate VAT for goods receipt items
  // Replace the existing calculateGoodsReceiptVAT function with this:
  const calculateGoodsReceiptVAT = useCallback(
    (goodsReceipts: any[]): any[] => {
      return goodsReceipts.map((gr) => {
        let totalVAT = 0;
        let totalWithVAT = 0;

        const itemsWithVAT =
          gr.receivedItems?.map((item: any) => {
            const isVATApplicable = item.stockItem?.isVATApplicable !== false;
            const itemTotal =
              (item.receivedQuantity || 0) *
              resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
            const { vatAmount, totalWithVAT: itemTotalWithVAT } =
              VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

            totalVAT += vatAmount;
            totalWithVAT += itemTotalWithVAT;

            return {
              ...item,
              vatAmount,
              totalWithVAT: itemTotalWithVAT,
            };
          }) || [];

        return {
          ...gr,
          receivedItems: itemsWithVAT,
          vatAmount: totalVAT,
          totalWithVAT: totalWithVAT,
        };
      });
    },
    [],
  );

  // Calculate VAT for dispatch items
  // Replace the existing calculateDispatchVAT function with this:
  const calculateDispatchVAT = useCallback((dispatches: any[]): any[] => {
    return dispatches.map((dispatch) => {
      let totalVAT = 0;
      let totalWithVAT = 0;

      const itemsWithVAT =
        dispatch.dispatchedItems?.map((item: any) => {
          const isVATApplicable = item.stockItem?.isVATApplicable !== false;
          const itemTotal =
            item.totalCost ||
            (item.dispatchedQuantity || 0) *
              resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
          const { vatAmount, totalWithVAT: itemTotalWithVAT } =
            VAT_CONFIG.calculateVAT(itemTotal, isVATApplicable);

          totalVAT += vatAmount;
          totalWithVAT += itemTotalWithVAT;

          return {
            ...item,
            vatAmount,
            totalWithVAT: itemTotalWithVAT,
          };
        }) || [];

      // Sales: keep the figure stored on the dispatch. Only when there is none
      // fall back to the stamped / site-specific / base price (see
      // dispatchSales). The old code always recomputed from the type's base
      // price, which ignored site pricing and rewrote history whenever a
      // price changed.
      const totalSales = dispatchSales(dispatch);
      const salesVAT = VAT_CONFIG.calculateVAT(totalSales, true).vatAmount;
      const salesWithVAT = totalSales + salesVAT;

      return {
        ...dispatch,
        dispatchedItems: itemsWithVAT,
        vatAmount: totalVAT,
        totalWithVAT: totalWithVAT,
        salesVAT: salesVAT,
        salesWithVAT: salesWithVAT,
        totalSales: totalSales,
      };
    });
  }, []);

  // Calculate VAT for inventory values
  const calculateInventoryVAT = useCallback(
    (stockItems: any[]): { items: any[]; totalVAT: number } => {
      let totalVAT = 0;

      const itemsWithVAT = stockItems.map((item) => {
        const isVATApplicable = item.isVATApplicable !== false;
        const stockValue =
          (item.currentStock || 0) *
          resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);
        const { vatAmount } = VAT_CONFIG.calculateVAT(
          stockValue,
          isVATApplicable,
        );

        totalVAT += vatAmount;

        return {
          ...item,
          stockVAT: vatAmount,
          stockValueWithVAT: stockValue + vatAmount,
        };
      });

      return {
        items: itemsWithVAT,
        totalVAT,
      };
    },
    [],
  );

  // ========== NEW ANALYTICS FUNCTIONS ==========

  // Filter data by date range – robust with fallback field + user-facing toast
  const filterDataByDateRange = useCallback(
    (data: any[], dateField: string, fallbackField = "createdAt") => {
      if (!data || !Array.isArray(data)) return [];

      let missingDateCount = 0;

      const filtered = data.filter((item) => {
        try {
          if (!item) return false;
          // Try primary date field, then fallback
          const rawDate = item[dateField] ?? item[fallbackField];
          if (!rawDate) {
            missingDateCount++;
            return false;
          }
          const itemDate = new Date(rawDate);
          if (isNaN(itemDate.getTime())) {
            missingDateCount++;
            return false;
          }
          return isWithinInterval(itemDate, {
            start: dateRangeMemo.start,
            end: dateRangeMemo.end,
          });
        } catch {
          return false;
        }
      });

      // Records without a usable date fall outside every period. They are
      // reported once as a data-quality alert by computeFinancials() instead
      // of raising a toast on every filter call.
      if (missingDateCount > 0) {
        console.warn(
          `${missingDateCount} record(s) skipped: no valid "${dateField}"`,
        );
      }

      return filtered;
    },
    [dateRangeMemo],
  );

  // ========== CORRECTED PROCESS ANALYTICS DATA ==========
  const processAnalyticsData = useCallback(
    async (
      data: any,
      dateRange: { start: Date; end: Date },
      // NEW PARAMETERS - pass in pre-filtered transactions
      filteredGoodsReceipts?: any[],
      filteredDispatches?: any[],
      filterSiteId?: string | null,
    ): Promise<EnhancedAnalyticsData> => {
      try {
        // Validate data
        if (!data) {
          console.error("❌ No data provided to processAnalyticsData");
          return getEmptyAnalyticsData();
        }
        const {
          purchaseOrders = [],
          goodsReceipts = [],
          dispatches = [],
          transfers = [],
          binCounts = [],
          stockValues = {
            items: [],
            summary: { totalInventoryValue: 0, totalVAT: 0 },
          },
          lowStock = [],
          suppliers = [],
          users = [],
          sites = [],
        } = data;

        console.log("📊 Processing analytics data with VAT calculations...");
        console.log("🔹 Filtered receipts provided:", !!filteredGoodsReceipts);
        console.log("🔹 Filtered dispatches provided:", !!filteredDispatches);

        // Filter data by date range for period-based calculations
        const periodPOs = filterDataByDateRange(purchaseOrders, "orderDate");

        // USE FILTERED DATA IF PROVIDED, OTHERWISE USE RAW DATA
        // Only documents that actually moved stock feed the report (see
        // isEffective* in lib/financialReport).
        const periodGoodsReceipts = filterDataByDateRange(
          (filteredGoodsReceipts || goodsReceipts).filter(isEffectiveReceipt),
          "receiptDate",
        );
        const periodDispatches = filterDataByDateRange(
          (filteredDispatches || dispatches).filter(isEffectiveDispatch),
          "dispatchDate",
        );
        const periodBinCounts = filterDataByDateRange(
          binCounts.filter(isEffectiveCount),
          "countDate",
        );

        // 1. Effective documents only: drafts, cancelled and unfinished
        //    receipts/dispatches never moved stock, so they are not income,
        //    cost or input VAT. computeFinancials() is a single, unit-tested
        //    ledger: opening = everything before the period, so opening stock
        //    always equals the previous period's closing stock.
        const fin = computeFinancials({
          receipts: filteredGoodsReceipts || goodsReceipts,
          dispatches: filteredDispatches || dispatches,
          counts: binCounts,
          transfers,
          range: dateRange,
          siteId: filterSiteId,
          liveInventoryValue: stockValues?.summary?.totalInventoryValue,
          anchor: anchorRef.current
            ? {
                kind: anchorRef.current.kind,
                asOf: new Date(anchorRef.current.asOf),
                value: anchorRef.current.value,
                recordedAt: anchorRef.current.recordedAt
                  ? new Date(anchorRef.current.recordedAt)
                  : null,
              }
            : null,
        });

        const openingStockValue = fin.openingStock;
        const periodPurchasesExclVAT = fin.periodPurchases;
        const periodDispatchesTotalCost = fin.periodConsumption;
        const periodConsumptionExclVAT = fin.periodConsumption;
        const periodSalesExclVAT = fin.periodSales;
        const vatOnPurchases = fin.vatOnPurchases;
        const periodDispatchesSalesVAT = fin.vatOnSales;
        const vatOnSales = fin.vatOnSales;
        const netVATPayable = fin.netVATPayable;
        const COGS = fin.periodConsumption;
        const grossProfitBeforeVAT = fin.grossProfit;
        const netVariancesValue = fin.netVariances;
        const closingStockValue = fin.closingStock;

        // 9. Net profit. periodSalesExclVAT and COGS are both already
        // VAT-exclusive, so grossProfitBeforeVAT never contained VAT in the
        // first place — netVATPayable (output VAT owed minus input VAT
        // credit) is a tax liability/asset on the balance sheet, not a P&L
        // expense, so it must not be subtracted here. It's tracked and
        // displayed separately as its own "VAT Payable" figure.
        const netProfit = grossProfitBeforeVAT;
        const profitPercentage =
          periodSalesExclVAT > 0 ? (netProfit / periodSalesExclVAT) * 100 : 0;

        console.log("💰 FINAL Financial calculations:", {
          openingStockValue: openingStockValue.toFixed(2),
          periodPurchasesExclVAT: periodPurchasesExclVAT.toFixed(2),
          periodConsumptionExclVAT: periodConsumptionExclVAT.toFixed(2),
          periodSalesExclVAT: periodSalesExclVAT.toFixed(2),
          vatOnPurchases: vatOnPurchases.toFixed(2),
          vatOnSales: vatOnSales.toFixed(2),
          netVATPayable: netVATPayable.toFixed(2),
          grossProfitBeforeVAT: grossProfitBeforeVAT.toFixed(2),
          profitPercentage: profitPercentage.toFixed(1) + "%",
          closingStockValue: closingStockValue.toFixed(2),
        });

        // Helper functions
        const getStatusBreakdown = (items: any[]) => {
          const statusCounts: { [key: string]: number } = {};
          items.forEach((item) => {
            const status = item.status || "unknown";
            statusCounts[status] = (statusCounts[status] || 0) + 1;
          });
          return Object.entries(statusCounts).map(([name, value]) => ({
            name,
            value,
          }));
        };

        const getSiteBreakdown = (items: any[]) => {
          const siteCounts: { [key: string]: number } = {};
          items.forEach((item) => {
            let siteId = null;
            let siteName = "Unknown Site";

            if (item._type === "DispatchLog" || item.dispatchType) {
              const site = getDispatchSite(item);
              siteId = site._id;
              siteName = site.name || "Unknown Site";
            } else if (item._type === "GoodsReceipt" || item.receiptNumber) {
              const site = getGoodsReceiptSite(item);
              siteId = site._id;
              siteName = site.name || "Unknown Site";
            } else if (item.site?._id) {
              siteId = item.site._id;
              siteName = item.site.name;
            } else if (item.site?.name) {
              siteId = item.site._id;
              siteName = item.site.name;
            } else if (item.purchaseOrder?.site?._id) {
              siteId = item.purchaseOrder.site._id;
              siteName = item.purchaseOrder.site.name;
            } else if (item.sourceBin?.site?._id) {
              siteId = item.sourceBin.site._id;
              siteName = item.sourceBin.site.name;
            } else if (item.receivingBin?.site?._id) {
              siteId = item.receivingBin.site._id;
              siteName = item.receivingBin.site.name;
            }

            siteCounts[siteName] = (siteCounts[siteName] || 0) + 1;
          });

          return Object.entries(siteCounts).map(([name, value]) => ({
            name,
            value,
          }));
        };

        const getMonthlyBreakdown = (items: any[], dateField: string) => {
          const monthlyCounts: { [key: string]: number } = {};
          items.forEach((item) => {
            try {
              const date = new Date(item[dateField]);
              if (!isNaN(date.getTime())) {
                const monthYear = format(date, "MMM yyyy");
                monthlyCounts[monthYear] = (monthlyCounts[monthYear] || 0) + 1;
              }
            } catch (error) {
              // Skip invalid dates
            }
          });
          return Object.entries(monthlyCounts).map(([name, value]) => ({
            name,
            value,
          }));
        };

        // Process purchase orders with VAT data
        const poStatusBreakdown = getStatusBreakdown(periodPOs);
        const poSiteBreakdown = getSiteBreakdown(periodPOs);
        const poMonthlyBreakdown = getMonthlyBreakdown(periodPOs, "orderDate");
        const poTotalValue = periodPOs.reduce(
          (sum: number, po: any) => sum + (Number(po.totalAmount) || 0),
          0,
        );
        // Sum ONLY vatAmount – do not also add totalWithVAT (which already includes it)
        const poVATAmount = periodPOs.reduce(
          (sum: number, po: any) => sum + (Number(po.vatAmount) || 0),
          0,
        );
        // Derive totalWithVAT from excl + vat to ensure consistency
        const poTotalWithVAT = poTotalValue + poVATAmount;

        // Top items by quantity ordered with VAT
        const topItems = periodPOs
          .flatMap(
            (po: any) =>
              po.orderedItems?.map((item: any) => ({
                name: item.stockItem?.name || "Unknown Item",
                quantity: item.orderedQuantity || 0,
                value: (item.orderedQuantity || 0) * (item.unitPrice || 0),
                vatAmount: item.vatAmount || 0,
              })) || [],
          )
          .reduce((acc: any[], item: any) => {
            const existing = acc.find((i) => i.name === item.name);
            if (existing) {
              existing.quantity += item.quantity;
              existing.value += item.value;
              existing.vatAmount += item.vatAmount;
            } else {
              acc.push({ ...item });
            }
            return acc;
          }, [])
          .sort((a: any, b: any) => b.quantity - a.quantity)
          .slice(0, 10);

        // Process dispatches with VAT data
        const dispatchByType = periodDispatches.reduce(
          (acc: any[], dispatch: any) => {
            const type = dispatch.dispatchType?.name || "Unknown Type";
            const existing = acc.find((item) => item.name === type);
            if (existing) {
              existing.value++;
            } else {
              acc.push({ name: type, value: 1 });
            }
            return acc;
          },
          [],
        );

        const dispatchTopItems = periodDispatches
          .flatMap(
            (dispatch: any) =>
              dispatch.dispatchedItems?.map((item: any) => ({
                name: item.stockItem?.name || "Unknown Item",
                quantity: item.dispatchedQuantity || 0,
                cost: item.totalCost || 0,
                vatAmount: item.vatAmount || 0,
              })) || [],
          )
          .reduce((acc: any[], item: any) => {
            const existing = acc.find((i) => i.name === item.name);
            if (existing) {
              existing.quantity += item.quantity;
              existing.cost += item.cost;
              existing.vatAmount += item.vatAmount;
            } else {
              acc.push({ ...item });
            }
            return acc;
          }, [])
          .sort((a: any, b: any) => b.quantity - a.quantity)
          .slice(0, 10);

        // Process inventory with VAT data
        const stockItemsArray =
          stockValues?.items || Array.isArray(stockValues) ? stockValues : [];

        const inventoryByCategory = (
          stockValues?.items ||
          stockItemsArray ||
          []
        ).reduce((acc: any[], item: any) => {
          if (!item) return acc;
          const category =
            item.category?.title || item.category?.name || "Uncategorized";
          const existing = acc.find((cat) => cat.name === category);
          if (existing) {
            existing.value++;
          } else {
            acc.push({ name: category, value: 1 });
          }
          return acc;
        }, []);

        // Calculate low stock breakdown
        const criticalStockItems = lowStock.filter(
          (item: any) => (item.currentStock || 0) === 0,
        ).length;
        const warningStockItems = lowStock.filter(
          (item: any) =>
            (item.currentStock || 0) > 0 &&
            (item.currentStock || 0) <= (item.minimumStockLevel || 0),
        ).length;
        const healthyStockItems =
          (Array.isArray(stockItemsArray) ? stockItemsArray.length : 0) -
          lowStock.length;

        // Process bin counts
        const binCountAccuracy =
          periodBinCounts.length > 0
            ? periodBinCounts.reduce((sum: number, count: any) => {
                const accurateItems =
                  count.countedItems?.filter((item: any) => item.variance === 0)
                    .length || 0;
                const totalItems = count.countedItems?.length || 0;
                return sum + (totalItems > 0 ? accurateItems / totalItems : 0);
              }, 0) / periodBinCounts.length
            : 0;

        const varianceAnalysis = periodBinCounts
          .flatMap(
            (count: any) =>
              count.countedItems?.map((item: any) => ({
                variance: item.variance || 0,
                varianceCost: item.varianceCost || 0,
                unitPrice: item.unitPrice || item.stockItem?.unitPrice || 0,
              })) || [],
          )
          .reduce(
            (acc: any, item: any) => {
              if (item.variance > 0) acc.positive.quantity++;
              else if (item.variance < 0) acc.negative.quantity++;
              else acc.zero.quantity++;

              if (item.varianceCost > 0) {
                acc.positive.cost += item.varianceCost;
              } else if (item.varianceCost < 0) {
                acc.negative.cost += Math.abs(item.varianceCost);
              }

              return acc;
            },
            {
              positive: { quantity: 0, cost: 0 },
              negative: { quantity: 0, cost: 0 },
              zero: { quantity: 0, cost: 0 },
            },
          );

        // Process suppliers with VAT data
        const supplierPerformance = periodPOs
          .flatMap(
            (po: any) =>
              po.orderedItems?.map((item: any) => ({
                name: item.supplier?.name || "Unknown Supplier",
                orders: 1,
                value: (item.orderedQuantity || 0) * (item.unitPrice || 0),
                vatAmount: item.vatAmount || 0,
              })) || [],
          )
          .reduce((acc: any[], supplier: any) => {
            const existing = acc.find((s) => s.name === supplier.name);
            if (existing) {
              existing.orders += supplier.orders;
              existing.value += supplier.value;
              existing.vatAmount += supplier.vatAmount;
            } else {
              acc.push(supplier);
            }
            return acc;
          }, [])
          .sort((a: any, b: any) => b.value - a.value)
          .slice(0, 10);

        // Process goods receipts with VAT data
        const goodsReceiptsTotalValue = periodGoodsReceipts.reduce(
          (sum: number, gr: any) => {
            const receiptValue =
              gr.receivedItems?.reduce((itemSum: number, item: any) => {
                return (
                  itemSum + (item.receivedQuantity || 0) * (item.unitPrice || 0)
                );
              }, 0) || 0;
            return sum + receiptValue;
          },
          0,
        );

        const goodsReceiptsVATAmount = periodGoodsReceipts.reduce(
          (sum: number, gr: any) => sum + (gr.vatAmount || 0),
          0,
        );

        const goodsReceiptsTotalWithVAT = periodGoodsReceipts.reduce(
          (sum: number, gr: any) => sum + (gr.totalWithVAT || 0),
          0,
        );

        // Process dispatches with VAT data
        const dispatchesTotalCost = periodDispatchesTotalCost;

        // Dispatch VAT: sum pre-computed vatAmount ONLY – not totalWithVAT (avoids double-count)
        const dispatchesVATAmount = periodDispatches.reduce(
          (sum: number, d: any) => sum + (Number(d.vatAmount) || 0),
          0,
        );
        // Derive totalWithVAT from excl + vat
        const dispatchesTotalWithVAT =
          dispatchesTotalCost + dispatchesVATAmount;

        const dispatchesTotalSales = periodSalesExclVAT;

        const dispatchesSalesVAT =
          periodDispatchesSalesVAT > 0
            ? periodDispatchesSalesVAT
            : periodSalesExclVAT * VAT_CONFIG.rate;

        const dispatchesSalesWithVAT = periodDispatches.reduce(
          (sum: number, d: any) => {
            const sales = Number(d.totalSales) || 0;
            const svc =
              Number(d.salesWithVAT) || sales + Number(d.salesVAT || 0);
            return sum + svc;
          },
          0,
        );

        return {
          summary: {
            totalPurchaseOrders: periodPOs.length,
            totalGoodsReceipts: periodGoodsReceipts.length,
            totalDispatches: periodDispatches.length,
            totalTransfers: transfers.length,
            totalBinCounts: periodBinCounts.length,
            totalStockItems: stockItemsArray.length,
            totalSuppliers: suppliers.length,
            totalUsers: users.length,
            totalSites: sites.length,
            totalInventoryValue: openingStockValue,
            totalPeopleFed: periodDispatches.reduce(
              (sum: number, d: any) => sum + (d.peopleFed || 0),
              0,
            ),
            lowStockItems: lowStock.length,
            criticalStockItems,
            totalVATCollected: vatOnSales,
            totalVATPaid: vatOnPurchases,
            netVATLiability: netVATPayable,
          },
          purchaseOrders: {
            byStatus: poStatusBreakdown,
            bySite: poSiteBreakdown,
            byMonth: poMonthlyBreakdown,
            totalValue: poTotalValue,
            vatAmount: poVATAmount,
            totalWithVAT: poTotalWithVAT,
            avgOrderValue: periodPOs.length
              ? poTotalValue / periodPOs.length
              : 0,
            topItems,
            statusBreakdown: poStatusBreakdown.reduce(
              (acc, item) => {
                acc[item.name] = item.value;
                return acc;
              },
              {} as { [key: string]: number },
            ),
          },
          goodsReceipts: {
            byStatus: getStatusBreakdown(periodGoodsReceipts),
            bySite: getSiteBreakdown(periodGoodsReceipts),
            efficiency:
              periodGoodsReceipts.filter((gr: any) => gr.status === "completed")
                .length / Math.max(periodGoodsReceipts.length, 1),
            conditionBreakdown: periodGoodsReceipts
              .flatMap(
                (gr: any) =>
                  gr.receivedItems?.map((item: any) => item.condition) || [],
              )
              .reduce((acc: { [key: string]: number }, condition: string) => {
                acc[condition] = (acc[condition] || 0) + 1;
                return acc;
              }, {}),
            totalValue: goodsReceiptsTotalValue,
            vatAmount: goodsReceiptsVATAmount,
            totalWithVAT: goodsReceiptsTotalWithVAT,
          },
          dispatches: {
            byType: dispatchByType,
            bySite: getSiteBreakdown(periodDispatches),
            totalPeopleFed: periodDispatches.reduce(
              (sum: number, d: any) => sum + (d.peopleFed || 0),
              0,
            ),
            totalCost: dispatchesTotalCost,
            vatAmount: dispatchesVATAmount,
            totalWithVAT: dispatchesTotalWithVAT,
            costPerPerson:
              periodDispatches.reduce(
                (sum: number, d: any) => sum + (d.peopleFed || 0),
                0,
              ) > 0
                ? dispatchesTotalCost /
                  periodDispatches.reduce(
                    (sum: number, d: any) => sum + (d.peopleFed || 0),
                    0,
                  )
                : 0,
            topItems: dispatchTopItems,
            totalSales: dispatchesTotalSales,
            salesVAT: dispatchesSalesVAT,
            salesWithVAT: dispatchesSalesWithVAT,
          },
          transfers: {
            byStatus: getStatusBreakdown(transfers),
            bySite: getSiteBreakdown(transfers),
            approvalRate:
              transfers.filter((t: any) =>
                ["approved", "completed"].includes(t.status),
              ).length / Math.max(transfers.length, 1),
          },
          inventory: {
            byCategory: inventoryByCategory,
            totalValue: openingStockValue,
            vatIncluded: stockValues.summary.totalVAT || 0,
            lowStockBreakdown: {
              critical: criticalStockItems,
              warning: warningStockItems,
              healthy: healthyStockItems,
            },
          },
          binCounts: {
            byStatus: getStatusBreakdown(periodBinCounts),
            accuracy: binCountAccuracy,
            varianceAnalysis,
          },
          financial: {
            monthlySpending: periodPOs
              .reduce((acc: any[], po: any) => {
                try {
                  const date = new Date(po.orderDate);
                  if (!isNaN(date.getTime())) {
                    const month = format(date, "MMM yyyy");
                    const existing = acc.find((item) => item.month === month);
                    if (existing) {
                      existing.spending += po.totalAmount || 0;
                      existing.vat += po.vatAmount || 0;
                      existing.totalWithVAT +=
                        po.totalWithVAT || po.totalAmount || 0;
                    } else {
                      acc.push({
                        month,
                        spending: po.totalAmount || 0,
                        vat: po.vatAmount || 0,
                        totalWithVAT: po.totalWithVAT || po.totalAmount || 0,
                      });
                    }
                  }
                } catch (error) {
                  // Skip invalid dates
                }
                return acc;
              }, [])
              .sort(
                (a: any, b: any) =>
                  new Date(a.month).getTime() - new Date(b.month).getTime(),
              ),
            costPerPersonTrend: periodDispatches
              .map((dispatch: any) => {
                try {
                  const date = new Date(dispatch.dispatchDate);
                  if (!isNaN(date.getTime())) {
                    return {
                      date: format(date, "MMM dd"),
                      cost: dispatch.costPerPerson || 0,
                    };
                  }
                } catch (error) {
                  // Skip invalid dates
                }
                return { date: "Unknown", cost: 0 };
              })
              .filter((item: any) => item.date !== "Unknown")
              .slice(-30),
            inventoryTurnover: 0.5,
            totalReceivedGoodsValue: periodPurchasesExclVAT,
            totalSales: periodSalesExclVAT,
            consumption: periodConsumptionExclVAT,
            profit: netProfit,
            profitPercentage,
            closingStockValue,
            periodPurchases: periodPurchasesExclVAT,
            periodConsumption: periodConsumptionExclVAT,
            periodSales: periodSalesExclVAT,
            openingStock: openingStockValue,
            netVariances: netVariancesValue,
            vatOnPurchases,
            vatOnSales,
            netVATPayable,
            grossProfitBeforeVAT: grossProfitBeforeVAT,
            grossProfitAfterVAT: netProfit,
            netTransfers: fin.netTransfers,
            integrity: fin.integrity,
            excluded: fin.excluded,
          },
          suppliers: {
            performance: supplierPerformance,
            activeCount: suppliers.filter((s: any) => s.isActive).length,
            vatRegisteredCount: suppliers.filter((s: any) => s.vatNumber)
              .length,
          },
          users: {
            byRole: users.reduce((acc: any[], user: any) => {
              const role = user.role || "unknown";
              const existing = acc.find((item) => item.name === role);
              if (existing) {
                existing.value++;
              } else {
                acc.push({ name: role, value: 1 });
              }
              return acc;
            }, []),
            activity: [],
          },
          vat: {
            summary: {
              totalOutputVAT: vatOnSales,
              totalInputVAT: vatOnPurchases,
              netVATPayable,
              vatRate: VAT_CONFIG.ratePercentage,
            },
            breakdown: {
              purchases: {
                vatAmount: vatOnPurchases,
                totalWithVAT: periodPurchasesExclVAT + vatOnPurchases,
              },
              sales: {
                vatAmount: vatOnSales,
                totalWithVAT: periodSalesExclVAT + vatOnSales,
              },
              inventory: {
                vatAmount: stockValues.summary.totalVAT || 0,
                totalWithVAT:
                  openingStockValue + (stockValues.summary.totalVAT || 0),
              },
            },
          },
        };
      } catch (error) {
        console.error("❌ Error processing analytics data:", error);
        return getEmptyAnalyticsData();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterDataByDateRange, toast],
  );

  // Add this helper function to get stock values filtered by site
  const getFilteredStockValues = useCallback(
    async (
      stockItems: any[],
      filterSiteId: string | null,
      sites: any[],
    ): Promise<{
      items: any[];
      summary: { totalInventoryValue: number; totalVAT: number };
    }> => {
      if (!filterSiteId || !sites || sites.length === 0) {
        // No filter - return all stock
        return {
          items: stockItems,
          summary: {
            totalInventoryValue: stockItems.reduce(
              (sum: number, item: any) =>
                sum + (item.currentStock || 0) * (item.unitPrice || 0),
              0,
            ),
            totalVAT: stockItems.reduce(
              (sum: number, item: any) => sum + (item.stockVAT || 0),
              0,
            ),
          },
        };
      }

      try {
        console.log(`🔍 Getting filtered stock for site: ${filterSiteId}`);

        // Get bins for this site
        const binsResponse = await fetch(`/api/bins?siteId=${filterSiteId}`);
        if (!binsResponse.ok) {
          throw new Error("Failed to fetch bins for site");
        }
        const siteBins = await binsResponse.json();

        // Extract bin IDs with proper typing
        const binIds: string[] = siteBins
          .map((bin: any) => bin._id)
          .filter(Boolean);

        console.log(`📦 Found ${binIds.length} bins for site ${filterSiteId}`);

        // Get all stock item IDs with proper typing
        const stockItemIds: string[] = stockItems
          .map((item: any) => item._id)
          .filter(Boolean);

        if (stockItemIds.length === 0 || binIds.length === 0) {
          return {
            items: [],
            summary: {
              totalInventoryValue: 0,
              totalVAT: 0,
            },
          };
        }

        // Calculate stock for this site's bins
        const stockResults = await calculateBulkStock(stockItemIds, binIds);

        // Calculate values for each item
        let totalInventoryValue = 0;
        let totalVAT = 0;

        const itemsWithSiteStock = stockItems.map((item: any) => {
          let totalQuantity = 0;
          binIds.forEach((binId: string) => {
            const key = `${item._id}-${binId}`;
            totalQuantity += stockResults[key] || 0;
          });

          const stockValue = totalQuantity * (item.unitPrice || 0);
          const isVATApplicable = item.isVATApplicable !== false;
          const vatAmount = isVATApplicable
            ? Math.round(stockValue * VAT_CONFIG.rate * 100) / 100
            : 0;

          totalInventoryValue += stockValue;
          totalVAT += vatAmount;

          return {
            ...item,
            currentStock: totalQuantity,
            stockValue,
            vatAmount,
            stockValueWithVAT: stockValue + vatAmount,
          };
        });

        console.log(
          `💰 Site-filtered inventory: ${totalInventoryValue} (${itemsWithSiteStock.length} items)`,
        );

        return {
          items: itemsWithSiteStock,
          summary: {
            totalInventoryValue,
            totalVAT,
          },
        };
      } catch (error) {
        console.error("❌ Error filtering stock by site:", error);
        return {
          items: [],
          summary: { totalInventoryValue: 0, totalVAT: 0 },
        };
      }
    },
    [],
  );

  // ========== CORRECTED PROCESS FILTERED ANALYTICS DATA ==========
  const processFilteredAnalyticsData = useCallback(
    async (
      data: any,
      dateRange: { start: Date; end: Date },
      filterSiteId: string | null,
      skipAnalytics: boolean = false,
    ) => {
      try {
        console.log(
          "🔍 Processing analytics data with client-side filtering...",
          {
            filterSiteId,
            dateRange,
            skipAnalytics,
          },
        );

        // Apply client-side filtering based on selected site
        const filteredGoodsReceipts = filterDataBySite(
          data.goodsReceipts,
          filterSiteId,
          "goodsReceipt",
        );

        const filteredDispatches = filterDataBySite(
          data.dispatches,
          filterSiteId,
          "dispatch",
        );

        console.log("📦 After site filtering:", {
          goodsReceipts: filteredGoodsReceipts.length,
          dispatches: filteredDispatches.length,
        });

        const filteredData = {
          purchaseOrders: filterDataBySite(
            data.purchaseOrders,
            filterSiteId,
            "purchaseOrder",
          ),
          goodsReceipts: filteredGoodsReceipts,
          dispatches: filteredDispatches,
          transfers: filterDataBySite(data.transfers, filterSiteId, "transfer"),
          binCounts: filterDataBySite(data.binCounts, filterSiteId, "binCount"),
          stockValues: data.stockValues,
          lowStock: data.lowStock,
          suppliers: data.suppliers,
          users: filterDataBySite(data.users, filterSiteId, "user"),
          sites: data.sites,
        };

        console.log("📊 After client-side filtering:", {
          purchaseOrders: filteredData.purchaseOrders.length,
          goodsReceipts: filteredData.goodsReceipts.length,
          dispatches: filteredData.dispatches.length,
          transfers: filteredData.transfers.length,
          binCounts: filteredData.binCounts.length,
          users: filteredData.users.length,
        });

        // IMPORTANT FIX: Get site-specific stock values
        let filteredStockValues = data.stockValues;
        if (filterSiteId && data.stockItems) {
          console.log(`🔍 Getting filtered stock for site: ${filterSiteId}`);
          filteredStockValues = await getFilteredStockValues(
            data.stockItems,
            filterSiteId,
            data.sites || [],
          );
        } else {
          console.log("📊 Using unfiltered stock values (all sites)");
        }

        // If skipAnalytics is true, we preserve the legacy flag but still
        // run full analytics so filtered site totals remain accurate.
        if (skipAnalytics && analyticsData) {
          console.log(
            "⚡ Legacy skipAnalytics flag detected; recalculating filtered analytics for correctness",
          );
          // Continue to full analytics processing to avoid stale metrics.
        }

        // Full analytics processing with filtered data
        console.log(
          "🔄 Running full analytics processing with filtered data...",
        );
        const analytics = await processAnalyticsData(
          {
            ...filteredData,
            stockValues: filteredStockValues,
            stockItems: filteredStockValues.items,
          },
          dateRange,
          filteredGoodsReceipts, // PASS FILTERED GOODS RECEIPTS
          filteredDispatches, // PASS FILTERED DISPATCHES
          filterSiteId, // PASS SITE FILTER so opening/closing stock value can
          // account for the net effect of internal transfers in/out of it
        );

        setAnalyticsData(analytics);
        console.log(
          "✅ Analytics data with client-side filtering processed successfully",
        );
      } catch (error) {
        console.error("❌ Error processing filtered analytics data:", error);
        setAnalyticsData(getEmptyAnalyticsData());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      processAnalyticsData,
      analyticsData,
      getFilteredStockValues,
      toast,
      dateRangeMemo,
    ],
  );

  // Fast path: the server computes the financial summary next to the data
  // (~1 KB) and tells us which period close / opening balance anchors it.
  const fetchServerFinancials = useCallback(
    async (siteId: string | null): Promise<boolean> => {
      try {
        const qs = new URLSearchParams({
          start: primaryDateRange.start,
          end: primaryDateRange.end,
        });
        if (siteId) qs.set("site", siteId);
        const res = await fetch(`/api/reports/financials?${qs.toString()}`);
        if (!res.ok) throw new Error(`financials responded ${res.status}`);
        const body = await res.json();
        anchorRef.current = body.anchor ?? null;
        setServerAnchor(body.anchor ?? null);
        setServerFin(toSummaryShape(body));
        return true;
      } catch (error) {
        console.warn("Server financial summary unavailable:", error);
        anchorRef.current = null;
        setServerAnchor(null);
        setServerFin(null);
        return false;
      }
    },
    [primaryDateRange.start, primaryDateRange.end],
  );

  // Shape the stored raw documents into what processFilteredAnalyticsData expects.
  const buildProcessInput = useCallback(
    (raw: { [key: string]: any[] }) => ({
      purchaseOrders: raw.purchaseOrders || [],
      goodsReceipts: raw.goodsReceipts || [],
      dispatches: raw.dispatches || [],
      transfers: raw.transfers || [],
      binCounts: raw.binCounts || [],
      stockItems: raw.stockItems || [],
      stockValues: {
        items: raw.stockItems || [],
        summary: {
          totalInventoryValue: (raw.stockItems || []).reduce(
            (sum: number, item: any) =>
              sum + (item.currentStock || 0) * (item.unitPrice || 0),
            0,
          ),
          totalVAT: (raw.stockItems || []).reduce(
            (sum: number, item: any) => sum + (item.stockVAT || 0),
            0,
          ),
        },
      },
      lowStock: raw.lowStock || [],
      suppliers: raw.suppliers || [],
      users: raw.users || [],
      sites: raw.sites || [],
    }),
    [],
  );

  // Enhanced fetchAllData function - CLIENT-SIDE FILTERING VERSION
  const fetchAllData = useCallback(
    async (forceRefresh = false, silent = false) => {
      // Latest request wins: a slow earlier load must not overwrite the
      // result for the period/site the user has since switched to.
      const seq = ++loadSeqRef.current;
      setAnalyticsLoading(true);
      setAnalyticsError(null); // Clear any previous error immediately
      setLoadErrors([]);
      // Start the fast summary immediately; the full download continues below.
      const finPromise = fetchServerFinancials(selectedFilterSite);
      try {
        console.log(
          "🔄 Starting comprehensive data fetch for analytics with VAT...",
          {
            forceRefresh,
            userSiteInfo,
            selectedFilterSite,
          },
        );

        // Clear existing data if forcing refresh (a silent background
        // revalidation keeps showing the current numbers instead)
        if (forceRefresh && !silent) {
          setRawData({});
          setAnalyticsData(null);
        }

        // Check if we already have data and don't force refresh
        if (!forceRefresh && Object.keys(rawData).length > 0 && analyticsData) {
          console.log("📊 Using cached data, skipping fetch");
          await finPromise;
          setAnalyticsLoading(false);
          return;
        }

        // Build URLs WITHOUT site filtering - we'll fetch ALL data
        const buildUrl = (endpoint: string) => {
          const url = new URL(endpoint, window.location.origin);

          // Add date range parameters if needed by APIs
          url.searchParams.set("startDate", primaryDateRange.start);
          url.searchParams.set("endDate", primaryDateRange.end);

          // For multi-site users, we can add a parameter to get ALL data
          // Some APIs might need this to override their own site filtering
          if (userSiteInfo.canAccessMultipleSites) {
            url.searchParams.set("includeAllSites", "true");
          }

          return url.toString();
        };

        // Use correct API endpoints
        const endpoints = [
          buildUrl("/api/purchase-orders"),
          buildUrl("/api/goods-receipts"),
          buildUrl("/api/dispatches"),
          buildUrl("/api/transfers"),
          buildUrl("/api/bin-counts"),
          buildUrl("/api/analytics/stock-values"),
          buildUrl("/api/low-stock"),
          buildUrl("/api/suppliers"),
          buildUrl("/api/users"),
          buildUrl("/api/sites"),
        ];

        console.log(
          "📡 Fetching from endpoints (NO site filtering - getting ALL data):",
          endpoints.map((e) => e.split("?")[0]),
        );

        const sourceNames = [
          "purchase orders",
          "goods receipts",
          "dispatches",
          "transfers",
          "bin counts",
          "stock values",
          "low stock",
          "suppliers",
          "users",
          "sites",
        ];
        let settled = 0;
        setLoadProgress({ done: 0, total: endpoints.length });
        const results = await Promise.allSettled(
          endpoints.map(async (endpoint) => {
            try {
              console.log(`📡 Fetching from ${endpoint.split("?")[0]}...`);
              const response = await fetch(endpoint);
              if (!response.ok) {
                throw new Error(
                  `Failed to fetch ${endpoint}: ${response.status}`,
                );
              }
              return await response.json();
            } finally {
              settled += 1;
              setLoadProgress({ done: settled, total: endpoints.length });
            }
          }),
        );
        if (seq !== loadSeqRef.current) return; // superseded
        const failedSources = results.flatMap((r, i) =>
          r.status === "rejected" ? [sourceNames[i]] : [],
        );
        setLoadErrors(failedSources);

        // Process results with error handling
        const [
          purchaseOrders,
          goodsReceipts,
          dispatches,
          transfers,
          binCounts,
          stockValues,
          lowStock,
          suppliers,
          users,
          sites,
        ] = results.map((result, index) => {
          if (result.status === "fulfilled") {
            const data = result.value;
            console.log(
              `✅ Successfully fetched from ${endpoints[index].split("?")[0]}:`,
              Array.isArray(data) ? data.length : "object received",
            );
            return data;
          } else {
            console.error(
              `❌ Failed to fetch from ${endpoints[index].split("?")[0]}:`,
              result.reason,
            );
            return [];
          }
        });

        // Apply VAT calculations to ALL data (before filtering)
        console.log("🧮 Applying VAT calculations to all data...");
        const purchaseOrdersWithVAT = calculatePurchaseOrderVAT(
          purchaseOrders || [],
        );
        const goodsReceiptsWithVAT = calculateGoodsReceiptVAT(
          goodsReceipts || [],
        );
        const dispatchesWithVAT = calculateDispatchVAT(dispatches || []);
        const inventoryWithVAT = calculateInventoryVAT(
          stockValues?.items || stockValues || [],
        );

        // Validate we have at least some data
        const totalDataItems = [
          purchaseOrders,
          goodsReceipts,
          dispatches,
          transfers,
          binCounts,
          stockValues,
          lowStock,
          suppliers,
          users,
          sites,
        ].reduce((sum, data) => sum + (data?.length || 0), 0);

        if (totalDataItems === 0) {
          console.warn("⚠️ No data received from any API endpoint");
          toast({
            title: "No Data Available",
            description:
              "No data was returned from the server. Please check your connection.",
            status: "warning",
            duration: 5000,
            isClosable: true,
          });
          return;
        }

        // Store ALL raw data (unfiltered) for export
        const newRawData = {
          purchaseOrders: purchaseOrdersWithVAT,
          goodsReceipts: goodsReceiptsWithVAT,
          dispatches: dispatchesWithVAT,
          transfers: transfers || [],
          binCounts: binCounts || [],
          stockItems: inventoryWithVAT.items,
          lowStock: lowStock || [],
          suppliers: suppliers || [],
          users: users || [],
          sites: sites || [],
        };

        setRawData(newRawData);
        if (failedSources.length === 0) {
          rawDataCache = {
            userId: String(session?.user?.id || ""),
            at: Date.now(),
            data: newRawData,
          };
        }
        console.log("✅ All raw data stored with VAT calculations");

        // The calculation needs the period anchor; the fast summary request
        // started at the top has normally finished long before this point.
        await finPromise;

        // Process analytics data WITH CLIENT-SIDE FILTERING
        await processFilteredAnalyticsData(
          {
            purchaseOrders: purchaseOrdersWithVAT,
            goodsReceipts: goodsReceiptsWithVAT,
            dispatches: dispatchesWithVAT,
            transfers: transfers || [],
            binCounts: binCounts || [],
            stockValues: {
              items: inventoryWithVAT.items,
              summary: {
                totalInventoryValue: inventoryWithVAT.items.reduce(
                  (sum: number, item: any) =>
                    sum + (item.currentStock || 0) * (item.unitPrice || 0),
                  0,
                ),
                totalVAT: inventoryWithVAT.totalVAT,
              },
            },
            lowStock: lowStock || [],
            suppliers: suppliers || [],
            users: users || [],
            sites: sites || [],
          },
          dateRangeMemo,
          selectedFilterSite, // Pass the selected filter site
        );

        // No success toast: the period bar shows "Updated HH:mm" instead, so
        // nothing covers the numbers that were just loaded.
        setAnalyticsError(null);
        setLastUpdated(new Date());
      } catch (error) {
        console.error("❌ Error fetching analytics data:", error);
        const msg =
          error instanceof Error
            ? error.message
            : "Failed to load analytics data from server";
        setAnalyticsError(msg);
      } finally {
        if (seq === loadSeqRef.current) {
          setAnalyticsLoading(false);
          setLoadProgress(null);
        }
      }
    },
    [
      toast,
      fetchServerFinancials,
      session,
      rawData,
      analyticsData,
      dateRangeMemo,
      calculatePurchaseOrderVAT,
      calculateGoodsReceiptVAT,
      calculateDispatchVAT,
      calculateInventoryVAT,
      processFilteredAnalyticsData,
      userSiteInfo,
      selectedFilterSite,
      primaryDateRange.start,
      primaryDateRange.end,
    ],
  );


  const handleUpdateAnalytics = () => {
    // Always fetch fresh data when manually updating
    fetchAllData(true);
  };

  // Documents behind a tapped figure, scoped to the selected site and period.
  const drillRows = useMemo(() => {
    if (!drill) return [];
    return buildDrillRows(drill.kind, {
      receipts: filterDataBySite(
        rawData.goodsReceipts || [],
        selectedFilterSite,
        "goodsReceipt",
      ),
      dispatches: filterDataBySite(
        rawData.dispatches || [],
        selectedFilterSite,
        "dispatch",
      ),
      counts: filterDataBySite(
        rawData.binCounts || [],
        selectedFilterSite,
        "binCount",
      ),
      range: dateRangeMemo,
    });
  }, [drill, rawData, selectedFilterSite, dateRangeMemo]);

  const reconciliationRows = useMemo(() => {
    if (!reconcileOpen) return [];
    return buildReconciliation({
      receipts: rawData.goodsReceipts || [],
      dispatches: rawData.dispatches || [],
      counts: rawData.binCounts || [],
      stockItems: rawData.stockItems || [],
    });
  }, [reconcileOpen, rawData]);

  // Smart auto-fit columns function that calculates optimal widths
  const autoFitColumns = (worksheet: any) => {
    if (!worksheet["!cols"]) worksheet["!cols"] = [];

    const maxWidths: number[] = [];

    // Calculate maximum content length for each column
    Object.keys(worksheet).forEach((cellAddress) => {
      if (cellAddress[0] === "!") return; // Skip special properties like '!ref', '!cols'

      const colIndex = cellAddress.charCodeAt(0) - 65; // Convert A=0, B=1, C=2, etc.
      const cell = worksheet[cellAddress];

      if (cell && cell.v !== undefined) {
        const cellValue = String(cell.v);

        // Calculate width based on content length and type
        let cellLength = cellValue.length;

        // Adjust for different data types
        if (cellValue.match(/^\d+$/)) {
          // Numbers - slightly narrower
          cellLength = Math.max(cellLength, 8);
        } else if (cellValue.match(/^\d+\.\d+$/)) {
          // Decimals - account for decimal places
          cellLength = Math.max(cellLength, 10);
        } else if (cellValue.length > 50) {
          // Very long text - cap it
          cellLength = 50;
        } else if (cellValue.match(/[A-Za-z\s]/)) {
          // Text - add more space for readability
          cellLength += 4;
        }

        // Apply character-to-width ratio (roughly 1.2 characters per unit width in Excel)
        const width = Math.ceil(cellLength * 1.2);

        if (!maxWidths[colIndex] || width > maxWidths[colIndex]) {
          maxWidths[colIndex] = width;
        }
      }
    });

    // Set column widths with reasonable limits
    maxWidths.forEach((calculatedWidth, index) => {
      if (calculatedWidth) {
        // Apply min/max constraints
        const finalWidth = Math.min(Math.max(calculatedWidth, 8), 50);
        worksheet["!cols"][index] = { width: finalWidth };
      } else {
        // Default width for empty columns
        worksheet["!cols"][index] = { width: 12 };
      }
    });

    // Ensure we have widths for all columns (in case some columns are completely empty)
    const maxColIndex = Math.max(
      ...Object.keys(worksheet)
        .filter((key) => key[0] !== "!")
        .map((key) => key.charCodeAt(0) - 65),
    );

    for (let i = 0; i <= maxColIndex; i++) {
      if (!worksheet["!cols"][i]) {
        worksheet["!cols"][i] = { width: 12 };
      }
    }
  };

  // Helper function to create formatted Executive Summary with VAT
  const createFormattedSummaryData = useCallback(() => {
    return [
      // HEADER SECTION WITH DATES (ONLY IN EXECUTIVE SUMMARY)
      ["CATERFLOW COMPREHENSIVE REPORT", ""],
      ["", ""],
      ["Generated On", new Date().toLocaleDateString()],
      [
        "Report Period",
        `${format(new Date(primaryDateRange.start), "MM/dd/yyyy")} to ${format(new Date(primaryDateRange.end), "MM/dd/yyyy")}`,
      ],
      ["VAT Rate", `${VAT_CONFIG.ratePercentage}% (Eswatini)`],
      ["User Role", userSiteInfo.userRole || "Not specified"],
      [
        "Access Level",
        userSiteInfo.canAccessMultipleSites ? "Multi-Site" : "Single-Site",
      ],
      ...(userSiteInfo.userSiteName
        ? [["Site", userSiteInfo.userSiteName]]
        : []),
      ...(selectedFilterSite
        ? [
            [
              "Filtered Site",
              availableSites.find((s) => s._id === selectedFilterSite)?.name ||
                "Unknown",
            ],
          ]
        : []),
      ["", ""],
      ["", ""],

      // EXECUTIVE SUMMARY SECTION
      ...buildIntegrityRows(analyticsData?.financial, serverAnchor),
      ["EXECUTIVE SUMMARY", ""],
      ["", ""],
      [
        "Total Purchase Orders",
        analyticsData?.summary.totalPurchaseOrders || 0,
      ],
      ["Total Goods Receipts", analyticsData?.summary.totalGoodsReceipts || 0],
      ["Total Dispatches", analyticsData?.summary.totalDispatches || 0],
      ["Total People Fed", analyticsData?.summary.totalPeopleFed || 0],
      [
        "Total Inventory Value",
        analyticsData?.summary.totalInventoryValue || 0,
      ],
      ["Low Stock Items", analyticsData?.summary.lowStockItems || 0],
      ["Critical Stock Items", analyticsData?.summary.criticalStockItems || 0],
      ["", ""],
      ["", ""],

      // VAT SUMMARY SECTION
      ["VAT SUMMARY", ""],
      ["", ""],
      [
        "Total Output VAT (Sales)",
        analyticsData?.vat.summary.totalOutputVAT || 0,
      ],
      [
        "Total Input VAT (Purchases)",
        analyticsData?.vat.summary.totalInputVAT || 0,
      ],
      ["Net VAT Payable", analyticsData?.vat.summary.netVATPayable || 0],
      ["", ""],
      ["", ""],

      // FINANCIAL OVERVIEW SECTION USING PERIOD-BASED CALCULATIONS
      ["FINANCIAL OVERVIEW", ""],
      ["", ""],
      ["Opening Stock Value", analyticsData?.financial.openingStock || 0],
      ["Period Purchases", analyticsData?.financial.periodPurchases || 0],
      ["Period Consumption", analyticsData?.financial.periodConsumption || 0],
      ["Net Variances", analyticsData?.financial.netVariances || 0],
      ["Closing Stock Value", analyticsData?.financial.closingStockValue || 0],
      ["Total Sales", analyticsData?.financial.periodSales || 0],
      [
        "Gross Profit",
        analyticsData?.financial.grossProfitBeforeVAT || 0,
      ],
      ["VAT Payable", analyticsData?.financial.netVATPayable || 0],
      [
        "Net Profit (VAT tracked separately, see VAT Payable)",
        analyticsData?.financial.grossProfitAfterVAT || 0,
      ],
      ["Profit Percentage", analyticsData?.financial.profitPercentage || 0],
    ];
  }, [
    primaryDateRange,
    analyticsData,
    serverAnchor,
    userSiteInfo,
    availableSites,
    selectedFilterSite,
  ]);

  // Helper function to create formatted Analytics Data with VAT
  const createFormattedAnalyticsData = useCallback(() => {
    return [
      // HEADER
      ["ANALYTICS DATA DASHBOARD", ""],
      ["", ""],
      ["Generated On", new Date().toLocaleDateString()],
      ["Report Period", `${primaryDateRange.start} to ${primaryDateRange.end}`],
      ["VAT Rate", `${VAT_CONFIG.ratePercentage}% (Eswatini)`],
      ["", ""],
      ["", ""],

      // PURCHASE ORDERS ANALYSIS WITH VAT
      ["PURCHASE ORDERS BY STATUS", ""],
      ["", ""],
      ...(analyticsData?.purchaseOrders.byStatus.map((item) => [
        item.name,
        item.value,
      ]) || [["No Data", 0]]),
      ["", ""],
      [
        "Purchase Orders Total (excl. VAT)",
        analyticsData?.purchaseOrders.totalValue || 0,
      ],
      [
        "Purchase Orders VAT Amount",
        analyticsData?.purchaseOrders.vatAmount || 0,
      ],
      [
        "Purchase Orders Total (incl. VAT)",
        analyticsData?.purchaseOrders.totalWithVAT || 0,
      ],
      ["", ""],
      ["", ""],

      // DISPATCHES ANALYSIS WITH VAT
      ["DISPATCHES BY TYPE", ""],
      ["", ""],
      ...(analyticsData?.dispatches.byType.map((item) => [
        item.name,
        item.value,
      ]) || [["No Data", 0]]),
      ["", ""],
      [
        "Dispatches Total Cost (excl. VAT)",
        analyticsData?.dispatches.totalCost || 0,
      ],
      ["Dispatches VAT Amount", analyticsData?.dispatches.vatAmount || 0],
      [
        "Dispatches Total Cost (incl. VAT)",
        analyticsData?.dispatches.totalWithVAT || 0,
      ],
      ["Sales Total (excl. VAT)", analyticsData?.dispatches.totalSales || 0],
      ["Sales VAT Amount", analyticsData?.dispatches.salesVAT || 0],
      ["Sales Total (incl. VAT)", analyticsData?.dispatches.salesWithVAT || 0],
      ["", ""],
      ["", ""],

      // INVENTORY ANALYSIS
      ["INVENTORY BY CATEGORY", ""],
      ["", ""],
      ...(analyticsData?.inventory.byCategory.map((item) => [
        item.name,
        item.value,
      ]) || [["No Data", 0]]),
      ["", ""],
      ["Inventory Value (excl. VAT)", analyticsData?.inventory.totalValue || 0],
      ["Inventory VAT Amount", analyticsData?.inventory.vatIncluded || 0],
      [
        "Inventory Value (incl. VAT)",
        (analyticsData?.inventory.totalValue || 0) +
          (analyticsData?.inventory.vatIncluded || 0),
      ],
      ["", ""],
      ["", ""],

      // FINANCIAL METRICS SECTION - UPDATED WITH PERIOD-BASED CALCULATIONS AND VAT
      ...buildIntegrityRows(analyticsData?.financial, serverAnchor),
      ["FINANCIAL PERFORMANCE METRICS", ""],
      ["", ""],
      ["Opening Stock Value", analyticsData?.financial.openingStock || 0],
      ["Period Purchases", analyticsData?.financial.periodPurchases || 0],
      ["Period Consumption", analyticsData?.financial.periodConsumption || 0],
      ["Closing Stock Value", analyticsData?.financial.closingStockValue || 0],
      ["Period Sales", analyticsData?.financial.periodSales || 0],
      ["VAT on Purchases", analyticsData?.financial.vatOnPurchases || 0],
      ["VAT on Sales", analyticsData?.financial.vatOnSales || 0],
      ["Net VAT Payable", analyticsData?.financial.netVATPayable || 0],
      [
        "Gross Profit",
        analyticsData?.financial.grossProfitBeforeVAT || 0,
      ],
      [
        "Net Profit (VAT tracked separately, see VAT Payable)",
        analyticsData?.financial.grossProfitAfterVAT || 0,
      ],
      ["Profit Margin", analyticsData?.financial.profitPercentage || 0],
      ["", ""],
      ["Calculation Method", "Period-based accounting with VAT calculations"],
      ["VAT Rate", `${VAT_CONFIG.ratePercentage}% (Eswatini)`],
      ["", ""],
    ];
  }, [primaryDateRange, analyticsData, serverAnchor]);

  // Helper function to create formatted Sales Summary with VAT
  const createFormattedSalesSummaryData = useCallback(
    (dispatches: any[]) => {
      if (!dispatches || dispatches.length === 0) {
        return [
          ["SALES SUMMARY REPORT", ""],
          ["", ""],
          ["No dispatch data available for analysis", ""],
          ["", ""],
          ["Please ensure:", ""],
          ["- Dispatch records exist for the period", ""],
          ["- People fed counts are populated", ""],
          ["- Dispatch types have selling prices configured", ""],
        ];
      }

      // Filter dispatches by date range
      const periodDispatches = filterDataByDateRange(
        dispatches,
        "dispatchDate",
      );

      // Get unique dispatch types and dates
      const dispatchTypes = [
        ...new Set(
          periodDispatches
            .map((d) => d.dispatchType?.name || "Unknown")
            .filter(Boolean),
        ),
      ];

      // Get dates in simple format (MM/DD)
      const allDates = [
        ...new Set(
          periodDispatches
            .map((d) => {
              try {
                return d.dispatchDate
                  ? format(new Date(d.dispatchDate), "MM/dd")
                  : null;
              } catch {
                return null;
              }
            })
            .filter((date) => date !== null),
        ),
      ].sort((a, b) => {
        // Sort dates chronologically
        const dateA = new Date(`2025/${a}`); // Assuming current year
        const dateB = new Date(`2025/${b}`);
        return dateA.getTime() - dateB.getTime();
      });

      if (dispatchTypes.length === 0 || allDates.length === 0) {
        return [
          ["SALES SUMMARY REPORT", ""],
          ["", ""],
          ["Insufficient data for sales summary:", ""],
          ["", ""],
          [`Dispatch Types: ${dispatchTypes.length}`, ""],
          [`Date Records: ${allDates.length}`, ""],
          ["", ""],
          ["Please check dispatch data completeness.", ""],
        ];
      }

      // HEADER ROW
      const headerRow = [
        "SUMMARY",
        "",
        ...allDates,
        "TOTAL",
        "UNIT PRICE",
        "AMOUNT (excl. VAT)",
        "VAT AMOUNT",
        "TOTAL (incl. VAT)",
      ];

      // DATA ROWS FOR EACH DISPATCH TYPE
      const dataRows = dispatchTypes.map((type) => {
        const dateTotals = allDates.map((date) => {
          const dayDispatches = periodDispatches.filter((d) => {
            try {
              const dispatchDate = d.dispatchDate
                ? format(new Date(d.dispatchDate), "MM/dd")
                : null;
              return d.dispatchType?.name === type && dispatchDate === date;
            } catch {
              return false;
            }
          });
          return dayDispatches.reduce((sum, d) => sum + (d.peopleFed || 0), 0);
        });

        const totalPeopleFed = dateTotals.reduce(
          (sum, total) => sum + total,
          0,
        );

        // Get unit price directly from dispatch type's sellingPrice
        const typeDispatches = periodDispatches.filter(
          (d) => d.dispatchType?.name === type,
        );
        let unitPrice = 0;
        const dispatchWithType = typeDispatches.find(
          (d) => d.dispatchType?.sellingPrice > 0,
        );

        if (dispatchWithType) {
          unitPrice = dispatchWithType.dispatchType.sellingPrice || 0;
        } else {
          // Fallback: try to get from the dispatch record itself
          const dispatchWithPrice = typeDispatches.find(
            (d) => d.sellingPrice > 0,
          );
          unitPrice = dispatchWithPrice?.sellingPrice || 0;
        }

        const totalAmount = totalPeopleFed * unitPrice;
        const vatAmount = VAT_CONFIG.calculateVAT(totalAmount, true).vatAmount;
        const totalWithVAT = totalAmount + vatAmount;

        return [
          type,
          "",
          ...dateTotals,
          totalPeopleFed,
          unitPrice,
          totalAmount,
          vatAmount,
          totalWithVAT,
        ];
      });

      // CALCULATE GRAND TOTALS
      const totalSales = dataRows.reduce(
        (sum, row) => sum + (row[row.length - 3] || 0),
        0,
      );
      const totalVAT = dataRows.reduce(
        (sum, row) => sum + (row[row.length - 2] || 0),
        0,
      );
      const totalWithVAT = dataRows.reduce(
        (sum, row) => sum + (row[row.length - 1] || 0),
        0,
      );
      const totalPeopleFedAll = dataRows.reduce(
        (sum, row) => sum + (row[row.length - 4] || 0),
        0,
      );

      // FINANCIAL DATA WITH VAT
      const totalDispatchCost = analyticsData?.financial.periodConsumption || 0;
      const consumption = analyticsData?.financial.periodConsumption || 0;
      const profit = analyticsData?.financial.profit || 0;
      const profitPercentage = analyticsData?.financial.profitPercentage || 0;
      const vatOnSales = analyticsData?.financial.vatOnSales || 0;

      return [
        // REPORT HEADER
        ["SALES SUMMARY REPORT", ""],
        ["VAT Rate", `${VAT_CONFIG.ratePercentage}% (Eswatini)`],
        ["", ""],

        // MAIN DATA TABLE
        headerRow,
        ...dataRows,
        ["", ""],

        // FINANCIAL SUMMARY WITH VAT
        [
          "TOTAL SALES (excl. VAT)",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          totalSales,
          "",
          "",
        ],
        ["TOTAL VAT", "", ...allDates.map(() => ""), "", "", "", totalVAT, ""],
        [
          "TOTAL SALES (incl. VAT)",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          "",
          "",
          totalWithVAT,
        ],
        ["", ""],

        // FINANCIAL BREAKDOWN
        ["FINANCIAL ANALYSIS", ""],
        ["", ""],
        [
          "PARTICIPATION SALES (excl. VAT)",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          totalSales,
        ],
        ["VAT ON SALES", "", ...allDates.map(() => ""), "", "", vatOnSales],
        [
          "TOTAL SALES (incl. VAT)",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          totalWithVAT,
        ],
        [
          "LESS ISSUE CONSUMPTION",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          consumption,
        ],
        ["WEEKLY PROFIT", "", ...allDates.map(() => ""), "", "", profit],
        [
          "PROFIT PERCENTAGE",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          profitPercentage,
        ],
        ["", ""],

        // KEY METRICS
        ["KEY PERFORMANCE INDICATORS", ""],
        ["", ""],
        [
          "Total People Served",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          totalPeopleFedAll,
        ],
        [
          "Average Cost Per Person",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          analyticsData?.dispatches.costPerPerson || 0,
        ],
        ["Sales Efficiency", "", ...allDates.map(() => ""), "", "", "95%"],
        [
          "VAT Rate Applied",
          "",
          ...allDates.map(() => ""),
          "",
          "",
          `${VAT_CONFIG.ratePercentage}%`,
        ],
      ];
    },
    [filterDataByDateRange, analyticsData],
  );

  // FULL MULTI-SHEET EXCEL EXPORT FUNCTION WITH VAT
  const exportToExcel = useCallback(async () => {
    setExportLoading(true);
    try {
      console.log("📊 Starting comprehensive Excel export with VAT...");
      const [XLSX, { saveAs }] = await Promise.all([
        import("xlsx"),
        import("file-saver"),
      ]);

      // Validate we have data before exporting
      const hasData =
        Object.keys(rawData).length > 0 &&
        Object.values(rawData).some((data: any) => data && data.length > 0);

      if (!hasData) {
        console.log("🔄 No data available, fetching data first...");
        await fetchAllData(true);

        // Check again after fetch
        const stillNoData =
          Object.keys(rawData).length === 0 ||
          Object.values(rawData).every(
            (data: any) => !data || data.length === 0,
          );

        if (stillNoData) {
          toast({
            title: "No Data Available",
            description:
              "Cannot export - no data is available from the server.",
            status: "warning",
            duration: 5000,
            isClosable: true,
          });
          return;
        }
      }

      const workbook = XLSX.utils.book_new();

      // 1. EXECUTIVE SUMMARY SHEET WITH VAT
      console.log("📝 Creating Executive Summary sheet with VAT...");
      const summaryData = createFormattedSummaryData();
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      autoFitColumns(summarySheet);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Executive Summary");

      // 2. SALES SUMMARY SHEET WITH VAT
      console.log("📝 Creating Sales Summary sheet with VAT...");
      const salesSummaryData = createFormattedSalesSummaryData(
        rawData.dispatches || [],
      );
      const salesSummarySheet = XLSX.utils.aoa_to_sheet(salesSummaryData);
      autoFitColumns(salesSummarySheet);
      XLSX.utils.book_append_sheet(
        workbook,
        salesSummarySheet,
        "Sales Summary",
      );

      // 3. PURCHASE ORDERS SHEET WITH VAT
      console.log("📝 Creating Purchase Orders sheet with VAT...");
      const periodPOs = filterDataByDateRange(
        rawData.purchaseOrders || [],
        "orderDate",
      );
      const poData = periodPOs.map((po: any) => ({
        "PO Number": po.poNumber || "N/A",
        "Order Date": po.orderDate
          ? format(new Date(po.orderDate), "MM/dd/yyyy")
          : "N/A",
        Status: po.status || "N/A",
        "Ordered By": po.orderedBy?.name || "N/A",
        Site: po.site?.name || "N/A",
        "Total Amount (excl. VAT)": (po.totalAmount || 0).toFixed(2),
        "VAT Amount": (po.vatAmount || 0).toFixed(2),
        "Total Amount (incl. VAT)": (
          po.totalWithVAT ||
          po.totalAmount ||
          0
        ).toFixed(2),
        "Evidence Status": po.evidenceStatus || "N/A",
        "Item Count": po.orderedItems?.length || 0,
      }));

      if (poData.length > 0) {
        const poSheet = XLSX.utils.json_to_sheet(poData);
        autoFitColumns(poSheet);
        XLSX.utils.book_append_sheet(workbook, poSheet, "Purchase Orders");
      }

      // 4. GOODS RECEIPTS SHEET WITH VAT
      console.log("📝 Creating Goods Receipts sheet with VAT...");
      const periodGoodsReceipts = filterDataByDateRange(
        rawData.goodsReceipts || [],
        "receiptDate",
      );
      // Update the grData mapping:
      const grData = periodGoodsReceipts.map((gr: any) => {
        // Get site and bin using compatibility helpers
        const site = getGoodsReceiptSite(gr);
        const bin = getGoodsReceiptBin(gr);

        return {
          "Receipt Number": gr.receiptNumber || "N/A",
          "Receipt Date": gr.receiptDate
            ? format(new Date(gr.receiptDate), "MM/dd/yyyy")
            : "N/A",
          Status: gr.status || "N/A",
          "PO Number": gr.purchaseOrder?.poNumber || "N/A",
          "Receiving Bin": bin.name || "N/A",
          Site: site.name || "N/A",
          "Total Value (excl. VAT)":
            gr.receivedItems?.reduce(
              (sum: number, item: any) =>
                sum + (item.receivedQuantity || 0) * (item.unitPrice || 0),
              0,
            ) || 0,
          "VAT Amount": gr.vatAmount || 0,
          "Total Value (incl. VAT)": gr.totalWithVAT || 0,
          "Evidence Status": gr.evidenceStatus || "N/A",
          "Item Count": gr.receivedItems?.length || 0,
        };
      });

      if (grData.length > 0) {
        const grSheet = XLSX.utils.json_to_sheet(grData);
        autoFitColumns(grSheet);
        XLSX.utils.book_append_sheet(workbook, grSheet, "Goods Receipts");
      }

      // 5. DISPATCHES SHEET WITH VAT
      console.log("📝 Creating Dispatches sheet with VAT...");
      const periodDispatches = filterDataByDateRange(
        rawData.dispatches || [],
        "dispatchDate",
      );
      // In the exportToExcel function, update the dispatchData mapping:
      const dispatchData = periodDispatches.map((dispatch: any) => {
        // Get site using compatibility helper
        const site = getDispatchSite(dispatch);
        const firstBin = dispatch.dispatchedItems?.[0]?.sourceBin;

        return {
          "Dispatch Number": dispatch.dispatchNumber || "N/A",
          "Dispatch Date": dispatch.dispatchDate
            ? format(new Date(dispatch.dispatchDate), "MM/dd/yyyy")
            : "N/A",
          "Dispatch Type": dispatch.dispatchType?.name || "N/A",
          "Selling Price Per Person":
            dispatch.dispatchType?.sellingPrice || dispatch.sellingPrice || 0,
          Site: site.name || "N/A",
          "Source Bin": firstBin?.name || "Multiple Bins",
          "Dispatched By": dispatch.dispatchedBy?.name || "N/A",
          "People Fed": dispatch.peopleFed || 0,
          "Total Cost (excl. VAT)": dispatch.totalCost || 0,
          "VAT on Cost": dispatch.vatAmount || 0,
          "Total Cost (incl. VAT)": dispatch.totalWithVAT || 0,
          "Cost Per Person": dispatch.costPerPerson || 0,
          "Total Sales (excl. VAT)": dispatch.totalSales || 0,
          "VAT on Sales": dispatch.salesVAT || 0,
          "Total Sales (incl. VAT)": dispatch.salesWithVAT || 0,
          "Evidence Status": dispatch.evidenceStatus || "N/A",
          "Item Count": dispatch.dispatchedItems?.length || 0,
        };
      });

      if (dispatchData.length > 0) {
        const dispatchSheet = XLSX.utils.json_to_sheet(dispatchData);
        autoFitColumns(dispatchSheet);
        XLSX.utils.book_append_sheet(workbook, dispatchSheet, "Dispatches");
      }

      // 6. VAT ANALYSIS SHEET
      console.log("📝 Creating VAT Analysis sheet...");
      const vatAnalysisData = [
        ["VAT ANALYSIS REPORT", ""],
        ["", ""],
        ["VAT Rate", `${VAT_CONFIG.ratePercentage}% (Eswatini)`],
        [
          "Report Period",
          `${primaryDateRange.start} to ${primaryDateRange.end}`,
        ],
        ["", ""],
        ["VAT SUMMARY", ""],
        [
          "Total Output VAT (Sales)",
          analyticsData?.vat.summary.totalOutputVAT || 0,
        ],
        [
          "Total Input VAT (Purchases)",
          analyticsData?.vat.summary.totalInputVAT || 0,
        ],
        ["Net VAT Payable", analyticsData?.vat.summary.netVATPayable || 0],
        ["", ""],
        ["VAT BREAKDOWN", ""],
        [
          "Purchases VAT",
          analyticsData?.vat.breakdown.purchases.vatAmount || 0,
        ],
        [
          "Purchases Total (incl. VAT)",
          analyticsData?.vat.breakdown.purchases.totalWithVAT || 0,
        ],
        ["Sales VAT", analyticsData?.vat.breakdown.sales.vatAmount || 0],
        [
          "Sales Total (incl. VAT)",
          analyticsData?.vat.breakdown.sales.totalWithVAT || 0,
        ],
        [
          "Inventory VAT",
          analyticsData?.vat.breakdown.inventory.vatAmount || 0,
        ],
        [
          "Inventory Total (incl. VAT)",
          analyticsData?.vat.breakdown.inventory.totalWithVAT || 0,
        ],
        ["", ""],
        ["FINANCIAL IMPACT", ""],
        [
          "Gross Profit",
          analyticsData?.financial.grossProfitBeforeVAT || 0,
        ],
        ["VAT Payable", analyticsData?.financial.netVATPayable || 0],
        [
          "Net Profit (VAT tracked separately, see VAT Payable)",
          analyticsData?.financial.grossProfitAfterVAT || 0,
        ],
      ];

      const vatAnalysisSheet = XLSX.utils.aoa_to_sheet(vatAnalysisData);
      autoFitColumns(vatAnalysisSheet);
      XLSX.utils.book_append_sheet(workbook, vatAnalysisSheet, "VAT Analysis");

      // 7. TRANSFERS SHEET
      console.log("📝 Creating Transfers sheet...");
      const periodTransfers = filterDataByDateRange(
        rawData.transfers || [],
        "transferDate",
      );
      const transferData = periodTransfers.map((transfer: any) => ({
        "Transfer Number": transfer.transferNumber || "N/A",
        "Transfer Date": transfer.transferDate
          ? format(new Date(transfer.transferDate), "MM/dd/yyyy")
          : "N/A",
        Status: transfer.status || "N/A",
        "From Bin": transfer.fromBin?.name || "N/A",
        "From Site": transfer.fromBin?.site?.name || "N/A",
        "To Bin": transfer.toBin?.name || "N/A",
        "To Site": transfer.toBin?.site?.name || "N/A",
        "Transferred By": transfer.transferredBy?.name || "N/A",
        "Approved By": transfer.approvedBy?.name || "N/A",
        "Item Count": transfer.transferredItems?.length || 0,
      }));

      if (transferData.length > 0) {
        const transferSheet = XLSX.utils.json_to_sheet(transferData);
        autoFitColumns(transferSheet);
        XLSX.utils.book_append_sheet(workbook, transferSheet, "Transfers");
      }

      // 8. BIN COUNTS SHEET
      console.log("📝 Creating Bin Counts sheet...");
      const periodBinCounts = filterDataByDateRange(
        rawData.binCounts || [],
        "countDate",
      );
      const binCountData = periodBinCounts.map((count: any) => ({
        "Count Number": count.countNumber || "N/A",
        "Count Date": count.countDate
          ? format(new Date(count.countDate), "MM/dd/yyyy")
          : "N/A",
        Status: count.status || "N/A",
        Bin: count.bin?.name || "N/A",
        Site: count.bin?.site?.name || "N/A",
        "Counted By": count.countedBy?.name || "N/A",
        "Item Count": count.countedItems?.length || 0,
        Accuracy: count.countedItems?.length
          ? (
              (count.countedItems.filter((item: any) => item.variance === 0)
                .length /
                count.countedItems.length) *
              100
            ).toFixed(1) + "%"
          : "0%",
      }));

      if (binCountData.length > 0) {
        const binCountSheet = XLSX.utils.json_to_sheet(binCountData);
        autoFitColumns(binCountSheet);
        XLSX.utils.book_append_sheet(workbook, binCountSheet, "Bin Counts");
      }

      // 9. STOCK ITEMS SHEET WITH VAT
      console.log("📝 Creating Stock Items sheet with VAT...");
      const stockItemsArray = Array.isArray(rawData.stockItems)
        ? rawData.stockItems
        : (rawData.stockItems as any)?.items || [];

      const stockItemsData = stockItemsArray.map((item: any) => ({
        Name: item.name || "N/A",
        SKU: item.sku || "N/A",
        Category: item.category?.title || "N/A",
        "Item Type": item.itemType || "N/A",
        "Unit of Measure": item.unitOfMeasure || "N/A",
        "Unit Price": item.unitPrice || 0,
        "VAT Applicable": item.isVATApplicable !== false ? "Yes" : "No",
        "Minimum Stock Level": item.minimumStockLevel || 0,
        "Reorder Quantity": item.reorderQuantity || 0,
        "Current Stock": item.currentStock || 0,
        "Stock Value (excl. VAT)":
          (item.currentStock || 0) * (item.unitPrice || 0),
        "VAT Amount": item.stockVAT || 0,
        "Stock Value (incl. VAT)": item.stockValueWithVAT || 0,
        "Primary Supplier": item.primarySupplier?.name || "N/A",
        "Supplier Count": item.suppliers?.length || 0,
      }));

      if (stockItemsData.length > 0) {
        const stockItemSheet = XLSX.utils.json_to_sheet(stockItemsData);
        autoFitColumns(stockItemSheet);
        XLSX.utils.book_append_sheet(workbook, stockItemSheet, "Stock Items");
      }

      // 10. LOW STOCK ALERTS SHEET
      console.log("📝 Creating Low Stock Alerts sheet...");
      const lowStockData =
        rawData.lowStock?.map((item: any) => ({
          Name: item.name || "N/A",
          SKU: item.sku || "N/A",
          "Current Stock": item.currentStock || 0,
          "Minimum Stock Level": item.minimumStockLevel || 0,
          "Unit of Measure": item.unitOfMeasure || "N/A",
          Category: item.category?.title || "N/A",
          "Primary Supplier": item.primarySupplier?.name || "N/A",
          "VAT Applicable": item.isVATApplicable !== false ? "Yes" : "No",
          Status:
            (item.currentStock || 0) === 0
              ? "CRITICAL"
              : (item.currentStock || 0) <= (item.minimumStockLevel || 0)
                ? "LOW STOCK"
                : "HEALTHY",
        })) || [];

      if (lowStockData.length > 0) {
        const lowStockSheet = XLSX.utils.json_to_sheet(lowStockData);
        autoFitColumns(lowStockSheet);
        XLSX.utils.book_append_sheet(
          workbook,
          lowStockSheet,
          "Low Stock Alerts",
        );
      }

      // 11. ANALYTICS DATA SHEET WITH VAT
      console.log("📝 Creating Analytics Data sheet with VAT...");
      const analyticsSheetData = createFormattedAnalyticsData();
      const analyticsSheet = XLSX.utils.aoa_to_sheet(analyticsSheetData);
      autoFitColumns(analyticsSheet);
      XLSX.utils.book_append_sheet(workbook, analyticsSheet, "Analytics Data");

      // 12. SUPPLIER PERFORMANCE SHEET WITH VAT
      console.log("📝 Creating Supplier Performance sheet with VAT...");
      const supplierData =
        analyticsData?.suppliers.performance.map((supplier) => ({
          "Supplier Name": supplier.name || "N/A",
          "Total Orders": supplier.orders || 0,
          "Total Value (excl. VAT)": supplier.value || 0,
          "VAT Amount": supplier.vatAmount || 0,
          "Total Value (incl. VAT)":
            (supplier.value || 0) + (supplier.vatAmount || 0),
        })) || [];

      if (supplierData.length > 0) {
        const supplierSheet = XLSX.utils.json_to_sheet(supplierData);
        autoFitColumns(supplierSheet);
        XLSX.utils.book_append_sheet(
          workbook,
          supplierSheet,
          "Supplier Performance",
        );
      }

      // Generate Excel file
      console.log("💾 Generating Excel file with VAT...");
      const excelBuffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
      });
      const data = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const fileName = `Caterflow_Comprehensive_Report_VAT_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      saveAs(data, fileName);

      console.log("✅ Excel export with VAT completed successfully");
      toast({
        title: "Export Successful",
        description: `Report exported with ${workbook.SheetNames.length} sheets including VAT analysis`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });
    } catch (error) {
      console.error("❌ Error exporting to Excel:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export report. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setExportLoading(false);
    }
  }, [
    analyticsData,
    rawData,
    toast,
    fetchAllData,
    primaryDateRange,
    filterDataByDateRange,
    createFormattedAnalyticsData,
    createFormattedSalesSummaryData,
    createFormattedSummaryData,
  ]);

  // ========== OLD REPORTS FUNCTIONS ==========
  // (Keeping all original old reports functionality with VAT columns added)

  // Helper function to get date from item based on report type
  const getItemDate = (item: any, reportTitle: string): string => {
    switch (reportTitle) {
      case "Purchase Orders":
        return item.orderDate || item.createdAt || "";
      case "Goods Receipts":
        return item.receiptDate || "";
      case "Dispatches":
        return item.dispatchDate || "";
      case "Transfers":
        return item.transferDate || "";
      case "Bin Counts":
        return item.countDate || "";
      default:
        return item.createdAt || "";
    }
  };

  // Helper function to get site from item based on report type
  // Replace the existing getItemSite function with this:
  const getItemSite = (item: any, reportTitle: string): any => {
    switch (reportTitle) {
      case "Purchase Orders":
        return item.site;
      case "Goods Receipts":
        // Use compatibility helper
        return getGoodsReceiptSite(item);
      case "Dispatches":
        // Use compatibility helper
        return getDispatchSite(item);
      case "Transfers":
        return item.fromBin?.site;
      case "Bin Counts":
        return item.bin?.site;
      default:
        return item.site;
    }
  };

  // Filter report data - using ref to avoid dependencies
  const filterReportData = useCallback(
    (reportTitle: string, dataToFilter?: ReportData[]) => {
      const {
        reportData,
        dateRanges,
        selectedSites,
        searchTerms,
        reportConfigs,
      } = filterStateRef.current;

      const data = dataToFilter || reportData[reportTitle];
      if (!data) return;

      const config = reportConfigs.find((r) => r.title === reportTitle);
      if (!config) return;

      let filtered = [...data];

      // FIRST: Apply site filter based on user role
      if (!userSiteInfo.canAccessMultipleSites && userSiteInfo.userSiteId) {
        filtered = filtered.filter((item: any) => {
          const itemSite = getItemSite(item, reportTitle);
          const itemSiteId = itemSite?._id || itemSite;
          return itemSiteId === userSiteInfo.userSiteId;
        });
      }
      // SECOND: Apply manual site filter if user has multiple sites
      else if (config.filters?.site && selectedSites[reportTitle] !== "all") {
        filtered = filtered.filter((item: any) => {
          const itemSite = getItemSite(item, reportTitle);
          return (
            itemSite === selectedSites[reportTitle] ||
            (typeof itemSite === "object" &&
              itemSite._id === selectedSites[reportTitle])
          );
        });
      }

      // Apply date range filter
      if (config.filters?.dateRange) {
        filtered = filtered.filter((item: any) => {
          const itemDateStr = getItemDate(item, reportTitle);
          const dateRange = dateRanges[reportTitle];
          // NOTE: this used to be a plain string comparison
          // (itemDate >= dateRange.start), which broke as soon as itemDate
          // carried a time component: e.g. "2026-09-04T14:30:00.000Z" sorts
          // *after* the bare "2026-09-04" end-date string lexicographically,
          // so every record on the end date itself was silently excluded.
          // isDateWithinRange parses both sides into real Date objects and
          // extends the end bound to the end of that day — see
          // src/lib/dateRangeUtils.ts (unit tested there).
          return isDateWithinRange(
            itemDateStr,
            dateRange?.start,
            dateRange?.end,
          );
        });
      }

      // Apply search filter
      const searchTerm = searchTerms[reportTitle];
      if (searchTerm) {
        filtered = filtered.filter((item) =>
          Object.values(item).some((value) =>
            value?.toString().toLowerCase().includes(searchTerm.toLowerCase()),
          ),
        );
      }

      setFilteredData((prev) => ({ ...prev, [reportTitle]: filtered }));
    },
    [userSiteInfo],
  );

  // Fetch report data (only if not already loaded)
  const fetchReportData = useCallback(
    async (reportTitle: string) => {
      if (filterStateRef.current.reportData[reportTitle]) {
        filterReportData(reportTitle);
        return;
      }

      setLoading((prev) => ({ ...prev, [reportTitle]: true }));
      try {
        const config = filterStateRef.current.reportConfigs.find(
          (r) => r.title === reportTitle,
        );
        if (!config) return;

        console.log(
          `📡 Fetching ${reportTitle} data from ${config.endpoint}...`,
        );
        const response = await fetch(config.endpoint);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch ${reportTitle} data: ${response.status}`,
          );
        }

        let data = await response.json();

        // Apply VAT calculations to fetched data
        if (reportTitle === "Purchase Orders") {
          data = calculatePurchaseOrderVAT(data);
        } else if (reportTitle === "Goods Receipts") {
          data = calculateGoodsReceiptVAT(data);
        } else if (reportTitle === "Dispatches") {
          data = calculateDispatchVAT(data);
        }

        console.log(
          `✅ ${reportTitle} data fetched with VAT:`,
          data.length,
          "items",
        );

        setReportData((prev) => ({ ...prev, [reportTitle]: data }));
        filterReportData(reportTitle, data);
      } catch (error) {
        console.error(`Error fetching ${reportTitle} data:`, error);
        toast({
          title: "Error",
          description: `Failed to load ${reportTitle} data`,
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setLoading((prev) => ({ ...prev, [reportTitle]: false }));
      }
    },
    [
      filterReportData,
      toast,
      calculatePurchaseOrderVAT,
      calculateGoodsReceiptVAT,
      calculateDispatchVAT,
    ],
  );

  // Initialize filter states for old reports
  useEffect(() => {
    const initialDateRanges: { [key: string]: { start: string; end: string } } =
      {};
    const initialSelectedSites: { [key: string]: string } = {};
    const initialSearchTerms: { [key: string]: string } = {};

    reportConfigs.forEach((config) => {
      initialDateRanges[config.title] = {
        start: new Date(new Date().getFullYear() - 1, 0, 1)
          .toISOString()
          .split("T")[0],
        end: new Date().toISOString().split("T")[0],
      };
      initialSelectedSites[config.title] = "all";
      initialSearchTerms[config.title] = "";
    });

    setDateRanges(initialDateRanges);
    setSelectedSites(initialSelectedSites);
    setSearchTerms(initialSearchTerms);
  }, [reportConfigs]);

  // Fetch sites for old reports
  useEffect(() => {
    const fetchSites = async () => {
      try {
        console.log("🌐 Fetching sites for reports...");
        const response = await fetch("/api/sites");
        if (response.ok) {
          const data = await response.json();
          console.log("✅ Sites fetched:", data.length, "sites");
          setSites(data);
        }
      } catch (error) {
        console.error("Failed to fetch sites:", error);
      }
    };
    fetchSites();
  }, []);

  // Export single report to CSV
  const exportToCSV = useCallback(
    (reportTitle: string) => {
      const data = filteredData[reportTitle];
      if (!data || data.length === 0) {
        toast({
          title: "No Data",
          description: "There is no data to export",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      try {
        const config = reportConfigs.find((r) => r.title === reportTitle);
        if (!config) return;

        const headers = config.columns
          .map((col) =>
            col
              .split(".")
              .map((part) => part.replace(/([A-Z])/g, " $1").trim())
              .join(" > "),
          )
          .join(",");

        const csvData = data
          .map((item) => {
            return config.columns
              .map((column) => {
                const value = getNestedValue(item, column);
                const stringValue = String(value || "").replace(/"/g, '""');
                return `"${stringValue}"`;
              })
              .join(",");
          })
          .join("\n");

        const csv = `${headers}\n${csvData}`;
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${reportTitle.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: "Export Successful",
          description: `${reportTitle} data exported to CSV`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } catch (error) {
        console.error("Error exporting to CSV:", error);
        toast({
          title: "Export Failed",
          description: "Failed to export data to CSV",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    },
    [filteredData, reportConfigs, toast],
  );

  // Export all reports to a single organized CSV file
  const exportAllReports = useCallback(async () => {
    try {
      setAnalyticsLoading(true);
      console.log("📊 Starting export of all reports with VAT...");

      const fetchPromises = reportConfigs.map(async (config) => {
        console.log(`📡 Fetching ${config.title}...`);
        const response = await fetch(config.endpoint);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${config.title}`);
        }
        let data = await response.json();

        // Apply VAT calculations
        if (config.title === "Purchase Orders") {
          data = calculatePurchaseOrderVAT(data);
        } else if (config.title === "Goods Receipts") {
          data = calculateGoodsReceiptVAT(data);
        } else if (config.title === "Dispatches") {
          data = calculateDispatchVAT(data);
        }

        return data;
      });

      const allData = await Promise.all(fetchPromises);
      console.log("✅ All reports data fetched with VAT");

      let combinedCsv = "";

      reportConfigs.forEach((config, reportIndex) => {
        const data = allData[reportIndex] || [];

        if (data.length > 0) {
          combinedCsv += `${config.title}\n`;
          combinedCsv += `${config.description}\n\n`;

          const headers = config.columns
            .map((col) =>
              col
                .split(".")
                .map((part) => part.replace(/([A-Z])/g, " $1").trim())
                .join(" > "),
            )
            .join(",");

          combinedCsv += headers + "\n";

          data.forEach((item: any) => {
            const row = config.columns
              .map((column) => {
                const value = getNestedValue(item, column);
                const stringValue = String(value || "").replace(/"/g, '""');
                return `"${stringValue}"`;
              })
              .join(",");

            combinedCsv += row + "\n";
          });

          combinedCsv += "\n\n";
        }
      });

      const blob = new Blob([combinedCsv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `All_Reports_Combined_VAT_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log("✅ All reports with VAT exported successfully");
      toast({
        title: "Export Successful",
        description: "All reports combined into a single CSV file with VAT",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error exporting all reports:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export reports",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [
    reportConfigs,
    toast,
    calculatePurchaseOrderVAT,
    calculateGoodsReceiptVAT,
    calculateDispatchVAT,
  ]);

  // Helper to get nested object values
  const getNestedValue = (obj: any, path: string) => {
    return path.split(".").reduce((current, key) => {
      return current ? current[key] : undefined;
    }, obj);
  };

  // Update filters and re-filter data for old reports
  const updateDateRange = (
    reportTitle: string,
    newDateRange: { start: string; end: string },
  ) => {
    setDateRanges((prev) => ({ ...prev, [reportTitle]: newDateRange }));
    setTimeout(() => filterReportData(reportTitle), 0);
  };

  const updateSelectedSite = (reportTitle: string, site: string) => {
    setSelectedSites((prev) => ({ ...prev, [reportTitle]: site }));
    setTimeout(() => filterReportData(reportTitle), 0);
  };

  const updateSearchTerm = (reportTitle: string, term: string) => {
    setSearchTerms((prev) => ({ ...prev, [reportTitle]: term }));
    setTimeout(() => filterReportData(reportTitle), 0);
  };

  // Load report data when tab changes (only if not already loaded)
  useEffect(() => {
    if (status === "authenticated" && currentReport) {
      fetchReportData(currentReport.title);
    }
  }, [currentReport, fetchReportData, status, userSiteInfo]); // Add userSiteInfo here

  // ── Deep links: ?tab=charts&from=2026-10-01&to=2026-10-04&site=<id> ──
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const tab = TAB_KEYS.indexOf(q.get("tab") as (typeof TAB_KEYS)[number]);
      if (tab >= 0) setAnalyticsTab(tab);
      const from = q.get("from");
      const to = q.get("to");
      const isDate = (v: string | null): v is string =>
        !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (isDate(from) && isDate(to) && from <= to) {
        setPrimaryDateRange({ start: from, end: to });
      }
      const site = q.get("site");
      if (site) setSelectedFilterSite(site);
    } catch {
      /* ignore malformed query strings */
    }
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    try {
      const q = new URLSearchParams();
      q.set("tab", TAB_KEYS[analyticsTab] || TAB_KEYS[0]);
      q.set("from", primaryDateRange.start);
      q.set("to", primaryDateRange.end);
      if (selectedFilterSite) q.set("site", selectedFilterSite);
      window.history.replaceState(null, "", `?${q.toString()}`);
    } catch {
      /* history API unavailable */
    }
  }, [
    urlReady,
    analyticsTab,
    primaryDateRange.start,
    primaryDateRange.end,
    selectedFilterSite,
  ]);

  // Re-run the calculation from the documents already in memory when the
  // period or site changes. (Previously a cached load returned early, so
  // changing the dates left the numbers of the old period on screen.)
  const reprocess = useCallback(
    async (siteId: string | null) => {
      if (Object.keys(rawData).length === 0) {
        await fetchAllData(true);
        return;
      }
      setAnalyticsLoading(true);
      try {
        await fetchServerFinancials(siteId);
        await processFilteredAnalyticsData(
          buildProcessInput(rawData),
          dateRangeMemo,
          siteId,
        );
        setLastUpdated(new Date());
      } catch (error) {
        setAnalyticsError(
          error instanceof Error ? error.message : "Failed to update the report",
        );
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [
      rawData,
      fetchAllData,
      fetchServerFinancials,
      processFilteredAnalyticsData,
      buildProcessInput,
      dateRangeMemo,
    ],
  );
  const reprocessRef = useRef(reprocess);
  useEffect(() => {
    reprocessRef.current = reprocess;
  }, [reprocess]);

  // First load: show cached numbers instantly (stale-while-revalidate), else fetch.
  useEffect(() => {
    if (status !== "authenticated" || activeTab !== 0 || !urlReady) return;
    if (initialLoadRef.current) return;
    const timer = setTimeout(async () => {
      initialLoadRef.current = true;
      lastScopeRef.current = `${primaryDateRange.start}|${primaryDateRange.end}|${selectedFilterSite || ""}`;
      const cached =
        rawDataCache &&
        rawDataCache.userId === String(session?.user?.id || "") &&
        Date.now() - rawDataCache.at < RAW_CACHE_TTL_MS
          ? rawDataCache
          : null;
      if (cached) {
        setRawData(cached.data);
        setLastUpdated(new Date(cached.at));
        await fetchServerFinancials(selectedFilterSite);
        await processFilteredAnalyticsData(
          buildProcessInput(cached.data),
          dateRangeMemo,
          selectedFilterSite,
        );
        fetchAllData(true, true); // revalidate quietly
      } else {
        fetchAllData();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [status, activeTab, urlReady, fetchAllData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Period or site changed after the first load
  useEffect(() => {
    if (status !== "authenticated" || activeTab !== 0 || !initialLoadRef.current) return;
    const key = `${primaryDateRange.start}|${primaryDateRange.end}|${selectedFilterSite || ""}`;
    if (key === lastScopeRef.current) return;
    const timer = setTimeout(() => {
      lastScopeRef.current = key;
      reprocessRef.current(selectedFilterSite);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    primaryDateRange.start,
    primaryDateRange.end,
    selectedFilterSite,
    status,
    activeTab,
  ]);

  // Get user site info from session
  useEffect(() => {
    if (session?.user) {
      const userRole = session.user.role;
      const userSiteId = session.user.associatedSite?._id || null;
      const userSiteName = session.user.associatedSite?.name;

      // Users who can see multiple sites: admin, auditor, procurer
      const canAccessMultipleSites = ["admin", "auditor", "procurer"].includes(
        userRole,
      );

      console.log("👤 User session for reports:", {
        userId: session.user.id,
        userRole,
        userSiteId,
        userSiteName,
        canAccessMultipleSites,
      });

      setUserSiteInfo({
        userSiteId,
        userRole,
        canAccessMultipleSites,
        userSiteName,
      });
      if (!canAccessMultipleSites) setSelectedFilterSite(null);
    }
  }, [session]); // session is available from useSession() hook

  // Fetch available sites based on user permissions
  useEffect(() => {
    const fetchAvailableSites = async () => {
      try {
        const response = await fetch("/api/sites");
        if (response.ok) {
          const allSites = await response.json();

          // Filter sites based on user permissions
          if (userSiteInfo.canAccessMultipleSites) {
            setAvailableSites(allSites);
          } else if (userSiteInfo.userSiteId) {
            // For single-site users, only show their site
            const userSite = allSites.find(
              (site: any) => site._id === userSiteInfo.userSiteId,
            );
            setAvailableSites(userSite ? [userSite] : []);
          } else {
            setAvailableSites([]);
          }
        }
      } catch (error) {
        console.error("Failed to fetch sites:", error);
      }
    };

    if (userSiteInfo.userRole) {
      fetchAvailableSites();
    }
  }, [userSiteInfo]);

  if (status === "loading") {
    return (
      <Flex
        justifyContent="center"
        alignItems="center"
        minH="100vh"
        bg={bgPrimary}
      >
        <VStack spacing={4}>
          <Spinner size="xl" color="brand.500" />
          <Text>Loading Reports...</Text>
        </VStack>
      </Flex>
    );
  }

  // Helper function to render cell values appropriately for old reports
  const renderCellValue = (value: any, column: string): React.ReactNode => {
    if (value == null) return "-";

    if (
      column.includes("date") ||
      column.includes("Date") ||
      column === "timestamp" ||
      column === "createdAt"
    ) {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return value;
      }
    }

    if (
      column.includes("amount") ||
      column.includes("cost") ||
      column.includes("price") ||
      column.includes("vat")
    ) {
      if (typeof value === "number") {
        return `SZL ${value.toFixed(2)}`;
      }
    }

    if (column === "status" || column.includes("Status")) {
      const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
          case "completed":
          case "approved":
          case "processed":
            return "green";
          case "pending":
          case "draft":
          case "pending-approval":
            return "orange";
          case "cancelled":
          case "rejected":
            return "red";
          case "partially-received":
          case "in-progress":
            return "blue";
          default:
            return "gray";
        }
      };

      return (
        <Badge
          colorScheme={getStatusColor(value)}
          variant="subtle"
          fontSize="xs"
        >
          {typeof value === "string"
            ? value.replace("-", " ").toUpperCase()
            : String(value)}
        </Badge>
      );
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return "None";

      return value
        .slice(0, 2)
        .map((item, idx) => (
          <Text key={idx} fontSize="xs">
            {typeof item === "object"
              ? item.stockItem?.name ||
                item.name ||
                `${item.orderedQuantity || item.receivedQuantity || item.dispatchedQuantity || item.quantity}x item`
              : String(item)}
          </Text>
        ))
        .concat(
          value.length > 2
            ? [
                <Text key="more" fontSize="xs">
                  +{value.length - 2} more
                </Text>,
              ]
            : [],
        );
    }

    if (typeof value === "object") {
      return (
        value.name ||
        value.title ||
        value.poNumber ||
        value.receiptNumber ||
        value.dispatchNumber ||
        value.transferNumber ||
        "Object"
      );
    }

    return String(value);
  };

  // Role-based view: finance roles see VAT, reconciliation and (admins) period
  // close; operational roles see sales, cost and stock only. The API enforces
  // the same rules - this only hides controls.
  const showFinance = canViewFinance(userSiteInfo.userRole);
  const showReconcile =
    canViewReconciliation(userSiteInfo.userRole) &&
    userSiteInfo.canAccessMultipleSites &&
    !selectedFilterSite;
  const canManage = canManagePeriods(userSiteInfo.userRole);

  return (
    <Box>
      <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <Flex
            justify="space-between"
            align={{ base: "flex-start", md: "center" }}
            direction={{ base: "column", md: "row" }}
            gap={4}
          >
            <Box>
              <Heading
                as="h1"
                size={{ base: "xl", md: "2xl" }}
                color={primaryTextColor}
                mb={2}
              >
                Analytics & Reports
              </Heading>
              <Text color={secondaryTextColor}>
                Sales, cost, stock and VAT (Eswatini {VAT_CONFIG.ratePercentage}%)
              </Text>
            </Box>

            <HStack spacing={3}>
              {activeTab === 0 && (
                <Button
                  leftIcon={<FiDownload />}
                  colorScheme="green"
                  onClick={exportToExcel}
                  isLoading={exportLoading}
                  isDisabled={loadErrors.length > 0 || !analyticsData}
                  title={
                    loadErrors.length > 0
                      ? "Disabled: some data failed to load, so the export would be incomplete"
                      : undefined
                  }
                  size={{ base: "md", md: "lg" } as any}
                >
                  Export report
                </Button>
              )}
            </HStack>
          </Flex>

          {/* Sticky period + site bar (replaces the VAT, site, scope and
              quick-range cards, and the per-tab date inputs) */}
          <PeriodBar
            range={primaryDateRange}
            onRangeChange={setPrimaryDateRange}
            presets={quickDateRanges}
            sites={availableSites}
            selectedSite={selectedFilterSite}
            onSiteChange={setSelectedFilterSite}
            canPickSite={userSiteInfo.canAccessMultipleSites}
            fixedSiteName={userSiteInfo.userSiteName}
            lastUpdated={lastUpdated}
            loading={analyticsLoading}
            progress={loadProgress}
            onRefresh={() => fetchAllData(true)}
          />

          {/* Main Tabs - Analytics and Reports */}
          <Card bg={bgCard} border="1px" borderColor={borderColor}>
            <CardBody p={0}>
              <Tabs
                variant="line"
                onChange={setAnalyticsTab}
                colorScheme="brand"
                index={analyticsTab}
                // Tab bodies mount when first opened (charts are heavy) and
                // stay mounted afterwards so switching back is instant.
                isLazy
                lazyBehavior="keepMounted"
              >
                <TabList overflowX="auto" overflowY="hidden" whiteSpace="nowrap">
                  <Tab minH="44px">
                    <HStack spacing={2}>
                      <Icon as={FiTrendingUp} />
                      <Text>
                        Overview
                      </Text>
                    </HStack>
                  </Tab>
                  <Tab minH="44px">
                    <HStack spacing={2}>
                      <Icon as={FiBarChart2} />
                      <Text>Charts</Text>
                    </HStack>
                  </Tab>
                  <Tab minH="44px">
                    <HStack spacing={2}>
                      <Icon as={FiDownload} />
                      <Text>Export</Text>
                    </HStack>
                  </Tab>
                </TabList>

                <TabPanels>
                  {/* Executive Dashboard Tab */}
                  <TabPanel>
                    <VStack spacing={6} align="stretch">
                      {/* Problems first: failed sources, then errors */}
                      <LoadFailureBanner
                        failed={loadErrors}
                        onRetry={() => fetchAllData(true)}
                      />
                      {analyticsError && (
                        <ErrorCard
                          message={analyticsError}
                          onRetry={() => fetchAllData(true)}
                        />
                      )}

                      {/* Financial summary leads the page. While the full
                          download is in flight it is filled from the fast
                          server summary. */}
                      {(analyticsData?.financial || serverFin) && (
                        <Card>
                          <CardBody>
                            <FinancialSummary
                              financial={
                                analyticsData?.financial
                                  ? {
                                      ...analyticsData.financial,
                                      netTransfers:
                                        analyticsData.financial.netTransfers,
                                    }
                                  : serverFin?.financial
                              }
                              summary={
                                analyticsData?.summary || serverFin?.summary
                              }
                              periodStart={primaryDateRange.start}
                              periodEnd={primaryDateRange.end}
                              vatRatePercentage={VAT_CONFIG.ratePercentage}
                              previous={serverFin?.previous}
                              showVat={showFinance}
                              anchoredOn={serverAnchor}
                              onDrill={
                                analyticsData
                                  ? (kind, title) => setDrill({ kind, title })
                                  : undefined
                              }
                              onReconcile={
                                showReconcile && analyticsData
                                  ? () => setReconcileOpen(true)
                                  : undefined
                              }
                              footer={
                                canManage ? (
                                  <PeriodControls
                                    siteId={selectedFilterSite}
                                    onChanged={() => reprocess(selectedFilterSite)}
                                  />
                                ) : undefined
                              }
                            />
                          </CardBody>
                        </Card>
                      )}

                      {!analyticsData ? (
                        analyticsLoading ? (
                          <Flex justify="center" align="center" py={10}>
                            <VStack spacing={4}>
                              <Spinner size="xl" color="brand.500" thickness="4px" />
                              <Text color={secondaryTextColor}>
                                Loading the rest of the report…
                              </Text>
                            </VStack>
                          </Flex>
                        ) : analyticsError ? null : (
                          <Alert status="info" borderRadius="md">
                            <AlertIcon />
                            No analytics data yet. Use the refresh button in the
                            period bar to load it.
                          </Alert>
                        )
                      ) : (
                        <>
                          {/* Key Metrics Summary with VAT */}
                          <Card>
                            <CardBody>
                              <Heading size="md" mb={6}>
                                Key Performance Indicators
                              </Heading>
                              <SimpleGrid
                                columns={{ base: 1, md: 2, lg: 4 }}
                                spacing={6}
                              >
                                <Stat>
                                  <StatLabel>
                                    <HStack>
                                      <Icon as={FiShoppingCart} />
                                      <Text>Purchase Orders</Text>
                                    </HStack>
                                  </StatLabel>
                                  <StatNumber>
                                    {analyticsData.summary.totalPurchaseOrders}
                                  </StatNumber>
                                  <StatHelpText>
                                    {analyticsData.purchaseOrders.totalValue.toLocaleString()}{" "}
                                    excl. VAT
                                  </StatHelpText>
                                </Stat>
                                <Stat>
                                  <StatLabel>
                                    <HStack>
                                      <Icon as={FiUsers} />
                                      <Text>People Served</Text>
                                    </HStack>
                                  </StatLabel>
                                  <StatNumber>
                                    {analyticsData.summary.totalPeopleFed.toLocaleString()}
                                  </StatNumber>
                                  <StatHelpText>
                                    {analyticsData.dispatches.costPerPerson.toFixed(
                                      2,
                                    )}{" "}
                                    per person
                                  </StatHelpText>
                                </Stat>
                                {showFinance && (
                                <Stat>
                                  <StatLabel>
                                    <HStack>
                                      <Icon as={FiPercent} />
                                      <Text>VAT Payable</Text>
                                    </HStack>
                                  </StatLabel>
                                  <StatNumber
                                    color={
                                      analyticsData.summary.netVATLiability >= 0
                                        ? "red.500"
                                        : "green.500"
                                    }
                                  >
                                    SZL{" "}
                                    {Math.abs(
                                      analyticsData.summary.netVATLiability,
                                    ).toLocaleString()}
                                  </StatNumber>
                                  <StatHelpText>
                                    {analyticsData.summary.netVATLiability >= 0
                                      ? "Payable"
                                      : "Refundable"}
                                  </StatHelpText>
                                </Stat>
                                )}
                                <Stat>
                                  <StatLabel>
                                    <HStack>
                                      <Icon as={FiAlertTriangle} />
                                      <Text>Low Stock</Text>
                                    </HStack>
                                  </StatLabel>
                                  <StatNumber>
                                    {analyticsData.summary.lowStockItems}
                                  </StatNumber>
                                  <StatHelpText>
                                    {analyticsData.summary.criticalStockItems}{" "}
                                    critical
                                  </StatHelpText>
                                </Stat>
                              </SimpleGrid>
                            </CardBody>
                          </Card>

                          {/* VAT Summary Card (finance roles only) */}
                          {showFinance && (
                          <Card borderLeft="4px" borderColor="blue.500">
                            <CardBody>
                              <Heading size="md" mb={4} color="blue.700">
                                <HStack>
                                  <Icon as={FiPercent} />
                                  <Text>
                                    VAT Summary (Eswatini{" "}
                                    {VAT_CONFIG.ratePercentage}%)
                                  </Text>
                                </HStack>
                              </Heading>
                              <SimpleGrid
                                columns={{ base: 1, md: 3 }}
                                spacing={6}
                              >
                                <Stat>
                                  <StatLabel>Output VAT (Sales)</StatLabel>
                                  <StatNumber>
                                    SZL{" "}
                                    {analyticsData.vat.summary.totalOutputVAT.toLocaleString()}
                                  </StatNumber>
                                  <StatHelpText>
                                    VAT collected on sales
                                  </StatHelpText>
                                </Stat>
                                <Stat>
                                  <StatLabel>Input VAT (Purchases)</StatLabel>
                                  <StatNumber>
                                    SZL{" "}
                                    {analyticsData.vat.summary.totalInputVAT.toLocaleString()}
                                  </StatNumber>
                                  <StatHelpText>
                                    VAT paid on purchases
                                  </StatHelpText>
                                </Stat>
                                <Stat>
                                  <StatLabel>Net VAT Payable</StatLabel>
                                  <StatNumber
                                    color={
                                      analyticsData.vat.summary.netVATPayable >=
                                      0
                                        ? "red.500"
                                        : "green.500"
                                    }
                                  >
                                    SZL{" "}
                                    {Math.abs(
                                      analyticsData.vat.summary.netVATPayable,
                                    ).toLocaleString()}
                                  </StatNumber>
                                  <StatHelpText>
                                    {analyticsData.vat.summary.netVATPayable >=
                                    0
                                      ? "Amount due to tax authority"
                                      : "Refund claimable"}
                                  </StatHelpText>
                                </Stat>
                              </SimpleGrid>
                            </CardBody>
                          </Card>
                          )}

                          {/* Operational Overview */}
                          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
                            <StatusPieChart
                              data={
                                analyticsData.purchaseOrders?.byStatus || []
                              }
                              title="Purchase Orders by Status"
                              colors={[
                                CHART_COLORS.primary[0],
                                CHART_COLORS.warning[0],
                                CHART_COLORS.success[0],
                                CHART_COLORS.error[0],
                              ]}
                              isLoading={analyticsLoading}
                            />

                            {/* For multi-site users: Show by Site chart */}
                            {/* For single-site users: Show by Status chart (filtered) */}
                            {userSiteInfo.canAccessMultipleSites ? (
                              <BarChartComponent
                                data={
                                  analyticsData.purchaseOrders?.bySite || []
                                }
                                title="Purchase Orders by Site"
                                dataKey="value"
                                isLoading={analyticsLoading}
                              />
                            ) : (
                              <StatusPieChart
                                data={
                                  analyticsData.purchaseOrders?.byStatus?.filter(
                                    (status: any) => status.value > 0,
                                  ) || []
                                }
                                title="Purchase Orders by Status (Detailed)"
                                colors={[
                                  CHART_COLORS.primary[0],
                                  CHART_COLORS.warning[0],
                                  CHART_COLORS.success[0],
                                  CHART_COLORS.error[0],
                                ]}
                                isLoading={analyticsLoading}
                              />
                            )}
                          </SimpleGrid>

                          {/* Dispatch & Inventory Analytics */}
                          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
                            <StatusPieChart
                              data={analyticsData.dispatches?.byType || []}
                              title="Dispatches by Type"
                              colors={CHART_COLORS.success}
                              isLoading={analyticsLoading}
                            />
                            <StatusPieChart
                              data={analyticsData.inventory?.byCategory || []}
                              title="Inventory by Category"
                              colors={CHART_COLORS.purple}
                              isLoading={analyticsLoading}
                            />
                          </SimpleGrid>

                          {/* Supplier Performance - Filter by site */}
                          {analyticsData.suppliers.performance.length > 0 && (
                            <Card>
                              <CardBody>
                                <Heading size="sm" mb={4}>
                                  Top Suppliers
                                  {!userSiteInfo.canAccessMultipleSites &&
                                    userSiteInfo.userSiteName && (
                                      <Badge ml={2} colorScheme="green">
                                        {userSiteInfo.userSiteName}
                                      </Badge>
                                    )}
                                  {selectedFilterSite && (
                                    <Badge ml={2} colorScheme="purple">
                                      Filtered:{" "}
                                      {
                                        availableSites.find(
                                          (s) => s._id === selectedFilterSite,
                                        )?.name
                                      }
                                    </Badge>
                                  )}
                                </Heading>
                                <TableContainer>
                                  <Table variant="simple">
                                    <Thead>
                                      <Tr>
                                        <Th>Supplier</Th>
                                        <Th isNumeric>Orders</Th>
                                        <Th isNumeric>Total Value</Th>
                                        <Th isNumeric>VAT Amount</Th>
                                      </Tr>
                                    </Thead>
                                    <Tbody>
                                      {analyticsData.suppliers.performance
                                        .slice(0, 5)
                                        .map((supplier, index) => (
                                          <Tr key={supplier.name}>
                                            <Td>{supplier.name}</Td>
                                            <Td isNumeric>{supplier.orders}</Td>
                                            <Td isNumeric>
                                              SZL{" "}
                                              {supplier.value.toLocaleString()}
                                            </Td>
                                            <Td isNumeric>
                                              SZL{" "}
                                              {supplier.vatAmount.toLocaleString()}
                                            </Td>
                                          </Tr>
                                        ))}
                                    </Tbody>
                                  </Table>
                                </TableContainer>
                              </CardBody>
                            </Card>
                          )}
                        </>
                      )}
                    </VStack>
                  </TabPanel>

                  {/* Visual Analytics Tab */}
                  <TabPanel>
                    <VisualAnalyticsTab
                      analyticsData={analyticsData}
                      loading={analyticsLoading}
                    />
                  </TabPanel>

                  {/* Data Export Tab */}
                  <TabPanel>
                    <DataExportTab
                      exportToExcel={exportToExcel}
                      loading={exportLoading}
                      dataAvailable={!!analyticsData}
                    />
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </CardBody>
          </Card>
        </VStack>
      </Box>

      {/* Drill-down and reconciliation sheets */}
      <DrillDownDrawer
        isOpen={!!drill}
        onClose={() => setDrill(null)}
        title={drill?.title || ""}
        description={`${primaryDateRange.start} to ${primaryDateRange.end}`}
        rows={drillRows}
        showValues={showFinance}
      />
      <ReconciliationPanel
        isOpen={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        rows={reconciliationRows}
      />
    </Box>
  );
}
