"use client";

// Item-level comparison of what the document ledger implies against live
// stock, biggest value gaps first. This is where missing opening balances,
// unrecorded documents and price problems show up.

import React, { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Input,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { format, isValid } from "date-fns";
import { formatSZL, type ReconciliationRow } from "@/lib/financialReport";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rows: ReconciliationRow[];
}

const qtyFmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function ReconciliationPanel({ isOpen, onClose, rows }: Props) {
  const [query, setQuery] = useState("");
  const border = useColorModeValue("gray.200", "whiteAlpha.300");

  const mismatched = useMemo(
    () => rows.filter((r) => Math.abs(r.gapQty) > 0.0005),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? mismatched.filter((r) => r.name.toLowerCase().includes(q)) : mismatched;
    return base.slice(0, 200);
  }, [mismatched, query]);
  const netGap = mismatched.reduce((s, r) => s + r.gapValue, 0);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="bottom">
      <DrawerOverlay />
      <DrawerContent borderTopRadius="xl" maxH="90vh">
        <DrawerCloseButton />
        <DrawerHeader pb={1}>
          Stock reconciliation
          <Text fontSize="sm" fontWeight="normal" opacity={0.75}>
            Ledger (received − dispatched ± counts) vs live stock.{" "}
            {mismatched.length} item(s) differ, net {formatSZL(netGap)}.
          </Text>
        </DrawerHeader>
        <DrawerBody>
          <Input
            placeholder="Search item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            mb={3}
            aria-label="Search items"
          />
          {filtered.length === 0 ? (
            <Text py={8} textAlign="center" opacity={0.7}>
              {mismatched.length === 0
                ? "Ledger and live stock agree for every item."
                : "No items match your search."}
            </Text>
          ) : (
            <Stack spacing={0} divider={<Box borderBottomWidth="1px" borderColor={border} />}>
              {filtered.map((r) => (
                <Flex key={r.itemId} py={2.5} gap={3} justify="space-between">
                  <Box minW={0}>
                    <Text fontWeight="semibold" noOfLines={1}>
                      {r.name}
                    </Text>
                    <Text fontSize="xs" opacity={0.75}>
                      Ledger {qtyFmt(r.calculatedQty)} · Live {qtyFmt(r.liveQty)}
                      {r.unit ? ` ${r.unit}` : ""}
                    </Text>
                    {r.lastCountDate && isValid(new Date(r.lastCountDate)) && (
                      <Text fontSize="xs" opacity={0.6}>
                        Last count {qtyFmt(r.lastCountQty ?? 0)} on{" "}
                        {format(new Date(r.lastCountDate), "d MMM yyyy")}
                      </Text>
                    )}
                  </Box>
                  <Box textAlign="right" flexShrink={0}>
                    <Text
                      fontWeight="semibold"
                      color={r.gapValue < 0 ? "red.300" : "green.300"}
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {r.gapValue > 0 ? "+" : ""}
                      {formatSZL(r.gapValue)}
                    </Text>
                    <Badge variant="subtle" colorScheme={r.gapQty < 0 ? "red" : "green"}>
                      {r.gapQty > 0 ? "+" : ""}
                      {qtyFmt(r.gapQty)} qty
                    </Badge>
                  </Box>
                </Flex>
              ))}
            </Stack>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
