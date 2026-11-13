import type { AiProvider, AiRequest } from "./provider.ts";

/** A provider for tests and local development (ADR-0030 item 7): answers from `reply`, and keeps every request. */
export function fakeProvider(
  reply: (request: AiRequest) => string,
): AiProvider & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    model: "fake",
    requests,
    complete(request) {
      requests.push(request);
      return Promise.resolve(reply(request));
    },
  };
}

/**
 * Canned answers (AI_ADAPTER=fake, development and test only): something in the shape each request's schema asks
 * for, so the AI buttons can be tried, and tested end to end, without a key or a network.
 */
export function cannedProvider(): AiProvider {
  return {
    model: "fake",
    complete({ schema, prompt }) {
      const properties = Object.keys(
        (schema?.["properties"] as Record<string, unknown> | undefined) ?? {},
      );
      if (properties.includes("ideas")) {
        return Promise.resolve(
          JSON.stringify({
            ideas: [
              {
                theme: "Under the Big Top",
                why: "A circus tent for every station.",
              },
              {
                theme: "Lost Expedition",
                why: "Each station is a camp on the trail.",
              },
              { theme: "Pirate Cove", why: "Teams race for buried treasure." },
            ],
          }),
        );
      }
      if (properties.includes("fields")) {
        return Promise.resolve(JSON.stringify(themedCanned(prompt)));
      }
      if (properties.includes("action")) {
        return Promise.resolve(
          JSON.stringify({
            action: "Step right up! Your team's skills take centre ring today.",
            lore: "Long ago, a travelling circus lost its tent in these woods.",
            skill:
              "Knots, fire-building and first aid: today you show them all.",
          }),
        );
      }
      return Promise.resolve("OK");
    },
  };
}

/** A themed Activity for the canned provider: the prompt's Activity JSON, with "Big Top" wording. */
function themedCanned(prompt: string) {
  const json = /The activity, as JSON:\n([\s\S]*?)\n\nRewrite/.exec(
    prompt,
  )?.[1];
  const activity = JSON.parse(json ?? "{}") as {
    title?: string;
    content?: Record<string, unknown> & { story?: string };
    fields?: { id: string; label: string; placeholder: string }[];
  };
  return {
    title: `Big Top ${activity.title ?? "Activity"}`,
    content: {
      ...activity.content,
      story: `Under the Big Top: ${activity.content?.story ?? ""}`,
    },
    fields: (activity.fields ?? []).map((f) => ({
      id: f.id,
      label: `Big Top ${f.label}`,
      placeholder: f.placeholder,
    })),
  };
}
