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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jsxA11y plugin typed as any
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
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-misused-spread": "warn",
      "@typescript-eslint/no-dynamic-delete": "warn",
      // Downgrade assertion rules — some patterns require casts (e.g. WS3 toast files)
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Downgrade type definition style — interface vs type is stylistic
      "@typescript-eslint/consistent-type-definitions": "warn",
      // a11y rules that require broader refactors: downgrade to warn
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/no-autofocus": "warn",
    },
  },

  {
    // Files that don't need type-aware linting (test/config/tooling files).
    // The e2e Playwright harness, playwright.config.ts, and the scripts/* tooling
    // live OUTSIDE tsconfig.json's include (["src", "vite.config.ts"]), so the
    // type-aware projectService cannot resolve them and errors with "not found by
    // the project service". They are not app source; lint them without type info.
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "vite.config.ts",
      "**/*.e2e.ts",
      "e2e/**/*.ts",
      "playwright.config.ts",
      "scripts/**/*.ts",
    ],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    // The service worker is hand-written plain JS with worker globals; it lives
    // outside tsconfig.json's include, so type-aware linting cannot resolve it.
    files: ["public/sw.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Keep disableTypeChecked's parserOptions (projectService off) — a bare
      // `languageOptions:` key here would replace them and re-enable the
      // type-aware parse this block exists to turn off.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Response: "readonly",
        Request: "readonly",
        Promise: "readonly",
        console: "readonly",
      },
    },
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
