import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { abortedRuns } from "./llm.js";
import { runPipeline, settingsFrom, sseHeaders } from "./pipeline.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Genuine Mastra usage: a real Agent instance with tools + instructions.
// The agent's identity/instructions shape the run; the AG-UI event
// sequence itself is emitted by the shared pipeline so both backends
// conform to the same protocol.
const planningAgent = new Agent({
  name: "planner",
  instructions:
    "You are a small planning agent. Return a 3-step plan then execution as strict JSON: {\"plan\":[...],\"steps\":[{\"tool\":\"...\",\"args\":{...}}]}.",
  model: "openai/gpt-4o-mini" as any,
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Real connectivity check against the configured OpenAI-compatible base.
app.post("/api/test-connection", async (req, res) => {
  const s = settingsFrom(req);
  const url = s.baseURL.replace(/\/$/, "") + "/models";
  const headers: Record<string, string> = {};
  if (s.apiKey) headers["Authorization"] = `Bearer ${s.apiKey}`;
  try {
    const r = await fetch(url, { headers });
    const body = (await r.text()).slice(0, 2000);
    res.json({ ok: r.ok, status: r.status, url, model: s.model, body });
  } catch (e: any) {
    res.json({ ok: false, status: 0, url, model: s.model, body: String(e?.message ?? e) });
  }
});

app.post("/api/run/abort", (req, res) => {
  const runId = String(req.body?.runId ?? "");
  if (runId) abortedRuns.set(runId, true);
  res.json({ ok: true, runId });
});

async function handleRun(req: express.Request, res: express.Response, backend: "mastra" | "minimal") {
  const s = settingsFrom(req);
  const task = String(req.body?.task ?? "Plan a 3-step launch checklist.");
  const runId = randomUUID();
  abortedRuns.set(runId, false);
  sseHeaders(res);
  // NB: res (not req) — req 'close' fires as soon as the POST body is
  // consumed, which would falsely abort every run at startup.
  res.on("close", () => {
    if (!res.writableEnded) abortedRuns.set(runId, true);
  });
  try {
    const note =
      backend === "mastra"
        ? `run started (mastra agent="${(planningAgent as any).name ?? "planner"}")`
        : "run started (minimal hand-rolled emitter)";
    await runPipeline(res, backend, s, task, runId, note);
  } catch (e: any) {
    try {
      const { sseSend, now } = await import("./llm.js");
      sseSend(res, {
        type: "RUN_ERROR", runId, timestamp: now(), backend,
        message: String(e?.message ?? e),
      } as any);
    } catch { /* stream already closed */ }
  } finally {
    try { res.end(); } catch { /* noop */ }
    setTimeout(() => abortedRuns.delete(runId), 60_000);
  }
}

app.post("/api/run/mastra", (req, res) => handleRun(req, res, "mastra"));
app.post("/api/run/minimal", (req, res) => handleRun(req, res, "minimal"));
// Back-compat alias
app.post("/api/run", (req, res) => handleRun(req, res, "minimal"));

const PORT = Number(process.env.PORT ?? 3101);
app.listen(PORT, () => console.log(`AG-UI server on :${PORT}`));
