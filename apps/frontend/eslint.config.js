export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        document: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-constant-condition": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-duplicate-imports": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^[A-Z]",
        },
      ],
    },
  },
];
