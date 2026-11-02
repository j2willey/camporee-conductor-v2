import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      // v1 code copied verbatim as the scoring reference (issue #3); kept byte-identical.
      "packages/scoring/scripts/v1/*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
);
