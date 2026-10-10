import type {
  AlertView,
  CaptureBrief,
  SitePreference,
  FolderView,
  NoteBlock,
  NoteSummary,
  RunSummary,
  SettingsView,
  SourceView,
  VaultAuditView,
  VaultItemView,
} from "@mastertutor/contracts";
import type { SessionContext } from "../server/rpc/require-viewer.ts";

export interface NoteRecord {
  note: NoteSummary;
  blocks: NoteBlock[];
  sources: SourceView[];
  /** What capture recorded as lost (sources.meta.mediaLost on the server); none when absent. */
  mediaLost?: number;
}

/** Mutable per-namespace state. Vault items hold field names only; values are never kept. */
export interface FixtureState {
  folders: FolderView[];
  notes: NoteRecord[];
  vault: VaultItemView[];
  audit: VaultAuditView[];
  settings: SettingsView;
  capturePreferences: SitePreference[];
  runCapture: Record<string, { brief: CaptureBrief }>;
  runs: RunSummary[];
  /** What runs.create was given that RunSummary does not carry, by run id. */
  runScope: Record<string, { allowedOrigins: string[]; targetFolderId: string | null }>;
  /** Approvals already decided in this namespace: a second decision is CONFLICT, as live. */
  decidedApprovals: string[];
  alerts: AlertView[];
}

export interface FixtureContext extends SessionContext {
  ns: string;
}
