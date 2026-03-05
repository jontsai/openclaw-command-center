import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Node.js globals
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        setImmediate: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        clearImmediate: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  // Ignore build output
  {
    ignores: ["lib/server.js"],
  },
  // Relax rules for source code (many patterns)
  {
    files: ["src/**/*.js"],
    rules: {
      "no-empty": "warn",
      "no-case-declarations": "warn",
      "no-misleading-character-class": "warn",
    },
  },
];
