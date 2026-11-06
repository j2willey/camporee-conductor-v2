import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { Loading, PageError } from "./ErrorMessage.tsx";

/** An Event, read-only: its Competitions and their Activities in order (issue #4). */
export function EventPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  const { event, activities } = result.data;
  const titles = new Map(activities.map((a) => [a.id, a.title]));
  const dates = [event.startDate, event.endDate].filter(Boolean).join(" – ");
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p>
          <Link to="/" className={ui.link}>
            ← Your Organizations
          </Link>
        </p>
        <h1 className={ui.h1}>{event.title}</h1>
        {dates && <p className="text-stone-600">{dates}</p>}
        {event.organizerName && (
          <p className={ui.muted}>Organizer: {event.organizerName}</p>
        )}
        <ProgramGuideButton eventId={eventId} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {event.competitions.map((competition) => {
          const entries = event.activities
            .filter((a) => a.competitionId === competition.id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return (
            <section key={competition.id} className={ui.card}>
              <h2 className={`${ui.h2} mb-2`}>
                {competition.label} ({entries.length})
              </h2>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                {entries.map((entry) => (
                  <li key={entry.activityId}>
                    {titles.get(entry.activityId) ?? "(missing Activity)"}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Opens the Event's Program Guide in a new tab (issue #5). The guide is fetched through the signed-in
 * client (a plain link wouldn't carry the sign-in headers) and shown from a blob: URL, so it's a
 * standalone page the browser can print to PDF.
 */
function ProgramGuideButton({ eventId }: { eventId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function open() {
    setError(null);
    setOpening(true);
    // Opened during the click, before any await, so pop-up blockers allow it.
    const tab = window.open("", "_blank");
    try {
      const response = await client.api.events[":eventId"][
        "program-guide"
      ].$get({ param: { eventId } });
      if (!response.ok) {
        throw new ApiError(response.status, "Couldn't load the Program Guide.");
      }
      const html = await response.text();
      // Not revoked: the tab keeps it so a reload still works; it goes when this app's tab closes.
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => void open()}
        disabled={opening}
      >
        Program Guide
      </button>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
    </div>
  );
}
