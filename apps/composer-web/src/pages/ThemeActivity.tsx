import type { Activity } from "@camporee-conductor/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { activityChanges } from "../activity-changes.ts";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { Card } from "./editing.tsx";
import { ErrorMessage } from "./ErrorMessage.tsx";
import { useAiUndo } from "./AiUndo.tsx";
import { ProposalReview } from "./ProposalReview.tsx";

/**
 * Theme this Activity with AI (ADR-0030 notes, #103 PR 3; v1's `theme-game`): a rewrite for the Event's theme,
 * shown as a change to accept or discard. It waits until the page has no unsaved changes.
 */
export function ThemeActivity({
  eventId,
  activityId,
  stored,
  updatedAt,
  dirty,
}: {
  eventId: string;
  activityId: string;
  stored: Activity;
  updatedAt: number;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const { remember } = useAiUndo<Activity>(activityId);
  const [instruction, setInstruction] = useState("");
  const ask = useMutation({
    mutationFn: () =>
      data(
        client.api.activities[":activityId"].ai.theme.$post({
          param: { activityId },
          json: {
            eventId,
            ...(instruction.trim() && { instruction: instruction.trim() }),
          },
        }),
      ).then((r) => r.proposal as Activity),
  });
  const accept = useMutation({
    mutationFn: (proposal: Activity) =>
      data(
        client.api.activities[":activityId"].ai.$put(
          { param: { activityId }, json: { proposal, feature: "theme" } },
          { headers: { "if-match": String(updatedAt) } },
        ),
      ),
    onSuccess: ({ updatedAt: after }) => {
      remember({ previous: stored, after });
      ask.reset();
      void queryClient.invalidateQueries({ queryKey: ["events", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      // A new updatedAt starts a fresh draft with the accepted text.
      return queryClient.invalidateQueries({
        queryKey: ["activities", activityId],
      });
    },
  });
  const proposal = ask.data;
  const changes = proposal ? activityChanges(stored, proposal) : [];

  return (
    <Card title="Theme with AI">
      <p className={ui.muted}>
        Rewrites the text and the scoring fields' wording for the Event's theme.
        Field ids, types and scoring stay as they are; nothing changes until you
        accept.
        {dirty && " Save or discard your changes first."}
      </p>
      <label className={ui.label}>
        Anything to steer it? (optional)
        <input
          className={ui.input}
          value={instruction}
          maxLength={500}
          placeholder="e.g. less scary; more about teamwork"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={dirty || ask.isPending || accept.isPending}
          onClick={() => ask.mutate()}
        >
          {proposal ? "Try again" : "Theme this Activity"}
        </button>
        {ask.isPending && (
          <span role="status" className={ui.muted}>
            Asking…
          </span>
        )}
      </div>
      {ask.error && <ErrorMessage error={ask.error} />}
      {proposal &&
        (changes.length === 0 ? (
          <p className={ui.muted}>The AI proposed no changes.</p>
        ) : (
          <ProposalReview
            changes={changes}
            accepting={accept.isPending}
            error={accept.error}
            onAccept={() => accept.mutate(proposal)}
            onDiscard={() => {
              accept.reset();
              ask.reset();
            }}
          />
        ))}
    </Card>
  );
}
