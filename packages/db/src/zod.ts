import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { Origin } from "@mastertutor/contracts";
import { z } from "zod";
import * as t from "./schema/index.ts";

export const selectUserSchema = createSelectSchema(t.user);
export const insertUserSchema = createInsertSchema(t.user);
export type UserRow = z.infer<typeof selectUserSchema>;
export const selectSessionSchema = createSelectSchema(t.session);
export const insertSessionSchema = createInsertSchema(t.session);
export type SessionRow = z.infer<typeof selectSessionSchema>;
export const selectAccountSchema = createSelectSchema(t.account);
export const insertAccountSchema = createInsertSchema(t.account);
export type AccountRow = z.infer<typeof selectAccountSchema>;
export const selectVerificationSchema = createSelectSchema(t.verification);
export const insertVerificationSchema = createInsertSchema(t.verification);
export type VerificationRow = z.infer<typeof selectVerificationSchema>;

export const selectWorkspaceSchema = createSelectSchema(t.workspaces);
export const insertWorkspaceSchema = createInsertSchema(t.workspaces);
export type WorkspaceRow = z.infer<typeof selectWorkspaceSchema>;
export const selectWorkspaceMemberSchema = createSelectSchema(t.workspaceMembers);
export const insertWorkspaceMemberSchema = createInsertSchema(t.workspaceMembers);
export type WorkspaceMemberRow = z.infer<typeof selectWorkspaceMemberSchema>;
export const selectSettingsSchema = createSelectSchema(t.settings);
export const insertSettingsSchema = createInsertSchema(t.settings, {
  defaultAllowedOrigins: z.array(Origin).optional(),
});
export type SettingsRow = z.infer<typeof selectSettingsSchema>;
export const selectBrowserSlotSchema = createSelectSchema(t.browserSlots);
export const insertBrowserSlotSchema = createInsertSchema(t.browserSlots);
export type BrowserSlotRow = z.infer<typeof selectBrowserSlotSchema>;

export const selectFolderSchema = createSelectSchema(t.folders);
export const insertFolderSchema = createInsertSchema(t.folders);
export type FolderRow = z.infer<typeof selectFolderSchema>;
export const selectSourceSchema = createSelectSchema(t.sources);
export const insertSourceSchema = createInsertSchema(t.sources, { origin: Origin });
export type SourceRow = z.infer<typeof selectSourceSchema>;
export const selectNoteSchema = createSelectSchema(t.notes);
export const insertNoteSchema = createInsertSchema(t.notes);
export type NoteRow = z.infer<typeof selectNoteSchema>;
export const selectNoteBlockSchema = createSelectSchema(t.noteBlocks);
export const insertNoteBlockSchema = createInsertSchema(t.noteBlocks);
export type NoteBlockRow = z.infer<typeof selectNoteBlockSchema>;
export const selectAssetSchema = createSelectSchema(t.assets);
export const insertAssetSchema = createInsertSchema(t.assets);
export type AssetRow = z.infer<typeof selectAssetSchema>;

export const selectRunSchema = createSelectSchema(t.runs);
export const insertRunSchema = createInsertSchema(t.runs, { allowedOrigins: z.array(Origin) });
export type RunRow = z.infer<typeof selectRunSchema>;
export const selectRunStepSchema = createSelectSchema(t.runSteps);
export const insertRunStepSchema = createInsertSchema(t.runSteps);
export type RunStepRow = z.infer<typeof selectRunStepSchema>;
export const selectRunTranscriptSchema = createSelectSchema(t.runTranscript);
export const insertRunTranscriptSchema = createInsertSchema(t.runTranscript);
export type RunTranscriptRow = z.infer<typeof selectRunTranscriptSchema>;
export const selectRunEventSchema = createSelectSchema(t.runEvents);
export const insertRunEventSchema = createInsertSchema(t.runEvents);
export type RunEventRow = z.infer<typeof selectRunEventSchema>;
export const selectApprovalSchema = createSelectSchema(t.approvals);
export const insertApprovalSchema = createInsertSchema(t.approvals);
export type ApprovalRow = z.infer<typeof selectApprovalSchema>;
export const selectDownloadSchema = createSelectSchema(t.downloads);
export const insertDownloadSchema = createInsertSchema(t.downloads);
export type DownloadRow = z.infer<typeof selectDownloadSchema>;

export const selectVaultItemSchema = createSelectSchema(t.vaultItems);
export const insertVaultItemSchema = createInsertSchema(t.vaultItems, { origin: Origin });
export type VaultItemRow = z.infer<typeof selectVaultItemSchema>;
export const selectVaultSecretSchema = createSelectSchema(t.vaultSecrets);
export const insertVaultSecretSchema = createInsertSchema(t.vaultSecrets);
export type VaultSecretRow = z.infer<typeof selectVaultSecretSchema>;
export const selectVaultGrantSchema = createSelectSchema(t.vaultGrants);
export const insertVaultGrantSchema = createInsertSchema(t.vaultGrants, { origin: Origin });
export type VaultGrantRow = z.infer<typeof selectVaultGrantSchema>;
export const selectOtpCodeSchema = createSelectSchema(t.otpCodes);
export const insertOtpCodeSchema = createInsertSchema(t.otpCodes);
export type OtpCodeRow = z.infer<typeof selectOtpCodeSchema>;
export const selectBrowserSessionSchema = createSelectSchema(t.browserSessions);
export const insertBrowserSessionSchema = createInsertSchema(t.browserSessions, { origin: Origin });
export type BrowserSessionRow = z.infer<typeof selectBrowserSessionSchema>;
export const selectVaultAuditSchema = createSelectSchema(t.vaultAudit);
export const insertVaultAuditSchema = createInsertSchema(t.vaultAudit, {
  origin: Origin.nullable().optional(),
});
export type VaultAuditRow = z.infer<typeof selectVaultAuditSchema>;

export const selectBenchmarkSchema = createSelectSchema(t.benchmarks);
export const insertBenchmarkSchema = createInsertSchema(t.benchmarks, {
  allowedOrigins: z.array(Origin),
});
export type BenchmarkRow = z.infer<typeof selectBenchmarkSchema>;
export const selectBenchmarkRunSchema = createSelectSchema(t.benchmarkRuns);
export const insertBenchmarkRunSchema = createInsertSchema(t.benchmarkRuns);
export type BenchmarkRunRow = z.infer<typeof selectBenchmarkRunSchema>;
