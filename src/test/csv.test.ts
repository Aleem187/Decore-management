import { describe, expect, it } from "vitest";
import { buildCsv } from "@/lib/csv";

const one = (v: string | number | boolean | null | undefined) =>
  buildCsv(["h"], [[v]]).split("\r\n")[1];

describe("buildCsv escaping", () => {
  it("quotes every cell and uses CRLF between rows", () => {
    expect(
      buildCsv(
        ["A", "B"],
        [
          ["x", "y"],
          ["z", "w"],
        ],
      ),
    ).toBe('"A","B"\r\n"x","y"\r\n"z","w"');
  });
  it("doubles quotes", () => expect(one('say "hi"')).toBe('"say ""hi"""'));
  it("keeps commas and line breaks inside the quoted cell", () => {
    expect(one("a,b")).toBe('"a,b"');
    expect(one("line1\nline2")).toBe('"line1\nline2"');
  });
  it("writes null and undefined as empty cells", () => {
    expect(one(null)).toBe('""');
    expect(one(undefined)).toBe('""');
  });
  it("writes numbers raw and non-finite numbers as empty", () => {
    expect(one(1234.5)).toBe("1234.5");
    expect(one(Number.NaN)).toBe("");
    expect(one(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("buildCsv formula-injection protection", () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
    ["=1+1", `"'=1+1"`],
    ["+92300", `"'+92300"`],
    ["-5", `"'-5"`],
    ["@SUM(A1)", `"'@SUM(A1)"`],
    ["\t=1", `"'\t=1"`],
    ["\r=1", `"'\r=1"`],
  ])("prefixes %j with a single quote", (input, out) => expect(one(input)).toBe(out));

  it("does not touch safe text, or a dangerous character that is not first", () => {
    expect(one("Ayesha")).toBe('"Ayesha"');
    expect(one("a=b")).toBe('"a=b"');
    expect(one("x-ray")).toBe('"x-ray"');
    expect(one(" =1")).toBe('" =1"');
  });
  it("protects header cells too", () => expect(buildCsv(["=cmd"], [])).toBe(`"'=cmd"`));
  it("leaves real negative numbers numeric (profit can be a loss)", () =>
    expect(one(-5000)).toBe("-5000"));
  it("protects text that merely looks like a number", () => expect(one("-5000")).toBe(`"'-5000"`));
  it("protects every cell of a row, e.g. a hostile client name", () => {
    const row = buildCsv(["Event", "Client"], [["Wedding", "=cmd|' /C calc'!A0"]]).split("\r\n")[1];
    expect(row).toBe(`"Wedding","'=cmd|' /C calc'!A0"`);
  });
});
