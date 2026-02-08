import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

// =============================================================================
// TESTS: Utility function cn() - class name merging
// =============================================================================

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles undefined values", () => {
    expect(cn("base", undefined, "end")).toBe("base end");
  });

  it("resolves Tailwind conflicts correctly", () => {
    // tailwind-merge should resolve conflicting classes
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles empty arguments", () => {
    expect(cn()).toBe("");
  });

  it("handles array arguments via clsx", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles object arguments via clsx", () => {
    expect(cn({ "is-active": true, "is-hidden": false })).toBe("is-active");
  });
});
