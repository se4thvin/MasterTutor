import { describe, expect, it } from "vitest";
import {
  canariesFor,
  collectLogs,
  imageKind,
  scanSources,
  vacuousSources,
  type Source,
} from "./stack-canary.ts";

const C = {
  username: "WREN5CANARY7USER@fixtures.test",
  password: "HERON3CANARY9PASSWORD",
  totpSeed: "CANARYSEEDWRENHERONKITEQQ2345672",
  imapPassword: "KESTREL4IMAP9CANARY",
  pin: "604217",
  otp: "381952",
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const src = (kind: Source["kind"], where: string, text: string | Buffer): Source => ({
  kind,
  where,
  bytes: typeof text === "string" ? Buffer.from(text, "utf8") : text,
});

describe("stack canary scan", () => {
  it("finds a planted canary in every source kind and form, and in OCR of stored images", async () => {
    const sources = [
      src("database", "postgres", `row ${C.password}`),
      src("logs", "logs", Buffer.from(`x${C.username}y`).toString("base64")),
      src("object", "object a.bin", Buffer.from(C.totpSeed, "utf16le")),
      src("download", "download b.txt", Buffer.from(C.imapPassword).toString("hex")),
      src(
        "model-requests",
        "llm-mock requests",
        JSON.stringify({ input: `code ${C.otp}, pin ${C.pin}` }),
      ),
      src("object", "object shot.png", PNG),
    ];
    const { hits, scanned } = await scanSources(
      sources,
      C,
      async () => "Signed in HERON 3CANARY 9PASSWORD",
    );
    expect(hits.map((h) => `${h.canary}:${h.form}:${h.where}`).sort()).toEqual(
      [
        "password:plain:postgres",
        "username:base64:logs",
        "totpSeed:utf16:object a.bin",
        "imapPassword:hex:download b.txt",
        "otp:plain:llm-mock requests",
        "pin:plain:llm-mock requests",
        "password:ocr:ocr object shot.png",
      ].sort(),
    );
    expect(scanned).toEqual({
      database: 1,
      logs: 1,
      object: 2,
      download: 1,
      "model-requests": 1,
      ocr: 1,
    });
  });

  it("ignores digit canaries outside model requests and OCR, and inside longer numbers (P7-34)", async () => {
    const sources = [
      src("database", "postgres", `id ${C.pin} at ${C.otp}`),
      src("logs", "logs", `took ${C.pin}ms`),
      src("model-requests", "llm-mock requests", `ref 9${C.pin}0`),
    ];
    expect((await scanSources(sources, C, async () => "")).hits).toEqual([]);
    expect(Object.keys(canariesFor("database", C)).sort()).toEqual([
      "imapPassword",
      "password",
      "totpSeed",
      "username",
    ]);
    expect(Object.keys(canariesFor("model-requests", C))).toHaveLength(6);
  });

  it("sniffs images by magic bytes, not names (P7-36)", () => {
    expect(imageKind(PNG)).toBe("png");
    expect(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(
      imageKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])),
    ).toBe("webp");
    expect(imageKind(Buffer.from("not an image"))).toBeNull();
  });

  it("is never clean when it read nothing", () => {
    const empty = { database: 1, logs: 1, object: 0, download: 0, "model-requests": 1, ocr: 0 };
    expect(vacuousSources(empty)).toEqual(["nothing scanned: object", "nothing scanned: ocr"]);
  });

  it("lets a service hold its own configured secret in its own logs, and nowhere else", async () => {
    const own = (where: string, text: string): Source => ({
      ...src("logs", where, text),
      own: ["imapPassword"],
    });
    const sources = [
      own("logs greenmail", `-Dgreenmail.users=otp:${C.imapPassword}@mail.test`),
      src("logs", "logs agent", `imap login ${C.imapPassword}`),
    ];
    expect((await scanSources(sources, C, async () => "")).hits).toEqual([
      { canary: "imapPassword", where: "logs agent", form: "plain" },
    ]);
  });

  it("OCRs every screenshot the model was sent, not only stored ones (review M1)", async () => {
    const request = JSON.stringify({
      input: [
        { type: "input_image", image_url: `data:image/png;base64,${PNG.toString("base64")}` },
      ],
    });
    const seen: number[] = [];
    const { hits, scanned } = await scanSources(
      [src("model-requests", "llm-mock requests", request)],
      C,
      async (image) => {
        seen.push(image.length);
        return "Signed in as HERON 3CANARY 9PASSWORD";
      },
    );
    expect(seen).toEqual([PNG.length]);
    expect(scanned.ocr).toBe(1);
    expect(hits).toContainEqual({
      canary: "password",
      where: "ocr llm-mock requests image 1",
      form: "ocr",
    });
  });

  it("finds an OTP or PIN stored as a value in the DB or logs, but not inside other numbers (review M2)", async () => {
    const sources = [
      src("database", "postgres", `run\t${C.otp}\tsealed`),
      src("logs", "logs agent", `{"msg":"code","code":"${C.pin}"}`),
      src("logs", "logs web", `at 2026-10-07 18:46:32.${C.pin}+00, took ${C.otp}ms, id=7${C.pin}`),
    ];
    const { hits } = await scanSources(sources, C, async () => "");
    expect(hits.map((h) => `${h.canary}:${h.where}`).sort()).toEqual([
      "otp:postgres",
      "pin:logs agent",
    ]);
  });

  it("reads the logs of every defined service, exited ones included (review M8)", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return Buffer.from(
        args[0] === "config" ? "migrate\ngarage-init\nweb\n" : `log of ${args.at(-1)}`,
      );
    };
    const logs = collectLogs(run, { greenmail: ["imapPassword"] });
    expect(calls[0]).toEqual(["config", "--services"]);
    expect(logs.map((l) => l.where)).toEqual(["logs migrate", "logs garage-init", "logs web"]);
    expect(logs[0]?.bytes.toString()).toBe("log of migrate");
  });
});
