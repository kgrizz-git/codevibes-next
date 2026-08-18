// lint-staged.config.js (repo root)
// Prettier is not adopted yet (see plan Step 9). Add the
// '*.{json,md,css}': 'prettier --write' entry once Prettier lands.
export default {
  '*.{ts,tsx}': 'eslint --fix',
};
