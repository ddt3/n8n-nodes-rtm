// ESLint flat config: TypeScript recommended rules, zero warnings allowed (see "lint" script).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**'] },
  ...tseslint.configs.recommended,
);
