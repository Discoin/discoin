import tseslint from "typescript-eslint";

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        document: "readonly",
        HTMLElement: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-constant-condition": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^[A-Z]",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,jsx}"],
    rules: {
      "no-undef": "error",
    },
  },
];
