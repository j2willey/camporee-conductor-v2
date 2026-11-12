import type {
  Activity,
  Award,
  Competition,
  Event,
} from "@camporee-conductor/schema";
import { isActivityEnabled } from "@camporee-conductor/schema";

/**
 * Where a section's missing content will come from (ARCHITECTURE §18's four tiers, generic names):
 * Event details, the Venue Profile, the Organization Profile, or the theme.
 */
export type ContentSource = "event" | "venue" | "organization" | "theme";

export type GuideBlock =
  | { kind: "cover"; title: string; lines: string[] }
  | { kind: "paragraph"; text: string }
  /** Text the Event supplies in Markdown, e.g. its introduction (the ADR-0028 subset). */
  | { kind: "markdown"; text: string }
  | { kind: "list"; items: string[] }
  /** Content not in the design yet: names its source and what it will hold. */
  | { kind: "stub"; source: ContentSource; holds: string };

export interface GuideSection {
  /** Stable id, used for anchors and tests. */
  id: string;
  heading: string;
  /** 1 = top-level (starts a printed page), 2 = within the section above it. */
  level: 1 | 2;
  /** Its heading or content comes from the theme, so it can't be final until a theme is chosen. */
  dependsOnTheme: boolean;
  blocks: GuideBlock[];
}

export interface Guide {
  title: string;
  /** Left out of the Event = no theme chosen yet. */
  theme: string | undefined;
  themeColors: Event["presentation"]["themeColors"];
  sections: GuideSection[];
  /** Sections that still hold at least one stub: drives the DRAFT banner. */
  stubCount: number;
}

/** What the guide needs from each Activity. Teasers will need more, later. */
export type GuideActivity = Pick<Activity, "id" | "title">;

const stub = (source: ContentSource, holds: string): GuideBlock => ({
  kind: "stub",
  source,
  holds,
});

/** Naive English plural for a Terminology label ("Troop" → "Troops"). Packs may supply plurals later. */
const plural = (label: string): string => `${label}s`;

/**
 * The Program Guide for an Event (issue #5): an ordered list of sections, following the weekend in order
 * the way the 2026 guide did. Sections the design can't fill yet are stubs that name their source.
 */
export function buildGuide(event: Event, activities: GuideActivity[]): Guide {
  const labels = event.terminology.labels ?? {};
  const eventLabel = labels.event ?? "Event";
  const { theme } = event;
  const themed = (withTheme: (theme: string) => string, without: string) =>
    theme === undefined ? without : withTheme(theme);

  // Trimmed for print: v1 titles can carry stray whitespace (e.g. "The High Wire Act ").
  const titleById = new Map(activities.map((a) => [a.id, a.title.trim()]));
  const competitionById = new Map(event.competitions.map((c) => [c.id, c]));

  const entrants = (competition: Competition): string =>
    plural(
      competition.level === "group"
        ? (labels.group ?? "Group")
        : (labels.team ?? "Team"),
    );

  const competitionSection = (competition: Competition): GuideSection => {
    const listed = competition.programGuide?.listActivities ?? true;
    const titles = event.activities
      .filter(
        (entry) =>
          entry.competitionId === competition.id && isActivityEnabled(entry),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => titleById.get(entry.activityId) ?? "(missing Activity)");
    let blocks: GuideBlock[];
    if (!listed) {
      blocks = [
        {
          kind: "paragraph",
          text: `The ${competition.label} will be announced closer to the ${eventLabel}.`,
        },
      ];
    } else if (titles.length === 0) {
      blocks = [{ kind: "paragraph", text: "None announced yet." }];
    } else {
      blocks = [{ kind: "list", items: titles }];
    }
    return {
      id: `competition-${competition.slug}`,
      heading: competition.label,
      level: 2,
      dependsOnTheme: false,
      blocks,
    };
  };

  const describeAward = (award: Award): string => {
    const competition = competitionById.get(award.competitionId);
    const standings = competition
      ? `the ${competition.label} standings`
      : "the standings";
    const who = competition ? entrants(competition) : "entrants";
    let text: string;
    switch (award.rule.type) {
      case "top-percent":
        text = `${award.label}: the top ${award.rule.percent}% of ${who} in ${standings}.`;
        break;
      case "places":
        text = `${award.label}: by place in ${standings}: ${award.rule.names
          .map((name, i) =>
            name === ordinal(i + 1) ? name : `${name} (${ordinal(i + 1)})`,
          )
          .join(", ")}.`;
        break;
      case "manual":
        text = `${award.label}: chosen by the Officials.`;
        break;
    }
    return award.scope === "division"
      ? `${text} Awarded in each Division.`
      : text;
  };

  const dates = formatDates(event.startDate, event.endDate);
  const venueName = event.venue?.name.trim() ?? "";
  const venueAddress = event.venue?.address.trim() ?? "";
  const coverLines = [
    ...(theme === undefined ? [] : [theme]),
    ...(event.year === undefined ? [] : [String(event.year)]),
    ...(event.organizerName === undefined
      ? []
      : [`Organizer: ${event.organizerName}`]),
    ...(dates === undefined ? [] : [dates]),
    ...(venueName === "" ? [] : [venueName]),
    ...(venueName === "" || venueAddress === "" ? [] : [venueAddress]),
  ];
  const coverStub =
    dates === undefined && venueName === ""
      ? [stub("event", "dates and venue")]
      : dates === undefined
        ? [stub("event", "the dates")]
        : venueName === ""
          ? [stub("event", "the venue")]
          : [];
  const introduction = event.introduction?.trim() ?? "";
  const skills = event.programGuide?.skills ?? [];
  const awards = event.awards ?? [];

  const sections: GuideSection[] = [
    {
      id: "cover",
      heading: event.title,
      level: 1,
      dependsOnTheme: true,
      blocks: [
        { kind: "cover", title: event.title, lines: coverLines },
        ...coverStub,
      ],
    },
    {
      id: "introduction",
      heading: "Introduction",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        introduction === ""
          ? stub("organization", "a welcome to units and what the guide covers")
          : { kind: "markdown", text: event.introduction ?? "" },
      ],
    },
    {
      id: "theme",
      heading: "Theme",
      level: 2,
      dependsOnTheme: true,
      blocks: [
        stub(
          "theme",
          "the theme, and how units can bring it to their campsite, costumes and campfire acts",
        ),
      ],
    },
    {
      id: "planning",
      heading: themed(
        (t) => `Planning for ${t} Adventure`,
        "Planning to Attend",
      ),
      level: 1,
      dependsOnTheme: true,
      blocks: [
        stub("event", "the RSVP and interest survey, and staffing asks"),
      ],
    },
    {
      id: "registration",
      heading: "Registration and Fees",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub(
          "event",
          "the registration link, what the fee covers, and fees and deadlines",
        ),
      ],
    },
    {
      id: "preparing",
      heading: themed(
        (t) => `Preparing for ${t} Adventure`,
        "Preparing to Attend",
      ),
      level: 1,
      dependsOnTheme: true,
      blocks: [
        stub(
          "organization",
          "health forms, release forms, youth protection and equipment",
        ),
      ],
    },
    {
      id: "day-1",
      heading: "Day 1",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub(
          "venue",
          "arrival, drop-off, parking, check-in and campsite setup",
        ),
      ],
    },
    {
      id: "day-2",
      heading: "Day 2",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub("event", "the morning schedule, flags and opening ceremony"),
      ],
    },
    {
      id: "skills",
      heading: "Skills You'll Need",
      level: 2,
      dependsOnTheme: false,
      blocks:
        skills.length > 0
          ? [{ kind: "list", items: skills }]
          : [stub("event", "the skills units should prepare for")],
    },
    ...event.competitions.map(competitionSection),
    {
      id: "evening-program",
      heading: "Evening Program",
      level: 2,
      dependsOnTheme: false,
      blocks: [stub("organization", "the campfire program and recognitions")],
    },
    {
      id: "day-3",
      heading: "Day 3",
      level: 1,
      dependsOnTheme: false,
      blocks: [stub("event", "clean-up, the closing ceremony and check-out")],
    },
    {
      id: "awards",
      heading: "Awards",
      level: 2,
      dependsOnTheme: false,
      blocks:
        awards.length > 0
          ? [{ kind: "list", items: awards.map(describeAward) }]
          : [{ kind: "paragraph", text: "No Awards set yet." }],
    },
    {
      id: "staff-and-recognition",
      heading: "Volunteer Staff and Recognition",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub("organization", "volunteer staff and honor-society recognition"),
      ],
    },
    {
      id: "communications",
      heading: "Communications",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub(
          "event",
          "the registration website, key contacts and where updates appear",
        ),
      ],
    },
    {
      id: "support",
      heading: themed((t) => `${t} Support`, "Volunteer Support"),
      level: 1,
      dependsOnTheme: true,
      blocks: [stub("organization", "where volunteers are needed")],
    },
    {
      id: "general-information",
      heading: "General Information and Requirements",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub(
          "organization",
          "conduct, safety and camp rules, and what's restricted or prohibited",
        ),
      ],
    },
    {
      id: "emergencies",
      heading: "Emergency Procedures",
      level: 1,
      dependsOnTheme: false,
      blocks: [
        stub(
          "venue",
          "first aid, emergency contacts and the evacuation muster point",
        ),
      ],
    },
    {
      id: "theme-ticklers",
      heading: "Theme Ticklers",
      level: 1,
      dependsOnTheme: true,
      blocks: [stub("theme", "background on the theme for units to research")],
    },
    {
      id: "schedule",
      heading: "Schedule",
      level: 1,
      dependsOnTheme: false,
      blocks: [stub("event", "the schedule")],
    },
    {
      id: "directions",
      heading: "Directions",
      level: 1,
      dependsOnTheme: false,
      blocks: [stub("venue", "directions, coordinates and travel time")],
    },
  ];

  return {
    title: event.title,
    theme,
    themeColors: event.presentation.themeColors,
    sections,
    stubCount: sections.filter((s) => s.blocks.some((b) => b.kind === "stub"))
      .length,
  };
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * An Event's dates as people write them: "May 14–16, 2027", "May 30 – June 1, 2027", or across years in full.
 * Read as calendar dates (no time zone). Undefined when there are none.
 */
export function formatDates(
  start: string | undefined,
  end: string | undefined,
): string | undefined {
  const parts = (iso: string) => {
    const [y = "", m = "", d = ""] = iso.split("-");
    return {
      year: y,
      month: MONTHS[Number(m) - 1] ?? m,
      day: String(Number(d)),
    };
  };
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined) {
    const e = parts(end ?? "");
    return `Until ${e.month} ${e.day}, ${e.year}`;
  }
  const s = parts(start);
  const full = (p: typeof s) => `${p.month} ${p.day}, ${p.year}`;
  if (end === undefined || end === start) return full(s);
  const e = parts(end);
  if (s.year !== e.year) return `${full(s)} – ${full(e)}`;
  if (s.month !== e.month) {
    return `${s.month} ${s.day} – ${e.month} ${e.day}, ${e.year}`;
  }
  return `${s.month} ${s.day}–${e.day}, ${e.year}`;
}
