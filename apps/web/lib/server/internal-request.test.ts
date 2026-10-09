import { internalWebHosts } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { isInternalRequest } from "./internal-request.ts";

const at = (host: string | null) =>
  new Request("http://web:3000/x", { headers: host ? { host } : {} });
const hosts = internalWebHosts("10.9.8");

describe("isInternalRequest", () => {
  it("accepts web:3000 and the ForwardAuth target host", () => {
    expect(isInternalRequest(at("web:3000"), hosts)).toBe(true);
    expect(isInternalRequest(at("10.9.8.11:3000"), hosts)).toBe(true);
  });

  it("refuses a public, obs, other-prefix or missing Host", () => {
    for (const host of ["mt.example.com", "obs.mt.example.com", "172.30.231.11:3000", "web", null])
      expect(isInternalRequest(at(host), hosts), String(host)).toBe(false);
  });
});
