export type MockOutput =
  | {
      type: "computer";
      actions: Array<Record<string, unknown>>;
      safetyChecks?: Array<{ id: string; code: string; message: string }>;
    }
  | { type: "click_named"; name: string }
  | { type: "function"; name: string; args: Record<string, unknown> }
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
}

export interface MockTurn {
  outputs?: MockOutput[];
  error?: { status: number; code?: string; message?: string };
  usage?: { input?: number; cached?: number; output?: number };
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
