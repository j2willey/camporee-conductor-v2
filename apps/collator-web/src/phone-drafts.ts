import { createDrafts } from "./drafts.ts";

/** The drafts on this phone (#41 PR 4), in localStorage. */
export const drafts = createDrafts(localStorage);
