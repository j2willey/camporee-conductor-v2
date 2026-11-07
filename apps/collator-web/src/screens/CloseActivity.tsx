import type {
  JudgeActivity,
  JudgeIdentity,
} from "@camporee-conductor/collator/types";
import { useState } from "react";
import { api, ApiError, errorMessage, newId, wasRefused } from "../api.ts";
import type { Closed } from "../closing.ts";
import { closing } from "../phone-closing.ts";
import { useOutboxItems } from "../phone-outbox.ts";
import { ui } from "../ui.ts";

/**
 * "I'm done" for an Activity (#41 PR 6; v1's Close Game). The box is told every score this phone saved
 * here, and says whether it has them all; Officials see it. It needs the box: anything for this Activity
 * still waiting to send goes first. Scoring here again reopens it.
 */
export function CloseActivity({
  activity,
  judge,
}: {
  activity: JudgeActivity;
  judge: JudgeIdentity;
}) {
  const [closed, setClosed] = useState(() =>
    closing.closure(judge.id, activity.id),
  );
  const [problem, setProblem] = useState<{
    refused: boolean;
    message: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const waiting = useOutboxItems().filter(
    (i) =>
      i.refused === undefined &&
      (i.body as { activityId?: string }).activityId === activity.id,
  ).length;

  if (closed) {
    return (
      <div
        className={closed.missing > 0 ? ui.warning : ui.success}
        role="status"
      >
        <p>{closedText(closed, activity.title)}</p>
        <button
          className={`${ui.link} mt-1`}
          onClick={() => {
            closing.reopen(judge.id, activity.id);
            setClosed(undefined);
          }}
        >
          Reopen
        </button>
      </div>
    );
  }

  const close = async () => {
    setSending(true);
    setProblem(null);
    const scoreIds = closing.scoreIds(judge.id, activity.id);
    const closureId = newId();
    try {
      const answer = await api.putClosure(closureId, {
        judge,
        activityId: activity.id,
        scoreIds,
        phoneCreatedAt: new Date().toISOString(),
      });
      const done = {
        closureId,
        scoreCount: scoreIds.length,
        missing: answer.missing.length,
      };
      closing.closed(judge.id, activity.id, done);
      setClosed(done);
    } catch (e) {
      setProblem({
        refused: wasRefused(e),
        message:
          e instanceof ApiError && !e.refused
            ? "Can't reach the scoring box. Close it once you're back in range."
            : errorMessage(e),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-stone-200 pt-4">
      {waiting > 0 ? (
        <p className={ui.note} role="status">
          {waiting === 1
            ? "1 of your scores here is still waiting to send."
            : `${waiting} of your scores here are still waiting to send.`}{" "}
          Close {activity.title} once they've gone.
        </p>
      ) : (
        <button
          className={ui.buttonQuiet}
          disabled={sending}
          onClick={() => void close()}
        >
          {sending ? "Closing…" : `I'm done: close ${activity.title}`}
        </button>
      )}
      {problem && (
        <p
          className={problem.refused ? ui.error : ui.note}
          role={problem.refused ? "alert" : "status"}
        >
          {problem.message}
        </p>
      )}
    </div>
  );
}

/** What a closure says on the phone. */
function closedText(closed: Closed, title: string): string {
  const { scoreCount: n, missing } = closed;
  if (missing > 0)
    return `Closed, but the box is missing ${missing} of your ${n} scores here. Tell an Official.`;
  if (n === 0) return `Closed. You didn't score anything at ${title}.`;
  if (n === 1) return `Closed. The box has your score at ${title}.`;
  return `Closed. The box has all ${n} of your scores at ${title}.`;
}
