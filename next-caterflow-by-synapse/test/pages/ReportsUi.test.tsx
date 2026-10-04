import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import PeriodBar, { formatRangeLabel, isPartialPeriod } from "../../src/app/reports/PeriodBar";
import DrillDownDrawer from "../../src/app/reports/DrillDownDrawer";
import ReconciliationPanel from "../../src/app/reports/ReconciliationPanel";
import { LoadFailureBanner, EmptyPeriod } from "../../src/app/reports/DataStatus";
import FinancialSummary from "../../src/app/reports/FinancialSummary";
import { canManagePeriods, canViewFinance, canViewReconciliation } from "../../src/lib/reportAccess";

const wrap = (ui: React.ReactElement) => render(<ChakraProvider>{ui}</ChakraProvider>);

describe("period helpers", () => {
  it("formats ranges compactly", () => {
    expect(formatRangeLabel({ start: "2026-10-01", end: "2026-10-04" })).toBe("1–4 Oct 2026");
    expect(formatRangeLabel({ start: "2026-09-28", end: "2026-10-04" })).toBe("28 Sep – 4 Oct 2026");
    expect(formatRangeLabel({ start: "2026-10-04", end: "2026-10-04" })).toBe("4 Oct 2026");
    expect(formatRangeLabel({ start: "", end: "" })).toBe("Choose period");
  });
  it("flags a range ending inside the current unfinished month as partial", () => {
    const now = new Date(2026, 9, 4);
    expect(isPartialPeriod({ start: "2026-10-01", end: "2026-10-04" }, now)).toBe(true);
    expect(isPartialPeriod({ start: "2026-09-01", end: "2026-09-30" }, now)).toBe(false);
    expect(isPartialPeriod({ start: "2026-10-01", end: "2026-10-31" }, now)).toBe(false);
  });
});

describe("PeriodBar", () => {
  const props = {
    range: { start: "2026-10-01", end: "2026-10-04" },
    onRangeChange: jest.fn(),
    presets: [{ label: "Last Month", start: "2026-09-01", end: "2026-09-30" }],
    sites: [{ _id: "s1", name: "Mbabane" }],
    selectedSite: null,
    onSiteChange: jest.fn(),
    canPickSite: true,
    lastUpdated: new Date(2026, 9, 4, 20, 24),
    loading: false,
    onRefresh: jest.fn(),
  };
  it("summarises period and site and shows when data was updated", () => {
    wrap(<PeriodBar {...props} />);
    expect(screen.getByText(/1–4 Oct 2026 · All sites/)).toBeInTheDocument();
    expect(screen.getByText("Updated 20:24")).toBeInTheDocument();
  });
  it("applies a preset from the sheet", () => {
    wrap(<PeriodBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /change period and site/i }));
    fireEvent.click(screen.getByText("Last Month"));
    expect(props.onRangeChange).toHaveBeenCalledWith({ start: "2026-09-01", end: "2026-09-30" });
  });
  it("shows load progress instead of the update time while loading", () => {
    wrap(<PeriodBar {...props} loading progress={{ done: 3, total: 10 }} />);
    expect(screen.getByText(/Loading 3\/10 sources/)).toBeInTheDocument();
  });
});

describe("DrillDownDrawer", () => {
  const rows = [
    { id: "1", number: "GR-00001", date: "2026-10-02T10:00:00Z", kind: "receipt" as const, site: "Mbabane", value: 1000, status: "completed" },
    { id: "2", number: "GR-00002", date: "2026-10-03T10:00:00Z", kind: "receipt" as const, site: "Manzini", value: 250.5 },
  ];
  it("lists documents, totals them and filters by search", () => {
    wrap(<DrillDownDrawer isOpen onClose={() => {}} title="Goods received" rows={rows} />);
    expect(screen.getByText("GR-00001")).toBeInTheDocument();
    expect(screen.getByText("SZL 1,250.50")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "manzini" } });
    expect(screen.queryByText("GR-00001")).toBeNull();
    // the remaining row and the footer total
    expect(screen.getAllByText("SZL 250.50")).toHaveLength(2);
  });
  it("hides values for roles without finance access", () => {
    wrap(<DrillDownDrawer isOpen onClose={() => {}} title="x" rows={rows} showValues={false} />);
    expect(screen.queryByText("SZL 1,000.00")).toBeNull();
  });
  it("explains an empty list", () => {
    wrap(<DrillDownDrawer isOpen onClose={() => {}} title="x" rows={[]} />);
    expect(screen.getByText(/No documents contribute/)).toBeInTheDocument();
  });
});

describe("ReconciliationPanel", () => {
  it("lists the biggest gaps and says when everything agrees", () => {
    const { unmount } = wrap(
      <ReconciliationPanel isOpen onClose={() => {}} rows={[
        { itemId: "a", name: "Oil", calculatedQty: 8, liveQty: 20, gapQty: 12, unitPrice: 50, gapValue: 600 },
      ]} />,
    );
    expect(screen.getByText("Oil")).toBeInTheDocument();
    expect(screen.getByText("+SZL 600.00")).toBeInTheDocument();
    unmount();
    wrap(<ReconciliationPanel isOpen onClose={() => {}} rows={[]} />);
    expect(screen.getByText(/agree for every item/)).toBeInTheDocument();
  });
});

describe("status cards", () => {
  it("names the sources that failed and offers a retry", () => {
    const retry = jest.fn();
    wrap(<LoadFailureBanner failed={["dispatches", "goods receipts"]} onRetry={retry} />);
    expect(screen.getByText(/dispatches, goods receipts/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(retry).toHaveBeenCalled();
  });
  it("renders nothing when there are no failures", () => {
    const { container } = wrap(<LoadFailureBanner failed={[]} onRetry={() => {}} />);
    expect(container.textContent).toBe("");
  });
  it("offers to widen an empty period", () => {
    const widen = jest.fn();
    wrap(<EmptyPeriod onWiden={widen} />);
    fireEvent.click(screen.getByText("Show last 90 days"));
    expect(widen).toHaveBeenCalled();
  });
});

describe("FinancialSummary interactions", () => {
  const f = { openingStock: 100, periodPurchases: 50, periodConsumption: 30, netVariances: 0, closingStockValue: 120, periodSales: 80, grossProfitAfterVAT: 50, profitPercentage: 62.5, vatOnSales: 12, vatOnPurchases: 7.5, netVATPayable: 4.5, integrity: [] };
  const summary = { totalPeopleFed: 5, totalDispatches: 2, totalGoodsReceipts: 1, totalBinCounts: 0 };
  it("opens a drill-down from the received row", () => {
    const onDrill = jest.fn();
    wrap(<FinancialSummary financial={f} summary={summary} periodStart="2026-10-01" periodEnd="2026-10-04" vatRatePercentage={15} onDrill={onDrill} />);
    fireEvent.click(screen.getByRole("button", { name: /Goods received.*Show documents/ }));
    expect(onDrill).toHaveBeenCalledWith("received", "Goods received");
  });
  it("hides VAT for non-finance roles", () => {
    wrap(<FinancialSummary financial={f} summary={summary} periodStart="2026-10-01" periodEnd="2026-10-04" vatRatePercentage={15} showVat={false} />);
    expect(screen.queryByText(/VAT payable/i)).toBeNull();
  });
  it("shows a vs-previous chip with direction arrow", () => {
    wrap(<FinancialSummary financial={f} summary={summary} periodStart="2026-10-01" periodEnd="2026-10-04" vatRatePercentage={15} previous={{ periodSales: 40 }} />);
    expect(screen.getByText(/▲ 100\.0% vs previous/)).toBeInTheDocument();
  });
  it("offers 'Show documents' for fixable alerts", () => {
    const onDrill = jest.fn();
    wrap(<FinancialSummary financial={{ ...f, integrity: [{ id: "unpriced-lines", severity: "warning", title: "Received items without a price", detail: "2 lines" }] }} summary={summary} periodStart="2026-10-01" periodEnd="2026-10-04" vatRatePercentage={15} onDrill={onDrill} />);
    fireEvent.click(screen.getByText("Show documents"));
    expect(onDrill).toHaveBeenCalledWith("unpriced", "Received items without a price");
  });
});

describe("report access rules", () => {
  it("limits finance and period management by role", () => {
    expect(canViewFinance("admin")).toBe(true);
    expect(canViewFinance("auditor")).toBe(true);
    expect(canViewFinance("dispatchStaff")).toBe(false);
    expect(canViewFinance(undefined)).toBe(false);
    expect(canManagePeriods("admin")).toBe(true);
    expect(canManagePeriods("siteManager")).toBe(false);
    expect(canViewReconciliation("auditor")).toBe(true);
    expect(canViewReconciliation("siteManager")).toBe(false);
  });
});
