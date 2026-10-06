"use client";

import { logger } from '@/lib/logger';
import React, { useState, useEffect, useCallback } from "react";
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
  Text,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
  Spinner,
  Flex,
  Box,
  useColorModeValue,
  Icon,
  SimpleGrid,
  Image,
  Checkbox,
  Radio,
  RadioGroup,
  Stack,
  Card,
  CardBody,
  Tooltip,
  IconButton,
} from "@chakra-ui/react";
import {
  FiCheck,
  FiSave,
  FiX,
  FiCheckCircle,
  FiFileText,
  FiDollarSign,
  FiPackage,
  FiGrid,
  FiMapPin,
  FiAlertCircle,
} from "react-icons/fi";
import {
  getRecentUnitPricesForItemsInBin,
  resolveUnitPrice,
} from "@/lib/unitPriceResolver";
import FileUploadModal from "@/components/FileUploadModal";
import {
  parseInvoiceMetadata,
  isInvoiceAttachment,
  getInvoiceDisplayInfo,
} from "@/lib/invoiceUtils";
import { FiChevronUp, FiChevronDown, FiTrash2 } from "react-icons/fi";
import { urlFor } from "@/lib/sanity";

// Update the ReceivedItemData interface
interface ReceivedItemData {
  _key: string;
  stockItem: {
    _id: string;
    name: string;
    sku?: string;
    unitOfMeasure?: string;
    unitPrice?: number;
  };
  orderedQuantity?: number;
  receivedQuantity: number;
  totalPrice?: number;
  unitPrice?: number;
  batchNumber?: string;
  expiryDate?: string;
  condition: string;
  receivingBin?: {
    _id: string;
    name: string;
    binType: string;
  };
}

interface GoodsReceiptData {
  _id: string;
  receiptNumber: string;
  receiptDate: string;
  status: string;
  notes?: string;
  purchaseOrder?: {
    _id: string;
    poNumber: string;
    status: string;
    orderDate: string;
    supplier?: {
      _id: string;
      name: string;
    };
    site?: {
      _id: string;
      name: string;
    };
    orderedItems?: Array<{
      _key: string;
      orderedQuantity: number;
      unitPrice: number;
      stockItem: {
        _id: string;
        name: string;
        sku?: string;
        unitOfMeasure?: string;
      };
      supplier?: {
        _id: string;
        name: string;
        contactPerson?: string;
        phoneNumber?: string;
        email?: string;
      };
    }>;
  };
  receivingBin?: {
    _id: string;
    name: string;
  };
  receivedItems: ReceivedItemData[];
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
  supplierNames?: string;
}

interface GoodsReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: GoodsReceiptData | null;
  onSave: () => void;
  approvedPurchaseOrders?: any[];
  preSelectedPO?: string | null;
}

interface Bin {
  _id: string;
  name: string;
  binType: string;
  site: {
    _id: string;
    name: string;
  };
}

// Initial state
const initialFormData = {
  receiptNumber: "",
  receiptDate: new Date().toISOString().split("T")[0],
  status: "draft",
  notes: "",
  purchaseOrder: undefined,
  receivingBin: undefined,
  receivedItems: [],
};

const extractSupplierNames = (orderedItems: any[]): string => {
  if (!orderedItems || orderedItems.length === 0) return "No suppliers";
  const supplierNames = orderedItems
    .map((item: any) => item.supplier?.name)
    .filter((name: string | undefined) => name && name.trim() !== "");
  const uniqueSupplierNames = [...new Set(supplierNames)];
  if (uniqueSupplierNames.length === 0) return "No suppliers";
  if (uniqueSupplierNames.length <= 2) return uniqueSupplierNames.join(", ");
  return `${uniqueSupplierNames.slice(0, 2).join(", ")} +${uniqueSupplierNames.length - 2} more`;
};

export default function GoodsReceiptModal({
  isOpen,
  onClose,
  receipt,
  onSave,
  approvedPurchaseOrders = [],
  preSelectedPO = null,
}: GoodsReceiptModalProps) {
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isEvidenceExpanded, setIsEvidenceExpanded] = useState(false);

  const [formData, setFormData] =
    useState<Partial<GoodsReceiptData>>(initialFormData);
  const [availableBins, setAvailableBins] = useState<Bin[]>([]);
  const [savedReceiptId, setSavedReceiptId] = useState<string>("");

  const isNewReceipt = !receipt || receipt._id.startsWith("temp-");

  // State for bin distribution
  const [selectedBinIds, setSelectedBinIds] = useState<string[]>([]);
  const [itemBinAssignments, setItemBinAssignments] = useState<
    Record<string, string>
  >({});
  const [initialized, setInitialized] = useState(false);

  const [itemsWithoutBins, setItemsWithoutBins] = useState<ReceivedItemData[]>(
    [],
  );

  // Color values
  const modalBg = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const borderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const inputBg = useColorModeValue(
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
  const tableHeaderBg = useColorModeValue(
    "neutral.light.bg-card-hover",
    "neutral.dark.bg-card-hover",
  );
  const tableHoverBg = useColorModeValue(
    "neutral.light.bg-card-hover",
    "neutral.dark.bg-card-hover",
  );
  const cardBg = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const warningBg = useColorModeValue("orange.50", "orange.900");
  const warningBorder = useColorModeValue("orange.200", "orange.700");

  const fetchBinsForSite = useCallback(
    async (siteId: string) => {
      if (!siteId) {
        setAvailableBins([]);
        return;
      }
      try {
        const binsResponse = await fetch(`/api/bins?siteId=${siteId}`);
        if (binsResponse.ok) {
          const bins: Bin[] = await binsResponse.json();
          setAvailableBins(bins);
        }
      } catch (error) {
        console.error("Error fetching bins:", error);
        toast({
          title: "Error",
          description: "Failed to load receiving bins for the site.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    },
    [toast],
  );

  const fetchCurrentStockItemPrices = useCallback(
    async (items: any[], binId: string) => {
      if (!items.length) return items;

      try {
        const itemIds = items.map((item) => item.stockItem._id).filter(Boolean);

        const pricesFromReceipts = await getRecentUnitPricesForItemsInBin(
          itemIds,
          binId,
        );

        return items.map((item) => {
          const unitPrice = resolveUnitPrice(
            pricesFromReceipts[item.stockItem._id],
            item.stockItem.unitPrice,
          );

          return {
            ...item,
            stockItem: {
              ...item.stockItem,
              unitPrice: unitPrice,
            },
            unitPrice: unitPrice,
            totalPrice: item.receivedQuantity * unitPrice,
          };
        });
      } catch (error) {
        console.error("Failed to fetch current prices:", error);
        return items;
      }
    },
    [],
  );

  useEffect(() => {
    const loadInitialData = async () => {
      if (!isOpen) {
        setFormData(initialFormData);
        setAvailableBins([]);
        setSelectedBinIds([]);
        setItemBinAssignments({});
        setSavedReceiptId("");
        setInitialized(false);
        return;
      }

      setIsLoading(true);

      if (receipt && !isNewReceipt) {
        try {
          const response = await fetch(`/api/goods-receipts/${receipt._id}`);
          if (!response.ok) throw new Error("Failed to fetch receipt details");
          const fullReceiptData: GoodsReceiptData = await response.json();

          // Handle old receipts: ensure each item has a bin
          if (
            fullReceiptData.receivingBin &&
            !fullReceiptData.receivedItems?.every(
              (item: any) => item.receivingBin,
            )
          ) {
            logger.debug(
              "🔄 Old receipt detected: adding document-level bin to items",
            );
            fullReceiptData.receivedItems = (
              fullReceiptData.receivedItems || []
            ).map((item: any) => ({
              ...item,
              receivingBin: item.receivingBin || fullReceiptData.receivingBin,
            }));
          }

          const itemsWithCurrentPrices = await fetchCurrentStockItemPrices(
            fullReceiptData.receivedItems || [],
            fullReceiptData.receivingBin?._id || "",
          );
          fullReceiptData.receivedItems = itemsWithCurrentPrices;

          setFormData(fullReceiptData);
          setSavedReceiptId(fullReceiptData._id);

          // Initialize bin assignments from existing data
          const assignments: Record<string, string> = {};
          fullReceiptData.receivedItems.forEach((item) => {
            if (item.receivingBin?._id) {
              assignments[item._key] = item.receivingBin._id;
            }
          });
          setItemBinAssignments(assignments);

          // Update selected bins
          const assignedBinIds = Object.values(assignments);
          setSelectedBinIds(Array.from(new Set(assignedBinIds)));

          if (fullReceiptData.purchaseOrder?.site?._id) {
            await fetchBinsForSite(fullReceiptData.purchaseOrder.site._id);
          }
        } catch (error) {
          toast({
            title: "Error",
            description: `Could not load receipt details. ${error instanceof Error ? error.message : ""}`,
            status: "error",
            duration: 5000,
            isClosable: true,
          });
          onClose();
        }
      } else if (preSelectedPO) {
        try {
          const poResponse = await fetch(
            `/api/purchase-orders?id=${preSelectedPO}`,
          );
          if (!poResponse.ok) throw new Error("Failed to fetch PO details");
          const poData = await poResponse.json();

          const supplierNames = poData.orderedItems
            ? extractSupplierNames(poData.orderedItems)
            : "No suppliers";

          const initialItems: ReceivedItemData[] = (
            poData.orderedItems || []
          ).map((item: any) => {
            const unitPrice = item.unitPrice || item.stockItem?.unitPrice || 0;
            const receivedQuantity = 0;

            return {
              _key: item._key || Math.random().toString(36).substr(2, 9),
              stockItem: {
                _id: item.stockItem?._id || "",
                name: item.stockItem?.name || "Unknown Item",
                sku: item.stockItem?.sku,
                unitOfMeasure: item.stockItem?.unitOfMeasure,
                unitPrice: unitPrice,
              },
              orderedQuantity: item.orderedQuantity || 0,
              receivedQuantity: receivedQuantity,
              totalPrice: receivedQuantity * unitPrice,
              unitPrice: unitPrice,
              condition: "good",
              batchNumber: "",
              expiryDate: "",
            };
          });

          setFormData({
            ...initialFormData,
            purchaseOrder: {
              ...poData,
              supplierNames,
            },
            receivedItems: initialItems,
            supplierNames,
          });

          if (poData.site?._id) {
            await fetchBinsForSite(poData.site._id);
          }
        } catch (error) {
          toast({
            title: "Error",
            description: `Could not load PO details. ${error instanceof Error ? error.message : ""}`,
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
      } else {
        setFormData(initialFormData);
      }

      setIsLoading(false);
      setInitialized(true);
    };

    loadInitialData();
  }, [
    isOpen,
    receipt,
    preSelectedPO,
    toast,
    onClose,
    fetchBinsForSite,
    isNewReceipt,
    fetchCurrentStockItemPrices,
  ]);

  useEffect(() => {
    const itemsWithQuantity = (formData.receivedItems || []).filter(
      (item) => (item.receivedQuantity || 0) > 0,
    );
    const itemsMissingBins = itemsWithQuantity.filter(
      (item) =>
        !itemBinAssignments[item._key] || itemBinAssignments[item._key] === "",
    );
    setItemsWithoutBins(itemsMissingBins);
  }, [formData.receivedItems, itemBinAssignments]);

  // Handle bin selection
  const handleBinToggle = (binId: string) => {
    setSelectedBinIds((prev) => {
      if (prev.includes(binId)) {
        // Remove bin and clear assignments for this bin
        const newAssignments = { ...itemBinAssignments };
        Object.keys(newAssignments).forEach((itemKey) => {
          if (newAssignments[itemKey] === binId) {
            delete newAssignments[itemKey];
          }
        });
        setItemBinAssignments(newAssignments);
        return prev.filter((id) => id !== binId);
      } else {
        return [...prev, binId];
      }
    });
  };

  const handleItemBinAssignment = (itemKey: string, binId: string) => {
    setItemBinAssignments((prev) => ({
      ...prev,
      [itemKey]: binId,
    }));
  };

  const handleFieldChange = (field: keyof GoodsReceiptData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (
    key: string,
    field: keyof ReceivedItemData,
    value: any,
  ) => {
    const processedValue =
      field === "receivedQuantity" ? handleNumberInput(value) : value;

    setFormData((prev) => ({
      ...prev,
      receivedItems: (prev.receivedItems || []).map((item) => {
        if (item._key === key) {
          const updatedItem = { ...item, [field]: processedValue };

          if (field === "receivedQuantity") {
            const currentUnitPrice =
              item.unitPrice || item.stockItem.unitPrice || 0;
            updatedItem.totalPrice = processedValue * currentUnitPrice;
            updatedItem.unitPrice = currentUnitPrice;
          }

          return updatedItem;
        }
        return item;
      }),
    }));
  };

  const handleTotalPriceChange = (key: string, value: string) => {
    const valueAsNumber = handleNumberInput(value);

    setFormData((prev) => ({
      ...prev,
      receivedItems: (prev.receivedItems || []).map((item) => {
        if (item._key === key) {
          const totalPrice = valueAsNumber;
          const unitPrice =
            item.receivedQuantity > 0 ? totalPrice / item.receivedQuantity : 0;
          return {
            ...item,
            totalPrice,
            unitPrice: unitPrice > 0 ? unitPrice : item.unitPrice || 0, // Keep existing unit price if calculated is 0
          };
        }
        return item;
      }),
    }));
  };

  const saveReceipt = async (status: string = "draft"): Promise<any> => {
    logger.debug(`💾 saveReceipt called with status: ${status}`);

    // Check if saving as completed
    if (status === "completed") {
      const hasItemsWithQuantity = (formData.receivedItems || []).some(
        (item) => (item.receivedQuantity || 0) > 0,
      );

      if (!hasItemsWithQuantity) {
        toast({
          title: "Cannot Complete",
          description:
            "At least one item must have a received quantity greater than 0.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        setIsSaving(false);
        throw new Error("No items with quantity");
      }
    }

    setIsSaving(true);

    // Remove document-level bin requirement
    if (!formData.purchaseOrder?._id) {
      toast({
        title: "Missing Information",
        description: "Please select a purchase order.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      setIsSaving(false);
      throw new Error("Missing purchase order");
    }

    // Validate that all items with quantity have bins assigned (only for completion)
    if (status === "completed") {
      const itemsWithoutBins = (formData.receivedItems || []).filter(
        (item) => item.receivedQuantity > 0 && !itemBinAssignments[item._key],
      );

      if (itemsWithoutBins.length > 0) {
        toast({
          title: "Missing Bin Assignments",
          description: `${itemsWithoutBins.length} items with quantity are missing bin assignments.`,
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        setIsSaving(false);
        throw new Error("Missing bin assignments");
      }
    }

    try {
      // Update received items with bin assignments
      const itemsWithBins = (formData.receivedItems || []).map((item) => {
        const binId = itemBinAssignments[item._key];
        const bin = availableBins.find((b) => b._id === binId);

        return {
          ...item,
          receivingBin: bin
            ? {
                _id: bin._id,
                name: bin.name,
                binType: bin.binType,
              }
            : undefined,
        };
      });

      // Update unit prices
      for (const item of itemsWithBins) {
        if (item.unitPrice && item.unitPrice > 0) {
          try {
            await fetch(`/api/stock-items/${item.stockItem._id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                updates: { unitPrice: item.unitPrice },
              }),
            });
            logger.debug(
              `Updated unit price for ${item.stockItem.name} to E ${item.unitPrice}`,
            );
          } catch (error) {
            console.warn(
              `Failed to update price for ${item.stockItem.name}:`,
              error,
            );
          }
        }
      }

      const itemsToSave = itemsWithBins.map((item) => ({
        _key: item._key,
        stockItem: { _type: "reference", _ref: item.stockItem._id },
        orderedQuantity: item.orderedQuantity || 0,
        receivedQuantity: item.receivedQuantity,
        totalPrice: item.totalPrice || 0,
        unitPrice: item.unitPrice || 0,
        condition: item.condition,
        batchNumber: item.batchNumber || "",
        expiryDate: item.expiryDate || "",
        receivingBin: item.receivingBin
          ? {
              _type: "reference",
              _ref: item.receivingBin._id,
            }
          : undefined,
      }));

      const payload = {
        receiptDate:
          formData.receiptDate || new Date().toISOString().split("T")[0],
        status,
        notes: formData.notes,
        purchaseOrder: { _type: "reference", _ref: formData.purchaseOrder._id },
        receivingBin: undefined, // Remove document-level bin
        receivedItems: itemsToSave,
      };

      let response;
      if (isNewReceipt) {
        response = await fetch("/api/goods-receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch(`/api/goods-receipts/${formData._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            `HTTP ${response.status}: Failed to save goods receipt`,
        );
      }

      const result = await response.json();

      if (status === "draft") {
        toast({
          title: "Draft Saved",
          description: "Goods receipt has been saved as draft.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      }

      return result;
    } catch (error) {
      console.error("Save error:", error);
      toast({
        title: "Error",
        description: `Failed to save goods receipt. ${error instanceof Error ? error.message : ""}`,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = () => {
    saveReceipt("draft")
      .then(() => {
        onSave();
        onClose();
      })
      .catch(() => {
        // Error handling is already done in saveReceipt
      });
  };

  // Add this function after the existing helper functions
  const validatePricesForCompletion = (): {
    isValid: boolean;
    errors: string[];
  } => {
    const errors: string[] = [];

    (formData.receivedItems || []).forEach((item) => {
      const hasQuantity = (item.receivedQuantity || 0) > 0;
      const hasValidPrice = (item.totalPrice || 0) > 0; // Check totalPrice instead of unitPrice

      if (hasQuantity && !hasValidPrice) {
        errors.push(
          `${item.stockItem.name}: Has quantity (${item.receivedQuantity}) but total price is E 0`,
        );
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  };

  const handleCompleteReceipt = async () => {
    // Check if any items have quantity > 0
    const hasItemsWithQuantity = (formData.receivedItems || []).some(
      (item) => (item.receivedQuantity || 0) > 0,
    );

    if (!hasItemsWithQuantity) {
      toast({
        title: "Cannot Complete Receipt",
        description:
          "You must enter received quantities for at least one item before completing.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    // Get all items with quantity
    const itemsWithQuantity = (formData.receivedItems || []).filter(
      (item) => (item.receivedQuantity || 0) > 0,
    );

    // Validate that ALL items with quantity have bin assignments
    const itemsMissingBins = itemsWithQuantity.filter(
      (item) =>
        !itemBinAssignments[item._key] || itemBinAssignments[item._key] === "",
    );

    if (itemsMissingBins.length > 0) {
      // Create a detailed error message
      const itemNames = itemsMissingBins
        .map((item) => item.stockItem.name)
        .slice(0, 3)
        .join(", ");

      const extraCount =
        itemsMissingBins.length > 3
          ? ` and ${itemsMissingBins.length - 3} more`
          : "";

      toast({
        title: "Missing Bin Assignments",
        description: (
          <VStack align="start" spacing={1}>
            <Text>
              {itemsMissingBins.length} item(s) with quantity need bin
              assignment:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {itemNames}
              {extraCount}
            </Text>
            <Text fontSize="xs" color="orange.600">
              Please assign bins to all items with quantity.
            </Text>
          </VStack>
        ),
        status: "error",
        duration: 7000,
        isClosable: true,
      });

      setItemsWithoutBins(itemsMissingBins);
      return;
    }

    // Check if all selected bins still exist
    const assignedBinIds = [
      ...new Set(Object.values(itemBinAssignments)),
    ].filter((id) => id);
    const missingBinIds = assignedBinIds.filter(
      (binId) => !availableBins.some((bin) => bin._id === binId),
    );

    if (missingBinIds.length > 0) {
      toast({
        title: "Invalid Bin Assignments",
        description:
          "Some assigned bins are no longer available. Please re-assign items to valid bins.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    // Validate prices for items with quantity
    const priceValidation = validatePricesForCompletion();
    if (!priceValidation.isValid) {
      toast({
        title: "Invalid Prices",
        description: (
          <VStack align="start" spacing={1}>
            <Text>Items with quantity must have price greater than E 0:</Text>
            {priceValidation.errors.slice(0, 3).map((error, index) => (
              <Text key={index} fontSize="sm">
                • {error}
              </Text>
            ))}
            {priceValidation.errors.length > 3 && (
              <Text fontSize="sm" color="orange.600">
                ...and {priceValidation.errors.length - 3} more
              </Text>
            )}
          </VStack>
        ),
        status: "error",
        duration: 7000,
        isClosable: true,
      });
      return;
    }

    // Proceed with completion
    try {
      setIsSaving(true);
      let finalReceiptId = formData._id;

      // ALWAYS save the receipt with current bin assignments before opening upload modal
      // This ensures the backend has the latest data
      const savedReceipt = await saveReceipt("draft");
      finalReceiptId = savedReceipt._id;

      if (finalReceiptId) {
        setSavedReceiptId(finalReceiptId);
      }

      // Update form data with the saved receipt
      setFormData((prev) => ({
        ...prev,
        _id: savedReceipt._id,
        receiptNumber: savedReceipt.receiptNumber,
      }));

      if (!finalReceiptId) throw new Error("Could not determine receipt ID");

      // Show success message before opening upload modal
      toast({
        title: "Ready for Completion",
        description:
          "All validations passed! Please upload evidence files to complete the receipt.",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      setIsUploadModalOpen(true);
    } catch (error) {
      console.error("Failed to prepare receipt for completion:", error);
      toast({
        title: "Error",
        description: `Failed to prepare receipt for completion. ${error instanceof Error ? error.message : ""}`,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalizeReceipt = async (attachmentIds: string[]) => {
    setIsUploadModalOpen(false);
    try {
      setIsSaving(true);
      const receiptIdToUse = savedReceiptId || formData._id;

      if (!receiptIdToUse)
        throw new Error("No receipt ID available for completion");

      // IMPORTANT: First save the receipt with all bin assignments BEFORE calling complete-goods-receipt
      // This ensures the backend has the latest data with bin assignments

      // 1. Prepare items with bin assignments
      const itemsWithBins = (formData.receivedItems || []).map((item) => {
        const binId = itemBinAssignments[item._key];
        const bin = availableBins.find((b) => b._id === binId);

        return {
          ...item,
          receivingBin: bin
            ? {
                _id: bin._id,
                name: bin.name,
                binType: bin.binType,
              }
            : undefined,
        };
      });

      // 2. Save the receipt with bin assignments first
      const savePayload = {
        receiptDate:
          formData.receiptDate || new Date().toISOString().split("T")[0],
        status: "draft", // Save as draft first
        notes: formData.notes,
        purchaseOrder: {
          _type: "reference",
          _ref: formData.purchaseOrder?._id,
        },
        receivingBin: undefined,
        receivedItems: itemsWithBins.map((item) => ({
          _key: item._key,
          stockItem: { _type: "reference", _ref: item.stockItem._id },
          orderedQuantity: item.orderedQuantity || 0,
          receivedQuantity: item.receivedQuantity,
          totalPrice: item.totalPrice || 0,
          unitPrice: item.unitPrice || 0,
          condition: item.condition,
          batchNumber: item.batchNumber || "",
          expiryDate: item.expiryDate || "",
          receivingBin: item.receivingBin
            ? {
                _type: "reference",
                _ref: item.receivingBin._id,
              }
            : undefined,
        })),
      };

      // Save the receipt with updated bin assignments
      const saveResponse = await fetch(
        `/api/goods-receipts/${receiptIdToUse}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        },
      );

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(
          errorData.error || `Failed to save receipt with bin assignments`,
        );
      }

      logger.debug("✅ Receipt saved with bin assignments");

      // 3. Update unit prices
      for (const item of formData.receivedItems || []) {
        if (item.unitPrice && item.unitPrice > 0) {
          try {
            await fetch(`/api/stock-items/${item.stockItem._id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                updates: { unitPrice: item.unitPrice },
              }),
            });
            logger.debug(
              `Updated unit price for ${item.stockItem.name} to E ${item.unitPrice}`,
            );
          } catch (error) {
            console.warn(
              `Failed to update price for ${item.stockItem.name}:`,
              error,
            );
          }
        }
      }

      // 4. Now complete the receipt
      const completeResponse = await fetch("/api/complete-goods-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: receiptIdToUse,
          poId: formData.purchaseOrder?._id,
          attachmentIds,
        }),
      });

      if (!completeResponse.ok) {
        const errorData = await completeResponse.json();
        console.error("Backend validation error:", errorData);

        // Check if it's a bin assignment error
        if (errorData.error?.includes("missing receiving bins")) {
          // Re-validate on frontend to show user what's wrong
          const itemsWithQuantity = (formData.receivedItems || []).filter(
            (item) => (item.receivedQuantity || 0) > 0,
          );
          const itemsMissingBins = itemsWithQuantity.filter(
            (item) =>
              !itemBinAssignments[item._key] ||
              itemBinAssignments[item._key] === "",
          );

          if (itemsMissingBins.length > 0) {
            throw new Error(
              `Backend validation: ${itemsMissingBins.length} items still missing bin assignments`,
            );
          } else {
            // Something else is wrong with the data
            throw new Error(
              "Backend validation failed. Please check all items have valid bin assignments.",
            );
          }
        }
        throw new Error(
          errorData.error || "Failed to complete goods receipt transaction",
        );
      }

      toast({
        title: "Receipt Completed",
        description: `Goods receipt has been completed successfully with ${attachmentIds.length} evidence file(s).`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      onSave();
      onClose();
    } catch (error) {
      console.error("Completion error:", error);

      // Show specific error message
      let errorMessage = "Failed to complete goods receipt";
      if (error instanceof Error) {
        if (error.message.includes("missing bin assignments")) {
          errorMessage =
            "Some items are still missing bin assignments. Please assign bins to all items with quantity.";
        } else if (error.message.includes("Backend validation")) {
          errorMessage = error.message;
        } else {
          errorMessage = error.message;
        }
      }

      toast({
        title: "Error",
        description: errorMessage,
        status: "error",
        duration: 5000,
        isClosable: true,
      });

      // Re-open the modal so user can fix the issue
      setIsUploadModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "green";
      case "partially-received":
        return "orange";
      default:
        return "gray";
    }
  };

  const handleNumberInput = (value: string): number => {
    if (value === "" || value === "-") return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  };

  const handleInvoiceUploadComplete = async (attachmentIds: string[]) => {
    try {
      toast({
        title: "Invoice uploaded successfully",
        description: "Invoice has been tracked and linked to this receipt.",
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      if (formData._id) {
        const response = await fetch(`/api/goods-receipts/${formData._id}`);
        if (response.ok) {
          const updatedReceipt = await response.json();
          setFormData(updatedReceipt);
        }
      }
    } catch (error) {
      console.error("Error handling invoice upload:", error);
      toast({
        title: "Error",
        description: "Failed to refresh receipt data after invoice upload.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const getAttachmentUrl = (
    attachment: any,
  ): { url: string | undefined; type: "image" | "file" | "unknown" } => {
    logger.debug("Attachment data:", attachment);

    // First check if there's a direct file URL
    if (attachment.url) {
      logger.debug("Using direct URL:", attachment.url);
      const fileExtension =
        attachment.fileName?.split(".").pop()?.toLowerCase() || "";
      const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(
        fileExtension,
      );
      return { url: attachment.url, type: isImage ? "image" : "file" };
    }

    // Then check for Sanity asset
    if (attachment.file?.asset) {
      const asset = attachment.file.asset;

      try {
        logger.debug("Asset found:", asset);

        // Check if it's an image asset
        if (asset._type === "sanity.imageAsset") {
          const url = urlFor(asset).url();
          logger.debug("Generated image URL:", url);
          return { url, type: "image" };
        }
        // Check if it's a file asset
        else if (asset._type === "sanity.fileAsset") {
          const fileUrl = asset.url;
          logger.debug("File asset URL:", fileUrl);

          // Check if file is an image by extension
          const fileExtension =
            attachment.fileName?.split(".").pop()?.toLowerCase() || "";
          const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(
            fileExtension,
          );

          return { url: fileUrl, type: isImage ? "image" : "file" };
        } else if (asset.url) {
          logger.debug("Using asset URL:", asset.url);
          const fileExtension =
            attachment.fileName?.split(".").pop()?.toLowerCase() || "";
          const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(
            fileExtension,
          );
          return { url: asset.url, type: isImage ? "image" : "file" };
        }
      } catch (error) {
        console.error("Error processing asset:", error);
        if (asset.url) {
          logger.debug("Fallback to asset URL:", asset.url);
          const fileExtension =
            attachment.fileName?.split(".").pop()?.toLowerCase() || "";
          const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(
            fileExtension,
          );
          return { url: asset.url, type: isImage ? "image" : "file" };
        }
      }
    }

    logger.debug("No URL found for attachment");
    return { url: undefined, type: "unknown" };
  };

  const exportGoodsReceiptPDF = () => {
    if (!formData.purchaseOrder) return;

    const supplierName =
      formData.supplierNames ||
      (formData.purchaseOrder?.orderedItems &&
      formData.purchaseOrder.orderedItems.length > 0
        ? extractSupplierNames(formData.purchaseOrder.orderedItems)
        : "N/A");

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Goods Receipt - ${formData.receiptNumber || "Draft"}</title>
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
            <h1>GOODS RECEIPT</h1>
            <p style="font-size: 16px; margin: 5px 0;">Receipt Number: <strong>${formData.receiptNumber || "Draft"}</strong></p>
            <p style="font-size: 14px; margin: 5px 0;">Date: ${new Date(formData.receiptDate || new Date()).toLocaleDateString()}</p>
        </div>
    </div>

    <div class="info-section">
        <div class="info-grid">
            <div>
                <div class="info-item">
                    <span class="info-label">Purchase Order:</span>
                    <span> ${formData.purchaseOrder.poNumber}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Supplier:</span>
                    <span> ${supplierName}</span>
                </div>
            </div>
            <div>
                <div class="info-item">
                    <span class="info-label">Site:</span>
                    <span> ${formData.purchaseOrder.site?.name || "N/A"}</span>
                </div>
            </div>
        </div>
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Item</th>
                <th>Ordered</th>
                <th>Received</th>
                <th>Bin</th>
                <th>Total Price</th> 
                <th>Unit Price</th> 
                <th>Unit</th>
                <th>Condition</th>
                <th>Batch Number</th>
            </tr>
        </thead>
        <tbody>
            ${(formData.receivedItems || [])
              .map((item) => {
                const displayUnitPrice = item.stockItem.unitPrice || 0;
                const displayTotalPrice =
                  item.receivedQuantity * displayUnitPrice;
                const binName = item.receivingBin?.name || "Not Assigned";

                return `
                <tr>
                    <td><strong>${item.stockItem.name}</strong></td>
                    <td>${item.orderedQuantity || 0}</td>
                    <td>${item.receivedQuantity}</td>
                    <td>${binName}</td>
                    <td>E ${displayTotalPrice.toFixed(2)}</td>
                    <td>E ${displayUnitPrice.toFixed(2)}</td>
                    <td>${item.stockItem.unitOfMeasure}</td>
                    <td>${item.condition}</td>
                    <td>${item.batchNumber || "N/A"}</td>
                </tr>
                `;
              })
              .join("")}
        </tbody>
    </table>

    ${
      formData.notes
        ? `
        <div class="info-section">
            <h3 style="margin: 0 0 12px 0; color: #2D3748; font-size: 16px;">Notes:</h3>
            <p style="margin: 0; color: #4A5568; line-height: 1.5;">${formData.notes}</p>
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
      exportWindow.document.title = `Goods Receipt - ${formData.receiptNumber || "Draft"}`;
    }
  };

  // Helper functions for bin display
  const getBinName = (binId: string) => {
    const bin = availableBins.find((b) => b._id === binId);
    return bin ? `${bin.name} (${bin.binType})` : "Unknown Bin";
  };

  const getBinTypeColor = (binType: string) => {
    switch (binType.toLowerCase()) {
      case "storage":
        return "blue";
      case "dispatch":
        return "green";
      case "receiving":
        return "orange";
      default:
        return "gray";
    }
  };

  // Render bin selection table
  const renderBinSelectionTable = () => {
    const getBinName = (binId: string) => {
      const bin = availableBins.find((b) => b._id === binId);
      return bin ? `(${bin.binType.split("-")[0]})` : "Unknown Bin";
    };

    const getBinTypeColor = (binType: string) => {
      switch (binType.toLowerCase()) {
        case "storage":
          return "blue";
        case "dispatch":
          return "green";
        case "receiving":
          return "orange";
        default:
          return "gray";
      }
    };

    return (
      <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} mt={4}>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <HStack justify="space-between">
              <Text fontWeight="bold" fontSize="lg">
                <Icon as={FiGrid} mr={2} />
                Bin Distribution
              </Text>
              <Badge colorScheme="brand">
                {selectedBinIds.length} bin(s) selected
              </Badge>
            </HStack>

            <Text fontSize="sm" color={secondaryTextColor}>
              Select bins and assign items to distribute goods across multiple
              storage locations
            </Text>

            {/* Bin Selection Row */}
            <Box
              p={4}
              bg={tableHeaderBg}
              borderRadius="md"
              borderWidth="1px"
              borderColor={borderColor}
            >
              <Text fontWeight="medium" mb={3}>
                Select Available Bins:
              </Text>
              <SimpleGrid
                columns={{ base: 1, sm: 2, md: 4 }}
                spacing={3}
                w="100%"
              >
                {availableBins.map((bin) => {
                  const isBinSelected = selectedBinIds.includes(bin._id);
                  const isCompletedReceipt = formData.status === "completed";

                  return (
                    <Box
                      key={bin._id}
                      position="relative"
                      minW="0" // Important for text truncation
                    >
                      <Card
                        borderWidth="2px"
                        borderColor={isBinSelected ? "brand.500" : borderColor}
                        bg={isBinSelected ? tableHeaderBg : cardBg}
                        cursor={isCompletedReceipt ? "default" : "pointer"}
                        onClick={
                          isCompletedReceipt
                            ? undefined
                            : () => handleBinToggle(bin._id)
                        }
                        _hover={{
                          borderColor: isCompletedReceipt
                            ? undefined
                            : "brand.300",
                        }}
                        opacity={isCompletedReceipt ? 0.7 : 1}
                        h="100%"
                        overflow="hidden"
                      >
                        <CardBody p={3}>
                          <VStack spacing={2} align="stretch" h="100%">
                            {/* Bin Name and Type */}
                            <HStack justify="space-between" spacing={2}>
                              <HStack spacing={2} minW="0" flex={1}>
                                {isCompletedReceipt ? (
                                  <Icon
                                    as={isBinSelected ? FiCheckCircle : FiX}
                                    color={
                                      isBinSelected ? "green.500" : "gray.400"
                                    }
                                    boxSize={4}
                                    flexShrink={0}
                                  />
                                ) : (
                                  <Checkbox
                                    isChecked={isBinSelected}
                                    onChange={() => handleBinToggle(bin._id)}
                                    isDisabled={isCompletedReceipt}
                                    flexShrink={0}
                                  />
                                )}
                                <Text
                                  fontWeight="medium"
                                  fontSize="sm"
                                  noOfLines={1}
                                  overflow="hidden"
                                  textOverflow="ellipsis"
                                  flex={1}
                                >
                                  {bin.name}
                                </Text>
                              </HStack>
                              <Badge
                                colorScheme={getBinTypeColor(bin.binType)}
                                size="sm"
                                variant={
                                  isCompletedReceipt ? "subtle" : "solid"
                                }
                                flexShrink={0}
                              >
                                {bin.binType === "storage"
                                  ? "Storage"
                                  : bin.binType === "dispatch"
                                    ? "Dispatch"
                                    : bin.binType === "receiving"
                                      ? "Receiving"
                                      : bin.binType}
                              </Badge>
                            </HStack>

                            {/* Site Name */}
                            <Text
                              fontSize="xs"
                              color={secondaryTextColor}
                              noOfLines={1}
                              overflow="hidden"
                              textOverflow="ellipsis"
                              title={bin.site.name}
                            >
                              {bin.site.name}
                            </Text>

                            {/* Completion Status */}
                            {isCompletedReceipt && isBinSelected && (
                              <Text
                                fontSize="xs"
                                color="green.600"
                                fontWeight="medium"
                                textAlign="center"
                                mt={1}
                              >
                                ✓ Assigned to receipt
                              </Text>
                            )}
                          </VStack>
                        </CardBody>
                      </Card>
                    </Box>
                  );
                })}
              </SimpleGrid>
              {formData.status === "completed" && (
                <Text
                  fontSize="sm"
                  color={secondaryTextColor}
                  mt={3}
                  fontStyle="italic"
                >
                  Bin selection is locked for completed receipts
                </Text>
              )}
            </Box>

            {/* Item Distribution Table */}
            {selectedBinIds.length > 0 && (
              <Box mt={4}>
                <Text fontWeight="medium" mb={3}>
                  Assign Items to Bins:
                </Text>

                {/* Validation Warning 
                                {itemsWithoutBins.length > 0 && (
                                    <Box mb={3} p={3} bg={warningBg} borderWidth="1px" borderColor={warningBorder} borderRadius="md">
                                        <HStack>
                                            <Icon as={FiAlertCircle} color="orange.500" />
                                            <Text fontSize="sm" color="orange.700" fontWeight="medium">
                                                {itemsWithoutBins.length} item(s) need bin assignment before completion
                                            </Text>
                                        </HStack>
                                    </Box>
                                )}*/}

                <TableContainer>
                  <Table variant="simple" size="sm">
                    <Thead>
                      <Tr bg={tableHeaderBg}>
                        {selectedBinIds.map((binId) => (
                          <Th
                            key={binId}
                            color={secondaryTextColor}
                            borderColor={borderColor}
                            textAlign="center"
                          >
                            {getBinName(binId)}
                          </Th>
                        ))}
                        <Th
                          color={secondaryTextColor}
                          borderColor={borderColor}
                        >
                          Item
                        </Th>
                        <Th
                          isNumeric
                          color={secondaryTextColor}
                          borderColor={borderColor}
                        >
                          Ordered
                        </Th>
                        <Th
                          isNumeric
                          color={secondaryTextColor}
                          borderColor={borderColor}
                        >
                          Received
                        </Th>
                        <Th
                          isNumeric
                          color={secondaryTextColor}
                          borderColor={borderColor}
                        >
                          Total Price (E)
                        </Th>
                        <Th
                          isNumeric
                          color={secondaryTextColor}
                          borderColor={borderColor}
                        >
                          Unit Price (E)
                        </Th>

                        <Th
                          color={secondaryTextColor}
                          borderColor={borderColor}
                          textAlign="center"
                        >
                          Status
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {(formData.receivedItems || []).map((item) => {
                        const hasQuantity = (item.receivedQuantity || 0) > 0;
                        const hasBinAssignment =
                          !!itemBinAssignments[item._key];
                        const needsBin = hasQuantity && !hasBinAssignment;
                        const needsPrice =
                          hasQuantity && (item.totalPrice || 0) <= 0;

                        return (
                          <Tr
                            key={item._key}
                            _hover={{ bg: tableHoverBg }}
                            bg={needsBin ? warningBg : "transparent"}
                            borderLeft={needsBin ? "4px solid" : "none"}
                            borderLeftColor={
                              needsBin ? warningBorder : "transparent"
                            }
                          >
                            {selectedBinIds.map((binId) => (
                              <Td
                                key={binId}
                                borderColor={borderColor}
                                textAlign="center"
                              >
                                <Radio
                                  isChecked={
                                    itemBinAssignments[item._key] === binId
                                  }
                                  onChange={() =>
                                    handleItemBinAssignment(item._key, binId)
                                  }
                                  colorScheme="brand"
                                  isDisabled={formData.status === "completed"}
                                />
                              </Td>
                            ))}
                            <Td borderColor={borderColor}>
                              <VStack align="start" spacing={1}>
                                <Text fontWeight="medium">
                                  {item.stockItem?.name}
                                </Text>
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  {item.stockItem.sku || "No SKU"}
                                </Text>
                              </VStack>
                            </Td>
                            <Td isNumeric borderColor={borderColor}>
                              {item.orderedQuantity || 0}{" "}
                              {item.stockItem.unitOfMeasure}
                            </Td>
                            <Td borderColor={borderColor}>
                              <VStack align="start" spacing={1}>
                                <Input
                                  value={
                                    item.receivedQuantity === 0
                                      ? ""
                                      : item.receivedQuantity
                                  }
                                  onChange={(e) =>
                                    handleItemChange(
                                      item._key,
                                      "receivedQuantity",
                                      e.target.value,
                                    )
                                  }
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  size="sm"
                                  width="100px"
                                  isDisabled={formData.status === "completed"}
                                  bg={inputBg}
                                  borderColor={
                                    item.receivedQuantity === 0
                                      ? warningBg
                                      : needsBin
                                        ? warningBorder
                                        : borderColor
                                  }
                                  placeholder="0"
                                  _focus={{
                                    borderColor:
                                      item.receivedQuantity === 0
                                        ? "orange.500"
                                        : needsBin
                                          ? "orange.500"
                                          : "brand.500",
                                  }}
                                />
                                {item.receivedQuantity === 0 && (
                                  <Text
                                    fontSize="xs"
                                    color="orange.500"
                                    fontWeight="medium"
                                  >
                                    Enter quantity
                                  </Text>
                                )}
                              </VStack>
                            </Td>
                            <Td borderColor={borderColor}>
                              <VStack align="start" spacing={1}>
                                <Input
                                  value={
                                    item.totalPrice === 0 ||
                                    item.totalPrice === undefined
                                      ? ""
                                      : item.totalPrice
                                  }
                                  onChange={(e) =>
                                    handleTotalPriceChange(
                                      item._key,
                                      e.target.value,
                                    )
                                  }
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  size="sm"
                                  width="100px"
                                  isDisabled={formData.status === "completed"}
                                  bg={inputBg}
                                  borderColor={
                                    needsPrice ? "red.300" : borderColor
                                  }
                                  _focus={{
                                    borderColor: needsPrice
                                      ? "red.500"
                                      : "brand.500",
                                  }}
                                  placeholder="0.00"
                                />
                                {/* Price validation warning */}
                                {needsPrice && (
                                  <Text
                                    fontSize="xs"
                                    color="red.500"
                                    fontWeight="medium"
                                  >
                                    Price required for quantity
                                  </Text>
                                )}
                                {/* Auto-calculated unit price display */}
                                {(item.totalPrice as number) > 0 &&
                                  item.receivedQuantity > 0 && (
                                    <Text fontSize="xs" color="green.600">
                                      Unit: E{" "}
                                      {(
                                        (item.totalPrice as number) /
                                        item.receivedQuantity
                                      ).toFixed(2)}
                                    </Text>
                                  )}
                              </VStack>
                            </Td>
                            <Td borderColor={borderColor}>
                              <Text fontSize="sm" fontWeight="medium">
                                E {(item.unitPrice || 0).toFixed(2)}
                              </Text>
                              {needsPrice && (
                                <Text
                                  fontSize="xs"
                                  color="red.500"
                                  fontWeight="medium"
                                  mt={1}
                                >
                                  Set price
                                </Text>
                              )}
                            </Td>
                            <Td borderColor={borderColor} textAlign="center">
                              {needsBin ? (
                                <Tooltip label="This item has quantity but no bin assigned">
                                  <Badge
                                    colorScheme="orange"
                                    variant="solid"
                                    fontSize="xs"
                                    cursor="help"
                                  >
                                    Needs Bin
                                  </Badge>
                                </Tooltip>
                              ) : hasBinAssignment ? (
                                <Tooltip
                                  label={`Assigned to ${getBinName(itemBinAssignments[item._key])}`}
                                >
                                  <Badge
                                    colorScheme="green"
                                    variant="subtle"
                                    fontSize="xs"
                                    cursor="help"
                                  >
                                    ✓ Assigned
                                  </Badge>
                                </Tooltip>
                              ) : !hasQuantity ? (
                                <Badge
                                  colorScheme="gray"
                                  variant="subtle"
                                  fontSize="xs"
                                >
                                  No Quantity
                                </Badge>
                              ) : (
                                <Badge
                                  colorScheme="yellow"
                                  variant="subtle"
                                  fontSize="xs"
                                >
                                  Pending
                                </Badge>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </TableContainer>

                {/* Summary */}
                <Box
                  mt={4}
                  p={4}
                  bg={tableHeaderBg}
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor={borderColor}
                >
                  <HStack justify="space-between" mb={3}>
                    <Text fontWeight="medium">Assignment Summary:</Text>
                    <Badge
                      colorScheme={
                        itemsWithoutBins.length > 0 ? "orange" : "green"
                      }
                      variant={itemsWithoutBins.length > 0 ? "solid" : "subtle"}
                    >
                      {itemsWithoutBins.length > 0
                        ? `${itemsWithoutBins.length} items need bins`
                        : "All items assigned"}
                    </Badge>
                  </HStack>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    {selectedBinIds.map((binId) => {
                      const bin = availableBins.find((b) => b._id === binId);
                      const assignedItems = (
                        formData.receivedItems || []
                      ).filter(
                        (item) => itemBinAssignments[item._key] === binId,
                      );
                      const totalQuantity = assignedItems.reduce(
                        (sum, item) => sum + item.receivedQuantity,
                        0,
                      );
                      const totalValue = assignedItems.reduce(
                        (sum, item) => sum + (item.totalPrice || 0),
                        0,
                      );

                      return (
                        <HStack
                          key={binId}
                          justify="space-between"
                          p={2}
                          bg={cardBg}
                          borderRadius="md"
                          borderWidth="1px"
                          borderColor={borderColor}
                        >
                          <HStack>
                            <Icon as={FiPackage} color="brand.500" />
                            <VStack align="start" spacing={0}>
                              <Text fontSize="sm" fontWeight="medium">
                                {bin?.name}
                              </Text>
                              <Text fontSize="xs" color={secondaryTextColor}>
                                {bin?.binType}
                              </Text>
                            </VStack>
                          </HStack>
                          <VStack align="end" spacing={0}>
                            <Badge colorScheme="brand" mb={1}>
                              {assignedItems.length} items
                            </Badge>
                            <Text fontSize="xs" color={secondaryTextColor}>
                              {totalQuantity} units
                            </Text>
                            <Text
                              fontSize="xs"
                              fontWeight="medium"
                              color="green.600"
                            >
                              E {totalValue.toFixed(2)}
                            </Text>
                          </VStack>
                        </HStack>
                      );
                    })}

                    {/* Unassigned items summary */}
                    {itemsWithoutBins.length > 0 && (
                      <HStack
                        justify="space-between"
                        p={2}
                        bg={warningBg}
                        borderRadius="md"
                        borderWidth="1px"
                        borderColor={warningBorder}
                      >
                        <HStack>
                          <Icon as={FiAlertCircle} color="orange.500" />
                          <VStack align="start" spacing={0}>
                            <Text
                              fontSize="sm"
                              fontWeight="medium"
                              color="orange.700"
                            >
                              Unassigned Items
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              Need bin assignment
                            </Text>
                          </VStack>
                        </HStack>
                        <Badge colorScheme="orange">
                          {itemsWithoutBins.length} items
                        </Badge>
                      </HStack>
                    )}
                  </SimpleGrid>

                  {/* Validation instructions */}
                  {itemsWithoutBins.length > 0 && (
                    <Box
                      mt={3}
                      p={2}
                      bg={warningBg}
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor={warningBorder}
                    >
                      <Text fontSize="xs" color="orange.700">
                        <strong>Action required:</strong> Items highlighted in
                        orange have received quantity but no bin assignment.
                        Please assign a bin to each item before completing the
                        receipt.
                      </Text>
                    </Box>
                  )}
                </Box>
              </Box>
            )}
          </VStack>
        </CardBody>
      </Card>
    );
  };

  const modalTitle = !isNewReceipt
    ? `Goods Receipt: ${formData.receiptNumber}`
    : "New Goods Receipt";
  const isEditable = formData.status !== "completed";

  // Get supplier name for display
  const displaySupplierName =
    formData.supplierNames ||
    (formData.purchaseOrder?.orderedItems &&
    formData.purchaseOrder.orderedItems.length > 0
      ? extractSupplierNames(formData.purchaseOrder.orderedItems)
      : "N/A");

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size={{ base: "full", md: "6xl" }}
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent
          bg={modalBg}
          maxW={{ base: "100%", md: "1200px" }}
          mx="auto"
          my={{ base: 0, md: 8 }}
          borderRadius={{ base: "none", md: "xl" }}
          boxShadow="xl"
          height="90vh"
        >
          <ModalHeader borderBottomWidth="1px" borderColor={borderColor}>
            {modalTitle}
          </ModalHeader>
          <ModalCloseButton position="absolute" right="12px" top="12px" />
          <ModalBody pb={6} overflowY="auto" maxH="calc(90vh - 140px)">
            {isLoading ? (
              <Flex justifyContent="center" alignItems="center" height="100%">
                <Spinner size="xl" />
              </Flex>
            ) : (
              <VStack spacing={4} align="stretch" color={primaryTextColor}>
                <HStack
                  flexDirection={{ base: "column", sm: "row" }}
                  alignItems={{ base: "flex-start", sm: "center" }}
                  spacing={{ base: 4, sm: 2 }}
                >
                  {!isNewReceipt && (
                    <FormControl isRequired>
                      <FormLabel color={secondaryTextColor}>
                        Receipt Number
                      </FormLabel>
                      <Input
                        value={formData.receiptNumber || ""}
                        isReadOnly
                        bg={inputBg}
                        borderColor={borderColor}
                      />
                    </FormControl>
                  )}
                  <FormControl isRequired>
                    <FormLabel color={secondaryTextColor}>
                      Receipt Date
                    </FormLabel>
                    <Input
                      type="date"
                      value={formData.receiptDate || ""}
                      onChange={(e) =>
                        handleFieldChange("receiptDate", e.target.value)
                      }
                      isReadOnly={!isEditable}
                      bg={inputBg}
                      borderColor={borderColor}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryTextColor}>Status</FormLabel>
                    <Badge
                      colorScheme={getStatusColor(formData.status || "draft")}
                      fontSize="md"
                      px={3}
                      py={1}
                      borderRadius="full"
                    >
                      {(formData.status || "draft").toUpperCase()}
                    </Badge>
                  </FormControl>
                </HStack>

                <HStack
                  flexDirection={{ base: "column", sm: "row" }}
                  alignItems={{ base: "flex-start", sm: "center" }}
                  spacing={{ base: 4, sm: 2 }}
                >
                  <FormControl isRequired>
                    <FormLabel color={secondaryTextColor}>
                      Purchase Order
                    </FormLabel>
                    <Input
                      value={formData.purchaseOrder?.poNumber || "N/A"}
                      isReadOnly
                      bg={inputBg}
                      borderColor={borderColor}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryTextColor}>Site</FormLabel>
                    <Input
                      value={formData.purchaseOrder?.site?.name || "N/A"}
                      isReadOnly
                      bg={inputBg}
                      borderColor={borderColor}
                    />
                  </FormControl>
                </HStack>

                {formData.purchaseOrder && (
                  <Box
                    p={4}
                    borderWidth={1}
                    borderColor={borderColor}
                    borderRadius="md"
                    mt={2}
                    bg={tableHeaderBg}
                  >
                    <VStack align="stretch" spacing={2}>
                      <Text fontWeight="bold" fontSize="lg">
                        Purchase Order Details
                      </Text>
                      <HStack justifyContent="space-between">
                        <Text fontWeight="medium">PO Number:</Text>
                        <Text>{formData.purchaseOrder.poNumber}</Text>
                      </HStack>
                      <HStack justifyContent="space-between">
                        <Text fontWeight="medium">Suppliers:</Text>
                        <Text>{displaySupplierName}</Text>
                      </HStack>
                      <HStack justifyContent="space-between">
                        <Text fontWeight="medium">Site:</Text>
                        <Text>{formData.purchaseOrder.site?.name}</Text>
                      </HStack>
                      {formData.purchaseOrder.orderedItems &&
                        formData.purchaseOrder.orderedItems.length > 0 && (
                          <Box mt={2}>
                            <Text fontWeight="medium" mb={1}>
                              Ordered Items:
                            </Text>
                            <VStack align="stretch" spacing={1}>
                              {formData.purchaseOrder.orderedItems
                                .slice(0, 3)
                                .map((item, index) => (
                                  <HStack
                                    key={item._key || index}
                                    justifyContent="space-between"
                                  >
                                    <Text fontSize="sm">
                                      {item.stockItem?.name}
                                    </Text>
                                    <Text
                                      fontSize="sm"
                                      color={secondaryTextColor}
                                    >
                                      {item.orderedQuantity} × E{" "}
                                      {item.unitPrice?.toFixed(2)} = E{" "}
                                      {(
                                        item.orderedQuantity * item.unitPrice
                                      ).toFixed(2)}
                                    </Text>
                                  </HStack>
                                ))}
                              {formData.purchaseOrder.orderedItems.length >
                                3 && (
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  +
                                  {formData.purchaseOrder.orderedItems.length -
                                    3}{" "}
                                  more items
                                </Text>
                              )}
                            </VStack>
                          </Box>
                        )}
                    </VStack>
                  </Box>
                )}

                {/* Bin Distribution Section */}
                {availableBins.length > 0
                  ? renderBinSelectionTable()
                  : initialized && (
                      <Card
                        bg={warningBg}
                        borderWidth="1px"
                        borderColor={warningBorder}
                        mt={4}
                      >
                        <CardBody>
                          <HStack>
                            <Icon as={FiAlertCircle} color="orange.500" />
                            <VStack align="start" spacing={1}>
                              <Text fontWeight="medium" color="orange.700">
                                No Bins Available
                              </Text>
                              <Text fontSize="sm" color="orange.600">
                                No bins found for site:{" "}
                                {formData.purchaseOrder?.site?.name ||
                                  "Unknown Site"}
                              </Text>
                            </VStack>
                          </HStack>
                        </CardBody>
                      </Card>
                    )}

                <FormControl>
                  <FormLabel color={secondaryTextColor}>Notes</FormLabel>
                  <Input
                    value={formData.notes || ""}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                    placeholder="Additional notes or comments"
                    isDisabled={!isEditable}
                    bg={inputBg}
                    borderColor={borderColor}
                  />
                </FormControl>

                {formData.attachments && formData.attachments.length > 0 && (
                  <Box mt={4}>
                    <Button
                      variant="ghost"
                      onClick={() => setIsEvidenceExpanded(!isEvidenceExpanded)}
                      width="full"
                      justifyContent="space-between"
                      bg="transparent"
                      _hover={{ bg: "gray.500" }}
                    >
                      <HStack>
                        <Text fontWeight="medium">
                          Evidence Files & Invoices
                        </Text>
                        <Badge colorScheme="green" variant="solid">
                          {formData.attachments.length}
                        </Badge>
                      </HStack>
                      <Icon
                        as={isEvidenceExpanded ? FiChevronUp : FiChevronDown}
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
                          color={secondaryTextColor}
                          alignSelf="flex-start"
                        >
                          Proof of goods receipt and supplier invoices
                        </Text>

                        {formData.attachments.filter((attachment) =>
                          isInvoiceAttachment(attachment.description || ""),
                        ).length > 0 && (
                          <Box w="100%">
                            <Text fontWeight="bold" mb={3} color="green.600">
                              Tracked Invoices
                            </Text>
                            <SimpleGrid
                              columns={{ base: 1, md: 2 }}
                              spacing={4}
                              w="100%"
                            >
                              {formData.attachments
                                .filter((attachment) =>
                                  isInvoiceAttachment(
                                    attachment.description || "",
                                  ),
                                )
                                .map((attachment) => {
                                  const invoiceInfo = getInvoiceDisplayInfo(
                                    attachment.description || "",
                                  );
                                  const { url: fileUrl, type } =
                                    getAttachmentUrl(attachment);

                                  return (
                                    <Box
                                      key={attachment._id}
                                      borderWidth="2px"
                                      borderColor="green.200"
                                      borderRadius="lg"
                                      overflow="hidden"
                                      bg="transparent"
                                      boxShadow="sm"
                                    >
                                      <Box
                                        p={4}
                                        borderBottom="1px solid"
                                        borderColor="green.200"
                                      >
                                        <HStack align="start" spacing={3}>
                                          <Icon
                                            as={FiDollarSign}
                                            color="green.500"
                                            mt={1}
                                          />
                                          <VStack
                                            align="start"
                                            spacing={1}
                                            flex="1"
                                          >
                                            <Text
                                              fontWeight="bold"
                                              fontSize="sm"
                                            >
                                              Invoice:{" "}
                                              {
                                                invoiceInfo.metadata
                                                  ?.invoiceNumber
                                              }
                                            </Text>
                                            <Text fontSize="xs">
                                              Supplier:{" "}
                                              {invoiceInfo.metadata?.supplier}
                                            </Text>
                                            <Text fontSize="xs">
                                              Amount: E{" "}
                                              {invoiceInfo.metadata?.invoiceAmount?.toFixed(
                                                2,
                                              )}
                                            </Text>
                                            <Text fontSize="xs">
                                              Date:{" "}
                                              {new Date(
                                                invoiceInfo.metadata
                                                  ?.invoiceDate || "",
                                              ).toLocaleDateString()}
                                            </Text>
                                            {invoiceInfo.metadata
                                              ?.userDescription && (
                                              <Text fontSize="xs" mt={1}>
                                                {
                                                  invoiceInfo.metadata
                                                    .userDescription
                                                }
                                              </Text>
                                            )}
                                          </VStack>
                                        </HStack>
                                      </Box>
                                      <Box p={3}>
                                        <HStack justify="space-between">
                                          <Text
                                            fontSize="xs"
                                            color={secondaryTextColor}
                                          >
                                            {attachment.fileName}
                                          </Text>
                                          {fileUrl && (
                                            <Button
                                              size="xs"
                                              colorScheme="green"
                                              variant="outline"
                                              as="a"
                                              href={fileUrl}
                                              target="_blank"
                                            >
                                              View
                                            </Button>
                                          )}
                                        </HStack>
                                      </Box>
                                    </Box>
                                  );
                                })}
                            </SimpleGrid>
                          </Box>
                        )}

                        {formData.attachments.filter(
                          (attachment) =>
                            !isInvoiceAttachment(attachment.description || ""),
                        ).length > 0 && (
                          <Box w="100%">
                            <Text fontWeight="bold" mb={3} color="blue.600">
                              Evidence Files
                            </Text>
                            <SimpleGrid
                              columns={{ base: 1, md: 2, lg: 3 }}
                              spacing={4}
                              w="100%"
                            >
                              {formData.attachments
                                .filter(
                                  (attachment) =>
                                    !isInvoiceAttachment(
                                      attachment.description || "",
                                    ),
                                )
                                .map((attachment) => {
                                  const { url: fileUrl, type } =
                                    getAttachmentUrl(attachment);
                                  const isImage = type === "image";
                                  const isFile = type === "file";
                                  const fileExtension =
                                    attachment.fileName
                                      ?.split(".")
                                      .pop()
                                      ?.toLowerCase() || "file";
                                  const isPDF = fileExtension === "pdf";
                                  const isDocument = [
                                    "doc",
                                    "docx",
                                    "txt",
                                  ].includes(fileExtension);
                                  const isPNG = fileExtension === "png";
                                  const isJPG = ["jpg", "jpeg"].includes(
                                    fileExtension,
                                  );
                                  const isImageFile =
                                    isPNG ||
                                    isJPG ||
                                    [
                                      "png",
                                      "jpg",
                                      "jpeg",
                                      "gif",
                                      "webp",
                                    ].includes(fileExtension);

                                  return (
                                    <Box
                                      key={attachment._id}
                                      borderWidth="1px"
                                      borderRadius="lg"
                                      overflow="hidden"
                                      bg="transparent"
                                      boxShadow="sm"
                                      position="relative"
                                    >
                                      {isImageFile && fileUrl ? (
                                        <Box position="relative" height="200px">
                                          <Image
                                            src={fileUrl}
                                            alt={
                                              attachment.fileName ||
                                              "Evidence photo"
                                            }
                                            objectFit="cover"
                                            width="100%"
                                            height="100%"
                                            loading="lazy"
                                            onError={(e) => {
                                              console.warn(
                                                "Image failed to load, showing fallback:",
                                                fileUrl,
                                              );
                                              // Hide the image and show fallback
                                              e.currentTarget.style.display =
                                                "none";
                                              const fallbackElement =
                                                e.currentTarget.parentElement?.querySelector(
                                                  ".image-fallback",
                                                );
                                              if (fallbackElement) {
                                                (
                                                  fallbackElement as HTMLElement
                                                ).style.display = "flex";
                                              }
                                            }}
                                          />
                                          {/* Fallback when image fails to load */}
                                          <Box
                                            className="image-fallback"
                                            display="none"
                                            height="100%"
                                            width="100%"
                                            bg="transparent"
                                            alignItems="center"
                                            justifyContent="center"
                                            cursor="pointer"
                                            onClick={() =>
                                              window.open(fileUrl, "_blank")
                                            }
                                          >
                                            <VStack spacing={2}>
                                              <Icon
                                                as={FiFileText}
                                                boxSize={8}
                                                color="blue.400"
                                              />
                                              <Text
                                                fontSize="sm"
                                                fontWeight="medium"
                                                textAlign="center"
                                              >
                                                {attachment.fileName}
                                              </Text>
                                              <Badge
                                                colorScheme="blue"
                                                variant="subtle"
                                              >
                                                {fileExtension.toUpperCase()}
                                              </Badge>
                                              <Text
                                                fontSize="xs"
                                                color="blue.500"
                                                mt={2}
                                              >
                                                Click to open
                                              </Text>
                                            </VStack>
                                          </Box>
                                        </Box>
                                      ) : (
                                        <Box
                                          height="200px"
                                          bg={
                                            isPDF
                                              ? "red.50"
                                              : isDocument
                                                ? "blue.50"
                                                : "gray.100"
                                          }
                                          display="flex"
                                          alignItems="center"
                                          justifyContent="center"
                                          cursor={
                                            fileUrl ? "pointer" : "default"
                                          }
                                          onClick={() =>
                                            fileUrl &&
                                            window.open(fileUrl, "_blank")
                                          }
                                          borderBottom="1px solid"
                                          borderColor="gray.200"
                                          _hover={
                                            fileUrl
                                              ? {
                                                  bg: isPDF
                                                    ? "red.100"
                                                    : isDocument
                                                      ? "blue.100"
                                                      : "gray.200",
                                                }
                                              : {}
                                          }
                                        >
                                          <VStack spacing={2}>
                                            <Icon
                                              as={FiFileText}
                                              boxSize={8}
                                              color={
                                                isPDF
                                                  ? "red.400"
                                                  : isDocument
                                                    ? "blue.400"
                                                    : secondaryTextColor
                                              }
                                            />
                                            <Text
                                              fontSize="sm"
                                              fontWeight="medium"
                                              textAlign="center"
                                            >
                                              {attachment.fileName ||
                                                "Document"}
                                            </Text>
                                            <Badge
                                              colorScheme={
                                                isPDF
                                                  ? "red"
                                                  : isDocument
                                                    ? "blue"
                                                    : "gray"
                                              }
                                              variant="subtle"
                                            >
                                              {fileExtension.toUpperCase()}
                                            </Badge>
                                            {fileUrl && (
                                              <Text
                                                fontSize="xs"
                                                color="blue.500"
                                                mt={2}
                                              >
                                                Click to open
                                              </Text>
                                            )}
                                          </VStack>
                                        </Box>
                                      )}
                                      <Box p={3}>
                                        <Text
                                          fontSize="sm"
                                          fontWeight="medium"
                                          noOfLines={1}
                                        >
                                          {attachment.fileName ||
                                            "Evidence File"}
                                        </Text>
                                        <Text
                                          fontSize="xs"
                                          color={secondaryTextColor}
                                          mt={1}
                                        >
                                          {attachment.description &&
                                          !isInvoiceAttachment(
                                            attachment.description,
                                          )
                                            ? attachment.description
                                            : isImageFile
                                              ? "Photo"
                                              : `${fileExtension.toUpperCase()} File`}
                                        </Text>
                                        {fileUrl && isImageFile && (
                                          <Text
                                            fontSize="xs"
                                            color="blue.500"
                                            mt={1}
                                          >
                                            Click image to open full size
                                          </Text>
                                        )}
                                      </Box>
                                    </Box>
                                  );
                                })}
                            </SimpleGrid>
                          </Box>
                        )}
                      </VStack>
                    )}
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter
            borderTopWidth="1px"
            borderColor={borderColor}
            flexWrap="wrap"
            gap={2}
            py={4}
          >
            {/* Cancel Button */}
            <Button
              colorScheme="gray"
              onClick={onClose}
              isDisabled={isSaving || isLoading}
              variant="outline"
              size={{ base: "sm", md: "md" }}
              flexShrink={0}
            >
              Cancel
            </Button>

            {/* Export PDF Button */}
            <Button
              colorScheme="blue"
              variant="outline"
              onClick={exportGoodsReceiptPDF}
              isDisabled={
                !formData.purchaseOrder ||
                (formData.receivedItems || []).length === 0
              }
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

            {/* Track Invoice Button */}
            <Button
              colorScheme="green"
              variant="outline"
              onClick={() => setIsInvoiceModalOpen(true)}
              leftIcon={<FiDollarSign />}
              isDisabled={!formData.purchaseOrder}
              size={{ base: "sm", md: "md" }}
              flexShrink={0}
            >
              <Text as="span" display={{ base: "none", md: "inline" }}>
                Track Invoice
              </Text>
              <Text as="span" display={{ base: "inline", md: "none" }}>
                Invoice
              </Text>
            </Button>

            {/* Editable Buttons */}
            {isEditable && (
              <>
                {/* Save Draft Button */}
                <Button
                  colorScheme="brand"
                  variant="outline"
                  onClick={handleSaveDraft}
                  isLoading={isSaving}
                  leftIcon={<FiSave />}
                  isDisabled={
                    !formData.purchaseOrder ||
                    (formData.receivedItems || []).length === 0
                  }
                  size={{ base: "sm", md: "md" }}
                  flexShrink={0}
                >
                  <Text as="span" display={{ base: "none", sm: "inline" }}>
                    Save Draft
                  </Text>
                  <Text as="span" display={{ base: "inline", sm: "none" }}>
                    Draft
                  </Text>
                </Button>

                <Button
                  colorScheme="green"
                  onClick={handleCompleteReceipt}
                  isLoading={isSaving}
                  isDisabled={
                    !formData.purchaseOrder ||
                    (formData.receivedItems || []).length === 0
                  }
                  leftIcon={<FiCheckCircle />}
                  size={{ base: "sm", md: "md" }}
                  flexShrink={0}
                  title={
                    itemsWithoutBins.length > 0
                      ? `${itemsWithoutBins.length} items need bin assignment`
                      : (formData.receivedItems || []).some(
                            (item) =>
                              item.receivedQuantity > 0 &&
                              (item.totalPrice || 0) <= 0,
                          )
                        ? "Items with quantity require price > E 0"
                        : ""
                  }
                >
                  <Text as="span" display={{ base: "none", md: "inline" }}>
                    {isNewReceipt
                      ? "Save & Upload Evidence"
                      : "Upload Evidence & Complete"}
                  </Text>
                  <Text as="span" display={{ base: "inline", md: "none" }}>
                    Complete
                  </Text>
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <FileUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          onSave();
          onClose();
        }}
        onUploadComplete={handleFinalizeReceipt}
        relatedToId={savedReceiptId || formData._id || ""}
        fileType="receipt"
        title="Upload Receipt Evidence"
        description="Please upload photos or documents as evidence before completing the receipt."
      />

      <FileUploadModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        onUploadComplete={handleInvoiceUploadComplete}
        relatedToId={savedReceiptId || formData._id || ""}
        fileType="invoice"
        title="Track Invoice"
        description="Upload supplier invoice for this goods receipt"
        invoiceData={{
          supplier: displaySupplierName,
        }}
      />
    </>
  );
}
