import type { Activity, Event } from "@camporee-conductor/schema";

export type SuppliesListLine =
  | { kind: "group"; text: string }
  | { kind: "item"; text: string; sub: boolean };

export interface SuppliesList {
  title: string;
  entries: { number?: string; title: string; lines: SuppliesListLine[] }[];
}

export function buildSuppliesList(
  _event: Event,
  _activities: Activity[],
): SuppliesList {
  throw new Error("not implemented");
}

export function renderSuppliesListHtml(
  _list: SuppliesList,
  _options: { perPage?: boolean } = {},
): string {
  throw new Error("not implemented");
}
