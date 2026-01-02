import { z } from "zod";

/** Accepts any case, normalizes to lowercase so every consumer sees one canonical form. */
export const Uuid = z.uuid().overwrite((value) => value.toLowerCase());
export type Uuid = z.infer<typeof Uuid>;

/** Better Auth user ids are opaque text. */
export const UserId = z.string().min(1).max(64);
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase hex SHA-256");

export const Alias = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, "Aliases are 1-63 chars of a-z, 0-9, '_' or '-'");

export const SLOT_NAME_PATTERN = /^browser-[1-9][0-9]?$/;
export const SlotName = z.string().regex(SLOT_NAME_PATTERN, "Expected a slot name like browser-1");

export const ElementRef = z.string().regex(/^e[0-9]{1,6}$/, "Expected an element ref like e12");

/** Role passwords are interpolated into ALTER ROLE, so the alphabet is deliberately narrow. */
export const DbPassword = z
  .string()
  .regex(/^[A-Za-z0-9_-]{24,128}$/, "Expected 24-128 chars of A-Z, a-z, 0-9, '_' or '-'");
export const GarageKeyId = z
  .string()
  .regex(/^GK[0-9a-f]{24}$/, "Expected GK followed by 24 hex chars");
export const GarageSecret = z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 hex chars");
export const Base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "Expected a base64-encoded 32-byte key");
export const PostgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/\S+$/, "Expected a postgres:// URL");
export const BucketName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Expected an S3 bucket name");

/**
 * Normalizes user input to a WHATWG origin ("https://example.com", "http://localhost:3000").
 * Bare hosts get https://. Non-http(s) schemes and URLs with credentials are rejected (null).
 */
export function toOrigin(input: string): string | null {
  const candidate = input.includes("://") ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;
  return url.origin;
}

/** An origin that is already normalized; use for stored values. */
export const Origin = z.string().refine((value) => toOrigin(value) === value, {
  message: "Expected a normalized http(s) origin such as https://example.com",
});

/** Anything a person might type; output is a normalized origin. Use for API inputs. */
export const OriginInput = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const origin = value === "" ? null : toOrigin(value);
    if (origin === null) {
      ctx.addIssue({ code: "custom", message: "Expected an http(s) URL or host name" });
      return z.NEVER;
    }
    return origin;
  });

export const FolderName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !value.includes("/") && !/\p{Cc}/u.test(value), {
    message: "Folder names cannot contain '/' or control characters",
  });
