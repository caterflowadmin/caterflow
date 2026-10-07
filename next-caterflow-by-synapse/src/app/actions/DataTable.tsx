'use client';
import React, { useState, useMemo, useEffect, ChangeEvent } from 'react';
import {
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Box,
    Input,
    Flex,
    Button,
    Text,
    IconButton,
    HStack,
    Select,
    chakra,
    Spinner,
    Badge,
    Checkbox,
    useColorModeValue,
} from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ChevronDownIcon } from '@chakra-ui/icons';
import { FiPackage } from 'react-icons/fi';
import { PendingAction } from './types';

// Define a flexible column type for better control over rendering
export interface Column {
    accessorKey: keyof PendingAction | string; // Use keyof PendingAction for type safety
    header: string | React.ReactNode;
    cell?: (row: any, index?: number) => React.ReactNode; // Add index parameter
    isSortable?: boolean;
}

interface DataTableProps {
    columns: Column[];
    data: any[]; // Change from PendingAction[] to any[]
    loading: boolean;
    onActionClick?: (action: any) => void; // Make optional and accept any
    hideStatusColumn?: boolean;
    actionType?: string;
    onSelectionChange?: (selectedItems: any[]) => void; // Add selection change handler
}

export default function DataTable({
    columns,
    data,
    loading,
    onActionClick,
    hideStatusColumn = false,
    actionType = '',
    onSelectionChange,
}: DataTableProps) {
    const [searchTerm, setSearchTerm] = useState('');
    // The deep search walks every row; debounce so typing stays responsive.
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm), 250);
        return () => clearTimeout(t);
    }, [searchTerm]);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [sortColumn, setSortColumn] = useState<string | null>(null); // Changed to string to handle any column
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
    const [selectedRows, setSelectedRows] = useState<any[]>([]);

    // Theme colors
    const tableBg = useColorModeValue('neutral.light.bg-card', 'neutral.dark.bg-card');
    const headerBg = useColorModeValue('neutral.light.bg-card-hover', 'neutral.dark.bg-card-hover');
    const borderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const inputBg = useColorModeValue('neutral.light.bg-input', 'neutral.dark.bg-input');
    const primaryTextColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
    const secondaryTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');
    const hoverBg = useColorModeValue('neutral.light.bg-card-hover', 'neutral.dark.bg-card-hover');
    const actionButtonColor = useColorModeValue('brand.light', 'brand.dark');

    // Only show selection for GoodsReceipt action type
    const showSelection = actionType === 'GoodsReceipt' && onSelectionChange;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'draft': return 'gray';
            case 'pending': return 'orange';
            case 'in-progress': return 'blue';
            case 'completed': return 'green';
            case 'pending-approval': return 'purple';
            default: return 'gray';
        }
    };

    // Selection handlers
    const handleSelectAll = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedRows(paginatedData);
            onSelectionChange?.(paginatedData);
        } else {
            setSelectedRows([]);
            onSelectionChange?.([]);
        }
    };

    const handleSelectRow = (row: any) => {
        let newSelectedRows;
        if (selectedRows.includes(row)) {
            newSelectedRows = selectedRows.filter(r => r !== row);
        } else {
            newSelectedRows = [...selectedRows, row];
        }
        setSelectedRows(newSelectedRows);
        onSelectionChange?.(newSelectedRows);
    };

    // Custom action button renderer based on action type
    const renderActionButton = (row: PendingAction) => {
        if (!onActionClick) return null;

        if (actionType === 'GoodsReceipt') {
            return (
                <Button
                    size="sm"
                    colorScheme="green"
                    onClick={() => onActionClick(row)}
                    leftIcon={<FiPackage />}
                >
                    {row.status === 'draft' || row.status === 'partial' ? 'Receive' : 'View'}
                </Button>
            );
        } else {
            return (
                <Button
                    size="sm"
                    colorScheme="brand"
                    onClick={() => onActionClick(row)}
                >
                    Resolve
                </Button>
            );
        }
    };

    // Custom cell renderer for description that includes stock items for PurchaseOrders
    const renderDescriptionWithItems = (row: PendingAction) => {
        if (row.actionType === 'PurchaseOrder' && row.orderedItems && row.orderedItems.length > 0) {
            return (
                <Box>
                    <Text color={primaryTextColor}>{row.description}</Text>
                    <Text fontSize="sm" color={secondaryTextColor} mt={1}>
                        Items: {row.orderedItems.map((item: any) =>
                            `${item.stockItem.name} (${item.orderedQuantity})`
                        ).join(', ')}
                    </Text>
                </Box>
            );
        }
        return <Text color={primaryTextColor}>{row.description}</Text>;
    };

    // Improved search function that recursively searches all properties
    const searchAllData = (row: any, searchTerm: string): boolean => {
        if (!searchTerm.trim()) return true;

        const searchTermLower = searchTerm.toLowerCase();

        // Recursive function to search through all object properties
        const searchObject = (obj: any): boolean => {
            if (obj === null || obj === undefined) return false;

            // Handle primitive values
            if (typeof obj === 'string') {
                return obj.toLowerCase().includes(searchTermLower);
            }

            if (typeof obj === 'number') {
                return obj.toString().includes(searchTerm);
            }

            if (typeof obj === 'boolean') {
                return obj.toString().toLowerCase().includes(searchTermLower);
            }

            // Handle Date objects
            if (obj instanceof Date) {
                return obj.toLocaleDateString().toLowerCase().includes(searchTermLower);
            }

            // Handle arrays - search through each element
            if (Array.isArray(obj)) {
                return obj.some(item => searchObject(item));
            }

            // Handle objects - search through all properties
            if (typeof obj === 'object') {
                return Object.values(obj).some(value => searchObject(value));
            }

            return false;
        };

        return searchObject(row);
    };

    // Safe property access function with nested object support
    const getPropertyValue = (obj: any, key: string): any => {
        if (!obj || !key) return undefined;

        // Handle nested properties with dot notation
        if (key.includes('.')) {
            return key.split('.').reduce((o, i) => o?.[i], obj);
        }

        return obj[key];
    };

    const processedData = useMemo(() => {
        // 1. Filter Data - search across all available information
        const filtered = data.filter((row) => searchAllData(row, debouncedSearch));

        // 2. Sort Data
        if (sortColumn && sortDirection) {
            filtered.sort((a, b) => {
                const aValue = getPropertyValue(a, sortColumn);
                const bValue = getPropertyValue(b, sortColumn);

                // Handle null/undefined values
                if (aValue == null) return sortDirection === 'asc' ? 1 : -1;
                if (bValue == null) return sortDirection === 'asc' ? -1 : 1;

                // Handle string comparison
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortDirection === 'asc'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }

                // Handle number comparison
                if (typeof aValue === 'number' && typeof bValue === 'number') {
                    return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
                }

                // Handle date comparison
                if (aValue instanceof Date && bValue instanceof Date) {
                    return sortDirection === 'asc'
                        ? aValue.getTime() - bValue.getTime()
                        : bValue.getTime() - aValue.getTime();
                }

                // Handle string dates
                const aDate = new Date(aValue);
                const bDate = new Date(bValue);
                if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
                    return sortDirection === 'asc'
                        ? aDate.getTime() - bDate.getTime()
                        : bDate.getTime() - aDate.getTime();
                }

                // Fallback: convert to string and compare
                return sortDirection === 'asc'
                    ? String(aValue).localeCompare(String(bValue))
                    : String(bValue).localeCompare(String(aValue));
            });
        }
        return filtered;
    }, [data, debouncedSearch, sortColumn, sortDirection]);

    // 3. Paginate Data
    const totalPages = Math.ceil(processedData.length / itemsPerPage);
    const paginatedData = processedData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    const handleNextPage = () => handlePageChange(currentPage + 1);
    const handlePreviousPage = () => handlePageChange(currentPage - 1);

    const handleSort = (column: string, isSortable: boolean | undefined) => {
        if (!isSortable) return;

        if (sortColumn === column) {
            // Toggle direction if same column
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // New column, start with ascending
            setSortColumn(column);
            setSortDirection('asc');
        }

        // Reset to first page when sorting
        setCurrentPage(1);
    };

    const renderSortIcon = (accessorKey: string) => {
        if (sortColumn !== accessorKey) return null;
        return sortDirection === 'asc' ? (
            <ChevronUpIcon ml={1} />
        ) : (
            <ChevronDownIcon ml={1} />
        );
    };

    // The 'action' and 'status' columns are now handled entirely by the parent component.
    const allColumns = columns;

    return (
        <Box
            p={{ base: 2, md: 4 }}
            borderRadius="md"
            borderWidth="1px"
            bg={tableBg}
            boxShadow="sm"
            sx={{ _dark: { boxShadow: 'dark-sm' } }}
        >
            <Flex
                direction={{ base: 'column', md: 'row' }}
                gap={{ base: 4, md: 8 }}
                mb={6}
                justifyContent="space-between"
                alignItems="center"
                p={4}
                borderWidth="1px"
                borderRadius="md"
                borderColor={borderColor}
            >
                <Input
                    placeholder="Search across all data..."
                    value={searchTerm}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setSearchTerm(e.target.value);
                        setCurrentPage(1); // Reset to first page on search
                    }}
                    flex={{ base: '1', md: '0.6' }}
                    bg={tableBg}
                    color={primaryTextColor}
                    _placeholder={{ color: secondaryTextColor }}
                    borderColor={borderColor}
                />
                <HStack
                    spacing={4}
                    alignItems="center"
                    mt={{ base: 4, md: 0 }}
                    flex={{ base: '1', md: '0.4' }}
                >
                    <Text flexShrink={0} fontSize="sm" color={secondaryTextColor}>
                        Items per page:
                    </Text>
                    <Select
                        value={itemsPerPage}
                        onChange={(e) => {
                            setItemsPerPage(Number(e.target.value));
                            setCurrentPage(1); // Reset to first page
                        }}
                        maxW="100px"
                        size="sm"
                        bg={tableBg}
                        borderColor={borderColor}
                    >
                        {[5, 10, 25, 50].map((size) => (
                            <option key={size} value={size}>
                                {size}
                            </option>
                        ))}
                    </Select>
                </HStack>
            </Flex>

            {
                loading ? (
                    <Flex justifyContent="center" alignItems="center" py={10}>
                        <Spinner size="xl" />
                    </Flex>
                ) : (
                    <Box overflowX="auto">
                        <Table variant="simple" size="sm" >
                            <Thead>
                                <Tr bg={headerBg}>
                                    {/* Selection column - only show for GoodsReceipt action type */}
                                    {showSelection && (
                                        <Th width="50px" borderColor={borderColor}>
                                            <Checkbox
                                                onChange={handleSelectAll}
                                                isChecked={selectedRows.length === paginatedData.length && paginatedData.length > 0}
                                                isIndeterminate={selectedRows.length > 0 && selectedRows.length < paginatedData.length}
                                            />
                                        </Th>
                                    )}
                                    {allColumns.map((column) => (
                                        <Th
                                            key={column.accessorKey}
                                            onClick={() => handleSort(column.accessorKey, column.isSortable)}
                                            cursor={column.isSortable ? 'pointer' : 'default'}
                                            _hover={{
                                                bg: column.isSortable ? hoverBg : headerBg,
                                            }}
                                            borderColor={borderColor}
                                            color={primaryTextColor}
                                            userSelect="none"
                                        >
                                            <Flex alignItems="center">
                                                {column.header}
                                                {renderSortIcon(column.accessorKey)}
                                            </Flex>
                                        </Th>
                                    ))}
                                </Tr>
                            </Thead>
                            <Tbody>
                                {paginatedData.length > 0 ? (
                                    paginatedData.map((row, rowIndex) => (
                                        <Tr key={row._id || rowIndex} _hover={{ bg: hoverBg }} borderBottomWidth="1px" borderColor={borderColor}>
                                            {/* Selection checkbox - only show for GoodsReceipt action type */}
                                            {showSelection && (
                                                <Td borderColor={borderColor}>
                                                    <Checkbox
                                                        onChange={() => handleSelectRow(row)}
                                                        isChecked={selectedRows.includes(row)}
                                                    />
                                                </Td>
                                            )}
                                            {allColumns.map((column) => (
                                                <Td
                                                    key={column.accessorKey}
                                                    color={primaryTextColor}
                                                    borderColor={borderColor}
                                                >
                                                    {column.cell ? (
                                                        column.cell(row, rowIndex)
                                                    ) : column.accessorKey === 'description' ? (
                                                        renderDescriptionWithItems(row)
                                                    ) : (
                                                        <Text>{getPropertyValue(row, column.accessorKey)}</Text>
                                                    )}
                                                </Td>
                                            ))}
                                        </Tr>
                                    ))
                                ) : (
                                    <Tr>
                                        <Td
                                            colSpan={allColumns.length + (showSelection ? 1 : 0)}
                                            textAlign="center"
                                            py={10}
                                            color={secondaryTextColor}
                                            borderColor={borderColor}
                                        >
                                            No results found.
                                        </Td>
                                    </Tr>
                                )}
                            </Tbody>
                        </Table>
                    </Box>
                )
            }

            {/* Pagination Controls */}
            <Flex justifyContent="space-between" alignItems="center" mt={4} px={2} direction={{ base: 'column', md: 'row' }}>
                <Text fontSize="sm" color={secondaryTextColor} mb={{ base: 2, md: 0 }}>
                    Showing {paginatedData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, processedData.length)} of {processedData.length} entries
                </Text>
                <HStack spacing={2}>
                    <IconButton
                        aria-label="Previous page"
                        icon={<ChevronLeftIcon />}
                        onClick={handlePreviousPage}
                        isDisabled={currentPage === 1}
                        size="sm"
                        variant="outline"
                        borderColor={borderColor}
                        color={secondaryTextColor}
                        _hover={{ bg: hoverBg }}
                        rounded="md"
                    />
                    <Text fontSize="sm" color={secondaryTextColor}>
                        Page {totalPages === 0 ? 0 : currentPage} of {totalPages === 0 ? 0 : totalPages}
                    </Text>
                    <IconButton
                        aria-label="Next page"
                        icon={<ChevronRightIcon />}
                        onClick={handleNextPage}
                        isDisabled={currentPage === totalPages || totalPages === 0}
                        size="sm"
                        variant="outline"
                        borderColor={borderColor}
                        color={secondaryTextColor}
                        _hover={{ bg: hoverBg }}
                        rounded="md"
                    />
                </HStack>
            </Flex>
        </Box >
    );
}