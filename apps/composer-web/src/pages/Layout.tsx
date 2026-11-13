import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "react-router";
import { ApiError, client, data } from "../api.ts";
import { useSession } from "../auth.tsx";
import { ui } from "../ui.ts";
import { Loading } from "./ErrorMessage.tsx";

export function Layout() {
  const session = useSession();
  // Who's signed in, for the Admin link and a suspended account (ADR-0032).
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => data(client.api.me.$get()),
    enabled: session.status === "signed-in",
  });
  const suspended = me.error instanceof ApiError && me.error.status === 403;
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-4">
            <Link to="/" className="font-semibold tracking-tight">
              Composer
            </Link>
            {session.status === "signed-in" && (
              <Link to="/library" className={`${ui.link} text-sm`}>
                Library
              </Link>
            )}
            {me.data?.sysadmin && (
              <Link to="/admin" className={`${ui.link} text-sm`}>
                Admin
              </Link>
            )}
          </nav>
          {session.status === "signed-in" && (
            <div className="flex items-center gap-3 text-sm">
              <Link
                to="/me"
                className="text-stone-600 underline-offset-2 hover:underline"
                title="Your profile"
              >
                {me.data?.displayName ?? session.email}
              </Link>
              <button
                type="button"
                onClick={session.signOut}
                className={ui.buttonQuiet}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {session.status === "loading" && <Loading />}
        {session.status === "signed-out" && session.signInView}
        {session.status === "signed-in" &&
          (suspended ? (
            <div className="space-y-2">
              <h1 className={ui.h1}>Account suspended</h1>
              <p role="alert" className="text-stone-600">
                {me.error?.message} If you think this is a mistake, contact the
                Composer's administrator.
              </p>
            </div>
          ) : (
            <Outlet />
          ))}
      </main>
    </div>
  );
}
