import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runbook = readFileSync("infra/deploy-runbook.md", "utf8");
/** The text of one `## n.` section. */
const section = (n: number) => {
  const start = runbook.indexOf(`\n## ${n}. `);
  if (start === -1) throw new Error(`no section ${n}`);
  const end = runbook.indexOf("\n## ", start + 1);
  return runbook.slice(start, end === -1 ? undefined : end);
};
/** One numbered list item, continuation lines included. */
const item = (text: string, n: number) => {
  const start = text.indexOf(`\n${n}. `);
  const end = text.indexOf(`\n${n + 1}. `, start);
  return start === -1 ? "" : text.slice(start, end === -1 ? undefined : end);
};

describe("infra/deploy-runbook.md (review I7, I8 and minors)", () => {
  it("marks every user-performed host, DNS or router write as [approval] (I8)", () => {
    for (const n of [1, 3, 4]) expect(item(section(0), n), `§0.${n}`).toContain("[approval]");
    expect(section(7).split("\n")[1]).toContain("[approval]");
  });

  it("backs Garage up stopped, after the database dump, and checks it on the first backup (I7)", () => {
    const backups = section(6);
    expect(backups).toMatch(/daily 03:00/);
    expect(backups).toMatch(/garage-meta.*garage-data.*03:30/s);
    expect(backups).toMatch(/stop(s|ped)? `garage`/);
    expect(backups).toMatch(/First-backup check[\s\S]*garage/);
  });

  it("restores the first-backup check into a labelled throwaway project and removes it", () => {
    expect(section(6)).toMatch(/mt-drill-/);
    expect(section(6)).toMatch(/down -v/);
  });

  it("states the shared-host rules: one Dokploy app, bounded resources, Traefik buffering", () => {
    expect(runbook).toMatch(/only through the Dokploy app/);
    expect(runbook).toMatch(/mem_limit/);
    expect(runbook).toMatch(/buffer/i);
    expect(runbook).toMatch(/Domains tab stays empty/);
  });

  it("checks the external network against CDP_SUBNET_PREFIX before each deploy", () => {
    expect(section(5)).toMatch(/create-cdp-network\.sh/);
  });

  it("never puts the smoke password on a command line", () => {
    expect(runbook).not.toMatch(/SMOKE_PASSWORD=…/);
    expect(section(10)).toMatch(/read -rs SMOKE_PASSWORD/);
  });
});
