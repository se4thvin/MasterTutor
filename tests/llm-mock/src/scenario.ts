export type MockOutput =
  | {
      type: "computer";
      actions: Array<Record<string, unknown>>;
      safetyChecks?: Array<{ id: string; code: string; message: string }>;
    }
  /** A click on the element read_page named, then any further actions in the same call. */
  | { type: "click_named"; name: string; then?: Array<Record<string, unknown>> }
  /** A computer_call in the single-`action` shape some model versions emit instead of `actions`. */
  | { type: "computer_single"; action: Record<string, unknown> }
  /** A reasoning item, as returned when reasoning effort is above none. */
  | { type: "reasoning"; text?: string }
  | { type: "function"; name: string; args: Record<string, unknown> }
  /** A fill_credential call whose target is the ref of the first read_page element named `name…`. */
  | { type: "fill_named"; alias: string; field: string; name: string }
  | {
      type: "turn";
      status: "continue" | "done" | "need_human";
      reason: string;
      needHuman?: "captcha" | "takeover" | null;
      plan?: Array<{ text: string; done: boolean }> | null;
    };

export interface MockRequestBody {
  model?: string;
  previous_response_id?: string | null;
  store?: boolean;
  include?: string[];
  input?: unknown;
  tools?: Array<{ type: string; name?: string }>;
  text?: { format?: { name?: string } };
  instructions?: string;
  [key: string]: unknown;
}

export interface RecordedRequest {
  scenario: string | null;
  turn: number | null;
  body: MockRequestBody;
  at: number;
  /** Request path, for the data-policy guard (only allowlisted OpenAI endpoints). */
  path: string;
}

export interface MockTurn {
  outputs?: MockOutput[];
  error?: { status: number; code?: string; message?: string };
  usage?: { input?: number; cached?: number; cacheWrite?: number; output?: number };
  /** Assertions on the request that reached this turn; a throw becomes a 418 and a recorded failure. */
  check?(request: RecordedRequest): void;
  /** Delays the answer, for example to take over while the model "thinks". */
  hold?(): Promise<void>;
}

export interface Scenario {
  name: string;
  turns: MockTurn[];
  compaction?: Record<string, unknown>;
}
