import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/node_modules/**",
      // v1 code copied verbatim as the scoring reference (issue #3); kept byte-identical.
      "packages/scoring/scripts/v1/*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // The Program Guide package is pure (issue #5): no file, network or process access outside tests.
    files: ["packages/program-guide/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "packages/program-guide is pure: no I/O.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
