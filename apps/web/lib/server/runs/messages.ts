/** User-facing run refusals, shared by the live services and the fixture router (one wording). */
export const RUN_MESSAGES = {
  killSwitchOn: "The kill switch is on. Turn it off to start a run.",
  runFinished: "The run has already finished.",
  approvalDecided: "This approval was already decided.",
} as const;
