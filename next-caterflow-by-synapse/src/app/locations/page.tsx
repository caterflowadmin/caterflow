'use client';
import { cachedFetch } from '@/lib/clientCache';

import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Heading,
    Flex,
    Text,
    Button,
    useDisclosure,
    HStack,
    useToast,
    Tabs,
    TabList,
    TabPanels,
    Tab,
    TabPanel,
    Spinner,
    useColorModeValue,
} from '@chakra-ui/react';
import DataTable, { Column } from '@/components/DataTable';
import { EditIcon } from '@chakra-ui/icons';
import { useSession } from 'next-auth/react'
import SiteModal from '@/components/SiteModal';
import BinModal from '@/components/BinModal';

// Interfaces for data types
interface Bin {
    _id: string;
    name: string;
    binType: string;
    locationDescription: string;
    site: {
        _id: string;
        name: string;
    };
}

interface Site {
    _id: string;
    name: string;
    location: string;
    manager: {
        _id: string;
        name: string;
    };
    contactNumber?: string;
    email?: string;
    patientCount?: number;
}

export default function LocationsPage() {
    const { data: session, status } = useSession();
    const user = session?.user;
    const isAuthenticated = status === 'authenticated';
    const isAuthReady = status !== 'loading';

    const [sites, setSites] = useState<Site[]>([]);
    const [bins, setBins] = useState<Bin[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSite, setSelectedSite] = useState<Site | null>(null);
    const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
    const [activeTab, setActiveTab] = useState(0);

    // Modals for Sites and Bins
    const { isOpen: isSiteModalOpen, onOpen: onSiteModalOpen, onClose: onSiteModalClose } = useDisclosure();
    const { isOpen: isBinModalOpen, onOpen: onBinModalOpen, onClose: onBinModalClose } = useDisclosure();

    const toast = useToast();
    const isSiteManagerOrAdmin = user?.role === 'siteManager' || user?.role === 'admin';

    // Fetch all sites and bins using API
    const fetchLocations = useCallback(async () => {
        try {
            setLoading(true);
            const [sitesResponse, binsResponse] = await Promise.all([
                cachedFetch('/api/sites'),
                cachedFetch('/api/bins')
            ]);

            if (!sitesResponse.ok || !binsResponse.ok) {
                throw new Error('Failed to fetch data');
            }

            const [siteData, binData] = await Promise.all([
                sitesResponse.json(),
                binsResponse.json()
            ]);

            setSites(siteData);
            setBins(binData);
        } catch (error) {
            console.error("Failed to fetch locations and bins:", error);
            toast({
                title: "Error",
                description: "Failed to fetch locations and bins",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (status !== 'loading') {
            fetchLocations();
        }
    }, [status, fetchLocations]);

    // Handlers for Site actions
    const handleAddSite = () => {
        setSelectedSite(null);
        onSiteModalOpen();
    };

    const handleEditSite = (site: Site) => {
        setSelectedSite(site);
        onSiteModalOpen();
    };

    const handleDeleteSite = async (site: Site) => {
        if (confirm(`Are you sure you want to delete the site "${site.name}"? This will also delete all associated bins.`)) {
            try {
                // First, delete all bins associated with the site
                const binsToDelete = bins.filter(bin => bin.site._id === site._id);
                const binDeletionPromises = binsToDelete.map(bin =>
                    fetch(`/api/bins?id=${bin._id}`, { method: 'DELETE' })
                );
                await Promise.all(binDeletionPromises);

                // Then, delete the site itself
                await fetch(`/api/sites?id=${site._id}`, { method: 'DELETE' });

                toast({
                    title: "Success",
                    description: "Site and all associated bins deleted successfully",
                    status: "success",
                    duration: 3000,
                    isClosable: true,
                });
                fetchLocations(); // Refresh the list
            } catch (error) {
                console.error("Failed to delete site:", error);
                toast({
                    title: "Error",
                    description: "Failed to delete site",
                    status: "error",
                    duration: 3000,
                    isClosable: true,
                });
            }
        }
    };

    // Handlers for Bin actions
    const handleAddBin = () => {
        setSelectedBin(null);
        onBinModalOpen();
    };

    const handleEditBin = (bin: Bin) => {
        setSelectedBin(bin);
        onBinModalOpen();
    };

    const handleDeleteBin = async (bin: Bin) => {
        if (confirm(`Are you sure you want to delete the bin "${bin.name}"?`)) {
            try {
                const response = await fetch(`/api/bins?id=${bin._id}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    throw new Error('Failed to delete bin');
                }

                toast({
                    title: "Success",
                    description: "Bin deleted successfully",
                    status: "success",
                    duration: 3000,
                    isClosable: true,
                });
                fetchLocations(); // Refresh the list
            } catch (error) {
                console.error("Failed to delete bin:", error);
                toast({
                    title: "Error",
                    description: "Failed to delete bin",
                    status: "error",
                    duration: 3000,
                    isClosable: true,
                });
            }
        }
    };

    const handleItemSaved = () => {
        onSiteModalClose();
        onBinModalClose();
        fetchLocations(); // Refresh the list after save
    };

    const siteColumns: Column[] = [
        {
            accessorKey: 'actions',
            header: 'Actions',
            isSortable: false,
            cell: (row: Site) => (
                <HStack spacing={2}>
                    <Button
                        aria-label="Edit site"
                        leftIcon={<EditIcon />}
                        size="sm"
                        colorScheme="brand"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEditSite(row);
                        }}
                    >
                        Edit
                    </Button>
                </HStack>
            ),
        },
        { accessorKey: 'name', header: 'Site Name', isSortable: true },
        { accessorKey: 'location', header: 'Location', isSortable: true },
        { accessorKey: 'manager.name', header: 'Manager', isSortable: true },
        { accessorKey: 'contactNumber', header: 'Contact', isSortable: false },
    ];

    const binColumns: Column[] = [
        {
            accessorKey: 'actions',
            header: 'Actions',
            isSortable: false,
            cell: (row: Bin) => (
                <HStack spacing={2}>
                    <Button
                        aria-label="Edit bin"
                        leftIcon={<EditIcon />}
                        size="sm"
                        colorScheme="brand"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEditBin(row);
                        }}
                    >
                        Edit
                    </Button>
                </HStack>
            ),
        },
        { accessorKey: 'name', header: 'Bin Name', isSortable: true },
        { accessorKey: 'site.name', header: 'Site', isSortable: true },
        { accessorKey: 'binType', header: 'Type', isSortable: true },
        { accessorKey: 'locationDescription', header: 'Description', isSortable: false },
    ];

    // Theming props
    const bgPrimary = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
    const primaryTextColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
    const secondaryTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');


    if (status === 'loading') {
        return (
            <Flex justify="center" align="center" height="80vh" bg={bgPrimary}>
                <Spinner size="xl" />
            </Flex>
        );
    }

    if (!isSiteManagerOrAdmin) {
        return (
            <Box p={{ base: 4, md: 8 }} flex="1" textAlign="center" bg={bgPrimary}>
                <Text color="red.500" fontSize="lg" fontWeight="semibold">You do not have permission to view this page.</Text>
            </Box>
        );
    }

    return (
        <Box p={{ base: 4, md: 8 }} flex="1" bg={bgPrimary}>
            <Heading as="h1" size={{ base: 'xl', md: '2xl' }} mb={6} color={primaryTextColor}>
                Locations Management
            </Heading>

            <Tabs variant="enclosed" onChange={(index) => setActiveTab(index)} colorScheme="brand">
                <TabList>
                    <Tab>Sites</Tab>
                    <Tab>Storage Bins</Tab>
                </TabList>

                <TabPanels>
                    {/* Sites Tab */}
                    <TabPanel p={0} mt={6}>
                        <Flex justify="space-between" align="center" mb={6} flexWrap="wrap" gap={4}>
                            <Heading as="h2" size={{ base: 'md', md: 'lg' }} color={primaryTextColor}>
                                Sites
                            </Heading>
                            <Button colorScheme="brand" onClick={handleAddSite} size="md">
                                Add New Site
                            </Button>
                        </Flex>
                        <Text mb={6} color={secondaryTextColor}>
                            Manage and view all sites.
                        </Text>
                        <DataTable
                            columns={siteColumns}
                            data={sites}
                            loading={loading}
                        />
                    </TabPanel>

                    {/* Bins Tab */}
                    <TabPanel p={0} mt={6}>
                        <Flex justify="space-between" align="center" mb={6} flexWrap="wrap" gap={4}>
                            <Heading as="h2" size={{ base: 'md', md: 'lg' }} color={primaryTextColor}>
                                Storage Bins
                            </Heading>
                            <Button colorScheme="brand" onClick={handleAddBin} size="md">
                                Add New Bin
                            </Button>
                        </Flex>
                        <Text mb={6} color={secondaryTextColor}>
                            Manage and view all storage bins.
                        </Text>
                        <DataTable
                            columns={binColumns}
                            data={bins}
                            loading={loading}
                        />
                    </TabPanel>
                </TabPanels>
            </Tabs>

            <SiteModal
                isOpen={isSiteModalOpen}
                onClose={onSiteModalClose}
                site={selectedSite}
                onSave={handleItemSaved}
            />
            <BinModal
                isOpen={isBinModalOpen}
                onClose={onBinModalClose}
                bin={selectedBin}
                onSave={handleItemSaved}
                sites={sites}
            />
        </Box>
    );
}