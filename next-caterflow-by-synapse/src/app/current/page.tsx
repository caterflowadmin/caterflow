// src/app/current/page.tsx
"use client";
import dynamic from 'next/dynamic';
import { cachedFetch } from '@/lib/clientCache';
import { logger } from '@/lib/logger';

import { useState, useEffect, useRef, useCallback } from "react";

const SimpleCalculationsModal = dynamic(() => import("@/components/SimpleCalculationsModal"), { ssr: false });
import {
  Box,
  Heading,
  Text,
  Flex,
  Spinner,
  Button,
  useToast,
  HStack,
  IconButton,
  useColorModeValue,
  Badge,
  Card,
  CardBody,
  VStack,
  InputGroup,
  InputLeftElement,
  Input,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Progress,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  SimpleGrid,
  Skeleton,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  Tooltip,
  Select,
} from "@chakra-ui/react";
import { useSession } from "next-auth/react";
import {
  FiEye,
  FiArrowLeft,
  FiArrowRight,
  FiSearch,
  FiRefreshCw,
  FiFileText,
  FiInfo,
  FiTrendingUp,
  FiTrendingDown,
  FiDatabase,
} from "react-icons/fi";
import { MdOutlineSort } from "react-icons/md";
import DataTable, { Column } from "./DataTable";
import { Site, StockItem } from "@/lib/sanityTypes";
import {
  calculateBulkStock,
  emergencyRecalculateAllStock,
} from "@/lib/stockCalculations";

import { useDisclosure } from "@chakra-ui/react";
const CalculationsModal = dynamic(() => import("@/components/CalculationsModal"), { ssr: false });
interface CurrentStockItem extends StockItem {
  currentStock: number;
  siteName: string;
  binName: string;
  binId: string; // ← ADD THIS
  minimumStockLevel: number;
  reorderQuantity: number;
  unitOfMeasure: "kg" | "g" | "l" | "ml" | "each" | "box" | "case" | "bag";
  stockStatus: "in-stock" | "low-stock" | "out-of-stock";
  lastUpdated?: string;
}

export default function CurrentStockPage() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const isAuthenticated = status === "authenticated";
  const isAuthReady = status !== "loading";

  const [currentStockItems, setCurrentStockItems] = useState<
    CurrentStockItem[]
  >([]);
  const [filteredItems, setFilteredItems] = useState<CurrentStockItem[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [progress, setProgress] = useState({
    stage: "Starting...",
    percentage: 0,
  });
  const [calculationMetrics, setCalculationMetrics] = useState<{
    duration: number;
    itemsProcessed: number;
    fromCache: number;
  } | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  }>({
    key: "name",
    direction: "asc",
  });
  const toast = useToast();
  const sitesContainerRef = useRef<HTMLDivElement>(null);

  // In your CurrentStockPage component, add state:
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<CurrentStockItem | null>(
    null,
  );
  const [transactionHistory, setTransactionHistory] = useState<any>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Add to your other state variables
  const [snapshotData, setSnapshotData] = useState<any[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);

  // Theming props
  const bgPrimary = useColorModeValue(
    "neutral.light.bg-primary",
    "neutral.dark.bg-primary",
  );
  const bgCard = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const primaryTextColor = useColorModeValue(
    "neutral.light.text-primary",
    "neutral.dark.text-primary",
  );
  const secondaryTextColor = useColorModeValue(
    "neutral.light.text-secondary",
    "neutral.dark.text-secondary",
  );
  const borderCard = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const successColor = useColorModeValue("green.500", "green.300");
  const warningColor = useColorModeValue("orange.500", "orange.300");
  const errorColor = useColorModeValue("red.500", "red.300");

  const fetchRegistrySnapshots = async (
    stockItemIds: string[],
    binIds: string[],
  ) => {
    const maxBatchSize = 5000;
    const totalCombinations = stockItemIds.length * binIds.length;

    const fetchBatch = async (itemBatch: string[], binBatch: string[]) => {
      const response = await fetch("/api/stock/snapshots/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockItemIds: itemBatch, binIds: binBatch }),
      });

      const payloadText = await response.text();
      let payload: any = {};
      try {
        payload = payloadText ? JSON.parse(payloadText) : {};
      } catch (parseError) {
        console.error(
          "Failed to parse snapshot batch response:",
          parseError,
          payloadText,
        );
        throw new Error(`Invalid registry response (${response.status})`);
      }

      if (!response.ok) {
        const message =
          payload?.error ||
          payload?.message ||
          `Registry fetch failed with status ${response.status}`;
        throw new Error(message);
      }

      return payload;
    };

    if (totalCombinations <= maxBatchSize) {
      return await fetchBatch(stockItemIds, binIds);
    }

    console.warn(
      `⚠️ Fetching ${totalCombinations} snapshot combinations in batches of ${maxBatchSize}`,
    );

    const results: { [key: string]: number } = {};
    let existingSnapshots = 0;
    let missingCount = 0;
    let totalCount = 0;
    let hasAllSnapshots = true;
    let registryExists = true;
    let registryId: string | undefined;

    const addBatchResult = (batchData: any) => {
      if (!batchData) return;
      if (batchData.snapshots) {
        Object.assign(results, batchData.snapshots);
      }
      existingSnapshots += batchData.existingSnapshots || 0;
      missingCount += batchData.missingCount || 0;
      totalCount += batchData.totalCount || 0;
      hasAllSnapshots = hasAllSnapshots && Boolean(batchData.hasAllSnapshots);
      registryExists = registryExists && Boolean(batchData.registryExists);
      registryId ||= batchData.registryId;
    };

    const itemBatchSize = Math.max(
      1,
      Math.floor(maxBatchSize / Math.max(1, binIds.length)),
    );

    if (itemBatchSize > 0 && itemBatchSize < stockItemIds.length) {
      for (let i = 0; i < stockItemIds.length; i += itemBatchSize) {
        const batchItemIds = stockItemIds.slice(i, i + itemBatchSize);
        const batchData = await fetchBatch(batchItemIds, binIds);
        addBatchResult(batchData);
      }
    } else {
      const binBatchSize = Math.max(
        1,
        Math.floor(maxBatchSize / Math.max(1, stockItemIds.length)),
      );
      for (let i = 0; i < binIds.length; i += binBatchSize) {
        const batchBinIds = binIds.slice(i, i + binBatchSize);
        const batchData = await fetchBatch(stockItemIds, batchBinIds);
        addBatchResult(batchData);
      }
    }

    return {
      snapshots: results,
      existingSnapshots,
      missingCount,
      totalCount,
      hasAllSnapshots,
      registryExists,
      registryId,
    };
  };

  // Helper function to extract missing item-bin pairs from snapshot data
  const extractMissingPairs = (snapshotResults: {
    [key: string]: number;
  }): Array<{ itemId: string; binId: string }> => {
    const missingPairs: Array<{ itemId: string; binId: string }> = [];

    Object.entries(snapshotResults).forEach(([key, value]) => {
      if (value === 0) {
        const [itemId, binId] = key.split("-");
        missingPairs.push({ itemId, binId });
      }
    });

    return missingPairs;
  };

  // Calculate stock with progress tracking
  const calculateStockForSite = useCallback(
    async (siteId: string | null, forceRecalc = false) => {
      setIsLoading(true);
      setIsRefreshing(true);
      setError(null);
      setProgress({ stage: "Starting...", percentage: 0 });
      setCalculationMetrics(null);

      const startTime = Date.now();

      try {
        logger.debug(
          "🚀 Loading stock from registry for site:",
          siteId || "All sites",
          forceRecalc ? "(forced)" : "",
        );

        // 1. Get stock items and bins in parallel
        setProgress({ stage: "Fetching items and bins...", percentage: 10 });

        const [stockItemsResponse, binsResponse] = await Promise.all([
          cachedFetch("/api/stock-items"),
          fetch(siteId ? `/api/bins?siteId=${siteId}` : "/api/bins"),
        ]);

        if (!stockItemsResponse.ok || !binsResponse.ok) {
          throw new Error("Failed to fetch items or bins");
        }

        const stockItems: any[] = await stockItemsResponse.json();
        const bins: any[] = await binsResponse.json();

        logger.debug("🔍 DEBUG - Bins fetched:", {
          count: bins.length,
          binIds: bins.map((b) => b._id),
          binNames: bins.map((b) => b.name),
        });

        logger.debug("🔍 DEBUG - Stock items fetched:", {
          count: stockItems.length,
          itemIds: stockItems.slice(0, 5).map((i) => i._id),
        });

        if (stockItems.length === 0 || bins.length === 0) {
          logger.debug("⚠️ No items or bins found");
          setCurrentStockItems([]);
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        const stockItemIds = stockItems.map((item) => item._id);
        const binIds = bins.map((bin) => bin._id);

        logger.debug(
          `📊 Processing: ${stockItems.length} items × ${bins.length} bins = ${stockItemIds.length * binIds.length} combinations`,
        );

        // 2. Get ALL stock from registry in one or more calls
        setProgress({ stage: "Loading from registry...", percentage: 30 });
        logger.debug("📊 Fetching stock from registry...");

        const registryData = await fetchRegistrySnapshots(stockItemIds, binIds);

        logger.debug("📋 Registry response:", {
          total: registryData.totalCount,
          found: registryData.existingSnapshots,
          missing: registryData.missingCount,
          hasAll: registryData.hasAllSnapshots,
          registryExists: registryData.registryExists,
          registryId: registryData.registryId,
        });

        const stockResults = registryData.snapshots;

        // 3. If force recalc OR items are missing from registry, calculate them
        let calculatedCount = 0;
        let fromCacheCount = registryData.existingSnapshots;

        if (forceRecalc || registryData.missingCount > 0) {
          logger.debug(
            `🔍 ${registryData.missingCount} items missing from registry, calculating...`,
          );

          // Identify which items are truly missing (not just 0 quantity)
          const missingPairs: Array<{ itemId: string; binId: string }> = [];

          // Only calculate items that are not in registry at all
          // Items with quantity 0 ARE in registry, so don't recalculate them
          for (const binId of binIds) {
            for (const itemId of stockItemIds) {
              const key = `${itemId}-${binId}`;
              // If this key doesn't exist in results at all (undefined), it's missing
              if (stockResults[key] === undefined) {
                missingPairs.push({ itemId, binId });
              }
            }
          }

          logger.debug(
            `🔍 True missing pairs: ${missingPairs.length} (was ${registryData.missingCount})`,
          );

          if (missingPairs.length > 0) {
            // Calculate missing items
            const missingItemIds = [
              ...new Set(missingPairs.map((p) => p.itemId)),
            ];
            const missingBinIds = [
              ...new Set(missingPairs.map((p) => p.binId)),
            ];

            setProgress({
              stage: `Calculating ${missingPairs.length} missing items...`,
              percentage: 50,
            });

            try {
              const calculatedResults = await calculateBulkStock(
                missingItemIds,
                missingBinIds,
                (progress) => {
                  const adjustedPercentage = 50 + progress.percentage * 0.4;
                  setProgress({
                    stage: `Calculating ${Math.round(progress.percentage)}%...`,
                    percentage: adjustedPercentage,
                  });
                },
              );

              // Merge calculated results with registry results
              Object.entries(calculatedResults).forEach(([key, value]) => {
                stockResults[key] = value;
              });

              calculatedCount = missingPairs.length;
              fromCacheCount = registryData.totalCount - missingPairs.length;
            } catch (calcError) {
              console.error("❌ Calculation failed:", calcError);
              // Don't fail the whole request, just log the error
            }
          }
        } else {
          logger.debug("✅ All items found in registry");
        }

        setProgress({ stage: "Processing results...", percentage: 90 });

        // 4. PROCESS RESULTS
        logger.debug("📊 Processing final results...");
        const itemsWithCalculatedStock: CurrentStockItem[] = [];

        // Create site map for lookups
        const siteMap = new Map();
        sites.forEach((site) => {
          siteMap.set(site._id, site.name);
        });

        // For EACH item and EACH bin combination
        for (const item of stockItems) {
          for (const bin of bins) {
            const key = `${item._id}-${bin._id}`;
            const quantity = stockResults[key] || 0;

            let stockStatus: "in-stock" | "low-stock" | "out-of-stock" =
              "in-stock";
            if (quantity <= 0) {
              stockStatus = "out-of-stock";
            } else if (quantity <= item.minimumStockLevel) {
              stockStatus = "low-stock";
            }

            // Get site name
            let siteName = "Unknown site";
            if (bin.site) {
              if (typeof bin.site === "object" && bin.site.name) {
                siteName = bin.site.name;
              } else if (typeof bin.site === "string") {
                siteName = siteMap.get(bin.site) || "Unknown site";
              }
            }

            itemsWithCalculatedStock.push({
              ...item,
              _id: `${item._id}-${bin._id}`,
              currentStock: quantity,
              stockStatus,
              siteName,
              binName: bin.name,
              binId: bin._id,
              lastUpdated: new Date().toISOString(),
            });
          }

          // Yield to prevent UI freezing during processing
          if (itemsWithCalculatedStock.length % 100 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        const duration = Date.now() - startTime;

        // 5. UPDATE STATE
        setCurrentStockItems(itemsWithCalculatedStock);
        setCalculationMetrics({
          duration,
          itemsProcessed: itemsWithCalculatedStock.length,
          fromCache: fromCacheCount,
        });

        // 6. SHOW APPROPRIATE TOAST
        let toastTitle = "Stock loaded";
        let toastDescription = "";

        if (fromCacheCount === itemsWithCalculatedStock.length) {
          toastTitle = "Stock loaded instantly";
          toastDescription = `All ${itemsWithCalculatedStock.length} items from registry`;
        } else if (fromCacheCount > 0 && calculatedCount > 0) {
          toastTitle = "Stock calculated efficiently";
          toastDescription = `${fromCacheCount} from registry + ${calculatedCount} calculated`;
        } else {
          toastTitle = "Stock calculation complete";
          toastDescription = `Calculated ${itemsWithCalculatedStock.length} items`;
        }

        toast({
          title: toastTitle,
          description: `${toastDescription} in ${duration}ms`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });

        logger.debug(
          `✅ FINISHED: ${itemsWithCalculatedStock.length} items in ${duration}ms (${fromCacheCount} from registry, ${calculatedCount} calculated)`,
        );
      } catch (err: any) {
        console.error("❌ Error calculating stock:", err);
        setError(err.message);
        toast({
          title: "Error",
          description: "Failed to calculate current stock",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setProgress({ stage: "Complete", percentage: 100 });
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [toast, sites],
  );

  const fetchSites = async () => {
    try {
      logger.debug("🌐 Fetching sites...");
      const response = await cachedFetch("/api/sites");
      if (!response.ok) {
        throw new Error("Failed to fetch sites");
      }
      const data = await response.json();
      logger.debug("✅ Sites fetched:", data.length, "sites");
      setSites(data);
    } catch (err) {
      console.error("❌ Failed to fetch sites:", err);
    }
  };

  const handleSiteClick = (siteId: string) => {
    logger.debug("📍 Site selected:", siteId);
    setSelectedSiteId(siteId);
  };

  const handleRefresh = async (forceRecalc = false) => {
    logger.debug("🔄 Manual refresh triggered", { forceRecalc });
    setIsRefreshing(true);

    try {
      if (forceRecalc) {
        // Optional: Add confirmation
        const confirmed = window.confirm(
          "⚠️ Clear all stock snapshots?\n\n" +
            "This will delete all cached stock calculations and refresh the page.",
        );

        if (!confirmed) {
          setIsRefreshing(false);
          return;
        }

        toast({
          title: "Clearing Stock Data",
          description: "Deleting all stock snapshots...",
          status: "warning",
          duration: 2000,
        });

        // ✅ Clear local storage
        localStorage.clear(); // Or be specific: removeItem for stock-related keys

        // ✅ Call API to clear server-side snapshots
        const response = await fetch("/api/stock/clear-snapshots", {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Failed to clear snapshots");
        }

        const result = await response.json();

        toast({
          title: "Success!",
          description: `Cleared ${result.snapshotsCleared} snapshots. Refreshing...`,
          status: "success",
          duration: 1500,
        });

        // ✅ Refresh page
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        // Your existing normal refresh logic
        logger.debug("🔁 Normal refresh");
        // ... existing code ...
      }
    } catch (error: any) {
      console.error("❌ Refresh failed:", error);
      toast({
        title: "Error",
        description: error.message,
        status: "error",
        duration: 3000,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Fetch sites immediately upon authentication
    if (isAuthReady && isAuthenticated && sites.length === 0) {
      fetchSites();
    }
    // Set associated site for site managers
    if (user?.associatedSite?._id) {
      setSelectedSiteId(user.associatedSite._id);
    }
    // Set default site for admins/auditors only if no site is selected and sites are available
    if (
      (user?.role === "admin" ||
        user?.role === "auditor" ||
        user?.role === "procurer") &&
      sites.length > 0 &&
      !selectedSiteId
    ) {
      // setSelectedSiteId(sites[0]._id);
    }
  }, [isAuthReady, isAuthenticated, sites, user]);

  // Calculate stock when site selection changes
  useEffect(() => {
    if (isAuthReady && isAuthenticated) {
      calculateStockForSite(selectedSiteId);
    }
  }, [selectedSiteId, isAuthReady, isAuthenticated, calculateStockForSite]);

  // Filter items based on search term and active tab
  useEffect(() => {
    let filtered = currentStockItems.filter((item) => {
      if (!searchTerm) return true;

      const term = searchTerm.toLowerCase();
      return (
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term) ||
        item.binName.toLowerCase().includes(term) ||
        item.siteName.toLowerCase().includes(term)
      );
    });

    // Apply tab filter
    switch (activeTab) {
      case 1: // In Stock
        filtered = filtered.filter((item) => item.stockStatus === "in-stock");
        break;
      case 2: // Low Stock
        filtered = filtered.filter((item) => item.stockStatus === "low-stock");
        break;
      case 3: // Out of Stock
        filtered = filtered.filter(
          (item) => item.stockStatus === "out-of-stock",
        );
        break;
      default: // All
        break;
    }

    // Apply sorting
    filtered.sort((a, b) => {
      const aValue = a[sortConfig.key as keyof CurrentStockItem];
      const bValue = b[sortConfig.key as keyof CurrentStockItem];

      // Convert to strings for safe comparison
      const aStr = String(aValue || "");
      const bStr = String(bValue || "");

      if (aStr < bStr) return sortConfig.direction === "asc" ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    setFilteredItems(filtered);
  }, [currentStockItems, searchTerm, activeTab, sortConfig]);

  useEffect(() => {
    const checkAndRecalculate = async () => {
      // Check if we need to recalculate
      const lastCalculation = localStorage.getItem("lastStockCalculation");
      const now = new Date().getTime();

      // Recalculate if never done or older than 1 hour
      if (!lastCalculation || now - parseInt(lastCalculation) > 3600000) {
        logger.debug("🔄 Auto-recalculating stock...");

        // Show loading state
        setIsLoading(true);

        // Trigger recalculation
        await calculateStockForSite(selectedSiteId);

        // Update timestamp
        localStorage.setItem("lastStockCalculation", now.toString());

        // Show success toast
        toast({
          title: "Stock Updated",
          description: "Current stock has been recalculated",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      }
    };

    if (isAuthenticated && selectedSiteId !== null) {
      checkAndRecalculate();
    }
  }, [isAuthenticated, selectedSiteId, calculateStockForSite, toast]);

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

  const getStockStatusColor = (
    currentStock: number,
    minimumStockLevel: number,
  ) => {
    if (currentStock < 0) return "red"; // NEW: Negative = Critical error
    if (currentStock === 0) return "red";
    if (currentStock <= minimumStockLevel) return "orange";
    return "green";
  };

  const getStockStatusText = (
    currentStock: number,
    minimumStockLevel: number,
  ) => {
    if (currentStock < 0) return "DATA ERROR: Negative Stock"; // NEW
    if (currentStock === 0) return "Out of Stock";
    if (currentStock <= minimumStockLevel) return "Low Stock";
    return "In Stock";
  };

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  // Add this function to fetch transaction history
  const fetchTransactionHistory = async (itemId: string, binId: string) => {
    setIsLoadingHistory(true);
    try {
      // Extract original ID if needed
      const originalItemId = itemId.includes("-")
        ? itemId.split("-")[0]
        : itemId;

      // For "B-WELL Tangy Mayo", we need to find which bin it's actually in
      // Based on logs, it's in "main" bin with ID "bin-main" or similar

      // First, let's get the actual bin ID for this item
      const binResponse = await fetch(
        `/api/stock/item-bins?stockItemId=${originalItemId}`,
      );
      if (binResponse.ok) {
        const binData = await binResponse.json();
        logger.debug("📦 Available bins for item:", binData);

        // If we have a specific binId, use it, otherwise use the first available
        const targetBinId =
          binId ||
          (binData.bins && binData.bins.length > 0 ? binData.bins[0]._id : "");

        if (!targetBinId) {
          throw new Error("No bin found for this item");
        }

        // Now fetch transaction history for this specific item-bin combination
        const response = await fetch(
          `/api/stock/transaction-history?stockItemId=${originalItemId}&binId=${targetBinId}`,
        );

        if (!response.ok) {
          throw new Error("Failed to fetch transaction history");
        }

        const data = await response.json();
        logger.debug("📊 Transaction history data:", data);

        if (data.success) {
          setTransactionHistory(data);
        } else {
          throw new Error(data.error || "Failed to load transaction history");
        }
      } else {
        throw new Error("Failed to fetch bin information");
      }
    } catch (error) {
      console.error("Error fetching transaction history:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to load transaction history",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      setTransactionHistory(null);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Add a handler for opening the calculations modal
  const handleOpenCalculations = async (item: CurrentStockItem) => {
    logger.debug("🔍 DEBUG handleOpenCalculations:", {
      itemName: item.name,
      itemId: item._id,
      originalItemId: item._id.includes("-")
        ? item._id.split("-")[0]
        : item._id,
      binName: item.binName,
      binId: item.binId,
      currentStock: item.currentStock,
    });

    // Get the original item ID (remove bin suffix if present)
    const originalItemId = item._id.includes("-")
      ? item._id.split("-")[0]
      : item._id;

    // Use the stored binId
    const binId = item.binId;

    if (!binId) {
      toast({
        title: "Error",
        description: "Could not determine bin ID",
        status: "error",
        duration: 3000,
      });
      return;
    }

    setSelectedItem(item);
    setIsLoadingHistory(true);
    setTransactionHistory(null);

    try {
      logger.debug(`📊 Fetching calculation for ${originalItemId} in ${binId}`);

      const response = await fetch(
        `/api/stock/transaction-history?stockItemId=${originalItemId}&binId=${binId}`,
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch calculation");
      }

      const data = await response.json();
      setTransactionHistory(data);
      onOpen();

      logger.debug("✅ Calculation loaded:", {
        currentStock: data.currentStock,
        transactionCount: data.transactions?.length,
      });
    } catch (error: any) {
      console.error("Error fetching calculation:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load calculation",
        status: "error",
        duration: 3000,
      });
    } finally {
      setIsLoadingHistory(false);
    }
  };

  /**
     * {
    accessorKey: 'calculations',
    header: 'Calculations',
    isSortable: false,
    cell: (row: CurrentStockItem) => (
        <Tooltip label="View calculation details">
            <IconButton
                aria-label="View calculations"
                icon={<FiEye />}
                size="sm"
                variant="ghost"
                colorScheme="brand"
                onClick={() => handleOpenCalculations(row)}
            />
        </Tooltip>
    ),
},
     */

  const columns: Column[] = [
    {
      accessorKey: "name",
      header: (
        <Flex
          align="center"
          cursor="pointer"
          onClick={() => handleSort("name")}
        >
          Item Name
          {sortConfig.key === "name" && (
            <Text ml={2} fontSize="sm">
              {sortConfig.direction === "asc" ? "↑" : "↓"}
            </Text>
          )}
        </Flex>
      ),
      isSortable: true,
    },
    {
      accessorKey: "sku",
      header: (
        <Flex align="center" cursor="pointer" onClick={() => handleSort("sku")}>
          SKU
          {sortConfig.key === "sku" && (
            <Text ml={2} fontSize="sm">
              {sortConfig.direction === "asc" ? "↑" : "↓"}
            </Text>
          )}
        </Flex>
      ),
      isSortable: true,
    },
    {
      accessorKey: "currentStock",
      header: "Current Stock",
      isSortable: true,
      cell: (row: CurrentStockItem) => (
        <Flex align="center" gap={2}>
          <Badge
            colorScheme={getStockStatusColor(
              row.currentStock,
              row.minimumStockLevel,
            )}
            mr={2}
            px={2}
            py={1}
          >
            {getStockStatusText(row.currentStock, row.minimumStockLevel)}
          </Badge>
          <Flex direction="column">
            <Text fontWeight="bold" fontSize="lg">
              {row.currentStock}
              {row.currentStock < 0 && (
                <Text as="span" ml={1} fontSize="xs" color="red.500">
                  (NEGATIVE)
                </Text>
              )}
            </Text>
            {/*                        <Button
                            size="xs"
                            variant="link"
                            colorScheme="blue"
                            onClick={() => handleOpenCalculations(row)}
                            leftIcon={<FiEye />}
                            mt={1}
                        >
                            View Calculation
                        </Button>*/}
          </Flex>
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
      accessorKey: "binName",
      header: "Bin Location",
      isSortable: true,
    },
    {
      accessorKey: "siteName",
      header: "Site",
      isSortable: true,
    },
  ];

  const fetchStockSnapshots = async () => {
    try {
      setIsLoading(true);
      logger.debug("📊 Fetching stock snapshots...");

      // Get unique item and bin IDs from current items
      const uniqueItemIds = [
        ...new Set(
          currentStockItems.map((item) => {
            // Extract original item ID (remove bin suffix)
            return item._id.includes("-") ? item._id.split("-")[0] : item._id;
          }),
        ),
      ];

      const uniqueBinIds = [
        ...new Set(currentStockItems.map((item) => item.binId)),
      ];

      // Call the new function
      const response = await fetch("/api/stock/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockItemIds: uniqueItemIds,
          binIds: uniqueBinIds,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch snapshots");
      }

      const data = await response.json();
      setSnapshotData(data);
      setShowSnapshots(true);

      logger.debug(`✅ Loaded ${data.length} snapshots`);
    } catch (error) {
      console.error("Error fetching snapshots:", error);
      toast({
        title: "Error",
        description: "Failed to fetch stock snapshots",
        status: "error",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const exportCurrentStockPDF = () => {
    const sortedItems = [...filteredItems].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Current Stock Report</title>
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
            color: #0067FF;
            font-size: 28px;
            font-weight: 600;
        }
        .status-in-stock { background-color: #C6F6D5; color: #22543D; }
        .status-low-stock { background-color: #FEEBC8; color: #744210; }
        .status-out-of-stock { background-color: #FED7D7; color: #742A2A; }
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
        .status-badge {
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
            <h1>CURRENT STOCK REPORT</h1>
            <p style="font-size: 14px; margin: 5px 0;">Generated on ${new Date().toLocaleDateString()}</p>
            <p style="font-size: 14px; margin: 5px 0;">Total Items: ${sortedItems.length}</p>
            <p style="font-size: 14px; margin: 5px 0;">Site: ${selectedSiteId ? sites.find((s) => s._id === selectedSiteId)?.name || "All Sites" : "All Sites"}</p>
        </div>
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Current Stock</th>
                <th>Status</th>
                <th>Unit of Measure</th>
                <th>Bin Location</th>
                <th>Site</th>
            </tr>
        </thead>
        <tbody>
            ${sortedItems
              .map((item) => {
                const statusClass = `status-${item.stockStatus.replace("-", "-")}`;
                const statusText =
                  item.stockStatus === "in-stock"
                    ? "In Stock"
                    : item.stockStatus === "low-stock"
                      ? "Low Stock"
                      : "Out of Stock";
                return `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    <td>${item.sku || "N/A"}</td>
                    <td>${item.currentStock}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
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
        <p style="margin: 0 0 8px 0;">This report provides an overview of current stock levels across all sites.</p>
        <div class="caterflow-brand">
            <a href="https://Synapse-digital.vercel.app/" target="_blank" style="color: #0067FF; text-decoration: none; cursor: pointer;">
                Caterflow by Synapse
            </a>
        </div>
    </div>

    <div class="no-print" style="text-align: center; margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
    <button onclick="window.print()" style="background: #0067FF; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">
        Print / Save as PDF
    </button>
    <button onclick="window.close()" style="background: #E2E8F0; color: #4A5568; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">
        Close Window
    </button>
</div>
</body>
</html>`;

    const exportWindow = window.open("", "_blank");
    if (exportWindow) {
      exportWindow.document.write(htmlContent);
      exportWindow.document.close();
      exportWindow.document.title = "Current Stock Report";
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
          <Text color={primaryTextColor}>Loading session...</Text>
        </VStack>
      </Flex>
    );
  }

  async function refreshStockCalc() {
    setIsRefreshing(true);
    try {
      toast({
        title: "Starting Emergency Recalculation",
        description: "This may take a few moments...",
        status: "info",
        duration: 3000,
        isClosable: true,
      });

      const response = await fetch("/api/stock/emergency-recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Emergency recalculation failed");
      }

      const result = await response.json();

      toast({
        title: "Emergency Recalculation Complete",
        description: `Processed ${result.stats?.receiptsProcessed || 0} receipts and ${result.stats?.itemsProcessed || 0} items`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      // Refresh the current stock display
      await calculateStockForSite(selectedSiteId);
    } catch (error: any) {
      console.error("Emergency recalculation failed:", error);
      toast({
        title: "Emergency Recalculation Failed",
        description: error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
      <VStack spacing={6} align="stretch">
        {/* Header with Stats */}
        <Flex
          justify="space-between"
          align={{ base: "flex-start", md: "center" }}
          flexWrap="wrap"
          gap={4}
          direction={{ base: "column", md: "row" }}
        >
          <VStack align="flex-start" spacing={1}>
            <Heading
              as="h1"
              size={{ base: "xl", md: "2xl" }}
              color={primaryTextColor}
            >
              Current Stock
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
                leftIcon={<MdOutlineSort />}
                variant="outline"
                size="sm"
              >
                Sort
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => handleSort("name")}>
                  Name{" "}
                  {sortConfig.key === "name" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </MenuItem>
                <MenuItem onClick={() => handleSort("currentStock")}>
                  Stock Level{" "}
                  {sortConfig.key === "currentStock" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </MenuItem>
                <MenuItem onClick={() => handleSort("minimumStockLevel")}>
                  Min Level{" "}
                  {sortConfig.key === "minimumStockLevel" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  onClick={() =>
                    setSortConfig({ key: "name", direction: "asc" })
                  }
                >
                  Reset Sorting
                </MenuItem>
              </MenuList>
            </Menu>
            {/*<Menu>
                            <MenuButton as={Button} leftIcon={<FiRefreshCw />} isLoading={isRefreshing}>
                                Refresh
                            </MenuButton>
                            <MenuList>
                                <MenuItem onClick={() => handleRefresh(false)}>
                                    Quick Refresh (Use Cache)
                                </MenuItem>
                                <MenuItem onClick={() => handleRefresh(true)}>
                                    Force Recalculate (Full)
                                </MenuItem>
                                <MenuDivider />
                                <MenuItem onClick={refreshStockCalc}>
                                    Emergency Recalculate All
                                </MenuItem>
                            </MenuList>
                        </Menu>*/}
            <Button
              leftIcon={<FiRefreshCw />}
              onClick={() => handleRefresh(true)}
              variant="outline"
              colorScheme="brand"
              size="sm"
              isDisabled={isLoading || isRefreshing}
            >
              Refresh
            </Button>
            <Button
              leftIcon={<FiFileText />}
              onClick={exportCurrentStockPDF}
              variant="outline"
              colorScheme="brand"
              size="sm"
              isDisabled={isLoading || isRefreshing}
            >
              Export PDF
            </Button>
            {/*<Button
                            leftIcon={<FiDatabase />}
                            onClick={fetchStockSnapshots}
                            variant="outline"
                            colorScheme="purple"
                            size="sm"
                            isLoading={isLoading}
                        >
                            View Snapshots
                        </Button>*/}
          </HStack>
        </Flex>

        {showSnapshots && (
          <Card mt={4} bg={bgCard} borderColor={borderCard} borderWidth="1px">
            <CardBody>
              <Flex justify="space-between" align="center" mb={4}>
                <Heading size="md" color={primaryTextColor}>
                  Stock Snapshots ({snapshotData.length})
                </Heading>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSnapshots(false)}
                >
                  Close
                </Button>
              </Flex>

              <DataTable
                columns={[
                  {
                    accessorKey: "stockItem.name",
                    header: "Item",
                    isSortable: true,
                  },
                  {
                    accessorKey: "bin.name",
                    header: "Bin",
                    isSortable: true,
                  },
                  {
                    accessorKey: "quantity",
                    header: "Quantity",
                    isSortable: true,
                    cell: (row: any) => (
                      <Badge
                        colorScheme={row.quantity > 0 ? "green" : "red"}
                        variant="subtle"
                      >
                        {row.quantity}
                      </Badge>
                    ),
                  },
                  {
                    accessorKey: "lastUpdated",
                    header: "Last Updated",
                    isSortable: true,
                    cell: (row: any) => (
                      <Text fontSize="sm">
                        {new Date(row.lastUpdated).toLocaleString()}
                      </Text>
                    ),
                  },
                  {
                    accessorKey: "transactionType",
                    header: "Source",
                    isSortable: true,
                    cell: (row: any) => (
                      <Badge colorScheme="blue" variant="subtle">
                        {row.transactionType || "manual"}
                      </Badge>
                    ),
                  },
                ]}
                data={snapshotData}
                loading={isLoading}
              />
            </CardBody>
          </Card>
        )}

        {/* Progress Bar during Calculation */}
        {(isLoading || isRefreshing) && progress && (
          <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
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
            borderColor={borderCard}
            _placeholder={{ color: secondaryTextColor }}
            size="lg"
          />
        </InputGroup>

        {/* Alert for Low Stock Items */}
        {!isLoading &&
          currentStockItems.some(
            (item) => item.stockStatus === "low-stock",
          ) && (
            <Alert status="warning" borderRadius="md" variant="left-accent">
              <AlertIcon />
              <Box flex="1">
                <AlertTitle>Low Stock Items Detected</AlertTitle>
                <AlertDescription>
                  {
                    currentStockItems.filter(
                      (item) => item.stockStatus === "low-stock",
                    ).length
                  }{" "}
                  items are below minimum stock levels
                </AlertDescription>
              </Box>
            </Alert>
          )}

        {/* Sites Section */}
        {(user?.role === "admin" ||
          user?.role === "auditor" ||
          user?.role === "procurer") && (
          <>
            <Flex
              justify="space-between"
              align="center"
              flexWrap="wrap"
              gap={4}
            >
              <Heading as="h2" size="md" color={primaryTextColor}>
                Sites
              </Heading>
              {sites.length > 3 && (
                <HStack>
                  <IconButton
                    aria-label="Scroll left"
                    icon={<FiArrowLeft />}
                    onClick={() => handleScroll("left")}
                    size="sm"
                    variant="ghost"
                    colorScheme="brand"
                  />
                  <IconButton
                    aria-label="Scroll right"
                    icon={<FiArrowRight />}
                    onClick={() => handleScroll("right")}
                    size="sm"
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
                pb={2}
                sx={{
                  "::-webkit-scrollbar": { display: "none" },
                  msOverflowStyle: "none",
                  scrollbarWidth: "none",
                }}
              >
                <Button
                  key="all"
                  onClick={() => setSelectedSiteId(null)}
                  mr={2}
                  variant={selectedSiteId === null ? "solid" : "outline"}
                  colorScheme="brand"
                  minW="100px"
                >
                  All Sites
                </Button>
                {sites.map((site) => (
                  <Tooltip key={site._id} label={site.name}>
                    <Button
                      onClick={() => handleSiteClick(site._id)}
                      mr={2}
                      variant={
                        selectedSiteId === site._id ? "solid" : "outline"
                      }
                      colorScheme="brand"
                      width="fit-content"
                      maxW="150px"
                      isTruncated
                      textOverflow="ellipsis"
                    >
                      {site.name ? site.name.trim().split(/\s+/)[0] : "Site"}
                    </Button>
                  </Tooltip>
                ))}
              </Flex>
            ) : (
              <Text color={secondaryTextColor}>
                No sites found for your account.
              </Text>
            )}
          </>
        )}

        {/* For site managers, show their associated site */}
        {user?.role === "siteManager" && user.associatedSite && (
          <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
            <CardBody>
              <Text fontWeight="bold" color={primaryTextColor}>
                Your Associated Site:
              </Text>
              <Text color={secondaryTextColor}>{user.associatedSite.name}</Text>
            </CardBody>
          </Card>
        )}

        {/* Stock Summary Cards */}
        {!isLoading && currentStockItems.length > 0 && (
          <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={4}>
            <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="green" borderRadius="full" px={3} py={1}>
                    <FiTrendingUp />
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      currentStockItems.filter(
                        (item) => item.stockStatus === "in-stock",
                      ).length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    In Stock
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="orange" borderRadius="full" px={3} py={1}>
                    <FiInfo />
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      currentStockItems.filter(
                        (item) => item.stockStatus === "low-stock",
                      ).length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Low Stock
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="red" borderRadius="full" px={3} py={1}>
                    <FiTrendingDown />
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {
                      currentStockItems.filter(
                        (item) => item.stockStatus === "out-of-stock",
                      ).length
                    }
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Out of Stock
                  </Text>
                </VStack>
              </CardBody>
            </Card>
            <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
              <CardBody>
                <VStack spacing={1}>
                  <Badge colorScheme="blue" borderRadius="full" px={3} py={1}>
                    Total
                  </Badge>
                  <Text fontSize="2xl" fontWeight="bold">
                    {currentStockItems.length}
                  </Text>
                  <Text fontSize="sm" color={secondaryTextColor}>
                    Total Items
                  </Text>
                </VStack>
              </CardBody>
            </Card>
          </SimpleGrid>
        )}

        {/* Filter Tabs */}
        <Tabs
          index={activeTab}
          onChange={setActiveTab}
          variant="enclosed"
          colorScheme="brand"
        >
          <TabList>
            <Tab>All ({currentStockItems.length})</Tab>
            <Tab>
              <HStack>
                <FiTrendingUp />
                <Text>In Stock</Text>
                <Badge colorScheme="green" borderRadius="full">
                  {
                    currentStockItems.filter(
                      (item) => item.stockStatus === "in-stock",
                    ).length
                  }
                </Badge>
              </HStack>
            </Tab>
            <Tab>
              <HStack>
                <FiInfo />
                <Text>Low Stock</Text>
                <Badge colorScheme="orange" borderRadius="full">
                  {
                    currentStockItems.filter(
                      (item) => item.stockStatus === "low-stock",
                    ).length
                  }
                </Badge>
              </HStack>
            </Tab>
            <Tab>
              <HStack>
                <FiTrendingDown />
                <Text>Out of Stock</Text>
                <Badge colorScheme="red" borderRadius="full">
                  {
                    currentStockItems.filter(
                      (item) => item.stockStatus === "out-of-stock",
                    ).length
                  }
                </Badge>
              </HStack>
            </Tab>
          </TabList>
          <TabPanels>
            <TabPanel p={0} pt={4}>
              {/* All items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* In Stock items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Low Stock items */}
            </TabPanel>
            <TabPanel p={0} pt={4}>
              {/* Out of Stock items */}
            </TabPanel>
          </TabPanels>
        </Tabs>

        {/* Data Table */}
        {error ? (
          <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
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
            <Text color={secondaryTextColor}>Loading stock data...</Text>
          </VStack>
        ) : filteredItems.length === 0 ? (
          <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
            <CardBody>
              <VStack spacing={4} py={8}>
                <FiInfo size={48} color={secondaryTextColor} />
                <Text
                  fontSize="lg"
                  color={secondaryTextColor}
                  textAlign="center"
                >
                  {searchTerm
                    ? `No items found matching "${searchTerm}"`
                    : activeTab > 0
                      ? "No items match the selected filter"
                      : selectedSiteId
                        ? "No stock items found for this site."
                        : "No stock items found for your account."}
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
                {activeTab > 0 && (
                  <Button
                    onClick={() => setActiveTab(0)}
                    variant="ghost"
                    size="sm"
                  >
                    Show All Items
                  </Button>
                )}
              </VStack>
            </CardBody>
          </Card>
        ) : (
          <Card bg={bgCard} borderColor={borderCard} borderWidth="1px">
            <CardBody p={0}>
              <DataTable
                columns={columns}
                data={filteredItems}
                loading={isLoading}
              />
            </CardBody>
          </Card>
        )}

        {/* Performance Metrics (Debug) */}
        {!isLoading &&
          calculationMetrics &&
          process.env.NODE_ENV === "development" && (
            <Card
              bg={bgCard}
              borderColor={borderCard}
              borderWidth="1px"
              size="sm"
            >
              <CardBody>
                <Text fontSize="xs" color={secondaryTextColor}>
                  Performance: {calculationMetrics.duration}ms • Items:{" "}
                  {calculationMetrics.itemsProcessed} • Cache:{" "}
                  {calculationMetrics.fromCache}
                </Text>
              </CardBody>
            </Card>
          )}
      </VStack>

      {/* Replace the commented-out CalculationsModal with: */}
      <SimpleCalculationsModal
        isOpen={isOpen}
        onClose={onClose}
        stockItemName={selectedItem?.name || ""}
        binName={selectedItem?.binName || ""}
        siteName={selectedItem?.siteName || ""}
        currentStock={selectedItem?.currentStock || 0}
        isLoading={isLoadingHistory}
        transactionHistory={transactionHistory}
      />

      {/*<CalculationsModal
                isOpen={isOpen}
                onClose={onClose}
                stockItemId={selectedItem?._id || ''}
                stockItemName={selectedItem?.name || ''}
                binId={selectedItem?.binName || ''}
                binName={selectedItem?.binName || ''}
                siteName={selectedItem?.siteName || ''}
                currentStock={selectedItem?.currentStock || 0}
                isLoading={isLoadingHistory}
                transactionHistory={transactionHistory}
            />*/}
    </Box>
  );
}
