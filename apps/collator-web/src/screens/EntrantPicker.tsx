import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { api, ApiError, newId, type Roster } from "../api.ts";
import { matchingGroup, matchingTeam } from "../names.ts";
import { ui } from "../ui.ts";

/** Who's being scored: a Team, or a Group at a Group-level Activity. */
export interface Entrant {
  id: string;
  /** As shown, e.g. "Flaming Arrows (Troop 101)". */
  label: string;
}

type Labels = { team: string; group: string };

/**
 * Pick who's being scored. Picking an existing one is the default path; adding is the quieter option
 * below the list (v1 parity). Two phones adding the same Patrol would make duplicates, so a name that
 * matches one already listed warns first and offers it. Merging duplicates is an Official's tool (#42).
 */
export function EntrantPicker({
  activity,
  labels,
  onPick,
  onBack,
}: {
  activity: JudgeActivity;
  labels: Labels;
  onPick: (entrant: Entrant) => void;
  onBack: () => void;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const teamLevel = activity.competition.level === "team";
  const label = teamLevel ? labels.team : labels.group;

  useEffect(() => {
    // Fresh each time: Teams other Judges added since are listed, so they're picked, not added again.
    api
      .roster()
      .then(setRoster, (e: unknown) =>
        setError(e instanceof ApiError ? e.message : String(e)),
      );
  }, []);

  if (error) return <p className={ui.error}>{error}</p>;
  if (!roster) return <p className={ui.muted}>Loading…</p>;

  const groupName = (id: string) =>
    roster.groups.find((g) => g.id === id)?.name ?? "?";
  const listed: Entrant[] = teamLevel
    ? roster.teams.map((t) => ({
        id: t.id,
        label: `${t.name} (${groupName(t.groupId)})`,
      }))
    : roster.groups.map((g) => ({ id: g.id, label: g.name }));
  const query = search.trim().toLowerCase();
  const shown = query
    ? listed.filter((e) => e.label.toLowerCase().includes(query))
    : listed;

  return (
    <section className="flex flex-col gap-3">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Activities
      </button>
      <h1 className={ui.h1}>{activity.title}</h1>
      <p>Which {label} are you scoring?</p>

      {listed.length > 0 && (
        <label className={ui.label}>
          Find a {label}
          <input
            className={ui.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
          />
        </label>
      )}
      {shown.map((entrant) => (
        <button
          key={entrant.id}
          className={ui.choice}
          onClick={() => onPick(entrant)}
        >
          {entrant.label}
        </button>
      ))}
      {listed.length === 0 && (
        <p className={ui.muted}>No {label}s on the list yet.</p>
      )}

      {adding ? (
        teamLevel ? (
          <AddTeam
            roster={roster}
            labels={labels}
            onPick={onPick}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <AddGroup
            roster={roster}
            labels={labels}
            onPick={onPick}
            onCancel={() => setAdding(false)}
          />
        )
      ) : (
        <button
          className={`${ui.buttonQuiet} mt-2`}
          onClick={() => setAdding(true)}
        >
          {label} not listed? Add one
        </button>
      )}
    </section>
  );
}

const NEW = "__new__";

function AddTeam({
  roster,
  labels,
  onPick,
  onCancel,
}: {
  roster: Roster;
  labels: Labels;
  onPick: (entrant: Entrant) => void;
  onCancel: () => void;
}) {
  const [groupChoice, setGroupChoice] = useState(
    roster.groups.length > 0 ? "" : NEW,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groupMatch =
    groupChoice === NEW
      ? matchingGroup(roster.groups, newGroupName, labels.group)
      : undefined;
  const existingGroup = roster.groups.find((g) => g.id === groupChoice);
  const teamMatch = existingGroup
    ? matchingTeam(roster.teams, existingGroup.id, teamName)
    : undefined;
  const groupReady =
    existingGroup !== undefined ||
    (groupChoice === NEW && newGroupName.trim() !== "");

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const group = existingGroup ?? {
        id: newId(),
        name: newGroupName.trim(),
      };
      if (!existingGroup) await api.putGroup(group);
      const team = { id: newId(), groupId: group.id, name: teamName.trim() };
      await api.putTeam(team);
      onPick({ id: team.id, label: `${team.name} (${group.name})` });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <form
      className={`${ui.card} flex flex-col gap-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!teamMatch && !groupMatch) void add();
      }}
    >
      <h2 className={ui.h2}>Add a {labels.team}</h2>
      <label className={ui.label}>
        {labels.group}
        <select
          className={ui.input}
          value={groupChoice}
          onChange={(e) => setGroupChoice(e.target.value)}
          required
        >
          <option value="" disabled>
            Choose a {labels.group}
          </option>
          {roster.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={NEW}>New {labels.group}…</option>
        </select>
      </label>
      {groupChoice === NEW && (
        <label className={ui.label}>
          New {labels.group} name
          <input
            className={ui.input}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            required
          />
        </label>
      )}
      {groupMatch && (
        <div className={ui.warning} role="alert">
          <p>{groupMatch.name} is already on the list.</p>
          <button
            type="button"
            className={`${ui.link} mt-1`}
            onClick={() => setGroupChoice(groupMatch.id)}
          >
            Use {groupMatch.name}
          </button>
        </div>
      )}
      <label className={ui.label}>
        {labels.team} name
        <input
          className={ui.input}
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          required
        />
      </label>
      {teamMatch && existingGroup && (
        <div className={`${ui.warning} flex flex-col gap-2`} role="alert">
          <p>
            {teamMatch.name} is already in {existingGroup.name}. Another Judge
            may have added it.
          </p>
          <button
            type="button"
            className={ui.button}
            onClick={() =>
              onPick({
                id: teamMatch.id,
                label: `${teamMatch.name} (${existingGroup.name})`,
              })
            }
          >
            Score {teamMatch.name} ({existingGroup.name})
          </button>
          <button
            type="button"
            className={ui.buttonQuiet}
            disabled={saving}
            onClick={() => void add()}
          >
            No, it's a different {labels.team}: add it
          </button>
        </div>
      )}
      {error && <p className={ui.error}>{error}</p>}
      {!teamMatch && (
        <button
          className={ui.button}
          type="submit"
          disabled={
            saving || !groupReady || teamName.trim() === "" || !!groupMatch
          }
        >
          Add {labels.team}
        </button>
      )}
      <button type="button" className={ui.link} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function AddGroup({
  roster,
  labels,
  onPick,
  onCancel,
}: {
  roster: Roster;
  labels: Labels;
  onPick: (entrant: Entrant) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const match = matchingGroup(roster.groups, name, labels.group);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const group = { id: newId(), name: name.trim() };
      await api.putGroup(group);
      onPick({ id: group.id, label: group.name });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <form
      className={`${ui.card} flex flex-col gap-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!match) void add();
      }}
    >
      <h2 className={ui.h2}>Add a {labels.group}</h2>
      <label className={ui.label}>
        {labels.group} name
        <input
          className={ui.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      {match && (
        <div className={`${ui.warning} flex flex-col gap-2`} role="alert">
          <p>
            {match.name} is already on the list. Another Judge may have added
            it.
          </p>
          <button
            type="button"
            className={ui.button}
            onClick={() => onPick({ id: match.id, label: match.name })}
          >
            Score {match.name}
          </button>
          <button
            type="button"
            className={ui.buttonQuiet}
            disabled={saving}
            onClick={() => void add()}
          >
            No, it's a different {labels.group}: add it
          </button>
        </div>
      )}
      {error && <p className={ui.error}>{error}</p>}
      {!match && (
        <button
          className={ui.button}
          type="submit"
          disabled={saving || name.trim() === ""}
        >
          Add {labels.group}
        </button>
      )}
      <button type="button" className={ui.link} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
