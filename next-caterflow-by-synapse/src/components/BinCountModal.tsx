import { cachedFetch } from '@/lib/clientCache';
import { logger } from '@/lib/logger';
// src/components/BinCountModal.tsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  FormControl,
  FormLabel,
  Input,
  useToast,
  VStack,
  HStack,
  IconButton,
  Text,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Box,
  Icon,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
  Heading,
  Card,
  CardBody,
  useColorModeValue,
  Divider,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Flex,
  Spinner,
} from "@chakra-ui/react";
import {
  getRecentUnitPricesForItemsInBin,
  resolveUnitPrice,
} from "@/lib/unitPriceResolver";
import {
  FiPlus,
  FiTrash2,
  FiSearch,
  FiCheck,
  FiSave,
  FiRefreshCw,
  FiX,
  FiFilter,
} from "react-icons/fi";
import BinSelectorModal from "./BinSelectorModal";
import StockItemSelectorModal from "./StockItemSelectorModal";
import { useSession } from "next-auth/react";
import { nanoid } from "nanoid";
import { StockItem } from "@/lib/sanityTypes";

interface CountedItem {
  stockItem: {
    _id: string;
    name: string;
    sku: string;
    unitPrice?: number;
  };
  countedQuantity: number;
  systemQuantityAtCountTime?: number;
  variance?: number;
  varianceCost?: number;
  unitPrice?: number;
  _key?: string;
  hasMissingPrice?: boolean; // Add this
}

interface StockItemForSelector {
  _id: string;
  name: string;
  sku: string;
  itemType: "food" | "nonFood";
  unitOfMeasure: string;
  unitPrice?: number;
  description?: string;
  category?: {
    _id: string;
    title: string;
  };
}

interface Bin {
  _id: string;
  name: string;
  site: {
    _id: string;
    name: string;
  };
}

interface BinCount {
  _id: string;
  countNumber: string;
  countDate: string;
  status: "draft" | "in-progress" | "completed" | "adjusted";
  bin: Bin;
  countedBy?: {
    _id: string;
    name: string;
  };
  countedItems: CountedItem[];
  notes?: string;
}

interface BinCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  binCount: BinCount | null;
  onSave: () => void;
  countType?: "standard" | "adjustment"; // Add this
}

export default function BinCountModal({
  isOpen,
  onClose,
  binCount,
  onSave,
  countType = "standard",
}: BinCountModalProps) {
  const { data: session } = useSession();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBinModalOpen, setIsBinModalOpen] = useState(false);
  const [isStockItemModalOpen, setIsStockItemModalOpen] = useState(false);
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [countDate, setCountDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");
  const [countedItems, setCountedItems] = useState<CountedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [searchResults, setSearchResults] = useState<number[]>([]);

  const isViewMode =
    binCount?.status === "completed" || binCount?.status === "adjusted";

  // Theme-aware colors
  const cardBg = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const modalBg = useColorModeValue(
    "neutral.light.bg-secondary",
    "neutral.dark.bg-secondary",
  );
  const borderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const tableHeaderBg = useColorModeValue("neutral.100", "neutral.700");
  const tableHeaderText = useColorModeValue("neutral.700", "neutral.200");

  const countedItemIds = useMemo(() => {
    return countedItems.map((item) => item.stockItem._id);
  }, [countedItems]);

  // Filter items based on search term
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return countedItems;

    const term = searchTerm.toLowerCase();
    return countedItems.filter(
      (item) =>
        item.stockItem.name.toLowerCase().includes(term) ||
        item.stockItem.sku.toLowerCase().includes(term),
    );
  }, [countedItems, searchTerm]);

  // Find search results
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const term = searchTerm.toLowerCase();
    const results = countedItems
      .map((item, index) => ({
        index,
        matches:
          item.stockItem.name.toLowerCase().includes(term) ||
          item.stockItem.sku.toLowerCase().includes(term),
      }))
      .filter((item) => item.matches)
      .map((item) => item.index);

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  }, [countedItems, searchTerm]);

  const highlightNextSearchResult = () => {
    if (searchResults.length === 0) return;

    const nextIndex = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(nextIndex);

    // Scroll to the highlighted item
    const itemIndex = searchResults[nextIndex];
    const elementId = `item-${countedItems[itemIndex]._key}`;
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const highlightPrevSearchResult = () => {
    if (searchResults.length === 0) return;

    const prevIndex =
      (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(prevIndex);

    // Scroll to the highlighted item
    const itemIndex = searchResults[prevIndex];
    const elementId = `item-${countedItems[itemIndex]._key}`;
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const fetchBulkCurrentStock = useCallback(
    async (
      itemIds: string[],
      binId: string,
    ): Promise<Record<string, number>> => {
      if (itemIds.length === 0 || !binId) return {};

      try {
        const response = await fetch("/api/stock/bulk-current", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stockItems: itemIds,
            binId,
          }),
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.results) {
          logger.debug(
            `✅ Batch fetch successful: ${Object.keys(data.results).length} items`,
          );
          return data.results;
        } else {
          console.warn("Bulk fetch returned unsuccessful:", data);
          throw new Error(data.error || "Bulk fetch failed");
        }
      } catch (error) {
        console.error("❌ Error in bulk current stock fetch:", error);
        return await fetchIndividualCurrentStock(itemIds, binId);
      }
    },
    [],
  );

  const fetchIndividualCurrentStock = async (
    itemIds: string[],
    binId: string,
  ): Promise<Record<string, number>> => {
    const results: Record<string, number> = {};

    const batchSize = 5;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);

      const batchPromises = batch.map(async (itemId) => {
        try {
          const response = await fetch(
            `/api/stock/current?stockItemId=${itemId}&binId=${binId}`,
          );
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              return { itemId, quantity: data.currentStock || 0 };
            }
          }
          return { itemId, quantity: 0 };
        } catch (error) {
          console.error(
            `Failed to fetch individual stock for ${itemId}:`,
            error,
          );
          return { itemId, quantity: 0 };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(({ itemId, quantity }) => {
        results[itemId] = quantity;
      });
    }

    logger.debug(
      `✅ Fallback individual fetch complete: ${Object.keys(results).length} items`,
    );
    return results;
  };

  useEffect(() => {
    if (!isOpen) return;

    if (binCount) {
      setSelectedBin(binCount.bin || null);
      setCountDate(new Date(binCount.countDate).toISOString().split("T")[0]);
      setNotes(binCount.notes || "");

      // Load prices from receipts for items in this count
      const loadPricesForExistingCount = async () => {
        const itemIds = (binCount.countedItems || [])
          .filter((item) => item && item.stockItem)
          .map((item) =>
            typeof item.stockItem === "string"
              ? item.stockItem
              : item.stockItem._id,
          );

        const pricesFromReceipts = await fetchUnitPricesFromReceipts(
          itemIds,
          binCount.bin?._id || "",
        );

        const validCountedItems = (binCount.countedItems || [])
          .filter((item) => item && item.stockItem)
          .map((item) => {
            const itemId =
              typeof item.stockItem === "string"
                ? item.stockItem
                : item.stockItem._id;

            const unitPrice =
              pricesFromReceipts[itemId] ??
              item.stockItem.unitPrice ??
              item.unitPrice ??
              0;

            const hasMissingPrice =
              !pricesFromReceipts[itemId] && !item.stockItem.unitPrice;

            return {
              ...item,
              _key: item._key || nanoid(),
              stockItem: {
                _id: itemId,
                name: item.stockItem.name || "Unknown Item",
                sku: item.stockItem.sku || "N/A",
                unitPrice: unitPrice,
              },
              unitPrice: unitPrice,
              hasMissingPrice: hasMissingPrice,
            };
          });

        setCountedItems(validCountedItems);
        if (validCountedItems.some((item) => item.hasMissingPrice)) {
          setNotes(
            "Some stock items do not have a unit price. Variance cost may be inaccurate for those items.",
          );
        }
      };

      loadPricesForExistingCount();
    } else {
      setSelectedBin(null);
      setCountDate(new Date().toISOString().split("T")[0]);
      setNotes("");
      setCountedItems([]);
    }
  }, [isOpen, binCount, isViewMode]);

  useEffect(() => {
    const fetchSystemQuantities = async () => {
      if (binCount && !isViewMode && selectedBin && countedItems.length > 0) {
        setLoading(true);
        try {
          const itemsToFetch = countedItems.filter(
            (item) =>
              (typeof item.systemQuantityAtCountTime === "undefined" ||
                item.systemQuantityAtCountTime === null) &&
              item.stockItem._id &&
              selectedBin._id,
          );

          if (itemsToFetch.length > 0) {
            const itemIds = itemsToFetch.map((item) => item.stockItem._id);
            const bulkResults = await fetchBulkCurrentStock(
              itemIds,
              selectedBin._id,
            );

            const updatedItems = countedItems.map((item) => {
              if (bulkResults[item.stockItem._id] !== undefined) {
                return {
                  ...item,
                  systemQuantityAtCountTime: bulkResults[item.stockItem._id],
                };
              }
              return item;
            });

            const hasChanges = updatedItems.some(
              (newItem, index) =>
                newItem.systemQuantityAtCountTime !==
                countedItems[index]?.systemQuantityAtCountTime,
            );

            if (hasChanges) {
              setCountedItems(updatedItems);
            }
          }
        } catch (error) {
          console.error("Error fetching system quantities:", error);
          toast({
            title: "Error",
            description: "Failed to load system quantities for some items.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        } finally {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchSystemQuantities, 100);
    return () => clearTimeout(timer);
  }, [
    binCount,
    isViewMode,
    selectedBin,
    countedItems,
    toast,
    fetchBulkCurrentStock,
  ]);

  useEffect(() => {
    return () => {
      if (!isOpen) {
        setSelectedBin(null);
        setCountDate(new Date().toISOString().split("T")[0]);
        setNotes("");
        setCountedItems([]);
        setIsProcessing(false);
        setSearchTerm("");
        setCurrentSearchIndex(-1);
        setSearchResults([]);
      }
    };
  }, [isOpen]);

  const loadAllStockItems = useCallback(async () => {
    if (!selectedBin || binCount) return;

    setLoading(true);
    try {
      // Changed from /api/procurement/stock-items to /api/stock-items for accurate unitPrice
      const response = await cachedFetch("/api/stock-items");
      if (!response.ok) throw new Error("Failed to fetch stock items");

      const allStockItems: StockItemForSelector[] = await response.json();

      // LOG 1: Raw API Response
      logger.debug("📥 Raw API Response from /api/stock-items:", allStockItems);
      logger.debug("🔍 First item structure:", allStockItems[0]);
      logger.debug(`ℹ️ Total items received: ${allStockItems.length}`);

      if (allStockItems.length === 0) {
        toast({
          title: "No Stock Items",
          description: "No stock items found in the system.",
          status: "info",
          duration: 3000,
          isClosable: true,
        });
        return;
      }

      const itemIds = allStockItems.map((item) => item._id);
      const bulkResults = await fetchBulkCurrentStock(itemIds, selectedBin._id);

      // Fetch unit prices from goods receipts
      const pricesFromReceipts = await fetchUnitPricesFromReceipts(
        itemIds,
        selectedBin._id,
      );

      const itemsWithQuantities = allStockItems.map((item) => {
        const systemQuantity = bulkResults[item._id] ?? 0;

        // Use consistent resolver: receipt price → item price → 0
        const unitPrice = resolveUnitPrice(
          pricesFromReceipts[item._id],
          item.unitPrice,
        );

        // Check if price is actually missing
        const hasMissingPrice =
          pricesFromReceipts[item._id] == null && item.unitPrice == null;

        // LOG 2: Each item's unit price
        logger.debug(`📦 Item: ${item.name} (SKU: ${item.sku})`);
        logger.debug(`   Price from receipts: ${pricesFromReceipts[item._id]}`);
        logger.debug(`   Price from item: ${item.unitPrice}`);
        logger.debug(`   Final unitPrice: ${unitPrice}`);

        return {
          _key: nanoid(),
          stockItem: {
            _id: item._id,
            name: item.name,
            sku: item.sku || "N/A",
            unitPrice: unitPrice,
          },
          countedQuantity: 0,
          systemQuantityAtCountTime: systemQuantity,
          variance: 0 - systemQuantity,
          varianceCost: (0 - systemQuantity) * unitPrice,
          unitPrice: unitPrice,
          hasMissingPrice: hasMissingPrice,
        };
      });

      // LOG 3: Final processed items
      logger.debug("✅ Final itemsWithQuantities array:", itemsWithQuantities);
      logger.debug("💰 Sample - First 3 items with prices:");
      itemsWithQuantities.slice(0, 3).forEach((item, idx) => {
        logger.debug(
          `  [${idx}] ${item.stockItem.name} - unitPrice: ${item.unitPrice}`,
        );
      });

      setCountedItems(itemsWithQuantities);

      toast({
        title: "All Items Loaded",
        description: `${itemsWithQuantities.length} stock items added to bin count`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error: any) {
      console.error("Error loading all stock items:", error);
      toast({
        title: "Error",
        description: "Failed to load all stock items. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedBin, binCount, toast, fetchBulkCurrentStock]);

  useEffect(() => {
    if (selectedBin && !binCount && countType === "standard") {
      const timer = setTimeout(() => {
        loadAllStockItems();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedBin, binCount, loadAllStockItems, countType]);

  useEffect(() => {
    const updatedItems = countedItems.map((item) => {
      const counted = item.countedQuantity || 0;
      const system = item.systemQuantityAtCountTime || 0;
      const unitPrice = item.unitPrice ?? item.stockItem?.unitPrice ?? 0;
      const variance = counted - system;
      const varianceCost = variance * unitPrice;

      return {
        ...item,
        variance: variance,
        varianceCost: varianceCost,
      };
    });

    const hasChanges = updatedItems.some(
      (item, index) =>
        item.variance !== countedItems[index]?.variance ||
        item.varianceCost !== countedItems[index]?.varianceCost,
    );

    if (hasChanges) {
      setCountedItems(updatedItems);
    }
  }, [countedItems]);

  const fixBrokenBinCount = async (countId: string) => {
    if (isProcessing) return;

    setIsProcessing(true);
    try {
      // Fetch just the one count (this used to download every bin count ever recorded).
      const response = await fetch(`/api/bin-counts/${encodeURIComponent(countId)}`);
      if (response.status !== 404 && !response.ok) throw new Error("Failed to fetch bin count");

      const brokenCount = response.ok ? await response.json() : null;

      if (!brokenCount) {
        toast({
          title: "Bin Count Not Found",
          description: "The bin count you are trying to fix was not found.",
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      const fixedPayload = {
        countNumber: brokenCount.countNumber,
        countDate: brokenCount.countDate,
        bin: brokenCount.bin._id,
        notes: brokenCount.notes,
        status: brokenCount.status,
        countedItems: (brokenCount.countedItems || [])
          .filter((item: any) => item && item.stockItem)
          .map((item: any) => ({
            _key: item._key,
            stockItem: item.stockItem._id,
            countedQuantity: item.countedQuantity,
            systemQuantityAtCountTime: item.systemQuantityAtCountTime,
            variance: item.variance,
          })),
      };

      const saveResponse = await fetch("/api/bin-counts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _id: countId, ...fixedPayload }),
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.error || "Failed to save fixed count");
      }

      toast({
        title: "Count Fixed",
        description: "The bin count has been fixed successfully.",
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      onSave();
    } catch (error: any) {
      console.error("Error fixing bin count:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to fix the bin count.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBinSelect = (bin: Bin) => {
    setSelectedBin(bin);
    setIsBinModalOpen(false);

    if (!binCount) {
      // The useEffect above will handle the auto-loading
    }
  };

  // Fetch unit prices from goods receipts for items in this bin
  const fetchUnitPricesFromReceipts = async (
    itemIds: string[],
    binId: string,
  ): Promise<Record<string, number>> => {
    // Use shared helper for consistent pricing logic
    return getRecentUnitPricesForItemsInBin(itemIds, binId);
  };

  const handleStockItemsSelect = async (items: StockItemForSelector[]) => {
    setIsStockItemModalOpen(false);

    if (!selectedBin) {
      toast({
        title: "No Bin Selected",
        description: "Please select a bin before adding items.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const existingItemIds = new Set(countedItems.map((i) => i.stockItem._id));
    const newItems = items.filter((item) => !existingItemIds.has(item._id));

    if (newItems.length === 0) {
      toast({
        title: "All items already added",
        description: "The selected items are already in your bin count.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoading(true);

    try {
      // LOG 4: Manual selection - raw items
      logger.debug("📋 Manual selection - Items selected from modal:", newItems);
      logger.debug("🔍 First selected item:", newItems[0]);

      const newItemIds = newItems.map((item) => item._id);

      // Fetch current stock quantities
      const bulkResults = await fetchBulkCurrentStock(
        newItemIds,
        selectedBin._id,
      );

      // Fetch unit prices from goods receipts
      const pricesFromReceipts = await fetchUnitPricesFromReceipts(
        newItemIds,
        selectedBin._id,
      );

      const itemsWithQuantities = newItems.map((item) => {
        const systemQuantity = bulkResults[item._id] ?? 0;

        const unitPrice = resolveUnitPrice(
          pricesFromReceipts[item._id],
          item.unitPrice,
        );

        const hasMissingPrice =
          pricesFromReceipts[item._id] == null && item.unitPrice == null;

        // LOG 5: Each manually selected item's unit price
        logger.debug(
          `📦 Manual selection - Item: ${item.name} (SKU: ${item.sku})`,
        );
        logger.debug(`   Price from receipts: ${pricesFromReceipts[item._id]}`);
        logger.debug(`   Price from item: ${item.unitPrice}`);
        logger.debug(`   Final unitPrice: ${unitPrice}`);
        logger.debug(`   Has missing price: ${hasMissingPrice}`);

        return {
          _key: nanoid(),
          stockItem: {
            _id: item._id,
            name: item.name,
            sku: item.sku || "N/A",
            unitPrice: unitPrice,
          },
          countedQuantity: 0,
          systemQuantityAtCountTime: systemQuantity,
          variance: 0 - systemQuantity,
          varianceCost: (0 - systemQuantity) * unitPrice,
          unitPrice: unitPrice,
          hasMissingPrice: hasMissingPrice,
        };
      });

      // LOG 6: Final processed items from manual selection
      logger.debug(
        "✅ Items after manual selection processing:",
        itemsWithQuantities,
      );
      logger.debug("💰 Sample prices from manual selection:");
      itemsWithQuantities.forEach((item) => {
        logger.debug(`  ${item.stockItem.name}: unitPrice=${item.unitPrice}`);
      });

      setCountedItems((prev) => [...prev, ...itemsWithQuantities]);

      if (itemsWithQuantities.length < items.length) {
        toast({
          title: "Some items skipped",
          description: `${items.length - itemsWithQuantities.length} items were already in the count`,
          status: "info",
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Items added",
          description: `${itemsWithQuantities.length} items added to bin count`,
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      }
    } catch (error: any) {
      console.error("Error adding stock items:", error);
      toast({
        title: "Error",
        description: "Failed to add items. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshSystemQuantities = async () => {
    if (!selectedBin || countedItems.length === 0) {
      toast({
        title: "Cannot Refresh",
        description: "Please select a bin and add items first",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoading(true);
    try {
      const itemIds = countedItems.map((item) => item.stockItem._id);
      const bulkResults = await fetchBulkCurrentStock(itemIds, selectedBin._id);

      const updatedItems = countedItems.map((item) => {
        const systemQuantity = bulkResults[item.stockItem._id] || 0;
        const counted = item.countedQuantity || 0;
        const unitPrice = item.unitPrice ?? item.stockItem?.unitPrice ?? 0;
        const variance = counted - systemQuantity;
        const varianceCost = variance * unitPrice;

        return {
          ...item,
          systemQuantityAtCountTime: systemQuantity,
          variance: variance,
          varianceCost: varianceCost,
        };
      });

      setCountedItems(updatedItems);

      toast({
        title: "System Quantities Refreshed",
        description: "Current stock levels have been updated",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error refreshing system quantities:", error);
      toast({
        title: "Error",
        description: "Failed to refresh system quantities",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCountedQuantityChange = (key: string, value: string) => {
    const valueAsNumber = value === "" ? 0 : parseFloat(value);
    setCountedItems((prev) =>
      prev.map((item) =>
        item._key === key
          ? {
              ...item,
              countedQuantity: isNaN(valueAsNumber) ? 0 : valueAsNumber,
            }
          : item,
      ),
    );
  };

  const handleRemoveItem = (key: string) => {
    setCountedItems((prev) => prev.filter((item) => item._key !== key));
  };

  const totalVariance = useMemo(() => {
    return countedItems.reduce((sum, item) => {
      const counted = item.countedQuantity || 0;
      const system = item.systemQuantityAtCountTime || 0;
      return sum + (counted - system);
    }, 0);
  }, [countedItems]);

  const totalVarianceCost = useMemo(() => {
    return countedItems.reduce((sum, item) => {
      const counted = item.countedQuantity || 0;
      const system = item.systemQuantityAtCountTime || 0;
      const variance = counted - system;
      const unitPrice = item.unitPrice || item.stockItem?.unitPrice || 0;
      return sum + variance * unitPrice;
    }, 0);
  }, [countedItems]);

  const handleSave = async (isFinalize: boolean = false) => {
    if (isProcessing) return;

    if (countedItems.length === 0) {
      toast({
        title: "No Items",
        description: "Please add at least one item to the count.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    if (!selectedBin) {
      toast({
        title: "No Bin Selected",
        description: "Please select a bin before saving.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const validCountedItems = countedItems.filter(
      (item) =>
        item.stockItem &&
        item.stockItem._id &&
        typeof item.countedQuantity === "number",
    );

    if (validCountedItems.length !== countedItems.length) {
      console.warn(
        `Filtered out ${countedItems.length - validCountedItems.length} invalid items`,
      );

      toast({
        title: "Some items filtered",
        description: `${countedItems.length - validCountedItems.length} items were invalid and removed.`,
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
    }

    const itemsWithVariance = validCountedItems.map((item, index) => {
      const variance = item.variance || 0;
      const unitPrice = item.unitPrice ?? item.stockItem.unitPrice ?? 0;
      const varianceCost = item.varianceCost || variance * unitPrice;

      return {
        _key: item._key || `item-${index}-${Date.now()}`,
        stockItem: item.stockItem._id,
        countedQuantity: item.countedQuantity || 0,
        systemQuantityAtCountTime: item.systemQuantityAtCountTime || 0,
        variance:
          (item.countedQuantity || 0) - (item.systemQuantityAtCountTime || 0),
        varianceCost: varianceCost,
        unitPrice: unitPrice,
      };
    });

    logger.debug(`📦 Processing ${itemsWithVariance.length} valid items`);

    let status;
    if (isFinalize) {
      status = "completed";
    } else {
      status = binCount?.status || "draft";
    }

    const totalVarianceCost = itemsWithVariance.reduce(
      (sum, item) => sum + (item.varianceCost || 0),
      0,
    );
    const totalVariance = itemsWithVariance.reduce(
      (sum, item) => sum + (item.variance || 0),
      0,
    );

    const payload: any = {
      countDate: new Date(countDate).toISOString(),
      bin: selectedBin._id,
      notes: notes || "",
      countedItems: itemsWithVariance,
      status: status,
      totalVariance: totalVariance,
      totalVarianceCost: totalVarianceCost,
    };

    if (session?.user?.id) {
      payload.countedBy = session.user.id;
    }

    if (binCount) {
      payload._id = binCount._id;
    }

    logger.debug("📤 Sending payload with", itemsWithVariance.length, "items");

    try {
      const method = binCount ? "PUT" : "POST";
      const url = "/api/bin-counts";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      logger.debug("📥 Response status:", response.status);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
          console.error("❌ API error:", errorData);
        } catch (jsonError) {
          const text = await response.text();
          console.error("❌ Raw error response:", text);
          errorData = {
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        let errorMessage = "Failed to save bin count";
        if (errorData?.details) {
          errorMessage = errorData.details;
        } else if (errorData?.error) {
          errorMessage = errorData.error;
        }

        throw new Error(errorMessage);
      }

      const result = await response.json();
      logger.debug("✅ Save successful:", result);

      toast({
        title: `Count ${isFinalize ? "Finalized" : "Saved"}`,
        description: `The bin count ${result.countNumber} has been successfully ${isFinalize ? "finalized" : "saved"}.`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      onClose();
      onSave();
    } catch (error: any) {
      console.error("❌ Error saving bin count:", error);
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size={{ base: "full", md: "3xl" }}
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent bg={modalBg}>
          <ModalHeader
            bg={useColorModeValue(
              "neutral.light.bg-header",
              "neutral.dark.bg-header",
            )}
            borderBottom="1px solid"
            borderColor={borderColor}
            pb={4}
          >
            <Heading size="md" fontWeight="bold">
              {binCount
                ? `Bin Count ${binCount.countNumber}`
                : countType === "adjustment"
                  ? "New Adjustment Count"
                  : "New Bin Count"}
            </Heading>
            {!binCount && (
              <Badge
                colorScheme={countType === "adjustment" ? "orange" : "brand"}
                ml={2}
                fontSize="xs"
              >
                {countType === "adjustment" ? "Adjustment" : "Standard"}
              </Badge>
            )}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody
            overflowY="auto"
            maxH={{ base: "calc(100vh - 200px)", md: "calc(100vh - 300px)" }}
            pb={6}
          >
            <VStack spacing={4} pt={4}>
              <FormControl id="bin-name" isRequired>
                <FormLabel>Bin</FormLabel>
                <HStack spacing={2} flexWrap="wrap">
                  <Input
                    placeholder="Select a Bin"
                    value={selectedBin?.name || ""}
                    readOnly
                    flex="1"
                  />
                  <Button
                    onClick={() => setIsBinModalOpen(true)}
                    isDisabled={isViewMode || !!binCount}
                    minW="120px"
                    colorScheme="brand"
                    variant="outline"
                  >
                    Select Bin
                  </Button>
                </HStack>
              </FormControl>
              <FormControl id="count-date" isRequired>
                <FormLabel>Count Date</FormLabel>
                <Input
                  type="date"
                  value={countDate}
                  onChange={(e) => setCountDate(e.target.value)}
                  isReadOnly={isViewMode}
                />
              </FormControl>
              <FormControl id="notes">
                <FormLabel>Notes</FormLabel>
                <Input
                  placeholder="Add any notes about the count"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  isReadOnly={isViewMode}
                />
              </FormControl>

              <Box w="100%" mt={8}>
                <Heading size="md" mb={4}>
                  Counted Items ({countedItems.length} items)
                </Heading>

                {/* Search Bar */}
                <Box mb={4}>
                  <InputGroup>
                    <InputLeftElement pointerEvents="none">
                      <Icon
                        as={FiSearch}
                        color="neutral.light.text-secondary"
                      />
                    </InputLeftElement>
                    <Input
                      placeholder="Search items by name or SKU..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      isDisabled={countedItems.length === 0}
                    />
                    {searchTerm && (
                      <InputRightElement width="auto">
                        <HStack spacing={1} mr={2}>
                          {searchResults.length > 0 && (
                            <>
                              <Text
                                fontSize="sm"
                                color="neutral.light.text-secondary"
                              >
                                {currentSearchIndex + 1}/{searchResults.length}
                              </Text>
                              <IconButton
                                aria-label="Previous result"
                                icon={<FiFilter />}
                                size="xs"
                                variant="ghost"
                                onClick={highlightPrevSearchResult}
                                colorScheme="brand"
                              />
                              <IconButton
                                aria-label="Next result"
                                icon={<FiFilter />}
                                size="xs"
                                variant="ghost"
                                onClick={highlightNextSearchResult}
                                colorScheme="brand"
                                transform="rotate(180deg)"
                              />
                            </>
                          )}
                          <IconButton
                            aria-label="Clear search"
                            icon={<FiX />}
                            size="xs"
                            variant="ghost"
                            onClick={() => setSearchTerm("")}
                          />
                        </HStack>
                      </InputRightElement>
                    )}
                  </InputGroup>
                  {searchTerm && (
                    <Flex justifyContent="space-between" mt={2}>
                      <Text fontSize="sm" color="neutral.light.text-secondary">
                        Found {filteredItems.length} of {countedItems.length}{" "}
                        items
                      </Text>
                      {searchResults.length > 0 && (
                        <Text fontSize="sm" color="brand.500">
                          Press Enter to find next
                        </Text>
                      )}
                    </Flex>
                  )}
                </Box>

                <Card
                  bg={cardBg}
                  shadow="md"
                  borderWidth="1px"
                  borderColor={borderColor}
                >
                  <CardBody p={{ base: 2, md: 4 }}>
                    {/* Desktop View: Table */}
                    <TableContainer
                      display={{ base: "none", md: "block" }}
                      maxH="400px"
                      overflowY="auto"
                      border="1px solid"
                      borderColor={borderColor}
                      borderRadius="md"
                    >
                      <Table variant="simple" size="sm">
                        <Thead
                          bg={tableHeaderBg}
                          position="sticky"
                          top={0}
                          zIndex={1}
                        >
                          <Tr>
                            <Th color={tableHeaderText}>Item</Th>
                            <Th color={tableHeaderText}>System Qty</Th>
                            <Th isNumeric color={tableHeaderText}>
                              Counted Qty
                            </Th>
                            <Th isNumeric color={tableHeaderText}>
                              Variance (Cost)
                            </Th>
                            {!isViewMode && (
                              <Th color={tableHeaderText}>Actions</Th>
                            )}
                          </Tr>
                        </Thead>
                        <Tbody>
                          {filteredItems.length > 0 ? (
                            filteredItems.map((item, index) => {
                              const isHighlighted =
                                searchResults.includes(
                                  countedItems.findIndex(
                                    (i) => i._key === item._key,
                                  ),
                                ) &&
                                searchResults[currentSearchIndex] ===
                                  countedItems.findIndex(
                                    (i) => i._key === item._key,
                                  );

                              return (
                                <Tr
                                  key={item._key}
                                  id={`item-${item._key}`}
                                  bg={
                                    isHighlighted
                                      ? "yellow.100"
                                      : item.hasMissingPrice
                                        ? "red.50"
                                        : "transparent"
                                  }
                                  _dark={{
                                    bg: isHighlighted
                                      ? "yellow.900"
                                      : item.hasMissingPrice
                                        ? "red.900"
                                        : "transparent",
                                  }}
                                  borderLeftWidth={
                                    item.hasMissingPrice ? "4px" : "0px"
                                  }
                                  borderLeftColor={
                                    item.hasMissingPrice
                                      ? "red.500"
                                      : "transparent"
                                  }
                                >
                                  <Td>
                                    <VStack align="start" spacing={1}>
                                      <HStack spacing={2}>
                                        <Text fontWeight="bold">
                                          {item.stockItem.name}
                                        </Text>
                                        {item.hasMissingPrice && (
                                          <Badge
                                            colorScheme="red"
                                            fontSize="xs"
                                          >
                                            No Price
                                          </Badge>
                                        )}
                                      </HStack>
                                      <Text
                                        fontSize="xs"
                                        color="neutral.light.text-secondary"
                                      >
                                        {item.stockItem.sku}
                                      </Text>
                                    </VStack>
                                  </Td>
                                  <Td>{item.systemQuantityAtCountTime}</Td>
                                  <Td>
                                    {isViewMode ? (
                                      <Text>{item.countedQuantity}</Text>
                                    ) : (
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={
                                          item.countedQuantity === 0
                                            ? ""
                                            : item.countedQuantity
                                        }
                                        onChange={(e) =>
                                          handleCountedQuantityChange(
                                            item._key!,
                                            e.target.value,
                                          )
                                        }
                                        placeholder="0"
                                        size="sm"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && searchTerm) {
                                            e.preventDefault();
                                            highlightNextSearchResult();
                                          }
                                        }}
                                        autoFocus={isHighlighted}
                                      />
                                    )}
                                  </Td>
                                  <Td isNumeric>
                                    <VStack align="flex-end" spacing={1}>
                                      <Badge
                                        colorScheme={
                                          item.variance === 0 ? "green" : "red"
                                        }
                                      >
                                        {item.variance?.toFixed(2) || 0}
                                      </Badge>
                                      <Text
                                        fontSize="xs"
                                        color={
                                          item.hasMissingPrice
                                            ? "red.500"
                                            : "neutral.light.text-secondary"
                                        }
                                        fontWeight={
                                          item.hasMissingPrice
                                            ? "bold"
                                            : "normal"
                                        }
                                      >
                                        {item.hasMissingPrice
                                          ? "E ?.?? (No price)"
                                          : item.varianceCost
                                            ? `E ${Math.abs(item.varianceCost).toFixed(2)}`
                                            : "E 0.00"}
                                      </Text>
                                    </VStack>
                                  </Td>
                                  {!isViewMode && (
                                    <Td>
                                      <IconButton
                                        aria-label="Remove item"
                                        icon={<FiTrash2 />}
                                        size="sm"
                                        variant="ghost"
                                        colorScheme="red"
                                        onClick={() =>
                                          handleRemoveItem(item._key!)
                                        }
                                      />
                                    </Td>
                                  )}
                                </Tr>
                              );
                            })
                          ) : (
                            <Tr>
                              <Td colSpan={5} textAlign="center" py={8}>
                                {searchTerm ? (
                                  <VStack spacing={2}>
                                    <Text>
                                      No items found for "{searchTerm}"
                                    </Text>
                                    <Button
                                      size="sm"
                                      onClick={() => setSearchTerm("")}
                                    >
                                      Clear Search
                                    </Button>
                                  </VStack>
                                ) : (
                                  <Text>No items added yet.</Text>
                                )}
                              </Td>
                            </Tr>
                          )}
                        </Tbody>
                      </Table>
                    </TableContainer>

                    {/* Mobile View: Card List */}
                    <VStack
                      display={{ base: "flex", md: "none" }}
                      spacing={4}
                      align="stretch"
                      maxH="400px"
                      overflowY="auto"
                      pr={2}
                    >
                      {filteredItems.length > 0 ? (
                        filteredItems.map((item) => {
                          const isHighlighted =
                            searchResults.includes(
                              countedItems.findIndex(
                                (i) => i._key === item._key,
                              ),
                            ) &&
                            searchResults[currentSearchIndex] ===
                              countedItems.findIndex(
                                (i) => i._key === item._key,
                              );

                          const hasMissingPrice =
                            !item.unitPrice || item.unitPrice === 0;

                          return (
                            <Card
                              key={item._key}
                              bg={
                                isHighlighted
                                  ? "yellow.100"
                                  : hasMissingPrice
                                    ? "red.50"
                                    : cardBg
                              }
                              _dark={{
                                bg: isHighlighted
                                  ? "yellow.900"
                                  : hasMissingPrice
                                    ? "red.900"
                                    : cardBg,
                              }}
                              variant="outline"
                              borderColor={
                                hasMissingPrice ? "red.500" : borderColor
                              }
                              borderLeftWidth={hasMissingPrice ? "4px" : "0px"}
                              id={`item-${item._key}`}
                            >
                              <CardBody p={4}>
                                <VStack align="stretch" spacing={2}>
                                  <HStack justifyContent="space-between">
                                    <VStack align="start" spacing={0}>
                                      <HStack spacing={2}>
                                        <Text fontWeight="bold">
                                          {item.stockItem.name}
                                        </Text>
                                        {hasMissingPrice && (
                                          <Badge
                                            colorScheme="red"
                                            fontSize="xs"
                                          >
                                            No Price
                                          </Badge>
                                        )}
                                      </HStack>
                                      <Text fontSize="sm" color="gray.500">
                                        {item.stockItem.sku}
                                      </Text>
                                    </VStack>
                                    {!isViewMode && (
                                      <IconButton
                                        aria-label="Remove item"
                                        icon={<FiTrash2 />}
                                        size="sm"
                                        variant="ghost"
                                        colorScheme="red"
                                        onClick={() =>
                                          handleRemoveItem(item._key!)
                                        }
                                      />
                                    )}
                                  </HStack>
                                  <Divider />
                                  <HStack justifyContent="space-between" pt={2}>
                                    <Text fontSize="sm" fontWeight="medium">
                                      System Qty:
                                    </Text>
                                    <Text fontSize="sm">
                                      {item.systemQuantityAtCountTime}
                                    </Text>
                                  </HStack>
                                  <HStack justifyContent="space-between">
                                    <Text fontSize="sm" fontWeight="medium">
                                      Counted Qty:
                                    </Text>
                                    <Box w="100px">
                                      <Input
                                        value={
                                          item.countedQuantity === 0
                                            ? ""
                                            : item.countedQuantity
                                        }
                                        onChange={(e) =>
                                          handleCountedQuantityChange(
                                            item._key!,
                                            e.target.value,
                                          )
                                        }
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        isDisabled={isViewMode}
                                        placeholder="0"
                                        width="100px"
                                        size="sm"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && searchTerm) {
                                            e.preventDefault();
                                            highlightNextSearchResult();
                                          }
                                        }}
                                        autoFocus={isHighlighted}
                                      />
                                    </Box>
                                  </HStack>
                                  <HStack justifyContent="space-between">
                                    <Text fontSize="sm" fontWeight="medium">
                                      Variance:
                                    </Text>
                                    <VStack align="flex-end" spacing={0}>
                                      <Badge
                                        colorScheme={
                                          item.variance === 0 ? "green" : "red"
                                        }
                                      >
                                        {item.variance?.toFixed(2) || 0}
                                      </Badge>
                                      <Text fontSize="xs" color="gray.500">
                                        {item.varianceCost
                                          ? `E ${Math.abs(item.varianceCost).toFixed(2)}`
                                          : "E 0.00"}
                                      </Text>
                                    </VStack>
                                  </HStack>
                                </VStack>
                              </CardBody>
                            </Card>
                          );
                        })
                      ) : (
                        <Text
                          textAlign="center"
                          color="neutral.light.text-secondary"
                          py={4}
                        >
                          {searchTerm
                            ? `No items found for "${searchTerm}"`
                            : "No items added yet."}
                        </Text>
                      )}
                    </VStack>
                  </CardBody>
                </Card>
              </Box>

              {!isViewMode && (
                <HStack
                  w="100%"
                  justifyContent="space-between"
                  mt={4}
                  flexDirection={{ base: "column", md: "row" }}
                  spacing={{ base: 4, md: 0 }}
                >
                  <HStack spacing={2}>
                    <Button
                      leftIcon={<FiPlus />}
                      onClick={() => {
                        if (!selectedBin) {
                          toast({
                            title: "Bin Required",
                            description:
                              "Please select a bin before adding items.",
                            status: "warning",
                            duration: 3000,
                            isClosable: true,
                          });
                          return;
                        }
                        setIsStockItemModalOpen(true);
                      }}
                      isDisabled={isViewMode}
                      colorScheme="brand"
                    >
                      Add Item
                    </Button>

                    <Button
                      leftIcon={<FiRefreshCw />}
                      onClick={refreshSystemQuantities}
                      variant="outline"
                      colorScheme="blue"
                      isLoading={loading}
                      isDisabled={
                        !selectedBin || countedItems.length === 0 || isViewMode
                      }
                      size="sm"
                    >
                      Refresh System Qty
                    </Button>
                  </HStack>

                  <VStack align="flex-end" spacing={1}>
                    <Text fontWeight="bold">
                      Total Variance (Qty):{" "}
                      <Badge
                        colorScheme={totalVariance !== 0 ? "red" : "green"}
                      >
                        {totalVariance.toFixed(2)}
                      </Badge>
                    </Text>
                    <Text fontWeight="bold">
                      Total Variance (Cost):{" "}
                      <Badge
                        colorScheme={
                          totalVarianceCost !== 0
                            ? totalVarianceCost > 0
                              ? "orange"
                              : "green"
                            : "gray"
                        }
                      >
                        E{" "}
                        {totalVarianceCost > 0
                          ? " (Over)"
                          : totalVarianceCost < 0
                            ? " (Under)"
                            : ""}
                      </Badge>
                    </Text>
                  </VStack>
                </HStack>
              )}
            </VStack>
          </ModalBody>

          <ModalFooter borderTopWidth="1px" borderColor={borderColor} pt={4}>
            <Button
              colorScheme="gray"
              mr={3}
              onClick={onClose}
              isDisabled={loading || isProcessing}
            >
              Cancel
            </Button>
            {!isViewMode && (
              <HStack spacing={3} flexWrap="wrap">
                {binCount &&
                  binCount.countedItems.some(
                    (item: any) => !item.stockItem,
                  ) && (
                    <Button
                      colorScheme="orange"
                      onClick={() => fixBrokenBinCount(binCount._id)}
                      isLoading={isProcessing}
                      leftIcon={<FiCheck />}
                    >
                      Fix Broken Count
                    </Button>
                  )}
                <Button
                  colorScheme="brand"
                  variant="outline"
                  onClick={() => handleSave(false)}
                  isLoading={loading || isProcessing}
                  leftIcon={<FiSave />}
                >
                  Save Draft
                </Button>
                <Button
                  colorScheme="green"
                  onClick={() => handleSave(true)}
                  isLoading={loading || isProcessing}
                  isDisabled={countedItems.length === 0}
                  leftIcon={<FiCheck />}
                >
                  Finalize Count
                </Button>
              </HStack>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <BinSelectorModal
        isOpen={isBinModalOpen}
        onClose={() => setIsBinModalOpen(false)}
        onSelect={handleBinSelect}
      />

      <StockItemSelectorModal
        isOpen={isStockItemModalOpen}
        onClose={() => setIsStockItemModalOpen(false)}
        onSelect={handleStockItemsSelect}
        existingItemIds={countedItemIds}
      />
    </>
  );
}
