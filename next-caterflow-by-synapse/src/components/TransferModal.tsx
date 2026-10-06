// components/TransferModal.tsx
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
  Badge,
  useColorModeValue,
  Flex,
} from "@chakra-ui/react";
import {
  FiPlus,
  FiTrash2,
  FiRefreshCw,
  FiSave,
  FiSend,
  FiFileText,
} from "react-icons/fi";
import StockItemSelectorModal from "./StockItemSelectorModal";
import { nanoid } from "nanoid";
import { useSession } from "next-auth/react";
import { getBinStock } from "@/lib/stockCalculations";

interface TransferredItem {
  _key: string;
  stockItem: {
    _id: string;
    name: string;
    sku?: string;
    unitOfMeasure?: string;
    currentStock?: number;
  };
  transferredQuantity: number;
  notes?: string;
}

interface InternalTransfer {
  _id: string;
  transferNumber: string;
  transferDate: string;
  status: "draft" | "pending-approval" | "approved" | "completed" | "cancelled";
  fromBin: {
    _id: string;
    name: string;
    site: {
      _id: string;
      name: string;
    };
  };
  toBin: {
    _id: string;
    name: string;
    site: {
      _id: string;
      name: string;
    };
  };
  transferredItems: TransferredItem[];
  notes?: string;
  transferredBy?: {
    _id: string;
    name: string;
  };
  approvedBy?: {
    _id: string;
    name: string;
  };
  approvedAt?: string;
}

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  transfer?: InternalTransfer | null;
  onSave: () => void;
}

export default function TransferModal({
  isOpen,
  onClose,
  transfer,
  onSave,
}: TransferModalProps) {
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [allBins, setAllBins] = useState<any[]>([]);
  const [fromBin, setFromBin] = useState<any>(null);
  const [toBin, setToBin] = useState<any>(null);
  const [transferDate, setTransferDate] = useState("");
  const [transferredItems, setTransferredItems] = useState<TransferredItem[]>(
    [],
  );
  const [notes, setNotes] = useState("");
  const [isStockItemModalOpen, setIsStockItemModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [stockLevels, setStockLevels] = useState<{ [key: string]: number }>({});
  const [refreshingStock, setRefreshingStock] = useState(false);

  const toast = useToast();
  const { data: session } = useSession();
  const user = session?.user as any;

  const isNew = !transfer;
  const isEditable = !transfer || transfer?.status === "draft";
  const isPendingApproval = transfer?.status === "pending-approval";
  const isApproved = transfer?.status === "approved";
  const isCompleted = transfer?.status === "completed";

  // Theme-aware colors
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

  // Validation colors
  const positiveColor = useColorModeValue("green.500", "green.300");
  const negativeColor = useColorModeValue("red.500", "red.300");
  const warningColor = useColorModeValue("orange.500", "orange.300");

  // Button colors
  const brandColorScheme = useColorModeValue("brand", "brand");
  const neutralColorScheme = useColorModeValue("gray", "gray");

  // Enhanced stock refresh function
  const refreshStockLevels = useCallback(
    async (binId: string, itemIds?: string[]) => {
      if (!binId) {
        setStockLevels({});
        return;
      }

      setRefreshingStock(true);
      try {
        const idsToFetch =
          itemIds && itemIds.length > 0
            ? itemIds
            : transferredItems
                .map((item) => item.stockItem?._id)
                .filter(Boolean);

        if (idsToFetch.length > 0) {
          logger.debug(
            `🔄 Refreshing stock levels for ${idsToFetch.length} items in bin ${binId}`,
          );
          const stockData = await getBinStock(idsToFetch, binId);
          logger.debug("✅ Stock levels refreshed:", stockData);

          // Convert the stock data to match the expected type
          const simplifiedStockData: { [key: string]: number } = {};
          Object.keys(stockData).forEach((key) => {
            if (typeof stockData[key] === "object" && stockData[key] !== null) {
              // If it's an object with a quantity property, extract just the quantity
              simplifiedStockData[key] = (stockData[key] as any).quantity || 0;
            } else if (typeof stockData[key] === "number") {
              // If it's already a number, use it directly
              simplifiedStockData[key] = stockData[key] as number;
            } else {
              // Fallback to 0
              simplifiedStockData[key] = 0;
            }
          });

          setStockLevels(simplifiedStockData);
        } else {
          logger.debug("ℹ️ No items to refresh stock for");
          setStockLevels({});
        }
      } catch (error) {
        console.error("❌ Error refreshing stock levels:", error);
        toast({
          title: "Error",
          description: "Failed to refresh stock levels",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setRefreshingStock(false);
      }
    },
    [transferredItems, toast],
  );

  // Fetch bins and initialize form data on modal open or transfer change
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch bins – request all-sites visibility for transfers.
        // The server enforces role-based access; falls back to own-site on 403.
        logger.debug("🗄️ Fetching bins (all sites for transfer)...");
        let binsData: any[] = [];
        const allBinsRes = await fetch("/api/bins?allowAll=true");
        if (allBinsRes.ok) {
          binsData = await allBinsRes.json();
          logger.debug(`✅ All-sites bins fetched: ${binsData.length}`);
        } else if (allBinsRes.status === 403) {
          // Role not permitted to see all bins; fall back to own-site only
          console.warn("⚠️ allowAll denied, falling back to own-site bins");
          const fallbackRes = await fetch("/api/bins");
          if (fallbackRes.ok) {
            binsData = await fallbackRes.json();
            logger.debug(`✅ Own-site bins fetched: ${binsData.length}`);
          }
        }
        setAllBins(binsData);

        // Initialize form data
        const today = new Date().toISOString().split("T")[0];
        let latestTransfer = transfer;

        if (transfer?._id) {
          logger.debug("📦 Fetching latest transfer data...");
          const res = await fetch(`/api/operations/transfers/${transfer._id}`);
          if (res.ok) {
            latestTransfer = await res.json();
            logger.debug("✅ Transfer data loaded");
          }
        }

        setTransferDate(
          latestTransfer?.transferDate
            ? latestTransfer.transferDate.split("T")[0]
            : today,
        );
        setFromBin(latestTransfer?.fromBin || null);
        setToBin(latestTransfer?.toBin || null);
        setTransferredItems(latestTransfer?.transferredItems || []);
        setNotes(latestTransfer?.notes || "");

        logger.debug("✅ Form initialized");
      } catch (error) {
        console.error("❌ Error fetching transfer data:", error);
        toast({
          title: "Error",
          description: "Failed to load transfer data.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen, transfer, toast]);

  // Enhanced stock refresh when fromBin changes
  useEffect(() => {
    if (fromBin?._id && !isCompleted) {
      logger.debug(
        `📍 From bin changed to: ${fromBin.name}, refreshing stock...`,
      );
      const itemIds = transferredItems
        .map((item) => item.stockItem?._id)
        .filter(Boolean);
      refreshStockLevels(fromBin._id, itemIds);
    } else if (!fromBin) {
      setStockLevels({});
    }
  }, [fromBin, isCompleted, refreshStockLevels, transferredItems]);

  // Enhanced stock refresh handler with better feedback
  const handleRefreshStock = async () => {
    if (fromBin?._id && !isCompleted) {
      logger.debug("🔄 Manual stock refresh triggered");
      await refreshStockLevels(fromBin._id);
      toast({
        title: "Stock Levels Refreshed",
        description: `Current stock levels from ${fromBin.name} updated`,
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } else {
      toast({
        title: "Cannot Refresh",
        description: "Please select a source bin first",
        status: "warning",
        duration: 2000,
        isClosable: true,
      });
    }
  };

  // In TransferModal.tsx - Update the handleStockItemSelect function
  const handleStockItemSelect = (items: any[]) => {
    if (!fromBin?._id) {
      toast({
        title: "Select Source Bin",
        description: "Please select the source bin before adding items.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const newItems: TransferredItem[] = items
      .map((item) => {
        const availableStock = stockLevels[item._id] ?? 0;
        return {
          _key: nanoid(),
          stockItem: {
            _id: item._id,
            name: item.name,
            sku: item.sku,
            unitOfMeasure: item.unitOfMeasure,
            currentStock: availableStock,
          },
          transferredQuantity: Math.min(1, availableStock),
          notes: "",
        };
      })
      .filter((item) => item.transferredQuantity > 0);

    if (newItems.length === 0) {
      toast({
        title: "No available stock",
        description:
          "None of the selected items have available stock in the selected bin.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setTransferredItems((prevItems) => {
      const updatedItems = [...prevItems];
      if (editingIndex !== null) {
        updatedItems[editingIndex] = newItems[0]; // For edit mode, use first item
        setEditingIndex(null);
      } else {
        updatedItems.push(...newItems);
      }
      return updatedItems;
    });

    setIsStockItemModalOpen(false);

    // Refresh stock levels for newly added items
    if (fromBin?._id) {
      const newItemIds = items.map((item) => item._id);
      refreshStockLevels(fromBin._id, newItemIds);
    }

    if (newItems.length > 1) {
      toast({
        title: "Items added",
        description: `${newItems.length} items added to transfer`,
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    }
  };

  const handleQuantityChange = (key: string, value: string) => {
    const valueAsNumber = parseFloat(value);
    setTransferredItems((prevItems) =>
      prevItems.map((item) => {
        if (item._key === key) {
          return {
            ...item,
            transferredQuantity: isNaN(valueAsNumber) ? 0 : valueAsNumber,
          };
        }
        return item;
      }),
    );
  };

  const handleRemoveItem = (key: string) => {
    setTransferredItems((prevItems) =>
      prevItems.filter((item) => item._key !== key),
    );
  };

  const handleEditItem = (index: number) => {
    setEditingIndex(index);
    setIsStockItemModalOpen(true);
  };

  // Enhanced stock level getter with better validation
  const getAvailableStock = (itemId: string): number => {
    return stockLevels[itemId] || 0;
  };

  // Enhanced quantity validation with stock status
  const isQuantityValid = (item: TransferredItem): boolean => {
    if (!item || !item.stockItem) return false;
    const availableStock = getAvailableStock(item.stockItem._id);
    return (
      item.transferredQuantity > 0 && item.transferredQuantity <= availableStock
    );
  };

  const getStockStatus = (
    currentStock: number,
    minimumStockLevel: number = 0,
  ) => {
    if (currentStock === 0) return { status: "out-of-stock", color: "red" };
    if (currentStock <= minimumStockLevel)
      return { status: "low-stock", color: "orange" };
    return { status: "in-stock", color: "green" };
  };

  const getStockStatusText = (
    currentStock: number,
    minimumStockLevel: number = 0,
  ) => {
    if (currentStock === 0) return "Out of Stock";
    if (currentStock <= minimumStockLevel) return "Low Stock";
    return "In Stock";
  };

  // Enhanced save function with better validation
  const handleSave = async (
    newStatus: "draft" | "pending-approval" | "approved" | "completed",
  ) => {
    setIsSaving(true);
    try {
      // Validate required fields for non-draft status
      if (
        newStatus !== "draft" &&
        (!fromBin || !toBin || transferredItems.length === 0)
      ) {
        toast({
          title: "Missing Information",
          description: "All fields are required when submitting for approval.",
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      // Enhanced quantity validation with detailed feedback
      if (!isCompleted) {
        for (const item of transferredItems) {
          if (!isQuantityValid(item)) {
            const availableStock = getAvailableStock(item.stockItem._id);
            toast({
              title: "Invalid Quantity",
              description: `"${item.stockItem.name}": ${item.transferredQuantity} requested, but only ${availableStock} available in ${fromBin?.name}`,
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            throw new Error("Invalid quantity");
          }
        }
      }

      const payload: any = {
        transferDate: new Date(transferDate).toISOString(),
        fromBin: fromBin._id,
        toBin: toBin._id,
        transferredItems: transferredItems.map((item) => ({
          _key: item._key,
          stockItem: item.stockItem._id,
          transferredQuantity: item.transferredQuantity,
        })),
        notes,
      };

      let url = "";
      let method: "POST" | "PATCH" = "POST";
      let message = "Transfer saved successfully.";

      if (isNew) {
        // New transfer - always save as a draft first
        url = "/api/operations/transfers";
        payload.status = "draft";
        message = "Transfer saved as draft";
      } else {
        // Existing transfer, check the new status
        if (newStatus === "pending-approval") {
          url = `/api/operations/transfers/${transfer._id}/submit`;
          message = "Transfer submitted for approval";
          method = "PATCH";
        } else if (newStatus === "approved") {
          url = `/api/operations/transfers/${transfer._id}/approve`;
          message = "Transfer approved";
          method = "PATCH";
        } else if (newStatus === "completed") {
          url = `/api/operations/transfers/${transfer._id}/complete`;
          message = "Transfer completed";
          method = "PATCH";
        } else {
          // Default to saving as draft or updating an existing draft
          url = `/api/operations/transfers/${transfer._id}`;
          payload.status = "draft";
          message = "Transfer saved as draft";
          method = "PATCH";
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save transfer");
      }

      toast({
        title: message,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onSave();
      onClose();
    } catch (error: any) {
      console.error("Save transfer error:", error);
      toast({
        title: "Error saving transfer",
        description: error?.message || "An error occurred",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = (
    status:
      | "draft"
      | "pending-approval"
      | "approved"
      | "completed"
      | "cancelled",
  ) => {
    const colorSchemes = {
      draft: "gray",
      "pending-approval": "orange",
      approved: "blue",
      completed: "green",
      cancelled: "red",
    };

    return (
      <Badge colorScheme={colorSchemes[status] || "gray"} ml={2}>
        {status}
      </Badge>
    );
  };

  // Add this function to your TransferModal component
  // Replace the exportTransferPDF function in TransferModal.tsx
  const exportTransferPDF = () => {
    if (!transfer) return;

    // Extract the data with proper null checks
    const transferNumber = transfer.transferNumber || "N/A";
    const transferDate = transfer.transferDate
      ? new Date(transfer.transferDate).toLocaleDateString()
      : "N/A";
    const status = transfer.status || "draft";

    // Handle fromBin data with proper null checks
    const fromBinName = transfer.fromBin?.name || "N/A";
    const fromSiteName = transfer.fromBin?.site?.name || "N/A";

    // Handle toBin data with proper null checks
    const toBinName = transfer.toBin?.name || "N/A";
    const toSiteName = transfer.toBin?.site?.name || "N/A";

    // Handle user data
    const transferredByName = transfer.transferredBy?.name || "Not specified";
    const approvedByName = transfer.approvedBy?.name || "Pending approval";

    // Handle items with proper null checks
    const items = transfer.transferredItems || [];

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Transfer Document - ${transferNumber}</title>
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
        .signature-section {
            margin-top: 40px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            border-top: 2px solid #E2E8F0;
            padding-top: 30px;
        }
        .signature-box {
            text-align: center;
            padding: 20px;
            background: #F7FAFC;
            border-radius: 8px;
            border: 1px solid #E2E8F0;
        }
        .signature-line {
            height: 2px;
            background: #CBD5E0;
            margin: 40px 0 10px 0;
        }
        .signature-label {
            font-weight: 600;
            color: #2D3748;
            margin-bottom: 5px;
        }
        .signature-details {
            font-size: 12px;
            color: #718096;
            margin-top: 5px;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 10px;
        }
        .status-completed { background: #C6F6D5; color: #22543D; }
        .status-approved { background: #BEE3F8; color: #1A365D; }
        .status-pending { background: #FEEBC8; color: #744210; }
        .status-draft { background: #E2E8F0; color: #2D3748; }
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
            <h1>INTERNAL TRANSFER DOCUMENT</h1>
            <p style="font-size: 16px; margin: 5px 0;">
                Transfer Number: <strong>${transferNumber}</strong>
                <span class="status-badge status-${status}">
                    ${status.toUpperCase()}
                </span>
            </p>
            <p style="font-size: 14px; margin: 5px 0;">
                Date: ${transferDate}
            </p>
        </div>
    </div>

    <div class="info-section">
        <div class="info-grid">
            <div>
                <div class="info-item">
                    <span class="info-label">From Bin:</span>
                    <span> ${fromBinName}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Site:</span>
                    <span> ${fromSiteName}</span>
                </div>
            </div>
            <div>
                <div class="info-item">
                    <span class="info-label">To Bin:</span>
                    <span> ${toBinName}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Site:</span>
                    <span> ${toSiteName}</span>
                </div>
            </div>
        </div>
    </div>

    ${
      transfer.notes
        ? `
        <div class="info-section">
            <h3 style="margin: 0 0 12px 0; color: #2D3748; font-size: 16px;">Transfer Notes:</h3>
            <p style="margin: 0; color: #4A5568; line-height: 1.5;">${transfer.notes}</p>
        </div>
    `
        : ""
    }

    ${
      items.length > 0
        ? `
        <table class="table">
            <thead>
                <tr>
                    <th>Item Name</th>
                    <th>SKU</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                ${items
                  .map((item) => {
                    const itemName = item.stockItem?.name || "N/A";
                    const itemSku = item.stockItem?.sku || "N/A";
                    const quantity = item.transferredQuantity || 0;
                    const unit = item.stockItem?.unitOfMeasure || "Each";
                    const itemNotes = item.notes || "-";

                    return `
                        <tr>
                            <td><strong>${itemName}</strong></td>
                            <td>${itemSku}</td>
                            <td>${quantity}</td>
                            <td>${unit}</td>
                            <td>${itemNotes}</td>
                        </tr>
                    `;
                  })
                  .join("")}
            </tbody>
        </table>
    `
        : '<p style="text-align: center; color: #718096; padding: 20px;">No items in this transfer</p>'
    }

    <div class="signature-section">
        <!-- Sender Signature -->
        <div class="signature-box">
            <div class="signature-label">SENDER</div>
            <div class="signature-details">
                Prepared and verified by
            </div>
            <div class="signature-line"></div>
            <div class="signature-details">
                Name: _________________________
            </div>
            <div class="signature-details">
                Signature: 
                <div style="height: 60px; margin: 10px 0; border-bottom: 1px solid #CBD5E0;"></div>
            </div>
            <div class="signature-details">
                Date: _________________________
            </div>
        </div>

        <!-- Driver Signature -->
        <div class="signature-box">
            <div class="signature-label">DRIVER / TRANSPORTER</div>
            <div class="signature-details">
                Received items for transport
            </div>
            <div class="signature-line"></div>
            <div class="signature-details">
                Name: _________________________
            </div>
            <div class="signature-details">
                Signature: 
                <div style="height: 60px; margin: 10px 0; border-bottom: 1px solid #CBD5E0;"></div>
            </div>
            <div class="signature-details">
                Date: _________________________
            </div>
            <div class="signature-details">
                Vehicle No: ____________________
            </div>
        </div>

        <!-- Recipient Signature -->
        <div class="signature-box">
            <div class="signature-label">RECIPIENT</div>
            <div class="signature-details">
                Received and verified items
            </div>
            <div class="signature-line"></div>
            <div class="signature-details">
                Name: _________________________
            </div>
            <div class="signature-details">
                Signature: 
                <div style="height: 60px; margin: 10px 0; border-bottom: 1px solid #CBD5E0;"></div>
            </div>
            <div class="signature-details">
                Date: _________________________
            </div>
            <div class="signature-details">
                Time: _________________________
            </div>
        </div>
    </div>

    <div class="footer">
        <p style="margin: 0 0 8px 0;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        <p style="margin: 0 0 8px 0;">This is a system-generated internal transfer document.</p>
        <div class="caterflow-brand">
            <a href="https://synapse-digital.vercel.app/" target="_blank" style="color: #0067FF; text-decoration: none; cursor: pointer;">
                Caterflow by Synapse
            </a>
            <p>Document ID: ${transfer._id} | Printed on: ${new Date().toLocaleString()}</p>
        </div>
    </div>

    <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button onclick="window.print()" style="background: #0067FF; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;">
            Print / Save as PDF
        </button>
    </div>

    <script>
        // Add status badge styling
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) {
            const status = '${status}';
            const statusClasses = {
                'completed': 'status-completed',
                'approved': 'status-approved', 
                'pending-approval': 'status-pending',
                'draft': 'status-draft',
                'cancelled': 'status-draft'
            };
            statusBadge.classList.add(statusClasses[status] || 'status-draft');
        }
    </script>
</body>
</html>`;

    const exportWindow = window.open("", "_blank");
    if (exportWindow) {
      exportWindow.document.write(htmlContent);
      exportWindow.document.close();
      exportWindow.document.title = `Transfer - ${transferNumber}`;

      // Optional: Auto-print after a short delay
      setTimeout(() => {
        exportWindow.print();
      }, 500);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="4xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack>
              <Text>{transfer ? "Edit Transfer" : "Create New Transfer"}</Text>
              {transfer && getStatusBadge(transfer.status)}
            </HStack>
            {fromBin && isEditable && (
              <Button
                size="sm"
                leftIcon={<FiRefreshCw />}
                aria-label="Refresh stock levels from source bin"
                onClick={handleRefreshStock}
                isLoading={refreshingStock}
                variant="outline"
                ml={3}
                mt={2}
              >
                Refresh Stock
              </Button>
            )}
          </ModalHeader>
          <ModalCloseButton isDisabled={isSaving} />

          {loading ? (
            <Box p={8} textAlign="center">
              <Spinner size="xl" />
              <Text mt={4}>Loading transfer data...</Text>
            </Box>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave(isEditable ? "draft" : (transfer?.status as any));
              }}
            >
              <ModalBody>
                <VStack spacing={4} align="stretch">
                  <Grid
                    templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
                    gap={4}
                  >
                    <GridItem>
                      <FormControl isRequired>
                        <FormLabel>From Bin</FormLabel>
                        <Select
                          placeholder="Select source bin"
                          value={fromBin?._id || ""}
                          onChange={(e) => {
                            const selectedBin = allBins.find(
                              (bin) => bin._id === e.target.value,
                            );
                            setFromBin(selectedBin || null);
                          }}
                          isDisabled={!isEditable}
                        >
                          {/* Group bins by site for clarity */}
                          {Object.entries(
                            allBins.reduce(
                              (groups: Record<string, any[]>, bin: any) => {
                                const siteName =
                                  bin.site?.name || "Unknown Site";
                                if (!groups[siteName]) groups[siteName] = [];
                                groups[siteName].push(bin);
                                return groups;
                              },
                              {},
                            ),
                          ).map(([siteName, bins]) => (
                            <optgroup key={siteName} label={siteName}>
                              {(bins as any[]).map((bin) => (
                                <option key={bin._id} value={bin._id}>
                                  {bin.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </FormControl>
                    </GridItem>
                    <GridItem>
                      <FormControl isRequired>
                        <FormLabel>To Bin</FormLabel>
                        <Select
                          placeholder="Select destination bin"
                          value={toBin?._id || ""}
                          onChange={(e) => {
                            const selectedBin = allBins.find(
                              (bin) => bin._id === e.target.value,
                            );
                            setToBin(selectedBin || null);
                          }}
                          isDisabled={!isEditable}
                        >
                          {/* Group bins by site for clarity */}
                          {Object.entries(
                            allBins.reduce(
                              (groups: Record<string, any[]>, bin: any) => {
                                const siteName =
                                  bin.site?.name || "Unknown Site";
                                if (!groups[siteName]) groups[siteName] = [];
                                groups[siteName].push(bin);
                                return groups;
                              },
                              {},
                            ),
                          ).map(([siteName, bins]) => (
                            <optgroup key={siteName} label={siteName}>
                              {(bins as any[]).map((bin) => (
                                <option key={bin._id} value={bin._id}>
                                  {bin.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </FormControl>
                    </GridItem>
                  </Grid>

                  <FormControl isRequired>
                    <FormLabel>Transfer Date</FormLabel>
                    <Input
                      type="date"
                      value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                      isDisabled={!isEditable}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Notes</FormLabel>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add any notes about this transfer..."
                      isDisabled={!isEditable}
                    />
                  </FormControl>

                  <Divider />

                  <VStack spacing={4} align="stretch">
                    <HStack justify="space-between" align="center">
                      <FormLabel mb={0}>Transferred Items</FormLabel>
                      <HStack>
                        {refreshingStock && <Spinner size="sm" />}
                        {fromBin && (
                          <Text fontSize="sm" color={textSecondaryColor}>
                            Stock from: {fromBin.name}
                          </Text>
                        )}
                      </HStack>
                    </HStack>

                    {transferredItems.length === 0 ? (
                      <Box textAlign="center" py={4} color={textSecondaryColor}>
                        No items added yet
                      </Box>
                    ) : (
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
                              {!isCompleted && (
                                <Th
                                  color={tableHeaderColor}
                                  borderColor={tableBorderColor}
                                >
                                  Available Stock
                                </Th>
                              )}
                              <Th
                                color={tableHeaderColor}
                                borderColor={tableBorderColor}
                              >
                                Quantity
                              </Th>
                              {isEditable && (
                                <Th
                                  color={tableHeaderColor}
                                  borderColor={tableBorderColor}
                                >
                                  Actions
                                </Th>
                              )}
                            </Tr>
                          </Thead>
                          <Tbody>
                            {transferredItems.map((item, index) => {
                              // Add defensive check for item.stockItem
                              if (!item.stockItem) {
                                console.warn(
                                  "Skipping item with missing stockItem:",
                                  item,
                                );
                                return null;
                              }

                              const availableStock = getAvailableStock(
                                item.stockItem._id,
                              );
                              const isValid = isQuantityValid(item);
                              const stockStatus =
                                getStockStatus(availableStock);
                              const statusText =
                                getStockStatusText(availableStock);

                              return (
                                <Tr key={item._key}>
                                  <Td borderColor={tableBorderColor}>
                                    <Box>
                                      <Text fontWeight="medium">
                                        {item.stockItem.name}
                                      </Text>
                                      {item.stockItem.sku && (
                                        <Text
                                          fontSize="xs"
                                          color={textSecondaryColor}
                                        >
                                          SKU: {item.stockItem.sku}
                                        </Text>
                                      )}
                                    </Box>
                                  </Td>
                                  {!isCompleted && (
                                    <Td borderColor={tableBorderColor}>
                                      <Flex align="center">
                                        <Badge
                                          colorScheme={stockStatus.color}
                                          mr={2}
                                          size="sm"
                                        >
                                          {statusText}
                                        </Badge>
                                        <Text
                                          color={
                                            availableStock > 0
                                              ? positiveColor
                                              : negativeColor
                                          }
                                          fontWeight="bold"
                                        >
                                          {availableStock}
                                        </Text>
                                        <Text ml={1} color={textSecondaryColor}>
                                          {item.stockItem.unitOfMeasure}
                                        </Text>
                                      </Flex>
                                    </Td>
                                  )}
                                  <Td borderColor={tableBorderColor}>
                                    <Input
                                      value={
                                        item.transferredQuantity === 0
                                          ? ""
                                          : item.transferredQuantity
                                      }
                                      onChange={(e) =>
                                        handleQuantityChange(
                                          item._key,
                                          e.target.value,
                                        )
                                      }
                                      type="number"
                                      step="1"
                                      min="0"
                                      max={availableStock}
                                      size="sm"
                                      width="100px"
                                      isDisabled={!isEditable}
                                      isInvalid={!isValid && !isCompleted}
                                      placeholder="0"
                                    />
                                    {!isValid && !isCompleted && (
                                      <Text fontSize="xs" color={negativeColor}>
                                        Exceeds available stock (
                                        {availableStock})
                                      </Text>
                                    )}
                                  </Td>
                                  {isEditable && (
                                    <Td borderColor={tableBorderColor}>
                                      <HStack>
                                        <IconButton
                                          aria-label="Remove item"
                                          icon={<FiTrash2 />}
                                          size="sm"
                                          onClick={() =>
                                            handleRemoveItem(item._key)
                                          }
                                          colorScheme="red"
                                          variant="ghost"
                                        />
                                      </HStack>
                                    </Td>
                                  )}
                                </Tr>
                              );
                            })}
                          </Tbody>
                        </Table>
                      </TableContainer>
                    )}

                    {isEditable && (
                      <Button
                        leftIcon={<FiPlus />}
                        onClick={() => setIsStockItemModalOpen(true)}
                        variant="outline"
                        isDisabled={!fromBin}
                        alignSelf="flex-start"
                      >
                        Add Item
                      </Button>
                    )}
                  </VStack>
                </VStack>
              </ModalBody>

              <ModalFooter>
                <Button
                  variant="outline"
                  mr={3}
                  onClick={onClose}
                  isDisabled={isSaving}
                >
                  Cancel
                </Button>

                {isEditable ? (
                  <>
                    <Button
                      leftIcon={<FiSave />}
                      colorScheme={brandColorScheme}
                      onClick={() => handleSave("draft")}
                      isLoading={isSaving}
                      loadingText="Saving..."
                    >
                      Save Draft
                    </Button>
                    {!isNew && (
                      <Button
                        leftIcon={<FiSend />}
                        colorScheme={brandColorScheme}
                        onClick={() => handleSave("pending-approval")}
                        isLoading={isSaving}
                        ml={3}
                        isDisabled={
                          !fromBin || !toBin || transferredItems.length === 0
                        }
                      >
                        Submit for Approval
                      </Button>
                    )}
                  </>
                ) : isPendingApproval ? (
                  <Text color={neutralColorScheme} fontSize="sm">
                    Waiting for approval - read only
                  </Text>
                ) : isApproved ? (
                  <Button
                    colorScheme={brandColorScheme}
                    onClick={() => handleSave("completed")}
                    isLoading={isSaving}
                  >
                    Complete Transfer
                  </Button>
                ) : isCompleted ? (
                  <Text color={positiveColor} fontSize="sm">
                    Transfer completed - read only
                  </Text>
                ) : null}

                {/* Add this Export PDF button */}
                {transfer && (
                  <Button
                    colorScheme="blue"
                    variant="outline"
                    onClick={exportTransferPDF}
                    leftIcon={<FiFileText />}
                    ml={3}
                  >
                    Export PDF
                  </Button>
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
        }}
        onSelect={handleStockItemSelect}
        sourceBinId={fromBin?._id}
        existingItemIds={transferredItems.map((item) => item.stockItem._id)}
      />
    </>
  );
}
