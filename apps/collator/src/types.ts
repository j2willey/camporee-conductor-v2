// What the Collator's web app shares with the API (#40 PR 2). Types, plus the plain constants in headers.ts:
// nothing here pulls server code into the browser.
export { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
export type { SignedInOfficial } from "./app.ts";
export type {
  JudgeActivity,
  JudgeEvent,
  JudgeField,
  JudgeLabels,
} from "./judge-event.ts";
export type {
  EntrantName,
  OfficialActivity,
  OfficialEvent,
} from "./official-view.ts";
export type {
  Group,
  GroupSubmission,
  JudgeIdentity,
  Roster,
  ScoreSubmission,
  Team,
  TeamSubmission,
} from "./roster-and-scores.ts";
