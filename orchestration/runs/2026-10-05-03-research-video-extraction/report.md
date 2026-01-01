---
run_id: 2026-10-05-03-research-video-extraction
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I've finished the research. My recommended pipeline does everything inside the agent's real Chromium session. It captures the captions the YouTube player fetches itself, transcribes recorded tab audio only when there are no captions, and takes screenshots when the slide changes. The research was web search only and nothing was tested. Items marked **[unverified]** come from third-party pages or search summaries, not official docs.

## 1. Getting the transcript (YouTube)

- **YouTube Data API `captions.download`** only works for videos the signed-in user owns; anything else returns 403, so it's no use here. https://developers.google.com/youtube/v3/docs/captions/download
- **youtube-transcript-api** (Python) gets blocked on cloud IPs (AWS, GCP, Azure). Errors like `RequestBlocked` and `IpBlocked` can appear on the very first call. The maintainer recommends rotating residential proxies, since datacenter and static proxies get banned. It still works from home connections. https://pypi.org/project/youtube-transcript-api/ , https://github.com/jdepoix/youtube-transcript-api/issues/511
- **yt-dlp**: in 2026 YouTube requires a proof-of-origin token (PO token) for video, player and subtitle requests. That means running the `bgutil-ytdlp-pot-provider` plugin plus fresh cookies. SABR (YouTube's newer streaming format) breaks some downloads even with Premium cookies. https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide , https://github.com/yt-dlp/yt-dlp/issues/14390
- **Recommended:** use the real player in the agent's browser and turn on captions. Then capture the player's own `/api/timedtext` response through the Chrome DevTools Protocol (CDP) `Network` events, using `fmt=json3`. The real player already handles the PO token and cookies, so there's nothing to forge. Chapters come from the page's `ytInitialData` or the description timestamps. **[unverified as a pattern: I found no source for it; it's my inference from how the player works.]** Treat yt-dlp `--write-subs --skip-download` as a fallback.

## 2. Speech-to-text when there are no captions

- **OpenAI:** the official reference lists `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `gpt-4o-transcribe-diarize`. The diarize model returns `diarized_json` (speaker labels plus segment times) and needs `chunking_strategy` for audio over 30s. The reference also mentions `gpt-transcribe`. Third-party posts say it launched on 2026-07-28 as the new default **[unverified]**. Only `whisper-1` documents word-level timestamps. https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create , https://community.openai.com/t/introducing-gpt-4o-transcribe-diarize-now-available-in-the-audio-api/1362933
- **Local:** WhisperX chains faster-whisper, wav2vec2 alignment and pyannote diarization. It gives about ±50ms word timestamps (vendor claim) and is the best fit for exact timestamps. whisper.cpp suits CPU-only boxes. https://github.com/m-bain/whisperX
- **Getting the audio:** the safer route is recording the tab in Docker. Chromium plays into a PulseAudio null sink, and `ffmpeg -f pulse -i sink.monitor` records it. Playback timestamps then line up with the video's `currentTime`, and you can play at 1.5–2x to save time if accuracy holds. Downloading with yt-dlp is faster but hits the PO-token and ToS problems.

## 3. Screenshots of slides, diagrams and code

- **Taking frames:** pause, seek with `video.currentTime = t`, wait for the `seeked` event, then use CDP `Page.captureScreenshot` clipped to the video element's box. A `canvas.drawImage(video)` grab may be "tainted" by cross-origin media and refuse to export. **[unverified for YouTube]** DRM-protected (Widevine) players such as some Udemy courses give black frames. That breaks both screenshots and canvas, so fall back to transcript-only notes.
- **Detecting slide changes:** run PySceneDetect `ContentDetector` / `AdaptiveDetector` on a low-fps recording, or take frames every 1–2s. Then drop near-duplicates with perceptual hashing (`imagehash` pHash, Hamming distance ≤ 6–8). If you have a file, `ffmpeg -vf "select='gt(scene,0.3)'"` does the same job. Keep the last frame before each change, because it shows the fully built slide. https://www.scenedetect.com/

## 4. Multimodal models

- OpenAI has **no native video input**. A request for it in the Responses API was reportedly closed as "not planned" **[unverified]**. Send deduplicated keyframes as images, each labeled with its timestamp and paired with that stretch of transcript. Do this per chapter, so notes cite `[mm:ss]`. https://github.com/openai/openai-node/issues/1778
- **Gemini** accepts YouTube URLs directly and answers timestamp questions. The feature is in preview, limited to 8 hours of video a day, and costs nothing for now. That makes it a strong cross-check or fallback. https://ai.google.dev/gemini-api/docs/generate-content/video-understanding

## 5. Legal / ToS

YouTube's terms forbid downloading content and accessing the service by automated means unless YouTube permits it. https://www.youtube.com/static?template=terms

- **Safest approach:** an agent that watches in a browser, ideally signed in as the user and acting for that user. It reads captions the player already shows and takes screenshots for the user's private notes. Store no media, only text and the selected frames.
- This is lower risk, not zero: automated access is still a ToS grey area. Avoid yt-dlp downloads and proxy rotation in production. Have counsel review.

## 6. Other platforms

- **Vimeo:** the `/videos/{id}/texttracks` API only works for the video's owner. For other videos, use the same capture-the-player's-network-traffic method. https://help.vimeo.com/hc/en-us/articles/17480150130833
- **Loom:** public share pages load transcripts through Loom's GraphQL API **[unofficial]**.
- **Coursera / Udemy:** reuse the user's logged-in browser profile. Pick up the WebVTT caption tracks from network traffic, and expect DRM to block screenshots.

## Recommended pipeline

Agent opens the URL in its Chromium →
1. Capture the player's caption responses (YouTube `timedtext`, other sites' VTT) and read chapters from page data.
2. If there are no captions: play the video, record the PulseAudio sink, run gpt-4o-transcribe-diarize or WhisperX.
3. Record or sample the video area, detect changes with PySceneDetect, dedupe with pHash, then re-seek and take clean CDP screenshots at the chosen timestamps.
4. Send each chapter's transcript plus its keyframes to an OpenAI vision model to write the notes. Optionally cross-check with Gemini using the YouTube URL.

**Libraries:** Playwright/CDP, PySceneDetect, imagehash, ffmpeg, whisperX / faster-whisper, openai, plus yt-dlp and youtube-transcript-api as dev fallbacks only.
