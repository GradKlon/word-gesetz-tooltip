// Lint-Konfiguration für "npm run lint" (office-addin-lint nimmt diese Datei statt seiner eigenen).
import officeAddins from "eslint-plugin-office-addins";
import tsParser from "@typescript-eslint/parser";

export default [
  ...officeAddins.configs.recommended,
  {
    plugins: {
      "office-addins": officeAddins,
    },
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    // TypeScript prüft Namen selbst; no-undef kennt weder Browser-Globals noch Typen wie HTMLElement.
    files: ["**/*.ts"],
    rules: {
      "no-undef": "off",
    },
  },
];
