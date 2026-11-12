import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";
import { ui } from "../ui.ts";
import { ActivityList } from "./ActivityList.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";

/** An Event: its details, then its Competitions and their Activities in order (issues #4, #6). */
export function EventPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  const { event } = result.data;
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
      <ActivityList eventId={eventId} read={result.data} />
    </div>
  );
}

/** Opens the Event's Program Guide in a new tab (issue #5). */
function ProgramGuideButton({ eventId }: { eventId: string }) {
  const { open, opening, error } = useOpenHtmlInNewTab(
    () =>
      client.api.events[":eventId"]["program-guide"].$get({
        param: { eventId },
      }),
    "Couldn't load the Program Guide.",
  );
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() => void open()}
          disabled={opening}
        >
          Program Guide
        </button>
        <Link to={`/events/${eventId}/guides`} className={ui.buttonQuiet}>
          Guides
        </Link>
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
    </div>
  );
}
