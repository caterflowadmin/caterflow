"use client";
import dynamic from 'next/dynamic';
import { cachedFetch } from '@/lib/clientCache';

import { logger } from '@/lib/logger';
import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Heading,
  Button,
  Flex,
  Spinner,
  useDisclosure,
  useToast,
  IconButton,
  Badge,
  useColorModeValue,
  Card,
  CardBody,
  Text,
  Input,
  InputGroup,
  InputLeftElement,
  HStack,
  Switch,
  FormLabel,
  Select,
  VStack,
  Tooltip,
} from "@chakra-ui/react";
import { FiPlus, FiSearch, FiFilter, FiEdit } from "react-icons/fi";
import DataTable, { Column } from "@/components/DataTable";
const UserManagementModal = dynamic(() => import("@/components/UserManagementModal"), { ssr: false });
import { AppUser, Site, Reference } from "@/lib/sanityTypes";
import { useSession } from "next-auth/react";

// Interface for display with expanded site reference
interface AppUserWithSite {
  _id: string;
  _type: string;
  _createdAt: string;
  _updatedAt: string;
  _rev: string;
  name: string;
  email: string;
  role:
    | "admin"
    | "siteManager"
    | "stockController"
    | "dispatchStaff"
    | "auditor";
  associatedSite?: {
    _id: string;
    name: string;
  };
  isActive: boolean;
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const currentUser = session?.user;

  const [users, setUsers] = useState<AppUserWithSite[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AppUserWithSite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedUser, setSelectedUser] = useState<AppUserWithSite | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  // Theming values from theme.ts
  const pageBg = useColorModeValue(
    "neutral.light.bg-primary",
    "neutral.dark.bg-primary",
  );
  const headingColor = useColorModeValue(
    "neutral.light.text-primary",
    "neutral.dark.text-primary",
  );
  const cardBg = useColorModeValue(
    "neutral.light.bg-card",
    "neutral.dark.bg-card",
  );
  const borderColor = useColorModeValue(
    "neutral.light.border-color",
    "neutral.dark.border-color",
  );
  const brand500 = useColorModeValue("brand.500", "brand.300");
  const secondaryTextColor = useColorModeValue(
    "neutral.light.text-secondary",
    "neutral.dark.text-secondary",
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersResponse, sitesResponse] = await Promise.all([
        fetch("/api/users"),
        cachedFetch("/api/sites"),
      ]);

      if (!usersResponse.ok || !sitesResponse.ok) {
        throw new Error("Failed to fetch data");
      }

      const [usersData, sitesData] = await Promise.all([
        usersResponse.json(),
        sitesResponse.json(),
      ]);

      // Debug: Log what we're getting from the API
      logger.debug("Users data from API:", usersData);
      logger.debug("Sites data from API:", sitesData);

      // The API already returns expanded site objects, so no need to map
      setUsers(usersData);
      setFilteredUsers(usersData);
      setSites(sitesData);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        title: "Error",
        description: "Failed to load users. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let result = users;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (user: AppUserWithSite) =>
          user.name.toLowerCase().includes(term) ||
          user.email.toLowerCase().includes(term),
      );
    }

    if (roleFilter !== "all") {
      result = result.filter(
        (user: AppUserWithSite) => user.role === roleFilter,
      );
    }

    if (statusFilter !== "all") {
      const status = statusFilter === "active";
      result = result.filter(
        (user: AppUserWithSite) => user.isActive === status,
      );
    }

    setFilteredUsers(result);
  }, [users, searchTerm, roleFilter, statusFilter]);

  const handleAddUser = () => {
    setSelectedUser(null);
    onOpen();
  };

  // In the handleEditUser function in users/page.tsx
  const handleEditUser = (user: AppUserWithSite) => {
    setSelectedUser({
      ...user,
      // Ensure associatedSite is in the correct format
      associatedSite: user.associatedSite
        ? {
            _id: user.associatedSite._id,
            name: user.associatedSite.name,
          }
        : undefined,
    } as any);
    onOpen();
  };

  const handleToggleStatus = async (user: AppUserWithSite) => {
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: user._id,
          isActive: !user.isActive,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user status");
      }

      // Efficiently update state without refetching all data
      setUsers((prevUsers) =>
        prevUsers.map((u) =>
          u._id === user._id ? { ...u, isActive: !u.isActive } : u,
        ),
      );

      toast({
        title: "Status updated.",
        description: `User status has been ${!user.isActive ? "activated" : "deactivated"}.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error updating user status:", error);
      toast({
        title: "Error",
        description: "Failed to update user status. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleSaveSuccess = () => {
    onClose();
    fetchData(); // Refetch all data to ensure the list is up-to-date
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "admin":
        return "purple";
      case "siteManager":
        return "blue";
      case "stockController":
        return "green";
      case "dispatchStaff":
        return "orange";
      case "auditor":
        return "teal";
      default:
        return "gray";
    }
  };

  const formatRoleName = (role: string) => {
    return role
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());
  };

  const canManageUsers = currentUser?.role === "admin";

  const columns: Column[] = [
    ...(canManageUsers
      ? [
          {
            accessorKey: "actions",
            header: "Actions",
            cell: (row: AppUserWithSite) => (
              <IconButton
                aria-label={`Edit user ${row.name}`}
                icon={<FiEdit />}
                size="sm"
                colorScheme="blue"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditUser(row);
                }}
              />
            ),
          },
        ]
      : []),
    {
      accessorKey: "name",
      header: "Name",
      isSortable: true,
    },
    {
      accessorKey: "email",
      header: "Email",
      isSortable: true,
    },
    {
      accessorKey: "role",
      header: "Role",
      isSortable: true,
      cell: (row: AppUserWithSite) => (
        <Badge
          colorScheme={getRoleColor(row.role)}
          fontSize="sm"
          px={2}
          py={1}
          borderRadius="full"
        >
          {formatRoleName(row.role)}
        </Badge>
      ),
    },
    {
      accessorKey: "associatedSite",
      header: "Site",
      isSortable: true,
      cell: (row: AppUserWithSite) => (
        <Text fontSize="sm" color={secondaryTextColor}>
          {row.associatedSite?.name || "N/A"}
        </Text>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      isSortable: true,
      cell: (row: AppUserWithSite) => (
        <Flex align="center">
          <Tooltip
            label={row.isActive ? "Deactivate user" : "Activate user"}
            hasArrow
          >
            <Switch
              isChecked={row.isActive}
              onChange={() => handleToggleStatus(row)}
              colorScheme={row.isActive ? "green" : "red"}
              size="md"
              mr={2}
              isDisabled={!canManageUsers || row._id === currentUser?.id}
              aria-label={
                row.isActive ? `Deactivate ${row.name}` : `Activate ${row.name}`
              }
            />
          </Tooltip>
          <Badge colorScheme={row.isActive ? "green" : "red"}>
            {row.isActive ? "Active" : "Inactive"}
          </Badge>
        </Flex>
      ),
    },
  ];

  if (loading || status === "loading") {
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
          <Heading as="h1" size="xl" color={headingColor}>
            User Management
          </Heading>
          {canManageUsers && (
            <Button
              leftIcon={<FiPlus />}
              colorScheme="brand"
              onClick={handleAddUser}
            >
              Add User
            </Button>
          )}
        </Flex>

        <Card
          bg={cardBg}
          border="1px"
          borderColor={borderColor}
          borderRadius="md"
          boxShadow="md"
          p={4}
        >
          <Flex
            direction={{ base: "column", md: "row" }}
            gap={4}
            justify="space-between"
            align={{ base: "stretch", md: "center" }}
          >
            <InputGroup maxW={{ base: "full", md: "300px" }}>
              <InputLeftElement pointerEvents="none" color={secondaryTextColor}>
                <FiSearch />
              </InputLeftElement>
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                bg={pageBg}
                borderColor={borderColor}
                _hover={{ borderColor: brand500 }}
                _focus={{
                  borderColor: brand500,
                  boxShadow: `0 0 0 1px ${brand500}`,
                }}
                color={headingColor}
              />
            </InputGroup>

            <HStack spacing={4} flexWrap="wrap">
              <Flex align="center">
                <FiFilter
                  color={secondaryTextColor}
                  style={{ marginRight: "8px" }}
                />
                <Text color={secondaryTextColor} mr={2}>
                  Role:
                </Text>
                <Select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  size="sm"
                  bg={pageBg}
                  color={headingColor}
                  borderColor={borderColor}
                  maxW="150px"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="siteManager">Site Manager</option>
                  <option value="stockController">Stock Controller</option>
                  <option value="dispatchStaff">Dispatch Staff</option>
                  <option value="auditor">Auditor</option>
                  <option value="procurer">Procurer</option>
                </Select>
              </Flex>

              <Flex align="center">
                <Text color={secondaryTextColor} mr={2}>
                  Status:
                </Text>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  size="sm"
                  bg={pageBg}
                  color={headingColor}
                  borderColor={borderColor}
                  maxW="120px"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Flex>
            </HStack>
          </Flex>
        </Card>

        <Card
          bg={cardBg}
          border="1px"
          borderColor={borderColor}
          borderRadius="md"
          boxShadow="md"
        >
          <CardBody p={0}>
            <DataTable columns={columns} data={filteredUsers} loading={false} />
          </CardBody>
        </Card>
      </VStack>

      <UserManagementModal
        isOpen={isOpen}
        onClose={onClose}
        userToEdit={selectedUser as any}
        sites={sites}
        onSaveSuccess={handleSaveSuccess}
      />
    </Box>
  );
}
