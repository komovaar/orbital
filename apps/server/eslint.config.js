import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The server is the layer that is *allowed* to do I/O — it is where the store,
// the executors and the process management live. No purity rule here.
export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
