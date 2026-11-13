import type { Event } from "@camporee-conductor/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { Card } from "./editing.tsx";
import { ErrorMessage } from "./ErrorMessage.tsx";
import { ProposalReview, type ProposedChange } from "./ProposalReview.tsx";

type Feature = "theme" | "introduction";

/** What the AI offered for one feature: each choice's name, its text, and the value a pick sets. */
interface Offer {
  feature: Feature;
  choices: { label: string; detail: string; value: string }[];
}

/** Whether the Composer has AI (ADR-0030 item 2): no key, no buttons. */
export function useAiOn(): boolean {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => data(client.api.me.$get()),
  });
  return me.data?.ai ?? false;
}

/**
 * Ideas from AI for the Event (ADR-0030 notes, #103 PR 2): theme ideas, and v1's three Introduction options. A pick
 * is shown as a change to accept or discard, and accepting saves it on its own, so the page must have no unsaved
 * changes first.
 */
export function EventBrainstorm({
  eventId,
  stored,
  updatedAt,
  dirty,
}: {
  eventId: string;
  stored: Event;
  updatedAt: number;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [asked, setAsked] = useState<Feature | null>(null);
  const [picked, setPicked] = useState<{
    feature: Feature;
    value: string;
  } | null>(null);

  const ask = useMutation({
    mutationFn: (feature: Feature): Promise<Offer> => {
      const json = instruction.trim()
        ? { instruction: instruction.trim() }
        : {};
      return feature === "theme"
        ? data(
            client.api.events[":eventId"].ai.themes.$post({
              param: { eventId },
              json,
            }),
          ).then((r) => ({
            feature,
            choices: r.ideas.map((i) => ({
              label: i.theme,
              detail: i.why,
              value: i.theme,
            })),
          }))
        : data(
            client.api.events[":eventId"].ai.introductions.$post({
              param: { eventId },
              json,
            }),
          ).then((r) => ({
            feature,
            choices: [
              { label: "Action", detail: r.action, value: r.action },
              { label: "Lore", detail: r.lore, value: r.lore },
              { label: "Skill", detail: r.skill, value: r.skill },
            ],
          }));
    },
    onMutate: (feature) => {
      setAsked(feature);
      setPicked(null);
    },
  });

  const accept = useMutation({
    mutationFn: (pick: { feature: Feature; value: string }) =>
      data(
        client.api.events[":eventId"].ai.$put(
          {
            param: { eventId },
            json: {
              proposal: { ...stored, [pick.feature]: pick.value },
              feature: pick.feature,
            },
          },
          { headers: { "if-match": String(updatedAt) } },
        ),
      ),
    onSuccess: () => {
      setPicked(null);
      ask.reset();
      // A new updatedAt starts a fresh draft with the accepted change.
      return queryClient.invalidateQueries({ queryKey: ["events", eventId] });
    },
  });

  const changes: ProposedChange[] = picked
    ? [
        {
          label: picked.feature === "theme" ? "Theme" : "Introduction",
          before: stored[picked.feature] ?? "",
          after: picked.value,
        },
      ]
    : [];
  const busy = ask.isPending || accept.isPending;
  const hasTheme = Boolean(stored.theme?.trim());

  return (
    <Card title="Ideas from AI">
      <p className={ui.muted}>
        AI proposes; you decide. Nothing changes until you accept a pick.
        {dirty && " Save or discard your changes first."}
      </p>
      <label className={ui.label}>
        Anything to steer it? (optional)
        <input
          className={ui.input}
          value={instruction}
          maxLength={500}
          placeholder="e.g. something with pirates; shorter; for younger Scouts"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={dirty || busy}
          onClick={() => ask.mutate("theme")}
        >
          Suggest themes
        </button>
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={dirty || busy || !hasTheme}
          title={hasTheme ? undefined : "Give the Event a theme first."}
          onClick={() => ask.mutate("introduction")}
        >
          Write Introduction options
        </button>
        {ask.isPending && (
          <span role="status" className={ui.muted}>
            Asking…
          </span>
        )}
      </div>
      {!hasTheme && (
        <p className={ui.muted}>Introduction options need a theme first.</p>
      )}
      {ask.error && <ErrorMessage error={ask.error} />}
      {ask.data && asked === ask.data.feature && !picked && (
        <ul
          aria-label={
            ask.data.feature === "theme"
              ? "Theme ideas"
              : "Introduction options"
          }
          className="space-y-2"
        >
          {ask.data.choices.map((choice) => (
            <li
              key={choice.label}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-stone-200 p-2"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">{choice.label}</p>
                <p className="text-sm whitespace-pre-line text-stone-600">
                  {choice.detail}
                </p>
              </div>
              <button
                type="button"
                className={ui.buttonQuiet}
                aria-label={`Use ${choice.label}`}
                onClick={() =>
                  setPicked({
                    feature: ask.data.feature,
                    value: choice.value,
                  })
                }
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <ProposalReview
          changes={changes}
          accepting={accept.isPending}
          error={accept.error}
          onAccept={() => accept.mutate(picked)}
          onDiscard={() => {
            accept.reset();
            setPicked(null);
          }}
        />
      )}
    </Card>
  );
}
