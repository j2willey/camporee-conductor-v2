// Shared Tailwind classes, phone-first: big touch targets, one column.
export const ui = {
  h1: "text-xl font-semibold tracking-tight",
  h2: "text-lg font-semibold",
  card: "rounded-lg border border-stone-200 bg-white p-4 shadow-sm",
  muted: "text-sm text-stone-500",
  label: "flex flex-col gap-1 text-sm font-medium text-stone-700",
  input:
    "rounded-md border border-stone-300 px-3 py-2 text-base font-normal focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none disabled:bg-stone-100",
  button:
    "rounded-md bg-teal-700 px-4 py-3 text-base font-medium text-white hover:bg-teal-800 disabled:opacity-50",
  buttonQuiet:
    "rounded-md border border-stone-300 bg-white px-4 py-3 text-base hover:bg-stone-100",
  choice:
    "w-full rounded-md border border-stone-200 bg-white px-4 py-3 text-left text-base hover:border-teal-600 hover:bg-teal-50",
  link: "text-sm text-teal-700 underline underline-offset-2",
  error: "rounded-md bg-red-50 px-3 py-2 text-sm text-red-800",
  warning: "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900",
  success: "rounded-md bg-teal-50 px-3 py-3 text-base text-teal-900",
};
