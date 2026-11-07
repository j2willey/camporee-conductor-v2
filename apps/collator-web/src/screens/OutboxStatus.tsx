import { isScore } from "../offline-data.ts";
import type { OutboxItem } from "../outbox.ts";
import { outbox, useOutboxItems } from "../phone-outbox.ts";
import { ui } from "../ui.ts";

/**
 * What's on this phone and not yet in the box (#41 PR 2): scores and added Teams waiting to send (#41 PR 3),
 * and any the box refused, which stay until the Judge discards them. Nothing shows when everything has
 * been sent.
 */
export function OutboxStatus() {
  const items = useOutboxItems();
  const waiting = items.filter((i) => i.refused === undefined);
  const refused = items.filter((i) => i.refused !== undefined);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {waiting.length > 0 && (
        <div
          className={`${ui.warning} flex items-center justify-between gap-2`}
          role="status"
          aria-label="Waiting to send"
        >
          <p>
            {waitingText(waiting)}
            {!outbox.kept() && " Keep this page open until they've gone."}
          </p>
          <button
            type="button"
            className={ui.link}
            onClick={() => void outbox.flush()}
          >
            Send now
          </button>
        </div>
      )}
      {refused.map((item) => (
        <div key={item.id} className={ui.error} role="alert">
          <p>
            The box refused {item.label}: {item.refused}
          </p>
          <p className="mt-1">
            {isScore(item)
              ? "Score it again if it should count, then discard this one."
              : "Add it again if it's needed, then discard this one."}
          </p>
          <button
            type="button"
            className={`${ui.link} mt-1`}
            onClick={() => outbox.discard(item.id)}
          >
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}

/** "2 scores waiting to send.", or "3 waiting to send." when added Teams are among them. */
function waitingText(waiting: readonly OutboxItem[]): string {
  const n = waiting.length;
  if (!waiting.every(isScore)) return `${n} waiting to send.`;
  return n === 1 ? "1 score waiting to send." : `${n} scores waiting to send.`;
}
