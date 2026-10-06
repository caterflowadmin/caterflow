/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }));
import { getToken } from "next-auth/jwt";
import middleware from "@/middleware";

const call = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(`http://localhost${path}`, { headers }));
const as = (role?: string) => (getToken as jest.Mock).mockResolvedValue(role ? { role } : null);

beforeEach(() => jest.clearAllMocks());

describe("middleware: API routes", () => {
  it("rejects unauthenticated API calls with 401 JSON", async () => {
    as();
    const res = await call("/api/stock-items");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("lets authenticated users through", async () => {
    as("siteManager");
    expect((await call("/api/stock-items")).status).toBe(200);
  });

  it.each(["/api/auth/login", "/api/auth/session", "/api/archive/health", "/api/archive/cron/resume"])(
    "keeps %s public",
    async (path) => {
      as();
      expect((await call(path)).status).toBe(200);
    },
  );

  it("allows bearer-authenticated cron calls to /api/archive/run (route checks the secret)", async () => {
    as();
    expect((await call("/api/archive/run", { authorization: "Bearer s" })).status).toBe(200);
    expect((await call("/api/archive/run")).status).toBe(401);
  });

  it.each(["/api/admin/reset-stock", "/api/debug"])("restricts %s to admins", async (path) => {
    as("siteManager");
    expect((await call(path)).status).toBe(403);
    as("admin");
    expect((await call(path)).status).toBe(200);
  });
});

describe("middleware: pages", () => {
  it("redirects anonymous users to /login with a redirect param", async () => {
    as();
    const res = await call("/actions");
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirect")).toBe("/actions");
  });

  it("requires login even for matched pages without a role entry", async () => {
    as();
    expect((await call("/operations/something-new")).status).toBe(307);
    as("auditor");
    expect((await call("/operations/something-new")).status).toBe(200);
  });

  it("enforces the most specific role rule (not the '/' list)", async () => {
    as("siteManager");
    const res = await call("/admin/archive");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/unauthorized");
    as("admin");
    expect((await call("/admin/archive")).status).toBe(200);
  });

  it("matches the navigation config for roles that see a page in the menu", async () => {
    as("procurer");
    expect((await call("/actions")).status).toBe(200);
    as("stockController");
    expect((await call("/operations/purchases")).status).toBe(200);
  });
});
