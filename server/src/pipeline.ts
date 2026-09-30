import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { AguiEvent, LLMSettings, PlanDoc } from "shared";
import { abortedRuns, executeTool, now, sleep, sseSend, streamLLMText } from "./llm.js";

function settingsFrom(req: Request): LLMSettings {
  const b = req.body ?? {};
  return {
    baseURL: String(b.baseURL ?? process.env.LLM_BASE_URL ?? "http://localhost:11434/v1"),
    apiKey: String(b.apiKey ?? process.env.LLM_API_KEY ?? ""),
    model: String(b.model ?? process.env.LLM_MODEL ?? "llama3.1"),
  };
}

// Shared pipeline: identical event sequence for both backends (modulo ids).
// hook allows the mastra route to do its framework-specific work first.
export async function runPipeline(
  res: Response,
  backend: "mastra" | "minimal",
  settings: LLMSettings,
  task: string,
  runId: string,
  frameworkNote?: string
) {
  const send = (e: Omit<AguiEvent, "runId" | "timestamp" | "backend">) =>
    sseSend(res, { ...e, runId, timestamp: now(), backend } as AguiEvent);
  const isAborted = () => abortedRuns.get(runId) === true;

  send({ type: "RUN_STARTED", message: frameworkNote ?? `run started (${backend})` } as any);
  send({ type: "STATE_SNAPSHOT", snapshot: { task, backend, plan: [], results: [] } } as any);

  const messageId = randomUUID();
  send({ type: "TEXT_MESSAGE_START", messageId } as any);

  let full = "";
  try {
    for await (const chunk of streamLLMText(settings, task, isAborted)) {
      if (isAborted()) {
        send({ type: "RUN_ERROR", code: "ABORTED", message: "Run cancelled by user (interrupt)." } as any);
        return;
      }
      full += chunk;
      send({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: chunk } as any);
      await sleep(15);
    }
  } catch (e: any) {
    send({ type: "TEXT_MESSAGE_END", messageId } as any);
    if (isAborted() || e?.name === "AbortError" || e?.message === "__ABORTED__") {
      send({ type: "RUN_ERROR", code: "ABORTED", message: "Run cancelled by user (interrupt)." } as any);
    } else {
      send({ type: "RUN_ERROR", message: `LLM request failed: ${String(e?.message ?? e)}` } as any);
    }
    return;
  }
  send({ type: "TEXT_MESSAGE_END", messageId } as any);
  if (isAborted()) {
    send({ type: "RUN_ERROR", code: "ABORTED", message: "Run cancelled by user (interrupt)." } as any);
    return;
  }

  // Guardrail: model must return strict JSON — never invent a plan.
  let doc: PlanDoc | null = null;
  let parseError: string | null = null;
  try {
    const cleaned = full.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    doc = JSON.parse(cleaned);
    if (!Array.isArray((doc as any).plan) || !Array.isArray((doc as any).steps)) {
      throw new Error("JSON missing plan[] / steps[]");
    }
  } catch (e: any) {
    parseError = String(e?.message ?? e);
  }

  if (!doc) {
    send({
      type: "STATE_DELTA",
      deltaState: [{ op: "add", path: "/parseError", value: parseError }],
    } as any);
    send({
      type: "RUN_ERROR",
      code: "PLAN_PARSE_ERROR",
      message: `Model did not return valid plan JSON (${parseError}). Raw output shown in text pane — no plan was invented.`,
    } as any);
    return;
  }

  send({
    type: "STATE_DELTA",
    deltaState: [{ op: "add", path: "/plan", value: doc.plan }],
  } as any);

  const results: unknown[] = [];
  const steps = doc.steps.slice(0, 5);
  for (let i = 0; i < steps.length; i++) {
    if (isAborted()) {
      send({ type: "RUN_ERROR", code: "ABORTED", message: "Run cancelled by user (interrupt)." } as any);
      return;
    }
    const s = steps[i];
    const toolCallId = randomUUID();
    const toolName = String(s.tool ?? "unknown");
    send({ type: "TOOL_CALL_START", toolCallId, toolCallName: toolName } as any);
    const argsText = JSON.stringify(s.args ?? {});
    // stream args in two chunks so ARGS events are visibly real
    const mid = Math.ceil(argsText.length / 2);
    send({ type: "TOOL_CALL_ARGS", toolCallId, argsText: argsText.slice(0, mid) } as any);
    await sleep(120);
    if (isAborted()) {
      send({ type: "RUN_ERROR", code: "ABORTED", message: "Run cancelled by user (interrupt)." } as any);
      return;
    }
    send({ type: "TOOL_CALL_ARGS", toolCallId, argsText: argsText.slice(mid) } as any);
    await sleep(250);
    const result = executeTool(toolName, (s.args ?? {}) as Record<string, unknown>);
    results.push({ tool: toolName, result });
    send({ type: "TOOL_CALL_END", toolCallId, result } as any);
    send({
      type: "STATE_DELTA",
      deltaState: [{ op: "add", path: `/results/${i}`, value: { tool: toolName, result } }],
    } as any);
  }

  send({ type: "RUN_FINISHED", message: `done (${backend})` } as any);
}

export function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
}

export { settingsFrom };
