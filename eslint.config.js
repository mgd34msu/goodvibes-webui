import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // Base JS recommended
  js.configs.recommended,

  // TypeScript strict + stylistic
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    // Parser & project config for type-aware rules
    languageOptions: {
      parserOptions: {
        projectService: {
          // Allow eslint.config.js itself to be parsed by the type service
          // without being part of the tsconfig include array.
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    // React hooks + refresh + a11y
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,

      // React Refresh (Vite HMR)
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // JSX a11y recommended
      ...jsxA11y.flatConfigs.recommended.rules,

      // TypeScript — relax a handful of strict rules that are noisy
      // in a React codebase without being safety-critical
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // Allow unused vars prefixed with _ (common convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Downgrade set-state-in-effect: many legitimate React patterns call setState
      // conditionally inside effects (e.g. initialise-once, respond to query results).
      // This rule is too aggressive as an error; keep it visible but non-blocking.
      "react-hooks/set-state-in-effect": "warn",
      // Relax strict-checked rules that produce noise without safety benefit
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-misused-spread": "warn",
      "@typescript-eslint/no-dynamic-delete": "warn",
      // a11y rules that require broader refactors: downgrade to warn
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/no-autofocus": "warn",
    },
  },

  {
    // Files that don't need type-aware linting (test/config files)
    files: ["**/*.test.ts", "**/*.test.tsx", "vite.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    // Test files: relax rules that are noisy in test contexts
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // Empty arrow functions are common in test mocks and event stubs
      "@typescript-eslint/no-empty-function": "off",
      // Non-null assertions are acceptable in tests where we control the DOM
      "@typescript-eslint/no-non-null-assertion": "off",
      // Reassigning outer variables is a common test pattern for captures
      "react-hooks/globals": "off",
    },
  },

  {
    // Global ignores
    ignores: [
      "dist/**",
      "node_modules/**",
      ".goodvibes/**",
      ".claude/**",
      "coverage/**",
    ],
  }
);
