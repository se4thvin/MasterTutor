import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { FIXTURE_MAIL_FROM } from "./server.ts";
import { GREENMAIL_USER, startGreenmail } from "./greenmail.ts";
import { sendMail } from "./smtp.ts";

const run = promisify(execFile);

describe("greenmail helper", () => {
  it("publishes its ports on loopback only, and still takes mail there (M10)", async () => {
    const mail = await startGreenmail();
    try {
      const { stdout } = await run("docker", [
        "inspect",
        "--format",
        "{{json .HostConfig.PortBindings}}",
        mail.id,
      ]);
      const bindings = Object.values(
        JSON.parse(stdout) as Record<string, Array<{ HostIp: string }>>,
      ).flat();
      expect(bindings.length).toBeGreaterThanOrEqual(2);
      expect(bindings.map((binding) => binding.HostIp)).toEqual(bindings.map(() => "127.0.0.1"));
      await sendMail(mail.host, mail.smtpPort, {
        from: FIXTURE_MAIL_FROM,
        to: GREENMAIL_USER.address,
        subject: "ping",
        text: "ping",
      });
    } finally {
      await mail.stop();
    }
  });
});
