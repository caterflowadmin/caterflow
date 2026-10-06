import { logger } from '@/lib/logger';
// Enhanced CreatePurchaseOrderModal.tsx with Multi-Select
import React, { useState, useEffect } from 'react';
import {
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalCloseButton,
    ModalBody,
    ModalFooter,
    Button,
    Select,
    useToast,
    VStack,
    HStack,
    Text,
    Card,
    IconButton,
    Box,
    Input,
    Flex,
    Spinner,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    NumberIncrementStepper,
    NumberDecrementStepper,
    Checkbox,
    Badge,
    useColorModeValue,
} from '@chakra-ui/react';
import { FiPlus, FiX, FiCheck } from 'react-icons/fi';
import { StockItem, Supplier, Site } from '@/lib/sanityTypes';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';

// Define the OrderItem interface here instead of importing it
interface OrderItem {
    stockItem: string;
    supplier: string;
    orderedQuantity: number;
    unitPrice: number;
    _key?: string;
}

// In CreatePurchaseOrderModal.tsx
interface StockItemWithExpandedCategory {
    _id: string;
    name: string;
    sku: string;
    unitOfMeasure: string;
    unitPrice: number;
    primarySupplier?: { _id: string; name: string };
    suppliers?: { _id: string; name: string }[];
    category?: { _id: string; title: string }; // This is the expanded category
}

interface PurchaseOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedItems: StockItem[];
    suppliers: Supplier[];
    onSave: (items: OrderItem[], siteId?: string) => void;
    // New props for site selection
    selectedSiteId?: string | null;
    sites?: Site[];
}

interface Category {
    _id: string;
    title: string;
}

export default function CreatePurchaseOrderModal({
    isOpen,
    onClose,
    selectedItems,
    suppliers,
    onSave,
    selectedSiteId,
    sites = []
}: PurchaseOrderModalProps) {
    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
    const [availableItems, setAvailableItems] = useState<StockItemWithExpandedCategory[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [loadingItems, setLoadingItems] = useState(false);
    const [selectedSite, setSelectedSite] = useState<string>(selectedSiteId || '');
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [isAddingItems, setIsAddingItems] = useState(false);
    const [selectedItemsToAdd, setSelectedItemsToAdd] = useState<StockItemWithExpandedCategory[]>([]); // New state for multi-select
    const toast = useToast();

    // Theme-aware colors
    const selectedItemBg = useColorModeValue('blue.50', 'blue.900');
    const listItemHoverBg = useColorModeValue('gray.50', 'gray.700');

    useEffect(() => {
        if (isOpen && selectedItems.length > 0) {
            // Initialize with default suppliers
            const initialItems = selectedItems.map(item => ({
                stockItem: item._id,
                supplier: (item.primarySupplier as any)?._ref ||
                    ((item.suppliers as any) && (item.suppliers as any).length > 0 ? (item.suppliers as any)[0]._ref : ''),
                orderedQuantity: (item as any).orderQuantity || 1,
                unitPrice: Number(item.unitPrice) || 0,
                _key: Math.random().toString(36).substr(2, 9)
            }));
            setOrderItems(initialItems);
        } else if (isOpen) {
            setOrderItems([]);
        }

        // Reset selected site when modal opens if no site was preselected
        if (isOpen && !selectedSiteId) {
            setSelectedSite('');
        }
    }, [isOpen, selectedItems, selectedSiteId]);

    const fetchAvailableItems = async () => {
        setLoadingItems(true);
        try {
            const query = groq`*[_type == "StockItem"] {
                _id,
                name,
                sku,
                unitOfMeasure,
                unitPrice,
                primarySupplier->{_id, name},
                suppliers[]->{_id, name},
                category->{_id, title}
            }`;
            const items = await client.fetch(query);
            setAvailableItems(items);
        } catch (error) {
            console.error('Failed to fetch stock items:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch available items',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setLoadingItems(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const query = groq`*[_type == "Category"] { _id, title }`;
            const categories = await client.fetch(query);
            setCategories(categories);
        } catch (error) {
            console.error('Failed to fetch categories:', error);
        }
    };

    const handleOpenAddItemModal = async () => {
        setIsAddingItems(true);
        try {
            await Promise.all([fetchAvailableItems(), fetchCategories()]);
            setSelectedItemsToAdd([]); // Reset selection when modal opens
            setIsAddItemModalOpen(true);
        } catch (error) {
            console.error('Failed to open add item modal:', error);
        } finally {
            setIsAddingItems(false);
        }
    };

    // Enhanced multi-select handler
    const handleItemSelection = (item: StockItemWithExpandedCategory) => {
        setSelectedItemsToAdd(prev => {
            const isAlreadySelected = prev.some(selected => selected._id === item._id);
            if (isAlreadySelected) {
                return prev.filter(selected => selected._id !== item._id);
            } else {
                return [...prev, item];
            }
        });
    };

    // Enhanced bulk add handler
    const handleBulkAddItems = () => {
        if (selectedItemsToAdd.length === 0) {
            toast({
                title: 'No items selected',
                description: 'Please select at least one item to add.',
                status: 'warning',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        // Prevent duplicates by checking if item already exists in orderItems
        const newItems = selectedItemsToAdd.filter(newItem =>
            !orderItems.some(existingItem => existingItem.stockItem === newItem._id)
        );

        if (newItems.length === 0) {
            toast({
                title: 'Items already added',
                description: 'All selected items are already in the purchase order',
                status: 'warning',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        const newOrderItems: OrderItem[] = newItems.map(item => ({
            stockItem: item._id,
            supplier: item.primarySupplier?._id ||
                (item.suppliers && item.suppliers.length > 0 ? item.suppliers[0]._id : ''),
            orderedQuantity: 1,
            unitPrice: item.unitPrice || 0,
            _key: Math.random().toString(36).substr(2, 9)
        }));

        setOrderItems(prev => [...prev, ...newOrderItems]);

        if (newItems.length < selectedItemsToAdd.length) {
            toast({
                title: 'Items added',
                description: `${newItems.length} items added (${selectedItemsToAdd.length - newItems.length} were already in the order)`,
                status: 'success',
                duration: 3000,
                isClosable: true,
            });
        } else {
            toast({
                title: 'Items added',
                description: `${newItems.length} items added to purchase order`,
                status: 'success',
                duration: 2000,
                isClosable: true,
            });
        }

        setSelectedItemsToAdd([]);
        setIsAddItemModalOpen(false);
    };

    // Select all/deselect all functionality
    const handleSelectAll = () => {
        const filteredAvailableItems = availableItems.filter(item => {
            const matchesSearch = searchTerm === '' ||
                item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.sku.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = selectedCategory === '' ||
                (item.category && item.category.title === selectedCategory);
            const isAlreadyInOrder = orderItems.some(orderItem => orderItem.stockItem === item._id);

            return matchesSearch && matchesCategory && !isAlreadyInOrder;
        });

        if (selectedItemsToAdd.length === filteredAvailableItems.length) {
            // Deselect all
            setSelectedItemsToAdd([]);
        } else {
            // Select all
            setSelectedItemsToAdd(filteredAvailableItems);
        }
    };

    const isItemSelected = (itemId: string) => {
        return selectedItemsToAdd.some(item => item._id === itemId);
    };

    const updateItemSupplier = (index: number, supplierId: string) => {
        setOrderItems(prev => prev.map((item, i) =>
            i === index ? { ...item, supplier: supplierId } : item
        ));
    };

    const updateItemQuantity = (index: number, quantity: string) => {
        const valueAsNumber = parseFloat(quantity);
        setOrderItems(prev => prev.map((item, i) =>
            i === index ? { ...item, orderedQuantity: isNaN(valueAsNumber) ? 0 : valueAsNumber } : item
        ));
    };

    const updateItemPrice = (index: number, price: number) => {
        setOrderItems(prev => prev.map((item, i) =>
            i === index ? { ...item, unitPrice: price } : item
        ));
    };

    const removeItem = (index: number) => {
        setOrderItems(prev => prev.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (isCreatingOrder) return; // Prevent multiple clicks

        logger.debug('Saving order items:', orderItems);

        // Validate there are items to order
        if (orderItems.length === 0) {
            toast({
                title: 'No items',
                description: 'Please add items to the purchase order',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        // Validate all items have positive quantities
        const itemsWithInvalidQuantities = orderItems.filter(item => item.orderedQuantity <= 0);
        if (itemsWithInvalidQuantities.length > 0) {
            toast({
                title: 'Invalid quantities',
                description: 'Please enter valid quantities for all items',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        // If site selection is required but not provided
        if (!selectedSiteId && !selectedSite) {
            toast({
                title: 'Site required',
                description: 'Please select a site for this purchase order',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        setIsCreatingOrder(true);

        try {
            // Pass the site ID to the onSave callback
            const siteIdToUse = selectedSiteId || selectedSite;
            await onSave(orderItems, siteIdToUse);
        } catch (error) {
            console.error('Error in handleSave:', error);
            // Error handling is done in the parent component
        } finally {
            setIsCreatingOrder(false);
        }
    };

    const handleClose = () => {
        if (!isCreatingOrder) {
            onClose();
        }
    };

    const handleCloseAddItemModal = () => {
        setSelectedItemsToAdd([]);
        setIsAddItemModalOpen(false);
    };

    // Get filtered items for display
    const filteredItems = availableItems.filter(item => {
        const matchesSearch = searchTerm === '' ||
            item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.sku.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === '' ||
            (item.category && item.category.title === selectedCategory);
        const isAlreadyInOrder = orderItems.some(orderItem => orderItem.stockItem === item._id);

        return matchesSearch && matchesCategory && !isAlreadyInOrder;
    });

    // Clear filters
    const clearFilters = () => {
        setSearchTerm('');
        setSelectedCategory('');
    };

    return (
        <>
            <Modal isOpen={isOpen} onClose={handleClose} size="xl">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Create Purchase Order</ModalHeader>
                    <ModalCloseButton isDisabled={isCreatingOrder} />
                    <ModalBody>
                        {/* Site Selection (only show if no preselected site) */}
                        {!selectedSiteId && (
                            <Box mb={4}>
                                <Text fontWeight="medium" mb={2}>Select Site</Text>
                                <Select
                                    placeholder="Select a site"
                                    value={selectedSite}
                                    onChange={(e) => setSelectedSite(e.target.value)}
                                    isRequired
                                    isDisabled={isCreatingOrder}
                                >
                                    {sites.map(site => (
                                        <option key={site._id} value={site._id}>
                                            {site.name}

                                        </option>
                                    ))}
                                </Select>
                            </Box>
                        )}

                        <Button
                            leftIcon={<FiPlus />}
                            onClick={handleOpenAddItemModal}
                            mb={4}
                            colorScheme="blue"
                            variant="outline"
                            isDisabled={(!selectedSiteId && !selectedSite) || isCreatingOrder}
                            isLoading={isAddingItems}
                            loadingText="Loading items..."
                        >
                            Add More Items
                        </Button>

                        <VStack spacing={4} align="stretch">
                            {orderItems.map((item, index) => {
                                const stockItem = [...selectedItems, ...availableItems].find(si => si._id === item.stockItem);
                                return (
                                    <Card key={item._key || index} p={4} variant="outline" position="relative">
                                        <IconButton
                                            aria-label="Remove item"
                                            icon={<FiX />}
                                            size="sm"
                                            position="absolute"
                                            top={2}
                                            right={2}
                                            onClick={() => removeItem(index)}
                                            variant="ghost"
                                            isDisabled={isCreatingOrder}
                                        />
                                        <VStack align="stretch" spacing={2}>
                                            <VStack align={"stretch"}>
                                                <Text fontWeight="bold" fontSize="lg">{stockItem?.name}</Text>
                                                <Text fontSize="xs" fontWeight={"bold"} color="gray.600">SKU: {stockItem?.sku}</Text>
                                            </VStack>
                                            <Flex direction={{ base: 'row', md: 'row' }} justify="space-between" align={{ base: 'flex-start', md: 'center' }} gap={4} flexWrap="wrap">
                                                <Box flex="1 1 60px">
                                                    <Text fontWeight="medium" mb={1}>Quantity ({stockItem?.unitOfMeasure})</Text>
                                                    <Input
                                                        value={item.orderedQuantity === 0 ? '' : item.orderedQuantity}
                                                        onChange={(e) => updateItemQuantity(index, e.target.value)}
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        size="sm"
                                                        placeholder="0"
                                                        isDisabled={isCreatingOrder}
                                                    />
                                                </Box>
                                            </Flex>
                                        </VStack>
                                    </Card>
                                );
                            })}
                        </VStack>

                        {orderItems.length === 0 && (
                            <Text textAlign="center" color="gray.500" py={8}>
                                No items added to purchase order
                            </Text>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            variant="ghost"
                            mr={3}
                            onClick={handleClose}
                            isDisabled={isCreatingOrder}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            colorScheme="blue"
                            isDisabled={(!selectedSiteId && !selectedSite) || orderItems.length === 0 || isCreatingOrder}
                            isLoading={isCreatingOrder}
                            loadingText="Creating Order..."
                        >
                            Create Purchase Order
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* Enhanced Add Item Modal with Multi-Select */}
            <Modal isOpen={isAddItemModalOpen} onClose={handleCloseAddItemModal} size="4xl">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>
                        <VStack align="start" spacing={2}>
                            <Text>Add Items to Purchase Order</Text>
                            <HStack>
                                <Badge colorScheme="blue" variant="subtle">
                                    {selectedItemsToAdd.length} item(s) selected
                                </Badge>
                                {filteredItems.length > 0 && (
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={handleSelectAll}
                                    >
                                        {selectedItemsToAdd.length === filteredItems.length ? 'Deselect All' : 'Select All'}
                                    </Button>
                                )}
                            </HStack>
                        </VStack>
                    </ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <VStack spacing={4} align="stretch">
                            <HStack>
                                <Input
                                    placeholder="Search by name or SKU..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <Select
                                    placeholder="All Categories"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                >
                                    {categories.map(category => (
                                        <option key={category._id} value={category.title}>
                                            {category.title}
                                        </option>
                                    ))}
                                </Select>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={clearFilters}
                                    isDisabled={!searchTerm && !selectedCategory}
                                >
                                    Clear
                                </Button>
                            </HStack>

                            {loadingItems ? (
                                <Flex justifyContent="center" alignItems="center" h="200px">
                                    <Spinner />
                                </Flex>
                            ) : filteredItems.length === 0 ? (
                                <Text textAlign="center" color="gray.500" py={8}>
                                    {searchTerm || selectedCategory ? 'No items match your search.' : 'No items available to add.'}
                                </Text>
                            ) : (
                                <Box overflowY="auto" maxH="400px">
                                    <VStack spacing={2} align="stretch">
                                        {filteredItems.map((item) => {
                                            const isSelected = isItemSelected(item._id);
                                            return (
                                                <Flex
                                                    key={item._id}
                                                    alignItems="center"
                                                    p={3}
                                                    borderWidth="1px"
                                                    borderRadius="md"
                                                    bg={isSelected ? selectedItemBg : 'transparent'}
                                                    _hover={{ bg: isSelected ? selectedItemBg : listItemHoverBg, cursor: 'pointer' }}
                                                    onClick={() => handleItemSelection(item)}
                                                >
                                                    <Checkbox
                                                        isChecked={isSelected}
                                                        onChange={() => handleItemSelection(item)}
                                                        mr={3}
                                                    />
                                                    <Box flex="1">
                                                        <HStack align="start" justify="space-between">
                                                            <VStack align="start" spacing={1}>
                                                                <Text fontWeight="bold">{item.name}</Text>
                                                                <Text fontSize="sm">SKU: {item.sku}</Text>
                                                                <Text fontSize="sm" color="gray.600">
                                                                    Category: {item.category?.title || 'Uncategorized'} • Unit: {item.unitOfMeasure}
                                                                </Text>
                                                                <Text fontSize="sm" color="blue.600" fontWeight="medium">
                                                                    Price: E {item.unitPrice || 0}
                                                                </Text>
                                                            </VStack>
                                                            {isSelected && (
                                                                <FiCheck color="green" />
                                                            )}
                                                        </HStack>
                                                    </Box>
                                                </Flex>
                                            );
                                        })}
                                    </VStack>
                                </Box>
                            )}
                        </VStack>
                    </ModalBody>
                    <ModalFooter>
                        <HStack spacing={3}>
                            <Button variant="ghost" onClick={handleCloseAddItemModal}>
                                Cancel
                            </Button>
                            <Button
                                colorScheme="blue"
                                onClick={handleBulkAddItems}
                                isDisabled={selectedItemsToAdd.length === 0}
                                leftIcon={<FiPlus />}
                            >
                                Add {selectedItemsToAdd.length} Item(s)
                            </Button>
                        </HStack>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}