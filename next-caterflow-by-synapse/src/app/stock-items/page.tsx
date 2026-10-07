'use client'

import dynamic from 'next/dynamic';
import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Heading,
    Flex,
    Text,
    Button,
    useDisclosure,
    IconButton,
    HStack,
    useToast,
    Tag,
    useColorModeValue,
    Spinner,
} from '@chakra-ui/react';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import DataTable, { Column } from '@/components/DataTable';
import { useRouter } from 'next/navigation';
const StockItemModal = dynamic(() => import('@/components/StockItemModal'), { ssr: false });
import { EditIcon, DeleteIcon, AddIcon } from '@chakra-ui/icons';
import { useSession } from 'next-auth/react'

interface StockItem {
    _id: string;
    name: string;
    sku: string;
    minimumStockLevel: number;
    quantityInStock: number;
    category: {
        _id: string;
        title: string;
    };
    suppliers: Array<{
        _id: string;
        name: string;
    }>;
    primarySupplier: {
        _id: string;
        name: string;
    };
    unitOfMeasure: string;
    unitPrice: number;
}

export default function InventoryPage() {
    const { data: session, status } = useSession();
    const user = session?.user;

    const [stockItems, setStockItems] = useState<StockItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const toast = useToast();

    // Theming values from theme.ts
    const pageBg = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
    const headingColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
    const secondaryTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');
    const brand500 = useColorModeValue('brand.500', 'brand.300');

    // FIX: Memoize fetchStockItems to avoid unnecessary re-renders
    const fetchStockItems = useCallback(async () => {
        const query = groq`
            *[_type == "StockItem"]{
                _id,
                name,
                sku,
                minimumStockLevel,
                quantityInStock,
                "category": category->{_id, title},
                "suppliers": suppliers[]->{_id, name},
                "primarySupplier": primarySupplier->{_id, name},
                unitOfMeasure,
                unitPrice
            }
        `;
        try {
            setLoading(true);
            const data = await client.fetch(query);
            setStockItems(data);
        } catch (error) {
            console.error("Failed to fetch stock items:", error);
            toast({
                title: "Error",
                description: "Failed to fetch stock items",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        setIsMounted(true);
        fetchStockItems();
    }, [fetchStockItems]);

    const handleEdit = (item: StockItem) => {
        setSelectedItem(item);
        onOpen();
    };

    const handleDelete = async (item: StockItem) => {
        if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
            try {
                await client.delete(item._id);
                toast({
                    title: "Success",
                    description: "Item deleted successfully",
                    status: "success",
                    duration: 3000,
                    isClosable: true,
                });
                fetchStockItems();
            } catch (error) {
                console.error("Failed to delete item:", error);
                toast({
                    title: "Error",
                    description: "Failed to delete item",
                    status: "error",
                    duration: 3000,
                    isClosable: true,
                });
            }
        }
    };

    const handleNewItem = () => {
        setSelectedItem(null);
        onOpen();
    };

    const handleItemSaved = () => {
        onClose();
        fetchStockItems();
    };

    // Assuming 'admin' and 'manager' roles have CRUD permissions
    const canManage = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'procurer';

    const columns: Column[] = [
        ...(canManage ? [{
            accessorKey: 'actions',
            header: 'Actions',
            isSortable: false,
            cell: (row: StockItem) => (
                <HStack spacing={2}>
                    <IconButton
                        aria-label="Edit item"
                        icon={<EditIcon />}
                        size="sm"
                        colorScheme="blue"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(row);
                        }}
                    />
                    <IconButton
                        aria-label="Delete item"
                        icon={<DeleteIcon />}
                        size="sm"
                        colorScheme="red"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(row);
                        }}
                    />
                </HStack>
            ),
        }] : []),
        {
            accessorKey: 'name',
            header: 'Item Name',
            isSortable: true,
        },
        {
            accessorKey: 'sku',
            header: 'SKU',
            isSortable: true,
        },
        {
            accessorKey: 'minimumStockLevel',
            header: 'Min. Level',
            isSortable: true,
            cell: (row: StockItem) => (
                <Text color={secondaryTextColor}>
                    {row.minimumStockLevel} {row.unitOfMeasure}
                </Text>
            ),
        },
        {
            accessorKey: 'category.title',
            header: 'Category',
            isSortable: true,
            cell: (row: StockItem) => <Text color={secondaryTextColor}>{row.category?.title || 'N/A'}</Text>,
        },
        {
            accessorKey: 'suppliers',
            header: 'Suppliers',
            isSortable: false,
            cell: (row: StockItem) => (
                <HStack spacing={1} flexWrap="wrap">
                    {row.suppliers?.map((supplier, index) => (
                        <Tag
                            key={supplier._id}
                            size="sm"
                            colorScheme={row.primarySupplier?._id === supplier._id ? 'brand' : 'gray'}
                            variant={row.primarySupplier?._id === supplier._id ? 'solid' : 'subtle'}
                        >
                            {supplier.name}
                            {row.primarySupplier?._id === supplier._id && ' (Primary)'}
                        </Tag>
                    )) || <Text color={secondaryTextColor}>N/A</Text>}
                </HStack>
            ),
        },
        {
            accessorKey: 'unitOfMeasure',
            header: 'Unit',
            isSortable: true,
        },
    ];

    if (!isMounted || status === 'loading') {
        return (
            <Flex justifyContent="center" alignItems="center" height="100vh">
                <Spinner size="xl" color={brand500} />
            </Flex>
        );
    }

    return (
        <Box p={{ base: 4, md: 8 }} flex="1" bg={pageBg}>
            <Flex justify="space-between" align="center" mb={6}>
                <Heading as="h1" size="xl" color={headingColor}>
                    Stock Items
                </Heading>
                {canManage && (
                    <Button
                        colorScheme="brand"
                        onClick={handleNewItem}
                        leftIcon={<AddIcon />}
                    >
                        Add New Item
                    </Button>
                )}
            </Flex>
            <Text mb={6} color={secondaryTextColor}>
                Manage and view all stock items in your inventory.
            </Text>
            <DataTable
                columns={columns}
                data={stockItems}
                loading={loading}
            />

            <StockItemModal
                isOpen={isOpen}
                onClose={onClose}
                item={selectedItem}
                onSave={handleItemSaved}
                existingItems={stockItems} // Pass existing items for duplicate checking
            />
        </Box>
    );
}