import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Page access by role. Keys are matched by prefix.
const protectedRoutes: Record<string, string[]> = {
  "/": ["admin", "siteManager", "stockController", "auditor", "procurer"],
  "/actions": ["admin", "siteManager", "stockController", "procurer"],
  "/approvals": ["admin", "siteManager"],
  "/activity": ["admin", "siteManager", "stockController", "auditor"],
  "/low-stock": ["admin", "siteManager", "stockController", "auditor", "procurer"],
  "/inventory": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/purchases": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/receipts": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/dispatches": ["admin", "stockController", "siteManager", "auditor"],
  "/operations/transfers": ["admin", "siteManager", "stockController", "auditor", "procurer"],
  "/operations/bin-counts": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/counts": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/adjustments": ["admin", "siteManager", "stockController", "auditor"],
  "/operations/procurement": ["admin", "procurer", "stockController"],
  "/reporting": ["admin", "auditor", "siteManager"],
  "/admin": ["admin"],
  "/dispatch-types": ["admin"],
  "/users": ["admin"],
  "/locations": ["admin"],
  "/suppliers": ["admin", "procurer"],
};

// API routes that must stay reachable without a session.
//  - /api/auth/*       login, logout, password reset, NextAuth itself
//  - /api/archive/health  uptime probe
//  - /api/archive/cron/*  Vercel cron (guarded by CRON_SECRET inside the route)
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/archive/health", "/api/archive/cron/"];

// API prefixes restricted to a single role.
const ADMIN_ONLY_API_PREFIXES = ["/api/admin/", "/api/debug"];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();

    // Vercel cron calls /api/archive/run with `Authorization: Bearer $CRON_SECRET`;
    // the route verifies the secret itself, so let bearer-authenticated calls through.
    if (pathname === "/api/archive/run" && req.headers.get("authorization")?.startsWith("Bearer ")) {
      return NextResponse.next();
    }

    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (
      ADMIN_ONLY_API_PREFIXES.some((p) => pathname.startsWith(p)) &&
      (token as any).role !== "admin"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // ---- Page routes ----
  const routeKey = Object.keys(protectedRoutes)
    .filter((route) => (route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(route + "/")))
    .sort((a, b) => b.length - a.length)[0];

  // Every matched page requires a login, even ones without a role entry.
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const url = new URL("/login", req.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (!routeKey) return NextResponse.next();

  const role = (token as any).role as string | undefined;
  const required = protectedRoutes[routeKey];
  if (required.length > 0 && (!role || !required.includes(role))) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/actions",
    "/approvals",
    "/activity",
    "/low-stock",
    "/inventory",
    "/operations/:path*",
    "/reporting",
    "/admin/:path*",
    "/dispatch-types",
    "/users",
    "/locations",
    "/suppliers",
    "/api/:path*",
  ],
};
