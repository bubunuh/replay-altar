// "AI analysis" of one game: rules pick what mattered (findings.ts), a local model writes the
// review around them, and every number it writes is checked against what it was given.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getGame, logEvent, type AiConfig, type DB, type Paths } from "@w3stats/core/ui";
import { factsRefFor } from "./context.ts";
import { gameFacts } from "./facts.ts";
import { findings as findFindings, MIN_GAME_MS, opponentPlan, strengths as findStrengths } from "./findings.ts";
import type { ModelServer } from "./server.ts";
import type { AiAnalysis, Review } from "./types.ts";

export const PROMPT_VERSION = 2;

const SYSTEM = `You are a Warcraft III coach. The app found what mattered in this game (Findings, with their evidence) and gives you the fact sheet behind it.
Rules:
- Explain each finding in plain words and say what to do differently next time. General strategy advice is welcome; do not state unit statistics, build requirements or counters as facts.
- Quote times and numbers exactly as written. Do not do arithmetic. Do not add events that are not in the sheet.
- Second person, direct, no hype.`;

const text = (description: string) => ({ type: "string", description });

/** The JSON shape the model must produce: one entry per finding, keyed by its id. */
function reviewSchema(ids: string[]) {
  const finding = {
    type: "object",
    properties: {
      title: text("5-8 words"),
      explanation: text("What happened and why it mattered, 1-2 sentences"),
      next_time: text("What to do differently, 1-2 sentences"),
    },
    required: ["title", "explanation", "next_time"],
  };
  return {
    type: "object",
    properties: {
      recap: text("What happened, 2-3 sentences, chronological"),
      opponent_strategy: text("The opponent's plan from \"Opponent's plan\": tech, towers, army and when it appeared, items. Not the outcome. One sentence"),
      findings: { type: "object", properties: Object.fromEntries(ids.map((id) => [id, finding])), required: ids },
      strengths: text("What went well (from Strengths), one sentence; empty if none"),
      one_thing: text("If you change one thing next game, what? One sentence"),
    },
    required: ["recap", "opponent_strategy", "findings", "strengths", "one_thing"],
  };
}

const NUMBER = /\d+(?::\d\d)?(?:\.\d+)?%?/g;

/** Numbers and times the review uses that appear nowhere in its sources (single digits pass). */
export function unverifiedNumbers(review: string, sources: string): string[] {
  const known = new Set(sources.replace(/(\d),(\d{3})/g, "$1$2").match(NUMBER) ?? []);
  const used = review.replace(/(\d),(\d{3})/g, "$1$2").match(NUMBER) ?? [];
  return [...new Set(used.filter((x) => !known.has(x) && !/^\d$/.test(x)))].sort();
}

export const analysisPath = (paths: Paths, gameKey: string) => join(paths.ai, `${gameKey}.json`);

export function readAnalysis(paths: Paths, gameKey: string): AiAnalysis | null {
  const file = analysisPath(paths, gameKey);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as AiAnalysis) : null;
}

/** What the model is given for one game: the rule-based findings and strengths, then the facts. */
export function buildPrompt(db: DB, paths: Paths, gameKey: string) {
  const detail = getGame(db, paths, gameKey);
  if (!detail) throw new Error(`no such game: ${gameKey}`);
  const r = detail.record;
  if (!r.players.some((p) => p.isMe) || !r.classification.opponentId) throw new Error("AI analysis needs one of your 1v1 games");
  if (r.game.durationMs < MIN_GAME_MS) throw new Error("the game is too short to analyze (under 3 minutes)");
  const ref = factsRefFor(r);
  const found = findFindings(r, ref);
  const good = findStrengths(r, ref);
  const facts = gameFacts(r, { result: detail.row.result ?? "unknown", ref });
  const brief = [
    "## Findings (computed by the app, most important first)",
    ...(found.length ? found.map((f, i) => `${i + 1}. [${f.id}] ${f.headline}\n${f.evidence.map((e) => `   - ${e}`).join("\n")}`) : ["(none: no clear problem stood out)"]),
    "",
    "## Strengths (computed by the app)",
    ...(good.length ? good.map((s) => `- ${s}`) : ["(none)"]),
    "",
    "## Opponent's plan (computed by the app, from their orders)",
    ...opponentPlan(r, ref).map((l) => `- ${l}`),
    "",
  ].join("\n");
  const prompt = `${brief}\n${facts}`;

  return { record: r, found, good, prompt };
}

/** Run the analysis for one of your games and store it in <data>/ai/<gameKey>.json. */
export async function analyzeGame(
  db: DB,
  paths: Paths,
  cfg: AiConfig,
  server: ModelServer,
  gameKey: string,
  onStage: (stage: string) => void = () => {},
): Promise<AiAnalysis> {
  const t0 = Date.now();
  const { found, good, prompt } = buildPrompt(db, paths, gameKey);
  const base: Omit<AiAnalysis, "review" | "unverified" | "timings"> = {
    version: 1,
    promptVersion: PROMPT_VERSION,
    gameKey,
    createdAt: new Date().toISOString(),
    model: { file: basename(cfg.model), draft: cfg.draftModel ? basename(cfg.draftModel) : null, chatTemplate: cfg.chatTemplate ? basename(cfg.chatTemplate) : null },
    findings: found,
    strengths: good,
    facts: prompt,
  };
  let result: AiAnalysis;
  try {
    await server.ensure(onStage);
    onStage("Writing the review");
    const res = await server.chat({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${prompt}\n\nWrite the review as JSON.` },
      ],
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_schema", json_schema: { name: "review", schema: reviewSchema(found.map((f) => f.id)) } },
      // Thinking took 2-3x longer on this task without finding more (tested on Gemma 4 26B).
      chat_template_kwargs: { enable_thinking: false },
    });
    const choice = res.choices[0];
    const review = JSON.parse(choice.message.content ?? "") as Review;
    result = {
      ...base,
      review,
      unverified: unverifiedNumbers(JSON.stringify(review), prompt),
      timings: {
        totalMs: Date.now() - t0,
        promptTokens: res.usage?.prompt_tokens ?? null,
        outputTokens: res.usage?.completion_tokens ?? null,
        tokensPerSecond: res.timings?.predicted_per_second ?? null,
      },
    };
  } catch (e) {
    result = { ...base, review: null, unverified: [], timings: { totalMs: Date.now() - t0, promptTokens: null, outputTokens: null, tokensPerSecond: null }, error: (e as Error).message };
  } finally {
    server.stopWhenIdle();
  }
  mkdirSync(paths.ai, { recursive: true });
  writeFileSync(analysisPath(paths, gameKey), JSON.stringify(result, null, 2) + "\n");
  logEvent(paths, { type: "ai_analysis", gameKey, ok: !result.error, ms: result.timings.totalMs, error: result.error });
  return result;
}
