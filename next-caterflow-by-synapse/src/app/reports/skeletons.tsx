"use client";
import React from "react";
import { Card, CardBody, Skeleton } from "@chakra-ui/react";

export const ChartSkeleton = () => (
  <Card minH="400px">
    <CardBody>
      <Skeleton height="24px" mb={4} />
      <Skeleton height="300px" />
    </CardBody>
  </Card>
);
