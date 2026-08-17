import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import orbital from "./index.js";

const linter = new Linter();

const lint = (code, options = []) =>
  linter.verify(code, {
    plugins: { orbital },
    rules: { "orbital/no-io-imports": ["error", ...options] },
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
  });

describe("no-io-imports", () => {
  it("allows a pure import", () => {
    expect(lint(`import { hash } from "./hash";`)).toEqual([]);
  });

  it("allows node:crypto — hashing is not I/O", () => {
    expect(lint(`import { createHash } from "node:crypto";`)).toEqual([]);
  });

  it("catches a bare I/O import", () => {
    const [problem] = lint(`import fs from "fs";`);
    expect(problem?.messageId).toBe("io");
  });

  it("catches the node: form too", () => {
    expect(lint(`import { spawn } from "node:child_process";`)).toHaveLength(1);
  });

  it("catches a dynamic import", () => {
    expect(lint(`const fs = await import("node:fs/promises");`)).toHaveLength(1);
  });

  it("catches a re-export", () => {
    expect(lint(`export { readFile } from "node:fs";`)).toHaveLength(1);
  });

  it("catches require", () => {
    expect(lint(`const net = require("net");`)).toHaveLength(1);
  });

  it("honours an explicit allowance", () => {
    expect(lint(`import path from "node:path";`, [{ allow: ["node:path"] }])).toEqual([]);
  });
});
