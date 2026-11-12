import { useState } from "react";
import { boxApi, errorMessage, type CartridgeLoaded } from "../api.ts";
import { ui } from "../ui.ts";

/**
 * Loads the event-day cartridge from the Composer (ADR-0027, #100 PR 5, provisional), as `load-cartridge` does on
 * the console. On an empty box (`email` absent) it asks for the setup code unless the box's first load is open;
 * once an Event is loaded, the signed-in Director loads a new version.
 */
export function LoadCartridge({
  email,
  needsCode,
  currentTitle,
  onLoaded,
  onBack,
}: {
  /** The signed-in Director, when an Event is loaded. */
  email?: string;
  /** Empty box with FIRST_LOAD=code: ask for the setup code. */
  needsCode: boolean;
  /** The loaded Event's title, when there is one. */
  currentTitle?: string;
  onLoaded: (loaded: CartridgeLoaded) => void;
  onBack?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async () => {
    if (!file) return;
    setLoading(true);
    setProblem(null);
    try {
      onLoaded(
        await boxApi.loadCartridge(file, {
          ...(email !== undefined && { email }),
          ...(needsCode && { setupCode }),
        }),
      );
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Load the event-day cartridge"
      onSubmit={(e) => {
        e.preventDefault();
        void load();
      }}
    >
      {onBack && (
        <button
          type="button"
          className={`${ui.link} self-start`}
          onClick={onBack}
        >
          ← Back
        </button>
      )}
      <h1 className={ui.h1}>Load the event-day cartridge</h1>
      <p className={ui.muted}>
        {currentTitle
          ? `This box holds ${currentTitle}. Load a new version of it, downloaded from the Composer after a change. Its roster and scores stay. A different Event is refused while the box holds roster or scores.`
          : "No Event is loaded on this box yet. Download the event-day cartridge from the Composer's Event page, then load it here."}
      </p>
      {problem && (
        <p className={`${ui.error} whitespace-pre-line`} role="alert">
          {problem}
        </p>
      )}
      <label className={ui.label}>
        Cartridge (.zip)
        <input
          type="file"
          accept=".zip,application/zip"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {needsCode && (
        <label className={ui.label}>
          Setup code
          <input
            className={ui.input}
            value={setupCode}
            onChange={(e) => setSetupCode(e.target.value)}
            autoComplete="off"
            required
          />
          <span className={ui.muted}>
            It's in the box's settings (SETUP_CODE), or in its log when it
            started.
          </span>
        </label>
      )}
      <button className={ui.button} type="submit" disabled={!file || loading}>
        {loading ? "Loading…" : "Load"}
      </button>
    </form>
  );
}
