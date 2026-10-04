"use client";

// Mobile-first financial summary for the reports page.
//
// Replaces nine equally-weighted, single-column tiles (which needed ~9 screens
// of scrolling on a phone and showed unformatted numbers like
// "SZL 1,137,069.51" next to "SZL -43,390.782") with:
//   1. data-quality alerts driven by computeFinancials()'s integrity checks,
//   2. four headline numbers in a 2x2 grid,
//   3. a stock-movement statement that reads top to bottom and visibly adds up,
//   4. a collapsed "how this is calculated" section.

import React from "react";
import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Divider,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { format } from "date-fns";
import {
  formatSZL,
  formatSZLCompact,
  type IntegrityIssue,
} from "@/lib/financialReport";

interface FinancialSummaryProps {
  financial: any;
  summary: any;
  periodStart: string;
  periodEnd: string;
  vatRatePercentage: number;
}

const severityStatus = (s: IntegrityIssue["severity"]) =>
  s === "critical" ? "error" : s === "warning" ? "warning" : "info";

const safeDate = (v: string) => {
  try {
    return format(new Date(v), "d MMM yyyy");
  } catch {
    return v;
  }
};

const Headline = ({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "good" | "bad" | "neutral";
}) => {
  const border = useColorModeValue("gray.200", "whiteAlpha.300");
  const color =
    tone === "good" ? "green.400" : tone === "bad" ? "red.400" : undefined;
  return (
    <Box borderWidth="1px" borderColor={border} borderRadius="lg" p={3}>
      <Text fontSize="xs" textTransform="uppercase" opacity={0.7}>
        {label}
      </Text>
      <Text
        fontSize={{ base: "lg", md: "2xl" }}
        fontWeight="bold"
        color={color}
        // Full precision on tap/hover; compact form keeps 7-figure values on
        // one line at phone width.
        title={formatSZL(value)}
      >
        {formatSZLCompact(value)}
      </Text>
      {hint && (
        <Text fontSize="xs" opacity={0.7}>
          {hint}
        </Text>
      )}
    </Box>
  );
};

const Row = ({
  label,
  hint,
  value,
  sign,
  strong,
  tone,
}: {
  label: string;
  hint?: string;
  value: number;
  sign?: "+" | "−" | "=";
  strong?: boolean;
  tone?: "good" | "bad";
}) => (
  <Flex justify="space-between" align="baseline" gap={3} py={1.5}>
    <Box minW={0}>
      <Text fontWeight={strong ? "bold" : "medium"} noOfLines={1}>
        {sign && (
          <Text as="span" opacity={0.6} mr={2}>
            {sign}
          </Text>
        )}
        {label}
      </Text>
      {hint && (
        <Text fontSize="xs" opacity={0.65}>
          {hint}
        </Text>
      )}
    </Box>
    <Text
      fontWeight={strong ? "bold" : "semibold"}
      whiteSpace="nowrap"
      color={tone === "good" ? "green.400" : tone === "bad" ? "red.400" : undefined}
      sx={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatSZL(value)}
    </Text>
  </Flex>
);

export default function FinancialSummary({
  financial,
  summary,
  periodStart,
  periodEnd,
  vatRatePercentage,
}: FinancialSummaryProps) {
  const border = useColorModeValue("gray.200", "whiteAlpha.300");
  const issues: IntegrityIssue[] = financial?.integrity || [];
  const blocking = issues.filter((i) => i.severity !== "info");
  const notes = issues.filter((i) => i.severity === "info");

  const f = financial || {};
  const transfers = Number(f.netTransfers) || 0;
  const vatDue = Number(f.netVATPayable) || 0;

  return (
    <Stack spacing={4}>
      <Box>
        <Heading size="md">Financial Performance</Heading>
        <Text fontSize="sm" opacity={0.7}>
          {safeDate(periodStart)} – {safeDate(periodEnd)} · excludes VAT unless
          stated
        </Text>
      </Box>

      {blocking.length === 0 ? (
        <Alert status="success" fontSize="sm" borderRadius="md">
          <AlertIcon />
          <AlertDescription>
            Opening stock continues from the previous period and no data-quality
            problems were detected.
          </AlertDescription>
        </Alert>
      ) : (
        <Stack spacing={2}>
          {blocking.map((issue) => (
            <Alert
              key={issue.id}
              status={severityStatus(issue.severity)}
              fontSize="sm"
              borderRadius="md"
              alignItems="flex-start"
            >
              <AlertIcon mt={0.5} />
              <Box>
                <AlertTitle fontSize="sm">{issue.title}</AlertTitle>
                <AlertDescription>{issue.detail}</AlertDescription>
              </Box>
            </Alert>
          ))}
        </Stack>
      )}

      {/* Headline numbers: the four things people open this page for */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
        <Headline
          label="Sales"
          value={f.periodSales || 0}
          hint={`${(summary?.totalPeopleFed || 0).toLocaleString()} people fed`}
        />
        <Headline
          label="Cost of goods sold"
          value={f.periodConsumption || 0}
          hint={`${summary?.totalDispatches || 0} dispatches`}
        />
        <Headline
          label="Gross profit"
          value={f.grossProfitAfterVAT || 0}
          hint={`${(f.profitPercentage || 0).toFixed(1)}% margin`}
          tone={(f.grossProfitAfterVAT || 0) >= 0 ? "good" : "bad"}
        />
        <Headline
          label={vatDue >= 0 ? "VAT payable" : "VAT refundable"}
          value={Math.abs(vatDue)}
          hint={`Output ${formatSZLCompact(f.vatOnSales || 0)} − input ${formatSZLCompact(
            f.vatOnPurchases || 0,
          )}`}
          tone={vatDue >= 0 ? "bad" : "good"}
        />
      </SimpleGrid>

      {/* Stock movement statement */}
      <Box borderWidth="1px" borderColor={border} borderRadius="lg" p={4}>
        <Text fontWeight="bold" mb={1}>
          Stock movement
        </Text>
        <Row
          label="Opening stock"
          hint={`Closing stock at ${safeDate(periodStart)}`}
          value={f.openingStock || 0}
        />
        <Row
          label="Goods received"
          hint={`${summary?.totalGoodsReceipts || 0} completed receipts`}
          value={f.periodPurchases || 0}
          sign="+"
        />
        <Row
          label="Consumed"
          hint={`${summary?.totalDispatches || 0} dispatches`}
          value={f.periodConsumption || 0}
          sign="−"
        />
        <Row
          label="Count variances"
          hint={`${summary?.totalBinCounts || 0} counts`}
          value={f.netVariances || 0}
          sign={(f.netVariances || 0) < 0 ? "−" : "+"}
          tone={(f.netVariances || 0) < 0 ? "bad" : undefined}
        />
        {transfers !== 0 && (
          <Row
            label="Net transfers"
            hint="Moved in / out of this site"
            value={transfers}
            sign={transfers < 0 ? "−" : "+"}
          />
        )}
        <Divider my={2} />
        <Row
          label="Closing stock"
          hint={`Calculated at ${safeDate(periodEnd)}`}
          value={f.closingStockValue || 0}
          sign="="
          strong
        />
      </Box>

      {notes.length > 0 && (
        <Stack spacing={1}>
          {notes.map((n) => (
            <Text key={n.id} fontSize="xs" opacity={0.75}>
              ℹ {n.detail}
            </Text>
          ))}
        </Stack>
      )}

      <Accordion allowToggle>
        <AccordionItem border="none">
          <AccordionButton px={0}>
            <Box flex="1" textAlign="left" fontSize="sm" fontWeight="medium">
              How this is calculated
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel px={0} fontSize="sm">
            <Stack spacing={1}>
              <Text>
                • Only completed receipts and dispatches count. Drafts,
                cancelled documents and dispatches still awaiting evidence are
                left out (and listed above).
              </Text>
              <Text>
                • Opening stock = everything received, minus everything
                consumed, plus count variances, before the period starts. It
                therefore always equals the previous period&apos;s closing
                stock.
              </Text>
              <Text>
                • Sales use the price stamped on each dispatch (site price at the
                time), not today&apos;s menu price.
              </Text>
              <Text>
                • Gross profit = sales (excl. VAT) − cost of goods sold. VAT is
                a liability, not an expense, and is shown separately.
              </Text>
              <Text>
                • VAT at {vatRatePercentage}% (Eswatini standard rate): output
                VAT on sales minus input VAT on received goods.
              </Text>
            </Stack>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Stack>
  );
}
