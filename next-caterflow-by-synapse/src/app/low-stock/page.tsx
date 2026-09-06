// src/app/low-stock/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Box,
  Heading,
  Text,
  Flex,
  Spinner,
  Button,
  useToast,
  useDisclosure,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  useColorModeValue,
  Checkbox,
  Badge,
  Card,
  CardBody,
  VStack,
  InputGroup,
  InputLeftElement,
  Input,
  Progress,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  SimpleGrid,
  Skeleton,
  Tooltip,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from "@chakra-ui/react";
import { useSession } from "next-auth/react";
import {
  FiPlusCircle,
  FiArrowLeft,
  FiArrowRight,
  FiSearch,
  FiRefreshCw,
  FiFilter,
  FiDownload,
  FiAlertTriangle,
  FiInfo,
} from "react-icons/fi";
import { MdOutlineLowPriority } from "react-icons/md";
import DataTable, { Column } from "@/components/DataTable";
import CreatePurchaseOrderModal from "@/components/CreatePurchaseOrderModal";
import { Site, Supplier, StockItem } from "@/lib/sanityTypes";
import { calculateBulkStock } from "@/lib/stockCalculations";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";

interface LowStockItem extends StockItem {
  currentStock: number;
  siteName: string;
  binName: string;
  minimumStockLevel: number;
  reorderQuantity: number;
  unitOfMeasure: "kg" | "g" | "l" | "ml" | "each" | "box" | "case" | "bag";
  stockStatus: "in-stock" | "low-stock" | "out-of-stock";
  orderQuantity: number;
  selected: boolean;
  priority: "critical" | "high" | "medium" | "low";
  daysUntilOut: number | null;
  originalStockItemId?: string;
}

interface OrderItem {
  stockItem: string;
  supplier: string;
  orderedQuantity: number;
  unitPrice: number;
}

export default function LowStockPage() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const isAuthenticated = status === "authenticated";
  const isAuthReady = status !== "loading";

  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<LowStockItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<LowStockItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [progress, setProgress] = useState({
    stage: "Starting...",
    percentage: 0,
  });
  const [calculationMetrics, setCalculationMetrics] = useState<{
    duration: number;
    itemsProcessed: number;
    fromCache: number;
  } | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const sitesContainerRef = useRef<HTMLDivElement>(null);
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [activeTab, setActiveTab] = useState(0); // 0: All, 1: Critical, 2: Out of Stock

  // Theming props
  const bgPrimary = useColorModeValue(
    "neutral.light.bg-primary",
    "neutral.dark.bg-primary",
  );
  const primaryTextColor = useColorModeValue(
    "neutral.light.text-primary",
    "neutral.dark.text-primary",
  );
  const secondaryTextColor = useColorModeValue(
    "neutral.light.text-secondary",
    "neutral.dark.text-secondary",
  );
  const borderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const errorColor = useColorModeValue("red.500", "red.300");
  const successColor = useColorModeValue("green.500", "green.300");
  const warningColor = useColorModeValue("orange.500", "orange.300");
  const bgCard = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );

  const scrollbarTrackColor = useColorModeValue("gray.100", "gray.700");
  const scrollbarThumbColor = useColorModeValue("brand.500", "brand.300");

  const sitesRef = useRef<Site[]>([]);

  // Calculate stock for low stock items with progress tracking
  const calculateStockForSite = useCallback(
    async (siteId: string | null) => {
      setIsLoading(true);
      setIsRefreshing(true);
      setError(null);
      setProgress({ stage: "Starting calculation...", percentage: 0 });
      setCalculationMetrics(null);

      const startTime = Date.now();

      try {
        console.log(
          "🔄 Starting low stock calculation for site:",
          siteId || "All sites",
        );

        // Fetch all stock items
        setProgress({ stage: "Fetching stock items...", percentage: 10 });
        console.log("📦 Fetching all stock items...");
        const stockItemsResponse = await fetch("/api/stock-items");
        if (!stockItemsResponse.ok) {
          throw new Error("Failed to fetch stock items");
        }
        const stockItems: any[] = await stockItemsResponse.json();
        console.log("✅ Stock items fetched:", stockItems.length, "items");

        if (stockItems.length === 0) {
          console.log("⚠️ No stock items found");
          setLowStockItems([]);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        // Fetch bins for the selected site (or all bins if no site selected)
        setProgress({ stage: "Fetching bins...", percentage: 20 });
        const binsEndpoint = siteId
          ? `/api/bins?siteId=${siteId}`
          : "/api/bins";
        console.log("🗄️ Fetching bins from:", binsEndpoint);
        const binsResponse = await fetch(binsEndpoint);
        if (!binsResponse.ok) {
          throw new Error("Failed to fetch bins");
        }
        const bins = await binsResponse.json();
        const binIds = bins.map((bin: any) => bin._id);
        console.log("✅ Bins fetched:", bins.length, "bins, IDs:", binIds);

        if (binIds.length === 0) {
          console.log("⚠️ No bins found for site:", siteId);
          setLowStockItems([]);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        // Get all stock item IDs
        const stockItemIds = stockItems.map((item) => item._id);
        console.log(
          "🔢 Calculating stock for",
          stockItemIds.length,
          "items across",
          binIds.length,
          "bins",
        );

        // Calculate current stock for all items in all bins with progress tracking
        setProgress({ stage: "Calculating current stock...", percentage: 30 });
        console.log("🧮 Starting bulk stock calculation...");

        const stockResults = await calculateBulkStock(
          stockItemIds,
          binIds,
          (progressUpdate) => {
            setProgress(progressUpdate);
          },
        );

        console.log(
          "✅ Bulk stock calculation complete. Results:",
          Object.keys(stockResults).length,
          "item-bin pairs",
        );

        // Process results and create LOW STOCK items grouped by site
        setProgress({ stage: "Processing results...", percentage: 80 });
        console.log(
          "📊 Processing results and creating low stock items grouped by site...",
        );
        const itemsWithCalculatedStock: LowStockItem[] = [];

        // Use sitesRef instead of sites state
        const siteMap = new Map();
        sitesRef.current.forEach((site) => {
          siteMap.set(site._id, site.name);
        });

        // Track items by site
        const itemsBySite: { [siteId: string]: any[] } = {};

        // For EACH item and EACH bin combination
        stockItems.forEach((item) => {
          bins.forEach((bin: any) => {
            const key = `${item._id}-${bin._id}`;
            const quantity = stockResults[key] || 0;

            // Check if item needs attention in this bin
            const isLowStock =
              quantity > 0 && quantity <= item.minimumStockLevel;
            const isOutOfStock = quantity === 0;

            // Include BOTH low stock AND out of stock items
            if (isLowStock || isOutOfStock) {
              // Get site ID and name
              let siteId = "unknown";
              let siteName = "Unknown site";

              if (bin.site) {
                if (typeof bin.site === "object" && bin.site._id) {
                  siteId = bin.site._id;
                  siteName = bin.site.name;
                } else if (typeof bin.site === "string") {
                  siteId = bin.site;
                  siteName = siteMap.get(bin.site) || "Unknown site";
                }
              }

              // Group by site
              if (!itemsBySite[siteId]) {
                itemsBySite[siteId] = [];
              }

              itemsBySite[siteId].push({
                item,
                bin,
                quantity,
                siteName,
                isOutOfStock, // Track this for priority calculation
              });
            }
          });
        });

        // Now create one entry per item per site (not per bin)
        Object.entries(itemsBySite).forEach(([siteId, siteItems]) => {
          // Group siteItems by item ID
          const itemsByItemId: { [itemId: string]: any[] } = {};

          siteItems.forEach(({ item, bin, quantity, siteName }) => {
            if (!itemsByItemId[item._id]) {
              itemsByItemId[item._id] = [];
            }
            itemsByItemId[item._id].push({ item, bin, quantity, siteName });
          });

          // Create one entry per item for this site
          Object.entries(itemsByItemId).forEach(([itemId, itemBins]) => {
            const firstEntry = itemBins[0];
            const item = firstEntry.item;

            // Calculate TOTAL stock for this item across all bins in this site
            const totalStockInSite = itemBins.reduce(
              (sum, entry) => sum + entry.quantity,
              0,
            );

            // Only include if TOTAL stock in this site is below minimum
            if (totalStockInSite <= item.minimumStockLevel) {
              let stockStatus: "in-stock" | "low-stock" | "out-of-stock" =
                "low-stock";
              if (totalStockInSite === 0) {
                stockStatus = "out-of-stock";
              } else if (totalStockInSite > item.minimumStockLevel) {
                stockStatus = "in-stock";
              }

              // Calculate priority based on urgency
              const criticality =
                totalStockInSite === 0
                  ? "critical"
                  : totalStockInSite <= item.minimumStockLevel * 0.3
                    ? "high"
                    : totalStockInSite <= item.minimumStockLevel * 0.7
                      ? "medium"
                      : "low";

              // List all bins this item is in (for this site)
              const binNames = itemBins
                .map((entry) => entry.bin.name)
                .join(", ");

              itemsWithCalculatedStock.push({
                ...item,
                _id: `${item._id}-${siteId}`, // Synthetic ID for item-site combination
                originalStockItemId: item._id, // Preserve original ID
                currentStock: totalStockInSite,
                stockStatus,
                siteName: firstEntry.siteName,
                binName:
                  itemBins.length > 1
                    ? `${itemBins.length} bins: ${binNames}`
                    : firstEntry.bin.name,
                orderQuantity: item.reorderQuantity || 1,
                selected: false,
                priority: criticality,
                daysUntilOut:
                  totalStockInSite > 0
                    ? Math.floor(
                        totalStockInSite / (item.averageDailyUsage || 1),
                      )
                    : 0,
              });
            }
          });
        });

        // Sort by priority (critical first)
        itemsWithCalculatedStock.sort((a, b) => {
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });

        const duration = Date.now() - startTime;
        setCalculationMetrics({
          duration,
          itemsProcessed: itemsWithCalculatedStock.length,
          fromCache: 0, // Could be enhanced to track actual cache hits
        });

        console.log(
          "✅ Low stock calculation complete. Low stock items found:",
          itemsWithCalculatedStock.length,
        );
        setLowStockItems(itemsWithCalculatedStock);

        // Show success toast with metrics
        toast({
          title: "Stock calculation complete",
          description: `Found ${itemsWithCalculatedStock.length} low stock items in ${duration}ms`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } catch (err: any) {
        console.error("❌ Error calculating low stock:", err);
        setError(err.message);
        toast({
          title: "Error",
          description: "Failed to calculate low stock items",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setProgress({ stage: "Complete", percentage: 100 });
        setIsLoading(false);
        setIsRefreshing(false);
        console.log("🏁 Low stock calculation finished");
      }
    },
    [toast],
  ); // Only toast dependency now

  const fetchSuppliers = async () => {
    try {
      setProgress({ stage: "Fetching suppliers...", percentage: 0 });
      const response = await fetch("/api/suppliers");
      if (!response.ok) {
        throw new Error("Failed to fetch suppliers");
      }
      const data = await response.json();
      setSuppliers(data);
    } catch (err) {
      console.error("Failed to fetch suppliers:", err);
    }
  };

  const fetchSites = async () => {
    try {
      console.log("🌐 Fetching sites...");
      const response = await fetch("/api/sites");
      if (!response.ok) {
        throw new Error("Failed to fetch sites");
      }
      const data = await response.json();
      console.log("✅ Sites fetched:", data.length, "sites");
      setSites(data);
    } catch (err) {
      console.error("❌ Failed to fetch sites:", err);
    }
  };

  useEffect(() => {
    if (isAuthReady && isAuthenticated) {
      const initData = async () => {
        await fetchSites();
        await calculateStockForSite(selectedSiteId);
        await fetchSuppliers();
      };
      initData();
    }
  }, [isAuthReady, isAuthenticated, selectedSiteId, calculateStockForSite]);

  // Filter items based on search term and active filters
  // Filter items based on search term and active filters
  useEffect(() => {
    let filtered = lowStockItems.filter((item) => {
      if (!searchTerm) return true;

      const term = searchTerm.toLowerCase();
      return (
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term) ||
        item.binName.toLowerCase().includes(term) ||
        item.siteName.toLowerCase().includes(term)
      );
    });

    // Apply priority filter (from dropdown menu)
    if (filterPriority !== "all") {
      filtered = filtered.filter((item) => item.priority === filterPriority);
    }

    // Apply tab filter (from tabs)
    switch (activeTab) {
      case 1: // Critical
        filtered = filtered.filter((item) => item.priority === "critical");
        break;
      case 2: // High
        filtered = filtered.filter((item) => item.priority === "high");
        break;
      case 3: // Medium
        filtered = filtered.filter((item) => item.priority === "medium");
        break;
      case 4: // Low
        filtered = filtered.filter((item) => item.priority === "low");
        break;
      case 5: // Out of Stock
        filtered = filtered.filter(
          (item) => item.stockStatus === "out-of-stock",
        );
        break;
      default: // All (tab 0)
        break;
    }

    setFilteredItems(filtered);
  }, [lowStockItems, searchTerm, filterPriority, activeTab]);

  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

  const handleSiteClick = (siteId: string) => {
    console.log("📍 Site selected:", siteId);
    setSelectedSiteId(siteId);
  };

  const handleScroll = (direction: "left" | "right") => {
    if (sitesContainerRef.current) {
      const scrollAmount = 200;
      const container = sitesContainerRef.current;
      if (direction === "left") {
        container.scrollLeft -= scrollAmount;
      } else {
        container.scrollLeft += scrollAmount;
      }
    }
  };

  const handleRefresh = async () => {
    console.log("🔄 Manual refresh triggered");
    setIsRefreshing(true);

    // Make sure sites are loaded before calculating
    if (sitesRef.current.length === 0) {
      await fetchSites();
    }

    await calculateStockForSite(selectedSiteId);
  };

  const updateOrderQuantity = (itemId: string, quantity: number) => {
    setLowStockItems((prev) =>
      prev.map((item) =>
        item._id === itemId ? { ...item, orderQuantity: quantity } : item,
      ),
    );
  };

  const handleOpenOrderModal = () => {
    const items = lowStockItems.filter((item) => item.selected);
    if (items.length === 0) {
      toast({
        title: "No items selected",
        description:
          "Please select at least one item to create a purchase order.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Transform items to have original IDs for the modal
    const transformedItems = items.map((item) => {
      // Extract original ID from synthetic ID (format: "originalId-siteId")
      const originalId = item._id.includes("-")
        ? item._id.split("-").slice(0, -1).join("-")
        : item._id;

      return {
        ...item,
        _id: originalId, // Replace synthetic ID with original ID
      };
    });

    setSelectedItems(transformedItems);
    onOpen();
  };

  const handleCreateOrders = async (items: OrderItem[], siteId?: string) => {
    try {
      const totalAmount = items.reduce((sum, item) => {
        return sum + item.orderedQuantity * item.unitPrice;
      }, 0);

      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderDate: new Date().toISOString(),
          orderedBy: user?.id,
          orderedItems: items,
          totalAmount,
          status: "draft",
          site: siteId || selectedSiteId,
        }),
      });

      if (response.ok) {
        toast({
          title: "Purchase order created",
          description: "The purchase order has been created successfully",
          status: "success",
          duration: 5000,
          isClosable: true,
        });

        // Clear checkboxes after successful order creation
        setLowStockItems((prev) =>
          prev.map((item) => ({
            ...item,
            selected: false,
          })),
        );
        setSelectedItems([]);
        onClose();

        // Refresh the low stock list
        if (sitesRef.current.length === 0) {
          await fetchSites();
        }
        await calculateStockForSite(selectedSiteId);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create purchase order");
      }
    } catch (error: any) {
      console.error("Error creating purchase order:", error);
      toast({
        title: "Error creating purchase order",
        description:
          error.message || "An unexpected error occurred. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Handle individual checkbox selection
  const handleCheckboxChange = (itemId: string, isSelected: boolean) => {
    setLowStockItems((prev) =>
      prev.map((item) =>
        item._id === itemId ? { ...item, selected: isSelected } : item,
      ),
    );

    if (isSelected) {
      setSelectedItems((prev) => [
        ...prev,
        lowStockItems.find((item) => item._id === itemId)!,
      ]);
    } else {
      setSelectedItems((prev) => prev.filter((item) => item._id !== itemId));
    }
  };

  // Handle select all/none
  const handleSelectAll = (isSelected: boolean) => {
    setLowStockItems((prev) =>
      prev.map((item) => ({ ...item, selected: isSelected })),
    );
    setSelectedItems(isSelected ? [...lowStockItems] : []);
  };

  const getStockStatusColor = (priority: string, currentStock: number) => {
    if (currentStock === 0) return "red";
    if (priority === "critical") return "red";
    if (priority === "high") return "orange";
    if (priority === "medium") return "yellow";
    return "green";
  };

  const getStockStatusText = (priority: string, currentStock: number) => {
    if (currentStock === 0) return "Out of Stock";
    if (priority === "critical") return "Critical";
    if (priority === "high") return "High Priority";
    if (priority === "medium") return "Medium Priority";
    return "Low Priority";
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "critical":
        return (
          <Badge colorScheme="red" variant="solid">
            Critical
          </Badge>
        );
      case "high":
        return (
          <Badge colorScheme="orange" variant="subtle">
            High
          </Badge>
        );
      case "medium":
        return (
          <Badge colorScheme="yellow" variant="outline">
            Medium
          </Badge>
        );
      default:
        return (
          <Badge colorScheme="gray" variant="outline">
            Low
          </Badge>
        );
    }
  };

  const columns: Column[] = [
    {
      accessorKey: "selected",
      header: (
        <Checkbox
          isChecked={
            lowStockItems.length > 0 &&
            lowStockItems.every((item) => item.selected)
          }
          isIndeterminate={
            lowStockItems.some((item) => item.selected) &&
            !lowStockItems.every((item) => item.selected)
          }
          onChange={(e) => handleSelectAll(e.target.checked)}
          colorScheme="brand"
        />
      ),
      isSortable: false,
      cell: (row: LowStockItem) => (
        <Checkbox
          isChecked={row.selected}
          onChange={(e) => handleCheckboxChange(row._id, e.target.checked)}
          colorScheme="brand"
        />
      ),
    },
    {
      accessorKey: "name",
      header: "Item Name",
      isSortable: true,
    },
    {
      accessorKey: "sku",
      header: "SKU",
      isSortable: true,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      isSortable: true,
      cell: (row: LowStockItem) => (
        <Flex align="center" gap={2}>
          {getPriorityIcon(row.priority)}
          {row.daysUntilOut !== null && row.daysUntilOut > 0 && (
            <Tooltip
              label={`Estimated ${row.daysUntilOut} days until out of stock`}
            >
              <Text fontSize="xs" color={secondaryTextColor}>
                ({row.daysUntilOut}d)
              </Text>
            </Tooltip>
          )}
        </Flex>
      ),
    },
    {
      accessorKey: "currentStock",
      header: "Current Stock",
      isSortable: true,
      cell: (row: LowStockItem) => (
        <Flex align="center" gap={2}>
          <Badge
            colorScheme={getStockStatusColor(row.priority, row.currentStock)}
            variant="subtle"
            px={2}
            py={1}
          >
            {getStockStatusText(row.priority, row.currentStock)}
          </Badge>
          <Text fontWeight="bold">{row.currentStock}</Text>
        </Flex>
      ),
    },
    {
      accessorKey: "minimumStockLevel",
      header: "Min Level",
      isSortable: true,
    },
    {
      accessorKey: "unitOfMeasure",
      header: "Unit",
      isSortable: true,
    },
    {
      accessorKey: "siteName",
      header: "Site",
      isSortable: true,
    },
    {
      accessorKey: "binName",
      header: "Bin",
      isSortable: true,
    },
    {
      accessorKey: "orderQuantity",
      header: "Order Quantity",
      isSortable: true,
      cell: (row: LowStockItem) => (
        <NumberInput
          value={row.orderQuantity}
          onChange={(value) =>
            updateOrderQuantity(row._id, parseInt(value) || 0)
          }
          min={1}
          max={1000}
          size="sm"
          width="100px"
        >
          <NumberInputField />
          <NumberInputStepper>
            <NumberIncrementStepper />
            <NumberDecrementStepper />
          </NumberInputStepper>
        </NumberInput>
      ),
    },
  ];

  const exportLowStockPDF = () => {
    const sortedItems = [...filteredItems].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Low Stock Report</title>
    <style>
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
            margin: 40px; 
            color: #151515;
            background: #F5F7FA;
        }
        .header-container {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #E2E8F0;
            padding-bottom: 20px;
            gap: 20px;
        }
        .logo {
            height: 80px;
            width: auto;
            opacity: 0.8;
        }
        .header-content {
            text-align: left;
            flex-grow: 1;
        }
        .header-content h1 { 
            margin: 0; 
            color: #FF6B35;
            font-size: 28px;
            font-weight: 600;
        }
        .priority-critical { background-color: #FED7D7; color: #C53030; }
        .priority-high { background-color: #FEEBC8; color: #C05621; }
        .priority-medium { background-color: #FEFCBF; color: #B7791F; }
        .priority-low { background-color: #E6FFFA; color: #234E52; }
        .table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background: #FFFFFF;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
            border: 1px solid #E2E8F0;
        }
        .table th {
            background-color: #F7FAFC;
            border: 1px solid #E2E8F0;
            padding: 12px 16px;
            text-align: left;
            font-weight: 600;
            color: #2D3748;
            font-size: 14px;
        }
        .table td {
            border: 1px solid #E2E8F0;
            padding: 12px 16px;
            color: #4A5568;
            font-size: 14px;
        }
        .table tr:nth-child(even) {
            background-color: #F7FAFC;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #E2E8F0;
            font-size: 12px;
            color: #718096;
            text-align: center;
        }
        .priority-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
        }
        @media print {
            body { margin: 25px; background: white; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="header-container">
        <div class="logo-container">
            <img src="/pdf.png" alt="Caterflow" class="logo" />
        </div>
        <div class="header-content">
            <h1>LOW STOCK REPORT</h1>
            <p style="font-size: 14px; margin: 5px 0;">Generated on ${new Date().toLocaleDateString()}</p>
            <p style="font-size: 14px; margin: 5px 0;">Total Low Stock Items: ${sortedItems.length}</p>
        </div>
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Priority</th>
                <th>Current Stock</th>
                <th>Minimum Level</th>
                <th>Unit</th>
                <th>Bin Location</th>
                <th>Site</th>
            </tr>
        </thead>
        <tbody>
            ${sortedItems
              .map((item) => {
                const priorityClass = `priority-${item.priority}`;
                const priorityText =
                  item.priority.charAt(0).toUpperCase() +
                  item.priority.slice(1);
                return `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    <td>${item.sku || "N/A"}</td>
                    <td><span class="priority-badge ${priorityClass}">${priorityText}</span></td>
                    <td>${item.currentStock}</td>
                    <td>${item.minimumStockLevel}</td>
                    <td>${item.unitOfMeasure}</td>
                    <td>${item.binName}</td>
                    <td>${item.siteName}</td>
                </tr>
                `;
              })
              .join("")}
        </tbody>
    </table>

    <div class="footer">
        <p style="margin: 0 0 8px 0;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        <p style="margin: 0 0 8px 0; color: #FF6B35; font-weight: 600;">⚠️ Immediate action required for critical items</p>
        <div class="caterflow-brand">
            <a href="https://synapse-digital.vercel.app/" target="_blank" style="color: #0067FF; text-decoration: none; cursor: pointer;">
                Caterflow by Synapse
            </a>
        </div>
    </div>

    <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button onclick="window.print()" style="background: #FF6B35; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">
            Print / Save as PDF
        </button>
    </div>
</body>
</html>`;

    const exportWindow = window.open("", "_blank");
    if (exportWindow) {
      exportWindow.document.write(htmlContent);
      exportWindow.document.close();
      exportWindow.document.title = "Low Stock Report";
    }
  };

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
          <Text color={primaryTextColor}>Loading low stock data...</Text>
        </VStack>
      </Flex>
    );
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
      <VStack spacing={6} align="stretch">
        {/* Header with Stats */}
        <HStack justifyContent="space-between" flexWrap="wrap" gap={4}>
          <VStack align="flex-start" spacing={1}>
            <Heading
              as="h1"
              size={{ base: "xl", md: "2xl" }}
              color={primaryTextColor}
            >
              Low Stock Items
            </Heading>
            {!isLoading && calculationMetrics && (
              <Text fontSize="sm" color={secondaryTextColor}>
                Calculated in {calculationMetrics.duration}ms •{" "}
                {calculationMetrics.itemsProcessed} items
              </Text>
            )}
          </VStack>
          <HStack>
            <Menu>
              <MenuButton
                as={Button}
                leftIcon={<FiFilter />}
                variant="outline"
                size="sm"
              >
                Filter
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => setFilterPriority("all")}>
                  All Priorities
                </MenuItem>
                <MenuDivider />
                <MenuItem onClick={() => setFilterPriority("critical")}>
                  Critical Only
                </MenuItem>
                <MenuItem onClick={() => setFilterPriority("high")}>
                  High Priority
                </MenuItem>
                <MenuItem onClick={() => setFilterPriority("medium")}>
                  Medium Priority
                </MenuItem>
                <MenuItem onClick={() => setFilterPriority("low")}>
                  Low Priority
                </MenuItem>
              </MenuList>
            </Menu>
            <Button
              leftIcon={<FiRefreshCw />}
              onClick={handleRefresh}
              isLoading={isRefreshing}
              variant="outline"
              colorScheme="brand"
              size="sm"
            >
              Refresh
            </Button>
            <Button
              leftIcon={<FiDownload />}
              onClick={exportLowStockPDF}
              variant="outline"
              colorScheme="brand"
              size="sm"
              isDisabled={filteredItems.length === 0}
            >
              Export PDF
            </Button>
            <Button
              colorScheme="brand"
              leftIcon={<FiPlusCircle />}
              onClick={handleOpenOrderModal}
              isDisabled={selectedItems.length === 0}
              size="md"
            >
              Create Purchase Order ({selectedItems.length})
            </Button>
          </HStack>
        </HStack>

        {/* Progress Bar during Calculation */}
        {(isLoading || isRefreshing) && progress && (
          <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
            <CardBody>
              <VStack spacing={3} align="stretch">
                <Text fontWeight="medium" color={primaryTextColor}>
                  {progress.stage}
                </Text>
                <Progress
                  value={progress.percentage}
                  colorScheme="brand"
                  hasStripe
                  isAnimated={progress.percentage < 100}
                />
                <Text
                  fontSize="sm"
                  color={secondaryTextColor}
                  textAlign="right"
                >
                  {progress.percentage}%
                </Text>
              </VStack>
            </CardBody>
          </Card>
        )}

        {/* Search Input */}
        <InputGroup>
          <InputLeftElement pointerEvents="none">
            <FiSearch color={secondaryTextColor} />
          </InputLeftElement>
          <Input
            placeholder="Search by item name, SKU, bin, or site..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            borderColor={borderColor}
            _placeholder={{ color: secondaryTextColor }}
            size="lg"
          />
        </InputGroup>

        {/* Alert for Critical Items */}
        {!isLoading &&
          lowStockItems.some((item) => item.priority === "critical") && (
            <Alert status="error" borderRadius="md" variant="left-accent">
              <AlertIcon />
              <Box flex="1">
                <AlertTitle>Critical Items Need Attention</AlertTitle>
                <AlertDescription>
                  {
                    lowStockItems.filter((item) => item.priority === "critical")
                      .length
                  }{" "}
                  items are critically low or out of stock
                </AlertDescription>
              </Box>
            </Alert>
          )}

        {/* Sites Section */}
        {(user?.role === "admin" || user?.role === "auditor") && (
          <>
            <Flex
              justify="space-between"
              align="center"
              flexWrap="wrap"
              gap={4}
            >
              <Heading as="h2" size="lg" color={primaryTextColor}>
                Sites
              </Heading>
              {sites.length > 3 && (
                <HStack>
                  <IconButton
                    aria-label="Scroll left"
                    icon={<FiArrowLeft />}
                    onClick={() => handleScroll("left")}
                    variant="ghost"
                    colorScheme="brand"
                  />
                  <IconButton
                    aria-label="Scroll right"
                    icon={<FiArrowRight />}
                    onClick={() => handleScroll("right")}
                    variant="ghost"
                    colorScheme="brand"
                  />
                </HStack>
              )}
            </Flex>

            {isLoading ? (
              <SimpleGrid columns={{ base: 2, md: 4, lg: 6 }} spacing={3}>
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} height="40px" borderRadius="md" />
                ))}
              </SimpleGrid>
            ) : sites.length > 0 ? (
              <Flex
                ref={sitesContainerRef}
                overflowX="auto"
                whiteSpace="nowrap"
                pb={4}
                sx={{
                  "::-webkit-scrollbar": { display: "none" },
                  msOverflowStyle: "none",
                  scrollbarWidth: "none",
                }}
              >
                {sites.map((site) => (
                  <Tooltip key={site._id} label={site.name}>
                    <Button
                      key={site._id}
                      onClick={() => handleSiteClick(site._id)}
                      mx={2}
                      variant={
                        selectedSiteId === site._id ? "solid" : "outline"
                      }
                      colorScheme="brand"
                      minW="120px"
                      _first={{ ml: 0 }}
                    >
                      {site.name ? site.name.trim().split(/\s+/)[0] : "Site"}
                    </Button>
                  </Tooltip>
                ))}
              </Flex>
            ) : (
              <Text color={secondaryTextColor} mb={6}>
                No sites found for your account.
              </Text>
            )}
          </>
        )}

        {/* For site managers, show their associated site */}
        {user?.role === "siteManager" && user.associatedSite && (
          <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
            <CardBody>
              <Text fontWeight="bold" color={primaryTextColor}>
                Your Associated Site:
              </Text>
              <Text color={secondaryTextColor}>{user.associatedSite.name}</Text>
            </CardBody>
          </Card>
        )}

        {/* Low Stock Summary Cards */}
        {!isLoading && lowStockItems.length > 0 && (
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 6 }} spacing={4}>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="red" borderRadius="full" px={3} py={1}>
                    Critical
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      lowStockItems.filter(
                        (item) => item.priority === "critical",
                      ).length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Immediate action
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="orange" borderRadius="full" px={3} py={1}>
                    High
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      lowStockItems.filter((item) => item.priority === "high")
                        .length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Reorder soon
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="yellow" borderRadius="full" px={3} py={1}>
                    Medium
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      lowStockItems.filter((item) => item.priority === "medium")
                        .length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Monitor closely
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="gray" borderRadius="full" px={3} py={1}>
                    Low
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      lowStockItems.filter((item) => item.priority === "low")
                        .length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Keep an eye
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="blue" borderRadius="full" px={3} py={1}>
                    Selected
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {selectedItems.length}
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Ready for order
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="purple" borderRadius="full" px={3} py={1}>
                    Out of Stock
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      lowStockItems.filter(
                        (item) => item.stockStatus === "out-of-stock",
                      ).length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Urgent restock
                  </Text>
                </VStack>
              </CardBody>
            </Card>
          </SimpleGrid>
        )}

        {/* Filter Tabs - ALL Priority Levels */}
        <Tabs
          index={activeTab}
          onChange={setActiveTab}
          variant="enclosed"
          colorScheme="brand"
        >
          <Box
            overflowX="auto"
            overflowY="hidden"
            css={{
              "&::-webkit-scrollbar": {
                height: "8px",
              },
              "&::-webkit-scrollbar-track": {
                backgroundColor: "var(--scrollbar-track)",
                borderRadius: "4px",
              },
              "&::-webkit-scrollbar-thumb": {
                backgroundColor: "var(--scrollbar-thumb)",
                borderRadius: "4px",
              },
            }}
          >
            <TabList whiteSpace="nowrap">
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                All Items ({lowStockItems.length})
              </Tab>
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                <HStack>
                  <FiAlertTriangle />
                  <Text>Critical</Text>
                  <Badge colorScheme="red" borderRadius="full">
                    {
                      lowStockItems.filter(
                        (item) => item.priority === "critical",
                      ).length
                    }
                  </Badge>
                </HStack>
              </Tab>
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                <HStack>
                  <Badge colorScheme="orange" borderRadius="full" mr={1}>
                    !
                  </Badge>
                  <Text>High</Text>
                  <Badge colorScheme="orange" borderRadius="full">
                    {
                      lowStockItems.filter((item) => item.priority === "high")
                        .length
                    }
                  </Badge>
                </HStack>
              </Tab>
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                <HStack>
                  <Badge colorScheme="yellow" borderRadius="full" mr={1}>
                    !
                  </Badge>
                  <Text>Medium</Text>
                  <Badge colorScheme="yellow" borderRadius="full">
                    {
                      lowStockItems.filter((item) => item.priority === "medium")
                        .length
                    }
                  </Badge>
                </HStack>
              </Tab>
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                <HStack>
                  <Badge colorScheme="gray" borderRadius="full" mr={1}>
                    !
                  </Badge>
                  <Text>Low</Text>
                  <Badge colorScheme="gray" borderRadius="full">
                    {
                      lowStockItems.filter((item) => item.priority === "low")
                        .length
                    }
                  </Badge>
                </HStack>
              </Tab>
              <Tab whiteSpace="nowrap" minWidth="fit-content">
                <HStack>
                  <FiAlertTriangle />
                  <Text>Out of Stock</Text>
                  <Badge colorScheme="red" borderRadius="full">
                    {
                      lowStockItems.filter(
                        (item) => item.stockStatus === "out-of-stock",
                      ).length
                    }
                  </Badge>
                </HStack>
              </Tab>
            </TabList>
          </Box>
          <TabPanels>
            <TabPanel p={0} pt={4}>
              {/* All items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Critical items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* High priority items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Medium priority items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Low priority items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Out of stock items */}
            </TabPanel>
          </TabPanels>
        </Tabs>

        {/* Data Table */}
        {error ? (
          <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
            <CardBody>
              <VStack spacing={4}>
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Error Loading Data</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Box>
                </Alert>
                <Button
                  onClick={() => calculateStockForSite(selectedSiteId)}
                  colorScheme="brand"
                  isLoading={isLoading}
                >
                  Try Again
                </Button>
              </VStack>
            </CardBody>
          </Card>
        ) : isLoading && !isRefreshing ? (
          <VStack spacing={4} py={8}>
            <Spinner size="xl" color="brand.500" />
            <Text color={secondaryTextColor}>Loading low stock items...</Text>
          </VStack>
        ) : filteredItems.length === 0 ? (
          <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
            <CardBody>
              <VStack spacing={4} py={8}>
                <FiAlertTriangle size={48} color={warningColor} />
                <Text
                  fontSize="lg"
                  color={secondaryTextColor}
                  textAlign="center"
                >
                  {searchTerm
                    ? `No items found matching "${searchTerm}"`
                    : selectedSiteId
                      ? "No low stock items found for this site. Great job!"
                      : "No low stock items found for your account."}
                </Text>
                {searchTerm && (
                  <Button
                    onClick={() => setSearchTerm("")}
                    variant="ghost"
                    size="sm"
                  >
                    Clear Search
                  </Button>
                )}
              </VStack>
            </CardBody>
          </Card>
        ) : (
          <Card bg={bgCard} borderColor={borderColor} borderWidth="1px">
            <CardBody p={0}>
              <DataTable
                columns={columns}
                data={filteredItems}
                loading={isLoading}
                onSelectionChange={setSelectedItems}
              />
            </CardBody>
          </Card>
        )}

        <CreatePurchaseOrderModal
          isOpen={isOpen}
          onClose={onClose}
          selectedItems={selectedItems}
          suppliers={suppliers}
          onSave={handleCreateOrders}
          selectedSiteId={selectedSiteId}
          sites={sites}
        />
      </VStack>
    </Box>
  );
}
