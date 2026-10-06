import { readFile } from "node:fs/promises";
import { GenericContainer, Wait } from "testcontainers";

export const TEST_GARAGE_ADMIN_TOKEN = "test-garage-admin-token-0123456789abcdef";
const TEST_RPC_SECRET = "efd683210a10ca343e2e01c81ed7586298bad59fd9748ede668ed26eea2c871f";

export interface TestGarage {
  s3Endpoint: string;
  adminUrl: string;
  adminToken: string;
  stop(): Promise<void>;
}

/** Garage v2.3.0 with the same garage.toml Compose uses. /health is 503 until bootstrapped. */
export async function startTestGarage(): Promise<TestGarage> {
  const toml = await readFile(
    new URL("../../../infra/garage/garage.toml", import.meta.url),
    "utf8",
  );
  const container = await new GenericContainer("dxflrs/garage:v2.3.0")
    .withCopyContentToContainer([{ content: toml, target: "/etc/garage.toml" }])
    .withEnvironment({
      GARAGE_RPC_SECRET: TEST_RPC_SECRET,
      GARAGE_ADMIN_TOKEN: TEST_GARAGE_ADMIN_TOKEN,
    })
    .withExposedPorts(3900, 3903)
    .withWaitStrategy(
      Wait.forHttp("/health", 3903).forStatusCodeMatching((code) => code === 200 || code === 503),
    )
    .start();
  const host = container.getHost();
  return {
    s3Endpoint: `http://${host}:${container.getMappedPort(3900)}`,
    adminUrl: `http://${host}:${container.getMappedPort(3903)}`,
    adminToken: TEST_GARAGE_ADMIN_TOKEN,
    stop: async () => {
      await container.stop();
    },
  };
}
