"use client";

// Inline state cards for the reports page: failed sources, errors with retry,
// and an empty period. A failed fetch used to be swallowed into [] and shown
// as plausible-looking zeros.

import React from "react";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
  Text,
} from "@chakra-ui/react";

export function LoadFailureBanner({
  failed,
  onRetry,
}: {
  failed: string[];
  onRetry: () => void;
}) {
  if (!failed.length) return null;
  return (
    <Alert status="error" borderRadius="md" alignItems="flex-start" role="alert">
      <AlertIcon mt={0.5} />
      <Box flex="1">
        <AlertTitle fontSize="sm">Figures are incomplete</AlertTitle>
        <AlertDescription fontSize="sm">
          Could not load: {failed.join(", ")}. Totals that depend on them are
          understated, so exports are disabled until this is resolved.
        </AlertDescription>
        <Button mt={2} size="sm" onClick={onRetry} colorScheme="red" variant="outline">
          Retry
        </Button>
      </Box>
    </Alert>
  );
}

export function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert status="error" borderRadius="md" alignItems="flex-start" role="alert">
      <AlertIcon mt={0.5} />
      <Box flex="1">
        <AlertTitle fontSize="sm">Could not load the report</AlertTitle>
        <AlertDescription fontSize="sm">{message}</AlertDescription>
        <Button mt={2} size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Box>
    </Alert>
  );
}

export function EmptyPeriod({ onWiden }: { onWiden: () => void }) {
  return (
    <Box textAlign="center" py={8} borderWidth="1px" borderStyle="dashed" borderRadius="lg">
      <Text fontWeight="semibold">No completed receipts or dispatches</Text>
      <Text fontSize="sm" opacity={0.75} mb={3}>
        Nothing in this period moved stock. Try a wider range.
      </Text>
      <Button size="sm" onClick={onWiden}>
        Show last 90 days
      </Button>
    </Box>
  );
}
