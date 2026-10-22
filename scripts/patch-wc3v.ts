// Applies Replay Altar's fixes to WC3V (patches/wc3v/*.patch) to the vendor/wc3v checkout, each
// once: a patch already in place is left alone. Run by `replay-altar setup-sim`, the Windows
// packaging and the GitHub build, so every copy simulates the same way.
//
//   node scripts/patch-wc3v.ts
//
// The fixes are meant to go upstream (github.com/jblanchette/wc3v); remove a patch here once
// the submodule points at a WC3V commit that has it.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const wc3v = join(root, "vendor/wc3v");
const dir = join(root, "patches/wc3v");

const git = (args: string[]) => execFileSync("git", ["-C", wc3v, ...args], { stdio: "pipe" });
const ok = (args: string[]) => {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
};

for (const name of readdirSync(dir).filter((f) => f.endsWith(".patch")).sort()) {
  const patch = join(dir, name);
  if (ok(["apply", "--reverse", "--check", patch])) {
    console.log(`wc3v: ${name} already applied`);
    continue;
  }
  if (!ok(["apply", "--check", patch])) throw new Error(`wc3v: ${name} doesn't apply to this WC3V commit; update or remove it`);
  git(["apply", patch]);
  console.log(`wc3v: applied ${name}`);
}
