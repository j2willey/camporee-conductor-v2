import { useState } from "react";
import { ApiError } from "./api.ts";

/**
 * Fetches a page of HTML through the signed-in client and opens it in a new tab (issues #5, #44). A plain
 * link wouldn't carry the sign-in headers, so the page is shown from a blob: URL: a standalone page the
 * browser can print to PDF.
 */
export function useOpenHtmlInNewTab(
  fetchPage: () => Promise<Response>,
  failure: string,
) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function open() {
    setError(null);
    setOpening(true);
    // Opened during the click, before any await, so pop-up blockers allow it.
    const tab = window.open("", "_blank");
    try {
      const response = await fetchPage();
      if (!response.ok) throw new ApiError(response.status, failure);
      const html = await response.text();
      // Not revoked: the tab keeps it so a reload still works; it goes when this app's tab closes.
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  return { open, opening, error };
}
