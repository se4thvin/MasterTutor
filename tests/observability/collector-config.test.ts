import { readFileSync } from "node:fs";
import { OBSERVE_USERS } from "@mastertutor/contracts";
import {
  ATTR,
  DEPENDENCIES,
  LOG_STREAMS,
  SPANMETRIC_DIMENSIONS,
  SPANMETRICS_NAMESPACE,
} from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";

const yaml = readFileSync(new URL("../../infra/otel/collector.yaml", import.meta.url), "utf8");
const block = (name: string) => {
  const start = yaml.indexOf(`\n  ${name}:`);
  const next = yaml.slice(start + 1).search(/\n {2}[a-z/_]+:|\n[a-z]+:/);
  return yaml.slice(start, next === -1 ? undefined : start + 1 + next);
};

describe("infra/otel/collector.yaml follows the names registry (spec §4.3, §10)", () => {
  it("derives span metrics under the registered namespace and dimensions", () => {
    const spanmetrics = block("spanmetrics");
    expect(spanmetrics).toContain(`namespace: ${SPANMETRICS_NAMESPACE}`);
    const dims = [...spanmetrics.matchAll(/- name: ([a-z._]+)/g)].map((m) => m[1]);
    expect(dims).toEqual([...SPANMETRIC_DIMENSIONS]);
  });

  it("uses only registered mt.* names", () => {
    const known = new Set<string>(Object.values(ATTR));
    for (const [name] of yaml.matchAll(/\bmt\.[a-z_.]+[a-z_]/g))
      if (name !== SPANMETRICS_NAMESPACE) expect(known.has(name), name).toBe(true);
  });

  it("names every dependency the registry knows and nothing else", () => {
    const set = [...yaml.matchAll(/set\(attributes\["mt\.dependency"\], "([a-z0-9-]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(new Set(set)).toEqual(new Set(DEPENDENCIES));
  });

  it("sends app logs and container logs to their streams with the ingest user", () => {
    expect(yaml).toContain(`stream-name: ${LOG_STREAMS.app}`);
    expect(yaml).toContain(`stream-name: ${LOG_STREAMS.containers}`);
    expect(yaml).toContain(`username: ${OBSERVE_USERS.ingest}`);
    const envs = new Set([...yaml.matchAll(/\$\{env:([A-Z_]+)\}/g)].map((m) => m[1]));
    expect(envs).toEqual(new Set(["OBSERVE_INGEST_PASSWORD", "OBSERVE_OTLP_ENDPOINT"]));
  });

  it("keeps errors, product error codes and slow traces, then samples 10%", () => {
    const tail = block("tail_sampling");
    expect(tail).toMatch(/status_codes: \[ERROR\]/);
    expect(tail).toMatch(/key: mt\.error\.code/);
    expect(tail).toMatch(/threshold_ms: 15000/);
    expect(tail).toMatch(/sampling_percentage: 10/);
  });

  it("runs spanmetrics before tail sampling, so RED counts cover every span", () => {
    expect(yaml).toMatch(/traces\/ingest:[\s\S]*exporters: \[spanmetrics, forward\/sample\]/);
    expect(yaml).toMatch(/traces\/sample:[\s\S]*processors: \[tail_sampling, batch\]/);
  });
});
