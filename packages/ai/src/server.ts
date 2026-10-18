// llama.cpp's llama-server for the AI analysis: started on demand, reused while it is up (also
// one you started yourself with the same model), stopped after a few idle minutes because it
// holds most of the GPU's memory while running.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import type { AiConfig } from "@replay-altar/core/ui";

const START_TIMEOUT_MS = 240_000;
const REQUEST_TIMEOUT_MS = 600_000;

export type ChatResponse = {
  choices: { message: { content: string | null; reasoning_content?: string }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  timings?: { predicted_per_second?: number; draft_n?: number; draft_n_accepted?: number };
};

/** Why the AI analysis can't run on this machine, or null. */
export function aiNotReady(cfg: AiConfig): string | null {
  if (!existsSync(cfg.serverPath)) return `llama-server not found at ${cfg.serverPath}`;
  if (!existsSync(cfg.model)) return `model not found at ${cfg.model}`;
  return null;
}

export class ModelServer {
  private child: ChildProcess | null = null;
  private idle: NodeJS.Timeout | null = null;
  private cfg: AiConfig;
  private logDir: string;

  constructor(cfg: AiConfig, logDir: string) {
    this.cfg = cfg;
    this.logDir = logDir;
  }

  private get url() {
    return `http://127.0.0.1:${this.cfg.port}`;
  }

  private async health(): Promise<boolean> {
    try {
      return (await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  }

  /** Make sure a server with our model answers on the port; start one if needed. */
  async ensure(onStage?: (stage: string) => void): Promise<void> {
    this.clearIdle();
    if (await this.health()) {
      const props = (await (await fetch(`${this.url}/props`)).json()) as { model_path?: string };
      if (props.model_path && props.model_path !== this.cfg.model) throw new Error(`port ${this.cfg.port} is in use by another model (${props.model_path})`);
      return;
    }
    const problem = aiNotReady(this.cfg);
    if (problem) throw new Error(problem);
    onStage?.("Loading the model");
    mkdirSync(this.logDir, { recursive: true });
    const logFile = join(this.logDir, "server.log");
    const log = openSync(logFile, "w");
    const c = this.cfg;
    const args = ["-m", c.model, "--host", "127.0.0.1", "--port", String(c.port), "-c", String(c.contextSize), "-np", "1", "--jinja"];
    if (c.draftModel && existsSync(c.draftModel)) args.push("--model-draft", c.draftModel, "--spec-type", "draft-mtp", "--spec-draft-n-max", "2");
    if (c.chatTemplate && existsSync(c.chatTemplate)) args.push("--chat-template-file", c.chatTemplate);
    args.push(...c.extraArgs);
    const child = spawn(c.serverPath, args, { stdio: ["ignore", log, log] });
    this.child = child;
    let exited = false;
    child.on("exit", () => {
      exited = true;
      if (this.child === child) this.child = null;
    });
    child.on("error", () => (exited = true));
    const until = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < until) {
      if (exited) throw new Error(`llama-server stopped while loading the model (see ${logFile})`);
      if (await this.health()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.stop();
    throw new Error(`llama-server was not ready after ${START_TIMEOUT_MS / 1000} s (see ${logFile})`);
  }

  async chat(body: Record<string, unknown>): Promise<ChatResponse> {
    const res = await fetch(`${this.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`llama-server answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as ChatResponse;
  }

  /** Stop a server we started after the idle time; the next ensure() cancels this. */
  stopWhenIdle() {
    this.clearIdle();
    if (!this.child) return;
    this.idle = setTimeout(() => this.stop(), this.cfg.idleMinutes * 60_000);
    this.idle.unref();
  }

  /** Stop the server if we started it (one started by someone else is left alone). */
  stop() {
    this.clearIdle();
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  private clearIdle() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }
}
