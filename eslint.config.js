import vasek from '@vasekzdvihal/eslint-config';

export default vasek(
  {},
  {
    // Test files: fixture values ARE the meaning — naming them adds noise,
    // and vitest callbacks don't need explicit return types.
    files: ['test/**/*.ts'],
    rules: {
      'no-magic-numbers': 'off',
      'ts/explicit-function-return-type': 'off',
    },
  },
);
