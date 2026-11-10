import type { OfficialEvent } from "@camporee-conductor/collator/types";
import { useEffect, useRef, useState } from "react";
import { officialApi } from "../api.ts";
import { clock, levelLabel } from "../format.ts";
import { ui } from "../ui.ts";

type Activity = OfficialEvent["activities"][number];

/** How often the Overview asks the box again while the page is showing. */
export const REFRESH_MS = 15_000;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The Official's Overview (#42 PR 1): every Activity's status in one table per Competition, refreshed
 * every 15 s while the page is showing. Counts only; rankings are on each Activity's own page.
 */
export function OfficialOverview({
  email,
  event: first,
  onPick,
  onPrint,
  onStandings,
  onRoster,
}: {
  email: string;
  event: OfficialEvent;
  onPick: (activity: Activity) => void;
  onPrint: () => void;
  onStandings: () => void;
  onRoster: () => void;
}) {
  const [event, setEvent] = useState(first);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [stale, setStale] = useState(false);
  const refreshing = useRef(false);

  useEffect(() => {
    let current = true;
    const refresh = () => {
      if (refreshing.current || document.visibilityState === "hidden") return;
      refreshing.current = true;
      officialApi.event(email).then(
        (ev) => {
          refreshing.current = false;
          if (!current) return;
          setEvent(ev);
          setUpdatedAt(new Date());
          setStale(false);
        },
        () => {
          refreshing.current = false;
          if (current) setStale(true);
        },
      );
    };
    // Coming back from an Activity page, what the Official just did shows at once, not 15 s later.
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [email]);

  const { activities } = event;
  const competitions = [
    ...new Map(
      activities.map((a) => [a.competition.id, a.competition]),
    ).values(),
  ];
  const scores = activities.reduce((n, a) => n + a.entryCount, 0);
  const started = activities.filter((a) => a.entryCount > 0).length;

  return (
    <section className="flex flex-col gap-4">
      <h1 className={ui.h1}>Overview</h1>
      <div>
        <p>
          {plural(scores, "score", "scores")} across {started} of{" "}
          {plural(activities.length, "Activity", "Activities")}.
        </p>
        <p className={ui.muted}>
          Updated {clock(updatedAt, true)}
          {stale &&
            " · Can't reach the box just now; showing the last it sent."}
        </p>
      </div>
      {competitions.map((competition) => (
        <section key={competition.id} className="flex flex-col gap-2">
          <h2 className={ui.h2}>{competition.label}</h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Activity</th>
                  <th className="px-3 py-2 font-medium">
                    {levelLabel(competition.level, event.event.labels)}s scored
                  </th>
                  <th className="px-3 py-2 font-medium">Entries</th>
                  <th className="px-3 py-2 font-medium">Judges</th>
                  <th className="px-3 py-2 font-medium">Closures</th>
                  <th className="px-3 py-2 font-medium">Conflicts</th>
                  <th className="px-3 py-2 font-medium">Last score</th>
                  <th className="px-3 py-2 font-medium">Finalized</th>
                </tr>
              </thead>
              <tbody>
                {activities
                  .filter((a) => a.competition.id === competition.id)
                  .map((a) => (
                    <tr key={a.id} className="border-t border-stone-100">
                      <td className="px-3 py-2">
                        <button className={ui.link} onClick={() => onPick(a)}>
                          {a.title}
                        </button>
                      </td>
                      <td className="px-3 py-2">{a.entrantsScored}</td>
                      <td className="px-3 py-2">{a.entryCount}</td>
                      <td className="px-3 py-2">{a.judges}</td>
                      <td className="px-3 py-2">
                        {a.closureProblems > 0 ? (
                          <span className="font-medium text-amber-800">
                            Check closures
                          </span>
                        ) : a.closedBy > 0 ? (
                          <span className="text-teal-800">
                            Closed by {a.closedBy}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {a.conflicts > 0 ? (
                          <span className="font-medium text-amber-800">
                            {a.conflicts}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {a.lastReceivedAt
                          ? clock(new Date(a.lastReceivedAt))
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {a.finalized ? "Final" : ""}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <button className={`${ui.buttonQuiet} w-full`} onClick={onStandings}>
          Standings
        </button>
        <button className={`${ui.buttonQuiet} w-full`} onClick={onRoster}>
          Roster
        </button>
        <button className={`${ui.buttonQuiet} w-full`} onClick={onPrint}>
          QR codes to print
        </button>
      </div>
    </section>
  );
}
