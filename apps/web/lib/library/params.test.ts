import { describe, expect, it } from "vitest";
import { libraryHref, parseLibraryParams } from "./params.ts";

const parse = (qs: string) => parseLibraryParams(new URLSearchParams(qs));
const uuid = "00000000-0000-4000-8000-000001000002";

describe("library params", () => {
  it("defaults safely", () => {
    expect(parse("")).toEqual({ folder: "all", kind: null, view: "grid", q: "" });
  });
  it("accepts folder ids, unfiled, kinds and list view", () => {
    expect(parse(`folder=${uuid}&kind=pdf&view=list&q=warmup`)).toEqual({
      folder: uuid,
      kind: "pdf",
      view: "list",
      q: "warmup",
    });
    expect(parse("folder=unfiled").folder).toBe("unfiled");
  });
  it("rejects junk", () => {
    expect(parse("folder=../etc&kind=exe&view=table")).toEqual({
      folder: "all",
      kind: null,
      view: "grid",
      q: "",
    });
  });
  it("builds minimal hrefs", () => {
    expect(libraryHref({ folder: "all", kind: null, view: "grid", q: "" })).toBe("/library");
    expect(libraryHref({ folder: uuid, kind: "web", view: "list", q: "" })).toBe(
      `/library?folder=${uuid}&kind=web&view=list`,
    );
  });
});
