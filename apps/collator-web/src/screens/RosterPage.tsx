import type {
  JudgeLabels,
  OfficialRoster,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, newId, officialApi } from "../api.ts";
import { clock } from "../format.ts";
import { ui } from "../ui.ts";

type Kind = "group" | "team";

/**
 * One roster change an Official is composing: only one is open at a time. The id and `clientCreatedAt` are made
 * once and kept, so a retry resends exactly the same change (safe); editing the name or reason makes a new one.
 */
type Pending = {
  /** Which row's form this is: the entrant's id, or the Group's id for "add a Team there", or "" for a new Group. */
  at: string;
  id: string;
  /** For an add: the new Group's or Team's id, kept across retries so a retry can't add it twice. */
  entityId: string;
  clientCreatedAt: string;
  reason: string;
  busy: boolean;
  problem: string | null;
} & (
  | { kind: "rename"; of: Kind; name: string }
  | { kind: "merge"; of: Kind; intoId: string }
  | { kind: "add-group"; name: string }
  | { kind: "add-team"; name: string }
);

const fresh = () => ({
  id: newId(),
  clientCreatedAt: new Date().toISOString(),
});

/**
 * The Roster page (#42 PR 6, ADR-0027): Groups with their Teams, as everyone sees them. Officials add, rename and
 * merge here; every change is logged on the box, and a merge can be undone. Loads when opened and after each change.
 */
export function RosterPage({
  email,
  labels,
  onBack,
}: {
  email: string;
  labels: JudgeLabels;
  onBack: () => void;
}) {
  const [view, setView] = useState<OfficialRoster | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let current = true;
    officialApi.roster(email).then(
      (v) => current && setView(v),
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  const send = async (
    p: Pending,
    change: Parameters<typeof officialApi.changeRoster>[2]["change"],
  ) => {
    setPending({ ...p, busy: true, problem: null });
    const notes = p.reason.trim();
    try {
      await officialApi.changeRoster(email, p.id, {
        change,
        ...(notes !== "" && { notes }),
        clientCreatedAt: p.clientCreatedAt,
      });
      setView(await officialApi.roster(email));
      setPending(null);
    } catch (e) {
      setPending({ ...p, busy: false, problem: errorMessage(e) });
    }
  };

  const confirm = (p: Pending) => {
    if (p.kind === "rename") {
      void send(p, { type: "rename", kind: p.of, id: p.at, name: p.name });
    } else if (p.kind === "merge") {
      if (p.intoId === "") {
        setPending({ ...p, problem: "Pick who to merge into" });
        return;
      }
      void send(p, { type: "merge", kind: p.of, id: p.at, intoId: p.intoId });
    } else if (p.kind === "add-group") {
      void send(p, { type: "add-group", groupId: p.entityId, name: p.name });
    } else {
      void send(p, {
        type: "add-team",
        teamId: p.entityId,
        groupId: p.at,
        name: p.name,
      });
    }
  };

  const unmerge = async (kind: Kind, id: string) => {
    try {
      await officialApi.changeRoster(email, newId(), {
        change: { type: "unmerge", kind, id },
        clientCreatedAt: new Date().toISOString(),
      });
      setView(await officialApi.roster(email));
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  if (!view) {
    return (
      <section className="flex flex-col gap-4">
        <button className={`${ui.link} self-start`} onClick={onBack}>
          ← Overview
        </button>
        {problem ? (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        ) : (
          <p className={ui.muted}>Loading…</p>
        )}
      </section>
    );
  }

  const nameOf = (id: string) =>
    [...view.groups, ...view.teams].find((e) => e.id === id)?.name ?? id;

  const form = (p: Pending) => {
    const name = p.kind === "merge" ? nameOf(p.at) : "";
    const others =
      p.kind === "merge"
        ? (p.of === "team" ? view.teams : view.groups).filter(
            (e) => e.id !== p.at,
          )
        : [];
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-md bg-stone-50 p-3">
        {p.kind === "merge" ? (
          <>
            <label className={ui.label}>
              Merge {name} into
              <select
                className={ui.input}
                aria-label={`Merge ${name} into`}
                value={p.intoId}
                disabled={p.busy}
                onChange={(e) =>
                  setPending({ ...p, intoId: e.target.value, ...fresh() })
                }
              >
                <option value="">Choose…</option>
                {others.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {p.intoId !== "" && (
              <p className={ui.warning}>
                {name}'s scores will count for {nameOf(p.intoId)} from now on.
                Standings change at once. You can unmerge later.
              </p>
            )}
          </>
        ) : (
          <label className={ui.label}>
            {p.kind === "rename"
              ? "New name"
              : p.kind === "add-group"
                ? `${labels.group} name`
                : `${labels.team} name`}
            <input
              className={ui.input}
              value={p.name}
              disabled={p.busy}
              onChange={(e) =>
                setPending({ ...p, name: e.target.value, ...fresh() })
              }
            />
          </label>
        )}
        <label className={ui.label}>
          Reason (optional)
          <input
            className={ui.input}
            value={p.reason}
            disabled={p.busy}
            onChange={(e) =>
              setPending({ ...p, reason: e.target.value, ...fresh() })
            }
          />
        </label>
        {p.problem && (
          <p className={ui.error} role="alert">
            {p.problem}
          </p>
        )}
        <div className="flex gap-2">
          <button
            className={ui.button}
            disabled={p.busy}
            onClick={() => confirm(p)}
          >
            {p.kind === "merge"
              ? "Confirm merge"
              : p.kind === "rename"
                ? "Confirm rename"
                : "Confirm add"}
          </button>
          <button
            className={ui.buttonQuiet}
            disabled={p.busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const start = (
    at: string,
    rest:
      | { kind: "rename"; of: Kind; name: string }
      | { kind: "merge"; of: Kind; intoId: string }
      | { kind: "add-group"; name: string }
      | { kind: "add-team"; name: string },
  ): Pending => ({
    at,
    entityId: newId(),
    ...fresh(),
    reason: "",
    busy: false,
    problem: null,
    ...rest,
  });

  /** Rename and Merge into… for one Group or Team, and the open form if it's theirs. */
  const actions = (kind: Kind, id: string, name: string) => (
    <div className="flex flex-wrap gap-1">
      <button
        className={ui.buttonQuiet}
        aria-label={`Rename ${name}`}
        onClick={() =>
          setPending(start(id, { kind: "rename", of: kind, name }))
        }
      >
        Rename
      </button>
      <button
        className={ui.buttonQuiet}
        aria-label={`Merge ${name} into…`}
        onClick={() =>
          setPending(start(id, { kind: "merge", of: kind, intoId: "" }))
        }
      >
        Merge into…
      </button>
    </div>
  );
  const formFor = (kind: Pending["kind"][], at: string) =>
    pending && pending.at === at && kind.includes(pending.kind)
      ? form(pending)
      : null;

  return (
    <section className="flex flex-col gap-4">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Overview
      </button>
      <h1 className={ui.h1}>Roster</h1>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {view.groups.map((g) => (
          <li key={g.id} className={ui.card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={ui.h2}>{g.name}</h2>
              {actions("group", g.id, g.name)}
            </div>
            {formFor(["rename", "merge"], g.id)}
            <ul className="mt-2 flex flex-col gap-2">
              {view.teams
                .filter((t) => t.groupId === g.id)
                .map((t) => (
                  <li key={t.id} className="border-t border-stone-100 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{t.name}</span>
                      {actions("team", t.id, t.name)}
                    </div>
                    {formFor(["rename", "merge"], t.id)}
                  </li>
                ))}
            </ul>
            <div className="mt-2">
              {pending?.kind === "add-team" && pending.at === g.id ? (
                form(pending)
              ) : (
                <button
                  className={ui.buttonQuiet}
                  aria-label={`Add ${labels.team} to ${g.name}`}
                  onClick={() =>
                    setPending(start(g.id, { kind: "add-team", name: "" }))
                  }
                >
                  Add {labels.team}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {pending?.kind === "add-group" ? (
        form(pending)
      ) : (
        <button
          className={`${ui.buttonQuiet} self-start`}
          onClick={() => setPending(start("", { kind: "add-group", name: "" }))}
        >
          Add {labels.group}
        </button>
      )}

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>Merged</h2>
        {view.merged.length === 0 && (
          <p className={ui.muted}>Nothing merged.</p>
        )}
        <ul className="flex flex-col gap-2">
          {view.merged.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                {m.name} → {m.intoName}, by {m.by}, {clock(m.at)}
                {m.notes && `: ${m.notes}`}
              </span>
              <button
                className={ui.buttonQuiet}
                aria-label={`Unmerge ${m.name}`}
                onClick={() => void unmerge(m.kind, m.id)}
              >
                Unmerge
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>History</h2>
        {view.history.length === 0 && <p className={ui.muted}>No changes.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {view.history.map((h) => (
            <li key={h.seq}>
              {h.text}, by {h.by}, {clock(h.at)}
              {h.notes && `: ${h.notes}`}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
