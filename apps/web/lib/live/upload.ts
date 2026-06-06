import { MAX_UPLOAD_BYTES, VIEWPORT, livePath } from "@mastertutor/contracts";

/**
 * Browser-side helper for the run view (F3). Only the user uploads, and only while in control.
 * v1 uploads by drop only: n.eko 3.1.6 detects a native file chooser but cannot fill it in this
 * image (its xdotool helper fails), so there is no file-chooser upload.
 */
type UploadOutcome = "uploaded" | "too_large" | "not_in_control" | "signed_out" | "failed";

interface UploadOptions {
  /** Defaults to /live/<runId>/ (through Traefik and ForwardAuth); tests point at n.eko directly. */
  base?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export const MAX_UPLOAD_FILES = 10;

/** 401 is ForwardAuth's "session ended" (F3 redirects to sign-in); 403 is n.eko's "not the host". */
function outcome(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "uploaded";
  if (status === 401) return "signed_out";
  if (status === 403) return "not_in_control";
  return "failed";
}

const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.round(value)));

async function post(runId: string, form: FormData, options: UploadOptions): Promise<UploadOutcome> {
  const base = options.base ?? livePath(runId);
  try {
    const response = await (options.fetch ?? fetch)(`${base}api/room/upload/drop`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: options.headers,
    });
    await response.body?.cancel();
    return outcome(response.status);
  } catch {
    return "failed";
  }
}

/** Drops files at a point of the 1280×800 remote screen (n.eko upload/drop). */
export function dropFiles(
  runId: string,
  files: readonly File[],
  point: { x: number; y: number },
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  if (files.length === 0 || files.length > MAX_UPLOAD_FILES) {
    throw new RangeError(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
  }
  const bytes = files.reduce((total, file) => total + file.size, 0);
  if (bytes > MAX_UPLOAD_BYTES) return Promise.resolve("too_large");
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  form.append("x", String(clamp(point.x, VIEWPORT.width)));
  form.append("y", String(clamp(point.y, VIEWPORT.height)));
  return post(runId, form, options);
}
