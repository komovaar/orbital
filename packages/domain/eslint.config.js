import js from "@eslint/js";
import orbital from "eslint-plugin-orbital";
import tseslint from "typescript-eslint";

// The domain layer is pure by contract (architecture §2 and §4: no filesystem,
// network or process access in `graph`/`eventlog`).
//
// The primary guarantee is structural — this package depends on nothing that
// can do I/O, so an executor import does not resolve. This rule is the second
// layer, and it is the one that says *why* instead of "module not found".
export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { orbital },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // `node:crypto` is deliberately absent from the rule's list: hashing is
      // a pure function, and the input digest needs it.
      "orbital/no-io-imports": "error",
    },
  },
);
