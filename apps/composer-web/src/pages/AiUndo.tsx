import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ui } from "../ui.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

/** What an Undo puts back: the document from before an AI accept, and the `updatedAt` the accept saved. */
export interface AiUndo<T> {
  previous: T;
  after: number;
}

/**
 * The Undo for a document's last AI change (ADR-0030 item 3, #103 PR 4). Kept in the query cache, so it outlives the
 * editor's fresh draft after the accept, but only for this page visit. Offered while nothing has been saved since
 * (`after` is still the stored `updatedAt`), as v1's snapshot lasted until the next edit.
 */
export function useAiUndo<T>(documentId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["ai-undo", documentId];
  const { data } = useQuery<AiUndo<T> | null>({
    queryKey,
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    enabled: false,
  });
  return {
    undo: data,
    remember: (undo: AiUndo<T>) => queryClient.setQueryData(queryKey, undo),
    forget: () => queryClient.setQueryData(queryKey, null),
  };
}

/** "AI change saved. Undo", while the last AI change is still the latest save and there are no unsaved changes. */
export function UndoAiChange<T>({
  documentId,
  updatedAt,
  dirty,
  save,
  onUndone,
}: {
  documentId: string;
  updatedAt: number;
  dirty: boolean;
  /** Saves `previous` as an undo (the AI accept route, feature `undo`, with If-Match `updatedAt`). */
  save: (previous: T, updatedAt: number) => Promise<unknown>;
  onUndone: () => Promise<unknown>;
}) {
  const { undo, forget } = useAiUndo<T>(documentId);
  const run = useMutation({
    mutationFn: (previous: T) => save(previous, updatedAt),
    onSuccess: () => {
      forget();
      return onUndone();
    },
  });
  if (!undo || undo.after !== updatedAt) return null;
  return (
    <div
      aria-live="polite"
      aria-label="Undo AI change"
      role="region"
      className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <span>AI change saved.</span>
      <button
        type="button"
        className={ui.buttonQuiet}
        disabled={dirty || run.isPending}
        title={dirty ? "Save or discard your changes first." : undefined}
        onClick={() => run.mutate(undo.previous)}
      >
        Undo AI change
      </button>
      {run.error && <ErrorMessage error={run.error} />}
    </div>
  );
}
