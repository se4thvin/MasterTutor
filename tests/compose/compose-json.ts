import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ComposePort {
  target: number;
  published?: string;
  protocol?: string;
  host_ip?: string;
}
export interface ComposeServiceNetwork {
  ipv4_address?: string;
  aliases?: string[];
}
export interface ComposeVolumeMount {
  type?: string;
  source?: string;
  target: string;
  read_only?: boolean;
}
export interface ComposeService {
  image?: string;
  build?: unknown;
  command?: string[] | null;
  user?: string;
  environment?: Record<string, string | null>;
  networks?: Record<string, ComposeServiceNetwork | null>;
  network_mode?: string;
  ports?: ComposePort[];
  labels?: Record<string, string>;
  profiles?: string[];
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  tmpfs?: string[];
  restart?: string;
  sysctls?: Record<string, string>;
  volumes?: ComposeVolumeMount[];
}
export interface ComposeNetwork {
  name?: string;
  internal?: boolean;
  external?: boolean;
  labels?: Record<string, string>;
  ipam?: { config?: Array<{ subnet?: string; ip_range?: string }> };
}
export interface ComposeConfig {
  services: Record<string, ComposeService>;
  networks: Record<string, ComposeNetwork>;
  volumes?: Record<string, { labels?: Record<string, string> }>;
}

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The fully resolved `docker compose config` of the repo's Compose files (P7-4: the one helper every
 * compose test uses). Needs only the docker CLI; starts nothing.
 */
export function composeConfig(
  envFile: string | readonly string[],
  files: readonly string[],
  options: { profiles?: readonly string[]; env?: Readonly<Record<string, string>> } = {},
): ComposeConfig {
  const args = [
    "compose",
    ...(typeof envFile === "string" ? [envFile] : envFile).flatMap((file) => ["--env-file", file]),
    ...files.flatMap((file) => ["-f", file]),
    ...(options.profiles ?? []).flatMap((profile) => ["--profile", profile]),
    "config",
    "--format",
    "json",
  ];
  const text = execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    // Captured, never passed through: compose's errors can quote env-file values (secrets).
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(text) as ComposeConfig;
}
