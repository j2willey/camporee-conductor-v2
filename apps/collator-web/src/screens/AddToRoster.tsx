import type {
  JudgeLabels,
  OfficialActivity,
  OfficialRoster,
} from "@camporee-conductor/collator/types";
import { useState } from "react";
import { errorMessage, newId, officialApi } from "../api.ts";
import { ui } from "../ui.ts";

/**
 * "Add to roster" for a Scores row whose entrant isn't on the roster (#42 PR 6). It adds the entry's own entrant id
 * as a Team (with a name and a Group) or a Group, so the row becomes a normal one. The log id and time are made
 * once and kept across retries; editing the form makes a new change.
 */
export function AddToRoster({
  email,
  entrantId,
  level,
  labels,
  onAdded,
}: {
  email: string;
  entrantId: string;
  level: OfficialActivity["activity"]["competition"]["level"];
  labels: JudgeLabels;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<OfficialRoster["groups"]>([]);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [change, setChange] = useState({
    id: newId(),
    clientCreatedAt: new Date().toISOString(),
  });
  const edited = () =>
    setChange({ id: newId(), clientCreatedAt: new Date().toISOString() });

  const word = level === "team" ? labels.team : labels.group;

  const openForm = async () => {
    setOpen(true);
    try {
      setGroups((await officialApi.roster(email)).groups);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    const notes = reason.trim();
    try {
      await officialApi.changeRoster(email, change.id, {
        change:
          level === "team"
            ? { type: "add-team", teamId: entrantId, groupId, name }
            : { type: "add-group", groupId: entrantId, name },
        ...(notes !== "" && { notes }),
        clientCreatedAt: change.clientCreatedAt,
      });
      onAdded();
    } catch (e) {
      setProblem(errorMessage(e));
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className={ui.buttonQuiet} onClick={() => void openForm()}>
        Add to roster
      </button>
    );
  }
  return (
    <div className="flex min-w-40 flex-col gap-2">
      <label className={ui.label}>
        {word} name
        <input
          className={ui.input}
          value={name}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            edited();
          }}
        />
      </label>
      {level === "team" && (
        <label className={ui.label}>
          {labels.group}
          <select
            className={ui.input}
            value={groupId}
            disabled={busy}
            onChange={(e) => {
              setGroupId(e.target.value);
              edited();
            }}
          >
            <option value="">Choose…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={ui.label}>
        Reason (optional)
        <input
          className={ui.input}
          value={reason}
          disabled={busy}
          onChange={(e) => {
            setReason(e.target.value);
            edited();
          }}
        />
      </label>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <button
          className={ui.button}
          disabled={busy}
          onClick={() => void confirm()}
        >
          Confirm add
        </button>
        <button
          className={ui.buttonQuiet}
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
