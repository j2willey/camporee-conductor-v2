/**
 * Which build this is, in small grey text (#41): so whoever tests a phone can see it's the build they
 * meant, without asking the box. Filled in by vite.config.ts.
 */
export function BuildStamp() {
  const built = new Date(__BUILD__.time);
  const when = Number.isNaN(built.getTime())
    ? __BUILD__.time
    : built.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <footer className="mt-10 text-xs text-stone-400">
      Build {__BUILD__.commit} · {when}
    </footer>
  );
}
