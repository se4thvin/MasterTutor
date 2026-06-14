import { z } from "zod";

export interface GarageKeySpec {
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  read: boolean;
  write: boolean;
}

export interface GarageBootstrapOptions {
  adminUrl: string;
  adminToken: string;
  bucket: string;
  keys: readonly GarageKeySpec[];
  zone?: string;
  capacityBytes?: number;
  fetchImpl?: typeof fetch;
  healthTimeoutMs?: number;
}

export interface GarageBootstrapResult {
  bucketId: string;
  layoutVersion: number;
  createdBucket: boolean;
  importedKeys: string[];
}

export class GarageAdminError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly code: string | null;
  constructor(operation: string, status: number, code: string | null) {
    super(`Garage admin ${operation} failed with HTTP ${status}${code ? ` (${code})` : ""}`);
    this.name = "GarageAdminError";
    this.operation = operation;
    this.status = status;
    this.code = code;
  }
}

/** An access key id already in Garage holds a different secret. Rotate the id with the secret (D61). */
export class GarageKeyMismatchError extends Error {
  readonly keyName: string;
  constructor(keyName: string) {
    super(
      `Garage key "${keyName}" exists with a different secret. Rotate S3 keys by changing the access key id and the secret together (infra/deploy-runbook.md, key rotation).`,
    );
    this.name = "GarageKeyMismatchError";
    this.keyName = keyName;
  }
}

const ClusterStatus = z.object({
  layoutVersion: z.number().int(),
  nodes: z.array(z.object({ id: z.string(), isUp: z.boolean() })),
});
const BucketList = z.array(z.object({ id: z.string(), globalAliases: z.array(z.string()) }));
const BucketInfo = z.object({ id: z.string() });
const KeyList = z.array(z.object({ id: z.string() }));
const KeyInfo = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string().nullable().optional(),
});
const ErrorBody = z.object({ code: z.string() });

const DEFAULT_CAPACITY_BYTES = 10 * 1024 ** 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function adminClient(options: { adminUrl: string; adminToken: string; fetchImpl?: typeof fetch }) {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.adminUrl.replace(/\/+$/, "");
  return async function call(operation: string, method: "GET" | "POST", body?: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${options.adminToken}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await doFetch(`${base}/v2/${operation}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(json);
      throw new GarageAdminError(
        operation,
        response.status,
        parsed.success ? parsed.data.code : null,
      );
    }
    return json;
  };
}

/** Polls until the admin API answers (one-shot startup only; not a hot path). */
export async function waitForGarageAdmin(options: {
  adminUrl: string;
  adminToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const call = adminClient(options);
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    try {
      await call("GetClusterStatus", "GET");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(500);
    }
  }
}

async function waitForHealthy(options: GarageBootstrapOptions): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${options.adminUrl.replace(/\/+$/, "")}/health`;
  const deadline = Date.now() + (options.healthTimeoutMs ?? 30_000);
  for (;;) {
    const response = await doFetch(url).catch(() => null);
    if (response?.ok) return;
    if (Date.now() > deadline) throw new GarageAdminError("health", response?.status ?? 0, null);
    await sleep(500);
  }
}

/**
 * Idempotent single-node setup through the Garage v2 admin API: layout, bucket, imported keys
 * and exact per-key permissions (web read-only, agent read/write).
 */
export async function bootstrapGarage(
  options: GarageBootstrapOptions,
): Promise<GarageBootstrapResult> {
  const call = adminClient(options);
  const status = ClusterStatus.parse(await call("GetClusterStatus", "GET"));
  let layoutVersion = status.layoutVersion;
  if (layoutVersion === 0) {
    const node = status.nodes.find((candidate) => candidate.isUp);
    if (!node) throw new Error("Garage has no live node to assign a layout to");
    await call("UpdateClusterLayout", "POST", {
      roles: [
        {
          id: node.id,
          zone: options.zone ?? "dc1",
          capacity: options.capacityBytes ?? DEFAULT_CAPACITY_BYTES,
          tags: [],
        },
      ],
    });
    await call("ApplyClusterLayout", "POST", { version: 1 });
    layoutVersion = 1;
  }
  await waitForHealthy(options);

  const buckets = BucketList.parse(await call("ListBuckets", "GET"));
  let bucketId = buckets.find((bucket) => bucket.globalAliases.includes(options.bucket))?.id;
  const createdBucket = bucketId === undefined;
  if (bucketId === undefined) {
    bucketId = BucketInfo.parse(
      await call("CreateBucket", "POST", { globalAlias: options.bucket }),
    ).id;
  }

  const existingKeys = new Set(KeyList.parse(await call("ListKeys", "GET")).map((key) => key.id));
  const importedKeys: string[] = [];
  for (const key of options.keys) {
    if (!existingKeys.has(key.accessKeyId)) {
      await call("ImportKey", "POST", {
        accessKeyId: key.accessKeyId,
        secretAccessKey: key.secretAccessKey,
        name: key.name,
      });
      importedKeys.push(key.name);
    } else {
      // Garage keeps the old secret under an existing id, so a rotated secret would be ignored.
      const info = KeyInfo.parse(
        await call(
          `GetKeyInfo?id=${encodeURIComponent(key.accessKeyId)}&showSecretKey=true`,
          "GET",
        ),
      );
      if (info.secretAccessKey !== key.secretAccessKey) throw new GarageKeyMismatchError(key.name);
    }
    await call("AllowBucketKey", "POST", {
      bucketId,
      accessKeyId: key.accessKeyId,
      permissions: { read: key.read, write: key.write, owner: false },
    });
    await call("DenyBucketKey", "POST", {
      bucketId,
      accessKeyId: key.accessKeyId,
      permissions: { read: !key.read, write: !key.write, owner: true },
    });
  }
  return { bucketId, layoutVersion, createdBucket, importedKeys };
}
