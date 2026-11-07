import { errorMessage, wasRefused } from "../api.ts";
import { ui } from "../ui.ts";

/**
 * Why the page couldn't load what it needs. Red only when the box answered and said no; when it couldn't
 * be reached, a hint (#41). Android's Chrome needs the "Nearby devices" permission to reach a box on the
 * local network, and gives no hint of its own.
 */
export function LoadProblem({ error }: { error: unknown }) {
  if (wasRefused(error)) {
    return (
      <p className={ui.error} role="alert">
        {errorMessage(error)}
      </p>
    );
  }
  return (
    <div className={`${ui.warning} flex flex-col gap-2`} role="alert">
      <p>
        Can't reach the scoring box. Check this phone is on the scoring box's
        Wi-Fi, then reload.
      </p>
      <p>
        <strong>Android:</strong> Settings → Apps → Chrome → Permissions →
        Nearby devices → Allow.
      </p>
      <p>
        <strong>iPhone:</strong> use Safari.
      </p>
    </div>
  );
}
