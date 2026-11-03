import { ApiError } from "../api.ts";

/** An API failure in words. 404 also covers "not a member", which the API doesn't distinguish. */
export function ErrorMessage({ error }: { error: Error }) {
  if (error instanceof ApiError && error.status === 404) {
    return <p role="alert">Not found, or you're not a member.</p>;
  }
  return <p role="alert">{error.message}</p>;
}
