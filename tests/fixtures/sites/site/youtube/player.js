/* global document, fetch */
// The fake YouTube player: the CC button loads its JSON3 track the way the real player does.
(() => {
  const button = document.querySelector(".ytp-subtitles-button");
  const video = document.querySelector("video");
  const box = document.querySelector(".caption-window");
  if (!button || !video) return;
  const track = button.dataset.track;
  // YouTube keeps a loaded track: toggling CC off and on does not refetch it (preflight Q5).
  const cache = button.dataset.cache === "true";
  let events = null;
  const load = async () => {
    if (events && cache) return;
    const res = await fetch(track, { credentials: "include" });
    events = (await res.json()).events ?? [];
  };
  button.addEventListener("click", async () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    if (!on) {
      box.textContent = "";
      return;
    }
    await load();
  });
  video.addEventListener("timeupdate", () => {
    if (button.getAttribute("aria-pressed") !== "true" || !events) return;
    const ms = video.currentTime * 1000;
    const ev = events.find(
      (e) => e.segs && ms >= e.tStartMs && ms < e.tStartMs + (e.dDurationMs ?? 0),
    );
    box.textContent = ev ? ev.segs.map((s) => s.utf8).join("") : "";
  });
  // A viewer who keeps CC on: the player loads the track as the page opens.
  if (button.dataset.autoplayCc === "true") button.click();
})();
