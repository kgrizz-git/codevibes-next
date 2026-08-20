import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "import/no-absolute-path": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      complexity: ["warn", 15],
      "max-depth": ["warn", 5],
      "max-lines-per-function": ["warn", 120],
      "max-nested-callbacks": ["warn", 3],
      "max-lines": ["warn", { max: 500 }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.config.ts", "**/*.setup.ts"],
    rules: {
      "max-lines": "off",
      complexity: "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },
);
