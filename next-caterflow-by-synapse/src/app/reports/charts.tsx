"use client";

import { logger } from '@/lib/logger';
// Chart components for the reports page. Lives in its own module so recharts
// (a large dependency) is code-split: page.tsx loads these with next/dynamic
// the first time a chart is rendered, instead of shipping them in the main
// page bundle.

import React, { useState, useEffect, useRef } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Progress,
  SimpleGrid,
  Skeleton,
  Tab,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip as ChakraTooltip,
  Tr,
  VStack,
  Wrap,
  WrapItem,
} from "@chakra-ui/react";
import { FiDownload } from "react-icons/fi";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { VAT_CONFIG } from "@/lib/vatConfig";

import type { EnhancedAnalyticsData } from "./types";
import { CHART_COLORS } from "./chartConstants";
import { ChartSkeleton } from "./skeletons";

interface PieChartData {
  name: string;
  value: number;
}

// Custom hook to ensure chart containers have dimensions before rendering
export const useChartDimensions = () => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    };

    updateDimensions();

    // Use a timeout to ensure the component is fully rendered
    const timer = setTimeout(updateDimensions, 100);

    // Update on resize
    window.addEventListener("resize", updateDimensions);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  return { dimensions, containerRef };
};

// Simple, reliable BarChartComponent
export const BarChartComponent = ({
  data,
  title,
  dataKey,
  color = CHART_COLORS.primary[0],
  isLoading = false,
}: {
  data: any[];
  title: string;
  dataKey: string;
  color?: string;
  isLoading?: boolean;
}) => {
  const [isMounted, setIsMounted] = useState(false);

  // Add this to each chart component at the beginning
  logger.debug(`📊 ${title} - Data:`, data?.length, "items");
  logger.debug(`📊 ${title} - isMounted:`, isMounted);
  logger.debug(`📊 ${title} - isLoading:`, isLoading);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (isLoading) {
    return (
      <Card minH="400px">
        <CardBody>
          <Skeleton height="24px" mb={4} width="200px" />
          <Skeleton height="300px" />
        </CardBody>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card minH="400px">
        <CardBody>
          <Text fontWeight="bold" mb={4}>
            {title}
          </Text>
          <Box
            height="300px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text color="gray.500">No data available</Text>
          </Box>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card minH="400px">
      <CardBody>
        <Text fontWeight="bold" mb={4}>
          {title}
        </Text>
        <Box height="350px" width="100%" minWidth="100%">
          {isMounted && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 12 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => [`${value}`, title]}
                  contentStyle={{
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                  }}
                />
                <Legend />
                <Bar
                  dataKey={dataKey}
                  fill={color}
                  radius={[4, 4, 0, 0]}
                  name={title}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Box>
      </CardBody>
    </Card>
  );
};

// Simple, reliable LineChartComponent
export const LineChartComponent = ({
  data,
  title,
  dataKey,
  color = CHART_COLORS.primary[0],
  isLoading = false,
}: {
  data: any[];
  title: string;
  dataKey: string;
  color?: string;
  isLoading?: boolean;
}) => {
  const [isMounted, setIsMounted] = useState(false);

  // Add this to each chart component at the beginning
  logger.debug(`📊 ${title} - Data:`, data?.length, "items");
  logger.debug(`📊 ${title} - isMounted:`, isMounted);
  logger.debug(`📊 ${title} - isLoading:`, isLoading);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (isLoading) {
    return (
      <Card minH="400px">
        <CardBody>
          <Skeleton height="24px" mb={4} width="200px" />
          <Skeleton height="300px" />
        </CardBody>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card minH="400px">
        <CardBody>
          <Text fontWeight="bold" mb={4}>
            {title}
          </Text>
          <Box
            height="300px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text color="gray.500">No data available</Text>
          </Box>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card minH="400px">
      <CardBody>
        <Text fontWeight="bold" mb={4}>
          {title}
        </Text>
        <Box height="350px" width="100%" minWidth="100%">
          {isMounted && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => [`${value}`, title]}
                  contentStyle={{
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ stroke: color, strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                  name={title}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Box>
      </CardBody>
    </Card>
  );
};

// Simple, reliable StatusPieChart
export const StatusPieChart = ({
  data,
  title,
  colors = CHART_COLORS.primary,
  isLoading = false,
}: {
  data: any[];
  title: string;
  colors?: string[];
  isLoading?: boolean;
}) => {
  const [isMounted, setIsMounted] = useState(false);

  // Add this to each chart component at the beginning
  logger.debug(`📊 ${title} - Data:`, data?.length, "items");
  logger.debug(`📊 ${title} - isMounted:`, isMounted);
  logger.debug(`📊 ${title} - isLoading:`, isLoading);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (isLoading) {
    return (
      <Card minH="400px">
        <CardBody>
          <Skeleton height="24px" mb={4} width="200px" />
          <Skeleton height="300px" />
        </CardBody>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card minH="400px">
        <CardBody>
          <Text fontWeight="bold" mb={4}>
            {title}
          </Text>
          <Box
            height="300px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text color="gray.500">No data available</Text>
          </Box>
        </CardBody>
      </Card>
    );
  }

  // Calculate total for percentages
  const total = data.reduce((sum, item) => sum + (item.value || 0), 0);

  return (
    <Card minH="400px">
      <CardBody>
        <Text fontWeight="bold" mb={4}>
          {title}
        </Text>
        <Box height="350px" width="100%" minWidth="100%">
          {isMounted && (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={(entry: any) => {
                    const percentage =
                      total > 0
                        ? ((entry.value / total) * 100).toFixed(0)
                        : "0";
                    return `${entry.name} (${percentage}%)`;
                  }}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  paddingAngle={1}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={colors[index % colors.length]}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const percentage =
                      total > 0
                        ? ((Number(value) / total) * 100).toFixed(1)
                        : "0";
                    return [`${value} (${percentage}%)`, name];
                  }}
                  contentStyle={{
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Box>
      </CardBody>
    </Card>
  );
};

// Visual Analytics Tab Component with VAT
export const VisualAnalyticsTab = ({
  analyticsData,
  loading,
}: {
  analyticsData: EnhancedAnalyticsData | null;
  loading: boolean;
}) => {
  if (loading) {
    return (
      <VStack spacing={6} align="stretch">
        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
          <ChartSkeleton />
          <ChartSkeleton />
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
          <ChartSkeleton />
          <ChartSkeleton />
        </SimpleGrid>
      </VStack>
    );
  }

  if (!analyticsData) {
    return (
      <Alert status="info" borderRadius="md">
        <AlertIcon />
        No analytics data available. Please load data from the Executive
        Dashboard.
      </Alert>
    );
  }

  return (
    <VStack spacing={6} align="stretch">
      <Text fontSize="lg" color="gray.600">
        Interactive visualizations and detailed analytics across all system
        modules with VAT calculations
      </Text>

      {/* VAT Analysis Chart */}
      <Card>
        <CardBody>
          <Text fontWeight="bold" mb={4}>
            VAT Analysis
          </Text>
          <Box height="300px" minWidth="100%">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  {
                    name: "Output VAT (Sales)",
                    value: analyticsData.vat.summary.totalOutputVAT,
                    fill: CHART_COLORS.error[0],
                  },
                  {
                    name: "Input VAT (Purchases)",
                    value: analyticsData.vat.summary.totalInputVAT,
                    fill: CHART_COLORS.primary[0],
                  },
                  {
                    name: "Net VAT Payable",
                    value: Math.abs(analyticsData.vat.summary.netVATPayable),
                    fill:
                      analyticsData.vat.summary.netVATPayable >= 0
                        ? CHART_COLORS.warning[0]
                        : CHART_COLORS.success[0],
                  },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(value) => [
                    `SZL ${Number(value).toLocaleString()}`,
                    "Amount",
                  ]}
                />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardBody>
      </Card>

      {/* Financial Trends */}
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
        <Card minH="400px">
          <CardBody>
            <Text fontWeight="bold" mb={4}>
              Monthly Spending Trend (With VAT)
            </Text>
            <Box height="300px" minWidth="100%">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={analyticsData.financial.monthlySpending}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => [
                      `SZL ${Number(value).toLocaleString()}`,
                      "Amount",
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="spending"
                    fill={CHART_COLORS.primary[0]}
                    name="Spending (excl. VAT)"
                  />
                  <Bar
                    dataKey="vat"
                    fill={CHART_COLORS.vat[0]}
                    name="VAT Amount"
                  />
                  <Line
                    type="monotone"
                    dataKey="totalWithVAT"
                    stroke={CHART_COLORS.success[0]}
                    strokeWidth={2}
                    name="Total (incl. VAT)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </CardBody>
        </Card>

        <Card minH="400px">
          <CardBody>
            <Text fontWeight="bold" mb={4}>
              Cost Per Person Trend
            </Text>
            <Box height="300px" minWidth="100%">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsData.financial.costPerPersonTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => [
                      `SZL ${Number(value).toFixed(2)}`,
                      "Cost per Person",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke={CHART_COLORS.success[0]}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Inventory Health */}
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
        <Card>
          <CardBody>
            <Text fontWeight="bold" mb={4}>
              Inventory Health Status
            </Text>
            <VStack spacing={4} align="stretch">
              <HStack justify="space-between">
                <Text>Healthy Items</Text>
                <Badge colorScheme="green" fontSize="md">
                  {analyticsData.inventory.lowStockBreakdown.healthy}
                </Badge>
              </HStack>
              <HStack justify="space-between">
                <Text>Low Stock Warning</Text>
                <Badge colorScheme="yellow" fontSize="md">
                  {analyticsData.inventory.lowStockBreakdown.warning}
                </Badge>
              </HStack>
              <HStack justify="space-between">
                <Text>Critical Stock</Text>
                <Badge colorScheme="red" fontSize="md">
                  {analyticsData.inventory.lowStockBreakdown.critical}
                </Badge>
              </HStack>
              <Progress
                value={
                  (analyticsData.inventory.lowStockBreakdown.healthy /
                    analyticsData.summary.totalStockItems) *
                  100
                }
                colorScheme="green"
                size="lg"
              />
            </VStack>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Text fontWeight="bold" mb={4}>
              Inventory Accuracy
            </Text>
            <VStack spacing={4} align="stretch">
              <HStack justify="space-between">
                <Text>Count Accuracy</Text>
                <Text fontWeight="bold">
                  {(analyticsData.binCounts.accuracy * 100).toFixed(1)}%
                </Text>
              </HStack>
              <Progress
                value={analyticsData.binCounts.accuracy * 100}
                colorScheme="blue"
                size="lg"
              />

              {/* Quantity Variance Breakdown */}
              <Box mt={2}>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Quantity Variance
                </Text>
                <Wrap spacing={4}>
                  <WrapItem>
                    <Badge colorScheme="green" px={3} py={1}>
                      Zero:{" "}
                      {analyticsData.binCounts.varianceAnalysis.zero.quantity}
                    </Badge>
                  </WrapItem>
                  <WrapItem>
                    <Badge colorScheme="red" px={3} py={1}>
                      Negative:{" "}
                      {
                        analyticsData.binCounts.varianceAnalysis.negative
                          .quantity
                      }
                    </Badge>
                  </WrapItem>
                  <WrapItem>
                    <Badge colorScheme="orange" px={3} py={1}>
                      Positive:{" "}
                      {
                        analyticsData.binCounts.varianceAnalysis.positive
                          .quantity
                      }
                    </Badge>
                  </WrapItem>
                </Wrap>
              </Box>

              {/* Cost Variance Breakdown */}
              <Box mt={2}>
                <Text fontWeight="medium" fontSize="sm" mb={2}>
                  Cost Variance (E)
                </Text>
                <SimpleGrid columns={3} spacing={2}>
                  <Box>
                    <Text fontSize="xs" color="gray.500">
                      Zero Cost
                    </Text>
                    <Badge colorScheme="gray" fontSize="sm" px={2}>
                      E 0.00
                    </Badge>
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="gray.500">
                      Negative (Under)
                    </Text>
                    <Badge colorScheme="green" fontSize="sm" px={2}>
                      E{" "}
                      {analyticsData.binCounts.varianceAnalysis.negative.cost.toFixed(
                        2,
                      )}
                    </Badge>
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="gray.500">
                      Positive (Over)
                    </Text>
                    <Badge colorScheme="orange" fontSize="sm" px={2}>
                      E{" "}
                      {analyticsData.binCounts.varianceAnalysis.positive.cost.toFixed(
                        2,
                      )}
                    </Badge>
                  </Box>
                </SimpleGrid>
              </Box>
            </VStack>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Top Items Tables with VAT */}
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
        <Card>
          <CardBody>
            <Heading size="sm" mb={4}>
              Top Purchased Items (With VAT)
            </Heading>
            <TableContainer>
              <Table variant="simple" size="sm">
                <Thead>
                  <Tr>
                    <Th>Item</Th>
                    <Th isNumeric>Quantity</Th>
                    <Th isNumeric>Value</Th>
                    <Th isNumeric>VAT</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {analyticsData.purchaseOrders.topItems
                    .slice(0, 5)
                    .map((item, index) => (
                      <Tr key={item.name}>
                        <Td>{item.name}</Td>
                        <Td isNumeric>{item.quantity}</Td>
                        <Td isNumeric>SZL {item.value.toLocaleString()}</Td>
                        <Td isNumeric>SZL {item.vatAmount.toLocaleString()}</Td>
                      </Tr>
                    ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Heading size="sm" mb={4}>
              Top Dispatched Items (With VAT)
            </Heading>
            <TableContainer>
              <Table variant="simple" size="sm">
                <Thead>
                  <Tr>
                    <Th>Item</Th>
                    <Th isNumeric>Quantity</Th>
                    <Th isNumeric>Cost</Th>
                    <Th isNumeric>VAT</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {analyticsData.dispatches.topItems
                    .slice(0, 5)
                    .map((item, index) => (
                      <Tr key={item.name}>
                        <Td>{item.name}</Td>
                        <Td isNumeric>{item.quantity}</Td>
                        <Td isNumeric>SZL {item.cost.toLocaleString()}</Td>
                        <Td isNumeric>SZL {item.vatAmount.toLocaleString()}</Td>
                      </Tr>
                    ))}
                </Tbody>
              </Table>
            </TableContainer>
          </CardBody>
        </Card>
      </SimpleGrid>
    </VStack>
  );
};

// Data Export Tab Component with VAT
export const DataExportTab = ({
  exportToExcel,
  loading,
  dataAvailable,
}: {
  exportToExcel: () => void;
  loading: boolean;
  dataAvailable: boolean;
}) => (
  <VStack spacing={6} align="stretch">
    <Card>
      <CardBody>
        <VStack spacing={4} align="start">
          <Heading size="md">Comprehensive Data Export with VAT</Heading>
          <Text>
            Generate a complete Excel report with multiple sheets containing all
            system data, analytics, and visual summaries. The export includes
            accurate VAT calculations using the Eswatini standard rate of{" "}
            {VAT_CONFIG.ratePercentage}%.
          </Text>

          <SimpleGrid columns={2} spacing={4} width="100%">
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Executive Summary</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Purchase Orders with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Goods Receipts with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Dispatches & Consumption with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Stock Transfers</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Bin Counts & Adjustments</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Inventory Catalog with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Low Stock Alerts</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Analytics Data with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="green.500" borderRadius="full" />
              <Text>Supplier Performance with VAT</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="blue.500" borderRadius="full" />
              <Text>VAT Analysis Report</Text>
            </HStack>
            <HStack>
              <Box w="2" h="2" bg="blue.500" borderRadius="full" />
              <Text>Sales Summary with VAT</Text>
            </HStack>
          </SimpleGrid>

          <Alert status="info" borderRadius="md">
            <AlertIcon />
            The exported Excel file contains accurate, real-time data with
            Eswatini VAT calculations. All financial values are clearly marked
            as either excluding or including VAT.
          </Alert>

          <Button
            leftIcon={<FiDownload />}
            colorScheme="green"
            onClick={exportToExcel}
            isLoading={loading}
            isDisabled={!dataAvailable}
            size="lg"
          >
            {dataAvailable
              ? "Generate Comprehensive Report with VAT"
              : "Load Data First"}
          </Button>

          {!dataAvailable && (
            <Text color="orange.500" fontSize="sm">
              Please load data from the Executive Dashboard tab first to ensure
              accurate VAT calculations.
            </Text>
          )}
        </VStack>
      </CardBody>
    </Card>
  </VStack>
);
