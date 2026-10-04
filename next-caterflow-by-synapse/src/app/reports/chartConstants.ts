// Shared chart palettes for the reports page and its lazily-loaded chart module.

// Chart color schemes
export const CHART_COLORS = {
  primary: ["#3182CE", "#63B3ED", "#90CDF4", "#BEE3F8"],
  success: ["#38A169", "#68D391", "#9AE6B4", "#C6F6D5"],
  warning: ["#DD6B20", "#F6AD55", "#FBD38D", "#FEEBC8"],
  error: ["#E53E3E", "#FC8181", "#FEB2B2", "#FED7D7"],
  purple: ["#805AD5", "#B794F4", "#D6BCFA", "#E9D8FD"],
  pink: ["#D53F8C", "#F687B3", "#FBB6CE", "#FED7E2"],
  gray: ["#4A5568", "#718096", "#A0AEC0", "#CBD5E0"],
  vat: ["#2D3748", "#4A5568", "#718096", "#A0AEC0"], // VAT-specific colors
};

export const STATUS_COLORS: { [key: string]: string } = {
  draft: "gray",
  "pending-approval": "orange",
  approved: "blue",
  completed: "green",
  processed: "green",
  "partially-received": "yellow",
  "in-progress": "purple",
  cancelled: "red",
  rejected: "red",
  scheduled: "blue",
  adjusted: "purple",
};

