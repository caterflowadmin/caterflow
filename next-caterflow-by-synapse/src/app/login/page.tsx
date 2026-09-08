'use client';

import { Suspense, useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Heading,
  Text,
  Flex,
  useToast,
  Spinner,
  Card,
  CardBody,
  VStack,
  useBreakpointValue,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  InputGroup,
  InputRightElement,
  IconButton,
  Alert,
  AlertIcon,
  useColorModeValue,
} from '@chakra-ui/react';
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { motion } from 'framer-motion';

// useSearchParams() opts this out of static rendering, which requires a
// Suspense boundary around the component that calls it — see the default
// export below, which supplies that boundary. LoginPageInner is not
// exported directly.
function LoginPageInner() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const cardWidth = useBreakpointValue({ base: '90%', sm: '400px' });

  // Get the redirect parameter from URL
  const redirect = searchParams.get('redirect') || '/';

  // Theming props
  const bgPrimary = useColorModeValue('neutral.light.bg-primary', 'neutral.dark.bg-primary');
  const bgCard = useColorModeValue('neutral.light.bg-card', 'neutral.dark.bg-card');
  const borderColor = useColorModeValue('neutral.light.border-color', 'neutral.dark.border-color');
  const primaryTextColor = useColorModeValue('neutral.light.text-primary', 'neutral.dark.text-primary');
  const secondaryTextColor = useColorModeValue('neutral.light.text-secondary', 'neutral.dark.text-secondary');

  useEffect(() => {
    // Redirect if already logged in
    if (status === 'authenticated') {
      router.push(redirect);
    }
  }, [status, router, redirect]);

  // In your handleLogin function in page.tsx
  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        // Handle specific error messages
        let errorMessage = 'Invalid email or password.';

        if (result.error.includes('Account is inactive')) {
          errorMessage = 'Account is inactive. Please contact administrator.';
        } else if (result.error.includes('Authentication failed')) {
          errorMessage = 'Authentication failed. Please try again.';
        }

        toast({
          title: 'Login failed.',
          description: errorMessage,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      } else {
        toast({
          title: 'Login successful!',
          description: 'Welcome back to Caterflow.',
          status: 'success',
          duration: 3000,
          isClosable: true,
        });
        router.push(redirect);
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: 'Login error.',
        description: 'An unexpected error occurred. Please try again.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetSuccess(false); // Reset success state

    if (!resetEmail) {
      toast({
        title: 'Email required.',
        description: 'Please enter your email address.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    setIsResetting(true);

    try {
      const response = await fetch('/api/auth/send-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setResetSuccess(true);
      } else {
        toast({
          title: 'Failed to send reset email.',
          description: data.message || 'An error occurred.',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error('Password reset error:', error);
      toast({
        title: 'Network error.',
        description: 'Failed to connect to the server.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsResetting(false);
    }
  };

  if (status === 'loading') {
    return (
      <Flex justify="center" align="center" minH="100vh" bg={bgPrimary}>
        <Spinner size="xl" color="brand.500" />
      </Flex>
    );
  }

  return (
    <>
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        bg={bgPrimary}
        p={4}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card
            bg={bgCard}
            boxShadow="xl"
            borderRadius="xl"
            borderWidth="1px"
            borderColor={borderColor}
            w={cardWidth}
          >
            <CardBody p={8}>
              <VStack spacing={6} align="stretch">
                <Box textAlign="center">
                  <Heading as="h1" size="xl" color={primaryTextColor} mb={2}>
                    Caterflow
                  </Heading>
                  <Text color={secondaryTextColor} fontSize="md">
                    Inventory Management System
                  </Text>
                </Box>

                <Box>
                  <Heading as="h2" size="lg" color={primaryTextColor} mb={2} textAlign="center">
                    Welcome Back
                  </Heading>
                  <Text color={secondaryTextColor} textAlign="center" mb={6}>
                    Sign in to your account
                  </Text>

                  <form onSubmit={handleLogin}>
                    <VStack spacing={4}>
                      <FormControl id="email" isRequired>
                        <FormLabel color={secondaryTextColor}>Email</FormLabel>
                        <Input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email"
                          borderColor={borderColor}
                          _placeholder={{ color: secondaryTextColor }}
                          _hover={{ borderColor: 'brand.500' }}
                          _focus={{ borderColor: 'brand.500', boxShadow: '0 0 0 1px var(--chakra-colors-brand-500)' }}
                        />
                      </FormControl>

                      <FormControl id="password" isRequired>
                        <FormLabel color={secondaryTextColor}>Password</FormLabel>
                        <InputGroup>
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            borderColor={borderColor}
                            _placeholder={{ color: secondaryTextColor }}
                            _hover={{ borderColor: 'brand.500' }}
                            _focus={{ borderColor: 'brand.500', boxShadow: '0 0 0 1px var(--chakra-colors-brand-500)' }}
                          />
                          <InputRightElement>
                            <IconButton
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowPassword(!showPassword)}
                              color={secondaryTextColor}
                            />
                          </InputRightElement>
                        </InputGroup>
                      </FormControl>

                      <Button
                        colorScheme="brand"
                        width="full"
                        type="submit"
                        isLoading={isLoading}
                        loadingText="Signing in..."
                        size="lg"
                        mt={4}
                      >
                        Sign In
                      </Button>
                    </VStack>
                  </form>

                  <Box mt={4} textAlign="center">
                    <Button
                      variant="link"
                      colorScheme="brand"
                      onClick={onOpen}
                    >
                      Forgot your password?
                    </Button>
                  </Box>
                </Box>
              </VStack>
            </CardBody>
          </Card>
        </motion.div>
      </Flex>

      {/* Password Reset Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent
          bg={bgCard}
          borderWidth="1px"
          borderColor={borderColor}
        >
          <ModalHeader color={primaryTextColor}>Reset Password</ModalHeader>
          <ModalCloseButton color={secondaryTextColor} />
          <form onSubmit={handlePasswordReset}>
            <ModalBody>
              {resetSuccess ? (
                <Alert status="success" mb={4} borderRadius="md" variant="subtle">
                  <AlertIcon />
                  A password reset link has been sent to **{resetEmail}**.
                  Please check your inbox to continue.
                </Alert>
              ) : (
                <Alert status="info" mb={4} borderRadius="md" variant="subtle">
                  <AlertIcon />
                  Enter your email address and we'll send you a verification code to reset your password.
                </Alert>
              )}

              <FormControl id="reset-email" isRequired isDisabled={resetSuccess}>
                <FormLabel color={secondaryTextColor}>Email Address</FormLabel>
                <Input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="Enter your email address"
                  borderColor={borderColor}
                  _placeholder={{ color: secondaryTextColor }}
                  _hover={{ borderColor: 'brand.500' }}
                  _focus={{ borderColor: 'brand.500', boxShadow: '0 0 0 1px var(--chakra-colors-brand-500)' }}
                />
              </FormControl>
            </ModalBody>

            <ModalFooter>
              <Button variant="ghost" mr={3} onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                type="submit"
                isLoading={isResetting}
                loadingText="Sending..."
                isDisabled={resetSuccess}
              >
                Send Reset Code
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Flex justify="center" align="center" minH="100vh">
          <Spinner size="xl" color="brand.500" />
        </Flex>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}