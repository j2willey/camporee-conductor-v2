import type { OfficialEvent } from "@camporee-conductor/collator/types";
import { useState } from "react";
import {
  activityLink,
  judgePageLink,
  wifiJoinText,
  type WifiSecurity,
} from "../qr-codes.ts";
import { ui } from "../ui.ts";
import { QrCode } from "./QrCode.tsx";

type Activity = OfficialEvent["activities"][number];

/**
 * The QR codes to print (#41 PR 7, ADR-0023): join the Wi-Fi, open the judge page, and one per Activity
 * for its Station. The links use the address this laptop has the box at, which is the one phones use.
 * The Wi-Fi name and password are typed here, as in v1, and never sent to the box or kept.
 */
export function QrCodesPage({
  eventTitle,
  activities,
  onBack,
}: {
  eventTitle: string;
  activities: readonly Activity[];
  onBack: () => void;
}) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const origin = window.location.origin;
  const judgePage = judgePageLink(origin);
  const competitions = [
    ...new Map(
      activities.map((a) => [a.competition.id, a.competition]),
    ).values(),
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 print:hidden">
        <button className={`${ui.link} self-start`} onClick={onBack}>
          ← Activities
        </button>
        <h1 className={ui.h1}>QR codes to print</h1>
        <p className={ui.muted}>
          Post the Wi-Fi and judge page codes where Judges sign in, and each
          Activity's code at its Station. The links are for {judgePage}: print
          from the laptop that reaches the box at the address phones use.
        </p>
        <fieldset className={`${ui.card} flex flex-col gap-3`}>
          <legend className="px-1 text-sm font-medium">
            The box's Wi-Fi (not kept)
          </legend>
          <label className={ui.label}>
            Wi-Fi name
            <input
              className={ui.input}
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={ui.label}>
            Security
            <select
              className={ui.input}
              value={security}
              onChange={(e) => setSecurity(e.target.value as WifiSecurity)}
            >
              <option value="WPA">WPA/WPA2/WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">None (open)</option>
            </select>
          </label>
          {security !== "nopass" && (
            <label className={ui.label}>
              Wi-Fi password
              <input
                className={ui.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <p className={ui.muted}>
            Leave the name empty to print without a Wi-Fi code.
          </p>
        </fieldset>
        <button className={ui.button} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
        {ssid.trim() !== "" && (
          <Card
            heading="1. Join the Wi-Fi"
            sub={eventTitle}
            text={wifiJoinText({ ssid: ssid.trim(), password, security })}
            caption={
              security === "nopass"
                ? `Wi-Fi: ${ssid.trim()}`
                : `Wi-Fi: ${ssid.trim()} · Password: ${password}`
            }
          />
        )}
        <Card
          heading={ssid.trim() !== "" ? "2. Open the judge page" : "Judge page"}
          sub={eventTitle}
          text={judgePage}
          caption={judgePage}
        />
      </div>

      {competitions.map((competition) => (
        <section
          key={competition.id}
          className="flex flex-col gap-2 print:break-before-page"
        >
          <h2 className={ui.h2}>{competition.label}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
            {activities
              .filter((a) => a.competition.id === competition.id)
              .map((activity) => {
                return (
                  <Card
                    key={activity.id}
                    heading={activity.title}
                    sub={`Judges: scan to score ${activity.title}`}
                    text={activityLink(origin, activity.id)}
                    // The link has the Activity's id, too long to type: the page and the title instead.
                    caption={`Or open ${judgePage} and pick ${activity.title}`}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </section>
  );
}

function Card({
  heading,
  sub,
  text,
  caption,
}: {
  heading: string;
  sub: string;
  text: string;
  caption: string;
}) {
  return (
    <figure
      className={`${ui.card} flex break-inside-avoid flex-col items-center gap-2 text-center`}
    >
      <h3 className="text-lg font-semibold">{heading}</h3>
      <p className={ui.muted}>{sub}</p>
      <QrCode text={text} label={`QR code: ${heading}`} />
      {/* The text too, for a phone whose camera won't read the code. */}
      <figcaption className="text-sm break-all text-stone-700">
        {caption}
      </figcaption>
    </figure>
  );
}
