import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
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
