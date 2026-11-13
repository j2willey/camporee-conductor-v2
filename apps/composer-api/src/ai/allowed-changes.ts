/**
 * What an AI proposal may change (ADR-0030 item 4, amended 2026-11-12): a structural diff against the current
 * document. Pure. The allowed paths are taken out of both documents, and anything else that differs is refused:
 * - an Event (or Template): `title`, `theme`, `introduction`;
 * - an Activity: `title`, `content`, and each scoring field's `label` and `config.placeholder`. The fields themselves
 *   (their ids, order, types, kinds, limits, options, primary metric…) must stay as they are.
 * Returns one line per refused path, sorted; empty when the proposal only changes what it may.
 */
export function proposalIssues(
  kind: "event" | "activity",
  current: unknown,
  proposed: unknown,
): string[] {
  const paths = new Set<string>();
  diff(
    withoutAllowed(kind, current),
    withoutAllowed(kind, proposed),
    "",
    paths,
  );
  return [...paths]
    .sort()
    .map((path) => `${path}: an AI proposal can't change this`);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function withoutAllowed(kind: "event" | "activity", doc: unknown): unknown {
  if (!isObject(doc)) return doc;
  const copy = structuredClone(doc);
  delete copy["title"];
  if (kind === "event") {
    delete copy["theme"];
    delete copy["introduction"];
    return copy;
  }
  delete copy["content"];
  const scoring = copy["scoring"];
  const fields = isObject(scoring) ? scoring["fields"] : undefined;
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isObject(field)) continue;
      delete field["label"];
      const config = field["config"];
      if (isObject(config)) {
        delete config["placeholder"];
        // A config that held only a placeholder is the same as none.
        if (Object.keys(config).length === 0) delete field["config"];
      }
    }
  }
  return copy;
}

/**
 * Adds each path where `a` and `b` differ. A list that changes length differs as a whole (fields added or
 * removed); otherwise lists and objects are compared item by item, so the path names what changed.
 */
function diff(a: unknown, b: unknown, path: string, out: Set<string>): void {
  const at = (key: string | number) => (path ? `${path}.${key}` : String(key));
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.add(path || "(the document)");
      return;
    }
    a.forEach((item, i) => diff(item, b[i], at(i), out));
    return;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff(a[key], b[key], at(key), out);
    }
    return;
  }
  if (a !== b) out.add(path || "(the document)");
}
