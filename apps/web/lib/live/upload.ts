import { VIEWPORT, livePath } from "@mastertutor/contracts";

/** Browser-side helper for the run view (F3). Only the user uploads, and only while in control. */
type UploadOutcome = "uploaded" | "no_file_dialog" | "not_in_control" | "signed_out" | "failed";

interface UploadOptions {
  /** Defaults to /live/<runId>/ (through Traefik and ForwardAuth); tests point at n.eko directly. */
  base?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
}

export const MAX_UPLOAD_FILES = 10;

function filesForm(files: readonly File[]): FormData {
  if (files.length === 0 || files.length > MAX_UPLOAD_FILES) {
    throw new RangeError(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
  }
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return form;
}

/** 401 is ForwardAuth's "session ended" (F3 redirects to sign-in); 403 is n.eko's "not the host". */
function outcome(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "uploaded";
  if (status === 422) return "no_file_dialog";
  if (status === 401) return "signed_out";
  if (status === 403) return "not_in_control";
  return "failed";
}

async function post(
  runId: string,
  endpoint: string,
  form: FormData,
  options: UploadOptions,
): Promise<UploadOutcome> {
  const base = options.base ?? livePath(runId);
  try {
    const response = await (options.fetch ?? fetch)(`${base}${endpoint}`, {
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

const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.round(value)));

/** Fills the site's open native file chooser (n.eko upload/dialog). */
export function uploadToFileDialog(
  runId: string,
  files: readonly File[],
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  return post(runId, "api/room/upload/dialog", filesForm(files), options);
}

/** Drops files at a point of the 1280×800 remote screen (n.eko upload/drop). */
export function dropFiles(
  runId: string,
  files: readonly File[],
  point: { x: number; y: number },
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  const form = filesForm(files);
  form.append("x", String(clamp(point.x, VIEWPORT.width)));
  form.append("y", String(clamp(point.y, VIEWPORT.height)));
  return post(runId, "api/room/upload/drop", form, options);
}
