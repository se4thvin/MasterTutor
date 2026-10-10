import { expect, it } from "vitest";
import { agentInstructions } from "./instructions.ts";

it.each(["browser_use", "computer_use"] as const)(
  "%s delegates brief filtering to the system and captures whole pages",
  (profile) => {
    const text = agentInstructions(profile);
    expect(text).toContain('capture whole sections or pages with scope:"page"');
    expect(text).not.toContain("or the default");
    expect(text).toContain("The system applies the capture brief");
    expect(text).toContain("verbatim");
    expect(text).toContain("Do not filter with selectors");
    expect(text).toContain("Do not open DevTools or view-source");
    expect(text).toContain("do not inspect the DOM to find content");
  },
);
