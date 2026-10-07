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
  Button,
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
  drillKindForIssue,
  formatSZL,
  formatSZLCompact,
  percentChange,
  type DrillKind,
  type IntegrityIssue,
} from "@/lib/financialReport";

interface FinancialSummaryProps {
  financial: any;
  summary: any;
  periodStart: string;
  periodEnd: string;
  vatRatePercentage: number;
  /** Previous equal-length period, for the "vs previous" chips. */
  previous?: {
    periodSales?: number;
    periodConsumption?: number;
    grossProfit?: number;
    netVATPayable?: number | null;
  } | null;
  /** Finance roles see VAT; operational roles do not. */
  showVat?: boolean;
  /** Tap a figure / row / alert to see the documents behind it. */
  onDrill?: (kind: DrillKind, title: string) => void;
  /** Opens the item-level reconciliation (admin / auditor, all-sites view). */
  onReconcile?: () => void;
  /** Where opening stock came from, if a closed period / opening balance was used. */
  anchoredOn?: { kind: "close" | "opening-balance" | "count"; asOf: string } | null;
  /** Extra controls rendered at the bottom (period close). */
  footer?: React.ReactNode;
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

// Colours that keep >= 4.5:1 contrast on both themes; direction is also shown
// with an arrow so colour is never the only signal.
const useTone = () => {
  const good = useColorModeValue("green.700", "green.300");
  const bad = useColorModeValue("red.700", "red.300");
  return { good, bad };
};

const Headline = ({
  label,
  value,
  hint,
  tone,
  previous,
  higherIsBetter = true,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "good" | "bad" | "neutral";
  /** Previous-period value; renders a "vs previous" chip when comparable. */
  previous?: number | null;
  higherIsBetter?: boolean;
  onClick?: () => void;
}) => {
  const border = useColorModeValue("gray.200", "whiteAlpha.300");
  const hover = useColorModeValue("gray.50", "whiteAlpha.100");
  const { good, bad } = useTone();
  const color = tone === "good" ? good : tone === "bad" ? bad : undefined;
  const delta = percentChange(value, previous ?? null);
  const improved = delta === null ? null : higherIsBetter ? delta >= 0 : delta <= 0;
  const interactive = !!onClick;
  return (
    <Box
      borderWidth="1px"
      borderColor={border}
      borderRadius="lg"
      p={3}
      as={interactive ? "button" : "div"}
      textAlign="left"
      onClick={onClick}
      minH="44px"
      _hover={interactive ? { bg: hover } : undefined}
      aria-label={interactive ? `${label}: ${formatSZL(value)}. Show documents` : undefined}
    >
      <Text fontSize="xs" textTransform="uppercase" opacity={0.75}>
        {label}
      </Text>
      <Text
        fontSize={{ base: "lg", md: "2xl" }}
        fontWeight="bold"
        color={color}
        // Full precision on hover; compact form keeps 7-figure values on one
        // line at phone width.
        title={formatSZL(value)}
      >
        {formatSZLCompact(value)}
      </Text>
      {hint && (
        <Text fontSize="xs" opacity={0.75}>
          {hint}
        </Text>
      )}
      {delta !== null && (
        <Text fontSize="xs" color={improved ? good : bad} mt={0.5}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs previous
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
  onClick,
}: {
  label: string;
  hint?: string;
  value: number;
  sign?: "+" | "−" | "=";
  strong?: boolean;
  tone?: "good" | "bad";
  onClick?: () => void;
}) => (
  <Flex
    justify="space-between"
    align="baseline"
    gap={3}
    py={1.5}
    minH="44px"
    cursor={onClick ? "pointer" : undefined}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (e: React.KeyboardEvent) =>
            (e.key === "Enter" || e.key === " ") && onClick()
        : undefined
    }
    aria-label={onClick ? `${label}: ${formatSZL(value)}. Show documents` : undefined}
  >
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
      color={tone === "good" ? "green.400" : tone === "bad" ? "red.300" : undefined}
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
  previous,
  showVat = true,
  onDrill,
  onReconcile,
  anchoredOn,
  footer,
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
            {anchoredOn
              ? `Opening stock continues from the ${
                  anchoredOn.kind === "close"
                    ? "closed period"
                    : anchoredOn.kind === "count"
                      ? "latest stock count"
                      : "recorded opening balance"
                } at ${safeDate(anchoredOn.asOf)}. `
              : "Opening stock continues from the previous period. "}
            No data-quality problems were detected.
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
                {onDrill && drillKindForIssue(issue.id) && (
                  <Button
                    mt={2}
                    size="xs"
                    variant="outline"
                    onClick={() => onDrill(drillKindForIssue(issue.id)!, issue.title)}
                  >
                    Show documents
                  </Button>
                )}
                {onReconcile && issue.id === "live-stock-gap" && (
                  <Button mt={2} size="xs" variant="outline" onClick={onReconcile}>
                    Reconcile by item
                  </Button>
                )}
              </Box>
            </Alert>
          ))}
        </Stack>
      )}

      {/* Headline numbers: the things people open this page for */}
      <SimpleGrid columns={{ base: 2, md: showVat ? 4 : 3 }} spacing={3}>
        <Headline
          label="Sales"
          value={f.periodSales || 0}
          hint={`${(summary?.totalPeopleFed || 0).toLocaleString()} people fed`}
          previous={previous?.periodSales}
          onClick={onDrill && (() => onDrill("sales", "Sales"))}
        />
        <Headline
          label="Cost of goods sold"
          value={f.periodConsumption || 0}
          hint={`${summary?.totalDispatches || 0} dispatches`}
          previous={previous?.periodConsumption}
          higherIsBetter={false}
          onClick={onDrill && (() => onDrill("consumed", "Cost of goods sold"))}
        />
        <Headline
          label="Gross profit"
          value={f.grossProfitAfterVAT || 0}
          hint={`${(f.profitPercentage || 0).toFixed(1)}% margin`}
          tone={(f.grossProfitAfterVAT || 0) >= 0 ? "good" : "bad"}
          previous={previous?.grossProfit}
        />
        {showVat && (
          <Headline
            label={vatDue >= 0 ? "VAT payable" : "VAT refundable"}
            value={Math.abs(vatDue)}
            hint={`Output ${formatSZLCompact(f.vatOnSales || 0)} − input ${formatSZLCompact(
              f.vatOnPurchases || 0,
            )}`}
            tone={vatDue >= 0 ? "bad" : "good"}
            onClick={onDrill && (() => onDrill("vat", "Input VAT on received goods"))}
          />
        )}
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
          onClick={onDrill && (() => onDrill("received", "Goods received"))}
        />
        <Row
          label="Consumed"
          hint={`${summary?.totalDispatches || 0} dispatches`}
          value={f.periodConsumption || 0}
          sign="−"
          onClick={onDrill && (() => onDrill("consumed", "Consumed"))}
        />
        <Row
          label="Count variances"
          hint={`${summary?.totalBinCounts || 0} counts`}
          value={f.netVariances || 0}
          sign={(f.netVariances || 0) < 0 ? "−" : "+"}
          tone={(f.netVariances || 0) < 0 ? "bad" : undefined}
          onClick={onDrill && (() => onDrill("variances", "Count variances"))}
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
        {onReconcile && (
          <Button mt={2} size="sm" variant="outline" onClick={onReconcile} w="100%" minH="44px">
            Reconcile with live stock by item
          </Button>
        )}
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

      {footer}

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
                • Opening stock = the last closed period (or recorded opening
                balance) plus everything received, minus everything consumed,
                plus count variances, since then. It therefore always equals the
                previous period&apos;s closing stock.
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
