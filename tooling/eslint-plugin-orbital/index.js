/**
 * Orbital's own lint rules.
 *
 * There is one, and it guards the boundary the architecture rests on: the
 * domain layer is pure, so it may not reach the filesystem, the network or
 * another process. `packages/domain` depends on nothing that can do I/O, so a
 * violation usually fails to resolve anyway — this rule is the second layer,
 * and the one that gives a legible error instead of a module-not-found.
 */

const IO_MODULES = [
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "net",
  "os",
  "path",
  "readline",
  "repl",
  "tls",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

const forbidden = new Set([...IO_MODULES, ...IO_MODULES.map((name) => `node:${name}`)]);

const noIoImports = {
  meta: {
    type: "problem",
    docs: { description: "forbid I/O modules in a pure layer" },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      io: "`{{name}}` is I/O; this layer is pure. Move the effect to apps/server.",
    },
  },
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);

    const check = (node, name) => {
      if (typeof name !== "string") return;
      if (allow.has(name)) return;
      if (!forbidden.has(name)) return;
      context.report({ node, messageId: "io", data: { name } });
    };

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => node.source && check(node.source, node.source.value),
      ImportExpression: (node) =>
        node.source.type === "Literal" && check(node.source, node.source.value),
      CallExpression: (node) => {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const [first] = node.arguments;
        if (first?.type === "Literal") check(first, first.value);
      },
    };
  },
};

export default {
  meta: { name: "eslint-plugin-orbital" },
  rules: { "no-io-imports": noIoImports },
};
