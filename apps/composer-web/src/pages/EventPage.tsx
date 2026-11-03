import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

/** An Event, read-only: its Competitions and their Activities in order (issue #4). */
export function EventPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
  });
  if (result.isPending) return <p>Loading…</p>;
  if (result.isError) return <ErrorMessage error={result.error} />;
  const { event, activities } = result.data;
  const titles = new Map(activities.map((a) => [a.id, a.title]));
  const dates = [event.startDate, event.endDate].filter(Boolean).join(" – ");
  return (
    <>
      <p>
        <Link to="/">← Organizations</Link>
      </p>
      <h1>{event.title}</h1>
      {dates && <p>{dates}</p>}
      {event.organizerName && <p>Organizer: {event.organizerName}</p>}
      {event.competitions.map((competition) => {
        const entries = event.activities
          .filter((a) => a.competitionId === competition.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return (
          <section key={competition.id}>
            <h2>
              {competition.label} ({entries.length})
            </h2>
            <ol>
              {entries.map((entry) => (
                <li key={entry.activityId}>
                  {titles.get(entry.activityId) ?? "(missing Activity)"}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
