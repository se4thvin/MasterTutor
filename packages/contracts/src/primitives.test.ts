import { describe, expect, it } from "vitest";
import {
  Alias,
  Base64Key32,
  DbPassword,
  ElementRef,
  FolderName,
  GarageKeyId,
  Origin,
  OriginInput,
  SlotName,
  Uuid,
  toOrigin,
} from "./primitives.ts";

describe("OriginInput", () => {
  it.each([
    ["https://Example.COM/path?q=1", "https://example.com"],
    ["example.com", "https://example.com"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["https://example.com:443", "https://example.com"],
    ["  https://learn.zybooks.com  ", "https://learn.zybooks.com"],
    ["https://bücher.de", "https://xn--bcher-kva.de"],
  ])("normalizes %s", (input, expected) => {
    expect(OriginInput.parse(input)).toBe(expected);
  });

  it.each([
    "ftp://example.com",
    "javascript:alert(1)",
    "https://user:pw@example.com",
    "",
    "https://",
    "file:///etc/passwd",
  ])("rejects %s", (input) => {
    expect(OriginInput.safeParse(input).success).toBe(false);
  });
});

describe("Origin", () => {
  it("accepts only already-normalized origins", () => {
    expect(Origin.safeParse("https://example.com").success).toBe(true);
    expect(Origin.safeParse("https://example.com/").success).toBe(false);
    expect(Origin.safeParse("example.com").success).toBe(false);
    expect(toOrigin("not a url at all")).toBeNull();
  });
});

describe("identifiers", () => {
  it("validates slot names", () => {
    expect(SlotName.safeParse("browser-1").success).toBe(true);
    expect(SlotName.safeParse("browser-12").success).toBe(true);
    for (const bad of ["browser-0", "browser-01", "Browser-1", "browser-1 ", "browser"]) {
      expect(SlotName.safeParse(bad).success).toBe(false);
    }
  });

  it("validates aliases", () => {
    expect(Alias.safeParse("zybooks").success).toBe(true);
    expect(Alias.safeParse("my_site-2").success).toBe(true);
    for (const bad of ["Bad", "-x", "a".repeat(64), ""]) {
      expect(Alias.safeParse(bad).success).toBe(false);
    }
  });

  it("validates element refs and key formats", () => {
    expect(ElementRef.safeParse("e12").success).toBe(true);
    expect(ElementRef.safeParse("12").success).toBe(false);
    expect(GarageKeyId.safeParse("GK66316f1f1bd64a571eb1b439").success).toBe(true);
    expect(GarageKeyId.safeParse("GK123").success).toBe(false);
    expect(Base64Key32.safeParse("y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=").success).toBe(
      true,
    );
    expect(DbPassword.safeParse("short").success).toBe(false);
    expect(DbPassword.safeParse("x'; drop table runs; --aaaaaaaaaaaa").success).toBe(false);
  });
});

describe("Uuid", () => {
  it("normalizes to lowercase and rejects non-uuids", () => {
    expect(Uuid.parse("0190F3A2-7B1C-7ABC-8DEF-0123456789AB")).toBe(
      "0190f3a2-7b1c-7abc-8def-0123456789ab",
    );
    expect(Uuid.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("FolderName", () => {
  it("trims and accepts plain names", () => {
    expect(FolderName.parse("  Biology  ")).toBe("Biology");
  });
  it.each(["a/b", "tab\tname", "   ", "x".repeat(121)])("rejects %j", (bad) => {
    expect(FolderName.safeParse(bad).success).toBe(false);
  });
});
