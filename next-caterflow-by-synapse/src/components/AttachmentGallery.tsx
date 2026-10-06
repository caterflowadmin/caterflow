'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Grid,
    Card,
    CardBody,
    Text,
    IconButton,
    useToast,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    Image,
    Button,
    VStack,
    HStack,
    Spinner,
    Flex,
    Heading,
    useColorModeValue, // ADDED
} from '@chakra-ui/react';
import { FiDownload, FiEye, FiTrash2, FiFile, FiUpload } from 'react-icons/fi'; // ADDED FiUpload

interface Attachment {
    _id: string;
    fileName: string;
    fileType: string;
    file: {
        asset: {
            url: string;
            originalFilename: string;
            size: number;
            mimeType: string;
        };
    };
    uploadedBy: {
        _id: string;
        name: string;
    };
    uploadedAt: string;
    description?: string;
}

interface AttachmentGalleryProps {
    relatedTo: string;
    canUpload?: boolean;
    onUploadClick?: () => void;
}

export default function AttachmentGallery({
    relatedTo,
    canUpload = false,
    onUploadClick,
}: AttachmentGalleryProps) {
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const toast = useToast();

    // Theming hooks
    const cardBg = useColorModeValue('neutral.light.bg-card', 'neutral.dark.bg-card');
    const cardBorder = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const headerColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
    const bodyColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');
    const modalBg = useColorModeValue('neutral.light.bg-modal', 'neutral.dark.bg-modal');
    const iconColor = useColorModeValue('gray.500', 'gray.400'); // Consistent icon color

    const fetchAttachments = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/attachments?relatedTo=${relatedTo}`);
            if (!response.ok) {
                throw new Error('Failed to fetch attachments');
            }
            const data = await response.json();
            setAttachments(data);
        } catch (error) {
            console.error('Error fetching attachments:', error);
            toast({
                title: 'Error loading attachments.',
                description: 'Failed to fetch files from the server.',
                status: 'error',
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setLoading(false);
        }
    }, [relatedTo, toast]);

    useEffect(() => {
        fetchAttachments();
    }, [fetchAttachments]);

    const handleView = (attachment: Attachment) => {
        setViewingAttachment(attachment);
        setIsViewerOpen(true);
    };

    const handleDownload = (attachment: Attachment) => {
        window.open(attachment.file.asset.url, '_blank');
    };

    const handleDelete = async (attachmentId: string) => {
        // Implement delete logic here
        toast({
            title: 'Delete feature not implemented.',
            description: `Attempted to delete attachment with ID: ${attachmentId}.`,
            status: 'info',
            duration: 5000,
            isClosable: true,
        });
    };

    const closeModal = () => {
        setIsViewerOpen(false);
        setViewingAttachment(null);
    };

    return (
        <Box>
            <Flex justifyContent="space-between" alignItems="center" mb={4}>
                <Heading size={{ base: 'sm', md: 'md' }} color={headerColor}>Attachments</Heading>
                {canUpload && (
                    <Button
                        size="sm"
                        leftIcon={<FiUpload />}
                        colorScheme="brand"
                        onClick={onUploadClick}
                    >
                        Upload
                    </Button>
                )}
            </Flex>

            {loading ? (
                <Flex justifyContent="center" alignItems="center" py={10}>
                    <Spinner size="lg" color="brand.500" />
                </Flex>
            ) : attachments.length > 0 ? (
                <Grid
                    templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' }}
                    gap={4}
                >
                    {attachments.map((attachment) => (
                        <Card
                            key={attachment._id}
                            variant="outline"
                            borderWidth="1px"
                            borderColor={cardBorder}
                            overflow="hidden"
                            bg={cardBg}
                            _hover={{
                                boxShadow: 'md',
                                transform: 'translateY(-2px)',
                            }}
                            transition="all 0.2s"
                            size="sm"
                        >
                            <CardBody p={3}>
                                <VStack spacing={2} align="stretch" textAlign="center">
                                    <Box
                                        w="full"
                                        h="120px"
                                        borderRadius="md"
                                        bg={cardBg}
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        overflow="hidden"
                                    >
                                        {attachment.file.asset.mimeType.startsWith('image/') ? (
                                            <Image
                                                src={attachment.file.asset.url}
                                                alt={attachment.fileName}
                                                objectFit="cover"
                                                width="full"
                                                height="full"
                                            />
                                        ) : (
                                            <FiFile size={48} color={iconColor} />
                                        )}
                                    </Box>
                                    <Text
                                        fontSize="xs"
                                        fontWeight="semibold"
                                        isTruncated
                                        color={headerColor}
                                    >
                                        {attachment.fileName}
                                    </Text>
                                    <HStack justifyContent="center" spacing={1}>
                                        <IconButton
                                            aria-label="View attachment"
                                            icon={<FiEye />}
                                            size="xs"
                                            onClick={() => handleView(attachment)}
                                            variant="ghost"
                                        />
                                        <IconButton
                                            aria-label="Download attachment"
                                            icon={<FiDownload />}
                                            size="xs"
                                            onClick={() => handleDownload(attachment)}
                                            variant="ghost"
                                        />
                                        {/* You can add a delete button with the following code:
                                        <IconButton
                                            aria-label="Delete attachment"
                                            icon={<FiTrash2 />}
                                            size="xs"
                                            onClick={() => handleDelete(attachment._id)}
                                            variant="ghost"
                                            colorScheme="red"
                                        />
                                        */}
                                    </HStack>
                                </VStack>
                            </CardBody>
                        </Card>
                    ))}
                </Grid>
            ) : (
                <Box textAlign="center" py={10} color={bodyColor}>
                    <FiFile size={48} style={{ margin: '0 auto' }} />
                    <Text mt={4}>No attachments found for this record.</Text>
                </Box>
            )}

            <Modal isOpen={isViewerOpen} onClose={closeModal} size={{ base: 'full', md: '3xl' }}>
                <ModalOverlay />
                <ModalContent bg={modalBg}>
                    <ModalHeader borderBottomWidth="1px" borderColor={cardBorder}>
                        <HStack justifyContent="space-between">
                            <Text noOfLines={1} pr={8}>{viewingAttachment?.fileName}</Text>
                            <ModalCloseButton position="static" />
                        </HStack>
                    </ModalHeader>
                    <ModalBody py={6}>
                        {viewingAttachment && (
                            <Box>
                                {viewingAttachment.file.asset.mimeType.startsWith('image/') ? (
                                    <Image
                                        src={viewingAttachment.file.asset.url}
                                        alt={viewingAttachment.fileName}
                                        maxH={{ base: '70vh', md: '60vh' }}
                                        mx="auto"
                                        objectFit="contain" // Ensure image fits within bounds
                                    />
                                ) : (
                                    <VStack textAlign="center" py={8} spacing={4}>
                                        <FiFile size={64} style={{ margin: '0 auto' }} />
                                        <Text mb={4} color={bodyColor}>
                                            This file type cannot be previewed.
                                        </Text>
                                        <Button
                                            colorScheme="brand"
                                            onClick={() => handleDownload(viewingAttachment)}
                                            leftIcon={<FiDownload />}
                                        >
                                            Download File
                                        </Button>
                                    </VStack>
                                )}
                            </Box>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </Box>
    );
}