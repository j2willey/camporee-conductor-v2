import type {
  Activity,
  CommonFieldSet,
  Competition,
} from "@camporee-conductor/schema";
import { fillVariables, mergeCommonFields } from "@camporee-conductor/scoring";
import type { FormField } from "./field.ts";

/**
 * The fields a Judge's form shows for an Activity: its Competition's Common Fields merged in (ADR-0020),
 * `{{variables}}` filled, Judge fields only. The same steps, from packages/scoring, as the Collator's
 * `judgeEvent` (apps/collator/src/judge-event.ts), so the Composer's preview is the judge's form.
 */
export function judgeFormFields(
  activity: Activity,
  competition: Competition,
  commonFieldSets: readonly CommonFieldSet[],
): FormField[] {
  return fillVariables(
    mergeCommonFields(activity, competition, commonFieldSets),
    activity.variables ?? {},
  )
    .filter((f) => f.audience === "judge")
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      config: f.config ?? {},
    }));
}
