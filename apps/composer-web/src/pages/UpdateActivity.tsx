import type { Activity } from "@camporee-conductor/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { activityChanges } from "../activity-changes.ts";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { useAiUndo } from "./AiUndo.tsx";
import { Card } from "./editing.tsx";
import { ErrorMessage } from "./ErrorMessage.tsx";
import { ProposalReview } from "./ProposalReview.tsx";

/**
 * AI update with a prompt (ADR-0030 notes, #103 PR 4; v1's `update-game`): the editor says what should change in the
 * title and text; the AI proposes it; the editor accepts or discards. Scoring fields are left alone.
 */
export function UpdateActivity({
  activityId,
  stored,
  updatedAt,
  dirty,
  eventId,
}: {
  activityId: string;
  stored: Activity;
  updatedAt: number;
  dirty: boolean;
  /** The Event the page was opened from, if any: its Activity list shows the title. */
  eventId: string;
}) {
  const queryClient = useQueryClient();
  const { remember } = useAiUndo<Activity>(activityId);
  const [instruction, setInstruction] = useState("");
  const [includeContent, setIncludeContent] = useState(true);
  const ask = useMutation({
    mutationFn: () =>
      data(
        client.api.activities[":activityId"].ai.update.$post({
          param: { activityId },
          json: { instruction: instruction.trim(), includeContent },
        }),
      ).then((r) => r.proposal as Activity),
  });
  const accept = useMutation({
    mutationFn: (proposal: Activity) =>
      data(
        client.api.activities[":activityId"].ai.$put(
          { param: { activityId }, json: { proposal, feature: "update" } },
          { headers: { "if-match": String(updatedAt) } },
        ),
      ),
    onSuccess: ({ updatedAt: after }) => {
      remember({ previous: stored, after });
      ask.reset();
      if (eventId) {
        void queryClient.invalidateQueries({ queryKey: ["events", eventId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      return queryClient.invalidateQueries({
        queryKey: ["activities", activityId],
      });
    },
  });
  const proposal = ask.data;
  const changes = proposal ? activityChanges(stored, proposal) : [];

  return (
    <Card title="Update with AI">
      <label className={ui.label}>
        What should change?
        <textarea
          className={ui.input}
          rows={3}
          value={instruction}
          maxLength={2000}
          placeholder="e.g. make the rules simpler for younger Scouts; add a rain plan to the setup"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={includeContent}
          onChange={(e) => setIncludeContent(e.target.checked)}
        />
        Send the current text, so the AI edits it (untick to write afresh)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={
            dirty ||
            instruction.trim() === "" ||
            ask.isPending ||
            accept.isPending
          }
          onClick={() => ask.mutate()}
        >
          Ask the AI
        </button>
        {dirty && (
          <span className={ui.muted}>Save or discard your changes first.</span>
        )}
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
