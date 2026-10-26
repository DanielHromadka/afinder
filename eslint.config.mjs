// Lint is narrow on purpose: typecheck (strict, no unused locals) is the main gate. ESLint adds only the rules
// of React hooks, which TypeScript cannot see: hooks in a fixed order (an error) and effect dependencies (a
// warning, since many effects here deliberately run once or read the latest values through refs).
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config({
  files: ['src/renderer/**/*.{ts,tsx}'],
  languageOptions: { parser: tseslint.parser },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn'
  }
})
