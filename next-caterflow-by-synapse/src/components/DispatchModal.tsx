// src/components/DispatchModal.tsx (REPLACE ENTIRE FILE)
"use client";
import { logger } from '@/lib/logger';

import React, { useState, useEffect } from "react";
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
  Select,
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
  Spinner,
  Grid,
  GridItem,
  Textarea,
  Divider,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  useColorModeValue,
  Icon,
  Image,
  SimpleGrid,
  Badge,
  Heading,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Tag,
  TagLabel,
  TagCloseButton,
} from "@chakra-ui/react";
import {
  FiFileText,
  FiPlus,
  FiTrash2,
  FiChevronUp,
  FiChevronDown,
  FiPackage,
  FiAlertTriangle,
  FiCheck,
  FiRefreshCw,
} from "react-icons/fi";
import StockItemSelectorModal from "./StockItemSelectorModal";
import FileUploadModal from "./FileUploadModal";
import { nanoid } from "nanoid";
import { useSession } from "next-auth/react";

import { urlFor } from "@/lib/sanity";

interface DispatchedItem {
  _key: string;
  stockItem: {
    _id: string;
    name: string;
    sku?: string;
    unitOfMeasure?: string;
    currentStock?: number;
    unitPrice?: number;
  };
  sourceBin?: {
    _id: string;
    name: string;
    site: Site;
  };
  dispatchedQuantity: number;
  unitPrice?: number;
  totalCost?: number;
  notes?: string;
}

interface Site {
  _id: string;
  name: string;
}

interface Bin {
  _id: string;
  name: string;
  site: Site;
  binType: string;
}

interface DispatchType {
  _id: string;
  name: string;
  description?: string;
  defaultTime: string;
  sellingPrice: number;
  sitePrices?: Array<{
    _key: string;
    site: Site;
    price: number;
  }>;
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  associatedSite?: Site;
}

interface Dispatch {
  _id: string;
  dispatchNumber: string;
  dispatchDate: string;
  notes?: string;
  dispatchType: {
    _id: string;
    name: string;
    sellingPrice: number;
    sitePrices?: Array<{
      _key: string;
      site: Site;
      price: number;
    }>;
  };
  sourceSite: Site;
  dispatchedItems: DispatchedItem[];
  dispatchedBy: User;
  peopleFed?: number;
  evidenceStatus?: "pending" | "partial" | "complete";
  status?: string;
  attachments?: {
    _id: string;
    fileName?: string;
    fileType?: string;
    description?: string;
    uploadedAt?: string;
    file?: {
      asset?: {
        _id: string;
        _type: string;
        url?: string;
        originalFilename?: string;
        mimeType?: string;
      };
    };
  }[];
  sellingPrice?: number;
  totalSales?: number;
}

interface DispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  dispatch?: Dispatch | null;
  onSave: () => void;
  onToggleEvidence?: (dispatchId: string) => void;
  isEvidenceExpanded?: boolean;
}

export default function DispatchModal({
  isOpen,
  onClose,
  dispatch,
  onSave,
  onToggleEvidence,
  isEvidenceExpanded,
}: DispatchModalProps) {
  const [loading, setLoading] = useState(false);
  const [dispatchTypes, setDispatchTypes] = useState<DispatchType[]>([]);
  const [allBins, setAllBins] = useState<Bin[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [sourceSite, setSourceSite] = useState<Site | null>(null);
  const [selectedBins, setSelectedBins] = useState<Bin[]>([]);
  const [dispatchDate, setDispatchDate] = useState("");
  const [dispatchType, setDispatchType] = useState("");
  const [dispatchedItems, setDispatchedItems] = useState<DispatchedItem[]>([]);
  const [notes, setNotes] = useState("");
  const [peopleFed, setPeopleFed] = useState<number | undefined>(undefined);
  const [isStockItemModalOpen, setIsStockItemModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedBinForItems, setSelectedBinForItems] = useState<Bin | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState(0);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [savedDispatchId, setSavedDispatchId] = useState<string>("");
  const [selectedDispatchType, setSelectedDispatchType] =
    useState<DispatchType | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const toast = useToast();
  const { data: session, status: sessionStatus } = useSession();
  const user = session?.user as unknown as User;
  const userSite = user?.associatedSite;
  const userRole = user?.role;

  const [isCheckingStock, setIsCheckingStock] = useState(false);
  const [stockValidation, setStockValidation] = useState<{
    isValid: boolean;
    overDispatchingItems: Array<{
      itemName: string;
      binName: string;
      requested: number;
      available: number;
      difference: number;
    }>;
    warnings: string[];
    lastChecked: Date | null;
  }>({
    isValid: true,
    overDispatchingItems: [],
    warnings: [],
    lastChecked: null,
  });

  const [availableStock, setAvailableStock] = useState<Record<string, number>>(
    {},
  );
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  const tableHeaderColor = useColorModeValue(
    "neutral.light.text-primary",
    "neutral.dark.text-primary",
  );
  const tableBorderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const tableBg = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const textSecondaryColor = useColorModeValue(
    "neutral.light.text-secondary",
    "neutral.dark.text-secondary",
  );
  const tableBoxShadow = useColorModeValue("md", "dark-md");

  const evidenceButtonBg = useColorModeValue("gray.50", "gray.700");
  const evidenceButtonHoverBg = useColorModeValue("gray.100", "gray.600");
  const evidenceSectionBg = useColorModeValue("gray.50", "gray.800");
  const evidenceCardBg = useColorModeValue("white", "gray.700");
  const fallbackBg = useColorModeValue("gray.100", "gray.600");
  const errorBg = useColorModeValue("red.50", "red.700");

  const existingItemIds = dispatchedItems
    .filter(
      (item) =>
        item.stockItem && item.sourceBin?._id === selectedBinForItems?._id,
    )
    .map((item) => item.stockItem._id);

  // Safe number conversion helper function with 3 decimal place support
  const safeNumber = (value: string | number): number => {
    if (typeof value === "number") {
      return isNaN(value) ? 0 : parseFloat(value.toFixed(3));
    }
    const num = parseFloat(value);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(3));
  };

  // Safe number input handler with 3 decimal place support
  const handleNumberInput = (value: string): number => {
    if (value === "" || value === "-") return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(3));
  };

  // Load dispatch types, bins, and sites when modal opens
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [dispatchTypesRes, binsRes, sitesRes] = await Promise.all([
          fetch("/api/dispatch-types"),
          fetch("/api/bins"),
          fetch("/api/sites"),
        ]);

        if (!dispatchTypesRes.ok)
          throw new Error("Failed to fetch dispatch types");
        if (!binsRes.ok) throw new Error("Failed to fetch bins");
        if (!sitesRes.ok) throw new Error("Failed to fetch sites");

        const dispatchTypesData = await dispatchTypesRes.json();
        const binsData = await binsRes.json();
        const sitesData = await sitesRes.json();

        setDispatchTypes(dispatchTypesData);
        setAllBins(binsData);
        setSites(sitesData);

        // Set selected dispatch type if editing
        if (dispatch?.dispatchType?._id) {
          const currentType = dispatchTypesData.find(
            (type: DispatchType) => type._id === dispatch.dispatchType._id,
          );
          setSelectedDispatchType(currentType || null);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast({
          title: "Error fetching data.",
          description: "Please try again later.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      fetchData();
    }
  }, [isOpen, toast, dispatch?.dispatchType?._id]);

  // Initialize form from dispatch prop (edit) or defaults (new)
  useEffect(() => {
    if (dispatch) {
      setDispatchDate(
        dispatch.dispatchDate ? dispatch.dispatchDate.split("T")[0] : "",
      );
      setDispatchType(dispatch.dispatchType?._id || "");
      setSourceSite(dispatch.sourceSite || null);
      setDispatchedItems(dispatch.dispatchedItems || []);
      setNotes(dispatch.notes || "");
      setPeopleFed(dispatch.peopleFed);
      setSavedDispatchId(dispatch._id || "");

      // Extract unique bins from dispatched items
      const binsFromItems = dispatch.dispatchedItems
        .filter((item) => item.sourceBin)
        .map((item) => item.sourceBin)
        .filter(
          (bin, index, self) =>
            index === self.findIndex((b) => b?._id === bin?._id),
        )
        .filter(Boolean) as Bin[];
      setSelectedBins(binsFromItems);
    } else {
      const today = new Date().toISOString().split("T")[0];
      setDispatchDate(today);
      setDispatchType("");
      setSourceSite(null);
      setSelectedBins([]);
      setDispatchedItems([]);
      setNotes("");
      setPeopleFed(undefined);
      setEditingIndex(null);
      setSavedDispatchId("");
    }
  }, [dispatch, isOpen]);

  // Set default site for new dispatches
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const fetchDefaultSite = async () => {
      if (
        !dispatch &&
        sessionStatus === "authenticated" &&
        user?.associatedSite?._id
      ) {
        setLoading(true);
        try {
          const siteId = user.associatedSite._id;
          const site = sites.find((s) => s._id === siteId);
          if (site && mounted) {
            setSourceSite(site);
          }
        } catch (error: any) {
          if (error.name === "AbortError") return;
          logger.debug("Error setting default site:", error);
        } finally {
          if (mounted) setLoading(false);
        }
      }
    };

    if (sites.length > 0) {
      fetchDefaultSite();
    }

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [dispatch, sessionStatus, user?.associatedSite?._id, sites, toast]);

  const isNew = !dispatch || dispatch._id?.startsWith?.("temp-");
  const isEditable = !(
    dispatch?.evidenceStatus === "complete" || dispatch?.status === "completed"
  );

  // Add this useEffect after other useEffects (around line 150-200)
  useEffect(() => {
    // Only validate if we have items and are editing
    if (dispatchedItems.length > 0 && isEditable && !loading) {
      // Debounce the validation
      const timer = setTimeout(() => {
        validateStock();
      }, 1000); // Wait 1 second after changes

      return () => clearTimeout(timer);
    }
  }, [dispatchedItems, sourceSite?._id, isEditable, loading]);
  // Note: We're adding sourceSite dependency because stock depends on bin availability per site

  // Add this useEffect after other useEffects (around line 150-200)
  useEffect(() => {
    if (
      dispatchedItems.length > 0 &&
      sourceSite?._id &&
      isEditable &&
      !loading
    ) {
      // Debounce the stock fetch
      const timer = setTimeout(() => {
        fetchAvailableStock(dispatchedItems);
      }, 500); // Wait 500ms after changes

      return () => clearTimeout(timer);
    } else {
      setAvailableStock({});
    }
  }, [dispatchedItems, sourceSite?._id, isEditable, loading]);

  // Helper to get available stock for an item
  const getAvailableStock = (itemKey: string): number | undefined => {
    return availableStock[itemKey];
  };

  // Helper to check if item is over-dispatching
  const isOverDispatching = (item: DispatchedItem): boolean => {
    const available = getAvailableStock(item._key);
    if (available === undefined) return true;
    return (item.dispatchedQuantity || 0) > available;
  };

  // Handler for dispatch type change
  const handleDispatchTypeChange = (typeId: string) => {
    setDispatchType(typeId);
    const selectedType = dispatchTypes.find((type) => type._id === typeId);
    setSelectedDispatchType(selectedType || null);
  };

  // Handler for site change
  const handleSiteChange = (siteId: string) => {
    const selectedSite = sites.find((site) => site._id === siteId);
    setSourceSite(selectedSite || null);
    setSelectedBins([]);
    setDispatchedItems([]);
    setSelectedBinForItems(null);
  };

  // Update the getSellingPrice function:
  const getSellingPrice = (): number => {
    if (!selectedDispatchType || !sourceSite) return 0;

    // Check for site-specific price
    const sitePrice = selectedDispatchType.sitePrices?.find(
      (sp) => sp.site._id === sourceSite._id,
    );

    return sitePrice ? sitePrice.price : selectedDispatchType.sellingPrice;
  };

  // Calculate total sales
  const calculateTotalSales = (): number => {
    const sellingPrice = getSellingPrice();
    if (!peopleFed || sellingPrice === 0) return 0;
    return peopleFed * sellingPrice;
  };

  // Stock item selection - updated to include sourceBin
  const handleStockItemSelect = (items: any[]) => {
    if (!selectedBinForItems) {
      toast({
        title: "Error",
        description: "No bin selected for adding items.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const newItems: DispatchedItem[] = items.map((item) => {
      const unitPrice = safeNumber(item.unitPrice || 0);

      // Check if this exact combination (item + bin) already exists
      const existingItemIndex = dispatchedItems.findIndex(
        (existing) =>
          existing.stockItem._id === item._id &&
          existing.sourceBin?._id === selectedBinForItems._id,
      );

      // If editing the exact same item+bin combo
      if (editingIndex !== null && existingItemIndex === editingIndex) {
        const existingItem = dispatchedItems[editingIndex];
        return {
          ...existingItem,
          stockItem: {
            ...existingItem.stockItem,
            currentStock: item.currentStock || 0, // Update stock info
          },
          unitPrice: unitPrice,
          totalCost: unitPrice * existingItem.dispatchedQuantity,
        };
      }

      // Create new item
      return {
        _key: nanoid(),
        stockItem: {
          _id: item._id,
          name: item.name,
          sku: item.sku,
          unitOfMeasure: item.unitMeasure || item.unitOfMeasure,
          currentStock: item.currentStock || 0,
          unitPrice: unitPrice,
        },
        sourceBin: {
          _id: selectedBinForItems._id,
          name: selectedBinForItems.name,
          site: selectedBinForItems.site,
        },
        dispatchedQuantity: 1,
        unitPrice: unitPrice,
        totalCost: unitPrice * 1,
        notes: "",
      };
    });

    // Track toast messages to show after state update
    const toastMessages: Array<{
      title: string;
      description: string;
      status: "info" | "warning" | "success";
    }> = [];

    setDispatchedItems((prevItems) => {
      let updatedItems = [...prevItems];

      if (editingIndex !== null) {
        // Replace the item at editingIndex
        updatedItems[editingIndex] = newItems[0];
        setEditingIndex(null);

        // Queue toast message
        toastMessages.push({
          title: "Item updated",
          description: `Updated "${newItems[0].stockItem.name}"`,
          status: "success",
        });
      } else {
        // Add new items - allow same item from different bins
        newItems.forEach((newItem) => {
          // Check if this exact combination already exists
          const exists = updatedItems.some(
            (existing) =>
              existing.stockItem._id === newItem.stockItem._id &&
              existing.sourceBin?._id === newItem.sourceBin?._id,
          );

          if (!exists) {
            updatedItems.push(newItem);

            // Check if same item exists in different bin
            const sameItemDifferentBin = prevItems.some(
              (existing) =>
                existing.stockItem._id === newItem.stockItem._id &&
                existing.sourceBin?._id !== newItem.sourceBin?._id,
            );

            if (sameItemDifferentBin) {
              // Queue toast message
              toastMessages.push({
                title: "Item added from different bin",
                description: `"${newItem.stockItem.name}" added from ${newItem.sourceBin?.name}`,
                status: "info",
              });
            }
          } else {
            // Queue toast message
            toastMessages.push({
              title: "Item already in dispatch",
              description: `"${newItem.stockItem.name}" is already selected from ${newItem.sourceBin?.name}`,
              status: "warning",
            });
          }
        });
      }
      return updatedItems;
    });

    // Add bin to selected bins if not already there
    if (!selectedBins.find((bin) => bin._id === selectedBinForItems._id)) {
      setSelectedBins((prev) => [...prev, selectedBinForItems]);
    }

    setIsStockItemModalOpen(false);
    setSelectedBinForItems(null);

    // Show toast messages after state updates
    if (toastMessages.length > 0) {
      // Use setTimeout to ensure toast is called after render cycle
      setTimeout(() => {
        toastMessages.forEach((msg) => {
          toast({
            title: msg.title,
            description: msg.description,
            status: msg.status,
            duration: 2000,
            isClosable: true,
          });
        });
      }, 0);
    }

    if (items.length > 1 && editingIndex === null) {
      setTimeout(() => {
        toast({
          title: "Items added",
          description: `${items.length} items added to dispatch`,
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      }, 0);
    } else if (items.length === 1 && editingIndex === null) {
      const wasNewItem = !dispatchedItems.some(
        (existing) =>
          existing.stockItem._id === items[0]._id &&
          existing.sourceBin?._id === selectedBinForItems._id,
      );

      if (wasNewItem) {
        setTimeout(() => {
          toast({
            title: "Item added",
            description: `"${items[0].name}" added to dispatch`,
            status: "success",
            duration: 2000,
            isClosable: true,
          });
        }, 0);
      }
    }
  };

  const handleUnitPriceChange = (key: string, value: string) => {
    const currentItem = dispatchedItems.find((item) => item._key === key);
    const currentValue = currentItem?.unitPrice || 0;

    if (
      currentValue === 0 &&
      value !== "0" &&
      value !== "" &&
      !value.includes(".")
    ) {
      const valueAsNumber = handleNumberInput(value);
      setDispatchedItems((prevItems) =>
        prevItems.map((item) => {
          if (item._key === key) {
            const unitPrice = valueAsNumber;
            const totalCost = unitPrice * (item.dispatchedQuantity || 0);
            return {
              ...item,
              unitPrice,
              totalCost,
            };
          }
          return item;
        }),
      );
    } else {
      const valueAsNumber = handleNumberInput(value);
      setDispatchedItems((prevItems) =>
        prevItems.map((item) => {
          if (item._key === key) {
            const unitPrice = valueAsNumber;
            const totalCost = unitPrice * (item.dispatchedQuantity || 0);
            return {
              ...item,
              unitPrice,
              totalCost,
            };
          }
          return item;
        }),
      );
    }
  };

  const handleQuantityChange = (key: string, value: string) => {
    if (value === "" || value === "-") {
      setDispatchedItems((prevItems) =>
        prevItems.map((item) => {
          if (item._key === key) {
            const unitPrice = item.unitPrice || 0;
            return {
              ...item,
              dispatchedQuantity: 0,
              totalCost: 0,
            };
          }
          return item;
        }),
      );
      return;
    }

    const decimalParts = value.split(".");
    if (decimalParts.length === 2 && decimalParts[1].length > 3) {
      value = decimalParts[0] + "." + decimalParts[1].slice(0, 3);
    }

    const valueAsNumber = parseFloat(value);

    if (!isNaN(valueAsNumber) && valueAsNumber >= 0) {
      setDispatchedItems((prevItems) =>
        prevItems.map((item) => {
          if (item._key === key) {
            const unitPrice = item.unitPrice || 0;
            const totalCost = unitPrice * valueAsNumber;
            return {
              ...item,
              dispatchedQuantity: valueAsNumber,
              totalCost: parseFloat(totalCost.toFixed(2)),
            };
          }
          return item;
        }),
      );
    }
  };

  const handlePeopleFedChange = (valueAsString: string) => {
    const valueAsNumber = handleNumberInput(valueAsString);
    setPeopleFed(valueAsNumber);
  };

  const calculateGrandTotal = (): number => {
    return dispatchedItems.reduce((total, item) => {
      return total + (item.totalCost || 0);
    }, 0);
  };

  const calculateCostPerPerson = (): number => {
    const grandTotal = calculateGrandTotal();
    return peopleFed && peopleFed > 0 ? grandTotal / peopleFed : 0;
  };

  const handleRemoveItem = (key: string) => {
    const itemToRemove = dispatchedItems.find((item) => item._key === key);
    setDispatchedItems((prevItems) =>
      prevItems.filter((item) => item._key !== key),
    );

    // Check if we need to remove the bin from selected bins
    if (itemToRemove?.sourceBin) {
      const itemsFromSameBin = dispatchedItems.filter(
        (item) =>
          item.sourceBin?._id === itemToRemove.sourceBin?._id &&
          item._key !== key,
      );
      if (itemsFromSameBin.length === 0) {
        setSelectedBins((prev) =>
          prev.filter((bin) => bin._id !== itemToRemove.sourceBin?._id),
        );
      }
    }
  };

  const handleRemoveBin = (binId: string) => {
    // Remove all items from this bin
    setDispatchedItems((prev) =>
      prev.filter((item) => item.sourceBin?._id !== binId),
    );
    setSelectedBins((prev) => prev.filter((bin) => bin._id !== binId));
  };

  const handleNotesChange = (key: string, value: string) => {
    setDispatchedItems((prevItems) =>
      prevItems.map((item) =>
        item._key === key ? { ...item, notes: value } : item,
      ),
    );
  };

  /*const handleEditItem = (index: number) => {
        const item = dispatchedItems[index];
        if (item.sourceBin) {
            setSelectedBinForItems(item.sourceBin);
        }
        setEditingIndex(index);
        setIsStockItemModalOpen(true);
    };*/

  const isSubmitDisabled =
    !dispatchDate ||
    !dispatchType ||
    !sourceSite ||
    dispatchedItems.length === 0 ||
    !isEditable;

  // Save dispatch (create or update)
  const saveDispatch = async (status: string = "draft") => {
    setIsSaving(true);
    try {
      if (!dispatchType || !sourceSite) {
        toast({
          title: "Missing Information",
          description: "Please select a dispatch type and source site.",
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        throw new Error("Missing dispatch type or source site");
      }

      const sellingPrice = getSellingPrice();
      const totalSales = calculateTotalSales();

      const payload: any = {
        dispatchDate: new Date(dispatchDate).toISOString(),
        dispatchType: { _type: "reference", _ref: dispatchType },
        sourceSite: { _type: "reference", _ref: sourceSite._id },
        dispatchedItems: dispatchedItems.map((item) => ({
          _type: "DispatchedItem",
          _key: item._key || nanoid(),
          stockItem: {
            _type: "reference",
            _ref: item.stockItem._id,
          },
          sourceBin: item.sourceBin
            ? {
                _type: "reference",
                _ref: item.sourceBin._id,
              }
            : undefined,
          dispatchedQuantity: safeNumber(item.dispatchedQuantity),
          unitPrice: safeNumber(item.unitPrice || 0),
          totalCost: safeNumber(item.totalCost || 0),
          notes: item.notes || "",
        })),
        notes,
        peopleFed: safeNumber(peopleFed || 0),
        evidenceStatus: dispatch?.evidenceStatus || "pending",
        status,
        dispatchedBy: {
          _type: "reference",
          _ref:
            (session?.user as any)?.id ||
            (session?.user as any)?._id ||
            undefined,
        },
        sellingPrice,
        totalSales,
      };

      let url = "/api/dispatches";
      let method: "POST" | "PATCH" = "POST";

      if (!isNew && dispatch?._id) {
        url = `/api/dispatches/${dispatch._id}`;
        method = "PATCH";
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save dispatch");
      }

      const result = await res.json();
      const id = result._id || result.id || dispatch?._id;
      setSavedDispatchId(id);

      toast({
        title: status === "draft" ? "Draft saved" : "Dispatch saved",
        status: "success",
        duration: 2500,
        isClosable: true,
      });

      return result;
    } catch (error: any) {
      console.error("Save dispatch error:", error);
      toast({
        title: "Error saving dispatch",
        description: error?.message || "An error occurred",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  // Submit handler for the form (create/update without completing)
  // Submit handler for the form (create/update without completing)
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Validate stock before saving
    setIsCheckingStock(true);
    try {
      const isValid = await validateStock();
      if (!isValid) {
        toast({
          title: "Cannot Save - Stock Insufficient",
          description:
            "Some items exceed available stock. Please adjust quantities.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      const result = await saveDispatch("draft");
      setSavedDispatchId(result._id || result.id);
      onSave();
      onClose();
    } catch {
      // saveDispatch already shows toast
    } finally {
      setIsCheckingStock(false);
    }
  };

  // Check all items dispatched
  const isFullyDispatched =
    dispatchedItems.length > 0 &&
    dispatchedItems.every((item) => item.dispatchedQuantity > 0) &&
    (peopleFed || 0) > 0;

  // Trigger the complete flow: ensure saved, then open upload modal
  // Trigger the complete flow: ensure saved, then open upload modal
  const handleCompleteDispatch = async () => {
    if (!isFullyDispatched) {
      toast({
        title: "Incomplete dispatch",
        description:
          "You must set dispatched quantities for all items before completing.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    if (!peopleFed || peopleFed <= 0) {
      toast({
        title: "People fed required",
        description:
          "You must specify how many people were fed before completing the dispatch.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    // Validate stock before completing
    setIsCheckingStock(true);
    try {
      const isValid = await validateStock();
      if (!isValid) {
        toast({
          title: "Cannot Complete - Stock Insufficient",
          description:
            "Some items exceed available stock. Please adjust quantities.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      setIsSaving(true);
      if (isNew || !dispatch?._id) {
        const saved = await saveDispatch("draft");
        const id = saved._id || saved.id;
        setSavedDispatchId(id);
      } else {
        setSavedDispatchId(dispatch._id);
      }

      setIsUploadModalOpen(true);
    } catch (err) {
      // errors handled in saveDispatch
    } finally {
      setIsCheckingStock(false);
      setIsSaving(false);
    }
  };

  // Called by FileUploadModal when upload completes
  const handleFinalizeDispatch = async (attachmentIds: string[]) => {
    setIsUploadModalOpen(false);
    setIsSaving(true);

    try {
      const idToUse = savedDispatchId || dispatch?._id;
      if (!idToUse) throw new Error("No dispatch ID available to finalize");

      if (attachmentIds.length === 0) {
        throw new Error("No attachments uploaded");
      }

      const body: any = {
        evidenceStatus: "complete",
        status: "completed",
        completedAt: new Date().toISOString(),
        attachments: attachmentIds.map((id) => ({
          _type: "reference",
          _ref: id,
        })),
      };

      const res = await fetch(`/api/dispatches/${idToUse}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to finalize dispatch");
      }

      toast({
        title: "Dispatch completed",
        description: `Evidence uploaded (${attachmentIds.length} files) and dispatch marked as complete.`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });

      onSave();
      onClose();
    } catch (error: any) {
      console.error("Finalize error:", error);
      toast({
        title: "Error finalizing dispatch",
        description: error?.message || "Failed to finalize dispatch",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter bins by selected site
  const binsForSelectedSite = sourceSite
    ? allBins.filter((bin) => bin.site._id === sourceSite._id)
    : [];

  // Group dispatched items by bin for UI display
  const itemsByBin: Record<string, DispatchedItem[]> = {};
  dispatchedItems.forEach((item) => {
    const binId = item.sourceBin?._id || "unspecified";
    if (!itemsByBin[binId]) {
      itemsByBin[binId] = [];
    }
    itemsByBin[binId].push(item);
  });

  // Get bin name by ID
  const getBinName = (binId: string): string => {
    if (binId === "unspecified") return "Unassigned Bin";
    const bin = binsForSelectedSite.find((b) => b._id === binId);
    return bin ? bin.name : "Unknown Bin";
  };

  // Get bin by ID
  const getBin = (binId: string): Bin | null => {
    if (binId === "unspecified") return null;
    return binsForSelectedSite.find((b) => b._id === binId) || null;
  };

  const exportDispatchPDF = () => {
    if (isExporting) return;

    setIsExporting(true);
    try {
      const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Dispatch - ${dispatch?.dispatchNumber || "New Dispatch"}</title>
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
            .info-section { 
                margin-bottom: 30px;
                background: #FFFFFF;
                padding: 20px;
                border-radius: 12px;
                border: 1px solid #E2E8F0;
            }
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
            }
            .info-item {
                margin-bottom: 10px;
            }
            .info-label {
                font-weight: 600;
                color: #4A5568;
                font-size: 14px;
            }
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
            .summary-section {
                background: #F0FFF4;
                border: 1px solid #9AE6B4;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
            }
            .footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #E2E8F0;
                font-size: 12px;
                color: #718096;
                text-align: center;
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
                <h1>DISPATCH RECORD</h1>
                <p style="font-size: 16px; margin: 5px 0;">Dispatch Number: <strong>${dispatch?.dispatchNumber || "New"}</strong></p>
                <p style="font-size: 14px; margin: 5px 0;">Date: ${new Date(dispatchDate).toLocaleDateString()}</p>
            </div>
        </div>
    
        <div class="info-section">
            <div class="info-grid">
                <div>
                    <div class="info-item">
                        <span class="info-label">Dispatch Type:</span>
                        <span> ${dispatchTypes.find((t) => t._id === dispatchType)?.name || "N/A"}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Source Site:</span>
                        <span> ${sourceSite?.name || "N/A"}</span>
                    </div>
                </div>
                <div>
                    <div class="info-item">
                        <span class="info-label">People Fed:</span>
                        <span> ${peopleFed || "N/A"}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Dispatched By:</span>
                        <span> ${user?.name || "Current User"}</span>
                    </div>
                </div>
            </div>
        </div>
    
        ${Object.entries(itemsByBin)
          .map(
            ([binId, items]) => `
            <h3 style="margin: 20px 0 10px 0; color: #2D3748;">Items from ${getBinName(binId)}</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th>Unit Price</th>
                        <th>Total Cost</th>
                        <th>Unit</th>
                    </tr>
                </thead>
                <tbody>
                    ${items
                      .map(
                        (item) => `
                        <tr>
                            <td><strong>${item.stockItem.name}</strong></td>
                            <td>${item.dispatchedQuantity.toFixed(3)}</td>
                            <td>E ${(item.unitPrice || 0).toFixed(2)}</td>
                            <td>E ${(item.totalCost || 0).toFixed(2)}</td>
                            <td>${item.stockItem.unitOfMeasure}</td>
                        </tr>
                    `,
                      )
                      .join("")}
                </tbody>
            </table>
        `,
          )
          .join("")}
    
        <div class="summary-section">
            <h3 style="margin: 0 0 15px 0; color: #22543D;">Cost Summary</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <strong>Grand Total Cost:</strong>
                </div>
                <div>
                    <strong>E ${calculateGrandTotal().toFixed(2)}</strong>
                </div>
                ${
                  peopleFed && peopleFed > 0
                    ? `
                    <div>Cost per Person:</div>
                    <div>E ${calculateCostPerPerson().toFixed(2)}</div>
                    <div>People Fed:</div>
                    <div>${peopleFed}</div>
                    <div>Selling Price per Person:</div>
                    <div>E ${getSellingPrice().toFixed(2)}</div>
                    <div>Total Sales:</div>
                    <div>E ${calculateTotalSales().toFixed(2)}</div>
                `
                    : ""
                }
            </div>
        </div>
    
        ${
          notes
            ? `
            <div class="info-section">
                <h3 style="margin: 0 0 12px 0; color: #2D3748; font-size: 16px;">Notes:</h3>
                <p style="margin: 0; color: #4A5568; line-height: 1.5;">${notes}</p>
            </div>
        `
            : ""
        }
    
        <div class="footer">
        <p style="margin: 0 0 8px 0;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        <p style="margin: 0 0 8px 0;">This is a system-generated purchase order. Please provide your quotation for the requested items.</p>
        <div class="caterflow-brand">
            <a href="https://synapse-digital.vercel.app/" target="_blank" style="color: #0067FF; text-decoration: none; cursor: pointer;">
                Caterflow by Synapse
            </a>
        </div>
    </div>
    
        <div class="no-print" style="text-align: center; margin-top: 20px;">
            <button onclick="window.print()" style="background: #0067FF; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">
                Print / Save as PDF
            </button>
        </div>
    </body>
    </html>`;

      const exportWindow = window.open("", "_blank");
      if (exportWindow) {
        exportWindow.document.write(htmlContent);
        exportWindow.document.close();
        exportWindow.document.title = `Dispatch - ${dispatch?.dispatchNumber || "New Dispatch"}`;
        setTimeout(() => setIsExporting(false), 1000);
      } else {
        setIsExporting(false);
      }
    } catch (error) {
      console.error("Export failed:", error);
      setIsExporting(false);
    }
  };

  const getAttachmentUrl = (attachment: any): string | undefined => {
    if (attachment.file?.asset) {
      try {
        if (attachment.file.asset._type === "sanity.imageAsset") {
          const url = urlFor(attachment.file.asset).url();
          return url;
        } else if (attachment.file.asset.url) {
          return attachment.file.asset.url;
        }
      } catch (error) {
        console.error("Error generating image URL:", error);
      }
    }

    if (attachment.url) {
      return attachment.url;
    }

    return undefined;
  };

  // Function to check if any item is over-dispatching available stock
  // Function to check if any item is over-dispatching available stock
  const checkStockAvailability = async (
    items: DispatchedItem[],
  ): Promise<{
    isValid: boolean;
    overDispatchingItems: Array<{
      itemName: string;
      binName: string;
      requested: number;
      available: number;
      difference: number;
    }>;
    warnings: string[];
  }> => {
    const overDispatchingItems: Array<{
      itemName: string;
      binName: string;
      requested: number;
      available: number;
      difference: number;
    }> = [];
    const warnings: string[] = [];

    if (items.length === 0) {
      return { isValid: true, overDispatchingItems, warnings };
    }

    try {
      // Use cached availableStock if we have it, otherwise fetch
      let stockData = { ...availableStock };

      // Check if we need to refresh stock data
      const itemsWithoutStock = items.filter(
        (item) => stockData[item._key] === undefined,
      );
      if (itemsWithoutStock.length > 0) {
        const refreshedStock = await fetchAvailableStock(itemsWithoutStock);
        stockData = { ...stockData, ...refreshedStock };
      }

      // Check each item
      items.forEach((item) => {
        const available = stockData[item._key];
        if (available === undefined) {
          warnings.push(`Could not check stock for "${item.stockItem.name}"`);
          overDispatchingItems.push({
            itemName: item.stockItem.name,
            binName: item.sourceBin?.name || "Unknown Bin",
            requested: item.dispatchedQuantity || 0,
            available: 0,
            difference: item.dispatchedQuantity || 0,
          });
          return;
        }

        const requested = item.dispatchedQuantity || 0;

        if (requested > available) {
          const binName = item.sourceBin?.name || "Unknown Bin";
          overDispatchingItems.push({
            itemName: item.stockItem.name,
            binName: binName,
            requested: requested,
            available: available,
            difference: requested - available,
          });
        }
      });

      return {
        isValid: overDispatchingItems.length === 0,
        overDispatchingItems,
        warnings,
      };
    } catch (error) {
      console.error("Error checking stock availability:", error);
      warnings.push("Error checking stock availability. Please try again.");
      return { isValid: false, overDispatchingItems, warnings };
    }
  };

  // Function to validate stock and update state
  const validateStock = async (): Promise<boolean> => {
    if (dispatchedItems.length === 0) {
      setStockValidation({
        isValid: true,
        overDispatchingItems: [],
        warnings: [],
        lastChecked: new Date(),
      });
      return true;
    }

    setIsCheckingStock(true);
    try {
      const validation = await checkStockAvailability(dispatchedItems);
      setStockValidation({
        ...validation,
        lastChecked: new Date(),
      });

      if (!validation.isValid && validation.overDispatchingItems.length > 0) {
        // Show warning toast
        const totalOver = validation.overDispatchingItems.length;
        toast({
          title: `Stock Insufficient (${totalOver} item${totalOver > 1 ? "s" : ""})`,
          description: `${validation.overDispatchingItems.length} item${totalOver > 1 ? "s" : ""} exceed available stock`,
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
      }

      return validation.isValid;
    } catch (error) {
      console.error("Error validating stock:", error);
      toast({
        title: "Stock Check Failed",
        description: "Could not verify stock levels. Please try again.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return false;
    } finally {
      setIsCheckingStock(false);
    }
  };

  const fetchAvailableStock = async (
    items: DispatchedItem[],
  ): Promise<Record<string, number>> => {
    if (items.length === 0) {
      setAvailableStock({});
      return {};
    }

    setIsLoadingStock(true);
    try {
      // Group items by bin for batch API calls
      const itemsByBin: Record<
        string,
        Array<{ itemId: string; itemKey: string }>
      > = {};

      items.forEach((item) => {
        const binId = item.sourceBin?._id;
        if (!binId) return;

        if (!itemsByBin[binId]) {
          itemsByBin[binId] = [];
        }

        itemsByBin[binId].push({
          itemId: item.stockItem._id,
          itemKey: item._key,
        });
      });

      const stockPromises = Object.entries(itemsByBin).map(
        async ([binId, binItems]) => {
          try {
            const stockRes = await fetch("/api/stock/bulk-current", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stockItems: binItems.map((item) => item.itemId),
                binId: binId,
              }),
            });

            if (stockRes.ok) {
              const stockData = await stockRes.json();

              // Map stock data back to item keys
              const stockMap: Record<string, number> = {};
              binItems.forEach((item) => {
                stockMap[item.itemKey] = stockData.results[item.itemId] || 0;
              });

              return stockMap;
            }
          } catch (error) {
            console.error(`Error fetching stock for bin ${binId}:`, error);
          }
          return {};
        },
      );

      const stockResults = await Promise.all(stockPromises);

      // Combine all stock results
      const combinedStock: Record<string, number> = {};
      stockResults.forEach((result) => {
        Object.assign(combinedStock, result);
      });

      setAvailableStock(combinedStock);
      return combinedStock;
    } catch (error) {
      console.error("Error fetching available stock:", error);
      return {};
    } finally {
      setIsLoadingStock(false);
    }
  };

  const filteredBins =
    userRole === "admin"
      ? binsForSelectedSite
      : binsForSelectedSite.filter((bin) => bin.site._id === userSite?._id);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          if (savedDispatchId) {
            onSave();
          }
          onClose();
        }}
        size={{ base: "full", md: "4xl" }}
        closeOnOverlayClick={!isSaving && !isUploadModalOpen}
        scrollBehavior="outside"
        isCentered
      >
        <ModalOverlay />
        <ModalContent
          maxH="90vh"
          maxW={{ base: "100vw", md: "90vw", lg: "1200px" }}
        >
          <ModalHeader>
            {dispatch ? "Update Dispatch" : "Create New Dispatch"}
          </ModalHeader>
          <ModalCloseButton isDisabled={isSaving} />
          {loading && !dispatch ? (
            <Box p={8} textAlign="center">
              <Spinner size="xl" />
              <Text mt={4}>Loading form...</Text>
            </Box>
          ) : (
            <form onSubmit={handleSubmit}>
              <ModalBody
                flex="1"
                overflowY="auto"
                maxH="calc(90vh - 160px)"
                px={4}
              >
                <VStack spacing={4} align="stretch">
                  {/* Site Selection */}
                  <FormControl isRequired>
                    <FormLabel>Source Site</FormLabel>
                    <Select
                      placeholder="Select site"
                      value={sourceSite?._id || ""}
                      onChange={(e) => handleSiteChange(e.target.value)}
                      isDisabled={!isEditable || loading || !!dispatch}
                    >
                      {sites.map((site) => (
                        <option key={site._id} value={site._id}>
                          {site.name}
                        </option>
                      ))}
                    </Select>
                    {dispatch && (
                      <Text fontSize="sm" color={textSecondaryColor} mt={1}>
                        Source site cannot be changed for existing dispatches
                      </Text>
                    )}
                  </FormControl>

                  {/* Dispatch Type Selection */}
                  <FormControl isRequired>
                    <FormLabel>Dispatch Type</FormLabel>
                    <Select
                      placeholder="Select dispatch type"
                      value={dispatchType}
                      onChange={(e) => handleDispatchTypeChange(e.target.value)}
                      isDisabled={!isEditable || loading}
                    >
                      {dispatchTypes.map((type) => (
                        <option key={type._id} value={type._id}>
                          {type.name}{" "}
                          {sourceSite && `(E${getSellingPrice()}/person)`}
                        </option>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Date and People Fed */}
                  <Grid
                    templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
                    gap={4}
                  >
                    <GridItem>
                      <FormControl isRequired>
                        <FormLabel>Dispatch Date</FormLabel>
                        <Input
                          type="date"
                          value={dispatchDate}
                          onChange={(e) => setDispatchDate(e.target.value)}
                          isDisabled={!isEditable || loading}
                        />
                      </FormControl>
                    </GridItem>
                    <GridItem>
                      <FormControl>
                        <FormLabel>People Fed</FormLabel>
                        <NumberInput
                          value={peopleFed || 0}
                          min={0}
                          onChange={handlePeopleFedChange}
                          isDisabled={!isEditable || loading}
                          precision={0}
                          step={1}
                        >
                          <NumberInputField />
                          <NumberInputStepper>
                            <NumberIncrementStepper />
                            <NumberDecrementStepper />
                          </NumberInputStepper>
                        </NumberInput>
                      </FormControl>
                    </GridItem>
                  </Grid>

                  <FormControl>
                    <FormLabel>Notes</FormLabel>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add any notes about this dispatch..."
                      isDisabled={!isEditable || loading}
                    />
                  </FormControl>

                  <Divider />

                  {/* Selected Bins Display */}
                  {selectedBins.length > 0 && (
                    <Box>
                      <HStack justify="space-between" mb={2}>
                        <FormLabel mb={0}>Selected Bins:</FormLabel>
                        <Text fontSize="sm" color={textSecondaryColor}>
                          {selectedBins.length} bin(s) selected
                        </Text>
                      </HStack>
                      <HStack spacing={2} flexWrap="wrap">
                        {selectedBins.map((bin) => (
                          <Tag
                            key={bin._id}
                            size="lg"
                            borderRadius="full"
                            variant="solid"
                            colorScheme="blue"
                          >
                            <TagLabel>{bin.name}</TagLabel>
                            {isEditable && (
                              <TagCloseButton
                                onClick={() => handleRemoveBin(bin._id)}
                              />
                            )}
                          </Tag>
                        ))}
                      </HStack>
                    </Box>
                  )}

                  {/* Items Display */}
                  <VStack spacing={4} align="stretch">
                    <HStack justify="space-between" align="center">
                      <FormLabel mb={0}>Dispatched Items</FormLabel>
                      <HStack spacing={2}>
                        <Text fontSize="sm" color={textSecondaryColor}>
                          {dispatchedItems.length} item(s) across{" "}
                          {selectedBins.length} bin(s)
                        </Text>
                        {isEditable && dispatchedItems.length > 0 && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => fetchAvailableStock(dispatchedItems)}
                            isLoading={isLoadingStock}
                            leftIcon={<FiRefreshCw />}
                            isDisabled={isLoadingStock}
                          >
                            Refresh Stock
                          </Button>
                        )}
                      </HStack>
                    </HStack>
                    <HStack justify="space-between" align="center">
                      <FormLabel mb={0}>Dispatched Items</FormLabel>
                      <Text fontSize="sm" color={textSecondaryColor}>
                        {dispatchedItems.length} item(s) across{" "}
                        {selectedBins.length} bin(s)
                      </Text>
                    </HStack>

                    {dispatchedItems.length === 0 ? (
                      <Box textAlign="center" py={4} color={textSecondaryColor}>
                        No items added yet. Select a bin below to add items.
                      </Box>
                    ) : (
                      <Tabs
                        variant="enclosed"
                        colorScheme="blue"
                        index={activeTab}
                        onChange={setActiveTab}
                      >
                        <TabList overflowX="auto">
                          {Object.keys(itemsByBin).map((binId, index) => (
                            <Tab key={binId}>
                              {getBinName(binId)} ({itemsByBin[binId].length})
                            </Tab>
                          ))}
                        </TabList>
                        <TabPanels>
                          {Object.entries(itemsByBin).map(([binId, items]) => (
                            <TabPanel key={binId} p={0} mt={4}>
                              {isLoadingStock && items.length > 0 && (
                                <HStack
                                  p={2}
                                  bg="transparent"
                                  borderRadius="md"
                                  mb={2}
                                >
                                  <Spinner size="sm" color="blue.500" />
                                  <Text fontSize="sm" color="blue.700">
                                    Loading stock levels...
                                  </Text>
                                </HStack>
                              )}

                              <TableContainer
                                bg={tableBg}
                                borderRadius="lg"
                                boxShadow={tableBoxShadow}
                                border="1px solid"
                                borderColor={tableBorderColor}
                              >
                                <Table variant="simple" size="sm">
                                  <Thead>
                                    <Tr>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Item
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Unit Price
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Quantity
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Available Stock
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Total Cost
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        Unit
                                      </Th>
                                      <Th
                                        color={tableHeaderColor}
                                        borderColor={tableBorderColor}
                                      >
                                        {" "}
                                      </Th>
                                    </Tr>
                                  </Thead>
                                  <Tbody>
                                    {items.map((item) => {
                                      const available = getAvailableStock(
                                        item._key,
                                      );
                                      const isOver = isOverDispatching(item);

                                      return (
                                        <Tr key={item._key}>
                                          <Td borderColor={tableBorderColor}>
                                            <VStack align="start" spacing={0}>
                                              <Text fontWeight="medium">
                                                {item.stockItem.name}
                                              </Text>
                                              {item.sourceBin?.name && (
                                                <Text
                                                  fontSize="xs"
                                                  color={textSecondaryColor}
                                                >
                                                  From: {item.sourceBin.name}
                                                </Text>
                                              )}
                                              {available !== undefined && (
                                                <HStack spacing={1} mt={1}>
                                                  <Text
                                                    fontSize="xs"
                                                    color={textSecondaryColor}
                                                  >
                                                    Available:
                                                  </Text>
                                                  <Badge
                                                    colorScheme={
                                                      isOver ? "red" : "green"
                                                    }
                                                    variant="subtle"
                                                    size="xs"
                                                    fontSize="2xs"
                                                  >
                                                    {available.toFixed(3)}
                                                  </Badge>
                                                </HStack>
                                              )}
                                            </VStack>
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            <Input
                                              value={item.unitPrice || 0}
                                              onChange={(e) =>
                                                handleUnitPriceChange(
                                                  item._key,
                                                  e.target.value,
                                                )
                                              }
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              size="sm"
                                              width="100px"
                                              isDisabled={true}
                                            />
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            <VStack align="start" spacing={1}>
                                              <NumberInput
                                                value={item.dispatchedQuantity}
                                                onChange={(valueString) =>
                                                  handleQuantityChange(
                                                    item._key,
                                                    valueString,
                                                  )
                                                }
                                                min={0}
                                                step={0.001}
                                                precision={3}
                                                size="sm"
                                                width="100px"
                                                isDisabled={!isEditable}
                                              >
                                                <NumberInputField
                                                  borderColor={
                                                    isOver
                                                      ? "red.300"
                                                      : undefined
                                                  }
                                                  _focus={{
                                                    borderColor: isOver
                                                      ? "red.500"
                                                      : "blue.500",
                                                  }}
                                                />
                                                <NumberInputStepper>
                                                  <NumberIncrementStepper />
                                                  <NumberDecrementStepper />
                                                </NumberInputStepper>
                                              </NumberInput>

                                              {isOver && (
                                                <Text
                                                  fontSize="xs"
                                                  color="red.500"
                                                  fontWeight="medium"
                                                >
                                                  {(
                                                    item.dispatchedQuantity -
                                                    (available || 0)
                                                  ).toFixed(3)}{" "}
                                                  over
                                                </Text>
                                              )}
                                            </VStack>
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            <VStack align="start" spacing={1}>
                                              {available !== undefined ? (
                                                <>
                                                  <Badge
                                                    colorScheme={
                                                      isOver ? "red" : "green"
                                                    }
                                                    variant={
                                                      isOver
                                                        ? "solid"
                                                        : "subtle"
                                                    }
                                                    size="sm"
                                                    width="100%"
                                                    textAlign="center"
                                                    py={1}
                                                  >
                                                    {available.toFixed(3)}
                                                  </Badge>
                                                  {!isOver &&
                                                    item.dispatchedQuantity >
                                                      0 && (
                                                      <Text
                                                        fontSize="xs"
                                                        color="green.500"
                                                        fontWeight="medium"
                                                      >
                                                        {(
                                                          available -
                                                          item.dispatchedQuantity
                                                        ).toFixed(3)}{" "}
                                                        left
                                                      </Text>
                                                    )}
                                                </>
                                              ) : (
                                                <Text
                                                  fontSize="xs"
                                                  color="gray.500"
                                                  fontStyle="italic"
                                                >
                                                  Loading...
                                                </Text>
                                              )}
                                            </VStack>
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            <Text fontWeight="medium">
                                              E{" "}
                                              {(item.totalCost || 0).toFixed(2)}
                                            </Text>
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            {item.stockItem.unitOfMeasure}
                                          </Td>
                                          <Td borderColor={tableBorderColor}>
                                            <HStack>
                                              <IconButton
                                                aria-label="Remove item"
                                                icon={<FiTrash2 />}
                                                size="sm"
                                                onClick={() =>
                                                  handleRemoveItem(item._key)
                                                }
                                                isDisabled={!isEditable}
                                              />
                                            </HStack>
                                          </Td>
                                        </Tr>
                                      );
                                    })}
                                  </Tbody>
                                </Table>
                              </TableContainer>
                              {isEditable && (
                                <Button
                                  leftIcon={<FiPlus />}
                                  onClick={() => {
                                    const bin = getBin(binId);
                                    if (bin) {
                                      setSelectedBinForItems(bin);
                                      setIsStockItemModalOpen(true);
                                    }
                                  }}
                                  variant="outline"
                                  size="sm"
                                  mt={2}
                                >
                                  Add more items to {getBinName(binId)}
                                </Button>
                              )}
                            </TabPanel>
                          ))}
                        </TabPanels>
                      </Tabs>
                    )}

                    {/* Bin Selection for Adding Items */}
                    {sourceSite && (
                      <Box mt={4}>
                        <Text mb={2} fontWeight="medium">
                          Add items from bin:
                        </Text>
                        <HStack spacing={2} wrap="wrap">
                          {filteredBins.map((bin) => (
                            <Button
                              key={bin._id}
                              leftIcon={<FiPackage />}
                              onClick={() => {
                                setSelectedBinForItems(bin);
                                setIsStockItemModalOpen(true);
                              }}
                              variant="outline"
                              size="sm"
                              isDisabled={!isEditable}
                            >
                              {bin.name}
                            </Button>
                          ))}
                          {filteredBins.length === 0 && (
                            <Text color={textSecondaryColor} fontSize="sm">
                              No bins available for this site
                            </Text>
                          )}
                        </HStack>
                      </Box>
                    )}

                    {/* Cost Summary Section */}
                    {dispatchedItems.length > 0 && (
                      <VStack
                        align="stretch"
                        mt={4}
                        p={4}
                        borderRadius="md"
                        borderWidth="1px"
                      >
                        <Heading size="sm" mb={2}>
                          Cost Summary
                        </Heading>
                        <HStack justify="space-between">
                          <Text fontWeight="bold">Grand Total Cost:</Text>
                          <Text fontWeight="bold" fontSize="lg">
                            E{calculateGrandTotal().toFixed(2)}
                          </Text>
                        </HStack>

                        {peopleFed && peopleFed > 0 ? (
                          <>
                            <HStack justify="space-between">
                              <Text>Cost per Person:</Text>
                              <Text fontWeight="medium">
                                E {calculateCostPerPerson().toFixed(2)}
                              </Text>
                            </HStack>
                            <HStack justify="space-between">
                              <Text>Selling Price per Person:</Text>
                              <Text fontWeight="medium">
                                E {getSellingPrice().toFixed(2)}
                              </Text>
                            </HStack>
                            <HStack justify="space-between">
                              <Text fontWeight="bold" color="green.600">
                                Total Sales:
                              </Text>
                              <Text
                                fontWeight="bold"
                                fontSize="lg"
                                color="green.600"
                              >
                                E {calculateTotalSales().toFixed(2)}
                              </Text>
                            </HStack>
                          </>
                        ) : (
                          <Text
                            fontSize="sm"
                            color="gray.600"
                            fontStyle="italic"
                          >
                            Enter number of people fed to see sales calculation
                          </Text>
                        )}
                      </VStack>
                    )}

                    {/* Evidence Section */}
                    {dispatch?.attachments &&
                      dispatch.attachments.length > 0 && (
                        <Box mt={4}>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              dispatch?._id && onToggleEvidence?.(dispatch._id)
                            }
                            width="full"
                            justifyContent="space-between"
                            bg="transparent"
                            _hover={{ bg: "gray.500" }}
                          >
                            <HStack>
                              <Text fontWeight="medium">Evidence Photos</Text>
                              <Badge colorScheme="green" variant="solid">
                                {dispatch.attachments.length}
                              </Badge>
                            </HStack>
                            <Icon
                              as={
                                isEvidenceExpanded ? FiChevronUp : FiChevronDown
                              }
                            />
                          </Button>

                          {isEvidenceExpanded && (
                            <VStack
                              spacing={4}
                              mt={4}
                              p={4}
                              bg="transparent"
                              borderRadius="md"
                            >
                              <Text
                                fontSize="sm"
                                color={textSecondaryColor}
                                alignSelf="flex-start"
                              >
                                Proof of dispatch completion
                              </Text>
                              <SimpleGrid
                                columns={{ base: 1, md: 2, lg: 3 }}
                                spacing={4}
                                w="100%"
                              >
                                {dispatch.attachments.map((attachment) => {
                                  const imageUrl = getAttachmentUrl(attachment);
                                  const isImage = imageUrl !== undefined;

                                  return (
                                    <Box
                                      key={attachment._id}
                                      borderWidth="1px"
                                      borderRadius="lg"
                                      overflow="hidden"
                                      bg="transparent"
                                      boxShadow="sm"
                                    >
                                      {isImage ? (
                                        <Image
                                          src={imageUrl}
                                          alt={"Evidence photo"}
                                          objectFit="cover"
                                          width="100%"
                                          height="200px"
                                        />
                                      ) : (
                                        <Box
                                          height="200px"
                                          bg="transparent"
                                          display="flex"
                                          alignItems="center"
                                          justifyContent="center"
                                        >
                                          <VStack spacing={2}>
                                            <Icon
                                              as={FiFileText}
                                              boxSize={8}
                                              color={textSecondaryColor}
                                            />
                                            <Text
                                              fontSize="sm"
                                              color={textSecondaryColor}
                                            >
                                              {"Document"}
                                            </Text>
                                            <Text
                                              fontSize="xs"
                                              color={textSecondaryColor}
                                            >
                                              {"File"}
                                            </Text>
                                          </VStack>
                                        </Box>
                                      )}
                                      <Box p={3}>
                                        <Text
                                          fontSize="sm"
                                          fontWeight="medium"
                                          noOfLines={1}
                                        >
                                          {"Evidence File"}
                                        </Text>
                                        <Text
                                          fontSize="xs"
                                          color={textSecondaryColor}
                                          mt={1}
                                        >
                                          {isImage ? "Photo" : "Document"}
                                        </Text>
                                      </Box>
                                    </Box>
                                  );
                                })}
                              </SimpleGrid>
                            </VStack>
                          )}
                        </Box>
                      )}
                  </VStack>

                  {/* Stock Validation Warnings */}
                  {!stockValidation.isValid &&
                    stockValidation.overDispatchingItems.length > 0 && (
                      <VStack
                        align="stretch"
                        mt={4}
                        p={4}
                        borderRadius="md"
                        borderWidth="1px"
                        borderColor="red.200"
                        bg={errorBg}
                      >
                        <HStack>
                          <Icon
                            as={FiAlertTriangle}
                            color="red.500"
                            boxSize={5}
                          />
                          <Heading size="sm" color="red.700">
                            Stock Insufficient
                          </Heading>
                        </HStack>
                        <Text fontSize="sm" color="red.600" mb={2}>
                          The following items exceed available stock:
                        </Text>
                        <VStack align="stretch" spacing={2}>
                          {stockValidation.overDispatchingItems.map(
                            (item, index) => (
                              <Box
                                key={index}
                                p={2}
                                bg="transparent"
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor="red.100"
                              >
                                <HStack justify="space-between">
                                  <Text fontWeight="medium" color="red.700">
                                    {item.itemName}
                                  </Text>
                                  <Badge colorScheme="red" variant="solid">
                                    {item.difference.toFixed(3)} over
                                  </Badge>
                                </HStack>
                                <HStack justify="space-between" fontSize="sm">
                                  <Text color="gray.600">
                                    Bin: {item.binName}
                                  </Text>
                                  <Text color="gray.600">
                                    Available:{" "}
                                    <Text as="span" fontWeight="bold">
                                      {item.available.toFixed(3)}
                                    </Text>{" "}
                                    | Requested:{" "}
                                    <Text as="span" fontWeight="bold">
                                      {item.requested.toFixed(3)}
                                    </Text>
                                  </Text>
                                </HStack>
                              </Box>
                            ),
                          )}
                        </VStack>
                        <Text
                          fontSize="sm"
                          color="red.600"
                          fontStyle="italic"
                          mt={2}
                        >
                          Reduce quantities or remove items before saving.
                        </Text>
                      </VStack>
                    )}

                  {/* Stock Check Status */}
                  {isCheckingStock && (
                    <HStack
                      p={3}
                      bg="transparent"
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor="blue.200"
                    >
                      <Spinner size="sm" color="blue.500" />
                      <Text fontSize="sm" color="blue.700">
                        Checking stock availability...
                      </Text>
                    </HStack>
                  )}

                  {stockValidation.isValid &&
                    stockValidation.lastChecked &&
                    !isCheckingStock &&
                    dispatchedItems.length > 0 && (
                      <HStack
                        p={3}
                        bg="transparent"
                        borderRadius="md"
                        borderWidth="1px"
                        borderColor="green.200"
                      >
                        <Icon as={FiCheck} color="green.500" boxSize={4} />
                        <Text fontSize="sm" color="green.700">
                          Stock check passed •{" "}
                          {stockValidation.overDispatchingItems.length === 0
                            ? "All items in stock"
                            : "Ready to save"}
                        </Text>
                        <Badge
                          colorScheme="green"
                          variant="subtle"
                          ml="auto"
                          fontSize="xs"
                        >
                          Updated{" "}
                          {new Date(
                            stockValidation.lastChecked,
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Badge>
                      </HStack>
                    )}
                </VStack>
              </ModalBody>

              <ModalFooter
                position="sticky"
                bottom="0"
                bg={tableBg}
                borderTop="1px solid"
                borderTopColor="gray.200"
                zIndex="sticky"
                py={4}
                px={4}
                flexWrap="wrap"
                gap={2}
              >
                {/* Cancel Button */}
                <Button
                  variant="outline"
                  onClick={onClose}
                  isDisabled={isSaving || loading || isCheckingStock}
                  size={{ base: "sm", md: "md" }}
                  flexShrink={0}
                >
                  Cancel
                </Button>

                {/* Export PDF Button */}
                <Button
                  colorScheme="blue"
                  variant="outline"
                  onClick={exportDispatchPDF}
                  isDisabled={
                    dispatchedItems.length === 0 ||
                    isExporting ||
                    isSaving ||
                    loading ||
                    isCheckingStock
                  }
                  isLoading={isExporting}
                  loadingText="Exporting..."
                  leftIcon={<FiFileText />}
                  size={{ base: "sm", md: "md" }}
                  flexShrink={0}
                >
                  <Text as="span" display={{ base: "none", sm: "inline" }}>
                    Export PDF
                  </Text>
                  <Text as="span" display={{ base: "inline", sm: "none" }}>
                    Export
                  </Text>
                </Button>

                {/* Editable Buttons */}
                {isEditable ? (
                  <>
                    {/* Create/Update Button */}
                    <Button
                      colorScheme="blue"
                      type="submit"
                      isLoading={isSaving || isCheckingStock}
                      isDisabled={
                        isSubmitDisabled ||
                        !stockValidation.isValid ||
                        isCheckingStock
                      }
                      loadingText={
                        isCheckingStock
                          ? "Checking stock..."
                          : dispatch
                            ? "Updating..."
                            : "Creating..."
                      }
                      title={
                        !stockValidation.isValid
                          ? "Stock insufficient - adjust quantities"
                          : ""
                      }
                      size={{ base: "sm", md: "md" }}
                      flexShrink={0}
                      flex={{ base: 1, sm: "initial" }}
                    >
                      <Text as="span" display={{ base: "none", sm: "inline" }}>
                        {dispatch ? "Update Dispatch" : "Create Dispatch"}
                      </Text>
                      <Text as="span" display={{ base: "inline", sm: "none" }}>
                        {dispatch ? "Update" : "Create"}
                      </Text>
                    </Button>

                    {/* Complete Button */}
                    <Button
                      colorScheme="green"
                      onClick={handleCompleteDispatch}
                      isLoading={isSaving || isCheckingStock}
                      isDisabled={
                        !isFullyDispatched ||
                        dispatchedItems.length === 0 ||
                        isSaving ||
                        !stockValidation.isValid ||
                        isCheckingStock
                      }
                      loadingText={
                        isCheckingStock
                          ? "Checking stock..."
                          : isSaving
                            ? "Saving..."
                            : "Completing..."
                      }
                      title={
                        !stockValidation.isValid
                          ? "Stock insufficient - adjust quantities"
                          : ""
                      }
                      size={{ base: "sm", md: "md" }}
                      flexShrink={0}
                      flex={{ base: 1, sm: "initial" }}
                    >
                      <Text as="span" display={{ base: "none", md: "inline" }}>
                        {isNew
                          ? "Save & Upload Evidence"
                          : "Upload Evidence & Complete"}
                      </Text>
                      <Text as="span" display={{ base: "inline", md: "none" }}>
                        Complete
                      </Text>
                    </Button>
                  </>
                ) : (
                  <Text
                    color={textSecondaryColor}
                    fontSize="sm"
                    flex="1"
                    textAlign="center"
                  >
                    Dispatch is completed — read-only.
                  </Text>
                )}
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>

      <StockItemSelectorModal
        isOpen={isStockItemModalOpen}
        onClose={() => {
          setIsStockItemModalOpen(false);
          setEditingIndex(null);
          setSelectedBinForItems(null);
        }}
        onSelect={handleStockItemSelect}
        existingItemIds={existingItemIds}
        sourceBinId={selectedBinForItems?._id}
      />

      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          onSave();
          onClose();
        }}
        onUploadComplete={handleFinalizeDispatch}
        relatedToId={savedDispatchId || dispatch?._id || ""}
        fileType="other"
        title="Upload Dispatch Evidence"
        description="Please upload photos or documents as evidence before completing the dispatch."
      />
    </>
  );
}
