"use client";

// Administrator controls for the ledger anchors behind opening stock:
//  - close a finished month (its closing stock becomes the next opening),
//  - record an opening balance for stock that predates the first receipt,
//  - reopen a close (recorded, never deleted).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input,
  NumberInput,
  NumberInputField,
  Select,
  Stack,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { format, subMonths } from "date-fns";
import { formatSZL } from "@/lib/financialReport";

interface Anchor {
  _id: string;
  kind: "close" | "opening-balance";
  periodKey?: string;
  asOf: string;
  value: number;
  recordedAt: string;
  recordedBy: string;
  note?: string;
  reopenedAt?: string | null;
}

interface Props {
  /** Site id, or null for all sites. */
  siteId: string | null;
  /** Called after any change so the page can refresh its figures. */
  onChanged: () => void;
}

export default function PeriodControls({ siteId, onChanged }: Props) {
  const toast = useToast();
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [obDate, setObDate] = useState("");
  const [obValue, setObValue] = useState("");
  const [obNote, setObNote] = useState("");
  const [suggestion, setSuggestion] = useState<any | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: "close"; force: boolean; issues?: string[] }
    | { kind: "reopen"; id: string; label: string }
    | null
  >(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const { isOpen: dialogOpen, onOpen: openDialog, onClose: closeDialog } = useDisclosure();

  const siteParam = siteId || "all";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/period-close?site=${encodeURIComponent(siteParam)}`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const body = await res.json();
      setAnchors(body.anchors || []);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || "Could not load closed periods");
    }
  }, [siteParam]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const active = useMemo(() => anchors.filter((a) => !a.reopenedAt), [anchors]);
  const closedMonths = useMemo(
    () => new Set(active.filter((a) => a.kind === "close").map((a) => a.periodKey)),
    [active],
  );
  // Last 12 finished months that are not already closed
  const closable = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => subMonths(now, i + 1))
      .map((d) => format(d, "yyyy-MM"))
      .filter((m) => !closedMonths.has(m));
  }, [closedMonths]);

  useEffect(() => {
    if (!month && closable.length) setMonth(closable[0]);
  }, [closable, month]);

  const post = async (payload: any) => {
    setBusy(true);
    try {
      const res = await fetch("/api/reports/period-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, site: siteParam }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === "blocking-issues") {
        setConfirm({
          kind: "close",
          force: true,
          issues: (body.issues || []).map((i: any) => `${i.title}: ${i.detail}`),
        });
        openDialog();
        return false;
      }
      if (!res.ok) throw new Error(body.error || `Server responded ${res.status}`);
      await load();
      onChanged();
      return true;
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message, status: "error", duration: 6000, isClosable: true, position: "top" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Work out, from the recorded documents, how much stock must have existed
  // before the first one. Read-only: the administrator still has to save it.
  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch(
        `/api/reports/suggest-opening-balance?site=${encodeURIComponent(siteParam)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server responded ${res.status}`);
      setSuggestion(body);
    } catch (e: any) {
      setSuggestion(null);
      toast({ title: "Could not calculate", description: e?.message, status: "error", duration: 6000, isClosable: true, position: "top" });
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestion = (value: number) => {
    if (suggestion?.asOf) setObDate(suggestion.asOf);
    setObValue(String(value));
  };

  const doClose = async (force: boolean) => {
    const ok = await post({ action: "close", month, force });
    if (ok) toast({ title: `Closed ${month}`, status: "success", duration: 2500, position: "top" });
  };

  const saveOpeningBalance = async () => {
    const ok = await post({ action: "opening-balance", asOf: obDate, value: Number(obValue), note: obNote });
    if (ok) {
      setObDate(""); setObValue(""); setObNote("");
      toast({ title: "Opening balance recorded", status: "success", duration: 2500, position: "top" });
    }
  };

  return (
    <Box borderWidth="1px" borderRadius="lg" p={4}>
      <Flex justify="space-between" align="center" onClick={() => setOpen(!open)} cursor="pointer" role="button" aria-expanded={open} tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(!open)}>
        <Box>
          <Text fontWeight="bold">Period close</Text>
          <Text fontSize="xs" opacity={0.7}>
            Lock a month&apos;s closing stock so it becomes the next opening stock
          </Text>
        </Box>
        <Text aria-hidden>{open ? "−" : "+"}</Text>
      </Flex>

      <Collapse in={open} animateOpacity>
        <Stack spacing={5} mt={4}>
          {loadError && <Text color="red.300" fontSize="sm">{loadError}</Text>}

          <Box>
            <Text fontSize="sm" fontWeight="medium" mb={2}>Close a month</Text>
            <HStack>
              <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month to close" isDisabled={!closable.length}>
                {closable.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Button colorScheme="blue" isLoading={busy} isDisabled={!month}
                onClick={() => { setConfirm({ kind: "close", force: false }); openDialog(); }}>
                Close
              </Button>
            </HStack>
          </Box>

          <Box>
            <Text fontSize="sm" fontWeight="medium" mb={1}>Record an opening balance</Text>
            <Text fontSize="xs" opacity={0.7} mb={2}>
              Use once, if stock existed before the first receipt in the system.
            </Text>
            <Button size="sm" variant="outline" mb={3} onClick={suggest} isLoading={suggesting} minH="44px" w="100%">
              Calculate from my data
            </Button>
            {suggestion && (
              <Box borderWidth="1px" borderRadius="md" p={3} mb={3} fontSize="sm">
                {suggestion.basis === "none" && suggestion.asOf === null ? (
                  <Text>{suggestion.notes?.join(" ")}</Text>
                ) : (
                  <Stack spacing={2}>
                    <Text>
                      Without an opening balance the ledger is{" "}
                      <b>{formatSZL(suggestion.ledgerNow)}</b> today. It was lowest at{" "}
                      <b>{formatSZL(suggestion.lowestPoint?.value ?? 0)}</b> on{" "}
                      {suggestion.lowestPoint?.date}.
                    </Text>
                    <Flex justify="space-between" align="center" gap={2}>
                      <Text>
                        Minimum to stay above zero: <b>{formatSZL(suggestion.minimumToStayNonNegative)}</b>
                      </Text>
                      <Button size="xs" onClick={() => applySuggestion(suggestion.minimumToStayNonNegative)}>
                        Use
                      </Button>
                    </Flex>
                    {suggestion.fromLiveStock !== null && (
                      <Flex justify="space-between" align="center" gap={2}>
                        <Text>
                          To match live stock ({formatSZL(suggestion.liveInventoryValue)}):{" "}
                          <b>{formatSZL(suggestion.fromLiveStock)}</b>
                        </Text>
                        <Button size="xs" onClick={() => applySuggestion(suggestion.fromLiveStock)}>
                          Use
                        </Button>
                      </Flex>
                    )}
                    {(suggestion.notes || []).map((n: string) => (
                      <Text key={n} fontSize="xs" opacity={0.75}>{n}</Text>
                    ))}
                    <Text fontSize="xs" opacity={0.75}>
                      Pre-fills the form below, dated {suggestion.asOf}. Review it, then save.
                    </Text>
                  </Stack>
                )}
              </Box>
            )}
            <Stack spacing={2}>
              <HStack>
                <FormControl>
                  <FormLabel fontSize="xs">As of</FormLabel>
                  <Input type="date" value={obDate} onChange={(e) => setObDate(e.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="xs">Value (SZL)</FormLabel>
                  <NumberInput min={0} value={obValue} onChange={setObValue}>
                    <NumberInputField inputMode="decimal" />
                  </NumberInput>
                </FormControl>
              </HStack>
              <Input placeholder="Note (optional)" value={obNote} onChange={(e) => setObNote(e.target.value)} maxLength={500} />
              <Button onClick={saveOpeningBalance} isLoading={busy} isDisabled={!obDate || obValue === ""}>
                Save opening balance
              </Button>
            </Stack>
          </Box>

          <Box>
            <Text fontSize="sm" fontWeight="medium" mb={2}>History</Text>
            {anchors.length === 0 ? (
              <Text fontSize="sm" opacity={0.7}>Nothing closed yet.</Text>
            ) : (
              <Stack spacing={2}>
                {anchors.map((a) => (
                  <Flex key={a._id} justify="space-between" align="center" gap={2} opacity={a.reopenedAt ? 0.5 : 1}>
                    <Box minW={0}>
                      <Text fontSize="sm" fontWeight="semibold">
                        {a.kind === "close" ? `Closed ${a.periodKey}` : "Opening balance"}{" "}
                        {a.reopenedAt && <Badge>reopened</Badge>}
                      </Text>
                      <Text fontSize="xs" opacity={0.7}>
                        {formatSZL(a.value)} · {format(new Date(a.recordedAt), "d MMM yyyy HH:mm")}
                      </Text>
                      {a.note && <Text fontSize="xs" opacity={0.7} noOfLines={2}>{a.note}</Text>}
                    </Box>
                    {!a.reopenedAt && (
                      <Button size="xs" variant="outline"
                        onClick={() => { setConfirm({ kind: "reopen", id: a._id, label: a.kind === "close" ? a.periodKey! : "opening balance" }); openDialog(); }}>
                        Reopen
                      </Button>
                    )}
                  </Flex>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </Collapse>

      <AlertDialog isOpen={dialogOpen} leastDestructiveRef={cancelRef} onClose={closeDialog} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent mx={4}>
            <AlertDialogHeader>
              {confirm?.kind === "reopen" ? `Reopen ${confirm.label}?` : confirm?.force ? "Close despite problems?" : `Close ${month}?`}
            </AlertDialogHeader>
            <AlertDialogBody>
              {confirm?.kind === "reopen" ? (
                <Text>Opening stock after this point will be rebuilt from earlier history. The change is recorded.</Text>
              ) : confirm?.force ? (
                <Stack>
                  <Text>These problems were found:</Text>
                  {(confirm.issues || []).map((i) => <Text key={i} fontSize="sm">• {i}</Text>)}
                  <Text fontSize="sm">Closing will lock these figures in.</Text>
                </Stack>
              ) : (
                <Text>
                  The calculated closing stock for {month} will be locked and used as the next month&apos;s
                  opening stock. You can reopen it later.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={closeDialog}>Cancel</Button>
              <Button colorScheme={confirm?.kind === "reopen" || (confirm as any)?.force ? "red" : "blue"} ml={3} isLoading={busy}
                onClick={async () => {
                  const c = confirm;
                  closeDialog();
                  if (!c) return;
                  if (c.kind === "reopen") {
                    const ok = await post({ action: "reopen", id: c.id });
                    if (ok) toast({ title: "Reopened", status: "info", duration: 2500, position: "top" });
                  } else {
                    await doClose(c.force);
                  }
                }}>
                {confirm?.kind === "reopen" ? "Reopen" : confirm?.force ? "Close anyway" : "Close month"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}
