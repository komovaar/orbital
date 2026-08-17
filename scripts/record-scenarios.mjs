// Records the Go worker's observable behaviour as golden files.
//
// The 4,695 lines of Go tests cannot be ported: a hand-translated test that
// loses an assertion still passes. A golden diff cannot lose an assertion,
// because the assertion *is* the recording.
//
// Every scenario drives a throwaway git repository through the `orbital` CLI
// and captures each command's stdout and the full `status --json` after it.
// Only the local-command worker is used, so nothing here talks to a model and
// every run is deterministic.
//
//   node scripts/record-scenarios.mjs           re-record into recordings/
//   node scripts/record-scenarios.mjs --check   replay and diff, non-zero on drift
//
// These must be captured while worker/ still runs. Once it is deleted the
// reference is gone permanently.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(repoRoot, "recordings");
const check = process.argv.includes("--check");

// A tool command that produces a real git diff, so three-way apply sees the
// blob hashes it expects. The file is restored, leaving the worktree clean.
const editReadme = (line) =>
  `printf '${line}\\n' > README.md && git diff > "$ORBITAL_PATCH_PATH" && git checkout -- README.md`;

const scenarios = [
  {
    name: "repository-and-missions",
    // The intake surface: opening a repo, both mission kinds, editing, linking
    // and deleting. No run, so nothing here touches git.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "tidy the readme"],
      ["queue", "<repo>", "run the formatter", "--tool", "echo formatted"],
      ["edit-mission", "<repo>", "$mission[0]", "tidy the readme, briefly"],
      ["link", "<repo>", "$mission[0]", "$mission[1]"],
      ["unlink", "<repo>", "$mission[0]", "$mission[1]"],
      ["delete", "<repo>", "$mission[1]"],
    ],
  },
  {
    name: "tool-run-approve",
    // The whole product cycle: a run produces a patch, a person approves it,
    // and the patch lands as a commit.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "make the readme friendlier", "--tool", editReadme("hello world")],
      ["start-run", "<repo>", "$mission[0]"],
      ["approve", "<repo>", "$mission[0]", "docs: make the readme friendlier"],
      ["history", "--json", "<repo>"],
      ["git-sync", "<repo>"],
    ],
  },
  {
    name: "tool-run-reject",
    // Rejection is durable and distinct from silence.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "make the readme shoutier", "--tool", editReadme("HELLO")],
      ["start-run", "<repo>", "$mission[0]"],
      ["reject", "<repo>", "$mission[0]"],
      ["history", "--json", "<repo>"],
    ],
  },
  {
    name: "tool-run-failure",
    // A run that fails leaves the mission recoverable, not half-applied.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "run the broken step", "--tool", "echo nope >&2 && exit 3"],
      ["start-run", "<repo>", "$mission[0]"],
    ],
  },
  {
    name: "amend-and-push",
    // The commit gate: message, amend, push.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "touch the readme", "--tool", editReadme("hello there")],
      ["start-run", "<repo>", "$mission[0]"],
      ["approve", "<repo>", "$mission[0]", "docs: touch the readme"],
      ["amend", "<repo>", "$mission[0]", "docs: touch the readme properly"],
      ["history", "--json", "<repo>"],
      ["push", "<repo>"],
      ["git-sync", "<repo>"],
    ],
  },
  {
    name: "branches",
    steps: [
      ["open", "<repo>"],
      ["branches", "<repo>"],
      ["switch-branch", "<repo>", "feature/x", "--create"],
      ["branches", "<repo>"],
      ["git-sync", "<repo>"],
      ["switch-branch", "<repo>", "main"],
      ["branches", "<repo>"],
    ],
  },
  {
    name: "chained-missions",
    // Two missions linked into a chain: the second sees the first's result as
    // upstream context. This is the closest the old model gets to an edge.
    steps: [
      ["open", "<repo>"],
      ["queue", "<repo>", "first step", "--tool", editReadme("step one")],
      ["queue", "<repo>", "second step", "--tool", editReadme("step two")],
      ["link", "<repo>", "$mission[0]", "$mission[1]"],
      ["start-run", "<repo>", "$mission[0]"],
      ["approve", "<repo>", "$mission[0]", "docs: first step"],
      ["start-run", "<repo>", "$mission[1]"],
      ["approve", "<repo>", "$mission[1]", "docs: second step"],
      ["history", "--json", "<repo>"],
    ],
  },
];

function buildWorker() {
  const binary = path.join(mkdtempSync(path.join(tmpdir(), "orbital-bin-")), "orbital");
  execFileSync("go", ["build", "-o", binary, "./cmd/orbital"], {
    cwd: path.join(repoRoot, "worker"),
    stdio: "inherit",
  });
  return binary;
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "orbital-fixture-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const git = (args, cwd = repo) =>
    execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

  mkdirSync(repo);
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "user.email", "fixture@orbital.test"]);
  git(["config", "user.name", "Orbital Fixture"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "chore: initial commit"]);
  git(["remote", "add", "origin", remote]);
  git(["push", "--quiet", "-u", "origin", "main"]);

  return { root, repo };
}

/**
 * Replace everything that changes between two identical runs.
 *
 * Ids and paths go through a symbol table keyed by first appearance, so a
 * recording still shows *which* mission an event belongs to — losing that
 * would make the goldens far weaker than the Go tests they replace.
 */
function makeNormaliser(repo) {
  const symbols = new Map();
  const symbol = (prefix) => {
    const seen = [...symbols.values()].filter((value) => value.startsWith(`${prefix}_`)).length;
    return `${prefix}_${seen + 1}`;
  };

  return (text) => {
    if (text === "") return "";
    let out = text.split(repo).join("<repo>");
    out = out.split(path.dirname(repo)).join("<fixture>");
    out = out.replace(/\b(repo|mission|run|event|patch|chat|message)_\d+\b/g, (id, prefix) => {
      if (!symbols.has(id)) symbols.set(id, symbol(prefix));
      return symbols.get(id);
    });
    // Two shapes: the store writes UTC (`...Z`), git writes a local offset
    // (`...+03:00`), so a Z-only pattern silently lets commit dates through.
    out = out.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})/g, "<time>");
    out = out.replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");
    out = out.replace(/"duration_ms":\s*\d+/g, '"duration_ms":0');
    return out;
  };
}

function resolveArgs(argv, repo, status) {
  const missions = status?.missions ?? [];
  return argv.map((arg) => {
    if (arg === "<repo>") return repo;
    const match = /^\$mission\[(\d+)\]$/.exec(arg);
    if (!match) return arg;
    const mission = missions[Number(match[1])];
    if (!mission) throw new Error(`${arg}: only ${missions.length} missions exist`);
    return mission.id;
  });
}

function runScenario(scenario, binary) {
  const { root, repo } = makeFixture();
  const normalise = makeNormaliser(repo);
  const steps = [];

  const invoke = (argv) => {
    try {
      const stdout = execFileSync(binary, argv, { encoding: "utf8", stdio: "pipe" });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (error) {
      return {
        exitCode: error.status ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
  };

  const readStatus = () => {
    const result = invoke(["status", "--json", repo]);
    return result.exitCode === 0 ? JSON.parse(result.stdout) : null;
  };

  try {
    for (const argv of scenario.steps) {
      const resolved = resolveArgs(argv, repo, readStatus());
      const result = invoke(resolved);
      const after = invoke(["status", "--json", repo]);
      steps.push({
        command: argv,
        exitCode: result.exitCode,
        stdout: normalise(result.stdout),
        stderr: normalise(result.stderr),
        status: after.exitCode === 0 ? JSON.parse(normalise(after.stdout)) : null,
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  return { scenario: scenario.name, steps };
}

const binary = buildWorker();
mkdirSync(outDir, { recursive: true });

let drift = 0;
for (const scenario of scenarios) {
  const file = path.join(outDir, `${scenario.name}.json`);
  const recorded = `${JSON.stringify(runScenario(scenario, binary), null, 2)}\n`;

  if (!check) {
    writeFileSync(file, recorded);
    console.log(`recorded ${path.relative(repoRoot, file)}`);
    continue;
  }

  const expected = readFileSync(file, "utf8");
  if (expected === recorded) {
    console.log(`ok       ${scenario.name}`);
  } else {
    drift += 1;
    console.error(`DRIFT    ${scenario.name}`);
    const a = expected.split("\n");
    const b = recorded.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) {
        console.error(`  line ${i + 1}\n  - ${a[i] ?? "<eof>"}\n  + ${b[i] ?? "<eof>"}`);
        break;
      }
    }
  }
}

if (check) {
  const known = new Set(scenarios.map((scenario) => `${scenario.name}.json`));
  for (const file of readdirSync(outDir)) {
    if (file.endsWith(".json") && !known.has(file)) {
      drift += 1;
      console.error(`ORPHAN   recordings/${file} has no scenario`);
    }
  }
  if (drift > 0) {
    console.error(`\n${drift} scenario(s) drifted.`);
    process.exit(1);
  }
  console.log(`\n${scenarios.length} scenarios replayed identically.`);
}
