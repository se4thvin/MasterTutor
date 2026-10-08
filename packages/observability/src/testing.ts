import { OBSERVE_BASE_PATH, OBSERVE_USERS } from "@mastertutor/contracts";
import { GenericContainer, Wait } from "testcontainers";
import { createO2Client, type O2Client } from "./client.ts";
import { O2_REQUIRED_ENV } from "./o2-api.ts";

export const OPENOBSERVE_IMAGE =
  "openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba";
/** Meets OpenObserve's password policy (lower, upper, digit, special), which the root user must pass at boot. */
export const TEST_OBSERVE_ROOT_PASSWORD = "Test-root-password-0123456789abcdef";

export interface TestOpenObserve {
  baseUrl: string;
  root: O2Client;
  stop(): Promise<void>;
}

/** The pinned image on local disk (S3 is exercised by the observability stack suite, F1). */
export async function startTestOpenObserve(): Promise<TestOpenObserve> {
  const container = await new GenericContainer(OPENOBSERVE_IMAGE)
    .withEnvironment({
      ...O2_REQUIRED_ENV,
      ZO_ROOT_USER_EMAIL: OBSERVE_USERS.root,
      ZO_ROOT_USER_PASSWORD: TEST_OBSERVE_ROOT_PASSWORD,
      ZO_DATA_DIR: "/data",
    })
    .withExposedPorts(5080)
    .withWaitStrategy(Wait.forHttp(`${OBSERVE_BASE_PATH}/healthz`, 5080))
    .withStartupTimeout(120_000)
    .start();
  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(5080)}${OBSERVE_BASE_PATH}`;
  return {
    baseUrl,
    root: createO2Client({
      baseUrl,
      email: OBSERVE_USERS.root,
      password: TEST_OBSERVE_ROOT_PASSWORD,
    }),
    stop: async () => {
      await container.stop();
    },
  };
}
