import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The domain layer is pure by contract (architecture §2: no fs, net or
// child_process in `graph`/`eventlog`). Enforcing it here means a stray import
// fails the gate instead of quietly ending the layer's testability.
const forbiddenIo = [
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "http",
  "node:http",
  "https",
  "node:https",
  "child_process",
  "node:child_process",
  "os",
  "node:os",
  "path",
  "node:path",
  "worker_threads",
  "node:worker_threads",
];

export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: forbiddenIo.map((name) => ({
            name,
            message: "core is a pure domain layer: no I/O.",
          })),
        },
      ],
    },
  },
);
