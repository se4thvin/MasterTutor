/**
 * I1: n.eko's ICE-TCP path can accept the browser's connection and never answer its checks, so a
 * WebRTC session sometimes decodes no video at all (group-2-report.md §8). The live view watches
 * for the first decoded frame and says so, with Retry, instead of waiting forever. Neither an ICE
 * restart nor fresh sessions recover a stuck slot (§10), so nothing is retried automatically.
 */

/** How long a session may take to decode its first frame before the view says it has none. */
export const NO_VIDEO_MS = 6_000;
const CHECK_MS = 250;

type VideoResult = "video" | "no_video";

/**
 * The embed's document, null while it has none yet, undefined when it cannot be inspected (another
 * origin): such an embed is never judged.
 */
function documentOf(frame: HTMLIFrameElement | null): Document | null | undefined {
  if (!frame) return null;
  try {
    return frame.contentDocument ?? undefined;
  } catch {
    return undefined;
  }
}

/** Reports once: "video" at the first decoded frame, "no_video" after `timeoutMs` without one. */
export function watchVideo(
  frame: () => HTMLIFrameElement | null,
  onResult: (result: VideoResult) => void,
  timeoutMs = NO_VIDEO_MS,
): () => void {
  const started = Date.now();
  let done = false;
  const finish = (result: VideoResult) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    onResult(result);
  };
  const timer = setInterval(() => {
    const document = documentOf(frame());
    if (document === undefined) return finish("video");
    const video = document?.querySelector("video");
    if (video && video.videoWidth > 0) return finish("video");
    if (Date.now() - started >= timeoutMs) finish("no_video");
  }, CHECK_MS);
  return () => {
    done = true;
    clearInterval(timer);
  };
}
