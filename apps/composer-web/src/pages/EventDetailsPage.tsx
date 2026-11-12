import type { Contact, Event } from "@camporee-conductor/schema";
import {
  DEFAULT_THEME_COLORS,
  setDate,
  setLabel,
  setYear,
} from "../event-details.ts";
import { ui } from "../ui.ts";
import { moveItem, removeItem, replaceItem } from "../draft.ts";
import { Area, Card, RowButtons, StringList, Text } from "./editing.tsx";
import { EventEditorPage } from "./EventEditor.tsx";

type Colors = Event["presentation"]["themeColors"];

const COLORS: { key: keyof Colors; label: string; use: string }[] = [
  { key: "main", label: "Main", use: "the line under titles, the cover label" },
  { key: "header", label: "Header", use: "heading text" },
  { key: "accent", label: "Accent", use: "not printed yet" },
];

const LABELS: {
  key: "event" | "group" | "team" | "participant";
  label: string;
  example: string;
}[] = [
  { key: "event", label: "The Event", example: "Camporee" },
  { key: "group", label: "A Group", example: "Troop" },
  { key: "team", label: "A Team", example: "Patrol" },
  { key: "participant", label: "A Participant", example: "Scout" },
];

/**
 * The Event's details (#6 PR 7): title, theme, year, dates, organizer, what this pack calls its people
 * (ADR-0003), the theme colors (with v1's "reset to defaults"), tie numbering and the Program Guide's skills.
 * Saved with the Event (ADR-0029). Venue, introduction and contacts too (ADR-0029 item 8, PR 8).
 */
export function EventDetailsPage() {
  return (
    <EventEditorPage heading="Event details">
      {({ draft, setDraft }) => <Details draft={draft} setDraft={setDraft} />}
    </EventEditorPage>
  );
}

function Details({
  draft,
  setDraft,
}: {
  draft: Event;
  setDraft: (event: Event) => void;
}) {
  const colors = draft.presentation.themeColors;
  const setColors = (themeColors: Colors) =>
    setDraft({
      ...draft,
      presentation: { ...draft.presentation, themeColors },
    });
  const labels = draft.terminology.labels ?? {};
  return (
    <>
      <Card title="The Event">
        <Text
          label="Title"
          value={draft.title}
          onChange={(title) => setDraft({ ...draft, title })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text
            label="Theme"
            value={draft.theme ?? ""}
            onChange={(theme) => setDraft({ ...draft, theme })}
          />
          <label className={ui.label}>
            Year
            <input
              className={ui.input}
              type="number"
              step={1}
              value={draft.year ?? ""}
              onChange={(e) => setDraft(setYear(draft, e.target.value))}
            />
          </label>
          <label className={ui.label}>
            Starts
            <input
              className={ui.input}
              type="date"
              value={draft.startDate ?? ""}
              onChange={(e) =>
                setDraft(setDate(draft, "startDate", e.target.value))
              }
            />
          </label>
          <label className={ui.label}>
            Ends
            <input
              className={ui.input}
              type="date"
              value={draft.endDate ?? ""}
              onChange={(e) =>
                setDraft(setDate(draft, "endDate", e.target.value))
              }
            />
          </label>
        </div>
        <Text
          label="Organizer (person or committee)"
          value={draft.organizerName ?? ""}
          onChange={(organizerName) => setDraft({ ...draft, organizerName })}
        />
        <p className={ui.muted}>
          Slug: <code>{draft.slug}</code> (names its cartridges; it doesn't
          change).
        </p>
      </Card>

      <Card title="Venue and introduction">
        <div className="grid gap-3 sm:grid-cols-2">
          <Text
            label="Venue"
            value={draft.venue?.name ?? ""}
            onChange={(name) =>
              setDraft({
                ...draft,
                venue: { name, address: draft.venue?.address ?? "" },
              })
            }
          />
          <Text
            label="Venue address"
            value={draft.venue?.address ?? ""}
            onChange={(address) =>
              setDraft({
                ...draft,
                venue: { name: draft.venue?.name ?? "", address },
              })
            }
          />
        </div>
        <Area
          label="Introduction (the Program Guide's welcome, in Markdown)"
          rows={8}
          value={draft.introduction ?? ""}
          onChange={(introduction) => setDraft({ ...draft, introduction })}
        />
      </Card>

      <Card title="Contacts">
        <p className={ui.muted}>
          Who to contact about the Event, e.g. the director. Personal data: kept
          in this Event's own cartridges, and taken out of anything shared
          beyond it (Templates, the library).
        </p>
        <Contacts
          contacts={draft.contacts ?? []}
          onChange={(contacts) => setDraft({ ...draft, contacts })}
        />
      </Card>

      <Card title="What people are called">
        <p className={ui.muted}>
          The words shown on screens and in print. Left blank, the pack's own
          word is used.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LABELS.map(({ key, label, example }) => (
            <label key={key} className={ui.label}>
              {label}
              <input
                className={ui.input}
                placeholder={`e.g. ${example}`}
                value={labels[key] ?? ""}
                onChange={(e) => setDraft(setLabel(draft, key, e.target.value))}
              />
            </label>
          ))}
        </div>
        <Text
          label="Pack"
          value={draft.terminology.pack}
          onChange={(pack) =>
            setDraft({
              ...draft,
              terminology: { ...draft.terminology, pack },
            })
          }
        />
      </Card>

      <Card title="Theme colors">
        <p className={ui.muted}>
          Used by the Program Guide and the Activity guides. The judge page
          doesn't use them yet.
        </p>
        <div className="flex flex-wrap gap-4">
          {COLORS.map(({ key, label, use }) => (
            <div key={key} className={ui.label}>
              <span>
                {label}{" "}
                <span className="font-normal text-stone-500">({use})</span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-14 cursor-pointer rounded border border-stone-300"
                  aria-label={`${label} color picker`}
                  value={colors[key]}
                  onChange={(e) =>
                    setColors({ ...colors, [key]: e.target.value })
                  }
                />
                <input
                  className={`${ui.input} w-28 font-mono text-sm`}
                  aria-label={`${label} color`}
                  value={colors[key]}
                  onChange={(e) =>
                    setColors({ ...colors, [key]: e.target.value })
                  }
                />
              </span>
            </div>
          ))}
        </div>
        <div
          className="flex overflow-hidden rounded-md border border-stone-200 text-sm"
          aria-hidden
        >
          <span
            className="flex-1 px-3 py-2 font-semibold"
            style={{
              color: colors.header,
              borderBottom: `3px solid ${colors.main}`,
            }}
          >
            A heading
          </span>
          <span
            className="flex-1 px-3 py-2 text-xs font-semibold tracking-widest uppercase"
            style={{ color: colors.main }}
          >
            Cover label
          </span>
          <span
            className="flex-1 px-3 py-2"
            style={{ borderBottom: `4px solid ${colors.accent}` }}
          >
            Accent
          </span>
        </div>
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() => setColors({ ...DEFAULT_THEME_COLORS })}
        >
          Reset to defaults
        </button>
      </Card>

      <Card title="Ties and the Program Guide">
        <label className={`${ui.label} max-w-md`}>
          Numbering tied places
          <select
            className={ui.input}
            value={draft.tieNumbering ?? "dense"}
            onChange={(e) =>
              setDraft({
                ...draft,
                tieNumbering: e.target.value as Event["tieNumbering"],
              })
            }
          >
            <option value="dense">1, 1, 2 (next place follows on)</option>
            <option value="strict">1, 1, 3 (places are skipped)</option>
          </select>
        </label>
        <StringList
          label="Skills units should prepare (Program Guide)"
          item="skill"
          items={draft.programGuide?.skills ?? []}
          multiline={false}
          onChange={(skills) =>
            setDraft({ ...draft, programGuide: { skills } })
          }
        />
      </Card>
    </>
  );
}

const CONTACT_FIELDS: { key: keyof Contact; label: string; type: string }[] = [
  { key: "role", label: "Role", type: "text" },
  { key: "name", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
];

function Contacts({
  contacts,
  onChange,
}: {
  contacts: Contact[];
  onChange: (contacts: Contact[]) => void;
}) {
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {contacts.map((contact, index) => {
          const name = `contact ${index + 1}`;
          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              {CONTACT_FIELDS.map(({ key, label, type }) => (
                <input
                  key={key}
                  className={`${ui.input} min-w-36 flex-1`}
                  type={type}
                  aria-label={`${label} of ${name}`}
                  placeholder={label}
                  value={contact[key]}
                  onChange={(e) =>
                    onChange(
                      replaceItem(contacts, index, {
                        ...contact,
                        [key]: e.target.value,
                      }),
                    )
                  }
                />
              ))}
              <RowButtons
                name={name}
                index={index}
                count={contacts.length}
                onMove={(step) => onChange(moveItem(contacts, index, step))}
                onRemove={() => onChange(removeItem(contacts, index))}
              />
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() =>
          onChange([...contacts, { role: "", name: "", email: "", phone: "" }])
        }
      >
        + Add contact
      </button>
    </div>
  );
}
