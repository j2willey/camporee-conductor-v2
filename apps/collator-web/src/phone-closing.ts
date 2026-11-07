import { createClosing } from "./closing.ts";

/** Close Game state on this phone (#41 PR 6), in localStorage. */
export const closing = createClosing(localStorage);
