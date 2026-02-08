import { describe, it, expect } from "vitest";
import {
  cleanHSCode,
  formatHSCode,
  getParentCodes,
  getHSLevel,
} from "@/lib/hsCodeInheritance";

// =============================================================================
// TESTS: HS Code Utility Functions (Pure functions, no DB calls)
// =============================================================================

describe("cleanHSCode", () => {
  it("removes dots", () => {
    expect(cleanHSCode("84.71")).toBe("8471");
  });

  it("removes spaces", () => {
    expect(cleanHSCode("84 71 30")).toBe("847130");
  });

  it("removes dashes", () => {
    expect(cleanHSCode("84-71-30-00-00")).toBe("8471300000");
  });

  it("removes mixed separators", () => {
    expect(cleanHSCode("84.71.30.00.00")).toBe("8471300000");
  });

  it("trims whitespace", () => {
    expect(cleanHSCode("  8471  ")).toBe("8471");
  });

  it("handles already clean codes", () => {
    expect(cleanHSCode("8471300000")).toBe("8471300000");
  });

  it("handles empty string", () => {
    expect(cleanHSCode("")).toBe("");
  });
});

describe("formatHSCode", () => {
  it("formats a 2-digit chapter code", () => {
    expect(formatHSCode("84")).toBe("84");
  });

  it("formats a 4-digit heading code", () => {
    expect(formatHSCode("8471")).toBe("84.71");
  });

  it("formats a 6-digit subheading code", () => {
    expect(formatHSCode("847130")).toBe("8471.30");
  });

  it("formats an 8-digit code", () => {
    expect(formatHSCode("84713000")).toBe("8471.30.00");
  });

  it("formats a 10-digit national code", () => {
    expect(formatHSCode("8471300000")).toBe("8471.30.00.00");
  });

  it("handles codes with existing dots by cleaning first", () => {
    expect(formatHSCode("84.71.30")).toBe("8471.30");
  });
});

describe("getParentCodes", () => {
  it("returns empty array for 2-digit codes", () => {
    expect(getParentCodes("84")).toEqual([]);
  });

  it("returns chapter for 4-digit codes", () => {
    expect(getParentCodes("8471")).toEqual(["84"]);
  });

  it("returns chapter and heading for 6-digit codes", () => {
    expect(getParentCodes("847130")).toEqual(["84", "8471"]);
  });

  it("returns full hierarchy for 10-digit codes", () => {
    expect(getParentCodes("8471300000")).toEqual(["84", "8471", "847130", "84713000"]);
  });

  it("handles codes with dots", () => {
    expect(getParentCodes("84.71.30.00.00")).toEqual(["84", "8471", "847130", "84713000"]);
  });
});

describe("getHSLevel", () => {
  it("identifies chapter (2 digits)", () => {
    expect(getHSLevel("84")).toBe("chapter");
  });

  it("identifies heading (4 digits)", () => {
    expect(getHSLevel("8471")).toBe("heading");
  });

  it("identifies subheading (6 digits)", () => {
    expect(getHSLevel("847130")).toBe("subheading");
  });

  it("identifies tariff line (8+ digits)", () => {
    expect(getHSLevel("84713000")).toBe("tariff_line");
  });

  it("identifies tariff line (10 digits)", () => {
    expect(getHSLevel("8471300000")).toBe("tariff_line");
  });
});
