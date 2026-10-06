"use client";

import { fetchRecentThenArchive } from '@/lib/fetchRecentThenArchive';
import { logger } from '@/lib/logger';
import { useState, useEffect, useCallback, useMemo } from "react";
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
  IconButton,
  Icon,
  Text,
  HStack,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
} from "@chakra-ui/react";
import {
  FiPlus,
  FiSearch,
  FiEdit,
  FiEye,
  FiClipboard,
  FiFilter,
} from "react-icons/fi";
import DataTable from "@/components/DataTable";
import { useSession } from "next-auth/react";
import BinCountModal from "@/components/BinCountModal";

interface CountedItem {
  _key: string;
  stockItem: {
    _id: string;
    name: string;
    sku: string;
  };
  countedQuantity: number;
  systemQuantityAtCountTime?: number;
  variance?: number;
}

interface BinCount {
  _id: string;
  countNumber: string;
  countDate: string;
  status: "draft" | "in-progress" | "completed" | "adjusted";
  bin: {
    _id: string;
    name: string;
    site: {
      _id: string;
      name: string;
    };
  };
  countedBy?: {
    _id: string;
    name: string;
  };
  countedItems: any[]; // Updated to any to include varianceCost
  totalItems: number;
  totalVariance?: number;
  totalVarianceCost?: number; // ADD THIS
}

export default function BinCountsPage() {
  const { data: session, status } = useSession();
  const [binCounts, setBinCounts] = useState<BinCount[]>([]);
  const [filteredCounts, setFilteredCounts] = useState<BinCount[]>([]);
  const [selectedBinCount, setSelectedBinCount] = useState<BinCount | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<"actionRequired" | "all">("all");
  const [showCountTypeModal, setShowCountTypeModal] = useState(false);
  const [pendingCountType, setPendingCountType] = useState<
    "standard" | "adjustment"
  >("standard");

  // Theming props
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

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case "draft":
        return "orange";
      case "in-progress":
        return "blue";
      case "completed":
        return "green";
      case "adjusted":
        return "purple";
      default:
        return "gray";
    }
  }, []);

  const fetchBinCounts = useCallback(async () => {
    setLoading(true);
    try {
      await fetchRecentThenArchive<any>("/api/bin-counts", {
        dateField: "countDate",
        onData: (data) => setBinCounts(data),
      });
    } catch (error) {
      console.error("Error fetching bin counts:", error);
      toast({
        title: "Error",
        description: "Failed to load bin counts. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchBinCounts();
    }
  }, [fetchBinCounts, status]);

  // In your BinCountsPage component, update the useEffect that filters and sorts counts:
  useEffect(() => {
    let filtered = binCounts.filter((count) => {
      const term = searchTerm.toLowerCase();
      const countNumberMatch =
        count.countNumber?.toLowerCase().includes(term) || false;
      const binMatch = count.bin?.name?.toLowerCase().includes(term) || false;
      const siteMatch =
        count.bin?.site?.name?.toLowerCase().includes(term) || false;
      return countNumberMatch || binMatch || siteMatch;
    });

    const countsToDisplay =
      viewMode === "actionRequired"
        ? filtered.filter(
            (count) =>
              count.status === "draft" || count.status === "in-progress",
          )
        : filtered;

    // Sort by count number (extract numeric part for proper numerical sorting)
    countsToDisplay.sort((a, b) => {
      const extractNumber = (countNumber: string) => {
        const match = countNumber?.match(/BC-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const numA = extractNumber(a.countNumber);
      const numB = extractNumber(b.countNumber);
      return numB - numA; // Descending order (newest first)
    });

    setFilteredCounts(countsToDisplay);
  }, [binCounts, searchTerm, viewMode]);

  const handleAddBinCount = () => {
    const isAdmin = session?.user?.role === "admin";

    if (isAdmin) {
      setShowCountTypeModal(true);
    } else {
      setSelectedBinCount(null);
      setPendingCountType("standard"); // Default for non-admins
      onOpen();
    }
  };

  const handleViewOrEdit = useCallback(
    (count: BinCount) => {
      setSelectedBinCount(count);
      onOpen();
    },
    [onOpen],
  );

  const columns = useMemo(
    () => [
      {
        accessorKey: "workflowAction",
        header: "Action",
        isSortable: false, // Explicitly set to false for clarity
        cell: (row: any) => (
          <Button
            size="sm"
            colorScheme="brand"
            variant={
              row.status === "completed" || row.status === "adjusted"
                ? "outline"
                : "solid"
            }
            onClick={() => handleViewOrEdit(row)}
            leftIcon={
              <Icon
                as={
                  row.status === "completed" || row.status === "adjusted"
                    ? FiEye
                    : FiEdit
                }
              />
            }
          >
            {row.status === "completed" || row.status === "adjusted"
              ? "View"
              : "Edit"}
          </Button>
        ),
      },
      {
        accessorKey: "countNumber",
        header: "Count #",
        isSortable: true,
      },
      {
        accessorKey: "status",
        header: "Status",
        isSortable: true,
        cell: (row: any) => (
          <Badge colorScheme={getStatusColor(row.status)} variant="subtle">
            {row.status?.replace("-", " ").toUpperCase() || "UNKNOWN"}
          </Badge>
        ),
      },
      {
        accessorKey: "bin.name",
        header: "Bin",
        isSortable: true,
        cell: (row: any) => row.bin?.name || "N/A",
      },
      {
        accessorKey: "bin.site.name",
        header: "Site",
        isSortable: true,
        cell: (row: any) => row.bin?.site?.name || "N/A",
      },
      {
        accessorKey: "countDate",
        header: "Count Date",
        isSortable: true,
        cell: (row: any) => {
          try {
            return new Date(row.countDate).toLocaleDateString();
          } catch {
            return "Invalid Date";
          }
        },
      },
      {
        accessorKey: "totalItems",
        header: "Total Items",
        isSortable: true,
        cell: (row: any) => row.totalItems || 0,
      },
      {
        accessorKey: "totalVarianceCost", // Change this to access the cost field
        header: "Total Variance (E)", // Update header to indicate currency
        isSortable: true,
        cell: (row: any) => {
          // Use totalVarianceCost if available, otherwise fall back to quantity
          const value = row.totalVarianceCost ?? row.totalVariance ?? 0;

          // Format as Emalangeni currency
          const formattedValue = new Intl.NumberFormat("en-SZ", {
            style: "currency",
            currency: "SZL",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(value);

          return (
            <Badge
              colorScheme={
                value !== 0 ? (value > 0 ? "orange" : "red") : "green"
              }
              variant="subtle"
            >
              {formattedValue}
            </Badge>
          );
        },
      },
      {
        accessorKey: "countedBy.name",
        header: "Counted By",
        isSortable: true,
        cell: (row: any) => row.countedBy?.name || "N/A",
      },
      {
        accessorKey: "adjustedBy.name",
        header: "Adjusted By",
        isSortable: true,
        cell: (row: any) => row.adjustedBy?.name || "N/A",
      },
      {
        accessorKey: "adjustedAt",
        header: "Adjusted At",
        isSortable: true,
        cell: (row: any) => {
          if (!row.adjustedAt) return "N/A";
          try {
            return new Date(row.adjustedAt).toLocaleDateString();
          } catch {
            return "Invalid Date";
          }
        },
      },
      {
        accessorKey: "notes",
        header: "Notes",
        isSortable: false, // Text content - disable sorting
        cell: (row: any) => (
          <Text fontSize="sm" color={secondaryTextColor} noOfLines={2}>
            {row.notes || "No notes"}
          </Text>
        ),
      },
    ],
    [handleViewOrEdit, getStatusColor, secondaryTextColor],
  );

  if (loading || status === "loading") {
    return (
      <Box p={{ base: 4, md: 8 }} bg={bgPrimary}>
        <Flex justifyContent="center" alignItems="center" height="50vh">
          <Spinner size="xl" />
        </Flex>
      </Box>
    );
  }

  return (
    <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
      <VStack spacing={{ base: 4, md: 6 }} align="stretch">
        <Flex
          justifyContent="space-between"
          alignItems={{ base: "flex-start", md: "center" }}
          flexDirection={{ base: "column", md: "row" }}
          gap={{ base: 4, md: 3 }}
        >
          <Heading
            as="h1"
            size={{ base: "xl", md: "2xl" }}
            color={primaryTextColor}
          >
            Bin Counts
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
              onClick={handleAddBinCount}
            >
              New Count
            </Button>
          </HStack>
        </Flex>

        {/* Bin Counts Table */}
        <Card bg={bgCard} border="1px" borderColor={borderColor}>
          <CardBody p={0}>
            <DataTable
              columns={columns}
              data={filteredCounts}
              loading={false}
            />
          </CardBody>
        </Card>

        <BinCountModal
          isOpen={isOpen}
          onClose={() => {
            onClose();
            // Reset to standard for next time
            setPendingCountType("standard");
          }}
          binCount={selectedBinCount}
          onSave={fetchBinCounts}
          countType={pendingCountType}
        />

        {/* Count Type Selection Modal (Admin Only) */}
        <Modal
          isOpen={showCountTypeModal}
          onClose={() => setShowCountTypeModal(false)}
          size="sm"
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Select Count Type</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <VStack spacing={4} py={4}>
                <Button
                  w="100%"
                  size="lg"
                  colorScheme="brand"
                  onClick={() => {
                    setPendingCountType("standard");
                    setSelectedBinCount(null);
                    setShowCountTypeModal(false);
                    onOpen();
                  }}
                  leftIcon={<FiClipboard />}
                >
                  Standard Count
                </Button>

                <Button
                  w="100%"
                  size="lg"
                  colorScheme="orange"
                  onClick={() => {
                    setPendingCountType("adjustment");
                    setSelectedBinCount(null);
                    setShowCountTypeModal(false);
                    onOpen();
                  }}
                  leftIcon={<FiEdit />}
                >
                  Adjustment Count
                </Button>
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>
      </VStack>
    </Box>
  );
}
