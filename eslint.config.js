import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

export default tseslint.config(
  // `tmp/` contains local backup snapshots, not maintained application source.
  { ignores: ["dist", "tmp", "codevibes-backend"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "import/no-absolute-path": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      complexity: ["warn", 15],
      "max-depth": ["warn", 5],
      "max-lines-per-function": ["warn", 120],
      "max-nested-callbacks": ["warn", 3],
      "max-lines": ["warn", { max: 500 }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.config.{js,ts}", "**/*.setup.ts"],
    rules: {
      "max-lines": "off",
      complexity: "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },
);
