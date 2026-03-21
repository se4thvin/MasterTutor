import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

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
  /** The container id (for inspection in tests). */
  id: string;
  host: string;
  smtpPort: number;
  imapPort: number;
  stop(): Promise<void>;
}

/**
 * Publishes every exposed port on 127.0.0.1 only (M10): the mailbox password is fixed, so the
 * container must not be reachable from the network while a test runs.
 */
class LoopbackContainer extends GenericContainer {
  override async start(): Promise<StartedTestContainer> {
    for (const bindings of Object.values(this.hostConfig.PortBindings ?? {}))
      for (const binding of bindings as Array<{ HostIp?: string }>) binding.HostIp = "127.0.0.1";
    return super.start();
  }
}

export async function startGreenmail(): Promise<Greenmail> {
  const container = await new LoopbackContainer(GREENMAIL_IMAGE)
    .withEnvironment({ GREENMAIL_OPTS: greenmailOpts() })
    .withExposedPorts(3025, 3143)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return {
    id: container.getId(),
    host: container.getHost(),
    smtpPort: container.getMappedPort(3025),
    imapPort: container.getMappedPort(3143),
    stop: async () => {
      await container.stop();
    },
  };
}
