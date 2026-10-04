"use client";

// Bottom sheet listing the documents behind a headline figure. The rows come
// from buildDrillRows(), which uses the same inclusion and valuation rules as
// the figure itself, so the list adds up to the number that was tapped.

import React, { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Input,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { format, isValid } from "date-fns";
import { formatSZL, type DrillRow } from "@/lib/financialReport";

interface DrillDownDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  rows: DrillRow[];
  /** Hide the value column (roles without finance access). */
  showValues?: boolean;
}

const PAGE = 100;

const dateLabel = (v: string) => {
  const d = new Date(v);
  return isValid(d) ? format(d, "d MMM yyyy") : "No date";
};

export default function DrillDownDrawer({
  isOpen,
  onClose,
  title,
  description,
  rows,
  showValues = true,
}: DrillDownDrawerProps) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const border = useColorModeValue("gray.200", "whiteAlpha.300");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.site, r.note, r.extra, r.status]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const total = useMemo(
    () => filtered.reduce((s, r) => s + r.value, 0),
    [filtered],
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={() => {
        setQuery("");
        setShown(PAGE);
        onClose();
      }}
      placement="bottom"
    >
      <DrawerOverlay />
      <DrawerContent borderTopRadius="xl" maxH="90vh">
        <DrawerCloseButton />
        <DrawerHeader pb={1}>
          {title}
          {description && (
            <Text fontSize="sm" fontWeight="normal" opacity={0.75}>
              {description}
            </Text>
          )}
        </DrawerHeader>
        <DrawerBody>
          <Input
            placeholder="Search number, site, item…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            mb={3}
            aria-label="Search documents"
          />
          {filtered.length === 0 ? (
            <Text py={8} textAlign="center" opacity={0.7}>
              {rows.length === 0
                ? "No documents contribute to this figure in the selected period."
                : "No documents match your search."}
            </Text>
          ) : (
            <Stack spacing={0} divider={<Box borderBottomWidth="1px" borderColor={border} />}>
              {filtered.slice(0, shown).map((r) => (
                <Flex key={`${r.kind}-${r.id}`} py={2.5} gap={3} justify="space-between" minH="44px">
                  <Box minW={0}>
                    <Text fontWeight="semibold" noOfLines={1}>
                      {r.number}
                    </Text>
                    <Text fontSize="xs" opacity={0.7} noOfLines={1}>
                      {dateLabel(r.date)} · {r.site}
                      {r.extra ? ` · ${r.extra}` : ""}
                    </Text>
                    {r.note && (
                      <Text fontSize="xs" color="orange.300" noOfLines={2}>
                        {r.note}
                      </Text>
                    )}
                  </Box>
                  <Box textAlign="right" flexShrink={0}>
                    {showValues && (
                      <Text fontWeight="semibold" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatSZL(r.value)}
                      </Text>
                    )}
                    {r.status && (
                      <Badge fontSize="2xs" variant="subtle">
                        {r.status}
                      </Badge>
                    )}
                  </Box>
                </Flex>
              ))}
            </Stack>
          )}
          {filtered.length > shown && (
            <Button mt={3} w="100%" variant="ghost" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, filtered.length - shown)} more
            </Button>
          )}
        </DrawerBody>
        <DrawerFooter justifyContent="space-between" borderTopWidth="1px" borderColor={border}>
          <Text fontSize="sm">
            {filtered.length} document{filtered.length === 1 ? "" : "s"}
          </Text>
          {showValues && (
            <Text fontWeight="bold" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatSZL(total)}
            </Text>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
