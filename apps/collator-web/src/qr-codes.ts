import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { encode } from "uqr";

// The printable QR codes (#41 PR 7, ADR-0023's primary flow): one joins the box's Wi-Fi, one opens the
// judge page, and one per Activity opens that Activity straight away (`?activity=<id>`). They're made in
// the browser from the box's own address, so they work offline and need nothing stored on the box.

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiNetwork {
  ssid: string;
  password: string;
  security: WifiSecurity;
}

// The Wi-Fi QR format reserves \ ; , : and " in the name and password: a backslash escapes them.
const escapeWifi = (s: string) => s.replace(/[\\;,:"]/g, (c) => `\\${c}`);

/** `WIFI:T:WPA;S:<name>;P:<password>;;`: what phone cameras offer to join. */
export function wifiJoinText({
  ssid,
  password,
  security,
}: WifiNetwork): string {
  const pass = security === "nopass" ? "" : `P:${escapeWifi(password)};`;
  return `WIFI:T:${security};S:${escapeWifi(ssid)};${pass};`;
}

/** The judge page on the box, from the address the Official's laptop has it at. */
export function judgePageLink(origin: string): string {
  return new URL("/", origin).href;
}

/** The judge page, opened at one Activity. */
export function activityLink(origin: string, activityId: string): string {
  return `${judgePageLink(origin)}?activity=${encodeURIComponent(activityId)}`;
}

export type ActivityFromLink =
  | { kind: "none" }
  | { kind: "found"; activity: JudgeActivity }
  /** The code names an Activity this event doesn't have, e.g. a printout from an older cartridge. */
  | { kind: "unknown"; id: string };

/** Which Activity the judge page was opened at, from its query string (`location.search`). */
export function activityFromLink(
  search: string,
  activities: readonly JudgeActivity[],
): ActivityFromLink {
  const id = new URLSearchParams(search).get("activity");
  if (id === null || id === "") return { kind: "none" };
  const activity = activities.find((a) => a.id === id);
  return activity ? { kind: "found", activity } : { kind: "unknown", id };
}

/** The code's modules, `dark[row][column]`, with the standard 4-module quiet zone round it. */
export function qrModules(text: string): { size: number; dark: boolean[][] } {
  // Medium error correction: printouts get folded, rained on and taped to posts.
  const { size, data } = encode(text, { ecc: "M", border: 4 });
  return { size, dark: data };
}
