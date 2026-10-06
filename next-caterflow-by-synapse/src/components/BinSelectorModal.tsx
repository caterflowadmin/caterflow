import { cachedFetch } from '@/lib/clientCache';
import React, { useState, useEffect, useCallback } from 'react';
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
    List,
    ListItem,
    Box,
    Text,
    Badge,
    useToast,
    InputGroup,
    InputLeftElement,
    Spinner,
    useColorModeValue,
} from '@chakra-ui/react';
import { FiSearch } from 'react-icons/fi';

interface Site {
    _id: string;
    name: string;
}

interface Bin {
    _id: string;
    name: string;
    site: Site;
    binType: string;
    locationDescription?: string;
}

interface BinSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (bin: Bin) => void;
    selectedSiteId?: string;
}

export default function BinSelectorModal({ isOpen, onClose, onSelect, selectedSiteId }: BinSelectorModalProps) {
    const [bins, setBins] = useState<Bin[]>([]);
    const [filteredBins, setFilteredBins] = useState<Bin[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [selectedSite, setSelectedSite] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const toast = useToast();

    // Theme-aware colors
    const modalBg = useColorModeValue('neutral.light.bg-secondary', 'neutral.dark.bg-secondary');
    const headerBg = useColorModeValue('neutral.light.bg-header', 'neutral.dark.bg-header');
    const borderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const listItemBg = useColorModeValue('neutral.light.bg-secondary', 'neutral.dark.bg-secondary');
    const listItemHoverBg = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
    const placeholderColor = useColorModeValue('neutral.light.text-placeholder', 'neutral.dark.text-placeholder');

    const fetchBinsAndSites = useCallback(async () => {
        setLoading(true);
        try {
            const [binsRes, sitesRes] = await Promise.all([
                cachedFetch('/api/bins'),
                cachedFetch('/api/sites'),
            ]);

            if (!binsRes.ok || !sitesRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const binsData = await binsRes.json();
            const sitesData = await sitesRes.json();

            setBins(binsData);
            setSites(sitesData);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching data:', error);
            toast({
                title: 'Error fetching data.',
                description: 'Failed to load bins and sites.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (isOpen) {
            fetchBinsAndSites();
            setSelectedSite(selectedSiteId || '');
        }
    }, [isOpen, fetchBinsAndSites, selectedSiteId]);

    useEffect(() => {
        const lowercasedSearchTerm = searchTerm.toLowerCase();
        const newFilteredBins = bins.filter(bin =>
            (selectedSite === '' || bin.site._id === selectedSite) &&
            (bin.name.toLowerCase().includes(lowercasedSearchTerm) ||
                bin.site.name.toLowerCase().includes(lowercasedSearchTerm) ||
                (bin.locationDescription && bin.locationDescription.toLowerCase().includes(lowercasedSearchTerm)))
        );
        setFilteredBins(newFilteredBins);
    }, [searchTerm, selectedSite, bins]);

    const handleBinSelect = (bin: Bin) => {
        onSelect(bin);
        onClose();
    };

    const getBinTypeColor = (binType: string) => {
        switch (binType) {
            case 'main-storage':
                return 'brand';
            case 'overflow-storage':
                return 'blue';
            case 'refrigerator':
            case 'freezer':
                return 'cyan';
            case 'dispensing-point':
                return 'green';
            case 'receiving-area':
                return 'purple';
            default:
                return 'gray';
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size={{ base: 'full', md: 'xl' }}
            scrollBehavior="inside"
        >
            <ModalOverlay />
            <ModalContent bg={modalBg}>
                <ModalHeader
                    bg={headerBg}
                    borderBottom="1px solid"
                    borderColor={borderColor}
                >
                    Select a Bin
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <VStack spacing={4} align="stretch" py={4}>
                        <InputGroup>
                            <InputLeftElement pointerEvents="none">
                                <FiSearch color={placeholderColor} />
                            </InputLeftElement>
                            <Input
                                placeholder="Search bins..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                _placeholder={{ color: placeholderColor }}
                            />
                        </InputGroup>
                        <Select
                            placeholder="Filter by Site"
                            value={selectedSite}
                            onChange={(e) => setSelectedSite(e.target.value)}
                        >
                            <option value="">All Sites</option>
                            {sites.map(site => (
                                <option key={site._id} value={site._id}>
                                    {site.name}
                                </option>
                            ))}
                        </Select>
                        <Box maxHeight="400px" overflowY="auto">
                            {loading ? (
                                <Box textAlign="center" py={10}>
                                    <Spinner size="xl" />
                                </Box>
                            ) : filteredBins.length === 0 ? (
                                <Text textAlign="center" color="neutral.light.text-secondary" mt={4}>
                                    No bins found.
                                </Text>
                            ) : (
                                <List spacing={3}>
                                    {filteredBins.map((bin) => (
                                        <ListItem
                                            key={bin._id}
                                            p={3}
                                            borderWidth="1px"
                                            borderRadius="md"
                                            borderColor={borderColor}
                                            bg={listItemBg}
                                            _hover={{ bg: listItemHoverBg, cursor: 'pointer' }}
                                            onClick={() => handleBinSelect(bin)}
                                        >
                                            <VStack align="start" spacing={1}>
                                                <HStack>
                                                    <Text fontWeight="bold">{bin.name}</Text>
                                                    <Badge colorScheme={getBinTypeColor(bin.binType)}>
                                                        {bin.binType}
                                                    </Badge>
                                                </HStack>
                                                <Text fontSize="sm" color="neutral.light.text-secondary">Site: {bin.site.name}</Text>
                                                {bin.locationDescription && (
                                                    <Text fontSize="sm" color="neutral.light.text-secondary">Location: {bin.locationDescription}</Text>
                                                )}
                                            </VStack>
                                        </ListItem>
                                    ))}
                                </List>
                            )}
                        </Box>
                    </VStack>
                </ModalBody>
                <ModalFooter
                    borderTop="1px solid"
                    borderColor={borderColor}
                >
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}