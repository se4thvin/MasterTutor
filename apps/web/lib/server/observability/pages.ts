import {
  OBSERVABILITY_SESSION_PATH,
  OBSERVABILITY_UI_PATH,
  OBSERVE_UI_SESSION,
} from "@mastertutor/contracts";

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title></head><body>${body}</body></html>`;
const script = (code: string) => `<script>${code.replaceAll("<", "\\u003c")}</script>`;

/**
 * On the obs host: OpenObserve's UI shows its own login unless its client-side identity record
 * exists (spec §12; B1 confirmed the record and that no OpenObserve cookie is needed). This writes
 * that record (an identity, no secret), then opens the UI. Every UI request is authenticated by
 * ForwardAuth, never by this record.
 */
export function enterPage(): string {
  const record = Buffer.from(JSON.stringify(OBSERVE_UI_SESSION.identity)).toString("base64");
  return page(
    "Opening dashboards…",
    script(
      `try{${OBSERVE_UI_SESSION.storage}.setItem(${JSON.stringify(OBSERVE_UI_SESSION.key)},${JSON.stringify(record)})}catch(e){}location.replace(${JSON.stringify(OBSERVABILITY_UI_PATH)})`,
    ),
  );
}

/**
 * On the app host: hands the owner to the obs host with a one-minute ticket, posted (never in a
 * URL, so it stays out of logs and history). Without scripts the button does the same.
 */
export function handoffPage(obsOrigin: string, ticket: string): string {
  if (!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(obsOrigin)) throw new TypeError("Invalid obs origin");
  if (!/^[A-Za-z0-9._-]+$/.test(ticket)) throw new TypeError("Invalid ticket");
  return page(
    "Opening dashboards…",
    `<form method="post" action="${obsOrigin}${OBSERVABILITY_SESSION_PATH}"><input type="hidden" name="ticket" value="${ticket}"><noscript><button type="submit">Open dashboards</button></noscript></form>${script("document.forms[0].submit()")}`,
  );
}
