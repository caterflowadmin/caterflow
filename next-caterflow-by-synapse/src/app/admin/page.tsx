'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Heading,
  Text,
  Flex,
  useToast,
  Spinner,
  useColorModeValue,
  useTheme,
  IconButton,
  HStack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from '@chakra-ui/react';
import { client } from '@/lib/sanity';
import { groq } from 'next-sanity';
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation';
import { FiEdit } from 'react-icons/fi';
import { AppUser, Site } from '@/lib/sanityTypes';
const UserManagementModal = dynamic(() => import('@/components/UserManagementModal'), { ssr: false });
interface UserWithSiteName extends AppUser {
  associatedSiteName?: string;
}

export default function AdminPage() {
  // Replace this:
  // const { isAuthenticated, user, isAuthReady } = useSession();

  // With this:
  const { data: session, status } = useSession();
  const isAuthReady = status !== 'loading';
  const isAuthenticated = status === 'authenticated';
  const user = session?.user;
  const isAdmin = user?.role === 'admin';

  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();

  const [users, setUsers] = useState<UserWithSiteName[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<UserWithSiteName | null>(null);

  const bgColor = useColorModeValue(theme.colors.neutral.light['bg-primary'], theme.colors.neutral.dark['bg-primary']);
  const cardBgColor = useColorModeValue(theme.colors.neutral.light['bg-card'], theme.colors.neutral.dark['bg-card']);
  const textColor = useColorModeValue(theme.colors.neutral.light['text-primary'], theme.colors.neutral.dark['text-primary']);
  const tableCardBg = useColorModeValue(theme.colors.neutral.light['bg-surface'], theme.colors.neutral.dark['bg-surface']);
  const tableCardBorderColor = useColorModeValue(theme.colors.neutral.light['border-color'], theme.colors.neutral.dark['border-color']);
  const tableHeaderBg = useColorModeValue('gray.100', 'gray.600');
  const tableBorderColor = useColorModeValue('gray.200', 'gray.600');
  const textColorSecondary = useColorModeValue(theme.colors.neutral.light['text-secondary'], theme.colors.neutral.dark['text-secondary']);

  const fetchData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const usersQuery = groq`
        *[_type == "AppUser"]{
          _id,
          name,
          email,
          role,
          associatedSite->{_id, name}
        }
      `;
      const sitesQuery = groq`
        *[_type == "Site"]{
          _id,
          name
        }
      `;

      const [usersData, sitesData] = await Promise.all([
        client.fetch(usersQuery),
        client.fetch(sitesQuery)
      ]);

      const usersWithSiteNames = usersData.map((u: any) => ({
        ...u,
        associatedSiteName: u.associatedSite?.name || 'N/A'
      }));

      setUsers(usersWithSiteNames);
      setSites(sitesData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast({
        title: "Error",
        description: "Failed to load data. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoadingData(false);
    }
  }, [toast]);

  useEffect(() => {
    if (status === 'loading') return; // Wait for auth to be ready

    if (isAuthenticated && isAdmin) {
      fetchData();
    } else if (isAuthenticated && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You do not have permission to view this page.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      router.push('/');
    }
  }, [isAuthenticated, isAdmin, router, toast, fetchData, status]);

  const handleEditUserClick = (user: UserWithSiteName | null) => {
    setUserToEdit(user);
    setIsModalOpen(true);
  };

  const handleCreateUserClick = () => {
    setUserToEdit(null);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setUserToEdit(null);
  };

  const handleSaveSuccess = () => {
    handleModalClose();
    fetchData(); // Refresh data after saving
  };

  // Update loading check to use status
  if (status === 'loading') {
    return (
      <Box p={4}>
        <Flex justifyContent="center" alignItems="center" height="50vh">
          <Spinner size="xl" />
        </Flex>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box p={4}>
        <Text>Please log in to view this page.</Text>
      </Box>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <Box p={6} bg={bgColor} minH="100vh">
      <Flex justifyContent="space-between" alignItems="center" mb={6}>
        <Heading as="h1" size="lg" color={textColor}>
          Admin Panel
        </Heading>
        <Button colorScheme="blue" onClick={handleCreateUserClick}>
          Create New User
        </Button>
      </Flex>

      <Box bg={cardBgColor} p={6} borderRadius="lg" boxShadow="md" borderWidth="1px" borderColor={tableCardBorderColor}>
        <Heading as="h2" size="md" mb={4} color={textColor}>
          User Management
        </Heading>

        {users.length === 0 ? (
          <Text color={textColorSecondary}>No users found.</Text>
        ) : (
          <Box overflowX="auto">
            <Table variant="simple">
              <Thead bg={tableHeaderBg}>
                <Tr>
                  <Th color={textColor}>Name</Th>
                  <Th color={textColor}>Email</Th>
                  <Th color={textColor}>Role</Th>
                  <Th color={textColor}>Associated Site</Th>
                  <Th color={textColor}>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.map((user) => (
                  <Tr key={user._id} borderBottom="1px solid" borderColor={tableBorderColor}>
                    <Td color={textColorSecondary}>{user.name}</Td>
                    <Td color={textColorSecondary}>{user.email}</Td>
                    <Td color={textColorSecondary}>{user.role}</Td>
                    <Td color={textColorSecondary}>{user.associatedSiteName}</Td>
                    <Td>
                      <HStack spacing={2}>
                        <IconButton
                          aria-label="Edit user"
                          icon={<FiEdit />}
                          onClick={() => handleEditUserClick(user)}
                          size="sm"
                          colorScheme="blue"
                        />
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>

      <UserManagementModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        userToEdit={userToEdit}
        sites={sites}
        onSaveSuccess={handleSaveSuccess}
      />
    </Box>
  );
}