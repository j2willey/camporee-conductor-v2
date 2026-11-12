import { useState } from "react";

/**
 * Fetches a file through the signed-in client and saves it (#100): a plain link wouldn't carry the sign-in
 * headers. The name comes from the response's Content-Disposition, else `fallbackName`. A refusal shows the
 * API's message (e.g. what an event-day cartridge is missing).
 */
export function useDownload(
  fetchFile: () => Promise<Response>,
  fallbackName: string,
) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const response = await fetchFile();
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? response.statusText);
      }
      const name =
        /filename="([^"]+)"/.exec(
          response.headers.get("content-disposition") ?? "",
        )?.[1] ?? fallbackName;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return { download, downloading, error };
}
