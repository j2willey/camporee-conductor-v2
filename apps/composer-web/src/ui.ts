// Shared Tailwind classes, so the pages stay consistent without a component library.
export const ui = {
  h1: "text-2xl font-semibold tracking-tight",
  h2: "text-lg font-semibold",
  card: "rounded-lg border border-stone-200 bg-white p-4 shadow-sm",
  link: "text-teal-700 underline-offset-2 hover:underline",
  muted: "text-sm text-stone-500",
  label: "flex flex-col gap-1 text-sm font-medium text-stone-700",
  input:
    "rounded-md border border-stone-300 px-3 py-1.5 text-base font-normal focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none",
  button:
    "rounded-md bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50",
  buttonQuiet:
    "rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100",
  error: "rounded-md bg-red-50 px-3 py-2 text-sm text-red-800",
  success: "rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900",
};
