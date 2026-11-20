// Shared flat config for the non-Next packages. apps/web extends eslint-config-next.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export const base = [
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/drizzle/**", "fixtures/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": "off",
    },
  },
];

export default base;
