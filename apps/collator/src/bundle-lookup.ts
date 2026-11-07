import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { ScoringField } from "@camporee-conductor/schema";
import { mergeCommonFields } from "@camporee-conductor/scoring";

// Looking things up in the loaded Event's bundle. Shared by the judge view, score checks and the Official view.

/** Every field scored at the Activity, Common Fields included (`mergeCommonFields`), or undefined. */
export function activityFields(
  bundle: CheckedBundle,
  activityId: string,
):
  | {
      activity: CheckedBundle["activities"][number];
      competition: CheckedBundle["event"]["competitions"][number];
      fields: ScoringField[];
    }
  | undefined {
  const listed = bundle.event.activities.find(
    (a) => a.activityId === activityId,
  );
  const activity = bundle.activities.find((a) => a.id === activityId);
  const competition = bundle.event.competitions.find(
    (c) => c.id === listed?.competitionId,
  );
  if (!listed || !activity || !competition) return undefined;
  return {
    activity,
    competition,
    fields: mergeCommonFields(activity, competition, bundle.commonFieldSets),
  };
}
