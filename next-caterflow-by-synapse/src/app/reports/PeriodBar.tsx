"use client";

// Sticky period/site bar for the reports page. Replaces four separate cards
// (VAT rate, site banner, "showing data for", quick date ranges) and the
// per-tab date inputs, none of which stayed on screen while scrolling.

import React, { useEffect, useState } from "react";
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
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Progress,
  Select,
  Stack,
  Text,
  Wrap,
  WrapItem,
  useColorModeValue,
  useDisclosure,
} from "@chakra-ui/react";
import { format, isValid, parseISO } from "date-fns";
import { FiCalendar, FiChevronDown, FiRefreshCw } from "react-icons/fi";

export interface DateRange {
  start: string;
  end: string;
}
export interface DatePreset extends DateRange {
  label: string;
}

interface PeriodBarProps {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  presets: DatePreset[];
  sites: { _id: string; name: string }[];
  selectedSite: string | null;
  onSiteChange: (siteId: string | null) => void;
  /** Multi-site users can pick; single-site users see their site as a fixed label. */
  canPickSite: boolean;
  fixedSiteName?: string;
  lastUpdated: Date | null;
  loading: boolean;
  progress?: { done: number; total: number } | null;
  onRefresh: () => void;
}

/** "1–4 Oct 2026", "28 Sep – 4 Oct 2026", "1 Sep – 30 Sep 2026" */
export function formatRangeLabel(range: DateRange): string {
  const s = parseISO(range.start);
  const e = parseISO(range.end);
  if (!isValid(s) || !isValid(e)) return "Choose period";
  if (format(s, "yyyy-MM") === format(e, "yyyy-MM")) {
    return s.getTime() === e.getTime()
      ? format(s, "d MMM yyyy")
      : `${format(s, "d")}–${format(e, "d MMM yyyy")}`;
  }
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

/** True while the period's last day is inside the current, unfinished month. */
export function isPartialPeriod(range: DateRange, now: Date = new Date()): boolean {
  const e = parseISO(range.end);
  if (!isValid(e)) return false;
  const lastDay = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate();
  return (
    e.getFullYear() === now.getFullYear() &&
    e.getMonth() === now.getMonth() &&
    e.getDate() < lastDay
  );
}

export default function PeriodBar({
  range,
  onRangeChange,
  presets,
  sites,
  selectedSite,
  onSiteChange,
  canPickSite,
  fixedSiteName,
  lastUpdated,
  loading,
  progress,
  onRefresh,
}: PeriodBarProps) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const bg = useColorModeValue("white", "gray.800");
  const border = useColorModeValue("gray.200", "whiteAlpha.300");
  const [draft, setDraft] = useState<DateRange>(range);

  useEffect(() => {
    if (isOpen) setDraft(range);
  }, [isOpen, range]);

  const siteLabel = canPickSite
    ? sites.find((s) => s._id === selectedSite)?.name || "All sites"
    : fixedSiteName || "Your site";
  const partial = isPartialPeriod(range);
  const draftValid =
    isValid(parseISO(draft.start)) &&
    isValid(parseISO(draft.end)) &&
    draft.start <= draft.end;

  return (
    <>
      <Box
        position="sticky"
        top={{ base: "60px", md: 0 }}
        zIndex={1000}
        bg={bg}
        borderBottomWidth="1px"
        borderColor={border}
        mx={{ base: -4, md: -8 }}
        px={{ base: 4, md: 8 }}
        py={2}
        role="region"
        aria-label="Report period and site"
      >
        <Flex gap={2} align="center">
          <Button
            flex="1"
            minW={0}
            justifyContent="space-between"
            variant="outline"
            size="md"
            leftIcon={<FiCalendar />}
            rightIcon={<FiChevronDown />}
            onClick={onOpen}
            aria-label={`Change period and site. Showing ${formatRangeLabel(range)} for ${siteLabel}`}
          >
            <Text noOfLines={1} fontWeight="semibold">
              {formatRangeLabel(range)} · {siteLabel}
            </Text>
          </Button>
          <IconButton
            aria-label="Refresh data"
            icon={<FiRefreshCw />}
            variant="outline"
            onClick={onRefresh}
            isLoading={loading}
            minW="44px"
            h="40px"
          />
        </Flex>
        <HStack mt={1} spacing={2} fontSize="xs" opacity={0.8} minH="18px">
          {partial && (
            <Badge colorScheme="orange" variant="subtle">
              Partial period
            </Badge>
          )}
          {loading && progress ? (
            <Text>
              Loading {progress.done}/{progress.total} sources…
            </Text>
          ) : lastUpdated ? (
            <Text>Updated {format(lastUpdated, "HH:mm")}</Text>
          ) : null}
        </HStack>
        {loading && (
          <Progress
            size="xs"
            isIndeterminate={!progress}
            value={progress ? (progress.done / progress.total) * 100 : undefined}
            position="absolute"
            left={0}
            right={0}
            bottom={0}
          />
        )}
      </Box>

      <Drawer isOpen={isOpen} onClose={onClose} placement="bottom">
        <DrawerOverlay />
        <DrawerContent borderTopRadius="xl" maxH="85vh">
          <DrawerCloseButton />
          <DrawerHeader>Period and site</DrawerHeader>
          <DrawerBody>
            <Stack spacing={5}>
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Quick ranges
                </Text>
                <Wrap spacing={2}>
                  {presets.map((p) => (
                    <WrapItem key={p.label}>
                      <Button
                        size="sm"
                        variant={
                          p.start === range.start && p.end === range.end
                            ? "solid"
                            : "outline"
                        }
                        colorScheme={
                          p.start === range.start && p.end === range.end
                            ? "blue"
                            : undefined
                        }
                        minH="44px"
                        onClick={() => {
                          onRangeChange({ start: p.start, end: p.end });
                          onClose();
                        }}
                      >
                        {p.label}
                      </Button>
                    </WrapItem>
                  ))}
                </Wrap>
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Custom range
                </Text>
                <HStack>
                  <FormControl>
                    <FormLabel fontSize="xs">From</FormLabel>
                    <Input
                      type="date"
                      value={draft.start}
                      max={draft.end || undefined}
                      onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">To</FormLabel>
                    <Input
                      type="date"
                      value={draft.end}
                      min={draft.start || undefined}
                      onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    />
                  </FormControl>
                </HStack>
              </Box>

              <FormControl>
                <FormLabel fontSize="sm">Site</FormLabel>
                {canPickSite ? (
                  <Select
                    value={selectedSite || "all"}
                    onChange={(e) =>
                      onSiteChange(e.target.value === "all" ? null : e.target.value)
                    }
                  >
                    <option value="all">All sites</option>
                    {sites.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge colorScheme="green" p={2} fontSize="sm">
                    {fixedSiteName || "Your site"}
                  </Badge>
                )}
              </FormControl>
            </Stack>
          </DrawerBody>
          <DrawerFooter gap={2}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              colorScheme="blue"
              isDisabled={!draftValid}
              onClick={() => {
                onRangeChange(draft);
                onClose();
              }}
            >
              Apply dates
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
