import { logger } from '@/lib/logger';
// Enhanced StockItemSelectorModal.tsx with better scrolling UX
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalCloseButton,
    ModalBody,
    ModalFooter,
    Button,
    VStack,
    HStack,
    Input,
    Select,
    Box,
    Text,
    Badge,
    useToast,
    InputGroup,
    InputLeftElement,
    InputRightElement,
    Spinner,
    useColorModeValue,
    Checkbox,
    Flex,
    Icon,
    Tooltip,
    SimpleGrid,
    Progress,
    IconButton,
} from '@chakra-ui/react';
import { FiSearch, FiCheck, FiX, FiFilter, FiPackage, FiShoppingCart } from 'react-icons/fi';

interface StockItem {
    _id: string;
    name: string;
    sku: string;
    itemType: 'food' | 'nonFood';
    unitOfMeasure: string;
    description?: string;
    category?: {
        _id: string;
        title: string;
    };
    currentStock?: number;
    unitPrice?: number;
    minStockLevel?: number;
    maxStockLevel?: number;
}

interface Category {
    _id: string;
    title: string;
}

interface StockItemSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (items: StockItem[]) => void;
    existingItemIds: (string | undefined)[];
    sourceBinId?: string;
    multiSelect?: boolean;
    showStockLevels?: boolean;
    showPrices?: boolean;
}

export default function StockItemSelectorModal({
    isOpen,
    onClose,
    onSelect,
    existingItemIds,
    sourceBinId,
    multiSelect = true,
    showStockLevels = true,
    showPrices = true
}: StockItemSelectorModalProps) {
    const [stockItems, setStockItems] = useState<StockItem[]>([]);
    const [filteredItems, setFilteredItems] = useState<StockItem[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedItems, setSelectedItems] = useState<StockItem[]>([]);
    const toast = useToast();
    const itemsContainerRef = useRef<HTMLDivElement>(null);

    const [showOnlyWithStock, setShowOnlyWithStock] = useState(true);

    const [allBins, setAllBins] = useState<any[]>([]);

    // Theme-aware colors
    const searchIconColor = useColorModeValue('neutral.light.icon-color', 'neutral.dark.icon-color');
    const noItemsTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');
    const listItemHoverBg = useColorModeValue('neutral.light.bg-secondary', 'neutral.dark.bg-card-hover');
    const listItemBorderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const footerBorderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const selectedItemBg = useColorModeValue('blue.50', 'blue.900');
    const scrollbarThumbColor = useColorModeValue('gray.300', 'gray.600');
    const scrollbarTrackColor = useColorModeValue('gray.100', 'gray.800');

    const fetchStockItems = useCallback(async () => {
        setLoading(true);
        try {
            const binsRes = await fetch('/api/bins');
            if (binsRes.ok) {
                const binsData = await binsRes.json();
                setAllBins(binsData);
            }

            // 1. First, fetch items quickly without stock data
            const url = sourceBinId ? `/api/stock-items?binId=${sourceBinId}` : '/api/stock-items';
            const itemsRes = await fetch(url);

            if (!itemsRes.ok) {
                throw new Error('Failed to fetch stock items');
            }

            let itemsData = await itemsRes.json();

            // Set items immediately so modal shows quickly
            setStockItems(itemsData);

            // Fetch categories in parallel
            const categoriesRes = await fetch('/api/categories');
            if (categoriesRes.ok) {
                const categoriesData = await categoriesRes.json();
                setCategories(categoriesData);
            }

            // 2. Then, fetch stock data in the background
            if (sourceBinId && itemsData.length > 0) {
                // Don't wait for this - let it run in background
                fetchStockDataInBackground(itemsData, sourceBinId);
            } else {
                setLoading(false);
            }

        } catch (error) {
            console.error('Error fetching stock items:', error);
            toast({
                title: 'Error fetching stock items.',
                description: 'Failed to load stock items.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
            setLoading(false);
        }
    }, [sourceBinId, toast]);

    // Add this new function for background stock fetching
    const fetchStockDataInBackground = async (items: StockItem[], binId: string) => {
        try {
            // Use bulk API for better performance
            const stockRes = await fetch('/api/stock/bulk-current', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stockItems: items.map(item => item._id),
                    binId: binId
                })
            });

            if (stockRes.ok) {
                const stockData = await stockRes.json();

                // Update items with stock data
                const updatedItems = items.map(item => ({
                    ...item,
                    currentStock: stockData.results[item._id] || 0
                }));

                // Filter out items with zero stock
                const itemsWithStock = updatedItems.filter(item =>
                    (item.currentStock || 0) > 0
                );

                setStockItems(itemsWithStock);

                logger.debug(`📊 Updated ${items.length} items with stock data`);
            }
        } catch (error) {
            console.error('Background stock fetch failed:', error);
            // Don't show error to user - they already have items
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchStockItems();
            setSelectedItems([]);
        }
    }, [isOpen, fetchStockItems]);

    // Memoize filtered items for better performance
    const memoizedFilteredItems = useMemo(() => {
        const lowercasedSearchTerm = searchTerm.toLowerCase();

        let items = stockItems.filter(item =>
            (selectedCategory === '' || item.category?._id === selectedCategory) &&
            (item.name.toLowerCase().includes(lowercasedSearchTerm) ||
                item.sku.toLowerCase().includes(lowercasedSearchTerm) ||
                (item.description && item.description.toLowerCase().includes(lowercasedSearchTerm)))
        );

        // Apply stock filter if enabled
        if (showOnlyWithStock && sourceBinId) {
            items = items.filter(item => (item.currentStock || 0) > 0);
        }

        // Sort: items with stock first, then alphabetically
        items.sort((a, b) => {
            const aHasStock = (a.currentStock || 0) > 0;
            const bHasStock = (b.currentStock || 0) > 0;

            if (aHasStock && !bHasStock) return -1;
            if (!aHasStock && bHasStock) return 1;

            return a.name.localeCompare(b.name);
        });

        return items;
    }, [searchTerm, selectedCategory, stockItems, showOnlyWithStock, sourceBinId]);

    useEffect(() => {
        setFilteredItems(memoizedFilteredItems);
    }, [memoizedFilteredItems]);

    const handleItemSelect = (item: StockItem) => {
        if (multiSelect) {
            setSelectedItems(prev => {
                const isAlreadySelected = prev.some(selected => selected._id === item._id);
                if (isAlreadySelected) {
                    return prev.filter(selected => selected._id !== item._id);
                } else {
                    return [...prev, item];
                }
            });
        } else {
            onSelect([item]);
            onClose();
        }
    };

    const handleConfirmSelection = () => {
        if (selectedItems.length === 0) {
            setTimeout(() => {
                toast({
                    title: 'No items selected',
                    description: 'Please select at least one item.',
                    status: 'warning',
                    duration: 3000,
                    isClosable: true,
                });
            }, 0);
            return;
        }
        onSelect(selectedItems);
        onClose();
    };

    const isItemSelected = (itemId: string) => {
        return selectedItems.some(item => item._id === itemId);
    };

    const getItemTypeColor = (itemType: 'food' | 'nonFood') => {
        return itemType === 'food' ? 'orange' : 'teal';
    };

    const getStockLevelColor = (item: StockItem) => {
        if (!item.minStockLevel || !item.maxStockLevel || item.currentStock === undefined) return 'gray';
        const percentage = (item.currentStock / item.maxStockLevel) * 100;
        if (percentage <= 20) return 'red';
        if (percentage <= 50) return 'orange';
        return 'green';
    };

    const getStockLevelText = (item: StockItem) => {
        if (!item.minStockLevel || !item.maxStockLevel || item.currentStock === undefined) return 'N/A';
        if (item.currentStock <= item.minStockLevel) return 'Low Stock';
        if (item.currentStock >= item.maxStockLevel) return 'Overstocked';
        return 'In Stock';
    };

    const isItemInDispatch = useCallback((itemId: string) => {
        return existingItemIds.includes(itemId);
    }, [existingItemIds]);

    const clearFilters = () => {
        setSearchTerm('');
        setSelectedCategory('');
    };

    const clearSelection = () => {
        setSelectedItems([]);
    };

    const selectAll = () => {
        if (filteredItems.length > 0) {
            setSelectedItems(filteredItems);
        }
    };

    const getBinName = useCallback(() => {
        if (!sourceBinId) return '';
        const bin = allBins.find(b => b._id === sourceBinId);
        return bin ? bin.name : 'Loading...';
    }, [sourceBinId, allBins]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="4xl"
            closeOnOverlayClick={false}
            scrollBehavior="outside"
            motionPreset="slideInBottom"
        >
            <ModalOverlay backdropFilter="blur(4px)" />
            <ModalContent
                maxH="85vh"
                display="flex"
                flexDirection="column"
            >
                <ModalHeader borderBottomWidth="1px" flexShrink={0}>
                    <VStack align="start" spacing={3} w="full">
                        <Flex justify="space-between" align="center" w="full">
                            <HStack spacing={2}>
                                <Icon as={FiShoppingCart} boxSize={5} />
                                <VStack align="start" spacing={0}>
                                    <Text fontSize="xl" fontWeight="bold">
                                        Select Stock Items
                                        {sourceBinId && (
                                            <Text as="span" fontWeight="normal" color="gray.600" ml={2}>
                                                - {getBinName()}
                                            </Text>
                                        )}
                                    </Text>
                                    {sourceBinId && (
                                        <Text fontSize="sm" color="gray.500" fontWeight="normal">
                                            {filteredItems.filter(item => (item.currentStock || 0) > 0).length} items with stock available
                                        </Text>
                                    )}
                                </VStack>
                            </HStack>
                            {multiSelect && selectedItems.length > 0 && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    colorScheme="red"
                                    onClick={clearSelection}
                                    leftIcon={<FiX />}
                                >
                                    Clear ({selectedItems.length})
                                </Button>
                            )}
                        </Flex>

                        {multiSelect && (
                            <Flex align="center" gap={4} w="full">
                                <Badge colorScheme="blue" variant="solid">
                                    {selectedItems.length} item(s) selected
                                </Badge>
                                <Text fontSize="sm" color="gray.600">
                                    {filteredItems.length} items total
                                </Text>
                                {!sourceBinId && (
                                    <Badge colorScheme="purple" variant="outline">
                                        Select a bin to see stock
                                    </Badge>
                                )}
                            </Flex>
                        )}
                    </VStack>
                </ModalHeader>
                <ModalCloseButton />

                <ModalBody
                    py={4}
                    flex="1"
                    overflow="hidden"
                    display="flex"
                    flexDirection="column"
                    minHeight="0"
                    onWheel={(e) => {
                        // Pass wheel events to the scrollable container
                        if (itemsContainerRef.current) {
                            itemsContainerRef.current.scrollTop += e.deltaY;
                            e.preventDefault();
                        }
                    }}
                >
                    <VStack spacing={4} align="stretch" flex="1" overflow="hidden" minHeight="0">
                        {/* Search and Filters */}
                        <VStack spacing={3} align="stretch" flexShrink={0}>
                            <InputGroup size="lg">
                                <InputLeftElement pointerEvents="none">
                                    <FiSearch color={searchIconColor} />
                                </InputLeftElement>
                                <Input
                                    placeholder="Search by name, SKU, or description..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    autoFocus
                                />
                                {searchTerm && (
                                    <InputRightElement>
                                        <Icon
                                            as={FiX}
                                            cursor="pointer"
                                            onClick={() => setSearchTerm('')}
                                            color="gray.500"
                                            _hover={{ color: 'gray.700' }}
                                        />
                                    </InputRightElement>
                                )}
                            </InputGroup>

                            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                                <Select
                                    placeholder="All Categories"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    size="md"
                                >
                                    {categories.map(category => (
                                        <option key={category._id} value={category._id}>
                                            {category.title}
                                        </option>
                                    ))}
                                </Select>

                                <HStack spacing={2}>
                                    <Button
                                        size="md"
                                        variant="outline"
                                        onClick={clearFilters}
                                        isDisabled={!searchTerm && !selectedCategory}
                                        leftIcon={<FiFilter />}
                                        flex="1"
                                    >
                                        Clear Filters
                                    </Button>
                                    {multiSelect && filteredItems.length > 0 && (
                                        <Button
                                            size="md"
                                            variant="outline"
                                            onClick={selectAll}
                                            colorScheme="blue"
                                        >
                                            Select All
                                        </Button>
                                    )}
                                </HStack>
                            </SimpleGrid>
                        </VStack>

                        {/* Items List Container */}
                        <Box
                            ref={itemsContainerRef}
                            flex="1"
                            overflowY="auto"
                            borderRadius="md"
                            borderWidth="1px"
                            borderColor={listItemBorderColor}
                            p={2}
                            minHeight="0"
                            onWheel={(e) => {
                                // Allow wheel scrolling even when pointer is over nested elements
                                e.stopPropagation();
                            }}
                            sx={{
                                '&::-webkit-scrollbar': {
                                    width: '10px',
                                },
                                '&::-webkit-scrollbar-track': {
                                    background: scrollbarTrackColor,
                                    borderRadius: '5px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    background: scrollbarThumbColor,
                                    borderRadius: '5px',
                                    '&:hover': {
                                        background: useColorModeValue('gray.400', 'gray.500'),
                                    }
                                },
                                // Fix for wheel scrolling
                                pointerEvents: 'auto',
                            }}
                        >
                            {loading ? (
                                <Flex direction="column" align="center" justify="center" py={10} h="full">
                                    <Spinner size="xl" color="blue.500" thickness="3px" />
                                    <Text mt={4} color="gray.600">Loading stock items...</Text>
                                </Flex>
                            ) : filteredItems.length === 0 ? (
                                <Flex direction="column" align="center" justify="center" py={10} h="full">
                                    <Icon as={FiPackage} boxSize={12} color="gray.400" mb={4} />
                                    <Text fontSize="lg" color={noItemsTextColor} fontWeight="medium">
                                        {searchTerm || selectedCategory ? 'No items match your search.' : 'No stock items available.'}
                                    </Text>
                                    {(searchTerm || selectedCategory) && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={clearFilters}
                                            mt={3}
                                        >
                                            Clear filters to see all items
                                        </Button>
                                    )}
                                </Flex>
                            ) : (
                                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}
                                    overflow="visible"
                                    minHeight="0"
                                >
                                    {filteredItems.map((item) => {
                                        const isSelected = isItemSelected(item._id);
                                        const stockLevelColor = getStockLevelColor(item);
                                        const stockLevelText = getStockLevelText(item);

                                        return (
                                            <Box
                                                key={item._id}
                                                maxHeight="180px"
                                                p={3}
                                                borderWidth="2px"
                                                borderColor={isSelected ? 'blue.500' :
                                                    isItemInDispatch(item._id) ? 'orange.300' :
                                                        (item.currentStock || 0) <= 0 && sourceBinId ? 'gray.300' : listItemBorderColor}
                                                borderRadius="lg"
                                                bg={isSelected ? selectedItemBg :
                                                    isItemInDispatch(item._id) ? 'orange.50' :
                                                        (item.currentStock || 0) <= 0 && sourceBinId ? 'gray.50' : 'transparent'}
                                                _hover={{
                                                    bg: isSelected ? selectedItemBg :
                                                        isItemInDispatch(item._id) ? 'orange.100' :
                                                            (item.currentStock || 0) <= 0 && sourceBinId ? 'gray.100' : listItemHoverBg,
                                                    borderColor: isSelected ? 'blue.500' :
                                                        isItemInDispatch(item._id) ? 'orange.500' :
                                                            (item.currentStock || 0) <= 0 && sourceBinId ? 'gray.400' : 'blue.300',
                                                    cursor: (item.currentStock || 0) <= 0 && sourceBinId ? 'not-allowed' : 'pointer',
                                                    transform: (item.currentStock || 0) <= 0 && sourceBinId ? 'none' : 'translateY(-2px)',
                                                }}
                                                onClick={() => {
                                                    if ((item.currentStock || 0) <= 0 && sourceBinId) {
                                                        setTimeout(() => {
                                                            toast({
                                                                title: 'No stock available',
                                                                description: `"${item.name}" has no stock in this bin`,
                                                                status: 'warning',
                                                                duration: 2000,
                                                                isClosable: true,
                                                            });
                                                        }, 0);
                                                        return;
                                                    }
                                                    handleItemSelect(item);
                                                }}
                                                onTouchStart={(e) => e.stopPropagation()} // Prevent touch event bubbling
                                                position="relative"
                                                transition="all 0.2s"
                                                sx={{
                                                    // Ensure touch events work properly
                                                    touchAction: 'manipulation',
                                                    userSelect: 'none',
                                                    WebkitTapHighlightColor: 'transparent',
                                                    // Fix wheel scrolling
                                                    pointerEvents: 'auto',
                                                    '& *': {
                                                        pointerEvents: 'auto',
                                                    },
                                                    '&:hover': {
                                                        overflowY: 'auto',
                                                    },
                                                }}
                                                opacity={(item.currentStock || 0) <= 0 && sourceBinId ? 0.7 : 1}
                                                pointerEvents={(item.currentStock || 0) <= 0 && sourceBinId ? 'none' : 'auto'}
                                            >
                                                <HStack align="start" spacing={3}>
                                                    {multiSelect && (
                                                        <Checkbox
                                                            isChecked={isSelected}
                                                            onChange={() => handleItemSelect(item)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            size="lg"
                                                            colorScheme="blue"
                                                            mt={1}
                                                            sx={{
                                                                // Ensure checkbox is tappable
                                                                pointerEvents: 'auto',
                                                            }}
                                                        />
                                                    )}
                                                    <VStack align="start" spacing={2} flex="1">
                                                        <HStack justify="space-between" w="full">
                                                            <Text fontWeight="bold" fontSize="md" noOfLines={1}>
                                                                {item.name}
                                                            </Text>
                                                            <HStack spacing={2}>
                                                                <Badge
                                                                    colorScheme={getItemTypeColor(item.itemType)}
                                                                    variant="subtle"
                                                                >
                                                                    {item.itemType}
                                                                </Badge>
                                                                {isItemInDispatch(item._id) && (
                                                                    <Badge
                                                                        colorScheme="orange"
                                                                        variant="solid"
                                                                        size="sm"
                                                                    >
                                                                        Already in Dispatch
                                                                    </Badge>
                                                                )}
                                                                {/* Show "No Stock" badge for items with zero or undefined stock */}
                                                                {(item.currentStock === 0 || item.currentStock === undefined) && sourceBinId && (
                                                                    <Badge
                                                                        colorScheme="red"
                                                                        variant="subtle"
                                                                        size="sm"
                                                                    >
                                                                        No Stock
                                                                    </Badge>
                                                                )}
                                                                {showStockLevels && item.minStockLevel && item.maxStockLevel && item.currentStock !== undefined && item.currentStock > 0 && (
                                                                    <Badge
                                                                        colorScheme={getStockLevelColor(item)}
                                                                        variant="solid"
                                                                        size="sm"
                                                                    >
                                                                        {getStockLevelText(item)}
                                                                    </Badge>
                                                                )}
                                                            </HStack>
                                                        </HStack>

                                                        <HStack spacing={4} w="full">
                                                            <VStack align="start" spacing={0}>
                                                                <Text fontSize="sm" color="gray.600" fontWeight="medium">
                                                                    SKU: {item.sku}
                                                                </Text>
                                                                <Text fontSize="sm" color="gray.600">
                                                                    Unit: {item.unitOfMeasure}
                                                                </Text>
                                                            </VStack>

                                                            {showPrices && item.unitPrice && (
                                                                <Badge
                                                                    colorScheme="green"
                                                                    variant="solid"
                                                                    fontSize="sm"
                                                                >
                                                                    E {item.unitPrice.toFixed(2)}
                                                                </Badge>
                                                            )}
                                                        </HStack>

                                                        {item.description && (
                                                            <Text fontSize="sm" color="gray.700" noOfLines={2}>
                                                                {item.description}
                                                            </Text>
                                                        )}

                                                        {/* Always show current stock if we have it */}
                                                        {item.currentStock !== undefined && (
                                                            <VStack align="start" spacing={1} w="full">
                                                                <HStack justify="space-between" w="full">
                                                                    <Text fontSize="sm" fontWeight="medium">
                                                                        Current Stock:
                                                                    </Text>
                                                                    <Text fontSize="sm" fontWeight="bold" color={getStockLevelColor(item)}>
                                                                        {item.currentStock.toFixed(3)} {item.unitOfMeasure}
                                                                    </Text>
                                                                </HStack>
                                                                {item.currentStock !== undefined && item.maxStockLevel && (
                                                                    <Tooltip
                                                                        label={`Min: ${item.minStockLevel || 'N/A'} | Max: ${item.maxStockLevel}`}
                                                                        placement="top"
                                                                    >
                                                                        <Progress
                                                                            value={(item.currentStock / item.maxStockLevel) * 100}
                                                                            colorScheme={getStockLevelColor(item)}
                                                                            size="sm"
                                                                            borderRadius="full"
                                                                            w="full"
                                                                        />
                                                                    </Tooltip>
                                                                )}
                                                            </VStack>
                                                        )}
                                                    </VStack>
                                                    {isSelected && multiSelect && (
                                                        <Icon
                                                            as={FiCheck}
                                                            color="green.500"
                                                            boxSize={5}
                                                            position="absolute"
                                                            top={2}
                                                            right={2}
                                                        />
                                                    )}
                                                </HStack>
                                            </Box>
                                        );
                                    })}
                                </SimpleGrid>
                            )}
                        </Box>

                        {/* Selected Items Summary (when multi-select) 
                        {multiSelect && selectedItems.length > 0 && (
                            <Box
                                p={3}
                                borderRadius="md"
                                bg="blue.50"
                                borderWidth="1px"
                                borderColor="blue.200"
                                flexShrink={0}
                            >
                                <VStack align="start" spacing={2}>
                                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={2} w="full">
                                        <HStack>
                                            <Icon as={FiCheck} color="green.500" />
                                            <Text fontWeight="bold">Selected Items Summary</Text>
                                        </HStack>
                                        <HStack>
                                            <Text fontSize="sm">Total Items:</Text>
                                            <Badge colorScheme="blue">{selectedItems.length}</Badge>
                                        </HStack>
                                    </SimpleGrid>
                                </VStack>
                            </Box>
                        )}*/}
                    </VStack>
                </ModalBody>

                <ModalFooter
                    borderTop="1px solid"
                    borderColor={footerBorderColor}
                    pt={4}
                    pb={4}
                    flexShrink={0}
                >
                    <HStack spacing={4} w="full" justify="space-between" align="center">
                        {/* Left side: Cancel button */}
                        <Button variant="ghost" onClick={onClose} size="md">
                            Cancel
                        </Button>

                        {/* Middle: Filter icons and selected count */}
                        <HStack spacing={2} flex="1" justify="center" align="center">
                            {/* Stock filter icon */}
                            {sourceBinId && (
                                <Tooltip
                                    label={showOnlyWithStock ? "Showing only items with stock" : "Showing all items"}
                                    placement="top"
                                >
                                    <IconButton
                                        aria-label={showOnlyWithStock ? "Showing only in-stock items" : "Showing all items"}
                                        icon={<FiPackage />}
                                        size="sm"
                                        variant={showOnlyWithStock ? "solid" : "outline"}
                                        colorScheme="blue"
                                        onClick={() => setShowOnlyWithStock(!showOnlyWithStock)}
                                        isRound
                                    />
                                </Tooltip>
                            )}

                            {/* Clear filters icon */}
                            <Tooltip
                                label="Clear all filters"
                                placement="top"
                            >
                                <IconButton
                                    aria-label="Clear filters"
                                    icon={<FiFilter />}
                                    size="sm"
                                    variant="outline"
                                    onClick={clearFilters}
                                    isDisabled={!searchTerm && !selectedCategory && !showOnlyWithStock}
                                    isRound
                                />
                            </Tooltip>

                            {/* Select all icon (only for multi-select) */}
                            {multiSelect && filteredItems.length > 0 && (
                                <Tooltip
                                    label={`Select all ${filteredItems.length} items`}
                                    placement="top"
                                >
                                    <IconButton
                                        aria-label="Select all items"
                                        icon={<FiCheck />}
                                        size="sm"
                                        variant="outline"
                                        onClick={selectAll}
                                        colorScheme="blue"
                                        isRound
                                    />
                                </Tooltip>
                            )}

                            {/* Selected items counter */}
                            {multiSelect && (
                                <Badge
                                    colorScheme="blue"
                                    variant="solid"
                                    fontSize="0.8em"
                                    px={2}
                                    py={1}
                                >
                                    {selectedItems.length} selected
                                </Badge>
                            )}
                        </HStack>

                        {/* Right side: Add/Confirm button */}
                        {multiSelect ? (
                            <Button
                                colorScheme="blue"
                                onClick={handleConfirmSelection}
                                isDisabled={selectedItems.length === 0}
                                leftIcon={<FiCheck />}
                                size="md"
                                px={6}
                            >
                                Add {selectedItems.length}
                            </Button>
                        ) : (
                            <Text fontSize="sm" color="gray.600" fontStyle="italic">
                                Click item to select
                            </Text>
                        )}
                    </HStack>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}