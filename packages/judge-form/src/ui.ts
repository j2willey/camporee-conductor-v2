// The judge page's Tailwind classes the form uses, phone-first: big touch targets. Copied unchanged from
// apps/collator-web/src/ui.ts, so the judge page looks exactly as before. Apps that render the form add this
// folder to Tailwind's sources (`@source` in their index.css).
export const ui = {
  label: "flex flex-col gap-1 text-sm font-medium text-stone-700",
  input:
    "rounded-md border border-stone-300 px-3 py-2 text-base font-normal focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none disabled:bg-stone-100",
  button:
    "rounded-md bg-teal-700 px-4 py-3 text-base font-medium text-white hover:bg-teal-800 disabled:opacity-50",
  buttonQuiet:
    "rounded-md border border-stone-300 bg-white px-4 py-3 text-base hover:bg-stone-100",
};
