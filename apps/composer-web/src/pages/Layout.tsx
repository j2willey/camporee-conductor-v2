import { Link, Outlet } from "react-router";
import { useSession } from "../auth.tsx";
import { ui } from "../ui.ts";
import { Loading } from "./ErrorMessage.tsx";

export function Layout() {
  const session = useSession();
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            Composer
          </Link>
          {session.status === "signed-in" && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-stone-600">{session.email}</span>
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
        {session.status === "signed-in" && <Outlet />}
      </main>
    </div>
  );
}
