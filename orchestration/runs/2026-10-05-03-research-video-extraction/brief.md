---
run_id: 2026-10-05-03-research-video-extraction
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
---

# Brief: YouTube / video extraction

Research task (web research, no code changes). Today is 2026-10-05. We are building an agentic note-taking web app where an AI agent (using its own Chromium browser via computer use) watches YouTube and other videos and produces faithful notes: exact transcript, timestamps, chapters, plus screenshots of slides/diagrams/code shown on screen.

Find the best 2026 approaches, with sources:
1. Transcript acquisition: YouTube official captions via the player's timedtext/innertube, youtube-transcript-api (Python), yt-dlp subtitles, YouTube Data API captions endpoint (auth limits). Current reliability in 2026 given YouTube anti-bot measures (PO tokens, SABR, IP blocks), and mitigations.
2. When no captions: ASR options — OpenAI transcription models (gpt-4o-transcribe or newer, whisper-1), local faster-whisper / whisper.cpp / WhisperX for word timestamps & diarization. Audio capture by downloading with yt-dlp vs recording tab audio from the browser in Docker (PulseAudio virtual sink, ffmpeg).
3. Visual capture: scene/slide-change detection (PySceneDetect, ffmpeg select='gt(scene,..)', perceptual hashing for dedup), capturing frames from the browser <video> element via canvas or screenshots vs from downloaded video file. Getting frames at specific timestamps.
4. Multimodal video understanding with OpenAI models (sending frames + transcript), and any native video input APIs in 2026.
5. Legal/ToS considerations of downloading YouTube content vs watching in-browser; recommend the safest approach.
6. Other platforms (Vimeo, Coursera/Udemy-style course players behind login, Loom).

Return a concise report (<700 words) with a recommended pipeline, libraries, and source URLs. Flag anything unverified.
