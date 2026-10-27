// Applies Replay Altar's changes to WC3V (patches/wc3v/*.patch, in name order) to the vendor/wc3v
// checkout. Run by `replay-altar setup-sim`, the AppImage and Windows packaging and the GitHub
// build, so every copy simulates the same way.
//
//   node scripts/patch-wc3v.ts          apply them (nothing happens when they already are)
//   node scripts/patch-wc3v.ts --reset  also when the files they touch hold something else (a
//                                       half-applied or older set of patches); local edits to
//                                       those files are lost
//
// The patches are `git format-patch` output (commit message + diff), one per WC3V commit; plain
// diffs work too. Adding one is one step: put the next numbered file in patches/wc3v (README,
// "WC3V changes"). Remove a patch once the submodule points at a WC3V commit that has it.
//
// The series is applied as a whole to a scratch copy of the index (the checkout is not touched),
// the checkout is compared with that result, and the files that differ are written from it. So
// "already applied" is exact even when several patches change the same lines, and a series that
// no longer fits the submodule's commit stops before any file is written.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const wc3v = join(root, "vendor/wc3v");
const dir = join(root, "patches/wc3v");
const reset = process.argv.includes("--reset");

const scratch = mkdtempSync(join(tmpdir(), "patch-wc3v-"));
const patched = { GIT_INDEX_FILE: join(scratch, "index") };
const git = (args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", ["-C", wc3v, ...args], { stdio: "pipe", env: { ...process.env, ...env }, encoding: "utf8" });
const ok = (args: string[], env: Record<string, string> = {}) => {
  try {
    git(args, env);
    return true;
  } catch {
    return false;
  }
};
const inHead = (f: string) => ok(["cat-file", "-e", `HEAD:${f}`]);

try {
  const patches = readdirSync(dir).filter((f) => f.endsWith(".patch")).sort();
  const head = git(["rev-parse", "--short", "HEAD"]).trim();

  // The submodule's commit with every patch on top, in the scratch index.
  git(["read-tree", "HEAD"], patched);
  for (const name of patches) {
    try {
      git(["apply", "--cached", join(dir, name)], patched);
    } catch (e) {
      const why = String((e as { stderr?: string }).stderr ?? e).trim();
      throw new Error(`wc3v: ${name} doesn't apply to WC3V ${head} after the patches before it; update or remove it\n${why}`);
    }
  }
  const files = git(["diff", "--cached", "--name-only", "HEAD"], patched).split("\n").filter(Boolean);
  git(["update-index", "-q", "--refresh"], patched);
  // Compared with the scratch index, a file the patches add that the checkout lacks is a difference.
  const applied = () => ok(["diff", "--quiet", "--", ...files], patched);
  const pristine = () => ok(["diff", "--quiet", "HEAD", "--", ...files]) && files.every((f) => inHead(f) || !existsSync(join(wc3v, f)));

  if (files.length === 0) {
    console.log("wc3v: no patches");
  } else if (applied()) {
    console.log(`wc3v: ${patches.length} patches already applied to ${head}`);
  } else {
    if (!pristine() && !reset)
      throw new Error(
        `wc3v: the files the patches touch are neither as in WC3V ${head} nor as patched (an older or half-applied set of patches, or local edits). ` +
          `\`node scripts/patch-wc3v.ts --reset\` writes them as patched (local edits to them are lost):\n  ${files.join("\n  ")}`,
      );
    // Written from the scratch index, so line endings follow the checkout's settings.
    const kept = git(["ls-files", "--", ...files], patched).split("\n").filter(Boolean);
    if (kept.length) git(["checkout-index", "-f", "--", ...kept], patched);
    for (const f of files.filter((f) => !kept.includes(f))) rmSync(join(wc3v, f), { force: true });
    for (const name of patches) console.log(`wc3v: applied ${name}`);
    if (!applied()) throw new Error("wc3v: after applying the patches the checkout differs from the patched result");
  }
} catch (e) {
  // Just the reason: callers (setup-sim, the packaging) show this output and stop on the exit code.
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
