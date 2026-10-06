import { GenericContainer, Wait } from "testcontainers";

export const GREENMAIL_IMAGE = "greenmail/standalone:2.1.14";
/** Test-only mailbox. The password doubles as the IMAP canary in the §12 secret-canary test. */
export const GREENMAIL_USER = {
  login: "otp",
  password: "KESTREL4IMAP9CANARY",
  address: "otp@mail.test",
} as const;

/** Single source for greenmail's options; compose.test.yml must use the same string (Task 13). */
export function greenmailOpts(): string {
  return [
    "-Dgreenmail.setup.test.smtp",
    "-Dgreenmail.setup.test.imap",
    "-Dgreenmail.hostname=0.0.0.0",
    `-Dgreenmail.users=${GREENMAIL_USER.login}:${GREENMAIL_USER.password}@mail.test`,
  ].join(" ");
}

export interface Greenmail {
  host: string;
  smtpPort: number;
  imapPort: number;
  stop(): Promise<void>;
}

export async function startGreenmail(): Promise<Greenmail> {
  const container = await new GenericContainer(GREENMAIL_IMAGE)
    .withEnvironment({ GREENMAIL_OPTS: greenmailOpts() })
    .withExposedPorts(3025, 3143)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return {
    host: container.getHost(),
    smtpPort: container.getMappedPort(3025),
    imapPort: container.getMappedPort(3143),
    stop: async () => {
      await container.stop();
    },
  };
}
