#!/usr/bin/env python3
"""Persist a subagent run (brief + final report) from its JSONL transcript into a run folder.

Usage: persist_run.py <transcript.jsonl> <run_dir> [--agent-type T] [--phase P] [--depends-on a,b] [--brief-only]

brief.md  = first user message (the prompt sent to the subagent)
report.md = last non-empty assistant text (the subagent's final reply)
"""
import argparse, json, os, sys

def texts(path):
    with open(path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = rec.get("message") or {}
            content = msg.get("content")
            text = content if isinstance(content, str) else "".join(
                c.get("text", "") for c in (content or []) if isinstance(c, dict) and c.get("type") == "text")
            if text.strip():
                yield rec.get("type"), text.strip()

def prompt_and_final(path):
    """Return (first user prompt, final reply). The final reply may span several
    consecutive assistant messages (output-length continuation), so collect every
    assistant text block after the last tool call/result."""
    brief, tail = None, []
    with open(path) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = rec.get("message") or {}
            content = msg.get("content")
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
            kinds = {b.get("type") for b in blocks if isinstance(b, dict)}
            if rec.get("type") == "user":
                if brief is None and "text" in kinds:
                    brief = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
                if "tool_result" in kinds:
                    tail = []
            elif rec.get("type") == "assistant":
                if "tool_use" in kinds:
                    tail = []
                text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
                if text.strip():
                    tail.append(text)
    return brief, ("".join(tail).strip() or None)

def frontmatter(run_id, args, status):
    deps = f"[{', '.join(args.depends_on.split(','))}]" if args.depends_on else "[]"
    return (f"---\nrun_id: {run_id}\ndate: {run_id[:10]}\nagent_type: {args.agent_type}\n"
            f"phase: {args.phase}\nstatus: {status}\ndepends_on: {deps}\n---\n\n")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("transcript"); p.add_argument("run_dir")
    p.add_argument("--agent-type", default="general-purpose")
    p.add_argument("--phase", default="research")
    p.add_argument("--depends-on", default="")
    p.add_argument("--brief-only", action="store_true")
    args = p.parse_args()

    brief, report = prompt_and_final(args.transcript)
    if not brief:
        sys.exit(f"no prompt found in {args.transcript}")

    run_id = os.path.basename(os.path.normpath(args.run_dir))
    os.makedirs(args.run_dir, exist_ok=True)
    status = "running" if args.brief_only else "completed"
    with open(os.path.join(args.run_dir, "brief.md"), "w") as f:
        f.write(frontmatter(run_id, args, status) + brief + "\n")
    if not args.brief_only:
        if not report:
            sys.exit(f"no final reply found in {args.transcript}")
        with open(os.path.join(args.run_dir, "report.md"), "w") as f:
            f.write(frontmatter(run_id, args, status) + report + "\n")
    print(f"persisted {run_id} ({status})")

if __name__ == "__main__":
    main()
