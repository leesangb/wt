import { createHash, randomUUID } from "crypto";
import { spawnSync } from "child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { queryOpenPullRequests, type OpenPullRequestSummary } from "./cli.js";

const CACHE_TTL_MS = 5_000;
const QUERY_TIMEOUT_MS = 1_500;

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function optionalFile(path: string) {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function fileIdentity(path: string) {
  try {
    const stat = statSync(path);
    return [path, stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino];
  } catch (error) {
    if (isMissing(error)) return [path, null];
    throw error;
  }
}

function cacheContext(repoRoot: string) {
  const root = realpathSync(repoRoot);
  const home = process.env.HOME || homedir();
  const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const ghConfig = process.env.GH_CONFIG_DIR || join(configHome, "gh");
  const gitPointer = join(root, ".git");
  const gitDir = process.env.GIT_DIR ? resolve(root, process.env.GIT_DIR) :
    statSync(gitPointer).isDirectory()
      ? gitPointer
      : resolve(root, optionalFile(gitPointer)?.match(/^gitdir:\s*(.+)\s*$/m)?.[1] ?? ".git");
  // Let Git resolve includes and conditional configuration; hash captured bytes only.
  const configuration = spawnSync("git", ["-C", root, "config", "--includes", "--null", "--list"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 500,
    killSignal: "SIGKILL",
    maxBuffer: 1_048_576,
  });
  if (configuration.error || configuration.status !== 0) {
    throw new Error("Could not inspect completion configuration");
  }
  const files = [
    gitPointer,
    join(gitDir, "HEAD"),
    join(gitDir, "config.worktree"),
    join(ghConfig, "hosts.yml"),
    join(ghConfig, "config.yml"),
  ];
  const environment = Object.entries(process.env)
    .filter(([name]) => /^(GH_|GITHUB_|GIT_CONFIG)/.test(name) ||
      ["HOME", "XDG_CONFIG_HOME", "PATH", "GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE",
        "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_NAMESPACE"].includes(name))
    .sort(([left], [right]) => left.localeCompare(right));
  const identity = digest(JSON.stringify([
    environment,
    files.map(path => fileIdentity(resolve(root, path))),
    digest(configuration.stdout),
  ]));
  const cacheHome = process.env.XDG_CACHE_HOME;
  const directory = join(
    cacheHome && isAbsolute(cacheHome) ? cacheHome : join(home, ".cache"),
    "wt",
    "pr-completions"
  );
  return { identity, directory, path: join(directory, `${digest(root)}.json`) };
}

function isPullRequest(value: unknown): value is OpenPullRequestSummary {
  return value !== null && typeof value === "object" &&
    "number" in value && typeof value.number === "string" && /^\d+$/.test(value.number) &&
    "title" in value && typeof value.title === "string" && value.title.length > 0 &&
    "author" in value && typeof value.author === "string" &&
    "headRefName" in value && typeof value.headRefName === "string" && value.headRefName.length > 0 &&
    "isDraft" in value && typeof value.isDraft === "boolean";
}

function readCache(context: ReturnType<typeof cacheContext>) {
  try {
    const stat = lstatSync(context.path);
    if (!stat.isFile() || stat.size > 1_048_576 ||
      (typeof process.getuid === "function" &&
        (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) return undefined;
    const value: unknown = JSON.parse(readFileSync(context.path, "utf-8"));
    if (!value || typeof value !== "object" ||
      !("version" in value) || value.version !== 1 ||
      !("identity" in value) || value.identity !== context.identity ||
      !("savedAt" in value) || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) ||
      !("entries" in value) || !Array.isArray(value.entries) ||
      value.entries.length > 100 || !value.entries.every(isPullRequest)) return undefined;
    const age = Date.now() - value.savedAt;
    return age >= 0 && age < CACHE_TTL_MS ? value.entries : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(context: ReturnType<typeof cacheContext>, entries: OpenPullRequestSummary[]) {
  const temp = `${context.path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(context.directory, { recursive: true, mode: 0o700 });
    chmodSync(context.directory, 0o700);
    writeFileSync(temp, JSON.stringify({
      version: 1,
      identity: context.identity,
      savedAt: Date.now(),
      entries,
    }), { mode: 0o600, flag: "wx" });
    renameSync(temp, context.path);
  } catch {
    // Suggestions remain available even when the optional cache cannot be written.
  } finally {
    try { rmSync(temp, { force: true }); } catch { /* Optional cache cleanup. */ }
  }
}

export async function listCachedOpenPullRequests(repoRoot: string): Promise<OpenPullRequestSummary[]> {
  const context = (() => {
    try { return cacheContext(repoRoot); } catch { return undefined; }
  })();
  if (context) {
    const cached = readCache(context);
    if (cached) return cached;
  }
  try {
    const fresh = await queryOpenPullRequests(repoRoot, { timeoutMs: QUERY_TIMEOUT_MS });
    if (fresh === undefined) return [];
    if (context) {
      try {
        // Do not store an in-flight result under a changed account/repository context.
        if (cacheContext(repoRoot).identity === context.identity) writeCache(context, fresh);
      } catch { /* A changed or unreadable context disables caching for this result. */ }
    }
    return fresh;
  } catch {
    return [];
  }
}
