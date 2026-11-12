// The timer for stopwatch fields (#41 PR 4). It keeps the time Start was pressed, not a running count, so
// a locked screen, a background tab or a reload loses nothing: the state goes into the form's draft.
// Stop writes whole seconds as m:ss, which packages/scoring reads (stopwatchSeconds).

export interface TimerState {
  /** When it was last started (ms since the epoch), or null while stopped. */
  runningSince: number | null;
  /** Time counted before the last Start. */
  elapsedMs: number;
}

export const STOPPED: TimerState = { runningSince: null, elapsedMs: 0 };

export const elapsedMs = (timer: TimerState, now: number): number =>
  timer.elapsedMs +
  (timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince));

/** Start, or carry on from where it stopped. Pressing Start while it runs changes nothing. */
export const startTimer = (timer: TimerState, now: number): TimerState =>
  timer.runningSince === null ? { ...timer, runningSince: now } : timer;

export const stopTimer = (timer: TimerState, now: number): TimerState =>
  timer.runningSince === null
    ? timer
    : { runningSince: null, elapsedMs: elapsedMs(timer, now) };

export const resetTimer = (): TimerState => STOPPED;

/** Whole seconds as m:ss, or h:mm:ss from an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
