// Registers the service worker that keeps the judge app on the phone (#41 PR 3; sw-template.js). Only in
// the built app, and only where the browser allows it (HTTPS or localhost).
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No service worker: the page still works while the box can be reached.
    });
  });
}
