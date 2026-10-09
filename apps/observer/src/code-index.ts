import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CodeReadArgs } from "@mastertutor/observer/copilot";
import { COPILOT_LIMITS } from "@mastertutor/contracts";

export interface CodeIndex {
  search(
    query: string,
    pathPrefix: string | null,
  ): Array<{ path: string; line: number; text: string }>;
  read(path: string, start: number, end: number): string[] | null;
}

/** Literal substring search only (no model-supplied regex, so no ReDoS): spec §7.5, D39. */
export function createCodeIndex(
  files: ReadonlyArray<{ path: string; lines: string[] }>,
): CodeIndex {
  const byPath = new Map(files.map((file) => [file.path, file.lines]));
  return {
    search(query, pathPrefix) {
      const needle = query.toLowerCase();
      const out: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (pathPrefix && !file.path.startsWith(pathPrefix)) continue;
        for (const [i, text] of file.lines.entries()) {
          if (!text.toLowerCase().includes(needle)) continue;
          out.push({ path: file.path, line: i + 1, text: text.slice(0, 300) });
          if (out.length >= COPILOT_LIMITS.codeMatches) return out;
        }
      }
      return out;
    },
    read(path, start, end) {
      const lines = byPath.get(path);
      if (!lines) return null;
      const from = Math.max(1, start);
      const to = Math.min(lines.length, end, from + COPILOT_LIMITS.codeReadLines - 1);
      return lines.slice(from - 1, to);
    },
  };
}

export async function loadCodeIndex(file: string): Promise<CodeIndex> {
  const snapshot = z.array(
    z.strictObject({ path: CodeReadArgs.shape.path, lines: z.array(z.string()) }),
  );
  return createCodeIndex(snapshot.parse(JSON.parse(await readFile(file, "utf8"))));
}
