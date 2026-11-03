import { ClerkProvider, SignIn, useAuth, useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { client, data, setAuthHeaders } from "./api.ts";

export type Session =
  | { status: "loading" }
  | { status: "signed-out"; signInView: ReactNode }
  | { status: "signed-in"; email: string; signOut: () => void };

const SessionContext = createContext<Session>({ status: "loading" });

export const useSession = (): Session => useContext(SessionContext);

/** Shows the sign-in the API is configured for: Clerk, or the dev sign-in (never in production). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => data(client["auth-config"].$get()),
    staleTime: Infinity,
  });
  if (config.isPending) return <p>Loading…</p>;
  if (config.isError) return <p>Can't reach the Composer API.</p>;
  return config.data.adapter === "clerk" ? (
    <ClerkProvider publishableKey={config.data.publishableKey}>
      <ClerkSession>{children}</ClerkSession>
    </ClerkProvider>
  ) : (
    <DevSession>{children}</DevSession>
  );
}

function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  // Set during render, so it's in place before any child query fetches.
  setAuthHeaders(async () => {
    const token = await getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  });
  const session: Session = !isLoaded
    ? { status: "loading" }
    : !isSignedIn
      ? { status: "signed-out", signInView: <SignIn routing="hash" /> }
      : {
          status: "signed-in",
          email: user?.primaryEmailAddress?.emailAddress ?? "",
          signOut: () => void signOut(),
        };
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

const DEV_USER_KEY = "composer.devUser";

function readDevUser(): string | null {
  try {
    return localStorage.getItem(DEV_USER_KEY);
  } catch {
    return null;
  }
}

function writeDevUser(email: string | null): void {
  try {
    if (email) localStorage.setItem(DEV_USER_KEY, email);
    else localStorage.removeItem(DEV_USER_KEY);
  } catch {
    // Storage blocked: the sign-in lasts until the page reloads.
  }
}

/** Dev sign-in: type any email. The API trusts it only in development and test (issue #4, D7). */
function DevSession({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(readDevUser);
  setAuthHeaders(() => Promise.resolve(email ? { "x-dev-user": email } : {}));
  const change = (next: string | null) => {
    writeDevUser(next);
    queryClient.removeQueries({
      predicate: (q) => q.queryKey[0] !== "auth-config",
    });
    setEmail(next);
  };
  const session: Session = email
    ? { status: "signed-in", email, signOut: () => change(null) }
    : {
        status: "signed-out",
        signInView: <DevSignIn onSignIn={(e) => change(e)} />,
      };
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

function DevSignIn({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (trimmed) onSignIn(trimmed);
  };
  return (
    <form onSubmit={submit}>
      <h1>Sign in (development)</h1>
      <p>Dev sign-in: any email works. The API refuses this in production.</p>
      <label>
        Email{" "}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </label>{" "}
      <button type="submit">Sign in</button>
    </form>
  );
}
