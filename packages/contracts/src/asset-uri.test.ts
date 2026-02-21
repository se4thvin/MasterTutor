import { describe, expect, it } from "vitest";
import { assetIdsIn, assetUri, replaceAssetUris } from "./asset-uri.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("asset URIs", () => {
  it("builds and rewrites only link and image targets", () => {
    expect(assetUri(id)).toBe(`asset:${id}`);
    const md = `![Fig](asset:${id}) and [file](asset:${id}) but not asset:${id} in prose`;
    expect(replaceAssetUris(md, (a) => `/api/assets/${a}`)).toBe(
      `![Fig](/api/assets/${id}) and [file](/api/assets/${id}) but not asset:${id} in prose`,
    );
    expect(assetIdsIn(md)).toEqual([id]);
  });
  it("rejects malformed ids", () => {
    expect(() => assetUri("../../x")).toThrow(TypeError);
  });
});
