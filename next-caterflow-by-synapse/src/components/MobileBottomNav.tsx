"use client";

import {
  Flex,
  IconButton,
  Text,
  Box,
  useColorModeValue,
  Tooltip,
} from "@chakra-ui/react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FiBarChart2,
  FiDatabase,
  FiTruck,
  FiCheckCircle,
  FiFileText,
  FiShoppingCart,
  FiShoppingBag,
  FiList,
  FiActivity,
  FiAlertCircle,
  FiMenu,
} from "react-icons/fi";
import { useSidebar } from "@/context/SidebarContext";
import { getBottomNavItems } from "@/lib/navigationConfig";

export const MobileBottomNav = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { toggleSidebar } = useSidebar();

  const bg = useColorModeValue("white", "gray.900");
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const activeColor = useColorModeValue("brand.500", "brand.300");
  const inactiveColor = useColorModeValue("gray.500", "gray.400");

  const userRole = session?.user?.role as string | undefined;
  const navItems = getBottomNavItems(userRole, 4);

  const navigateTo = (href: string) => {
    router.push(href);
  };

  return (
    <Box
      display={{ base: "block", md: "none" }}
      position="fixed"
      bottom="0"
      left="0"
      right="0"
      bg={bg}
      borderTop="1px solid"
      borderColor={borderColor}
      zIndex={1200}
      py={2}
      px={2}
    >
      <Flex align="center" justify="space-between">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Tooltip key={item.href} label={item.label} openDelay={300}>
              <IconButton
                aria-label={item.label}
                icon={<item.icon />}
                variant="ghost"
                color={isActive ? activeColor : inactiveColor}
                onClick={() => navigateTo(item.href)}
                onTouchStart={() => router.prefetch(item.href)}
                fontSize="20px"
                _hover={{ bg: "transparent", color: activeColor }}
              />
            </Tooltip>
          );
        })}

        <Tooltip label="Menu" openDelay={300}>
          <IconButton
            aria-label="Open sidebar"
            icon={<FiMenu />}
            variant="ghost"
            color={inactiveColor}
            onClick={toggleSidebar}
            fontSize="20px"
            _hover={{ bg: "transparent", color: activeColor }}
          />
        </Tooltip>
      </Flex>
    </Box>
  );
};
