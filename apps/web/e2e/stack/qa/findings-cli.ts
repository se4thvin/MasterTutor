// QA findings ledger CLI (root: pnpm qa:findings …). Paths are repo-relative.
//   merge <run-id>...                  merge each run's persisted report.md (refuses a merged run)
//   fix <QA-###> --commit <sha>        open → fixed
//   verify <QA-###> --run <run-id>     fixed → verified (a re-dispatched agent confirmed it gone)
//   dismiss <QA-###> --rationale "…"   a recorded decision that it is not a defect
//   gate                               exit 1 while anything is open or fixed-but-unverified
//   evidence                           print cited evidence paths (for git add -f)
//   md                                 rewrite findings.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  EMPTY_LEDGER,
  Ledger,
  QA_RUN_ID,
  citedEvidence,
  dismiss,
  extractSwarmReport,
  markFixed,
  markVerified,
  mergeReports,
  openEntries,
  renderLedgerMarkdown,
} from "./findings.ts";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const DIR = join(ROOT, "orchestration/qa");
const LEDGER = join(DIR, "findings.json");

const load = (): Ledger =>
  existsSync(LEDGER) ? Ledger.parse(JSON.parse(readFileSync(LEDGER, "utf8"))) : EMPTY_LEDGER;
const save = (ledger: Ledger) => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(join(DIR, "findings.md"), renderLedgerMarkdown(ledger));
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: { commit: { type: "string" }, run: { type: "string" }, rationale: { type: "string" } },
});
const [command, ...rest] = positionals;
const needs = (value: string | undefined, flag: string) => {
  if (!value) throw new Error(`${command} needs ${flag}`);
  return value;
};

switch (command) {
  case "merge": {
    if (rest.length === 0) throw new Error("merge <run-id>...");
    const reports = rest.map((runId) => {
      if (!QA_RUN_ID.test(runId)) throw new Error(`not a QA run id: ${runId}`);
      const report = extractSwarmReport(
        readFileSync(join(ROOT, "orchestration/runs", runId, "report.md"), "utf8"),
      );
      return { runId, report };
    });
    save(mergeReports(load(), reports));
    break;
  }
  case "fix":
    save(markFixed(load(), needs(rest[0], "<QA-###>"), needs(values.commit, "--commit")));
    break;
  case "verify":
    save(markVerified(load(), needs(rest[0], "<QA-###>"), needs(values.run, "--run")));
    break;
  case "dismiss":
    save(dismiss(load(), needs(rest[0], "<QA-###>"), needs(values.rationale, "--rationale")));
    break;
  case "gate": {
    const open = openEntries(load());
    for (const e of open) console.error(`${e.id} ${e.status}: ${e.finding.title}`);
    process.exitCode = open.length === 0 ? 0 : 1;
    break;
  }
  case "evidence":
    for (const path of citedEvidence(load())) console.log(path);
    break;
  case "md":
    save(load());
    break;
  default:
    throw new Error("usage: qa:findings <merge|fix|verify|dismiss|gate|evidence|md> …");
}
