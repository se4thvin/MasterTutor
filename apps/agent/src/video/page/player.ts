/**
 * Player helpers sent to the page through B1's default isolated world (spec §8), which never holds
 * library globals. Each function must stay self-contained: it is sent as source text.
 */
export interface VideoState {
  found: boolean;
  duration: number;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  ended: boolean;
  /** YouTube is showing an ad in the player (its duration is the ad's, not the content's). */
  ad: boolean;
  /** The largest visible video, in document coordinates (CSS px); it feeds captureMaskedRegion. */
  rect: { x: number; y: number; width: number; height: number } | null;
}

export function pageVideoState(): VideoState {
  const videos = [...document.querySelectorAll("video")].filter(
    (v) => v.getBoundingClientRect().width > 0,
  );
  const video = videos.sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  )[0];
  if (!video)
    return {
      found: false,
      duration: 0,
      currentTime: 0,
      paused: true,
      muted: false,
      ended: false,
      ad: false,
      rect: null,
    };
  const r = video.getBoundingClientRect();
  const rect =
    r.width > 0 && r.height > 0
      ? { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
      : null;
  return {
    found: true,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    currentTime: video.currentTime,
    paused: video.paused,
    muted: video.muted,
    ended: video.ended,
    ad: !!video.closest(".html5-video-player")?.classList.contains("ad-showing"),
    rect,
  };
}

/** Scrolls the main video into view and waits (≤ 10 s) for its metadata. */
export async function pageVideoReveal(): Promise<{ found: boolean; duration: number }> {
  const video = [...document.querySelectorAll("video")].sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  )[0];
  if (!video) return { found: false, duration: 0 };
  video.scrollIntoView({ block: "center", behavior: "instant" });
  if (video.readyState < 1)
    await new Promise((resolve) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      video.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 10_000);
    });
  return { found: true, duration: Number.isFinite(video.duration) ? video.duration : 0 };
}

/** Seeks and waits for the new frame to paint; false when the video cannot seek (≤ 5 s). */
export async function pageVideoSeek(t: number): Promise<boolean> {
  const video = [...document.querySelectorAll("video")].sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  )[0];
  if (!video) return false;
  const seeked = new Promise<boolean>((resolve) => {
    video.addEventListener("seeked", () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 5_000);
  });
  video.currentTime = t;
  if (!(await seeked)) return false;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return true;
}

/**
 * Plays at 1× with sound (transcription records the slot's audio output). False when the video
 * will not play within 10 s: play() stays pending on a stalled stream (B4 review I3).
 */
export async function pageVideoPlay(): Promise<boolean> {
  const video = [...document.querySelectorAll("video")].sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  )[0];
  if (!video) return false;
  video.playbackRate = 1;
  video.muted = false;
  if (video.volume === 0) video.volume = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      video.play().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 10_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function pageVideoPause(): void {
  for (const video of document.querySelectorAll("video")) video.pause();
}

export function pageCaptionsState(): { present: boolean; pressed: boolean; disabled: boolean } {
  const button = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button || button.offsetParent === null)
    return { present: false, pressed: false, disabled: false };
  return {
    present: true,
    pressed: button.getAttribute("aria-pressed") === "true",
    disabled: button.getAttribute("aria-disabled") === "true",
  };
}

export function pageCaptionsClick(): boolean {
  const button = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) return false;
  button.click();
  return true;
}

/**
 * The ytInitialData script (≤ 5 MB) and the description text, for chapters; the content's length
 * from ytInitialPlayerResponse (an ad in the player never changes it).
 */
export function pageYoutubeData(): {
  initialDataScript: string | null;
  description: string | null;
  lengthSeconds: number | null;
  /** The video the inline player response describes: after SPA navigation, not the one on screen. */
  videoId: string | null;
} {
  const script = [...document.scripts].find((s) => (s.textContent ?? "").includes("ytInitialData"));
  const text = script?.textContent ?? null;
  const description = document.querySelector<HTMLElement>(
    "#description, ytd-text-inline-expander, #description-inline-expander",
  );
  const player = [...document.scripts].find((s) =>
    (s.textContent ?? "").includes("ytInitialPlayerResponse"),
  );
  const length = /"lengthSeconds"\s*:\s*"?(\d{1,6})"?/.exec(player?.textContent ?? "");
  const id = /"videoId"\s*:\s*"([\w-]{1,32})"/.exec(player?.textContent ?? "");
  return {
    initialDataScript: text && text.length <= 5_000_000 ? text : null,
    description: description ? description.innerText.slice(0, 20_000) : null,
    lengthSeconds: length?.[1] && Number(length[1]) > 0 ? Number(length[1]) : null,
    videoId: id?.[1] ?? null,
  };
}
