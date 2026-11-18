/** The v1 data can't be imported; `issues` says why, one line per problem, naming the game or entry. */
export class V1ImportError extends Error {
  override name = "V1ImportError";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`v1 import refused:\n${issues.join("\n")}`);
    this.issues = issues;
  }
}
