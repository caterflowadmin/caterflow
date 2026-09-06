"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "@chakra-ui/react";
import {
  FiPlus,
  FiSearch,
  FiEye,
  FiFilter,
  FiEdit,
  FiXCircle,
  FiCheckCircle,
} from "react-icons/fi"; // Added missing icons
import DataTable from "@/app/actions/DataTable";
import { useSession } from "next-auth/react";
import CreatePurchaseOrderModal from "@/components/CreatePurchaseOrderModal";
import PurchaseOrderModal, {
  PurchaseOrderDetails,
} from "@/components/PurchaseOrderModal";
import { PendingAction } from "@/app/actions/types";
import { StockItem, Category, Site } from "@/lib/sanityTypes";
import { resolveUnitPrice } from "@/lib/unitPriceResolver";
import { FaCheck } from "react-icons/fa";

import StockItemSelectorModal from "@/components/StockItemSelectorModal";

// Interfaces remain the same...
interface PurchaseOrderItem {
  stockItem: string;
  orderedQuantity: number;
  unitPrice: number;
  _key?: string;
}

export interface PurchaseOrder {
  _id: string;
  poNumber: string;
  orderDate: string;
  status:
    | "draft"
    | "pending"
    | "partially-received"
    | "received"
    | "cancelled"
    | "approved"
    | "pending-approval"
    | "rejected";
  totalAmount: number;
  items?: PurchaseOrderItem[];
  site?: { name: string; _id: string } | null;
  orderedBy?: string;
  orderedItems?: Array<{
    _key: string;
    orderedQuantity: number;
    unitPrice: number;
    stockItem: {
      name: string;
      _id: string;
      unitPrice?: number;
    };
    supplier: {
      name: string;
    } | null;
  }>;
  description?: string;
  title?: string;
  priority?: "high" | "medium" | "low";
  createdAt?: string;
  siteName?: string;
  actionType?: string;
  evidenceRequired?: boolean;
  evidenceStatus?: "pending" | "partial" | "complete";
  workflow?: any[];
  completedSteps?: number;
  supplierNames?: string;
}

interface OrderItem {
  stockItem: string;
  supplier: string;
  orderedQuantity: number;
  unitPrice: number;
}

export default function PurchasesPage() {
  const { data: session, status } = useSession();
  const user = session?.user;

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<"actionRequired" | "all">("all");

  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [poToSubmit, setPoToSubmit] = useState<PurchaseOrderDetails | null>(
    null,
  );

  const [selectedAction, setSelectedAction] =
    useState<PurchaseOrderDetails | null>(null);

  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  const cancelRef = useRef<HTMLButtonElement>(null);

  const {
    isOpen: isOrderModalOpen,
    onOpen: onOrderModalOpen,
    onClose: onOrderModalClose,
  } = useDisclosure();
  const [poDetails, setPoDetails] = useState<PurchaseOrderDetails | null>(null);
  const [editedPrices, setEditedPrices] = useState<{
    [key: string]: number | undefined;
  }>({});
  const [editedQuantities, setEditedQuantities] = useState<{
    [key: string]: number | undefined;
  }>({});
  const [isSaving, setIsSaving] = useState(false);

  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

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

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const response = await fetch("/api/suppliers");
        if (response.ok) {
          const data = await response.json();
          setSuppliers(data);
        }
      } catch (error) {
        console.error("Failed to fetch suppliers:", error);
      }
    };
    fetchSuppliers();
  }, []);

  useEffect(() => {
    const fetchSites = async () => {
      try {
        const response = await fetch("/api/sites");
        if (response.ok) {
          const data = await response.json();
          setSites(data);
        }
      } catch (error) {
        console.error("Failed to fetch sites:", error);
      }
    };
    fetchSites();
  }, []);

  const fetchPurchaseOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/purchase-orders");
      if (response.ok) {
        const data = await response.json();
        const transformedData = data.map((order: any) => ({
          ...order,
          siteName: order.site?.name || "",
          actionType: "PurchaseOrder",
          title: `Purchase Order ${order.poNumber}`,
          description: `Order from ${order.supplierNames}`,
          priority: "medium",
          createdAt: order.orderDate,
        }));
        setPurchaseOrders(transformedData);
      } else {
        throw new Error("Failed to fetch purchase orders");
      }
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      toast({
        title: "Error",
        description: "Failed to load purchase orders. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const filtered = searchTerm
      ? purchaseOrders.filter((order) => {
          const term = searchTerm.toLowerCase();
          const poNumberMatch = order.poNumber.toLowerCase().includes(term);
          const supplierMatch =
            order.supplierNames?.toLowerCase().includes(term) || false;
          const siteMatch =
            order.siteName?.toLowerCase().includes(term) || false;
          return poNumberMatch || supplierMatch || siteMatch;
        })
      : purchaseOrders;

    const ordersToDisplay =
      viewMode === "actionRequired"
        ? filtered.filter((order) => order.status === "draft")
        : filtered;

    // Sort by PO number, descending
    ordersToDisplay.sort((a, b) => {
      const numA = parseInt(a.poNumber.split("-")[1] || "0", 10);
      const numB = parseInt(b.poNumber.split("-")[1] || "0", 10);
      return numB - numA;
    });

    setFilteredOrders(ordersToDisplay);
  }, [purchaseOrders, searchTerm, viewMode]);

  useEffect(() => {
    fetchPurchaseOrders();
  }, [fetchPurchaseOrders]);

  // Add this useEffect after your other useEffect hooks
  useEffect(() => {
    if (poDetails && isOrderModalOpen) {
      // Initialize edited states when modal opens
      const initialQuantities: { [key: string]: number } = {};
      const initialPrices: { [key: string]: number } = {};

      poDetails.orderedItems?.forEach((item) => {
        if (item._key) {
          initialQuantities[item._key] = item.orderedQuantity;
          initialPrices[item._key] = resolveUnitPrice(
            item.unitPrice,
            (item.stockItem as any)?.unitPrice,
          );
        }
      });

      setEditedQuantities(initialQuantities);
      setEditedPrices(initialPrices);
    }
  }, [poDetails, isOrderModalOpen]);

  const handleAddOrder = () => onOpen();

  const handleRemoveItem = async (itemKey: string) => {
    if (!poDetails) return;

    try {
      // Filter out the item to be removed
      const updatedItems =
        poDetails.orderedItems?.filter((item) => item._key !== itemKey) || [];

      // Update local state
      setPoDetails((prev) =>
        prev
          ? {
              ...prev,
              orderedItems: updatedItems,
            }
          : null,
      );

      // Prepare items for API (without the removed item)
      const itemsForApi = updatedItems.map((item) => ({
        _key: item._key,
        stockItem: item.stockItem?._id,
        orderedQuantity: item.orderedQuantity,
        unitPrice: resolveUnitPrice(
          item.unitPrice,
          (item.stockItem as any)?.unitPrice,
        ),
        supplier: item.supplier?._id || null,
      }));

      // Calculate new total amount
      const totalAmount = itemsForApi.reduce(
        (acc, item) => acc + item.orderedQuantity * item.unitPrice,
        0,
      );

      // Update via API
      const response = await fetch("/api/purchase-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: poDetails._id,
          updateData: {
            orderedItems: itemsForApi,
            totalAmount,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to remove item");
      }

      toast({
        title: "Item Removed",
        description: "Item has been removed from the purchase order",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      fetchPurchaseOrders();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove item from purchase order",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleCreateOrders = async (items: OrderItem[], siteId?: string) => {
    try {
      const totalAmount = items.reduce(
        (sum, item) => sum + item.orderedQuantity * item.unitPrice,
        0,
      );

      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderDate: new Date().toISOString(),
          orderedBy: user?.id,
          orderedItems: items,
          totalAmount,
          status: "draft",
          site: siteId,
        }),
      });

      if (response.ok) {
        toast({
          title: "Purchase order created",
          status: "success",
          duration: 5000,
          isClosable: true,
        });
        onClose();
        fetchPurchaseOrders();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create purchase order");
      }
    } catch (error: any) {
      console.error("Error creating purchase order:", error);
      toast({
        title: "Error creating purchase order",
        description: error.message || "An unexpected error occurred.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleSaveOrder = async () => {
    if (!poDetails) return;
    setIsSaving(true);
    try {
      // Create the payload with updated quantities
      const updatedItems =
        poDetails.orderedItems?.map((item) => ({
          _key: item._key,
          orderedQuantity: editedQuantities[item._key] ?? item.orderedQuantity,
          unitPrice: resolveUnitPrice(
            editedPrices[item._key] ?? item.unitPrice,
            (item.stockItem as any)?.unitPrice,
          ),
          stockItem: item.stockItem?._id,
          supplier: item.supplier?._id,
        })) || [];

      // Calculate new total amount
      const totalAmount = updatedItems.reduce(
        (acc, item) => acc + item.orderedQuantity * item.unitPrice,
        0,
      );

      // Update using the PATCH endpoint
      const response = await fetch(`/api/purchase-orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: poDetails._id,
          updateData: {
            orderedItems: updatedItems,
            totalAmount,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save purchase order");
      }

      toast({
        title: "Order Saved",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      onOrderModalClose();
      fetchPurchaseOrders();

      // Reset edited states
      setEditedQuantities({});
      setEditedPrices({});
    } catch (error) {
      toast({
        title: "Save Failed",
        description: "Failed to save purchase order changes",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprovePO = async (
    action: PurchaseOrderDetails | PendingAction,
  ) => {
    try {
      const response = await fetch("/api/actions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: action._id,
          status: "pending-approval",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to submit for approval");
      }

      toast({
        title: "Order Submitted",
        description: `The purchase order has been submitted for approval.`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      fetchPurchaseOrders();
      onOrderModalClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to submit order for approval. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Add these functions for approving/rejecting POs in pending-approval status
  const handleFinalApprovePO = async (poDetails: PurchaseOrderDetails) => {
    try {
      const response = await fetch("/api/actions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: poDetails._id,
          type: "PurchaseOrder",
          status: "approved",
          approvedBy: user?.id,
          approvedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to approve purchase order");
      }

      toast({
        title: "Purchase Order Approved",
        description: `PO ${poDetails.poNumber} has been approved.`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      onOrderModalClose();
      fetchPurchaseOrders();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to approve purchase order. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleRejectPO = async (poDetails: PurchaseOrderDetails) => {
    try {
      const response = await fetch("/api/actions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: poDetails._id,
          type: "PurchaseOrder",
          status: "rejected",
          rejectedBy: user?.id,
          rejectedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to reject purchase order");
      }

      toast({
        title: "Purchase Order Rejected",
        description: `PO ${poDetails.poNumber} has been rejected.`,
        status: "info",
        duration: 5000,
        isClosable: true,
      });

      onOrderModalClose();
      fetchPurchaseOrders();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message || "Failed to reject purchase order. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleViewOrder = async (order: PurchaseOrder) => {
    try {
      const response = await fetch(`/api/purchase-orders?id=${order._id}`);
      if (!response.ok) throw new Error("Failed to fetch PO details");
      const data = await response.json();

      const detailedAction: PurchaseOrderDetails = {
        ...data,
        _type: "PurchaseOrder",
        title: `Purchase Order ${data.poNumber}`,
        description: `Order for items from ${data.supplierNames}`,
        createdAt: data.orderDate,
        priority: "medium",
        siteName: data.site?.name || "",
        actionType: "PurchaseOrder",
        evidenceRequired: false,
      };

      setPoDetails(detailedAction);
      setEditedPrices({});
      setEditedQuantities({});
      onOrderModalOpen();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to fetch purchase order details.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleAddItems = (items: any[]) => {
    if (!poDetails) return;
    const newItems = items.map((item) => ({
      _key: Math.random().toString(36).substr(2, 9),
      stockItem: { name: item.item.name, _id: item.item._id },
      orderedQuantity: item.quantity,
      unitPrice: item.price,
      supplier: item.item.primarySupplier || item.item.suppliers?.[0] || null,
    }));

    setPoDetails((prev) =>
      prev
        ? {
            ...prev,
            orderedItems: [...(prev.orderedItems || []), ...newItems],
          }
        : null,
    );
  };

  const handleConfirmSubmit = (po: PurchaseOrderDetails) => {
    setPoToSubmit(po);
    setIsConfirmDialogOpen(true);
  };

  const proceedWithOrderUpdate = async () => {
    setIsConfirmDialogOpen(false);
    if (!poDetails) return;

    setIsSaving(true);
    try {
      await handleApprovePO(poDetails);
      onOrderModalClose(); // Close the modal here after successful update and approval
    } catch (error) {
      // Error handling is done inside handleApprovePO
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddItemsToPO = async (selectedItems: any[]) => {
    if (!poDetails) return;

    try {
      // Transform selected items to match the orderedItems structure
      const newOrderedItems = selectedItems.map((item) => ({
        _key: Math.random().toString(36).substr(2, 9),
        stockItem: {
          name: item.name,
          _id: item._id,
          unitOfMeasure: item.unitOfMeasure,
          unitPrice: item.unitPrice || 0,
        },
        orderedQuantity: 1,
        unitPrice: resolveUnitPrice(undefined, item.unitPrice),
        supplier: null,
      }));

      // Update the PO details with new items
      setPoDetails((prev) =>
        prev
          ? {
              ...prev,
              orderedItems: [...(prev.orderedItems || []), ...newOrderedItems],
            }
          : null,
      );

      // Create updated items array for API
      const updatedItems = [
        ...(poDetails.orderedItems || []),
        ...newOrderedItems,
      ].map((item) => ({
        _key: item._key,
        stockItem: item.stockItem?._id,
        orderedQuantity: item.orderedQuantity,
        unitPrice: resolveUnitPrice(
          item.unitPrice,
          (item.stockItem as any)?.unitPrice,
        ),
        supplier: item.supplier?._id || null,
      }));

      // Calculate new total amount
      const totalAmount = updatedItems.reduce(
        (acc, item) => acc + item.orderedQuantity * item.unitPrice,
        0,
      );

      // Save to backend using PATCH
      const response = await fetch("/api/purchase-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: poDetails._id,
          updateData: {
            orderedItems: updatedItems,
            totalAmount,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update purchase order");
      }

      toast({
        title: "Items Added",
        description: `${selectedItems.length} item(s) added to purchase order`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      fetchPurchaseOrders(); // In PurchasesPage.tsx
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add items to purchase order",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsAddItemModalOpen(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "draft":
        return "gray";
      case "pending-approval":
        return "yellow";
      case "approved":
        return "brand";
      case "received":
        return "green";
      case "partially-received":
        return "orange";
      case "cancelled":
      case "rejected":
        return "red";
      default:
        return "gray";
    }
  };

  const getItemList = (order: PurchaseOrder) => {
    if (!order.orderedItems || order.orderedItems.length === 0)
      return "No items";
    const items = order.orderedItems
      .slice(0, 3)
      .map(
        (item) =>
          `${item.stockItem?.name || "Unknown"} (${item.orderedQuantity})`,
      );
    return items.join(", ") + (order.orderedItems.length > 3 ? "..." : "");
  };

  const columns = [
    {
      accessorKey: "workflowAction",
      header: "Action",
      isSortable: false, // Actions column should not be sortable
      cell: (row: any) => {
        const buttonText =
          row.status === "draft"
            ? "Edit"
            : row.status === "pending-approval"
              ? "Review"
              : "View";
        const colorScheme =
          row.status === "draft"
            ? "brand"
            : row.status === "pending-approval"
              ? "orange"
              : "gray";

        return (
          <Button
            size="sm"
            colorScheme={colorScheme}
            variant={row.status === "draft" ? "solid" : "outline"}
            onClick={() => handleViewOrder(row)}
            leftIcon={<Icon as={row.status === "draft" ? FiEdit : FiEye} />}
          >
            {buttonText}
          </Button>
        );
      },
    },
    {
      accessorKey: "poNumber",
      header: "PO Number",
      isSortable: true, // Enable sorting for PO numbers
      cell: (row: any) => (
        <Text fontWeight="bold" color={primaryTextColor}>
          {row.poNumber}
        </Text>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      isSortable: true, // Enable sorting for status
      cell: (row: any) => (
        <Badge colorScheme={getStatusColor(row.status)} variant="subtle">
          {row.status.replace("-", " ").toUpperCase()}
        </Badge>
      ),
    },
    {
      accessorKey: "supplierNames",
      header: "Suppliers",
      isSortable: true, // Enable sorting for supplier names
      cell: (row: any) => (
        <Text color={secondaryTextColor}>{row.supplierNames}</Text>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      isSortable: false, // Complex description field - disable sorting
      cell: (row: any) => (
        <Box>
          <Text>Items:</Text>
          <Text fontSize="sm" color={secondaryTextColor} mt={1} noOfLines={2}>
            {getItemList(row)}
          </Text>
        </Box>
      ),
    },
    {
      accessorKey: "siteName",
      header: "Site",
      isSortable: true, // Enable sorting for site names
      cell: (row: any) => <Text color={primaryTextColor}>{row.siteName}</Text>,
    },
    {
      accessorKey: "orderDate",
      header: "Order Date",
      isSortable: true, // Enable sorting for dates
      cell: (row: any) => (
        <Text color={secondaryTextColor}>
          {new Date(row.orderDate).toLocaleDateString()}
        </Text>
      ),
    },
    {
      accessorKey: "totalAmount",
      header: "Total Amount",
      isSortable: true, // Enable sorting for amounts (if available)
      cell: (row: any) => (
        <Text color={primaryTextColor}>
          E {(row.totalAmount || 0).toFixed(2)}
        </Text>
      ),
    },
    {
      accessorKey: "orderedItems.length",
      header: "Item Count",
      isSortable: true, // Enable sorting for item counts
      cell: (row: any) => (
        <Text color={secondaryTextColor}>
          {row.orderedItems?.length || 0} items
        </Text>
      ),
    },
  ];

  if (loading || status === "loading") {
    return (
      <Box p={4}>
        <Flex justifyContent="center" alignItems="center" height="50vh">
          <Spinner size="xl" />
        </Flex>
      </Box>
    );
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
      <Flex
        justifyContent="space-between"
        alignItems={{ base: "flex-start", md: "center" }}
        py={4}
        mb={6}
        flexDirection={{ base: "column", md: "row" }}
        gap={{ base: 4, md: 3 }}
      >
        <Heading
          as="h1"
          size={{ base: "xl", md: "2xl" }}
          color={primaryTextColor}
        >
          Purchase Orders
        </Heading>
        <HStack spacing={3} flexWrap="wrap">
          <Button
            leftIcon={<FiEye />}
            colorScheme="brand"
            variant={viewMode === "all" ? "solid" : "outline"}
            onClick={() => setViewMode("all")}
          >
            View All
          </Button>

          <Button
            leftIcon={<FiFilter />}
            colorScheme="brand"
            variant={viewMode === "actionRequired" ? "solid" : "outline"}
            onClick={() => setViewMode("actionRequired")}
          >
            Action Required
          </Button>

          <Button
            leftIcon={<FiPlus />}
            colorScheme="brand"
            onClick={handleAddOrder}
          >
            New Order
          </Button>
        </HStack>
      </Flex>

      <Card bg={bgCard} border="1px" borderColor={borderColor}>
        <CardBody p={0}>
          <DataTable
            columns={columns}
            data={filteredOrders}
            loading={loading}
          />
        </CardBody>
      </Card>

      {isOpen && (
        <CreatePurchaseOrderModal
          isOpen={isOpen}
          onClose={onClose}
          onSave={handleCreateOrders}
          selectedItems={selectedItems}
          suppliers={suppliers}
          sites={sites}
        />
      )}

      {poDetails && (
        <PurchaseOrderModal
          isOpen={isOrderModalOpen}
          onClose={onOrderModalClose}
          poDetails={poDetails}
          isSaving={isSaving}
          onSave={handleSaveOrder}
          onApproveRequest={() => handleConfirmSubmit(poDetails)}
          // Add these new props
          onApprovePO={() => handleFinalApprovePO(poDetails)}
          onRejectPO={() => handleRejectPO(poDetails)}
          editedPrices={editedPrices}
          setEditedPrices={setEditedPrices}
          editedQuantities={editedQuantities}
          setEditedQuantities={setEditedQuantities}
          onRemoveItem={handleRemoveItem}
          onAddItems={() => setIsAddItemModalOpen(true)}
        />
      )}

      {/* Add Items Modal */}
      {isAddItemModalOpen && poDetails && (
        <StockItemSelectorModal
          isOpen={isAddItemModalOpen}
          onClose={() => setIsAddItemModalOpen(false)}
          onSelect={handleAddItemsToPO}
          existingItemIds={
            poDetails.orderedItems
              ?.map((item) => item.stockItem?._id)
              .filter((id): id is string => !!id) || []
          }
          multiSelect={true}
        />
      )}

      <AlertDialog
        isOpen={isConfirmDialogOpen}
        onClose={() => setIsConfirmDialogOpen(false)}
        leastDestructiveRef={cancelRef}
      >
        <AlertDialogOverlay>
          <AlertDialogContent
            bg={bgCard}
            border="1px"
            borderColor={borderColor}
          >
            <AlertDialogHeader
              fontSize="lg"
              fontWeight="bold"
              color={primaryTextColor}
            >
              Confirm Submission
            </AlertDialogHeader>
            <AlertDialogBody color={secondaryTextColor}>
              Are you sure you want to submit this Purchase Order for approval?
              This action cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                variant="ghost"
                ref={cancelRef}
                onClick={() => setIsConfirmDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                onClick={proceedWithOrderUpdate}
                ml={3}
              >
                Confirm Submit
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}
