// src/app/dispatch-types/page.tsx (REPLACE ENTIRE FILE)
'use client';
import { cachedFetch } from '@/lib/clientCache';

import { useState, useEffect, useCallback } from 'react';
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
    VStack,
    HStack,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    TableContainer,
    IconButton,
    Badge,
    Text,
    FormControl,
    FormLabel,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalCloseButton,
    ModalBody,
    ModalFooter,
    Textarea,
    NumberInput,
    NumberInputField,
    NumberInputStepper,
    NumberIncrementStepper,
    NumberDecrementStepper,
    Switch,
    Tag,
    TagLabel,
    TagCloseButton,
    Select,
    SimpleGrid,
} from '@chakra-ui/react';
import { FiPlus, FiEdit, FiTrash2, FiSave, FiX, FiDollarSign } from 'react-icons/fi';
import { useSession } from 'next-auth/react';

interface SitePrice {
    _key?: string;
    site: {
        _id: string;
        name: string;
    };
    price: number;
}

interface DispatchType {
    _id: string;
    name: string;
    description?: string;
    defaultTime?: string;
    sellingPrice: number;
    sitePrices?: SitePrice[];
    isActive: boolean;
}

interface Site {
    _id: string;
    name: string;
}

export default function DispatchTypesPage() {
    const { data: session, status } = useSession();
    const [dispatchTypes, setDispatchTypes] = useState<DispatchType[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingType, setEditingType] = useState<DispatchType | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [selectedSiteForPrice, setSelectedSiteForPrice] = useState('');
    const [sitePriceValue, setSitePriceValue] = useState<number>(0);
    const [showSitePriceForm, setShowSitePriceForm] = useState(false);

    const toast = useToast();

    // Theming props
    const bgPrimary = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
    const primaryTextColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');

    // Check if user is admin
    const isAdmin = session?.user?.role === 'admin';

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [dispatchTypesRes, sitesRes] = await Promise.all([
                cachedFetch('/api/dispatch-types'),
                cachedFetch('/api/sites')
            ]);

            if (!dispatchTypesRes.ok || !sitesRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const dispatchTypesData = await dispatchTypesRes.json();
            const sitesData = await sitesRes.json();

            setDispatchTypes(dispatchTypesData || []);
            setSites(sitesData || []);
        } catch (error) {
            console.error('Error fetching dispatch types:', error);
            toast({
                title: 'Error',
                description: 'Failed to load dispatch types.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (status === 'authenticated') {
            fetchData();
        }
    }, [fetchData, status]);

    const handleCreate = () => {
        setEditingType({
            _id: '',
            name: '',
            description: '',
            defaultTime: '',
            sellingPrice: 0,
            sitePrices: [],
            isActive: true
        });
        setSelectedSiteForPrice('');
        setSitePriceValue(0);
        setShowSitePriceForm(false);
        onOpen();
    };

    const handleEdit = (type: DispatchType) => {
        setEditingType({ ...type });
        setSelectedSiteForPrice('');
        setSitePriceValue(0);
        setShowSitePriceForm(false);
        onOpen();
    };

    const handleAddSitePrice = () => {
        if (!selectedSiteForPrice || sitePriceValue <= 0) {
            toast({
                title: 'Error',
                description: 'Please select a site and enter a valid price.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        // Check if site already has a price
        const existingPriceIndex = editingType?.sitePrices?.findIndex(
            sp => sp.site._id === selectedSiteForPrice
        );

        if (existingPriceIndex !== undefined && existingPriceIndex >= 0) {
            // Update existing price
            const updatedPrices = [...(editingType?.sitePrices || [])];
            updatedPrices[existingPriceIndex] = {
                ...updatedPrices[existingPriceIndex],
                price: sitePriceValue
            };
            setEditingType(prev => prev ? { ...prev, sitePrices: updatedPrices } : null);
        } else {
            // Add new price
            const selectedSite = sites.find(s => s._id === selectedSiteForPrice);
            if (selectedSite) {
                const newPrice: SitePrice = {
                    _key: `site-price-${Date.now()}`,
                    site: {
                        _id: selectedSite._id,
                        name: selectedSite.name
                    },
                    price: sitePriceValue
                };
                setEditingType(prev => prev ? {
                    ...prev,
                    sitePrices: [...(prev.sitePrices || []), newPrice]
                } : null);
            }
        }

        // Reset form
        setSelectedSiteForPrice('');
        setSitePriceValue(0);
        setShowSitePriceForm(false);
    };

    const handleRemoveSitePrice = (siteId: string) => {
        setEditingType(prev => prev ? {
            ...prev,
            sitePrices: prev.sitePrices?.filter(sp => sp.site._id !== siteId) || []
        } : null);
    };

    const handleSave = async () => {
        if (!editingType?.name.trim()) {
            toast({
                title: 'Error',
                description: 'Name is required.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        if (editingType.sellingPrice < 0) {
            toast({
                title: 'Error',
                description: 'Selling price cannot be negative.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        // Validate site prices
        if (editingType.sitePrices?.some(sp => sp.price < 0)) {
            toast({
                title: 'Error',
                description: 'Site prices cannot be negative.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const url = editingType._id ? `/api/dispatch-types/${editingType._id}` : '/api/dispatch-types';
            const method = editingType._id ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: editingType.name.trim(),
                    description: editingType.description?.trim() || '',
                    defaultTime: editingType.defaultTime || '',
                    sellingPrice: editingType.sellingPrice,
                    sitePrices: editingType.sitePrices || [],
                    isActive: editingType.isActive !== false
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || 'Failed to save dispatch type');
            }

            toast({
                title: 'Success',
                description: editingType._id ? 'Dispatch type updated.' : 'Dispatch type created.',
                status: 'success',
                duration: 3000,
                isClosable: true,
            });

            onClose();
            setEditingType(null);
            fetchData();
        } catch (error: any) {
            console.error('Error saving dispatch type:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to save dispatch type.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this dispatch type?')) {
            return;
        }

        try {
            const response = await fetch(`/api/dispatch-types/${id}`, {
                method: 'DELETE',
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || 'Failed to delete dispatch type');
            }

            toast({
                title: 'Success',
                description: result.message || 'Dispatch type deleted.',
                status: 'success',
                duration: 3000,
                isClosable: true,
            });

            fetchData();
        } catch (error: any) {
            console.error('Error deleting dispatch type:', error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to delete dispatch type.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        }
    };

    // Get site name by ID for display
    const getSiteName = (siteId: string): string => {
        const site = sites.find(s => s._id === siteId);
        return site ? site.name : 'Unknown Site';
    };

    // Get price for a specific site
    const getSitePrice = (dispatchType: DispatchType, siteId: string): number => {
        const sitePrice = dispatchType.sitePrices?.find(sp => sp.site._id === siteId);
        return sitePrice ? sitePrice.price : dispatchType.sellingPrice;
    };

    // Sites without prices for the current editing type
    const availableSites = sites.filter(site =>
        !editingType?.sitePrices?.some(sp => sp.site._id === site._id)
    );

    if (status === 'loading' || loading) {
        return (
            <Flex justifyContent="center" alignItems="center" height="50vh" bg={bgPrimary}>
                <Spinner size="xl" />
            </Flex>
        );
    }

    // Redirect or show unauthorized if not admin
    if (!isAdmin) {
        return (
            <Box p={8} bg={bgPrimary} minH="100vh">
                <Card>
                    <CardBody>
                        <Heading size="lg" color="red.500" mb={4}>
                            Access Denied
                        </Heading>
                        <Text>
                            You do not have permission to access this page. Only administrators can manage dispatch types.
                        </Text>
                    </CardBody>
                </Card>
            </Box>
        );
    }

    return (
        <Box p={{ base: 4, md: 8 }} bg={bgPrimary} minH="100vh">
            <VStack spacing={6} align="stretch">
                <Flex justify="space-between" align="center">
                    <Heading as="h1" size="xl" color={primaryTextColor}>
                        Dispatch Types
                    </Heading>
                    <Button
                        leftIcon={<FiPlus />}
                        colorScheme="brand"
                        onClick={handleCreate}
                    >
                        Add Dispatch Type
                    </Button>
                </Flex>

                <Card>
                    <CardBody p={0}>
                        <TableContainer>
                            <Table variant="simple">
                                <Thead>
                                    <Tr>
                                        <Th>Name</Th>
                                        <Th>Description</Th>
                                        <Th>Default Time</Th>
                                        <Th>Selling Price</Th>
                                        <Th>Site Prices</Th>
                                        <Th>Status</Th>
                                        <Th>Actions</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {dispatchTypes.map((type) => (
                                        <Tr key={type._id}>
                                            <Td fontWeight="medium">{type.name}</Td>
                                            <Td>
                                                <Text noOfLines={2} color="gray.600">
                                                    {type.description || 'No description'}
                                                </Text>
                                            </Td>
                                            <Td>{type.defaultTime || 'Not set'}</Td>
                                            <Td>E {type.sellingPrice.toFixed(2)}</Td>
                                            <Td>
                                                <VStack align="start" spacing={1}>
                                                    {type.sitePrices && type.sitePrices.length > 0 ? (
                                                        type.sitePrices.map((sitePrice, index) => (
                                                            <Text key={index} fontSize="sm">
                                                                {getSiteName(sitePrice.site._id)}: E {sitePrice.price.toFixed(2)}
                                                            </Text>
                                                        ))
                                                    ) : (
                                                        <Text fontSize="sm" color="gray.500">No site-specific prices</Text>
                                                    )}
                                                </VStack>
                                            </Td>
                                            <Td>
                                                <Badge colorScheme={type.isActive ? 'green' : 'red'}>
                                                    {type.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </Td>
                                            <Td>
                                                <HStack spacing={2}>
                                                    <IconButton
                                                        aria-label="Edit dispatch type"
                                                        icon={<FiEdit />}
                                                        size="sm"
                                                        colorScheme="blue"
                                                        onClick={() => handleEdit(type)}
                                                    />
                                                    <IconButton
                                                        aria-label="Delete dispatch type"
                                                        icon={<FiTrash2 />}
                                                        size="sm"
                                                        colorScheme="red"
                                                        onClick={() => handleDelete(type._id)}
                                                    />
                                                </HStack>
                                            </Td>
                                        </Tr>
                                    ))}
                                    {dispatchTypes.length === 0 && (
                                        <Tr>
                                            <Td colSpan={7} textAlign="center" py={8}>
                                                <Text color="gray.500">No dispatch types found.</Text>
                                            </Td>
                                        </Tr>
                                    )}
                                </Tbody>
                            </Table>
                        </TableContainer>
                    </CardBody>
                </Card>

                {/* Create/Edit Modal */}
                <Modal isOpen={isOpen} onClose={onClose} size="xl">
                    <ModalOverlay />
                    <ModalContent maxH="90vh" overflowY="auto">
                        <ModalHeader>
                            {editingType?._id ? 'Edit Dispatch Type' : 'Create Dispatch Type'}
                        </ModalHeader>
                        <ModalCloseButton />
                        <ModalBody>
                            <VStack spacing={4}>
                                <FormControl isRequired>
                                    <FormLabel>Name</FormLabel>
                                    <Input
                                        value={editingType?.name || ''}
                                        onChange={(e) => setEditingType(prev => prev ? { ...prev, name: e.target.value } : null)}
                                        placeholder="e.g., Breakfast, Lunch, Emergency"
                                    />
                                </FormControl>
                                <FormControl>
                                    <FormLabel>Description</FormLabel>
                                    <Textarea
                                        value={editingType?.description || ''}
                                        onChange={(e) => setEditingType(prev => prev ? { ...prev, description: e.target.value } : null)}
                                        placeholder="Description of this dispatch type"
                                        rows={3}
                                    />
                                </FormControl>
                                <FormControl>
                                    <FormLabel>Default Time</FormLabel>
                                    <Input
                                        type="time"
                                        value={editingType?.defaultTime || ''}
                                        onChange={(e) => setEditingType(prev => prev ? { ...prev, defaultTime: e.target.value } : null)}
                                        placeholder="HH:MM"
                                    />
                                </FormControl>
                                <FormControl isRequired>
                                    <FormLabel>Selling Price per Person</FormLabel>
                                    <NumberInput
                                        value={editingType?.sellingPrice ?? 0}
                                        min={0}
                                        step={0.01}
                                        precision={2}
                                        onChange={(valueString, valueNumber) =>
                                            setEditingType(prev => prev ? { ...prev, sellingPrice: valueNumber } : null)
                                        }
                                    >
                                        <NumberInputField />
                                        <NumberInputStepper>
                                            <NumberIncrementStepper />
                                            <NumberDecrementStepper />
                                        </NumberInputStepper>
                                    </NumberInput>
                                    <Text fontSize="sm" color="gray.600" mt={1}>
                                        This price will be used for sites without specific overrides
                                    </Text>
                                </FormControl>

                                {/* Site-Specific Prices */}
                                <Box width="100%">
                                    <HStack justify="space-between" mb={2}>
                                        <FormLabel mb={0}>Site-Specific Prices (Optional)</FormLabel>
                                        {!showSitePriceForm && availableSites.length > 0 && (
                                            <Button
                                                size="sm"
                                                leftIcon={<FiPlus />}
                                                onClick={() => setShowSitePriceForm(true)}
                                            >
                                                Add Site Price
                                            </Button>
                                        )}
                                    </HStack>

                                    {showSitePriceForm && (
                                        <Box p={4} borderWidth="1px" borderRadius="md" mb={4}>
                                            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                                                <FormControl>
                                                    <FormLabel>Site</FormLabel>
                                                    <Select
                                                        value={selectedSiteForPrice}
                                                        onChange={(e) => setSelectedSiteForPrice(e.target.value)}
                                                        placeholder="Select site"
                                                    >
                                                        {availableSites.map(site => (
                                                            <option key={site._id} value={site._id}>
                                                                {site.name}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                                <FormControl>
                                                    <FormLabel>Price per Person</FormLabel>
                                                    <NumberInput
                                                        value={sitePriceValue}
                                                        min={0}
                                                        step={0.01}
                                                        precision={2}
                                                        onChange={(valueString, valueNumber) => setSitePriceValue(valueNumber)}
                                                    >
                                                        <NumberInputField />
                                                        <NumberInputStepper>
                                                            <NumberIncrementStepper />
                                                            <NumberDecrementStepper />
                                                        </NumberInputStepper>
                                                    </NumberInput>
                                                </FormControl>
                                            </SimpleGrid>
                                            <HStack justify="flex-end" mt={4}>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => {
                                                        setShowSitePriceForm(false);
                                                        setSelectedSiteForPrice('');
                                                        setSitePriceValue(0);
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    colorScheme="blue"
                                                    onClick={handleAddSitePrice}
                                                    isDisabled={!selectedSiteForPrice || sitePriceValue <= 0}
                                                >
                                                    Add Price
                                                </Button>
                                            </HStack>
                                        </Box>
                                    )}

                                    {/* Display current site prices */}
                                    {editingType?.sitePrices && editingType.sitePrices.length > 0 && (
                                        <Box mt={4}>
                                            <Text fontWeight="medium" mb={2}>Current Site Prices:</Text>
                                            <VStack align="stretch" spacing={2}>
                                                {editingType.sitePrices.map((sitePrice, index) => (
                                                    <HStack
                                                        key={sitePrice.site._id}
                                                        p={3}
                                                        borderWidth="1px"
                                                        borderRadius="md"
                                                        justify="space-between"
                                                    >
                                                        <Box>
                                                            <Text fontWeight="medium">{sitePrice.site.name}</Text>
                                                            <Text fontSize="sm" color="gray.600">
                                                                E {sitePrice.price.toFixed(2)} per person
                                                            </Text>
                                                        </Box>
                                                        <IconButton
                                                            aria-label="Remove site price"
                                                            icon={<FiTrash2 />}
                                                            size="sm"
                                                            colorScheme="red"
                                                            variant="ghost"
                                                            onClick={() => handleRemoveSitePrice(sitePrice.site._id)}
                                                        />
                                                    </HStack>
                                                ))}
                                            </VStack>
                                        </Box>
                                    )}
                                </Box>

                                <FormControl display="flex" alignItems="center">
                                    <FormLabel htmlFor="is-active" mb="0">
                                        Active
                                    </FormLabel>
                                    <Switch
                                        id="is-active"
                                        isChecked={editingType?.isActive ?? true}
                                        onChange={(e) => setEditingType(prev => prev ? { ...prev, isActive: e.target.checked } : null)}
                                        colorScheme="green"
                                    />
                                </FormControl>
                            </VStack>
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="outline" mr={3} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                colorScheme="blue"
                                onClick={handleSave}
                                isLoading={isSubmitting}
                                leftIcon={editingType?._id ? <FiSave /> : <FiPlus />}
                            >
                                {editingType?._id ? 'Update' : 'Create'}
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            </VStack>
        </Box>
    );
}