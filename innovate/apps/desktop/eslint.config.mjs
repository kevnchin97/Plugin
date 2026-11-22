import base from "../../eslint.config.mjs";

export default [
  ...base,
  // Electron's main process entry is CommonJS.
  { files: ["electron/**/*.cjs", "scripts/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];
