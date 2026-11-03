import { Link } from "react-router";
import { ApiError } from "../api.ts";
import { ui } from "../ui.ts";

/** A failed form action, in the API's own words. */
export function ErrorMessage({ error }: { error: Error }) {
  return (
    <p role="alert" className={ui.error}>
      {error.message}
    </p>
  );
}

/**
 * A page that couldn't load. A 404 replaces the whole page; it also covers "not a member", which the API
 * doesn't distinguish, so an Organization's existence isn't revealed.
 */
export function PageError({ error }: { error: Error }) {
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound message="Not found, or you're not a member." />;
  }
  return <ErrorMessage error={error} />;
}

export function NotFound({ message = "There's no page here." }) {
  return (
    <div className="space-y-4">
      <h1 className={ui.h1}>Not found</h1>
      <p role="alert" className="text-stone-600">
        {message}
      </p>
      <p>
        <Link to="/" className={ui.link}>
          ← Your Organizations
        </Link>
      </p>
    </div>
  );
}

export function Loading() {
  return <p className={ui.muted}>Loading…</p>;
}
