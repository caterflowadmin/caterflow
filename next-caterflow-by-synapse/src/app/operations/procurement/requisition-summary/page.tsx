// src/app/operations/procurement/requisition-summary/page.tsx - FIXED VERSION
"use client";
import { logger } from '@/lib/logger';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  SetStateAction,
} from "react";
import {
  Box,
  Heading,
  Button,
  Flex,
  Spinner,
  useToast,
  useColorModeValue,
  Card,
  CardBody,
  Text,
  VStack,
  HStack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Select,
  FormControl,
  FormLabel,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Badge,
  Icon,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Input,
  InputGroup,
  InputLeftElement,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatArrow,
  Skeleton,
  Tooltip,
  IconButton,
  Progress,
  useBreakpointValue,
  TextProps,
  ModalCloseButton,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Grid,
  GridItem,
  SimpleGrid,
  Divider,
  Tag,
  TagLabel,
  TagLeftIcon,
  Wrap,
  WrapItem,
  Image,
  Link,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverArrow,
  PopoverCloseButton,
  Center,
  Circle,
  Avatar,
  AvatarGroup,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuGroup,
  MenuDivider,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
} from "@chakra-ui/react";
import {
  FiDownload,
  FiPrinter,
  FiFilter,
  FiCalendar,
  FiHome,
  FiFileText,
  FiExternalLink,
  FiRefreshCw,
  FiEye,
  FiTrendingUp,
  FiPackage,
  FiDollarSign,
  FiCheckCircle,
  FiChevronRight,
  FiChevronLeft,
  FiSearch,
  FiGrid,
  FiList,
  FiBarChart2,
  FiUsers,
  FiTruck,
  FiShoppingBag,
  FiShoppingCart,
  FiMapPin,
  FiPhone,
  FiMail,
  FiUser,
  FiGlobe,
  FiDatabase,
  FiPieChart,
  FiArchive,
  FiCreditCard,
  FiCalendar as FiCalendarIcon,
  FiClock,
  FiPercent,
  FiBox,
  FiLayers,
  FiStar,
  FiActivity,
  FiTrendingDown,
  FiInfo,
  FiMoreVertical,
  FiShare2,
  FiCopy,
  FiSave,
  FiSettings,
  FiBarChart,
  FiAward,
  FiTarget,
  FiShoppingBag as FiBag,
  FiTrello,
  FiBook,
  FiFile,
  FiClipboard,
  FiCheckSquare,
  FiHash,
  FiTag,
  FiCodesandbox,
  FiBriefcase,
  FiAnchor,
  FiCoffee,
  FiDroplet,
  FiWind,
  FiSun,
  FiMoon,
  FiCloud,
} from "react-icons/fi";
import { useSession } from "next-auth/react";
import LinkNext from "next/link";
import dynamic from "next/dynamic";
import DatePicker from "@/components/DatePickerWrapper";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";
import "react-datepicker/dist/react-datepicker.css";

interface Site {
  _id: string;
  name: string;
  address?: string;
  contactPerson?: string;
  phoneNumber?: string;
}

interface Supplier {
  _id: string;
  name: string;
  code?: string;
  // Removed: contactPerson, phoneNumber, email, address, terms
}

interface RequisitionItem {
  siteId: string;
  siteName: string;
  siteAddress?: string;
  siteContact?: string;
  sitePhone?: string;
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  supplierAddress?: string;
  supplierTerms?: string;
  supplierCode?: string;
  amount: number;
  category: string;
  subCategory?: string;
  poNumber: string;
  orderDate: string;
  itemName: string;
  itemSku?: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  orderedBy?: string;
  orderedByRole?: string;
  poStatus?: string;
}

interface SupplierPerformance {
  totalAmount: number;
  itemCount: number;
  purchaseOrderCount: number;
  firstOrderDate?: string;
  lastOrderDate?: string;
  averageOrderValue: number;
  itemsPerPO: number;
  siteCount: number;
  sites: Site[];
}

interface EnhancedRequisitionSummary {
  items: RequisitionItem[];
  itemsBySite: Array<{
    site: Site;
    items: RequisitionItem[];
    itemsByCategory: Array<{
      category: string;
      items: RequisitionItem[];
      itemsBySubCategory: Array<{
        subCategory: string;
        items: RequisitionItem[];
        totalAmount: number;
        itemCount: number;
      }>;
      totalAmount: number;
      itemCount: number;
    }>;
    totalAmount: number;
    itemCount: number;
    supplierCount: number;
    siteSuppliers: Supplier[];
  }>;
  itemsByCategory: Array<{
    category: string;
    items: RequisitionItem[];
    itemsBySite: Array<{
      site: Site;
      items: RequisitionItem[];
      totalAmount: number;
      itemCount: number;
    }>;
    totalAmount: number;
    itemCount: number;
  }>;
  itemsBySupplier: Array<{
    supplier: Supplier;
    items: RequisitionItem[];
    performance: SupplierPerformance;
    // Removed: contactInfo
  }>;
  stats: {
    totalAmount: number;
    totalItems: number;
    totalPurchaseOrders: number;
    totalSites: number;
    totalSuppliers: number;
    totalCategories: number;
    averageOrderValue: number;
    averageItemsPerPO: number;
    averageSupplierPerSite: number;
  };
  totalAmount: number;
  sites: Site[];
  suppliers: Supplier[];
  supplierPerformance: Array<{
    supplier: Supplier;
    totalAmount: number;
    itemCount: number;
    purchaseOrderCount: number;
    firstOrderDate?: string;
    lastOrderDate?: string;
  }>;
  categories: string[];
  purchaseOrdersCount: number;
  itemsCount: number;
  generatedAt: string;
  filters: {
    siteCount: number;
    supplierCount: number;
    categoryCount: number;
  };
}

// Cache to prevent unnecessary re-fetches
//const dataCache = new Map();

// Currency Icon Component - FIXED: Use as="span" to avoid nesting issues
interface CurrencyIconProps extends TextProps {
  _?: never;
}

const CurrencyIcon = (props: CurrencyIconProps) => {
  return (
    <Text as="span" fontWeight="bold" {...props}>
      E
    </Text>
  );
};

export default function EnhancedRequisitionSummaryPage() {
  const { status } = useSession();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<EnhancedRequisitionSummary | null>(
    null,
  );
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [categories, setCategories] = useState<
    { _id: string; title: string; description?: string }[]
  >([]);
  const toast = useToast();

  const {
    isOpen: isExportModalOpen,
    onOpen: onExportModalOpen,
    onClose: onExportModalClose,
  } = useDisclosure();

  const {
    isOpen: isDateModalOpen,
    onOpen: onDateModalOpen,
    onClose: onDateModalClose,
  } = useDisclosure();

  const {
    isOpen: isFilterModalOpen,
    onOpen: onFilterModalOpen,
    onClose: onFilterModalClose,
  } = useDisclosure();

  // Responsive values
  const isMobile = useBreakpointValue({ base: true, md: false });
  const tableSize = useBreakpointValue({ base: "sm", md: "md" });
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);
  const [startDate, endDate] = dateRange;

  // Theming
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
  const accentColor = useColorModeValue("brand.500", "brand.300");
  const successColor = useColorModeValue("green.500", "green.300");
  const warningColor = useColorModeValue("orange.500", "orange.300");
  const infoColor = useColorModeValue("blue.500", "blue.300");
  const hoverColor = useColorModeValue("gray.50", "gray.700");

  const scrollbarThumbColor = useColorModeValue("brand.300", "brand.500");
  const scrollbarTrackColor = useColorModeValue("gray.100", "gray.700");

  // Helper to check if current filters match the displayed data
  const validateFilterConsistency = useCallback(() => {
    if (!summary) return true;

    // If we have a supplier filter, check if all items match
    if (selectedSupplier !== "all") {
      const hasMismatch = summary.items.some(
        (item) => item.supplierId !== selectedSupplier,
      );
      if (hasMismatch) {
        console.warn(
          "⚠️ Data inconsistency detected: Items from other suppliers present",
        );
        return false;
      }
    }

    // If we have a category filter, check if all items match
    if (selectedCategory !== "all") {
      const hasMismatch = summary.items.some(
        (item) => item.category !== selectedCategory,
      );
      if (hasMismatch) {
        console.warn(
          "⚠️ Data inconsistency detected: Items from other categories present",
        );
        return false;
      }
    }

    return true;
  }, [summary, selectedSupplier, selectedCategory]);

  const dateFilterText = useCallback(() => {
    if (startDate && endDate) {
      return `From ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
    } else if (startDate) {
      return `From ${startDate.toLocaleDateString()}`;
    } else if (endDate) {
      return `Until ${endDate.toLocaleDateString()}`;
    }
    return "All dates";
  }, [startDate, endDate]);

  // Fetch categories - memoized to prevent unnecessary re-fetches
  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch("/api/categories");
      if (!response.ok) throw new Error("Failed to fetch categories");
      const data = await response.json();
      setCategories(data);
      logger.debug("📋 Categories loaded:", data.length);
    } catch (err: any) {
      console.error("Failed to fetch categories:", err);
      // Don't show toast for categories error on initial load
      if (!isInitialLoad) {
        toast({
          title: "Warning",
          description: "Could not load categories, using defaults",
          status: "warning",
          duration: 3000,
          isClosable: true,
          position: "top-right",
        });
      }
    }
  }, [toast, isInitialLoad]);

  // Fetch requisition summary - ALWAYS fetches fresh data with current filters
  const fetchRequisitionSummary = useCallback(async () => {
    setLoading(true);

    // Show loading state for better UX
    if (isInitialLoad) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      const params = new URLSearchParams();

      // Send ALL active filters to the API
      if (selectedSite && selectedSite !== "all") {
        params.append("siteId", selectedSite);
      }

      // ✅ FIXED: Send supplier filter to API
      if (selectedSupplier && selectedSupplier !== "all") {
        params.append("supplierId", selectedSupplier);
      }

      // ✅ FIXED: Send category filter to API
      if (selectedCategory && selectedCategory !== "all") {
        params.append("category", selectedCategory);
      }

      // ✅ FIXED: Consistent date formatting
      const formatDateForAPI = (date: Date | null): string | null => {
        if (!date) return null;
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      if (startDate) {
        const formattedDate = formatDateForAPI(startDate);
        if (formattedDate) {
          params.append("startDate", formattedDate);
        }
      }

      if (endDate) {
        const formattedDate = formatDateForAPI(endDate);
        if (formattedDate) {
          params.append("endDate", formattedDate);
        }
      }

      // Always fetch approved POs
      params.append("status", "approved");

      // 🔍 REQUEST SIGNATURE - This shows exactly what's being sent
      logger.debug("🔑 Request signature:", {
        site: selectedSite !== "all" ? selectedSite : "all",
        supplier: selectedSupplier !== "all" ? selectedSupplier : "all",
        category: selectedCategory !== "all" ? selectedCategory : "all",
        startDate: startDate ? formatDateForAPI(startDate) : "none",
        endDate: endDate ? formatDateForAPI(endDate) : "none",
        url: `/api/procurement/requisition-summary?${params.toString()}`,
      });

      const response = await fetch(
        `/api/procurement/requisition-summary?${params.toString()}`,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || "Failed to fetch requisition summary",
        );
      }

      const data = await response.json();

      // Validate that we got data
      if (!data) {
        throw new Error("No data received from server");
      }

      setSummary(data);

      if (isInitialLoad) {
        toast({
          title: "Data Loaded",
          description: `Found ${data.items?.length || 0} requisition items`,
          status: "success",
          duration: 2000,
          isClosable: true,
          position: "top-right",
        });
        setIsInitialLoad(false);
      }
    } catch (err: any) {
      console.error("❌ Error fetching requisition summary:", err);

      // Only show toast if not initial load or if it's a real error
      if (!isInitialLoad || err.message !== "Failed to fetch") {
        toast({
          title: "Error Loading Data",
          description: err?.message || "Failed to load requisition summary",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      }

      // Set summary to null to show empty state
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [
    selectedSite,
    selectedSupplier,
    selectedCategory,
    startDate,
    endDate,
    isInitialLoad,
    toast,
  ]);

  // Fetch data when filters change or when authenticated
  useEffect(() => {
    if (status === "authenticated") {
      // Fetch categories first (they don't change often)
      fetchCategories();

      // Debounce the requisition summary fetch to avoid too many requests
      // when user is quickly changing multiple filters
      const timer = setTimeout(() => {
        fetchRequisitionSummary();
      }, 500); // Slightly longer debounce for better UX

      return () => clearTimeout(timer);
    }
  }, [
    status,
    selectedSite,
    selectedSupplier,
    selectedCategory,
    startDate,
    endDate,
    fetchRequisitionSummary,
    fetchCategories,
  ]);

  // Optional: Validate data consistency when summary changes
  useEffect(() => {
    if (summary && !isInitialLoad) {
      const isConsistent = validateFilterConsistency();
      if (!isConsistent) {
        console.error("❌ Data inconsistency detected! Refetching...");
        fetchRequisitionSummary();
      }
    }
  }, [
    summary,
    validateFilterConsistency,
    fetchRequisitionSummary,
    isInitialLoad,
  ]);

  // Filter items based on multiple criteria
  const filteredItems = useMemo(() => {
    if (!summary) return [];

    let filtered = summary.items;

    // Apply site filter
    if (selectedSite !== "all") {
      filtered = filtered.filter((item) => item.siteId === selectedSite);
    }

    // Apply supplier filter
    if (selectedSupplier !== "all") {
      filtered = filtered.filter(
        (item) => item.supplierId === selectedSupplier,
      );
    }

    // Apply category filter
    if (selectedCategory !== "all") {
      filtered = filtered.filter((item) => item.category === selectedCategory);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.supplierName.toLowerCase().includes(query) ||
          item.siteName.toLowerCase().includes(query) ||
          item.itemName.toLowerCase().includes(query) ||
          item.poNumber.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          item.itemSku?.toLowerCase().includes(query),
        // Removed: supplierContact and supplierPhone search
      );
    }

    return filtered;
  }, [summary, selectedSite, selectedSupplier, selectedCategory, searchQuery]);

  // Calculate filtered stats
  const filteredStats = useMemo(() => {
    if (!summary || !summary.stats) return null;

    const itemsToUse = filteredItems;
    const totalAmount = itemsToUse.reduce((sum, item) => sum + item.amount, 0);
    const uniqueSuppliers = new Set(itemsToUse.map((item) => item.supplierId))
      .size;
    const uniqueSites = new Set(itemsToUse.map((item) => item.siteId)).size;
    const uniqueCategories = new Set(itemsToUse.map((item) => item.category))
      .size;
    const uniquePOs = new Set(itemsToUse.map((item) => item.poNumber)).size;

    return {
      totalAmount,
      itemCount: itemsToUse.length,
      uniqueSuppliers,
      uniqueSites,
      uniqueCategories,
      uniquePOs,
      averagePerItem:
        itemsToUse.length > 0 ? totalAmount / itemsToUse.length : 0,
      averagePerPO: uniquePOs > 0 ? totalAmount / uniquePOs : 0,
    };
  }, [summary, filteredItems]);

  // Handle tab change
  const handleTabChange = (index: number) => {
    setActiveTab(index);
  };

  // Handle manual refresh - always fetches fresh data
  const handleRefresh = useCallback(() => {
    // Show loading state immediately
    setLoading(true);

    // Fetch fresh data
    fetchRequisitionSummary();

    toast({
      title: "Refreshing Data",
      description: "Fetching the latest requisition information...",
      status: "info",
      duration: 2000,
      isClosable: true,
      position: "top-right",
    });
  }, [fetchRequisitionSummary, toast]);

  // Clear all filters and fetch fresh data
  const clearFilters = useCallback(() => {
    // Reset all filter states
    setSelectedSite("all");
    setSelectedSupplier("all");
    setSelectedCategory("all");
    setDateRange([null, null]);
    setSearchQuery("");

    // Show loading state
    setLoading(true);

    // Fetch fresh data with cleared filters
    // Use setTimeout to ensure state updates are applied
    setTimeout(() => {
      fetchRequisitionSummary();
    }, 50);

    toast({
      title: "Filters Cleared",
      description: "Showing all requisition data",
      status: "info",
      duration: 2000,
      isClosable: true,
      position: "top-right",
    });
  }, [fetchRequisitionSummary, toast]);

  // Export to PDF with enhanced information
  const exportToPDF = async () => {
    if (!summary) return;

    try {
      setExporting(true);

      const htmlContent = generateEnhancedRequisitionHTML(
        summary,
        filteredStats || summary.stats,
      );

      // Use the export helper function
      await exportReportsSequentialHelper([
        {
          htmlContent,
          windowName: `Enhanced-Requisition-Summary-${new Date().toISOString().split("T")[0]}`,
          displayName: `Enhanced-Requisition-Summary-${new Date().toISOString().split("T")[0]}.pdf`,
        },
      ]);

      toast({
        title: "Print Ready",
        description: "Enhanced document is ready for printing (Ctrl+P)",
        status: "success",
        duration: 3000,
        isClosable: true,
        position: "top-right",
      });

      onExportModalClose();
    } catch (err: any) {
      console.error("Export failed:", err);
      toast({
        title: "Export Failed",
        description: err?.message || "Failed to generate enhanced requisition",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top-right",
      });
    } finally {
      setExporting(false);
    }
  };

  // Generate Enhanced HTML for PDF export
  // Generate Enhanced HTML for PDF export - UPDATED VERSION
  const generateEnhancedRequisitionHTML = (
    summaryData: EnhancedRequisitionSummary,
    stats: any,
  ) => {
    const currentDate = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    // Define dateFilterText inside the function since it's used in the HTML
    const dateFilterText = () => {
      if (startDate && endDate) {
        return `From ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
      } else if (startDate) {
        return `From ${startDate.toLocaleDateString()}`;
      } else if (endDate) {
        return `Until ${endDate.toLocaleDateString()}`;
      }
      return "All dates";
    };

    // Group items by PO Number
    const itemsByPO = new Map<
      string,
      {
        poNumber: string;
        orderDate: string;
        orderedBy: string;
        siteName: string;
        siteAddress?: string;
        status: string;
        items: RequisitionItem[];
        totalAmount: number;
      }
    >();

    // Process items and group by PO
    summaryData.items.forEach((item) => {
      const poKey = item.poNumber;
      if (!itemsByPO.has(poKey)) {
        itemsByPO.set(poKey, {
          poNumber: item.poNumber,
          orderDate: item.orderDate,
          orderedBy: item.orderedBy || "Unknown",
          siteName: item.siteName,
          siteAddress: item.siteAddress,
          status: item.poStatus || "Approved",
          items: [],
          totalAmount: 0,
        });
      }

      const poGroup = itemsByPO.get(poKey)!;
      poGroup.items.push(item);
      poGroup.totalAmount += item.amount;
    });

    // Convert to array and sort by PO number
    const poGroups = Array.from(itemsByPO.values()).sort((a, b) =>
      a.poNumber.localeCompare(b.poNumber),
    );

    return `
<!DOCTYPE html>
<html>
<head>
    <title>ENHANCED REQUISITION SUMMARY - COMPREHENSIVE REPORT</title>
    <style>
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
            margin: 15px; 
            color: #000;
            font-size: 9px;
            line-height: 1.2;
        }
        
        /* Header Styles */
        .header {
            text-align: center;
            margin-bottom: 15px;
            border-bottom: 3px double #0067FF;
            padding-bottom: 10px;
        }
        
        .header h1 {
            margin: 0;
            font-size: 16px;
            text-transform: uppercase;
            font-weight: bold;
            color: #0067FF;
            letter-spacing: 1px;
        }
        
        .header h2 {
            margin: 3px 0;
            font-size: 12px;
            color: #333;
            font-weight: 500;
        }
        
        /* Executive Summary */
        .executive-summary {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 15px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 10px;
        }
        
        .summary-item {
            text-align: center;
            padding: 6px;
            background: white;
            border-radius: 3px;
            border: 1px solid #e9ecef;
        }
        
        .summary-label {
            font-size: 8px;
            color: #6c757d;
            margin-bottom: 2px;
        }
        
        .summary-value {
            font-size: 11px;
            font-weight: bold;
            color: #0067FF;
        }
        
        /* PO Sections */
        .po-section {
            margin: 20px 0 15px 0;
            page-break-inside: auto;
        }
        
        .po-header {
            background-color: #0067FF;
            color: white;
            padding: 6px 8px;
            font-weight: bold;
            font-size: 10px;
            border-radius: 3px 3px 0 0;
            display: flex;
            justify-content: space-between;
        }
        
        .po-details {
            background-color: #f0f0f0;
            padding: 6px 8px;
            font-size: 8px;
            border-left: 1px solid #dee2e6;
            border-right: 1px solid #dee2e6;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
        }
        
        .po-info-item {
            display: flex;
            flex-direction: column;
        }
        
        .po-info-label {
            font-weight: bold;
            color: #555;
        }
        
        .po-info-value {
            color: #000;
        }
        
        /* Main Table */
        .requisition-table {
            width: 100%;
            border-collapse: collapse;
            margin: 5px 0 10px 0;
            font-size: 8px;
        }
        
        .requisition-table th {
            background-color: #f5f5f5;
            border: 1px solid #000;
            padding: 4px 3px;
            text-align: left;
            font-weight: bold;
            white-space: nowrap;
        }
        
        .requisition-table td {
            border: 1px solid #000;
            padding: 3px 3px;
            vertical-align: top;
            font-size: 8px;
        }
        
        .col-no { width: 3%; }
        .col-item { width: 22%; }
        .col-sku { width: 8%; }
        .col-supplier { width: 15%; }
        .col-code { width: 6%; }
        .col-qty { width: 6%; }
        .col-unit { width: 6%; }
        .col-category { width: 10%; }
        .col-uprice { width: 10%; }
        .col-amount { width: 10%; }
        .col-status { width: 4%; }
        
        .amount-cell {
            text-align: right;
            font-family: monospace;
            font-size: 8px;
        }
        
        .number-cell {
            text-align: center;
        }
        
        /* Totals and Footers */
        .total-row {
            background-color: #f8f8f8;
            font-weight: bold;
            border-top: 2px solid #000;
        }
        
        .po-total {
            font-weight: bold;
            background-color: #e9ecef;
            padding: 6px 8px;
            text-align: right;
            border-top: 2px solid #adb5bd;
            font-size: 9px;
            border: 1px solid #dee2e6;
            border-top: none;
        }
        
        .grand-total {
            border-top: 3px double #000;
            font-size: 12px;
            font-weight: bold;
            text-align: right;
            padding: 12px 0;
            margin-top: 20px;
            color: #0067FF;
            background-color: #f8f8f8;
            padding-right: 10px;
        }
        
        .currency-symbol {
            font-family: monospace;
            color: #0067FF;
        }
        
        /* Signature Section */
        .signature-section {
            margin-top: 40px;
            border-top: 1px solid #000;
            padding-top: 20px;
        }
        
        .signature-line {
            display: inline-block;
            width: 180px;
            border-top: 1px solid #000;
            margin: 0 20px;
            padding-top: 4px;
            text-align: center;
            font-size: 8px;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 7px;
            color: #666;
            border-top: 1px solid #ccc;
            padding-top: 8px;
        }
        
        /* Page Break Handling */
        .page-break {
            page-break-before: auto;
        }
        
        @media print {
            body { 
                margin: 10px;
                font-size: 8px;
            }
            .no-print { 
                display: none; 
            }
            .requisition-table {
                font-size: 7px;
            }
            .po-section {
                page-break-inside: auto;
            }
        }
    </style>
</head>
<body>

    <div class="header">
        <h1>ENHANCED REQUISITION SUMMARY REPORT</h1>
        <h2>COMPREHENSIVE PROCUREMENT ANALYSIS</h2>
        <p style="font-size: 9px; margin: 2px 0;">Report Date: ${currentDate} | Generated: ${new Date().toLocaleString("en-GB")}</p>
        <p style="font-size: 8px; color: #666; margin: 2px 0;">Period: ${dateFilterText()}</p>
    </div>
    
    <!-- Executive Summary -->
    <div class="executive-summary">
        <h3 style="font-size: 10px; margin: 0 0 8px 0; color: #0067FF;">EXECUTIVE SUMMARY</h3>
        
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-label">Total Amount</div>
                <div class="summary-value">
                    <span class="currency-symbol">E </span>
                    ${stats.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Total Items</div>
                <div class="summary-value">${stats.itemCount}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Purchase Orders</div>
                <div class="summary-value">${stats.uniquePOs || summaryData.purchaseOrdersCount}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Sites</div>
                <div class="summary-value">${stats.uniqueSites || summaryData.stats.totalSites}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Suppliers</div>
                <div class="summary-value">${stats.uniqueSuppliers || summaryData.stats.totalSuppliers}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Categories</div>
                <div class="summary-value">${stats.uniqueCategories || summaryData.stats.totalCategories}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Avg/Item</div>
                <div class="summary-value">
                    <span class="currency-symbol">E </span>
                    ${stats.averagePerItem.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Avg/PO</div>
                <div class="summary-value">
                    <span class="currency-symbol">E </span>
                    ${stats.averagePerPO.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
            </div>
        </div>
    </div>
    
    <!-- Detailed Items by Purchase Order -->
    ${poGroups
      .map((poGroup) => {
        let itemCounter = 0;

        return `
        <div class="po-section">
            <div class="po-header">
                <span>${poGroup.poNumber}</span>
                <span>PO Total: <span class="currency-symbol">E </span>${poGroup.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            </div>
            
            <div class="po-details">
                <div class="po-info-item">
                    <span class="po-info-label">Order Date:</span>
                    <span class="po-info-value">${new Date(poGroup.orderDate).toLocaleDateString("en-GB")}</span>
                </div>
                <div class="po-info-item">
                    <span class="po-info-label">Ordered By:</span>
                    <span class="po-info-value">${poGroup.orderedBy}</span>
                </div>
                <div class="po-info-item">
                    <span class="po-info-label">Status:</span>
                    <span class="po-info-value">${poGroup.status}</span>
                </div>
                <div class="po-info-item">
                    <span class="po-info-label">Site:</span>
                    <span class="po-info-value">${poGroup.siteName}</span>
                </div>
                ${
                  poGroup.siteAddress && poGroup.siteAddress !== "N/A"
                    ? `
                <div class="po-info-item">
                    <span class="po-info-label">Site Address:</span>
                    <span class="po-info-value">${poGroup.siteAddress}</span>
                </div>
                `
                    : ""
                }
                <div class="po-info-item">
                    <span class="po-info-label">Items in PO:</span>
                    <span class="po-info-value">${poGroup.items.length}</span>
                </div>
            </div>
            
            <table class="requisition-table">
                <thead>
                    <tr>
                        <th class="col-no">#</th>
                        <th class="col-item">ITEM DESCRIPTION</th>
                        <th class="col-sku">SKU</th>
                        <th class="col-supplier">SUPPLIER</th>
                        <th class="col-code">CODE</th>
                        <th class="col-qty">QTY</th>
                        <th class="col-unit">UNIT</th>
                        <th class="col-category">CATEGORY</th>
                        <th class="col-uprice">UNIT PRICE</th>
                        <th class="col-amount">AMOUNT</th>
                        <th class="col-status">STATUS</th>
                    </tr>
                </thead>
                <tbody>
                    ${poGroup.items
                      .map((item) => {
                        itemCounter++;
                        const unitPrice = resolveUnitPrice(
                          item.unitPrice,
                          undefined,
                          item.amount / item.quantity,
                        );

                        return `
                        <tr>
                            <td class="number-cell">${itemCounter}</td>
                            <td><strong>${item.itemName}</strong></td>
                            <td>${item.itemSku || "N/A"}</td>
                            <td>
                                <strong>${item.supplierName}</strong>
                                ${item.supplierCode ? `<br><small>Code: ${item.supplierCode}</small>` : ""}
                            </td>
                            <td class="number-cell">${item.supplierCode || "N/A"}</td>
                            <td class="number-cell">${item.quantity}</td>
                            <td class="number-cell">${item.unitOfMeasure}</td>
                            <td>${item.category}</td>
                            <td class="amount-cell">
                                <span class="currency-symbol">E </span>
                                ${unitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td class="amount-cell">
                                <span class="currency-symbol">E </span>
                                ${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td class="number-cell">${item.poStatus || "Approved"}</td>
                        </tr>
                        `;
                      })
                      .join("")}
                    
                    <!-- PO Total Row -->
                    <tr class="total-row">
                        <td colspan="9" style="text-align: right; padding-right: 10px;">
                            <strong>TOTAL ${poGroup.poNumber} (${poGroup.items.length} items)</strong>
                        </td>
                        <td class="amount-cell">
                            <strong>
                                <span class="currency-symbol">E </span>
                                ${poGroup.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </strong>
                        </td>
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>
        `;
      })
      .join("")}
    
    <!-- Grand Total -->
    <div class="grand-total">
        REPORT GRAND TOTAL: <span class="currency-symbol">E </span>${stats.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <div style="font-size: 10px; margin-top: 4px;">
            ${stats.itemCount} items | ${stats.uniquePOs || summaryData.purchaseOrdersCount} POs | 
            ${stats.uniqueSuppliers || summaryData.stats.totalSuppliers} suppliers | 
            ${stats.uniqueSites || summaryData.stats.totalSites} sites
        </div>
    </div>
    
    <!-- Supplier Performance Summary -->
    <div style="margin-top: 30px;">
        <h3 style="font-size: 11px; color: #0067FF; border-bottom: 2px solid #0067FF; padding-bottom: 4px;">
            SUPPLIER PERFORMANCE SUMMARY
        </h3>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 8px;">
            <thead>
                <tr style="background-color: #f5f5f5; border: 1px solid #000;">
                    <th style="border: 1px solid #000; padding: 4px; text-align: left;">Supplier</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: right;">Total Amount</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">Items</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">POs</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: center;">Sites</th>
                    <th style="border: 1px solid #000; padding: 4px; text-align: right;">Avg/Item</th>
                </tr>
            </thead>
            <tbody>
                ${summaryData.itemsBySupplier
                  .slice(0, 20)
                  .map(
                    (supplierGroup) => `
                <tr style="border: 1px solid #ddd;">
                    <td style="border: 1px solid #ddd; padding: 4px;">
                        <strong>${supplierGroup.supplier.name}</strong>
                        ${supplierGroup.supplier.code ? `<br><small>Code: ${supplierGroup.supplier.code}</small>` : ""}
                    </td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: right;">
                        <span class="currency-symbol">E </span>
                        ${supplierGroup.performance.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${supplierGroup.performance.itemCount}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${supplierGroup.performance.purchaseOrderCount}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${supplierGroup.performance.siteCount}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: right;">
                        <span class="currency-symbol">E </span>
                        ${supplierGroup.performance.averageOrderValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                </tr>
                `,
                  )
                  .join("")}
            </tbody>
        </table>
    </div>
    
    <!-- Signature Section -->
    <div class="signature-section">
        <!-- First Line: 4 signature spaces -->
        <div style="text-align: center; margin-bottom: 20px;">
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Prepared By</div>
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Approved By</div>
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Finance Department</div>
        </div>
        
        <!-- Second Line: 4 signature spaces -->
        <div style="text-align: center;">
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Procurement Officer</div>
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Head of Department</div>
            <div class="signature-line" style="width: 22%; margin: 0 1.5%; display: inline-block;">Managing Director</div>
        </div>
    </div>
    
    <!-- Footer -->
    <div class="footer">
        <p>ENHANCED REQUISITION SUMMARY REPORT - GENERATED BY CATERFLOW PROCUREMENT SYSTEM</p>
        <p>Synapse Digital Solutions | ${new Date().getFullYear()} | Document ID: ERS-${currentDate.replace(/\//g, "")}-${Math.random().toString(36).substr(2, 8).toUpperCase()}</p>
        <p>Confidential - For Internal Use Only | Report Generated: ${new Date().toLocaleString(
          "en-GB",
          {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          },
        )}</p>
    </div>
    
    <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button onclick="window.print()" style="
            background: #0067FF;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            margin: 5px;
        ">
            Print Enhanced Document
        </button>
        <button onclick="window.close()" style="
            background: #718096;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            margin: 5px;
        ">
            Close Window
        </button>
    </div>
</body>
</html>
        `;
  };

  // Export Helper Function (keep existing)
  const exportReportsSequentialHelper = async (
    reports: any[],
    onProgress?: (progress: {
      current: number;
      total: number;
      fileName: string;
    }) => void,
  ) => {
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: reports.length,
          fileName: report.displayName || report.windowName,
        });
      }

      await new Promise<void>(async (resolve) => {
        try {
          const exportWindow = window.open("", "_blank");

          if (!exportWindow) {
            console.warn("Popup blocked. Please allow popups for this site.");
            toast({
              title: "Popup Blocked",
              description:
                "Please allow popups for this site to export reports.",
              status: "warning",
              duration: 5000,
              isClosable: true,
              position: "top-right",
            });
            resolve();
            return;
          }

          exportWindow.document.write(report.htmlContent);
          exportWindow.document.close();
          exportWindow.document.title = report.windowName;

          await new Promise<void>((readyResolve) => {
            if (exportWindow.document.readyState === "complete") {
              readyResolve();
              return;
            }

            exportWindow.addEventListener(
              "DOMContentLoaded",
              () => readyResolve(),
              { once: true },
            );
            setTimeout(() => readyResolve(), 50);
          });

          setTimeout(() => {
            try {
              exportWindow.print();
            } catch (printErr) {
              console.warn("Auto-print failed:", printErr);
            }

            let checkCount = 0;
            const maxChecks = 300;

            const checkClosed = setInterval(() => {
              checkCount++;

              if (exportWindow.closed || checkCount >= maxChecks) {
                clearInterval(checkClosed);
                resolve();

                if (!exportWindow.closed && checkCount >= maxChecks) {
                  try {
                    exportWindow.close();
                  } catch (e) {
                    console.warn("Could not close window:", e);
                  }
                }
              }
            }, 100);
          }, 50);
        } catch (err) {
          console.error("Export window error:", err);
          toast({
            title: "Export Error",
            description:
              "Failed to generate the export window. Please try again.",
            status: "error",
            duration: 3000,
            isClosable: true,
            position: "top-right",
          });
          resolve();
        }
      });
    }

    if (onProgress) {
      onProgress({
        current: reports.length,
        total: reports.length,
        fileName: "Complete",
      });
    }
  };

  if (status === "loading" || (loading && isInitialLoad)) {
    return (
      <Flex
        justifyContent="center"
        alignItems="center"
        minH="100vh"
        bg={bgPrimary}
      >
        <VStack spacing={4}>
          <Spinner size="xl" color={accentColor} thickness="4px" />
          <Text color={secondaryTextColor}>
            Loading enhanced requisition summary...
          </Text>
          <Progress
            size="xs"
            width="200px"
            isIndeterminate
            colorScheme="brand"
          />
        </VStack>
      </Flex>
    );
  }

  return (
    <Box p={{ base: 4, md: 6, lg: 8 }} bg={bgPrimary} minH="100vh">
      {/* Enhanced Sticky Header */}
      <Box
        bg={bgPrimary}
        pb={4}
        pt={2}
        mb={6}
        borderBottom="1px"
        borderColor={borderColor}
      >
        <VStack spacing={4} align="stretch">
          {/* Navigation and Title */}
          <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
            <HStack spacing={3}>
              <Button
                as={LinkNext}
                href="/operations/procurement"
                variant="ghost"
                size="sm"
                leftIcon={<Icon as={FiChevronLeft} />}
                color={secondaryTextColor}
                _hover={{ color: primaryTextColor, bg: hoverColor }}
              >
                Back to Procurement
              </Button>
              <Heading
                as="h1"
                size={{ base: "lg", md: "xl" }}
                color={primaryTextColor}
              >
                <HStack>
                  <Icon as={FiFileText} color={accentColor} />
                  <Text as="span">Enhanced Requisition Summary</Text>
                </HStack>
              </Heading>
            </HStack>

            <HStack spacing={2}>
              <Tooltip label="Refresh data" placement="top">
                <IconButton
                  aria-label="Refresh"
                  icon={<Icon as={FiRefreshCw} />}
                  size="sm"
                  variant="ghost"
                  onClick={handleRefresh}
                  isLoading={loading && !isInitialLoad}
                  color={secondaryTextColor}
                  _hover={{ color: accentColor }}
                />
              </Tooltip>

              <Button
                colorScheme="brand"
                leftIcon={<Icon as={FiPrinter} />}
                onClick={onExportModalOpen}
                isDisabled={!summary || summary.items.length === 0}
                size="sm"
              >
                {isMobile ? "Print" : "Generate Enhanced PDF"}
              </Button>
            </HStack>
          </Flex>

          {/* Enhanced Quick Stats */}
          {summary && filteredStats && (
            <>
              <SimpleGrid
                columns={{ base: 2, md: 4, lg: 4 }}
                spacing={3}
                overflowX="auto"
                py={2}
              >
                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Total Amount
                  </StatLabel>
                  <StatNumber as="div" fontSize="lg" color={accentColor}>
                    <HStack spacing={1}>
                      <CurrencyIcon boxSize={4} />
                      <Text as="span">
                        {filteredStats.totalAmount.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })}
                      </Text>
                    </HStack>
                  </StatNumber>
                  <StatHelpText fontSize="xs">
                    <StatArrow type="increase" />
                    {filteredStats.itemCount} items
                  </StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Items
                  </StatLabel>
                  <StatNumber fontSize="lg" color={successColor}>
                    {filteredStats.itemCount}
                  </StatNumber>
                  <StatHelpText fontSize="xs">
                    Across {filteredStats.uniqueSites} sites
                  </StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Suppliers
                  </StatLabel>
                  <StatNumber fontSize="lg" color={warningColor}>
                    {filteredStats.uniqueSuppliers}
                  </StatNumber>
                  <StatHelpText fontSize="xs">Active suppliers</StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Purchase Orders
                  </StatLabel>
                  <StatNumber fontSize="lg" color={infoColor}>
                    {filteredStats.uniquePOs}
                  </StatNumber>
                  <StatHelpText fontSize="xs">
                    {filteredStats.averagePerPO > 0 && (
                      <>
                        <CurrencyIcon boxSize={2} />
                        <Text as="span">
                          {filteredStats.averagePerPO.toFixed(0)} avg/PO
                        </Text>
                      </>
                    )}
                  </StatHelpText>
                </Stat>
              </SimpleGrid>
              <SimpleGrid
                columns={{ base: 2, md: 4, lg: 4 }}
                spacing={3}
                overflowX="auto"
                py={2}
              >
                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Categories
                  </StatLabel>
                  <StatNumber fontSize="lg" color="purple.500">
                    {filteredStats.uniqueCategories}
                  </StatNumber>
                  <StatHelpText fontSize="xs">Item categories</StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Avg/Item
                  </StatLabel>
                  <StatNumber as="div" fontSize="lg" color="cyan.500">
                    <HStack spacing={1}>
                      <CurrencyIcon boxSize={4} />
                      <Text as="span">
                        {filteredStats.averagePerItem.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })}
                      </Text>
                    </HStack>
                  </StatNumber>
                  <StatHelpText fontSize="xs">
                    Average cost per item
                  </StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Sites
                  </StatLabel>
                  <StatNumber fontSize="lg" color="teal.500">
                    {filteredStats.uniqueSites}
                  </StatNumber>
                  <StatHelpText fontSize="xs">Active locations</StatHelpText>
                </Stat>

                <Stat
                  bg={bgCard}
                  p={3}
                  borderRadius="md"
                  border="1px"
                  borderColor={borderColor}
                >
                  <StatLabel fontSize="xs" color={secondaryTextColor}>
                    Filtered
                  </StatLabel>
                  <StatNumber fontSize="lg" color={secondaryTextColor}>
                    {filteredStats && summary?.stats
                      ? (
                          (filteredStats.itemCount /
                            (summary.stats.totalItems || 1)) *
                          100
                        ).toFixed(0) + "%"
                      : "0%"}
                  </StatNumber>
                  <StatHelpText fontSize="xs">
                    of total items shown
                  </StatHelpText>
                </Stat>
              </SimpleGrid>
            </>
          )}
        </VStack>
      </Box>

      {/* Main Content */}
      <VStack spacing={6} align="stretch">
        {/* Enhanced Filters Section */}
        <Card bg={bgCard} border="1px" borderColor={borderColor} shadow="sm">
          <CardBody>
            <VStack spacing={4} align="stretch">
              <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
                <HStack>
                  <Icon as={FiFilter} color={accentColor} />
                  <Text fontWeight="semibold" color={primaryTextColor}>
                    Enhanced Filter Options
                  </Text>
                </HStack>

                <HStack spacing={2}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={onFilterModalOpen}
                    leftIcon={<Icon as={FiSettings} />}
                  >
                    Advanced
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={clearFilters}
                    isDisabled={
                      selectedSite === "all" &&
                      selectedSupplier === "all" &&
                      selectedCategory === "all" &&
                      !startDate &&
                      !endDate &&
                      !searchQuery
                    }
                  >
                    Clear All
                  </Button>
                </HStack>
              </Flex>

              {/* Main Filter Row */}
              <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
                {/* Search Input */}
                <FormControl>
                  <FormLabel fontSize="sm" color={secondaryTextColor}>
                    <HStack spacing={1}>
                      <Icon as={FiSearch} />
                      <Text as="span">Search Anything</Text>
                    </HStack>
                  </FormLabel>
                  <InputGroup size="sm">
                    <InputLeftElement pointerEvents="none">
                      <Icon as={FiSearch} color={secondaryTextColor} />
                    </InputLeftElement>
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Items, suppliers, POs, categories..."
                      borderColor={borderColor}
                      _focus={{ borderColor: accentColor }}
                    />
                  </InputGroup>
                </FormControl>

                {/* Site Filter */}
                <FormControl>
                  <FormLabel fontSize="sm" color={secondaryTextColor}>
                    <HStack spacing={1}>
                      <Icon as={FiHome} />
                      <Text as="span">Site</Text>
                    </HStack>
                  </FormLabel>
                  <Select
                    value={selectedSite}
                    onChange={(e) => setSelectedSite(e.target.value)}
                    size="sm"
                    borderColor={borderColor}
                    bg="white"
                    _dark={{ bg: "gray.700" }}
                    _focus={{ borderColor: accentColor }}
                  >
                    <option value="all">
                      All Sites ({summary?.sites?.length || 0})
                    </option>
                    {summary?.sites?.map((site) => (
                      <option key={site._id} value={site._id}>
                        {site.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>

                {/* Supplier Filter */}
                <FormControl>
                  <FormLabel fontSize="sm" color={secondaryTextColor}>
                    <HStack spacing={1}>
                      <Icon as={FiTruck} />
                      <Text as="span">Supplier</Text>
                    </HStack>
                  </FormLabel>
                  <Select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    size="sm"
                    borderColor={borderColor}
                    bg="white"
                    _dark={{ bg: "gray.700" }}
                    _focus={{ borderColor: accentColor }}
                  >
                    <option value="all">
                      All Suppliers ({summary?.suppliers?.length || 0})
                    </option>
                    {summary?.suppliers?.map((supplier) => (
                      <option key={supplier._id} value={supplier._id}>
                        {supplier.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>

                {/* Category Filter */}
                <FormControl>
                  <FormLabel fontSize="sm" color={secondaryTextColor}>
                    <HStack spacing={1}>
                      <Icon as={FiTag} />
                      <Text as="span">Category</Text>
                    </HStack>
                  </FormLabel>
                  <Select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    size="sm"
                    borderColor={borderColor}
                    bg="white"
                    _dark={{ bg: "gray.700" }}
                    _focus={{ borderColor: accentColor }}
                  >
                    <option value="all">
                      All Categories ({categories.length})
                    </option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat.title}>
                        {cat.title}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              </SimpleGrid>

              {/* Date Range Row */}
              <Flex wrap="wrap" gap={4} align="center">
                <FormControl maxW="300px">
                  <FormLabel fontSize="sm" color={secondaryTextColor}>
                    <HStack spacing={1}>
                      <Icon as={FiCalendar} />
                      <Text as="span">Date Range</Text>
                    </HStack>
                  </FormLabel>
                  <Button
                    onClick={onDateModalOpen}
                    variant="outline"
                    width="full"
                    justifyContent="flex-start"
                    size="sm"
                    bg="white"
                    _dark={{ bg: "gray.700" }}
                    borderColor={borderColor}
                    _hover={{ borderColor: accentColor, bg: hoverColor }}
                    leftIcon={<Icon as={FiCalendar} />}
                  >
                    {startDate && endDate
                      ? `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`
                      : "Select date range"}
                  </Button>
                </FormControl>

                {/* Active Filters Badges */}
                <Box flex="1">
                  <Text fontSize="xs" color={secondaryTextColor} mb={1}>
                    Active filters:
                  </Text>
                  <Wrap spacing={2}>
                    {selectedSite !== "all" && (
                      <WrapItem>
                        <Badge colorScheme="blue" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiHome} boxSize={2} />
                            <Text as="span">
                              Site:{" "}
                              {summary?.sites.find(
                                (s) => s._id === selectedSite,
                              )?.name || selectedSite}
                            </Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                    {selectedSupplier !== "all" && (
                      <WrapItem>
                        <Badge colorScheme="orange" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiTruck} boxSize={2} />
                            <Text as="span">
                              Supplier:{" "}
                              {summary?.suppliers.find(
                                (s) => s._id === selectedSupplier,
                              )?.name || selectedSupplier}
                            </Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                    {selectedCategory !== "all" && (
                      <WrapItem>
                        <Badge colorScheme="purple" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiTag} boxSize={2} />
                            <Text as="span">Category: {selectedCategory}</Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                    {startDate && (
                      <WrapItem>
                        <Badge colorScheme="green" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiCalendar} boxSize={2} />
                            <Text as="span">
                              From: {startDate.toLocaleDateString()}
                            </Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                    {endDate && (
                      <WrapItem>
                        <Badge colorScheme="green" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiCalendar} boxSize={2} />
                            <Text as="span">
                              To: {endDate.toLocaleDateString()}
                            </Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                    {searchQuery && (
                      <WrapItem>
                        <Badge colorScheme="gray" variant="subtle">
                          <HStack spacing={1}>
                            <Icon as={FiSearch} boxSize={2} />
                            <Text as="span">Search: "{searchQuery}"</Text>
                          </HStack>
                        </Badge>
                      </WrapItem>
                    )}
                  </Wrap>
                </Box>
              </Flex>
            </VStack>
          </CardBody>
        </Card>

        {/* Enhanced Data Display Tabs */}
        <Tabs
          variant="enclosed-colored"
          colorScheme="brand"
          index={activeTab}
          onChange={handleTabChange}
          isLazy
          lazyBehavior="keepMounted"
        >
          <Box
            position="relative"
            width="100%"
            overflowX="auto"
            overflowY="hidden"
            sx={{
              scrollbarWidth: "thin",
              scrollbarColor: `${scrollbarThumbColor} ${scrollbarTrackColor}`,
            }}
          >
            <TabList
              minWidth="max-content"
              display="flex"
              flexWrap="nowrap"
              gap={{ base: 1, sm: 2 }}
              pb={1}
            >
              {[
                {
                  icon: FiGrid,
                  label: "Summary",
                  fullLabel: "Executive Summary",
                },
                {
                  icon: FiBarChart2,
                  label: "Sites",
                  fullLabel: "By Site & Category",
                },
                {
                  icon: FiTruck,
                  label: "Suppliers",
                  fullLabel: "Supplier Analysis",
                },
                { icon: FiList, label: "Items", fullLabel: "Detailed Items" },
                { icon: FiPieChart, label: "Perf", fullLabel: "Performance" },
              ].map((tab, index) => (
                <Tab
                  key={index}
                  whiteSpace="nowrap"
                  flexShrink={0}
                  px={{ base: 2, sm: 3, md: 4 }}
                  py={{ base: 2, md: 3 }}
                  fontSize={{ base: "xs", sm: "sm", md: "md" }}
                >
                  <Icon
                    as={tab.icon}
                    mr={{ base: 1, sm: 2 }}
                    boxSize={{ base: 3, sm: 4 }}
                  />
                  <Text as="span" display={{ base: "none", sm: "inline" }}>
                    {tab.fullLabel}
                  </Text>
                  <Text as="span" display={{ base: "inline", sm: "none" }}>
                    {tab.label}
                  </Text>
                </Tab>
              ))}
            </TabList>
          </Box>

          <TabPanels>
            {/* Executive Summary Tab */}
            <TabPanel p={0} pt={4}>
              {loading ? (
                <VStack spacing={4} align="stretch">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height="100px" borderRadius="md" />
                  ))}
                </VStack>
              ) : summary ? (
                <VStack spacing={6} align="stretch">
                  {/* Overview Cards */}
                  <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={3}>
                          <Circle size="60px" bg="blue.50" color="blue.500">
                            <Icon as={FiDollarSign} boxSize={8} />
                          </Circle>
                          <Text
                            fontSize="sm"
                            color={secondaryTextColor}
                            textAlign="center"
                          >
                            Total Procurement Value
                          </Text>
                          <Heading size="xl" color={accentColor}>
                            <HStack spacing={1}>
                              <CurrencyIcon boxSize={6} />
                              <Text as="span">
                                {summary.stats.totalAmount.toLocaleString(
                                  "en-US",
                                  { minimumFractionDigits: 0 },
                                )}
                              </Text>
                            </HStack>
                          </Heading>
                          <Text fontSize="xs" color={secondaryTextColor}>
                            Across {summary.stats.totalPurchaseOrders} purchase
                            orders
                          </Text>
                        </VStack>
                      </CardBody>
                    </Card>

                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={3}>
                          <Circle size="60px" bg="green.50" color="green.500">
                            <Icon as={FiPackage} boxSize={8} />
                          </Circle>
                          <Text
                            fontSize="sm"
                            color={secondaryTextColor}
                            textAlign="center"
                          >
                            Total Items Ordered
                          </Text>
                          <Heading size="xl" color={successColor}>
                            {summary.stats.totalItems}
                          </Heading>
                          <Text fontSize="xs" color={secondaryTextColor}>
                            Average {summary.stats.averageItemsPerPO.toFixed(1)}{" "}
                            items per PO
                          </Text>
                        </VStack>
                      </CardBody>
                    </Card>

                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={3}>
                          <Circle size="60px" bg="orange.50" color="orange.500">
                            <Icon as={FiTruck} boxSize={8} />
                          </Circle>
                          <Text
                            fontSize="sm"
                            color={secondaryTextColor}
                            textAlign="center"
                          >
                            Active Suppliers
                          </Text>
                          <Heading size="xl" color={warningColor}>
                            {summary.stats.totalSuppliers}
                          </Heading>
                          <Text fontSize="xs" color={secondaryTextColor}>
                            Average{" "}
                            {summary.stats.averageSupplierPerSite.toFixed(1)}{" "}
                            suppliers per site
                          </Text>
                        </VStack>
                      </CardBody>
                    </Card>
                  </SimpleGrid>

                  {/* Site Performance */}
                  <Card bg={bgCard} border="1px" borderColor={borderColor}>
                    <CardBody>
                      <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                          <Heading size="md" color={primaryTextColor}>
                            <Icon as={FiHome} mr={2} />
                            <Text as="span">Site Performance</Text>
                          </Heading>
                          <Badge colorScheme="blue">
                            {summary.itemsBySite.length} Sites
                          </Badge>
                        </HStack>

                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                          {summary.itemsBySite.map((siteGroup) => (
                            <Card
                              key={siteGroup.site._id}
                              bg="white"
                              _dark={{ bg: "gray.800" }}
                              border="1px"
                              borderColor={borderColor}
                            >
                              <CardBody p={4}>
                                <VStack align="stretch" spacing={3}>
                                  <HStack justify="space-between">
                                    <Text
                                      fontWeight="bold"
                                      color={primaryTextColor}
                                    >
                                      {siteGroup.site.name}
                                    </Text>
                                    <Badge colorScheme="blue">
                                      <HStack spacing={1}>
                                        <CurrencyIcon boxSize={2} />
                                        <Text as="span">
                                          {siteGroup.totalAmount.toLocaleString(
                                            "en-US",
                                            { minimumFractionDigits: 0 },
                                          )}
                                        </Text>
                                      </HStack>
                                    </Badge>
                                  </HStack>

                                  <HStack justify="space-between">
                                    <Text
                                      fontSize="sm"
                                      color={secondaryTextColor}
                                    >
                                      Items
                                    </Text>
                                    <Text fontSize="sm" fontWeight="medium">
                                      {siteGroup.itemCount}
                                    </Text>
                                  </HStack>

                                  <HStack justify="space-between">
                                    <Text
                                      fontSize="sm"
                                      color={secondaryTextColor}
                                    >
                                      Suppliers
                                    </Text>
                                    <Text fontSize="sm" fontWeight="medium">
                                      {siteGroup.supplierCount}
                                    </Text>
                                  </HStack>

                                  <HStack justify="space-between">
                                    <Text
                                      fontSize="sm"
                                      color={secondaryTextColor}
                                    >
                                      Categories
                                    </Text>
                                    <Text fontSize="sm" fontWeight="medium">
                                      {siteGroup.itemsByCategory.length}
                                    </Text>
                                  </HStack>

                                  {siteGroup.site.address && (
                                    <HStack spacing={2}>
                                      <Icon
                                        as={FiMapPin}
                                        color={secondaryTextColor}
                                        boxSize={3}
                                      />
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                        isTruncated
                                      >
                                        {siteGroup.site.address}
                                      </Text>
                                    </HStack>
                                  )}
                                </VStack>
                              </CardBody>
                            </Card>
                          ))}
                        </SimpleGrid>
                      </VStack>
                    </CardBody>
                  </Card>

                  {/* Top Suppliers */}
                  <Card bg={bgCard} border="1px" borderColor={borderColor}>
                    <CardBody>
                      <VStack align="stretch" spacing={4}>
                        <HStack justify="space-between">
                          <Heading size="md" color={primaryTextColor}>
                            <Icon as={FiAward} mr={2} />
                            <Text as="span">Top Suppliers by Value</Text>
                          </Heading>
                          <Badge colorScheme="orange">Top 5</Badge>
                        </HStack>

                        <VStack spacing={3} align="stretch">
                          {summary.itemsBySupplier
                            .sort(
                              (a, b) =>
                                b.performance.totalAmount -
                                a.performance.totalAmount,
                            )
                            .slice(0, 5)
                            .map((supplierGroup) => (
                              <Card
                                key={supplierGroup.supplier._id}
                                bg="white"
                                _dark={{ bg: "gray.800" }}
                                border="1px"
                                borderColor={borderColor}
                              >
                                <CardBody p={3}>
                                  <HStack justify="space-between">
                                    <HStack spacing={3}>
                                      <Avatar
                                        size="sm"
                                        name={supplierGroup.supplier.name}
                                        bg={accentColor}
                                        color="white"
                                      />
                                      <VStack align="start" spacing={0}>
                                        <Text
                                          fontWeight="bold"
                                          color={primaryTextColor}
                                        >
                                          {supplierGroup.supplier.name}
                                        </Text>
                                        <Text
                                          fontSize="xs"
                                          color={secondaryTextColor}
                                        >
                                          {supplierGroup.supplier.code ||
                                            "No code"}
                                        </Text>
                                      </VStack>
                                    </HStack>

                                    <VStack align="end" spacing={0}>
                                      <Box
                                        fontWeight="bold"
                                        color={accentColor}
                                      >
                                        <HStack spacing={1}>
                                          <CurrencyIcon boxSize={3} />
                                          <Text as="span">
                                            {supplierGroup.performance.totalAmount.toLocaleString(
                                              "en-US",
                                              { minimumFractionDigits: 0 },
                                            )}
                                          </Text>
                                        </HStack>
                                      </Box>
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                      >
                                        {supplierGroup.performance.itemCount}{" "}
                                        items
                                      </Text>
                                    </VStack>
                                  </HStack>

                                  <HStack spacing={4} mt={2}>
                                    <HStack spacing={1}>
                                      <Icon
                                        as={FiHome}
                                        color={secondaryTextColor}
                                        boxSize={3}
                                      />
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                      >
                                        {supplierGroup.performance.siteCount}{" "}
                                        sites
                                      </Text>
                                    </HStack>
                                    <HStack spacing={1}>
                                      <Icon
                                        as={FiFileText}
                                        color={secondaryTextColor}
                                        boxSize={3}
                                      />
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                      >
                                        {
                                          supplierGroup.performance
                                            .purchaseOrderCount
                                        }{" "}
                                        POs
                                      </Text>
                                    </HStack>
                                    <HStack spacing={1}>
                                      <Icon
                                        as={FiDollarSign}
                                        color={secondaryTextColor}
                                        boxSize={3}
                                      />
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                      >
                                        <CurrencyIcon boxSize={2} />
                                        <Text as="span">
                                          {supplierGroup.performance.averageOrderValue.toFixed(
                                            0,
                                          )}{" "}
                                          avg
                                        </Text>
                                      </Text>
                                    </HStack>
                                  </HStack>
                                </CardBody>
                              </Card>
                            ))}
                        </VStack>
                      </VStack>
                    </CardBody>
                  </Card>
                </VStack>
              ) : (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={4} py={8} textAlign="center">
                      <Icon
                        as={FiFileText}
                        boxSize={12}
                        color={secondaryTextColor}
                        opacity={0.5}
                      />
                      <Text color={secondaryTextColor}>
                        No requisition data found for the selected filters
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                        leftIcon={<Icon as={FiFilter} />}
                      >
                        Clear filters
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </TabPanel>

            {/* By Site & Category Tab */}
            <TabPanel p={0} pt={4}>
              {loading ? (
                <VStack spacing={4} align="stretch">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height="100px" borderRadius="md" />
                  ))}
                </VStack>
              ) : summary?.itemsBySite && summary.itemsBySite.length > 0 ? (
                <VStack spacing={6} align="stretch">
                  {summary.itemsBySite.map((siteGroup) => (
                    <Card
                      key={siteGroup.site._id}
                      bg={bgCard}
                      border="1px"
                      borderColor={borderColor}
                      _hover={{
                        transform: "translateY(-2px)",
                        transition: "all 0.2s",
                      }}
                      transition="all 0.2s"
                    >
                      <CardBody>
                        <VStack align="stretch" spacing={4}>
                          {/* Site Header */}
                          <HStack
                            justify="space-between"
                            wrap="wrap"
                            spacing={4}
                          >
                            <VStack align="start" spacing={1}>
                              <Heading size="md" color={primaryTextColor}>
                                {siteGroup.site.name}
                              </Heading>
                              <HStack spacing={4}>
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  {siteGroup.itemCount} items
                                </Text>
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  {siteGroup.supplierCount} suppliers
                                </Text>
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  {siteGroup.itemsByCategory.length} categories
                                </Text>
                              </HStack>
                            </VStack>
                            <Badge
                              colorScheme="blue"
                              fontSize="md"
                              p={2}
                              borderRadius="md"
                            >
                              <HStack spacing={1}>
                                <CurrencyIcon boxSize={4} />
                                <Text as="span">
                                  {siteGroup.totalAmount.toLocaleString(
                                    "en-US",
                                    { minimumFractionDigits: 2 },
                                  )}
                                </Text>
                              </HStack>
                            </Badge>
                          </HStack>

                          {/* Site Contact Info */}
                          {(siteGroup.site.address ||
                            siteGroup.site.contactPerson ||
                            siteGroup.site.phoneNumber) && (
                            <HStack
                              spacing={4}
                              bg="gray.50"
                              _dark={{ bg: "gray.800" }}
                              p={3}
                              borderRadius="md"
                            >
                              {siteGroup.site.address && (
                                <HStack spacing={2}>
                                  <Icon
                                    as={FiMapPin}
                                    color={secondaryTextColor}
                                    boxSize={4}
                                  />
                                  <Text
                                    fontSize="sm"
                                    color={secondaryTextColor}
                                  >
                                    {siteGroup.site.address}
                                  </Text>
                                </HStack>
                              )}
                              {siteGroup.site.contactPerson && (
                                <HStack spacing={2}>
                                  <Icon
                                    as={FiUser}
                                    color={secondaryTextColor}
                                    boxSize={4}
                                  />
                                  <Text
                                    fontSize="sm"
                                    color={secondaryTextColor}
                                  >
                                    {siteGroup.site.contactPerson}
                                  </Text>
                                </HStack>
                              )}
                              {siteGroup.site.phoneNumber && (
                                <HStack spacing={2}>
                                  <Icon
                                    as={FiPhone}
                                    color={secondaryTextColor}
                                    boxSize={4}
                                  />
                                  <Text
                                    fontSize="sm"
                                    color={secondaryTextColor}
                                  >
                                    {siteGroup.site.phoneNumber}
                                  </Text>
                                </HStack>
                              )}
                            </HStack>
                          )}

                          {/* Categories for this Site */}
                          <Accordion allowMultiple>
                            {siteGroup.itemsByCategory.map((categoryGroup) => (
                              <AccordionItem
                                key={categoryGroup.category}
                                border="1px"
                                borderColor={borderColor}
                                borderRadius="md"
                                mb={3}
                              >
                                <AccordionButton
                                  py={3}
                                  _hover={{ bg: hoverColor }}
                                >
                                  <HStack flex="1" justify="space-between">
                                    <HStack>
                                      <AccordionIcon />
                                      <Text
                                        fontWeight="semibold"
                                        color={primaryTextColor}
                                      >
                                        {categoryGroup.category}
                                      </Text>
                                    </HStack>
                                    <HStack spacing={4}>
                                      <Badge colorScheme="purple">
                                        {categoryGroup.itemCount} items
                                      </Badge>
                                      <Badge colorScheme="blue">
                                        <HStack spacing={1}>
                                          <CurrencyIcon boxSize={2} />
                                          <Text as="span">
                                            {categoryGroup.totalAmount.toLocaleString(
                                              "en-US",
                                              { minimumFractionDigits: 2 },
                                            )}
                                          </Text>
                                        </HStack>
                                      </Badge>
                                    </HStack>
                                  </HStack>
                                </AccordionButton>
                                <AccordionPanel pb={4}>
                                  <VStack spacing={3} align="stretch">
                                    {/* Subcategories */}
                                    {categoryGroup.itemsBySubCategory.map(
                                      (subCategoryGroup) => (
                                        <VStack
                                          key={subCategoryGroup.subCategory}
                                          align="stretch"
                                          spacing={2}
                                        >
                                          <HStack
                                            justify="space-between"
                                            bg="gray.50"
                                            _dark={{ bg: "gray.800" }}
                                            p={2}
                                            borderRadius="md"
                                          >
                                            <Text
                                              fontWeight="medium"
                                              color={primaryTextColor}
                                            >
                                              {subCategoryGroup.subCategory}
                                            </Text>
                                            <HStack spacing={3}>
                                              <Text
                                                fontSize="sm"
                                                color={secondaryTextColor}
                                              >
                                                {subCategoryGroup.itemCount}{" "}
                                                items
                                              </Text>
                                              <Box
                                                fontSize="sm"
                                                fontWeight="medium"
                                                color={accentColor}
                                              >
                                                <HStack spacing={1}>
                                                  <CurrencyIcon boxSize={2} />
                                                  <Text as="span">
                                                    {subCategoryGroup.totalAmount.toLocaleString(
                                                      "en-US",
                                                      {
                                                        minimumFractionDigits: 2,
                                                      },
                                                    )}
                                                  </Text>
                                                </HStack>
                                              </Box>
                                            </HStack>
                                          </HStack>

                                          {/* Items in this subcategory */}
                                          <TableContainer>
                                            <Table
                                              variant="simple"
                                              size={tableSize}
                                            >
                                              <Thead>
                                                <Tr>
                                                  <Th>Item</Th>
                                                  <Th>Supplier</Th>
                                                  <Th isNumeric>Qty</Th>
                                                  <Th isNumeric>Amount</Th>
                                                </Tr>
                                              </Thead>
                                              <Tbody>
                                                {subCategoryGroup.items
                                                  .slice(0, isMobile ? 3 : 5)
                                                  .map((item, index) => (
                                                    <Tr
                                                      key={index}
                                                      _hover={{
                                                        bg: hoverColor,
                                                      }}
                                                      transition="background 0.2s"
                                                    >
                                                      <Td>
                                                        <Box>
                                                          <Text
                                                            fontWeight="medium"
                                                            mb={
                                                              item.itemSku
                                                                ? 1
                                                                : 0
                                                            }
                                                          >
                                                            {item.itemName}
                                                          </Text>
                                                          {item.itemSku && (
                                                            <Text
                                                              as="span"
                                                              fontSize="xs"
                                                              color={
                                                                secondaryTextColor
                                                              }
                                                              display="block"
                                                            >
                                                              SKU:{" "}
                                                              {item.itemSku}
                                                            </Text>
                                                          )}
                                                          <Text
                                                            as="span"
                                                            fontSize="xs"
                                                            color={
                                                              secondaryTextColor
                                                            }
                                                            display="block"
                                                          >
                                                            PO: {item.poNumber}
                                                          </Text>
                                                        </Box>
                                                      </Td>
                                                      <Td>
                                                        <Box>
                                                          <Text
                                                            fontWeight="medium"
                                                            mb={
                                                              item.supplierContact ||
                                                              item.supplierPhone
                                                                ? 1
                                                                : 0
                                                            }
                                                          >
                                                            {item.supplierName}
                                                          </Text>
                                                          {item.supplierContact &&
                                                            item.supplierContact !==
                                                              "N/A" && (
                                                              <Text
                                                                as="span"
                                                                fontSize="xs"
                                                                color={
                                                                  secondaryTextColor
                                                                }
                                                                display="block"
                                                              >
                                                                {
                                                                  item.supplierContact
                                                                }
                                                              </Text>
                                                            )}
                                                          {item.supplierPhone &&
                                                            item.supplierPhone !==
                                                              "N/A" && (
                                                              <Text
                                                                as="span"
                                                                fontSize="xs"
                                                                color={
                                                                  secondaryTextColor
                                                                }
                                                                display="block"
                                                              >
                                                                {
                                                                  item.supplierPhone
                                                                }
                                                              </Text>
                                                            )}
                                                        </Box>
                                                      </Td>
                                                      <Td isNumeric>
                                                        <Text>
                                                          {item.quantity}{" "}
                                                          {item.unitOfMeasure}
                                                        </Text>
                                                      </Td>
                                                      <Td isNumeric>
                                                        <HStack
                                                          justify="flex-end"
                                                          spacing={1}
                                                        >
                                                          <CurrencyIcon
                                                            boxSize={3}
                                                          />
                                                          <Text fontWeight="medium">
                                                            {item.amount.toFixed(
                                                              2,
                                                            )}
                                                          </Text>
                                                        </HStack>
                                                      </Td>
                                                    </Tr>
                                                  ))}
                                              </Tbody>
                                            </Table>
                                          </TableContainer>
                                        </VStack>
                                      ),
                                    )}
                                  </VStack>
                                </AccordionPanel>
                              </AccordionItem>
                            ))}
                          </Accordion>
                        </VStack>
                      </CardBody>
                    </Card>
                  ))}
                </VStack>
              ) : (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={4} py={8} textAlign="center">
                      <Icon
                        as={FiHome}
                        boxSize={12}
                        color={secondaryTextColor}
                        opacity={0.5}
                      />
                      <Text color={secondaryTextColor}>
                        No site data found for the selected filters
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                        leftIcon={<Icon as={FiFilter} />}
                      >
                        Clear filters
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </TabPanel>

            {/* Supplier Analysis Tab */}
            <TabPanel p={0} pt={4}>
              {loading ? (
                <VStack spacing={4} align="stretch">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height="100px" borderRadius="md" />
                  ))}
                </VStack>
              ) : summary?.itemsBySupplier &&
                summary.itemsBySupplier.length > 0 ? (
                <VStack spacing={6} align="stretch">
                  {/* Supplier Performance Grid */}
                  <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                    {summary.itemsBySupplier.map((supplierGroup) => (
                      <Card
                        key={supplierGroup.supplier._id}
                        bg={bgCard}
                        border="1px"
                        borderColor={borderColor}
                        _hover={{
                          transform: "translateY(-2px)",
                          transition: "all 0.2s",
                        }}
                        transition="all 0.2s"
                      >
                        <CardBody>
                          <VStack align="stretch" spacing={3}>
                            {/* Supplier Header */}
                            <HStack justify="space-between">
                              <HStack spacing={3}>
                                <Avatar
                                  size="md"
                                  name={supplierGroup.supplier.name}
                                  bg={accentColor}
                                  color="white"
                                />
                                <VStack align="start" spacing={0}>
                                  <Text
                                    fontWeight="bold"
                                    color={primaryTextColor}
                                  >
                                    {supplierGroup.supplier.name}
                                  </Text>
                                  <Text
                                    fontSize="xs"
                                    color={secondaryTextColor}
                                  >
                                    {supplierGroup.supplier.code || "No code"}
                                  </Text>
                                </VStack>
                              </HStack>
                              <Badge colorScheme="orange" fontSize="sm">
                                <HStack spacing={1}>
                                  <CurrencyIcon boxSize={2} />
                                  <Text as="span">
                                    {supplierGroup.performance.totalAmount.toLocaleString(
                                      "en-US",
                                      { minimumFractionDigits: 0 },
                                    )}
                                  </Text>
                                </HStack>
                              </Badge>
                            </HStack>

                            {/* Performance Metrics */}
                            <SimpleGrid columns={2} spacing={2} mt={2}>
                              <VStack align="center" spacing={1}>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  Items
                                </Text>
                                <Text fontWeight="bold" fontSize="sm">
                                  {supplierGroup.performance.itemCount}
                                </Text>
                              </VStack>
                              <VStack align="center" spacing={1}>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  POs
                                </Text>
                                <Text fontWeight="bold" fontSize="sm">
                                  {supplierGroup.performance.purchaseOrderCount}
                                </Text>
                              </VStack>
                              <VStack align="center" spacing={1}>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  Sites
                                </Text>
                                <Text fontWeight="bold" fontSize="sm">
                                  {supplierGroup.performance.siteCount}
                                </Text>
                              </VStack>
                              <VStack align="center" spacing={1}>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  Avg/Item
                                </Text>
                                <Box fontWeight="bold" fontSize="sm">
                                  <HStack spacing={0}>
                                    <CurrencyIcon boxSize={2} />
                                    <Text as="span">
                                      {supplierGroup.performance.averageOrderValue.toFixed(
                                        0,
                                      )}
                                    </Text>
                                  </HStack>
                                </Box>
                              </VStack>
                            </SimpleGrid>

                            {/* Sites Served */}
                            <Box>
                              <Text
                                fontSize="xs"
                                color={secondaryTextColor}
                                mb={1}
                              >
                                Sites Served:
                              </Text>
                              <AvatarGroup size="xs" max={3}>
                                {supplierGroup.performance.sites
                                  .slice(0, 3)
                                  .map((site) => (
                                    <Avatar
                                      key={site._id}
                                      name={site.name}
                                      src={undefined}
                                      bg="blue.100"
                                      color="blue.600"
                                    />
                                  ))}
                              </AvatarGroup>
                              {supplierGroup.performance.siteCount > 3 && (
                                <Text
                                  fontSize="xs"
                                  color={secondaryTextColor}
                                  mt={1}
                                >
                                  +{supplierGroup.performance.siteCount - 3}{" "}
                                  more
                                </Text>
                              )}
                            </Box>

                            {/* View Details Button */}
                            <Button
                              size="xs"
                              variant="outline"
                              colorScheme="orange"
                              mt={2}
                              rightIcon={<Icon as={FiChevronRight} />}
                              onClick={() => {
                                setSelectedSupplier(supplierGroup.supplier._id);
                                setActiveTab(3); // Switch to detailed items tab
                              }}
                            >
                              View Supplier Items
                            </Button>
                          </VStack>
                        </CardBody>
                      </Card>
                    ))}
                  </SimpleGrid>

                  {/* Supplier Performance Table */}
                  <Card bg={bgCard} border="1px" borderColor={borderColor}>
                    <CardBody>
                      <VStack align="stretch" spacing={4}>
                        <Heading size="md" color={primaryTextColor}>
                          <Icon as={FiBarChart} mr={2} />
                          <Text as="span">Supplier Performance Comparison</Text>
                        </Heading>

                        <TableContainer>
                          <Table variant="simple" size={tableSize}>
                            <Thead>
                              <Tr>
                                <Th>Supplier</Th>
                                <Th isNumeric>Total Amount</Th>
                                <Th isNumeric>Items</Th>
                                <Th isNumeric>POs</Th>
                                <Th isNumeric>Sites</Th>
                                <Th isNumeric>Avg/Item</Th>
                                <Th isNumeric>Share %</Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {summary.itemsBySupplier
                                .sort(
                                  (a, b) =>
                                    b.performance.totalAmount -
                                    a.performance.totalAmount,
                                )
                                .map((supplierGroup) => {
                                  const sharePercent =
                                    (supplierGroup.performance.totalAmount /
                                      summary.stats.totalAmount) *
                                    100;

                                  return (
                                    <Tr
                                      key={supplierGroup.supplier._id}
                                      _hover={{ bg: hoverColor }}
                                      transition="background 0.2s"
                                      onClick={() => {
                                        setSelectedSupplier(
                                          supplierGroup.supplier._id,
                                        );
                                        setActiveTab(3);
                                      }}
                                      cursor="pointer"
                                    >
                                      <Td>
                                        <HStack spacing={2}>
                                          <Avatar
                                            size="xs"
                                            name={supplierGroup.supplier.name}
                                          />
                                          <Text fontWeight="medium">
                                            {supplierGroup.supplier.name}
                                          </Text>
                                        </HStack>
                                      </Td>
                                      <Td isNumeric>
                                        <HStack justify="flex-end" spacing={1}>
                                          <CurrencyIcon boxSize={3} />
                                          <Text fontWeight="medium">
                                            {supplierGroup.performance.totalAmount.toLocaleString(
                                              "en-US",
                                              { minimumFractionDigits: 2 },
                                            )}
                                          </Text>
                                        </HStack>
                                      </Td>
                                      <Td isNumeric>
                                        {supplierGroup.performance.itemCount}
                                      </Td>
                                      <Td isNumeric>
                                        {
                                          supplierGroup.performance
                                            .purchaseOrderCount
                                        }
                                      </Td>
                                      <Td isNumeric>
                                        {supplierGroup.performance.siteCount}
                                      </Td>
                                      <Td isNumeric>
                                        <HStack justify="flex-end" spacing={1}>
                                          <CurrencyIcon boxSize={2} />
                                          <Text as="span">
                                            {supplierGroup.performance.averageOrderValue.toFixed(
                                              0,
                                            )}
                                          </Text>
                                        </HStack>
                                      </Td>
                                      <Td isNumeric>
                                        <Progress
                                          value={sharePercent}
                                          colorScheme={
                                            sharePercent > 20
                                              ? "green"
                                              : sharePercent > 10
                                                ? "orange"
                                                : "blue"
                                          }
                                          size="sm"
                                          borderRadius="full"
                                        />
                                        <Text
                                          fontSize="xs"
                                          textAlign="center"
                                          mt={1}
                                        >
                                          {sharePercent.toFixed(1)}%
                                        </Text>
                                      </Td>
                                    </Tr>
                                  );
                                })}
                            </Tbody>
                          </Table>
                        </TableContainer>
                      </VStack>
                    </CardBody>
                  </Card>
                </VStack>
              ) : (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={4} py={8} textAlign="center">
                      <Icon
                        as={FiTruck}
                        boxSize={12}
                        color={secondaryTextColor}
                        opacity={0.5}
                      />
                      <Text color={secondaryTextColor}>
                        No supplier data found for the selected filters
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                        leftIcon={<Icon as={FiFilter} />}
                      >
                        Clear filters
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </TabPanel>

            {/* Detailed Items Tab */}
            <TabPanel p={0} pt={4}>
              {loading ? (
                <VStack spacing={2} align="stretch">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} height="60px" borderRadius="md" />
                  ))}
                </VStack>
              ) : filteredItems.length > 0 ? (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody p={0}>
                    <TableContainer maxH="600px" overflowY="auto">
                      <Table variant="simple" size={tableSize}>
                        <Thead position="sticky" top={0} bg={bgCard} zIndex={1}>
                          <Tr>
                            <Th>PO #</Th>
                            <Th>Site</Th>
                            <Th>Category</Th>
                            <Th>Supplier</Th>
                            <Th>Item</Th>
                            <Th>Supplier Code</Th>
                            <Th isNumeric>Qty</Th>
                            <Th isNumeric>Amount</Th>
                            <Th>Date</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {filteredItems.map((item, index) => (
                            <Tr
                              key={`${item.poNumber}-${index}`}
                              _hover={{ bg: hoverColor }}
                              transition="background 0.2s"
                            >
                              <Td>
                                <Box>
                                  <Text fontWeight="medium" mb={1}>
                                    {item.poNumber}
                                  </Text>
                                  <Text
                                    as="span"
                                    fontSize="xs"
                                    color={secondaryTextColor}
                                    display="block"
                                  >
                                    Status: {item.poStatus || "Approved"}
                                  </Text>
                                </Box>
                              </Td>
                              <Td>
                                <Box>
                                  <Text mb={item.siteAddress ? 1 : 0}>
                                    {item.siteName}
                                  </Text>
                                  {item.siteAddress &&
                                    item.siteAddress !== "N/A" && (
                                      <Text
                                        as="span"
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                        display="block"
                                        isTruncated
                                        maxW="150px"
                                      >
                                        {item.siteAddress}
                                      </Text>
                                    )}
                                </Box>
                              </Td>
                              <Td>
                                <Badge colorScheme="purple" variant="subtle">
                                  {item.category}
                                </Badge>
                              </Td>
                              <Td>
                                <Popover>
                                  <PopoverTrigger>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      p={0}
                                      height="auto"
                                    >
                                      <Text textAlign="left">
                                        {item.supplierName}
                                      </Text>
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent>
                                    <PopoverArrow />
                                    <PopoverCloseButton />
                                    <PopoverHeader>
                                      Supplier Details
                                    </PopoverHeader>
                                    <PopoverBody>
                                      <VStack align="start" spacing={2}>
                                        <Text>
                                          <strong>Name:</strong>{" "}
                                          {item.supplierName}
                                        </Text>
                                        <Text>
                                          <strong>Code:</strong>{" "}
                                          {item.supplierCode || "N/A"}
                                        </Text>
                                      </VStack>
                                    </PopoverBody>
                                  </PopoverContent>
                                </Popover>
                              </Td>
                              <Td>
                                <Box>
                                  <Text mb={item.itemSku ? 1 : 0}>
                                    {item.itemName}
                                  </Text>
                                  {item.itemSku && (
                                    <Text
                                      as="span"
                                      fontSize="xs"
                                      color={secondaryTextColor}
                                      display="block"
                                    >
                                      SKU: {item.itemSku}
                                    </Text>
                                  )}
                                  <Text
                                    as="span"
                                    fontSize="xs"
                                    color={secondaryTextColor}
                                    display="block"
                                  >
                                    {item.unitOfMeasure}
                                  </Text>
                                </Box>
                              </Td>
                              <Td>
                                <Box>
                                  <Text fontSize="sm" fontWeight="medium">
                                    {item.supplierCode || "N/A"}
                                  </Text>
                                </Box>
                              </Td>
                              <Td isNumeric>
                                <Text>{item.quantity}</Text>
                                <Text
                                  as="span"
                                  fontSize="xs"
                                  color={secondaryTextColor}
                                  display="block"
                                >
                                  <CurrencyIcon boxSize={2} />
                                  {resolveUnitPrice(
                                    item.unitPrice,
                                    undefined,
                                    item.amount / item.quantity,
                                  ).toFixed(2)}{" "}
                                  each
                                </Text>
                              </Td>
                              <Td isNumeric>
                                <HStack justify="flex-end" spacing={1}>
                                  <CurrencyIcon boxSize={3} />
                                  <Text fontWeight="medium">
                                    {item.amount.toFixed(2)}
                                  </Text>
                                </HStack>
                              </Td>
                              <Td>
                                <Text fontSize="sm">
                                  {new Date(item.orderDate).toLocaleDateString(
                                    "en-GB",
                                  )}
                                </Text>
                                <Text
                                  as="span"
                                  fontSize="xs"
                                  color={secondaryTextColor}
                                  display="block"
                                >
                                  {item.orderedBy || "Unknown"}
                                </Text>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </TableContainer>

                    <Flex
                      justify="space-between"
                      align="center"
                      p={4}
                      borderTop="1px"
                      borderColor={borderColor}
                    >
                      <Text fontSize="sm" color={secondaryTextColor}>
                        Showing {filteredItems.length} items
                      </Text>
                      <Box fontSize="sm" color={secondaryTextColor}>
                        <HStack
                          spacing={1}
                          fontSize="sm"
                          color={secondaryTextColor}
                        >
                          <CurrencyIcon boxSize={3} />
                          <Text as="span" fontWeight="medium">
                            {filteredStats?.totalAmount.toLocaleString(
                              "en-US",
                              { minimumFractionDigits: 2 },
                            )}
                          </Text>
                          <Text as="span">total</Text>
                        </HStack>
                      </Box>
                    </Flex>
                  </CardBody>
                </Card>
              ) : (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={4} py={8} textAlign="center">
                      <Icon
                        as={FiList}
                        boxSize={12}
                        color={secondaryTextColor}
                        opacity={0.5}
                      />
                      <Text color={secondaryTextColor}>
                        No detailed data found for the selected filters
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                        leftIcon={<Icon as={FiFilter} />}
                      >
                        Clear filters
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </TabPanel>

            {/* Performance Tab */}
            <TabPanel p={0} pt={4}>
              {loading ? (
                <VStack spacing={4} align="stretch">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height="100px" borderRadius="md" />
                  ))}
                </VStack>
              ) : summary ? (
                <VStack spacing={6} align="stretch">
                  {/* Performance Metrics Grid */}
                  <SimpleGrid columns={{ base: 1, md: 2, lg: 4 }} spacing={4}>
                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={2}>
                          <Circle size="50px" bg="green.50" color="green.500">
                            <Icon as={FiTrendingUp} boxSize={6} />
                          </Circle>
                          <Text fontSize="sm" color={secondaryTextColor}>
                            Avg Order Value
                          </Text>
                          <Heading size="md" color={accentColor}>
                            <HStack spacing={1}>
                              <CurrencyIcon boxSize={4} />
                              <Text as="span">
                                {summary.stats.averageOrderValue.toLocaleString(
                                  "en-US",
                                  { minimumFractionDigits: 0 },
                                )}
                              </Text>
                            </HStack>
                          </Heading>
                        </VStack>
                      </CardBody>
                    </Card>

                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={2}>
                          <Circle size="50px" bg="blue.50" color="blue.500">
                            <Icon as={FiPackage} boxSize={6} />
                          </Circle>
                          <Text fontSize="sm" color={secondaryTextColor}>
                            Items per PO
                          </Text>
                          <Heading size="md" color={infoColor}>
                            {summary.stats.averageItemsPerPO.toFixed(1)}
                          </Heading>
                        </VStack>
                      </CardBody>
                    </Card>

                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={2}>
                          <Circle size="50px" bg="orange.50" color="orange.500">
                            <Icon as={FiUsers} boxSize={6} />
                          </Circle>
                          <Text fontSize="sm" color={secondaryTextColor}>
                            Suppliers per Site
                          </Text>
                          <Heading size="md" color={warningColor}>
                            {summary.stats.averageSupplierPerSite.toFixed(1)}
                          </Heading>
                        </VStack>
                      </CardBody>
                    </Card>

                    <Card bg={bgCard} border="1px" borderColor={borderColor}>
                      <CardBody>
                        <VStack align="center" spacing={2}>
                          <Circle size="50px" bg="purple.50" color="purple.500">
                            <Icon as={FiPieChart} boxSize={6} />
                          </Circle>
                          <Text fontSize="sm" color={secondaryTextColor}>
                            Category Diversity
                          </Text>
                          <Heading size="md" color="purple.500">
                            {summary.stats.totalCategories}
                          </Heading>
                        </VStack>
                      </CardBody>
                    </Card>
                  </SimpleGrid>

                  {/* Category Distribution */}
                  <Card bg={bgCard} border="1px" borderColor={borderColor}>
                    <CardBody>
                      <VStack align="stretch" spacing={4}>
                        <Heading size="md" color={primaryTextColor}>
                          <Icon as={FiPieChart} mr={2} />
                          <Text as="span">Category Distribution</Text>
                        </Heading>

                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                          {summary.itemsByCategory.map((categoryGroup) => {
                            const sharePercent =
                              (categoryGroup.totalAmount /
                                summary.stats.totalAmount) *
                              100;

                            return (
                              <Card
                                key={categoryGroup.category}
                                bg="white"
                                _dark={{ bg: "gray.800" }}
                                border="1px"
                                borderColor={borderColor}
                              >
                                <CardBody p={4}>
                                  <VStack align="stretch" spacing={2}>
                                    <HStack justify="space-between">
                                      <Text
                                        fontWeight="bold"
                                        color={primaryTextColor}
                                      >
                                        {categoryGroup.category}
                                      </Text>
                                      <Badge colorScheme="blue">
                                        {sharePercent.toFixed(1)}%
                                      </Badge>
                                    </HStack>

                                    <Progress
                                      value={sharePercent}
                                      colorScheme="blue"
                                      size="sm"
                                      borderRadius="full"
                                    />

                                    <HStack justify="space-between">
                                      <Text
                                        fontSize="sm"
                                        color={secondaryTextColor}
                                      >
                                        {categoryGroup.itemCount} items
                                      </Text>
                                      <Box
                                        fontSize="sm"
                                        fontWeight="medium"
                                        color={accentColor}
                                      >
                                        <HStack spacing={1}>
                                          <CurrencyIcon boxSize={2} />
                                          <Text as="span">
                                            {categoryGroup.totalAmount.toLocaleString(
                                              "en-US",
                                              { minimumFractionDigits: 0 },
                                            )}
                                          </Text>
                                        </HStack>
                                      </Box>
                                    </HStack>

                                    <HStack spacing={2}>
                                      <Icon
                                        as={FiHome}
                                        color={secondaryTextColor}
                                        boxSize={3}
                                      />
                                      <Text
                                        fontSize="xs"
                                        color={secondaryTextColor}
                                      >
                                        Served{" "}
                                        {categoryGroup.itemsBySite.length} sites
                                      </Text>
                                    </HStack>
                                  </VStack>
                                </CardBody>
                              </Card>
                            );
                          })}
                        </SimpleGrid>
                      </VStack>
                    </CardBody>
                  </Card>

                  {/* Time Analysis */}
                  <Card bg={bgCard} border="1px" borderColor={borderColor}>
                    <CardBody>
                      <VStack align="stretch" spacing={4}>
                        <Heading size="md" color={primaryTextColor}>
                          <Icon as={FiCalendar} mr={2} />
                          <Text as="span">Time Analysis</Text>
                        </Heading>

                        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
                          <Card
                            bg="white"
                            _dark={{ bg: "gray.800" }}
                            border="1px"
                            borderColor={borderColor}
                          >
                            <CardBody>
                              <VStack align="center" spacing={2}>
                                <Icon
                                  as={FiClock}
                                  color={accentColor}
                                  boxSize={6}
                                />
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  Report Period
                                </Text>
                                <Text fontWeight="bold" textAlign="center">
                                  {dateFilterText()}
                                </Text>
                              </VStack>
                            </CardBody>
                          </Card>

                          <Card
                            bg="white"
                            _dark={{ bg: "gray.800" }}
                            border="1px"
                            borderColor={borderColor}
                          >
                            <CardBody>
                              <VStack align="center" spacing={2}>
                                <Icon
                                  as={FiCalendarIcon}
                                  color={successColor}
                                  boxSize={6}
                                />
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  Generated
                                </Text>
                                <Text fontWeight="bold" textAlign="center">
                                  {new Date(
                                    summary.generatedAt,
                                  ).toLocaleDateString("en-GB")}
                                </Text>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  {new Date(
                                    summary.generatedAt,
                                  ).toLocaleTimeString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </Text>
                              </VStack>
                            </CardBody>
                          </Card>

                          <Card
                            bg="white"
                            _dark={{ bg: "gray.800" }}
                            border="1px"
                            borderColor={borderColor}
                          >
                            <CardBody>
                              <VStack align="center" spacing={2}>
                                <Icon
                                  as={FiDatabase}
                                  color={infoColor}
                                  boxSize={6}
                                />
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  Data Freshness
                                </Text>
                                <Text fontWeight="bold" textAlign="center">
                                  Real-time
                                </Text>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  Last updated: Just now
                                </Text>
                              </VStack>
                            </CardBody>
                          </Card>
                        </SimpleGrid>
                      </VStack>
                    </CardBody>
                  </Card>
                </VStack>
              ) : (
                <Card bg={bgCard} border="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={4} py={8} textAlign="center">
                      <Icon
                        as={FiBarChart}
                        boxSize={12}
                        color={secondaryTextColor}
                        opacity={0.5}
                      />
                      <Text color={secondaryTextColor}>
                        No performance data available
                      </Text>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </VStack>

      {/* Enhanced Export Modal */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={onExportModalClose}
        size="lg"
        isCentered
      >
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent bg={bgCard} border="1px" borderColor={borderColor}>
          <ModalHeader color={primaryTextColor}>
            <HStack spacing={2}>
              <Icon as={FiPrinter} />
              <Text as="span">Generate Enhanced Requisition Document</Text>
            </HStack>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Alert status="info" borderRadius="md" variant="subtle">
                <AlertIcon />
                <Box>
                  <AlertTitle>Enhanced Finance Submission</AlertTitle>
                  <AlertDescription>
                    Generate a comprehensive requisition document with ALL
                    available information including supplier details, contact
                    information, and performance analysis.
                  </AlertDescription>
                </Box>
              </Alert>

              {summary && summary.stats && filteredStats && (
                <Card
                  bg="white"
                  _dark={{ bg: "gray.800" }}
                  border="1px"
                  borderColor={borderColor}
                >
                  <CardBody>
                    <VStack spacing={3} align="stretch">
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Document Type:</Text>
                        <Badge colorScheme="blue" fontSize="sm">
                          Enhanced PDF
                        </Badge>
                      </HStack>
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Total Items:</Text>
                        <Text fontWeight="medium">
                          {filteredStats.itemCount}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Total Amount:</Text>
                        <HStack spacing={1}>
                          <CurrencyIcon boxSize={4} />
                          <Text fontWeight="medium" color={accentColor}>
                            {filteredStats.totalAmount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}
                          </Text>
                        </HStack>
                      </HStack>
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Sites Included:</Text>
                        <Text fontWeight="medium">
                          {filteredStats.uniqueSites}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Suppliers:</Text>
                        <Text fontWeight="medium">
                          {filteredStats.uniqueSuppliers}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <Text color={secondaryTextColor}>Purchase Orders:</Text>
                        <Text fontWeight="medium">
                          {filteredStats.uniquePOs}
                        </Text>
                      </HStack>
                      <Divider />
                      <Text fontSize="sm" color={secondaryTextColor}>
                        <strong>Included in Enhanced Report:</strong>
                      </Text>
                      <SimpleGrid columns={2} spacing={2}>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Supplier Information</Text>
                        </HStack>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Site Addresses</Text>
                        </HStack>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Performance Analysis</Text>
                        </HStack>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Category Breakdown</Text>
                        </HStack>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Executive Summary</Text>
                        </HStack>
                        <HStack spacing={2}>
                          <Icon
                            as={FiCheckCircle}
                            color="green.500"
                            boxSize={3}
                          />
                          <Text fontSize="xs">Supplier Performance</Text>
                        </HStack>
                      </SimpleGrid>
                    </VStack>
                  </CardBody>
                </Card>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={3} width="full">
              <Button variant="ghost" onClick={onExportModalClose} flex={1}>
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                onClick={exportToPDF}
                isLoading={exporting}
                leftIcon={<Icon as={FiDownload} />}
                flex={1}
              >
                {exporting
                  ? "Generating Enhanced PDF..."
                  : "Generate Enhanced PDF"}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Inline Date Range Modal */}
      <Modal
        isOpen={isDateModalOpen}
        onClose={onDateModalClose}
        size="sm"
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack>
              <Icon as={FiCalendar} />
              <Text as="span">Select Date Range</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack spacing={4}>
              <DatePicker
                selectsRange={true}
                startDate={dateRange[0]}
                endDate={dateRange[1]}
                onChange={(
                  update: SetStateAction<[Date | null, Date | null]>,
                ) => setDateRange(update)}
                isClearable={false}
                inline
                monthsShown={1}
                dateFormat="dd/MM/yyyy"
                className="date-picker-modal"
              />

              <HStack spacing={3} width="full" justify="flex-end" pt={4}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateRange([null, null]);
                    onDateModalClose();
                  }}
                >
                  Clear Dates
                </Button>
                <Button
                  colorScheme="brand"
                  size="sm"
                  onClick={() => {
                    onDateModalClose();
                  }}
                  isDisabled={!dateRange[0] || !dateRange[1]}
                >
                  Apply Dates
                </Button>
              </HStack>

              {dateRange[0] && dateRange[1] && (
                <Text fontSize="sm" color="gray.500" textAlign="center">
                  Selected: {dateRange[0].toLocaleDateString()} -{" "}
                  {dateRange[1].toLocaleDateString()}
                </Text>
              )}
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Advanced Filter Modal */}
      <Modal isOpen={isFilterModalOpen} onClose={onFilterModalClose} size="md">
        <ModalOverlay />
        <ModalContent bg={bgCard} border="1px" borderColor={borderColor}>
          <ModalHeader color={primaryTextColor}>
            <HStack>
              <Icon as={FiSettings} />
              <Text as="span">Advanced Filters</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel fontSize="sm" color={secondaryTextColor}>
                  Minimum Amount
                </FormLabel>
                <InputGroup size="sm">
                  <InputLeftElement pointerEvents="none">
                    <CurrencyIcon />
                  </InputLeftElement>
                  <Input
                    placeholder="Minimum amount"
                    borderColor={borderColor}
                    _focus={{ borderColor: accentColor }}
                  />
                </InputGroup>
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm" color={secondaryTextColor}>
                  Minimum Quantity
                </FormLabel>
                <Input
                  type="number"
                  placeholder="Minimum quantity"
                  size="sm"
                  borderColor={borderColor}
                  _focus={{ borderColor: accentColor }}
                />
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm" color={secondaryTextColor}>
                  Order Status
                </FormLabel>
                <Select
                  size="sm"
                  borderColor={borderColor}
                  bg="white"
                  _dark={{ bg: "gray.700" }}
                  _focus={{ borderColor: accentColor }}
                >
                  <option value="all">All Statuses</option>
                  <option value="approved">Approved</option>
                  <option value="processed">Processed</option>
                  <option value="draft">Draft</option>
                </Select>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={3} width="full">
              <Button variant="ghost" size="sm" onClick={onFilterModalClose}>
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                size="sm"
                onClick={() => {
                  // Apply advanced filters
                  onFilterModalClose();
                  toast({
                    title: "Filters Applied",
                    status: "success",
                    duration: 2000,
                    isClosable: true,
                  });
                }}
              >
                Apply Filters
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

// Date Range Modal Component
interface DateRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateRange: [Date | null, Date | null];
  onDateRangeChange: (range: [Date | null, Date | null]) => void;
}
