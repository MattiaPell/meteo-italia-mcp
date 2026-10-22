import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["src/**/*.ts"] })),
  prettierConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Test: trowing in mockImplementation è intenzionale
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    files: ["src/__tests__/**/*.ts"],
    rules: {
      // In test, mock e cast di payload upstream usano any
      "@typescript-eslint/no-explicit-any": "off",
      // In test, assert su valori potenzialmente undefined è parte del setup
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  }
);
