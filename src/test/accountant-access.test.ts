import { describe, expect, it } from "vitest";
import { accountantMayVisit } from "@/lib/auth";

describe("accountantMayVisit", () => {
  it.each(["/dashboard", "/invoices", "/expenses", "/vendors", "/clients", "/clients/abc"])(
    "allows %s",
    (p) => expect(accountantMayVisit(p)).toBe(true),
  );
  it.each([
    "/staff",
    "/staff/abc",
    "/attendance",
    "/calendar",
    "/events",
    "/events/abc",
    "/event-profitability",
    "/users",
    "/team",
    "/hotels",
    "/dashboardx",
  ])("blocks %s", (p) => expect(accountantMayVisit(p)).toBe(false));
});
