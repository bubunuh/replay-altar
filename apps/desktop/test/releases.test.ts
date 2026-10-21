import { describe, expect, test } from "vitest";
import { isNewer, newestRelease } from "../src/releases.ts";

const rel = (tag: string, draft = false) => ({ tag_name: tag, html_url: `https://github.com/bubunuh/replay-altar/releases/tag/${tag}`, draft, published_at: "2026-10-21T00:00:00Z", body: `notes ${tag}` });

describe("which release is newer", () => {
  test("versions compare by number, not by text", () => {
    expect(isNewer("v0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.12")).toBe(true);
    expect(isNewer("v0.1.2", "0.1.2")).toBe(false);
    expect(isNewer("v0.1.1", "0.1.2")).toBe(false);
    expect(isNewer("nightly", "0.1.2")).toBe(false);
  });

  test("the newest published release above the running version, drafts ignored", () => {
    const list = [rel("v0.1.2"), rel("v0.1.4", true), rel("v0.1.3"), rel("v0.1.10"), rel("v0.1.1")];
    expect(newestRelease(list, "0.1.2")?.version).toBe("0.1.10");
    expect(newestRelease(list, "0.1.2")?.notes).toBe("notes v0.1.10");
    expect(newestRelease(list, "0.1.10")).toBeNull();
    expect(newestRelease([], "0.1.2")).toBeNull();
  });
});
