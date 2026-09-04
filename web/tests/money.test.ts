import { describe, expect, it } from "vitest";
import { ValidationError } from "@fairshare/domain/errors";
import { centsToEuro, parseAmount } from "@fairshare/domain/money";

describe("parseAmount", () => {
  it("parses a plain integer", () => {
    expect(parseAmount("60")).toBe(6000);
  });
  it("parses two decimal places", () => {
    expect(parseAmount("60.00")).toBe(6000);
  });
  it("parses fractional cents", () => {
    expect(parseAmount("60.50")).toBe(6050);
  });
  it("parses euro prefix", () => {
    expect(parseAmount("€60")).toBe(6000);
  });
  it("parses euro prefix with decimals", () => {
    expect(parseAmount("€60.50")).toBe(6050);
  });
  it("parses dollar prefix for CLI files", () => {
    expect(parseAmount("$60.50")).toBe(6050);
  });
  it("parses one decimal place", () => {
    expect(parseAmount("9.9")).toBe(990);
  });
  it("rejects zero", () => {
    expect(() => parseAmount("0")).toThrow(ValidationError);
  });
  it("rejects negative", () => {
    expect(() => parseAmount("-10")).toThrow(ValidationError);
  });
  it("rejects empty", () => {
    expect(() => parseAmount("")).toThrow(ValidationError);
  });
  it("rejects three decimals", () => {
    expect(() => parseAmount("10.123")).toThrow(ValidationError);
  });
  it("parses one cent", () => {
    expect(parseAmount("0.01")).toBe(1);
  });
  it("parses a comma decimal", () => {
    expect(parseAmount("60,50")).toBe(6050);
  });
  it("parses a euro prefix with a comma decimal", () => {
    expect(parseAmount("€60,5")).toBe(6050);
  });
  it("rejects mixed comma and dot", () => {
    expect(() => parseAmount("1.234,56")).toThrow(ValidationError);
    expect(() => parseAmount("1,234.56")).toThrow(ValidationError);
  });
});

describe("centsToEuro", () => {
  it("formats zero", () => {
    expect(centsToEuro(0)).toBe("€0.00");
  });
  it("formats whole euros", () => {
    expect(centsToEuro(6000)).toBe("€60.00");
  });
  it("formats mixed", () => {
    expect(centsToEuro(6050)).toBe("€60.50");
  });
  it("formats one cent", () => {
    expect(centsToEuro(1)).toBe("€0.01");
  });
  it("formats negative", () => {
    expect(centsToEuro(-5050)).toBe("-€50.50");
  });
});
