import { Link, Outlet } from "react-router";
import { useSession } from "../auth.tsx";

export function Layout() {
  const session = useSession();
  return (
    <>
      <header>
        <Link to="/">Composer</Link>
        {session.status === "signed-in" && (
          <>
            {" · "}
            {session.email}{" "}
            <button type="button" onClick={session.signOut}>
              Sign out
            </button>
          </>
        )}
      </header>
      <main>
        {session.status === "loading" && <p>Loading…</p>}
        {session.status === "signed-out" && session.signInView}
        {session.status === "signed-in" && <Outlet />}
      </main>
    </>
  );
}
