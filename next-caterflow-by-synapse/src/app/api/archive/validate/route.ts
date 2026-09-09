// src/app/api/archive/validate/route.ts
// Comprehensive pre-flight validation endpoint
// Use this before production deployment to verify all systems are ready

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validateArchiveSetup } from "@/lib/archiveValidation";

export async function POST(request: Request) {
  try {
    // Require admin authentication
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // console.log("\n🔍 Admin triggered archive validation");

    // Run comprehensive validation
    const validationResult = await validateArchiveSetup();

    return NextResponse.json({
      success: true,
      passed: validationResult.passed,
      timestamp: validationResult.timestamp,
      checks: validationResult.checks,
      summary: validationResult.summary,
      failures: validationResult.checks.filter((c) => c.status === "fail"),
      warnings: validationResult.checks.filter((c) => c.status === "warn"),
      recommendations: generateRecommendations(validationResult.checks),
    });
  } catch (error: any) {
    console.error("❌ Archive validation failed:", error);
    return NextResponse.json(
      {
        error: "Validation failed",
        message: error?.message,
      },
      { status: 500 },
    );
  }
}

function generateRecommendations(
  checks: Array<{ name: string; status: string; message: string }>,
): string[] {
  const recommendations: string[] = [];
  const failures = checks.filter((c) => c.status === "fail");

  if (failures.find((c) => c.name.includes("MongoDB"))) {
    recommendations.push(
      "Ensure MONGODB_URL is set correctly in Vercel environment variables",
    );
  }

  if (failures.find((c) => c.name.includes("Sanity"))) {
    recommendations.push(
      "Verify Sanity API token has delete permission for the dataset",
    );
  }

  if (failures.find((c) => c.name.includes("Archive Days Threshold"))) {
    recommendations.push(
      "Set ARCHIVE_DAYS_THRESHOLD to a reasonable value (60+ days recommended)",
    );
  }

  if (
    checks.some((c) => c.name.includes("Candidates") && c.status === "warn")
  ) {
    recommendations.push(
      "Archive candidates not found—ensure test data exists before running archive",
    );
  }

  return recommendations;
}

export async function GET() {
  return NextResponse.json({
    status: "Archive validation endpoint",
    method: "POST",
    requires: "Admin authentication",
    description: "Comprehensive pre-flight checks for archive system",
  });
}
