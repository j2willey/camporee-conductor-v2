import type {
  Group,
  JudgeActivity,
  JudgeLabels,
  Roster,
  Team,
} from "@camporee-conductor/collator/types";
import type { OutboxItem } from "../outbox.ts";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, newId } from "../api.ts";
import { entrantLabel, levelLabel } from "../format.ts";
import { matchingGroup, matchingTeam } from "../names.ts";
import {
  addGroupItem,
  addTeamItem,
  loadKept,
  rosterWithPending,
} from "../offline-data.ts";
import { ANSWER_WAIT_MS, outbox, useOutboxItems } from "../phone-outbox.ts";
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
 * With no Wi-Fi (#41 PR 3) the list is the one kept on the phone, plus what this phone added that's still
 * waiting to send; adds go through the outbox like scores.
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
  const [keptRoster, setRoster] = useState<Roster | null>(null);
  const waiting = useOutboxItems();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const teamLevel = activity.competition.level === "team";
  const label = levelLabel(activity.competition.level, labels);

  // Fresh each time: Teams other Judges added since are listed, so they're picked, not added again.
  const loadRoster = useCallback(() => {
    loadKept(ROSTER_KEY, api.roster, localStorage).then(
      (kept) => setRoster(kept.value),
      (e: unknown) => setError(errorMessage(e)),
    );
  }, []);
  useEffect(loadRoster, [loadRoster]);
  // After a cancelled add, reload: anything the box did save is then listed and its name warns.
  const closeAdd = () => {
    setAdding(false);
    loadRoster();
  };

  if (error) return <p className={ui.error}>{error}</p>;
  if (!keptRoster) return <p className={ui.muted}>Loading…</p>;
  const roster = rosterWithPending(keptRoster, waiting);

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
            onRefused={loadRoster}
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
const ROSTER_KEY = "collator.roster";

/**
 * Send one roster add through the outbox. `waitMs` 0 when something before it is already waiting: it
 * can't go first, so there's nothing to wait for.
 */
const sendAdd = (item: OutboxItem, waitMs = ANSWER_WAIT_MS) =>
  outbox.sendNow(item, { waitMs });

function AddTeam({
  roster,
  labels,
  onPick,
  onRefused,
  onCancel,
}: {
  roster: Roster;
  labels: JudgeLabels;
  onPick: (entrant: Entrant) => void;
  /** The box refused part of the add: reload the list, since a new Group may have been saved. */
  onRefused: () => void;
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

  // New ids for each add, made on the phone: the outbox resends them unchanged, so a lost reply never adds
  // the Team (or its new Group) twice (ADR-0027 item 8). The Group goes first: the outbox sends in order.
  const add = async () => {
    const group = existingGroup ?? { id: newId(), name: newGroupName.trim() };
    const team = { id: newId(), groupId: group.id, name: teamName.trim() };
    const now = new Date().toISOString();
    setSaving(true);
    setError(null);
    let behind = false;
    if (!existingGroup) {
      const result = await sendAdd(addGroupItem(group, now));
      if (result.status === "refused") return refuse(result.message);
      behind = result.status === "waiting";
    }
    const result = await sendAdd(
      addTeamItem(team, group.name, now),
      behind ? 0 : ANSWER_WAIT_MS,
    );
    if (result.status === "refused") return refuse(result.message);
    onPick({ id: team.id, label: teamLabel(team, group.name) });
  };
  const refuse = (message: string) => {
    setError(message);
    setSaving(false);
    onRefused();
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
          disabled={saving}
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
            disabled={saving}
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
          disabled={saving}
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
          onAddAnyway={() => void add()}
        />
      )}
      {error && <NotSaved error={error} />}
      {!teamMatch && (
        <button
          className={ui.button}
          type="submit"
          disabled={
            saving || !groupReady || teamName.trim() === "" || !!groupMatch
          }
        >
          {saving ? "Saving…" : `Add ${labels.team}`}
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
  const match = matchingGroup(roster.groups, name, labels.group);

  // As in AddTeam: a new id each add, resent unchanged by the outbox.
  const add = async () => {
    const group: Group = { id: newId(), name: name.trim() };
    setSaving(true);
    setError(null);
    const result = await sendAdd(addGroupItem(group, new Date().toISOString()));
    if (result.status === "refused") {
      setError(result.message);
      setSaving(false);
      return;
    }
    onPick({ id: group.id, label: group.name });
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
          disabled={saving}
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
          onAddAnyway={() => void add()}
        />
      )}
      {error && <NotSaved error={error} />}
      {!match && (
        <button
          className={ui.button}
          type="submit"
          disabled={saving || name.trim() === ""}
        >
          {saving ? "Saving…" : `Add ${labels.group}`}
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

/** Why an add failed: the box refused it, so the Judge fixes the entry. */
function NotSaved({ error }: { error: string }) {
  return (
    <div className={ui.error} role="alert">
      <p>Not saved: {error}</p>
      <p className="mt-1">Fix it and add again.</p>
    </div>
  );
}
