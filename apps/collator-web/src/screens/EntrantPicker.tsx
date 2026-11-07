import type {
  Group,
  JudgeActivity,
  JudgeLabels,
  Roster,
  Team,
} from "@camporee-conductor/collator/types";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, newId, wasRefused } from "../api.ts";
import { entrantLabel, levelLabel } from "../format.ts";
import { matchingGroup, matchingTeam } from "../names.ts";
import { ui } from "../ui.ts";

/** Who's being scored: a Team, or a Group at a Group-level Activity. */
export interface Entrant {
  id: string;
  /** As shown, e.g. "Flaming Arrows (Troop 101)". */
  label: string;
}

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
  labels: JudgeLabels;
  onPick: (entrant: Entrant) => void;
  onBack: () => void;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const teamLevel = activity.competition.level === "team";
  const label = levelLabel(activity.competition.level, labels);

  // Fresh each time: Teams other Judges added since are listed, so they're picked, not added again.
  const loadRoster = useCallback(() => {
    api.roster().then(setRoster, (e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(loadRoster, [loadRoster]);
  // After a cancelled add, reload: anything the box did save is then listed and its name warns.
  const closeAdd = () => {
    setAdding(false);
    loadRoster();
  };

  if (error) return <p className={ui.error}>{error}</p>;
  if (!roster) return <p className={ui.muted}>Loading…</p>;

  const groupName = (id: string) =>
    roster.groups.find((g) => g.id === id)?.name ?? "?";
  const listed: Entrant[] = teamLevel
    ? roster.teams.map((t) => ({
        id: t.id,
        label: teamLabel(t, groupName(t.groupId)),
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
            onCancel={closeAdd}
          />
        ) : (
          <AddGroup
            roster={roster}
            labels={labels}
            onPick={onPick}
            onCancel={closeAdd}
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
  labels: JudgeLabels;
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
  const [pending, setPending] = useState<NewTeam | null>(null);
  const locked = pending !== null;

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

  // The ids are made once per attempt and kept until it succeeds: "Try again" resends the same ones, so
  // a lost reply never adds the Team (or its new Group) twice (ADR-0027 item 8).
  const attempt = (): NewTeam => {
    const group = existingGroup ?? { id: newId(), name: newGroupName.trim() };
    return {
      group,
      groupIsNew: !existingGroup,
      team: { id: newId(), groupId: group.id, name: teamName.trim() },
    };
  };
  const add = async (adding: NewTeam) => {
    setPending(adding);
    setSaving(true);
    setError(null);
    try {
      if (adding.groupIsNew) await api.putGroup(adding.group);
      await api.putTeam(adding.team);
      onPick({
        id: adding.team.id,
        label: teamLabel(adding.team, adding.group.name),
      });
    } catch (e) {
      if (wasRefused(e)) setPending(null);
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <form
      className={`${ui.card} flex flex-col gap-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) void add(pending);
        else if (!teamMatch && !groupMatch) void add(attempt());
      }}
    >
      <h2 className={ui.h2}>Add a {labels.team}</h2>
      <label className={ui.label}>
        {labels.group}
        <select
          className={ui.input}
          value={groupChoice}
          onChange={(e) => setGroupChoice(e.target.value)}
          disabled={locked}
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
            disabled={locked}
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
          disabled={locked}
          required
        />
      </label>
      {teamMatch && existingGroup && (
        <AlreadyListed
          message={`${teamMatch.name} is already in ${existingGroup.name}.`}
          match={{
            id: teamMatch.id,
            label: teamLabel(teamMatch, existingGroup.name),
          }}
          word={labels.team}
          saving={saving}
          onPick={onPick}
          onAddAnyway={() => void add(pending ?? attempt())}
        />
      )}
      {error && <NotSaved error={error} kept={locked} />}
      {(locked || !teamMatch) && (
        <button
          className={ui.button}
          type="submit"
          disabled={
            saving ||
            (!locked && (!groupReady || teamName.trim() === "" || !!groupMatch))
          }
        >
          {saving ? "Saving…" : locked ? "Try again" : `Add ${labels.team}`}
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
  labels: JudgeLabels;
  onPick: (entrant: Entrant) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // As in AddTeam: one id per attempt, resent unchanged by "Try again".
  const [pending, setPending] = useState<Group | null>(null);
  const locked = pending !== null;
  const match = matchingGroup(roster.groups, name, labels.group);

  const add = async (group: Group) => {
    setPending(group);
    setSaving(true);
    setError(null);
    try {
      await api.putGroup(group);
      onPick({ id: group.id, label: group.name });
    } catch (e) {
      if (wasRefused(e)) setPending(null);
      setError(errorMessage(e));
      setSaving(false);
    }
  };
  const attempt = (): Group => ({ id: newId(), name: name.trim() });

  return (
    <form
      className={`${ui.card} flex flex-col gap-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) void add(pending);
        else if (!match) void add(attempt());
      }}
    >
      <h2 className={ui.h2}>Add a {labels.group}</h2>
      <label className={ui.label}>
        {labels.group} name
        <input
          className={ui.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={locked}
          required
        />
      </label>
      {match && (
        <AlreadyListed
          message={`${match.name} is already on the list.`}
          match={{ id: match.id, label: match.name }}
          word={labels.group}
          saving={saving}
          onPick={onPick}
          onAddAnyway={() => void add(pending ?? attempt())}
        />
      )}
      {error && <NotSaved error={error} kept={locked} />}
      {(locked || !match) && (
        <button
          className={ui.button}
          type="submit"
          disabled={saving || (!locked && name.trim() === "")}
        >
          {saving ? "Saving…" : locked ? "Try again" : `Add ${labels.group}`}
        </button>
      )}
      <button type="button" className={ui.link} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/** "Team (Group)", as the Official view shows it. */
const teamLabel = (team: Team, groupName: string) =>
  entrantLabel(team.id, { name: team.name, group: groupName });

/**
 * The name typed matches one already listed (another Judge may have added it): score that one, or add
 * this as a different one.
 */
function AlreadyListed({
  message,
  match,
  word,
  saving,
  onPick,
  onAddAnyway,
}: {
  message: string;
  match: Entrant;
  /** The event's word for what's being added, e.g. Patrol. */
  word: string;
  saving: boolean;
  onPick: (entrant: Entrant) => void;
  onAddAnyway: () => void;
}) {
  return (
    <div className={`${ui.warning} flex flex-col gap-2`} role="alert">
      <p>{message} Another Judge may have added it.</p>
      <button type="button" className={ui.button} onClick={() => onPick(match)}>
        Score {match.label}
      </button>
      <button
        type="button"
        className={ui.buttonQuiet}
        disabled={saving}
        onClick={onAddAnyway}
      >
        No, it's a different {word}: add it
      </button>
    </div>
  );
}

/** A new Team being added, with its Group when that's new too. */
interface NewTeam {
  group: Group;
  groupIsNew: boolean;
  team: Team;
}

/**
 * Why an add failed. `kept`: the box didn't answer, so the same thing is resent unchanged; otherwise the
 * box refused it and the Judge fixes the entry.
 */
function NotSaved({ error, kept }: { error: string; kept: boolean }) {
  return (
    <div className={ui.error} role="alert">
      <p>Not saved: {error}</p>
      <p className="mt-1">
        {kept
          ? "Try again when you're back in range."
          : "Fix it and add again."}
      </p>
    </div>
  );
}
