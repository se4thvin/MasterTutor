// Generates seccomp/chromium.json: Docker's default seccomp profile plus the namespace
// syscalls Chromium's sandbox needs (clone, clone3, unshare, setns). The slot then runs
// Chromium WITH its sandbox and without CAP_SYS_ADMIN. Verified 2026-10-05: with Docker's
// stock profile Chromium dies with "Failed to move to new namespace ... Operation not permitted".
// Regenerate: node apps/browser-slot/seccomp/build-profile.ts
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const MOBY_PROFILE_URL =
  "https://raw.githubusercontent.com/moby/profiles/seccomp/v0.2.4/seccomp/default.json";
const NAMESPACE_SYSCALLS = ["clone", "clone3", "unshare", "setns"] as const;

interface SeccompRule {
  names: string[];
  action: string;
  includes?: { caps?: string[] };
  [key: string]: unknown;
}
interface SeccompProfile {
  syscalls: SeccompRule[];
  [key: string]: unknown;
}

export function allowNamespaceSyscalls(profile: SeccompProfile): SeccompProfile {
  const namespaceCalls = new Set<string>(NAMESPACE_SYSCALLS);
  const syscalls = profile.syscalls.filter((rule) => {
    const onlyNamespaceCalls = rule.names.every((name) => namespaceCalls.has(name));
    const sysAdminOnly = rule.includes?.caps?.includes("CAP_SYS_ADMIN") ?? false;
    return !(onlyNamespaceCalls && !sysAdminOnly);
  });
  syscalls.push({
    names: [...NAMESPACE_SYSCALLS],
    action: "SCMP_ACT_ALLOW",
    comment: "Chromium namespace sandbox without CAP_SYS_ADMIN",
  });
  return { ...profile, syscalls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch(MOBY_PROFILE_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const profile = (await response.json()) as SeccompProfile;
  const out = fileURLToPath(new URL("./chromium.json", import.meta.url));
  await writeFile(out, `${JSON.stringify(allowNamespaceSyscalls(profile), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
