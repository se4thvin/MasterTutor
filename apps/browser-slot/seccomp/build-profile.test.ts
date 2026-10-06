import { describe, expect, it } from "vitest";
import { allowNamespaceSyscalls } from "./build-profile.ts";

describe("allowNamespaceSyscalls", () => {
  it("replaces Docker's namespace restrictions with one allow rule and keeps everything else", () => {
    const profile = {
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [
        { names: ["read", "write"], action: "SCMP_ACT_ALLOW" },
        {
          names: ["bpf", "clone", "unshare"],
          action: "SCMP_ACT_ALLOW",
          includes: { caps: ["CAP_SYS_ADMIN"] },
        },
        {
          names: ["clone"],
          action: "SCMP_ACT_ALLOW",
          args: [{ index: 0, value: 2114060288, op: "SCMP_CMP_MASKED_EQ" }],
        },
        {
          names: ["clone3"],
          action: "SCMP_ACT_ERRNO",
          errnoRet: 38,
          excludes: { caps: ["CAP_SYS_ADMIN"] },
        },
        { names: ["chroot"], action: "SCMP_ACT_ALLOW", includes: { caps: ["CAP_SYS_CHROOT"] } },
      ],
    };
    const result = allowNamespaceSyscalls(profile);
    expect(result.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(result.syscalls.map((rule) => rule.names)).toEqual([
      ["read", "write"],
      ["bpf", "clone", "unshare"],
      ["chroot"],
      ["clone", "clone3", "unshare", "setns"],
    ]);
    expect(result.syscalls.at(-1)?.action).toBe("SCMP_ACT_ALLOW");
  });
});
