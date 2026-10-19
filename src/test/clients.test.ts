import { describe, expect, it } from "vitest";
import {
  clientBalance,
  phoneSearchDigits,
  searchPattern,
  validateClient,
  type ClientFormValues,
} from "@/lib/clients";
import { formatPkPhone, normalizePkPhone } from "@/lib/phone";

describe("normalizePkPhone", () => {
  it.each([
    ["0300-1234567"],
    ["0300 1234567"],
    ["03001234567"],
    ["(0300) 123 4567"],
    ["+92 300 1234567"],
    ["+923001234567"],
    ["92-300-1234567"],
    ["0092 300 1234567"],
    ["00923001234567"],
    ["+92 (0)300 1234567"],
    ["300 1234567"],
    ["  0300.123.4567  "],
  ])("%s -> 923001234567", (raw) => expect(normalizePkPhone(raw)).toBe("923001234567"));

  it("accepts landline-style numbers with the same length", () => {
    expect(normalizePkPhone("042 12345678")).toBe("924212345678");
    expect(normalizePkPhone("+92 21 12345678")).toBe("922112345678");
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["12345"],
    ["030012345"],
    ["0300123456789"],
    ["92300123456"],
    ["+1 202 555 0100"],
    ["+44 20 7946 0958"],
    ["+92 300 123456"],
  ])("rejects %j", (raw) => expect(normalizePkPhone(raw)).toBeNull());
  it("returns null for null and undefined", () => {
    expect(normalizePkPhone(null)).toBeNull();
    expect(normalizePkPhone(undefined)).toBeNull();
  });
  it("is stable on already-normalised input", () =>
    expect(normalizePkPhone(normalizePkPhone("0300 1234567"))).toBe("923001234567"));
  it("formats for display", () => expect(formatPkPhone("923001234567")).toBe("+92 300 1234567"));
});

const base: ClientFormValues = {
  name: "Ayesha Khan",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  notes: "",
};

describe("validateClient", () => {
  it("accepts a minimal client and turns blanks into null", () => {
    expect(validateClient(base)).toEqual({
      data: {
        name: "Ayesha Khan",
        phone: null,
        whatsapp: null,
        email: null,
        address: null,
        notes: null,
      },
    });
  });
  it("normalises phone and WhatsApp and trims the name", () => {
    const r = validateClient({
      ...base,
      name: "  Ayesha  ",
      phone: "0300-1234567",
      whatsapp: "+92 321 7654321",
      email: "a@b.pk",
    });
    expect(r).toMatchObject({
      data: { name: "Ayesha", phone: "923001234567", whatsapp: "923217654321", email: "a@b.pk" },
    });
  });
  it("reports each problem against its field", () => {
    const r = validateClient({
      ...base,
      name: " ",
      phone: "12345",
      whatsapp: "999",
      email: "nope",
      notes: "x".repeat(2001),
    });
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "email",
      "name",
      "notes",
      "phone",
      "whatsapp",
    ]);
  });
  it("rejects an over-long name", () =>
    expect("errors" in validateClient({ ...base, name: "x".repeat(121) })).toBe(true));
});

const pay = (amount: number, voided = false) => ({
  amount,
  voided_at: voided ? "2026-10-01T00:00:00Z" : null,
});

describe("clientBalance", () => {
  it("is zero with no invoices", () =>
    expect(clientBalance([])).toEqual({ invoiced: 0, received: 0, outstanding: 0 }));

  it("calculates from payments, not from any stored paid column", () => {
    const b = clientBalance([
      { amount: 100000, voided_at: null, payments: [pay(40000), pay(10000)] },
      { amount: 50000, voided_at: null, payments: [pay(50000)] },
      { amount: 30000, voided_at: null, payments: [] },
    ]);
    expect(b).toEqual({ invoiced: 180000, received: 100000, outstanding: 80000 });
  });
  it("ignores voided payments", () => {
    const b = clientBalance([
      { amount: 1000, voided_at: null, payments: [pay(400), pay(600, true)] },
    ]);
    expect(b).toEqual({ invoiced: 1000, received: 400, outstanding: 600 });
  });
  it("ignores void invoices entirely, including their payments", () => {
    const b = clientBalance([
      { amount: 1000, voided_at: null, payments: [pay(250)] },
      { amount: 9999, voided_at: "2026-10-01T00:00:00Z", payments: [pay(5000)] },
    ]);
    expect(b).toEqual({ invoiced: 1000, received: 250, outstanding: 750 });
  });
  it("treats missing payments as none, and never lets one invoice offset another", () => {
    const b = clientBalance([
      { amount: 100, voided_at: null, payments: null },
      { amount: 100, voided_at: null, payments: [pay(150)] }, // cannot happen in the database; must not go negative
    ]);
    expect(b.outstanding).toBe(100);
  });
  it("is exact with decimals", () => {
    const b = clientBalance([{ amount: 1000.1, voided_at: null, payments: [pay(0.1), pay(0.2)] }]);
    expect(b).toEqual({ invoiced: 1000.1, received: 0.3, outstanding: 999.8 });
  });
});

describe("searchPattern", () => {
  it("wraps the term and strips characters that break the filter", () => {
    expect(searchPattern(" ali ")).toBe("%ali%");
    expect(searchPattern("a,b)(c%")).toBe("%a b c%");
  });
  it("returns null for empty input", () => expect(searchPattern("  ,() ")).toBeNull());
});

describe("phoneSearchDigits", () => {
  it("turns a typed local number into the stored prefix", () => {
    expect(phoneSearchDigits("0300 123")).toBe("92300123");
    expect(phoneSearchDigits("+92 321")).toBe("92321");
    expect(phoneSearchDigits("0092-300")).toBe("92300");
  });
  it("ignores names and very short input", () => {
    expect(phoneSearchDigits("ayesha")).toBeNull();
    expect(phoneSearchDigits("03")).toBeNull();
  });
});
