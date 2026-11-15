/* global document, location, navigator, setTimeout, URLSearchParams -- browser code, served as-is by the demo hub */
// Where the demo's apps live. On demo.<domain> they are collator-demo.<domain> and composer-demo.<domain>;
// anywhere else (a local test) pass them in the URL: ?collator=http://localhost:3030&composer=http://localhost:3010
const params = new URLSearchParams(location.search);
const domain = location.hostname.startsWith("demo.")
  ? location.hostname.slice("demo.".length)
  : null;

export const DEMO_OFFICIAL_EMAIL = "demo@camporeeconductor.com";

export const urls = {
  collator:
    params.get("collator") ??
    (domain ? `https://collator-demo.${domain}` : "http://localhost:3030"),
  composer:
    params.get("composer") ??
    (domain ? `https://composer-demo.${domain}` : "http://localhost:3010"),
};

/** Keeps the local-test parameters on links between the hub's own pages. */
export const withParams = (path) =>
  domain || !location.search ? path : `${path}${location.search}`;

/** Fills every element carrying data-href / data-src / data-text from the values above. */
export function fill(root = document) {
  const values = {
    collator: urls.collator,
    official: `${urls.collator}/official`,
    composer: urls.composer,
    phone: withParams("phone.html"),
    hub: withParams("./"),
    "official-email": DEMO_OFFICIAL_EMAIL,
  };
  for (const el of root.querySelectorAll("[data-href]")) {
    el.href = values[el.dataset.href];
  }
  for (const el of root.querySelectorAll("[data-src]")) {
    el.src = values[el.dataset.src];
  }
  for (const el of root.querySelectorAll("[data-text]")) {
    el.textContent = values[el.dataset.text];
  }
}

/** A "copy" button next to the demo Official's email. */
export function copyButtons(root = document) {
  for (const button of root.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(DEMO_OFFICIAL_EMAIL);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select and copy";
      }
      setTimeout(() => (button.textContent = "Copy"), 2000);
    });
  }
}
