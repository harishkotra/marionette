import type { AguiEvent, LLMSettings } from "shared";
import { DEFAULTS, SYSTEM_PROMPT } from "shared";

export const abortedRuns = new Map<string, boolean>();

export function sseSend(res: any, evt: AguiEvent) {
  res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

export function now() {
  return new Date().toISOString();
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Call an OpenAI-compatible chat-completions endpoint.
// Tries streaming first (real token chunks); falls back to
// non-streaming then re-chunks the full text so the UI still
// shows genuine model output split into chunks.
export async function* streamLLMText(
  settings: LLMSettings,
  userTask: string,
  isAborted: () => boolean = () => false
): AsyncGenerator<string, string, void> {
  const url = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
  const ctrl = new AbortController();
  const poll = setInterval(() => {
    if (isAborted()) ctrl.abort();
  }, 100);
  const done = () => clearInterval(poll);
  const body = {
    model: settings.model,
    temperature: DEFAULTS.temperature,
    max_tokens: DEFAULTS.maxTokens,
    stream: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userTask },
    ],
  };
  let full = "";
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!resp.ok || !resp.body) throw new Error(`LLM HTTP ${resp.status}`);
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) throw new Error("non-streaming-response");
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta: string = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              yield delta;
            }
          } catch { /* ignore keepalive */ }
        }
      }
    }
    return full;
  } catch (e: any) {
    if (isAborted() || e?.name === "AbortError") {
      done();
      throw Object.assign(new Error("__ABORTED__"), { name: "AbortError" });
    }
    // Fallback: non-streaming request, then emit real text in slices.
    const resp2 = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: false }),
      signal: ctrl.signal,
    });
    if (!resp2.ok) {
      const t = await resp2.text().catch(() => "");
      throw new Error(`LLM HTTP ${resp2.status}: ${t.slice(0, 300)}`);
    }
    const json = (await resp2.json()) as any;
    full = json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 2000);
    done();
    const CH = 24;
    for (let i = 0; i < full.length; i += CH) {
      if (isAborted()) throw Object.assign(new Error("__ABORTED__"), { name: "AbortError" });
      yield full.slice(i, i + CH);
    }
    return full;
  } finally {
    done();
  }
}

// Deterministic toy-tool execution derived from the LLM's own args
// (never canned plans — the plan JSON always comes from the model).
export function executeTool(tool: string, args: Record<string, unknown>): unknown {
  if (tool === "calc" && typeof (args as any).expr === "string") {
    const expr = String((args as any).expr).replace(/[^0-9+\-*/(). %]/g, "");
    try {
      const val = Function(`"use strict"; return (${expr || "0"})`)();
      return { expr, value: val };
    } catch (e: any) {
      return { expr, error: String(e?.message ?? e) };
    }
  }
  if (tool === "web_search") return { query: (args as any).query ?? null, hits: [`result derived from query at ${now()}`] };
  if (tool === "write_note") return { saved: true, title: (args as any).title ?? "(untitled)", chars: String((args as any).body ?? "").length };
  return { echo: args, ranAt: now() };
}
