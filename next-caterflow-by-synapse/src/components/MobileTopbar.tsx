// components/MobileTopbar.tsx
'use client';

import { Flex, IconButton, Heading, Box, useColorModeValue } from '@chakra-ui/react';
import { HamburgerIcon } from '@chakra-ui/icons';
import { useSidebar } from '@/context/SidebarContext';
import Image from 'next/image';

import { usePWAInstall } from '@/hooks/usePWAInstall';
import { Button, Icon } from '@chakra-ui/react';
import { FiDownload } from 'react-icons/fi';
import { useRouter, usePathname } from 'next/navigation';

export const MobileTopbar = ({ onItemClick }: { onItemClick?: () => void }) => {
    const { toggleSidebar } = useSidebar();
    const { isInstallable, promptInstall } = usePWAInstall();

    const router = useRouter();


    // 1. Define theme-aware colors using tokens from your theme.ts
    const bg = useColorModeValue('neutral.light.bg-header', 'neutral.dark.bg-header');
    const borderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
    const headingColor = useColorModeValue('brand.500', 'brand.300'); // Use a lighter brand color in dark mode for contrast

    const handleItemClick = (href: string) => {
        router.push(href);
        onItemClick?.();
    };

    return (
        <Flex
            as="header" // 2. Use semantic HTML for accessibility
            position="fixed"
            top="0"
            left="0"
            right="0"
            height="60px"
            bg={bg} // Use theme-based background
            borderBottomWidth="1px" // Use explicit style prop
            borderColor={borderColor} // Use theme-based border color
            align="center"
            px={4}
            zIndex={1100} // 3. Set a numeric z-index for proper stacking
            display={{ base: 'flex', md: 'none' }}
        >
            <IconButton
                aria-label="Open sidebar"
                icon={<HamburgerIcon />}
                variant="ghost"
                onClick={toggleSidebar} // 4. Removed console.log
                mr={3}
            />
            <Flex align="center">
                {/* App Icon */}
                <Box
                    w={8}
                    h={8}
                    bg="white" // This white bg is kept intentionally to make the logo stand out in both modes
                    borderRadius="md"
                    mr={2}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    overflow="hidden"
                    onClick={() => handleItemClick('/')}
                >
                    <Image
                        src="/icons/icon-512x512.png"
                        alt="Caterflow Logo"
                        width={32}
                        height={32}
                        style={{ objectFit: 'cover' }}
                    />
                </Box>
                <Heading size="md" color={headingColor}
                    onClick={() => handleItemClick('/')}
                >
                    Caterflow
                </Heading>
                {isInstallable && (
                    <Button onClick={promptInstall} size="sm" colorScheme="blue">
                        <Icon as={FiDownload} mr={2} />
                        Install App
                    </Button>
                )}
            </Flex>
        </Flex>
    );
};