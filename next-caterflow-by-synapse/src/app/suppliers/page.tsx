'use client';
import dynamic from 'next/dynamic';
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
    IconButton,
    useColorModeValue,
    Card,
    CardBody,
    Input,
    InputGroup,
    InputLeftElement,
    VStack,
} from '@chakra-ui/react';
import { FiPlus, FiSearch, FiEdit, FiTrash2 } from 'react-icons/fi';
import DataTable from '@/components/DataTable';
import { useSession } from 'next-auth/react'
const SupplierModal = dynamic(() => import('@/components/SupplierModal'), { ssr: false });
interface Supplier {
    _id: string;
    name: string;
    contactPerson?: string;
    phoneNumber?: string;
    email?: string;
    address?: string;
    terms?: string;
}

export default function SuppliersPage() {
    const { data: session, status } = useSession();
    const user = session?.user;

    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { isOpen, onOpen, onClose } = useDisclosure();
    const toast = useToast();

    // Theming values from theme.ts
    const pageBg = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
    const headingColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
    const cardBg = useColorModeValue('neutral.light.bg-card', 'neutral.dark.bg-card');
    const borderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const inputBg = useColorModeValue('neutral.light.bg-input', 'neutral.dark.bg-input');
    const brand500 = useColorModeValue('brand.500', 'brand.300');
    const secondaryTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');

    const fetchSuppliers = useCallback(async () => {
        try {
            const response = await cachedFetch('/api/suppliers');
            if (response.ok) {
                const data = await response.json();
                setSuppliers(data);
            } else {
                throw new Error('Failed to fetch suppliers');
            }
        } catch (error) {
            console.error('Error fetching suppliers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load suppliers. Please try again.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchSuppliers();
    }, [fetchSuppliers]);

    useEffect(() => {
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            setFilteredSuppliers(
                suppliers.filter(supplier =>
                    supplier.name.toLowerCase().includes(term) ||
                    (supplier.contactPerson && supplier.contactPerson.toLowerCase().includes(term)) ||
                    (supplier.email && supplier.email.toLowerCase().includes(term))
                )
            );
        } else {
            setFilteredSuppliers(suppliers);
        }
    }, [suppliers, searchTerm]);

    const handleAddSupplier = () => {
        setSelectedSupplier(null);
        onOpen();
    };

    const handleEditSupplier = (supplier: Supplier) => {
        setSelectedSupplier(supplier);
        onOpen();
    };

    const handleDeleteSupplier = async (supplierId: string) => {
        if (window.confirm('Are you sure you want to delete this supplier?')) {
            try {
                const response = await fetch(`/api/suppliers?id=${supplierId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    throw new Error('Failed to delete supplier');
                }

                setSuppliers(suppliers.filter(s => s._id !== supplierId));
                toast({
                    title: 'Supplier deleted.',
                    description: 'The supplier has been successfully deleted.',
                    status: 'success',
                    duration: 3000,
                    isClosable: true,
                });
            } catch (error) {
                console.error('Error deleting supplier:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to delete supplier. Please try again.',
                    status: 'error',
                    duration: 5000,
                    isClosable: true,
                });
            }
        }
    };

    const handleSaveSuccess = () => {
        fetchSuppliers();
        onClose();
    };

    // Assuming 'admin' and 'manager' roles have CRUD permissions
    const canManage = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'procurer';

    const columns = [
        ...(canManage ? [{
            accessorKey: 'actions',
            header: 'Actions',
            cell: (row: Supplier) => (
                <Flex>
                    <Button
                        aria-label="Edit supplier"
                        leftIcon={<FiEdit />}
                        size="sm"
                        colorScheme="blue"
                        mr={2}
                        onClick={() => handleEditSupplier(row)}
                    >
                        Edit
                    </Button>
                </Flex>
            ),
        }] : []),
        {
            accessorKey: 'name',
            header: 'Name',
            isSortable: true,
        },
        {
            accessorKey: 'contactPerson',
            header: 'Contact Person',
            isSortable: true,
        },
        {
            accessorKey: 'email',
            header: 'Email',
            isSortable: true,
        },
        {
            accessorKey: 'phoneNumber',
            header: 'Phone',
            isSortable: true,
        },
    ];

    if (loading || status === 'loading') {
        return (
            <Flex justifyContent="center" alignItems="center" height="100vh">
                <Spinner size="xl" color={brand500} />
            </Flex>
        );
    }

    return (
        <Box p={{ base: 4, md: 8 }} bg={pageBg}>
            <VStack spacing={6} align="stretch" maxW="full">
                <Flex justifyContent="space-between" alignItems="center">
                    <Heading as="h1" size="lg" color={headingColor}>Suppliers</Heading>
                    {canManage && (
                        <Button
                            leftIcon={<FiPlus />}
                            colorScheme="brand"
                            onClick={handleAddSupplier}
                        >
                            Add Supplier
                        </Button>
                    )}
                </Flex>

                <Card bg={cardBg} border="1px" borderColor={borderColor} borderRadius="md" boxShadow="md">
                    <CardBody>

                        <DataTable
                            columns={columns}
                            data={filteredSuppliers}
                            loading={false}
                        />
                    </CardBody>
                </Card>
            </VStack>

            <SupplierModal
                isOpen={isOpen}
                onClose={onClose}
                supplier={selectedSupplier}
                onSave={handleSaveSuccess}
            />
        </Box>
    );
}