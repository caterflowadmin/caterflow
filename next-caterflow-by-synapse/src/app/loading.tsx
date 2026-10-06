'use client';

// Shown by Next.js immediately while a route segment loads, so navigation
// paints page structure straight away instead of a blank area.
import { Box, Skeleton, SimpleGrid, Stack } from '@chakra-ui/react';

export default function Loading() {
  return (
    <Box p={{ base: 4, md: 8 }} aria-busy="true" aria-label="Loading page">
      <Skeleton height="32px" width={{ base: '60%', md: '280px' }} mb={6} />
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={4} mb={8}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="96px" borderRadius="md" />
        ))}
      </SimpleGrid>
      <Stack spacing={3}>
        <Skeleton height="40px" borderRadius="md" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height="52px" borderRadius="md" />
        ))}
      </Stack>
    </Box>
  );
}
