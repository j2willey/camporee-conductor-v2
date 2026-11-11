import type { Activity, Event } from "@camporee-conductor/schema";

export type GuideBlock = never;
export interface ActivityGuide {
  id: string;
  title: string;
  number?: string;
  competitionLabel: string;
  tags: string[];
  parts: never[];
}

export function buildActivityGuide(
  _event: Event,
  _activity: Activity,
  _options?: { number?: string },
): ActivityGuide {
  throw new Error("not implemented");
}

export function renderActivityGuidesHtml(
  _event: Event,
  _guides: ActivityGuide[],
): string {
  throw new Error("not implemented");
}
