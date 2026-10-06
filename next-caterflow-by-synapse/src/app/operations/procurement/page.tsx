// src/app/operations/procurement/page.tsx
"use client";
import { cachedFetch } from '@/lib/clientCache';

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Box,
  Heading,
  Button,
  Flex,
  Spinner,
  useDisclosure,
  useToast,
  useColorModeValue,
  Card,
  CardBody,
  Input,
  InputGroup,
  InputLeftElement,
  Badge,
  Text,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  VStack,
  Icon,
  HStack,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Switch,
  Tooltip,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  NumberInput,
  NumberInputField,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Link,
  Progress,
} from "@chakra-ui/react";
import {
  FiPlus,
  FiSearch,
  FiEye,
  FiFilter,
  FiEdit,
  FiInfo,
  FiCheck,
  FiFileText,
} from "react-icons/fi";
import DataTable from "@/app/actions/DataTable";
import { useSession } from "next-auth/react";
import CreatePurchaseOrderModal from "@/components/CreatePurchaseOrderModal";
import PurchaseOrderModal, {
  PurchaseOrderDetails,
} from "@/components/PurchaseOrderModal";
import { PendingAction } from "@/app/actions/types";
import { StockItem, Category, Site } from "@/lib/sanityTypes";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";

interface PurchaseOrder {
  _id: string;
  poNumber: string;
  orderDate: string;
  status: string;
  site: { _id: string; name: string };
  orderedItems: Array<{
    _key: string;
    orderedQuantity: number;
    unitPrice: number;
    stockItem: {
      _id: string;
      name: string;
      sku?: string;
      unitOfMeasure: string;
      unitPrice?: number;
      primarySupplier?: { _id: string; name: string } | null;
      suppliers?: Array<{ _ref: string }>;
    };
    supplier?: { _id: string; name: string } | null;
  }>;
  totalAmount: number;
  supplierNames?: string;
}

interface Supplier {
  _id: string;
  name: string;
}

type StockItemWithSupplier = PurchaseOrder["orderedItems"][0]["stockItem"] & {
  suppliersList?: Supplier[];
};

// Sequential export helper function
// Replace the exportReportsSequentially function with this version that doesn't use toast directly:
// Sequential export helper function
// Sequential export helper function - UPDATED VERSION
const exportReportsSequentially = async (
  reports: any[],
  onProgress?: (progress: {
    current: number;
    total: number;
    fileName: string;
  }) => void,
  onPopupBlocked?: () => void,
  onError?: (error: Error) => void,
) => {
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];

    // Update progress
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
          if (onPopupBlocked) {
            onPopupBlocked();
          }
          resolve();
          return;
        }

        exportWindow.document.write(report.htmlContent);
        exportWindow.document.close();
        exportWindow.document.title = report.windowName;

        // Wait for DOM to be ready
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

        // Try to print
        setTimeout(() => {
          try {
            exportWindow.print();
          } catch (printErr) {
            console.warn("Auto-print failed:", printErr);
          }

          // Monitor window closure
          let checkCount = 0;
          const maxChecks = 300; // 30 seconds max (100ms interval)

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
        if (onError && err instanceof Error) {
          onError(err);
        }
        resolve();
      }
    });
  }

  // Final progress update
  if (onProgress) {
    onProgress({
      current: reports.length,
      total: reports.length,
      fileName: "Complete",
    });
  }
};

export default function ProcurementPage() {
  const { data: session, status } = useSession();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const {
    isOpen: isEditModalOpen,
    onOpen: onEditModalOpen,
    onClose: onEditModalClose,
  } = useDisclosure();
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockItems, setStockItems] = useState<{
    [key: string]: StockItemWithSupplier;
  }>({});
  const [editedSuppliers, setEditedSuppliers] = useState<{
    [key: string]: string | undefined;
  }>({});
  const [editedPrices, setEditedPrices] = useState<{
    [key: string]: number | undefined;
  }>({});
  const [defaultSupplierFlags, setDefaultSupplierFlags] = useState<{
    [key: string]: boolean;
  }>({});

  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [isExportProgressOpen, setIsExportProgressOpen] = useState(false);

  // Theming props - ALL HOOK CALLS MUST BE AT THE TOP LEVEL
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
  const errorBg = useColorModeValue("red.50", "red.900");
  const errorTextColor = useColorModeValue("red.500", "red.300");
  const warningAlertBg = useColorModeValue("yellow.50", "yellow.900");
  const warningAlertTitleColor = useColorModeValue("yellow.800", "yellow.100");
  const warningAlertDescriptionColor = useColorModeValue(
    "yellow.700",
    "yellow.200",
  );
  const hoverColor = useColorModeValue("gray.50", "gray.700");

  const infoAlertBg = useColorModeValue("blue.50", "blue.900");
  const infoAlertTitleColor = useColorModeValue("blue.800", "blue.100");
  const infoAlertDescriptionColor = useColorModeValue("blue.700", "blue.200");

  // Add this with your other state declarations
  const {
    isOpen: isPopupModalOpen,
    onOpen: onPopupModalOpen,
    onClose: onPopupModalClose,
  } = useDisclosure();

  /* ---------- Fetch helpers ---------- */

  const fetchApprovedPOs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/purchase-orders?status=approved");
      if (!response.ok) throw new Error("Failed to fetch purchase orders");
      const data = await response.json();
      setPurchaseOrders(data);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to load purchase orders",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await cachedFetch("/api/suppliers");
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      const data = await res.json();
      setSuppliers(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchStockItemDetails = useCallback(async (itemId: string) => {
    try {
      const response = await fetch(`/api/procurement/stock-items?id=${itemId}`);
      if (!response.ok) throw new Error("Failed to fetch stock item details");
      const data = await response.json();
      const suppliersList = (data.suppliers || []).map((s: any) => ({
        _id: s._id,
        name: s.name,
      }));
      setStockItems((prev) => ({
        ...prev,
        [itemId]: {
          ...data,
          suppliersList,
          primarySupplier: data.primarySupplier || null,
        },
      }));
      return { ...data, suppliersList };
    } catch (err) {
      console.error(err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchApprovedPOs();
      fetchSuppliers();
    }
  }, [status, fetchApprovedPOs, fetchSuppliers]);

  /* ---------- Server helpers (client calls) ---------- */

  const addSupplierToStockItem = async (itemId: string, supplierId: string) => {
    try {
      const resp = await fetch("/api/procurement/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, supplierId }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        // If supplier already exists, that's fine - we can continue
        if (errorData.error && errorData.error.includes("already exists")) {
          return { success: true, message: "Supplier already exists" };
        }
        throw new Error(
          errorData.error || "Failed to add supplier to stock item",
        );
      }

      const json = await resp.json();

      // Update local state to reflect the change
      setStockItems((prev) => {
        const s = prev[itemId];
        if (!s) return prev;
        const newSuppliersList = [...(s.suppliersList || [])];
        if (!newSuppliersList.find((x) => x._id === supplierId)) {
          newSuppliersList.push({
            _id: supplierId,
            name: suppliers.find((x) => x._id === supplierId)?.name || "",
          });
        }
        return {
          ...prev,
          [itemId]: { ...s, suppliersList: newSuppliersList },
        };
      });

      return json;
    } catch (err) {
      console.error("addSupplierToStockItem error:", err);
      throw err;
    }
  };

  const setPrimarySupplierAPI = async (itemId: string, supplierId: string) => {
    try {
      const resp = await fetch("/api/procurement/primary-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, supplierId }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to set primary supplier");
      }
      const json = await resp.json();
      setStockItems((prev) => {
        const s = prev[itemId];
        if (!s) return prev;
        return {
          ...prev,
          [itemId]: {
            ...s,
            primarySupplier: {
              _id: supplierId,
              name: suppliers.find((x) => x._id === supplierId)?.name || "",
            },
          },
        };
      });
      return json;
    } catch (err) {
      console.error("setPrimarySupplierAPI error:", err);
      throw err;
    }
  };

  const unsetPrimarySupplierAPI = async (itemId: string) => {
    try {
      const resp = await fetch("/api/procurement/stock-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, updates: { primarySupplier: null } }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to unset primary supplier");
      }
      setStockItems((prev) => {
        const s = prev[itemId];
        if (!s) return prev;
        return {
          ...prev,
          [itemId]: { ...s, primarySupplier: null },
        };
      });
      return await resp.json();
    } catch (err) {
      console.error("unsetPrimarySupplierAPI error:", err);
      throw err;
    }
  };

  const updateStockItemUnitPrice = async (
    itemId: string,
    unitPrice: number,
  ) => {
    try {
      const resp = await fetch("/api/procurement/stock-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, updates: { unitPrice } }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to update stock item price");
      }
      const json = await resp.json();
      setStockItems((prev) => {
        const s = prev[itemId];
        if (!s) return prev;
        return {
          ...prev,
          [itemId]: { ...s, unitPrice },
        };
      });
      return json;
    } catch (err) {
      console.error("updateStockItemUnitPrice error:", err);
      throw err;
    }
  };

  const updatePurchaseOrderItems = async (
    poId: string,
    updates: Array<{
      itemKey: string;
      newPrice?: number;
      newQuantity?: number;
      supplierId?: string;
    }>,
  ) => {
    try {
      const resp = await fetch("/api/purchase-orders/update-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId, updates }),
      });

      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to update purchase order items");
      }

      const json = await resp.json();
      return json;
    } catch (err) {
      console.error("updatePurchaseOrderItems error:", err);
      throw err;
    }
  };

  /* ---------- Modal actions ---------- */

  const handleEditPO = useCallback(
    async (po: PurchaseOrder) => {
      setSelectedPO(po);

      const initialSuppliers: { [key: string]: string | undefined } = {};
      const initialPrices: { [key: string]: number | undefined } = {};
      const initialDefaultFlags: { [key: string]: boolean } = {};

      for (const item of po.orderedItems) {
        let itemDetails = stockItems[item.stockItem._id];
        if (!itemDetails) {
          const fetched = await fetchStockItemDetails(item.stockItem._id);
          itemDetails = fetched || undefined;
        }

        initialSuppliers[item._key] = item.supplier?._id;
        initialPrices[item._key] =
          item.unitPrice > 0
            ? item.unitPrice * item.orderedQuantity
            : undefined;

        // Check if the selected supplier is the primary supplier
        const selectedSupplierId = item.supplier?._id;
        const isPrimary = !!(
          itemDetails?.primarySupplier?._id &&
          selectedSupplierId === itemDetails.primarySupplier._id
        );
        initialDefaultFlags[item._key] = isPrimary;

        // If we have item details but no supplier is selected yet, pre-select the primary supplier if it exists
        if (itemDetails?.primarySupplier && !selectedSupplierId) {
          initialSuppliers[item._key] = itemDetails.primarySupplier._id;
          initialDefaultFlags[item._key] = true;
        }
      }

      setEditedSuppliers(initialSuppliers);
      setEditedPrices(initialPrices);
      setDefaultSupplierFlags(initialDefaultFlags);
      onEditModalOpen();
    },
    [fetchStockItemDetails, onEditModalOpen, stockItems],
  );

  const handleSupplierChange = (
    itemKey: string,
    supplierId: string,
    stockItemId: string,
  ) => {
    setEditedSuppliers((prev) => ({ ...prev, [itemKey]: supplierId }));

    const itemDetails = stockItems[stockItemId];
    if (itemDetails?.primarySupplier?._id === supplierId) {
      setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: true }));
    } else {
      setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: false }));
    }
  };

  // Add this function with your other helper functions
  const formatCurrencyInput = (value: string) => {
    if (!value) return "";

    // Remove any non-numeric characters except decimal point
    const cleaned = value.replace(/[^\d.]/g, "");

    // Ensure only one decimal point
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      return parts[0] + "." + parts.slice(1).join("");
    }

    // Limit to 2 decimal places
    if (parts[1] && parts[1].length > 2) {
      return parts[0] + "." + parts[1].substring(0, 2);
    }

    return cleaned;
  };

  // Update your handlePriceChange function to use this formatter:
  const handlePriceChange = (itemKey: string, value: string) => {
    const formattedValue = formatCurrencyInput(value);
    const valueAsNumber = parseFloat(formattedValue);
    setEditedPrices((prev) => ({
      ...prev,
      [itemKey]: isNaN(valueAsNumber) ? undefined : valueAsNumber,
    }));
  };

  const handleDefaultSupplierToggle = async (
    itemKey: string,
    stockItemId: string,
    checked: boolean,
  ) => {
    const supplierId = editedSuppliers[itemKey];

    if (!supplierId) {
      toast({
        title: "Select supplier first",
        description: "Choose a supplier before marking as default.",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: false }));
      return;
    }

    try {
      // First ensure the supplier is added to the stock item
      await addSupplierToStockItem(stockItemId, supplierId);

      if (checked) {
        // Set as primary supplier
        await setPrimarySupplierAPI(stockItemId, supplierId);
        setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: true }));

        toast({
          title: "Default supplier set",
          description: "Primary supplier updated for this item.",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      } else {
        // Unset primary supplier
        await unsetPrimarySupplierAPI(stockItemId);
        setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: false }));

        toast({
          title: "Default supplier unset",
          description: "Primary supplier removed for this item.",
          status: "info",
          duration: 2000,
          isClosable: true,
        });
      }

      // Refresh the stock item data to reflect changes
      await fetchStockItemDetails(stockItemId);
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: err?.message || "Failed to update primary supplier.",
        status: "error",
        duration: 4000,
        isClosable: true,
      });
      // Revert the toggle state on error
      setDefaultSupplierFlags((prev) => ({ ...prev, [itemKey]: !checked }));
    }
  };

  /* ---------- Validation helpers & UI state ---------- */

  const canSaveChanges = () => {
    if (!selectedPO) return false;
    return selectedPO.orderedItems.every((item) => {
      const supplier = editedSuppliers[item._key] ?? item.supplier?._id;
      return Boolean(supplier); // Only require supplier, price is optional for saving
    });
  };

  {
    /*const canProcessPO = () => {
        if (!selectedPO) return false;
        return selectedPO.orderedItems.every(item => {
            const supplier = editedSuppliers[item._key] ?? item.supplier?._id;
            const totalPrice = editedPrices[item._key];
            return Boolean(supplier) && typeof totalPrice === 'number' && totalPrice > 0;
        });
    };*/
  }

  const canProcessPO = () => {
    if (!selectedPO) return false;
    return selectedPO.orderedItems.every((item) => {
      const supplier = editedSuppliers[item._key] ?? item.supplier?._id;
      return Boolean(supplier); // Only require supplier, price is optional
    });
  };

  const getRowError = (item: any) => {
    const supplier = editedSuppliers[item._key] ?? item.supplier?._id;
    const totalPrice = editedPrices[item._key];
    if (!supplier) return "No supplier selected";
    // Don't require price for saving, only for processing
    return null;
  };

  {
    /*const getRowWarning = (item: any) => {
        const totalPrice = editedPrices[item._key];
        if (totalPrice === undefined || totalPrice === null) return 'No price entered (required for processing)';
        if (typeof totalPrice !== 'number' || totalPrice <= 0) return 'Enter a valid price (required for processing)';
        return null;
    };*/
  }

  const getRowWarning = (item: any) => {
    const totalPrice = editedPrices[item._key];
    if (totalPrice === undefined || totalPrice === null)
      return "No price entered - will use stored unit price";
    if (typeof totalPrice !== "number" || totalPrice <= 0)
      return "Enter a valid price or leave empty to use stored price";
    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "orange";
      case "processed":
        return "green";
      default:
        return "gray";
    }
  };

  const exportSinglePO = async () => {
    if (!selectedPO) return;

    try {
      setExporting(true);
      setIsExportProgressOpen(true);

      const poData = {
        ...selectedPO,
        orderedItems: selectedPO.orderedItems.map((item) => ({
          ...item,
          supplier: editedSuppliers[item._key]
            ? suppliers.find((s) => s._id === editedSuppliers[item._key])
            : item.supplier,
          unitPrice: undefined,
        })),
      };

      const htmlContent = generatePDFHTML(poData, false);

      await exportReportsSequentially(
        [
          {
            htmlContent,
            windowName: `${selectedPO.poNumber}`,
            displayName: `${selectedPO.poNumber}.pdf`,
          },
        ],
        (progress) => {
          setExportProgress(progress);
        },
        // Popup blocked handler
        () => {
          onPopupModalOpen();
        },
        // Error handler
        (error) => {
          toast({
            title: "Export Error",
            description: error.message || "Failed to generate PDF",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        },
      );

      toast({
        title: "Export Complete",
        description: "Purchase order PDF is ready for printing",
        status: "success",
        duration: 2000,
        isClosable: true,
      });
    } catch (err: any) {
      console.error("Export failed:", err);
      toast({
        title: "Export Failed",
        description: err?.message || "Failed to generate PDF",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setExporting(false);
      setTimeout(() => {
        setIsExportProgressOpen(false);
        setExportProgress(null);
      }, 1000);
    }
  };

  const exportMultiplePOsBySupplier = async () => {
    if (!selectedPO) return;

    try {
      setExporting(true);
      setIsExportProgressOpen(true);

      // Group items by supplier with caching
      const itemsBySupplier: { [supplierId: string]: any[] } = {};
      const supplierCache: { [id: string]: Supplier | undefined } = {};

      selectedPO.orderedItems.forEach((item) => {
        const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;
        if (supplierId) {
          if (!itemsBySupplier[supplierId]) {
            itemsBySupplier[supplierId] = [];
          }
          itemsBySupplier[supplierId].push({
            ...item,
            unitPrice: undefined,
          });

          if (!supplierCache[supplierId]) {
            supplierCache[supplierId] = suppliers.find(
              (s) => s._id === supplierId,
            );
          }
        }
      });

      // Prepare reports
      const reports = Object.entries(itemsBySupplier).map(
        ([supplierId, items], index) => {
          const supplier = supplierCache[supplierId];
          const supplierPO = {
            ...selectedPO,
            orderedItems: items,
            supplierName: supplier?.name,
          };

          const supplierNameSlug = supplier?.name
            ? supplier.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()
            : "supplier";
          const windowName = `po-${selectedPO.poNumber}-${supplierNameSlug}-${index}`;
          const displayName = `${supplier?.name || "Supplier"}.pdf`;

          return {
            htmlContent: generatePDFHTML(supplierPO, true),
            windowName,
            displayName,
          };
        },
      );

      // Export sequentially with progress tracking
      await exportReportsSequentially(
        reports,
        (progress) => {
          setExportProgress(progress);
        },
        // Popup blocked handler
        () => {
          onPopupModalOpen();
        },
        // Error handler
        (error) => {
          toast({
            title: "Export Error",
            description: error.message || "Failed to generate PDF",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        },
      );

      toast({
        title: "Exports Completed",
        description: `${reports.length} PDF${reports.length !== 1 ? "s" : ""} generated successfully`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (err: any) {
      console.error("Export failed:", err);
      toast({
        title: "Export Failed",
        description: err?.message || "Failed to generate PDFs",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setExporting(false);
      setTimeout(() => {
        setIsExportProgressOpen(false);
        setExportProgress(null);
      }, 1000);
    }
  };

  // HTML generator function for PDF content
  // Replace the broken generatePDFHTML function with this corrected version:
  const generatePDFHTML = (poData: any, isSupplierSpecific: boolean) => {
    const totalItems = poData.orderedItems.reduce(
      (sum: number, item: any) => sum + item.orderedQuantity,
      0,
    );

    // Create document title
    let documentTitle = `PO-${poData.poNumber}`;
    if (isSupplierSpecific && poData.supplierName) {
      const supplierSlug = poData.supplierName.replace(/[^a-zA-Z0-9]/g, "-");
      documentTitle += `-${supplierSlug}`;
    }

    // Build items HTML efficiently
    const itemsHtml = poData.orderedItems
      .map((item: any, index: number) => {
        const supplierName = isSupplierSpecific
          ? ""
          : `<td>${item.supplier?.name || "Not assigned"}</td>`;
        return `
                <tr>
                    <td style="font-weight: 500;">${index + 1}</td>
                    <td><strong>${item.stockItem.name}</strong></td>
                    <td>${item.stockItem.sku || "N/A"}</td>
                    <td style="font-weight: 500;">${item.orderedQuantity}</td>
                    <td>${item.stockItem.unitOfMeasure}</td>
                    ${supplierName}
                </tr>
            `;
      })
      .join("");

    const supplierHeader =
      isSupplierSpecific && poData.supplierName
        ? `
        <div class="supplier-header">
            <h2>Supplier: ${poData.supplierName}</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px;">This document contains items to be quoted by ${poData.supplierName}</p>
        </div>
    `
        : "";

    return `<!DOCTYPE html>
<html>
<head>
    <title>${documentTitle}</title>
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
        
        .logo-container {
            flex-shrink: 0;
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
            box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
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
        .info-value {
            color: #151515;
            font-weight: 500;
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
        .table tr:nth-child(even) {
            background-color: #F7FAFC;
        }
        .table tr:hover {
            background-color: #EDF2F7;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #E2E8F0;
            font-size: 12px;
            color: #718096;
            text-align: center;
            background: #FFFFFF;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #E2E8F0;
        }
        .caterflow-brand {
            font-size: 11px;
            color: #0067FF;
            margin-top: 8px;
            font-style: italic;
        }
        .supplier-header {
            background-color: #EBF8FF;
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #BEE3F8;
            color: #2C5A8F;
        }
        .supplier-header h2 {
            margin: 0;
            color: #2C5A8F;
            font-size: 18px;
            font-weight: 600;
        }
        .po-number {
            font-size: 16px;
            font-weight: 600;
            color: #0067FF;
        }
        .po-date {
            font-size: 14px;
            color: #718096;
        }
        @media print {
            body { 
                margin: 25px;
                background: white;
            }
            .no-print { display: none; }
            .header-container {
                margin-bottom: 20px;
            }
            .info-section, .table, .footer {
                box-shadow: none;
                border: 1px solid #E2E8F0;
            }
        }
    </style>
</head>
<body>
<div class="header-container">
<div class="logo-container">
    <img src="pdf.png" alt="Caterflow" class="logo" />
</div>
<div class="header-content">
    <h1>PURCHASE ORDER</h1>
    <p style="font-size: 16px; margin: 5px 0;">PO Number: <strong class="po-number">${poData.poNumber}</strong></p>
    <p style="font-size: 14px; margin: 5px 0;" class="po-date">Date: ${new Date(poData.orderDate).toLocaleDateString()}</p>
</div>
</div>

    ${supplierHeader}

    <div class="info-section">
        <div class="info-grid">
            <div>
                <div class="info-item">
                    <span class="info-label">Total Items:</span>
                    <span class="info-value"> ${totalItems}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Unique Items:</span>
                    <span class="info-value"> ${poData.orderedItems.length}</span>
                </div>
            </div>
        </div>
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Item #</th>
                <th>Description</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Unit of Measure</th>
                ${!isSupplierSpecific ? "<th>Supplier</th>" : ""}
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    ${
      poData.notes
        ? `
        <div class="info-section">
            <h3 style="margin: 0 0 12px 0; color: #2D3748; font-size: 16px;">Notes:</h3>
            <p style="margin: 0; color: #4A5568; line-height: 1.5;">${poData.notes}</p>
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
        <button onclick="window.print()" style="
            background: #0067FF;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#0052CC'" onmouseout="this.style.backgroundColor='#0067FF'">
            Print / Save as PDF
        </button>
        <button onclick="window.close()" style="
            background: #718096;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-left: 10px;
            transition: background-color 0.2s;
        " onmouseover="this.style.backgroundColor='#4A5568'" onmouseout="this.style.backgroundColor='#718096'">
            Close Window
        </button>
    </div>
</body>
</html>`;
  };

  /* ---------- Columns ---------- */

  const columns = useMemo(
    () => [
      {
        accessorKey: "actions",
        header: "Actions",
        isSortable: false, // Actions column should not be sortable
        cell: (row: PurchaseOrder) => (
          <Button
            size="sm"
            colorScheme="brand"
            leftIcon={<Icon as={FiEdit} />}
            onClick={() => handleEditPO(row)}
          >
            Edit
          </Button>
        ),
      },
      {
        accessorKey: "poNumber",
        header: "PO Number",
        isSortable: true, // Enable sorting for PO numbers
        cell: (row: PurchaseOrder) => (
          <Text fontWeight="bold" color={primaryTextColor}>
            {row.poNumber}
          </Text>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        isSortable: true, // Enable sorting for status
        cell: (row: PurchaseOrder) => (
          <Badge colorScheme={getStatusColor(row.status)} variant="subtle">
            {row.status.toUpperCase()}
          </Badge>
        ),
      },
      {
        accessorKey: "site.name",
        header: "Site",
        isSortable: true, // Enable sorting for site names
        cell: (row: PurchaseOrder) => (
          <Text color={secondaryTextColor}>{row.site?.name || "N/A"}</Text>
        ),
      },
      {
        accessorKey: "items",
        header: "Items",
        isSortable: false, // Complex items column - disable sorting
        cell: (row: PurchaseOrder) => (
          <VStack align="start" spacing={1}>
            {row.orderedItems.map((item) => (
              <HStack key={item._key} spacing={2}>
                <Text fontSize="sm" color={primaryTextColor}>
                  {item.stockItem.name} ({item.orderedQuantity}{" "}
                  {item.stockItem.unitOfMeasure})
                </Text>
                {(!item.supplier || item.unitPrice <= 0) && (
                  <Badge colorScheme="red" fontSize="xs">
                    Needs Setup
                  </Badge>
                )}
                {item.supplier && item.unitPrice > 0 && (
                  <Badge colorScheme="green" fontSize="xs">
                    {item.supplier.name} - E{item.unitPrice.toFixed(2)}
                  </Badge>
                )}
              </HStack>
            ))}
          </VStack>
        ),
      },
      {
        accessorKey: "totalAmount",
        header: "Total Amount",
        isSortable: true, // Enable sorting for amounts
        cell: (row: PurchaseOrder) => (
          <Text color={primaryTextColor}>E {row.totalAmount?.toFixed(2)}</Text>
        ),
      },
      {
        accessorKey: "orderDate",
        header: "Order Date",
        isSortable: true, // Enable sorting for dates
        cell: (row: PurchaseOrder) => (
          <Text color={secondaryTextColor}>
            {new Date(row.orderDate).toLocaleDateString()}
          </Text>
        ),
      },
      {
        accessorKey: "orderedItems.length",
        header: "Item Count",
        isSortable: true, // Enable sorting for item counts
        cell: (row: PurchaseOrder) => (
          <Text color={secondaryTextColor}>
            {row.orderedItems?.length || 0} items
          </Text>
        ),
      },
      {
        accessorKey: "supplier.name",
        header: "Supplier",
        isSortable: true, // Enable sorting for supplier names
        cell: (row: PurchaseOrder) => {
          // Get the primary supplier from the first item, or show multiple
          const primarySupplier = row.orderedItems[0]?.supplier?.name;
          const uniqueSuppliers = [
            ...new Set(
              row.orderedItems
                .map((item) => item.supplier?.name)
                .filter(Boolean),
            ),
          ];

          if (uniqueSuppliers.length === 0)
            return <Text color={secondaryTextColor}>No Supplier</Text>;
          if (uniqueSuppliers.length === 1)
            return <Text color={secondaryTextColor}>{primarySupplier}</Text>;

          return (
            <Text color={secondaryTextColor}>
              {primarySupplier} +{uniqueSuppliers.length - 1} more
            </Text>
          );
        },
      },
    ],
    [handleEditPO, primaryTextColor, secondaryTextColor],
  );

  // Add this function after handleProcessPO
  const handleSaveChanges = async () => {
    if (!selectedPO) return;
    setSaving(true);

    try {
      // First, ensure all suppliers are added to stock items
      for (const item of selectedPO.orderedItems) {
        const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;

        if (supplierId) {
          // Add supplier to stock item's suppliers list
          await addSupplierToStockItem(item.stockItem._id, supplierId);

          // Set as primary supplier if marked as default
          const isDefault = defaultSupplierFlags[item._key];
          if (isDefault) {
            await setPrimarySupplierAPI(item.stockItem._id, supplierId);
          }
        }
      }

      // Then update purchase order items (even without prices)
      const updates = selectedPO.orderedItems
        .map((item) => {
          const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;
          const totalPrice = editedPrices[item._key];

          return {
            itemKey: item._key,
            supplierId: supplierId,
            newPrice: totalPrice
              ? totalPrice / item.orderedQuantity
              : undefined,
          };
        })
        .filter((update) => update.supplierId); // Only require supplier, price is optional

      // Update the purchase order items
      await updatePurchaseOrderItems(selectedPO._id, updates);

      // Update stock item prices only if provided
      for (const item of selectedPO.orderedItems) {
        const totalPrice = editedPrices[item._key];
        if (totalPrice) {
          const unitPrice = resolveUnitPrice(
            totalPrice / item.orderedQuantity,
            item.stockItem?.unitPrice,
          );
          await updateStockItemUnitPrice(item.stockItem._id, unitPrice);
        }
      }

      toast({
        title: "Success",
        description: "Changes saved successfully",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onEditModalClose();
      await fetchApprovedPOs();
    } catch (err: any) {
      console.error("Failed to save changes:", err);
      toast({
        title: "Error",
        description: err?.message || "Failed to save changes",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setSaving(false);
    }
  };

  // Replace the existing handleProcessPO function with this:
  const handleProcessPO = async () => {
    if (!selectedPO) return;
    setProcessing(true);

    try {
      // First, ensure all suppliers are added to stock items and set as primary if needed
      for (const item of selectedPO.orderedItems) {
        const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;

        if (supplierId) {
          // Add supplier to stock item's suppliers list
          await addSupplierToStockItem(item.stockItem._id, supplierId);

          // Set as primary supplier if marked as default
          const isDefault = defaultSupplierFlags[item._key];
          if (isDefault) {
            await setPrimarySupplierAPI(item.stockItem._id, supplierId);
          }
        }
      }

      {
        /*}
            // Then, update purchase order items with supplier and price information
            const updates = selectedPO.orderedItems.map(item => {
                const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;
                const totalPrice = editedPrices[item._key];

                return {
                    itemKey: item._key,
                    supplierId: supplierId,
                    newPrice: totalPrice ? totalPrice / item.orderedQuantity : undefined
                };
            }).filter(update => update.supplierId && update.newPrice);*/
      }

      const updates = selectedPO.orderedItems
        .map((item) => {
          const supplierId = editedSuppliers[item._key] ?? item.supplier?._id;
          const totalPrice = editedPrices[item._key];

          // Use stored or computed unit price
          const unitPrice = totalPrice
            ? totalPrice / item.orderedQuantity
            : resolveUnitPrice(item.unitPrice, item.stockItem?.unitPrice);

          return {
            itemKey: item._key,
            supplierId: supplierId,
            newPrice: unitPrice,
          };
        })
        .filter((update) => update.supplierId); // Only require supplier

      // Update the purchase order items
      await updatePurchaseOrderItems(selectedPO._id, updates);

      // Update stock item prices
      for (const item of selectedPO.orderedItems) {
        const totalPrice = editedPrices[item._key];
        if (totalPrice) {
          const unitPrice = resolveUnitPrice(
            totalPrice / item.orderedQuantity,
            item.stockItem?.unitPrice,
          );
          await updateStockItemUnitPrice(item.stockItem._id, unitPrice);
        }
      }

      // Finally, process the purchase order
      const response = await fetch(`/api/purchase-orders/${selectedPO._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateData: { status: "processed" } }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process purchase order");
      }

      toast({
        title: "Success",
        description: "Purchase order processed successfully",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onEditModalClose();
      await fetchApprovedPOs();
    } catch (err: any) {
      console.error("Failed to process purchase order:", err);
      toast({
        title: "Error",
        description: err?.message || "Failed to process purchase order",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setProcessing(false);
    }
  };

  // Add this component right before your return statement, after all your other functions

  const ExportProgressModal = () => (
    <Modal
      isOpen={isExportProgressOpen}
      onClose={() => {
        setIsExportProgressOpen(false);
        setExportProgress(null);
      }}
      closeOnOverlayClick={false}
      isCentered
    >
      <ModalOverlay />
      <ModalContent bg={bgCard} border="1px" borderColor={borderColor}>
        <ModalHeader color={primaryTextColor}>Exporting Reports</ModalHeader>
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {exportProgress && (
              <>
                <Progress
                  value={(exportProgress.current / exportProgress.total) * 100}
                  colorScheme="green"
                  size="sm"
                  borderRadius="full"
                />
                <Text textAlign="center" color={primaryTextColor} fontSize="sm">
                  Exporting {exportProgress.current} of {exportProgress.total}
                </Text>
                <Text
                  textAlign="center"
                  color={secondaryTextColor}
                  fontSize="xs"
                >
                  {exportProgress.fileName}
                </Text>
                <Alert status="info" size="sm" borderRadius="md">
                  <AlertIcon />
                  <Box>
                    <AlertTitle fontSize="xs">Please wait</AlertTitle>
                    <AlertDescription fontSize="xs">
                      Each report will open in a new window for printing.
                    </AlertDescription>
                  </Box>
                </Alert>
              </>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsExportProgressOpen(false);
              setExportProgress(null);
            }}
            isDisabled={exportProgress?.current !== exportProgress?.total}
          >
            {exportProgress?.current === exportProgress?.total
              ? "Close"
              : "Cancel"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );

  // Popup Blocked Modal Component (Add this after ExportProgressModal)
  const PopupBlockedModal = () => (
    <Modal
      isOpen={isPopupModalOpen}
      onClose={onPopupModalClose}
      isCentered
      size="md"
    >
      <ModalOverlay />
      <ModalContent bg={bgCard} border="1px" borderColor={borderColor}>
        <ModalHeader color={primaryTextColor}>
          <HStack spacing={2}>
            <Icon as={FiInfo} color="orange.500" />
            <Text>Popup Blocker Detected</Text>
          </HStack>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} align="stretch">
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              <Box>
                <AlertTitle>Enable Popups for This Site</AlertTitle>
                <AlertDescription>
                  Your browser is blocking popup windows, which are required for
                  PDF generation.
                </AlertDescription>
              </Box>
            </Alert>

            <Text color={secondaryTextColor} fontSize="sm">
              To generate PDF reports, please:
            </Text>

            <VStack align="start" spacing={2} pl={4}>
              <Text fontSize="sm" color={secondaryTextColor}>
                1. Look for a popup blocker icon in your address bar (🔴 or 🛡️)
              </Text>
              <Text fontSize="sm" color={secondaryTextColor}>
                2. Click it and select "Always allow popups from this site"
              </Text>
              <Text fontSize="sm" color={secondaryTextColor}>
                3. Try exporting again
              </Text>
            </VStack>

            <Box
              p={3}
              bg={infoAlertBg}
              borderRadius="md"
              border="1px"
              borderColor="blue.200"
            >
              <Text fontSize="sm" color={infoAlertDescriptionColor}>
                <strong>Tip:</strong> PDF generation will open in a new window
                for printing. You can save as PDF by choosing "Save as PDF" in
                the print dialog.
              </Text>
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing={3} width="full">
            <Button variant="ghost" onClick={onPopupModalClose} flex={1}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={() => {
                onPopupModalClose();
                // Optionally retry the last export
                toast({
                  title: "Retry Export",
                  description:
                    "Please try exporting again after enabling popups.",
                  status: "info",
                  duration: 3000,
                  isClosable: true,
                });
              }}
              flex={1}
            >
              Try Again
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );

  /* ---------- Render ---------- */

  if (status === "loading" || loading) {
    return (
      <Flex
        justifyContent="center"
        alignItems="center"
        minH="100vh"
        bg={bgPrimary}
      >
        <Spinner size="xl" />
      </Flex>
    );
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
      {/* Export Progress Modal */}
      <ExportProgressModal />
      {/* Add this near your ExportProgressModal */}
      <PopupBlockedModal />

      <VStack spacing={6} align="stretch">
        {/* Add header with requisition button */}
        <Flex justify="space-between" align="flex-start" wrap="wrap" gap={4}>
          <Box>
            <Heading
              as="h1"
              size={{ base: "xl", md: "2xl" }}
              color={primaryTextColor}
            >
              Procurement Processing
            </Heading>
            <Text color={secondaryTextColor}>
              Process approved purchase orders and manage supplier relationships
            </Text>
          </Box>

          <Button
            as={Link}
            href="/operations/procurement/requisition-summary"
            leftIcon={<Icon as={FiFileText} />}
            variant="outline"
            size="md"
          >
            Requisition Summary
          </Button>
        </Flex>

        <Card bg={bgCard} border="1px" borderColor={borderColor}>
          <CardBody>
            {purchaseOrders.length === 0 ? (
              <Text textAlign="center" color={secondaryTextColor} py={8}>
                No approved purchase orders to process
              </Text>
            ) : (
              <DataTable
                columns={columns}
                data={purchaseOrders}
                loading={loading}
              />
            )}
          </CardBody>
        </Card>
      </VStack>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={onEditModalClose}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent bg={bgCard} border="1px" borderColor={borderColor}>
          <ModalHeader color={primaryTextColor}>
            Set Suppliers & Prices: {selectedPO?.poNumber}
          </ModalHeader>
          <ModalBody>
            {selectedPO && (
              <VStack spacing={4} align="stretch">
                <Text fontSize="sm" color={secondaryTextColor}>
                  Enter <strong>total price</strong> for each item (total price
                  for the ordered quantity).
                </Text>
                <Text fontSize="sm" color={secondaryTextColor}>
                  The system will calculate the <strong>unit price</strong>{" "}
                  (total ÷ quantity) and save it to the stock item and the
                  purchase order.
                </Text>

                <TableContainer
                  border="1px"
                  borderColor={borderColor}
                  borderRadius="md"
                >
                  <Table variant="simple" size="sm">
                    <Thead>
                      <Tr>
                        <Th>Item</Th>
                        <Th>Supplier</Th>
                        <Th>Set Default</Th>
                        <Th>Total Price (E)</Th>
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {selectedPO.orderedItems.map((item) => {
                        const currentSupplier =
                          editedSuppliers[item._key] ?? item.supplier?._id;
                        const currentPrice = editedPrices[item._key];
                        const isDefault =
                          defaultSupplierFlags[item._key] ?? false;
                        const itemDetails = stockItems[item.stockItem._id];
                        const rowError = getRowError(item);

                        const totalPriceValue =
                          typeof currentPrice === "number"
                            ? currentPrice
                            : item.unitPrice > 0
                              ? item.unitPrice * item.orderedQuantity
                              : undefined;

                        return (
                          <Tr
                            key={item._key}
                            bg={rowError ? errorBg : undefined}
                            _hover={{ bg: hoverColor }}
                          >
                            <Td borderColor={borderColor}>
                              <VStack align="start" spacing={0}>
                                <Text
                                  fontWeight="medium"
                                  color={primaryTextColor}
                                >
                                  {item.stockItem.name}
                                </Text>
                                <Text fontSize="sm" color={secondaryTextColor}>
                                  {item.orderedQuantity}{" "}
                                  {item.stockItem.unitOfMeasure}
                                </Text>
                              </VStack>
                            </Td>
                            <Td borderColor={borderColor}>
                              <Select
                                value={currentSupplier || ""}
                                onChange={(e) =>
                                  handleSupplierChange(
                                    item._key,
                                    e.target.value,
                                    item.stockItem._id,
                                  )
                                }
                                size="sm"
                                minW={"120px"}
                                placeholder="Select supplier"
                                borderColor={borderColor}
                                _focus={{
                                  borderColor: accentColor,
                                  boxShadow: `0 0 0 1px ${accentColor}`,
                                }}
                              >
                                {suppliers.map((supplier) => (
                                  <option
                                    key={supplier._id}
                                    value={supplier._id}
                                  >
                                    {supplier.name}
                                  </option>
                                ))}
                              </Select>
                              {rowError === "No supplier selected" && (
                                <Text fontSize="xs" color={errorTextColor}>
                                  Select supplier
                                </Text>
                              )}
                            </Td>
                            <Td borderColor={borderColor}>
                              <Tooltip
                                label={
                                  currentSupplier
                                    ? "Mark this supplier as the default for this item"
                                    : "Select a supplier first"
                                }
                              >
                                <HStack>
                                  <Switch
                                    isChecked={isDefault}
                                    onChange={(e) =>
                                      handleDefaultSupplierToggle(
                                        item._key,
                                        item.stockItem._id,
                                        e.target.checked,
                                      )
                                    }
                                    isDisabled={!currentSupplier}
                                    colorScheme="brand"
                                  />
                                  <Icon
                                    as={FiInfo}
                                    color={secondaryTextColor}
                                    boxSize={4}
                                  />
                                </HStack>
                              </Tooltip>
                            </Td>
                            <Td borderColor={borderColor}>
                              <Input
                                value={
                                  totalPriceValue === 0 ||
                                  totalPriceValue === undefined
                                    ? ""
                                    : totalPriceValue.toFixed(2).toString()
                                }
                                onChange={(e) =>
                                  handlePriceChange(item._key, e.target.value)
                                }
                                type="number"
                                step="0.1"
                                min="0"
                                size="sm"
                                width="100px"
                                placeholder="0.00"
                              />
                              {getRowWarning(item) && (
                                <Text fontSize="xs" color="orange.500">
                                  {getRowWarning(item)}
                                </Text>
                              )}
                            </Td>
                            <Td borderColor={borderColor}>
                              {totalPriceValue !== undefined && (
                                <Text fontSize="xs" color={secondaryTextColor}>
                                  = E
                                  {(
                                    totalPriceValue / item.orderedQuantity
                                  ).toFixed(2)}{" "}
                                  per {item.stockItem.unitOfMeasure}
                                </Text>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </TableContainer>

                {!canSaveChanges() && (
                  <Alert status="warning" borderRadius="md" bg={warningAlertBg}>
                    <AlertIcon />
                    <AlertTitle color={warningAlertTitleColor}>
                      Missing suppliers
                    </AlertTitle>
                    <AlertDescription color={warningAlertDescriptionColor}>
                      Some rows are missing suppliers. You need to select
                      suppliers for all items before saving or exporting.
                    </AlertDescription>
                  </Alert>
                )}
                {canSaveChanges() && !canProcessPO() && (
                  <Alert status="info" borderRadius="md" bg={infoAlertBg}>
                    <AlertIcon />
                    <AlertTitle color={infoAlertTitleColor}>
                      Prices missing
                    </AlertTitle>
                    <AlertDescription color={infoAlertDescriptionColor}>
                      You can save without prices and continue later. Prices are
                      required for processing the PO.
                    </AlertDescription>
                  </Alert>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <VStack spacing={3} width="full">
              {/* First row - Cancel and Save buttons */}
              <HStack
                spacing={3}
                width="full"
                display={{ base: "grid", md: "flex" }}
                gridTemplateColumns={{ base: "1fr 1fr", md: "none" }}
              >
                <Button
                  variant="ghost"
                  onClick={onEditModalClose}
                  width={{ base: "full", md: "auto" }}
                >
                  Cancel
                </Button>
                <Button
                  colorScheme="brand"
                  variant="outline"
                  onClick={handleSaveChanges}
                  isLoading={saving}
                  isDisabled={!canSaveChanges()}
                  width={{ base: "full", md: "auto" }}
                >
                  Save All Changes
                </Button>
              </HStack>

              {/* Second row - Export buttons */}
              <HStack
                spacing={3}
                width="full"
                display={{ base: "grid", md: "flex" }}
                gridTemplateColumns={{ base: "1fr 1fr", md: "none" }}
              >
                <Button
                  colorScheme="green"
                  variant="outline"
                  onClick={exportSinglePO}
                  isDisabled={!canSaveChanges() || saving || exporting}
                  isLoading={exporting}
                  leftIcon={<Icon as={FiEye} />}
                  width={{ base: "full", md: "auto" }}
                >
                  {exporting ? "Exporting..." : "Export Single PO"}
                </Button>
                <Button
                  colorScheme="green"
                  variant="outline"
                  onClick={exportMultiplePOsBySupplier}
                  isDisabled={!canSaveChanges() || saving || exporting}
                  isLoading={exporting}
                  leftIcon={<Icon as={FiFilter} />}
                  width={{ base: "full", md: "auto" }}
                >
                  {exporting ? "Exporting..." : "Export by Supplier"}
                </Button>
              </HStack>

              {/* Third row - Process PO button (full width on mobile) */}
              <Button
                colorScheme="brand"
                onClick={handleProcessPO}
                isLoading={processing}
                isDisabled={!canProcessPO()}
                width="full"
                size={{ base: "md", md: "md" }}
              >
                {processing ? "Processing..." : "Process PO"}
              </Button>
            </VStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
