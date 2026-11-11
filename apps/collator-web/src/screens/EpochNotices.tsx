import { dismissNotice, useNotices } from "../phone-notices.ts";
import { ui } from "../ui.ts";

/** What the phone did after the box was reset or restored (#66). */
export function EpochNotices() {
  return useNotices().map((note) => (
    <div key={note} className={ui.warning} role="status">
      <p>{note}</p>
      <button
        type="button"
        className={`${ui.link} mt-1`}
        onClick={() => dismissNotice(note)}
      >
        OK
      </button>
    </div>
  ));
}
