import { OBSERVABILITY_PATH, OBSERVE_UI_SESSION } from "@mastertutor/contracts";

/**
 * OpenObserve's UI shows its own login unless its client-side identity record exists (spec §12;
 * Track B's B1 confirmed the record and that no OpenObserve cookie is needed). This page writes
 * that record (an identity, no secret), then opens the UI. Every request the UI makes is
 * authenticated by the ForwardAuth header, never by this record.
 */
export function enterPage(): string {
  const record = Buffer.from(JSON.stringify(OBSERVE_UI_SESSION.identity)).toString("base64");
  const script = `try{${OBSERVE_UI_SESSION.storage}.setItem(${JSON.stringify(OBSERVE_UI_SESSION.key)},${JSON.stringify(record)})}catch(e){}location.replace(${JSON.stringify(`${OBSERVABILITY_PATH}web/`)})`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening dashboards…</title></head><body><script>${script.replaceAll("<", "\\u003c")}</script></body></html>`;
}
