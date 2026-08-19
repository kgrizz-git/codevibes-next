// codevibes-backend/lint-staged.config.js
// lint-staged runs each config's tasks with CWD set to the config file's
// directory, so --config is relative to this directory (not the repo root).
export default {
  '**/*.ts': 'eslint --fix --config eslint.config.js',
};
