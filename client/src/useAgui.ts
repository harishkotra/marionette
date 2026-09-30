import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  diffSequences,
  emptyView,
  eventTypeSequence,
  reduceRun,
  type LoggedEvent,
  type RunView,
} from "./agui";

export type Backend = "mastra" | "minimal";

export interface Settings {
  baseURL: string;
  apiKey: string;
  model: string;
}

const LS_KEY = "agui-settings-v1";

export const PRESETS: Record<string, Settings & { label: string }> = {
  particle: { label: "Particle.ai default", baseURL: "https://api.particle.ai/api/v1", apiKey: "", model: "particle-default" },
  lmstudio: { label: "LM Studio", baseURL: "http://localhost:1234/v1", apiKey: "", model: "local-model" },
  ollama: { label: "Ollama", baseURL: "http://localhost:11434/v1", apiKey: "", model: "llama3.1" },
  gemini: { label: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "", model: "gemini-2.0-flash" },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.baseURL && s.model) return { baseURL: s.baseURL, apiKey: s.apiKey ?? "", model: s.model };
    }
  } catch { /* ignore */ }
  return { baseURL: PRESETS.ollama.baseURL, apiKey: "", model: PRESETS.ollama.model };
}

// Consume one SSE-over-POST stream; parse `data: {...}` frames.
export async function* readSSE(resp: Response): AsyncGenerator<any, void, void> {
  if (!resp.body) throw new Error("empty response body");
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      for (const line of f.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          yield JSON.parse(t.slice(5).trim());
        } catch { /* keepalive */ }
      }
    }
  }
}

export function useAguiDemo() {
  const [backend, setBackend] = useState<Backend>("mastra");
  const [task, setTask] = useState("Plan a 3-step launch checklist for a neighbourhood bakery.");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [testResult, setTestResult] = useState<string>("Not tested yet.");
  const abortRef = useRef<AbortController | null>(null);
  const lastTs = useRef<number>(0);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }, [settings]);

  const pushEvent = useCallback((raw: any) => {
    const nowMs = Date.now();
    setEvents((prev) => [
      ...prev,
      {
        ...raw,
        receivedAt: nowMs,
        latencyMs: lastTs.current ? nowMs - lastTs.current : null,
      } as LoggedEvent,
    ]);
    lastTs.current = nowMs;
    if (raw?.runId) setActiveRunId(raw.runId);
  }, []);

  const run = useCallback(
    async (which?: Backend) => {
      const b = which ?? backend;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      try {
        const resp = await fetch(`/api/run/${b}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, ...settings }),
          signal: ctrl.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        for await (const evt of readSSE(resp)) {
          pushEvent(evt);
          if (evt?.type === "RUN_FINISHED" || evt?.type === "RUN_ERROR") break;
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          pushEvent({
            type: "RUN_ERROR",
            runId: activeRunId ?? "client",
            timestamp: new Date().toISOString(),
            backend: b,
            message: `client transport error: ${String(e?.message ?? e)}`,
          });
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [backend, task, settings, pushEvent, activeRunId]
  );

  const stop = useCallback(async () => {
    // Genuine interrupt: tell the server to abort so it emits a
    // real RUN_ERROR/ABORTED event down the still-open stream,
    // then also abort the local fetch as a backstop.
    if (activeRunId) {
      try {
        await fetch("/api/run/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: activeRunId }),
        });
      } catch { /* backstop below */ }
    }
    setTimeout(() => abortRef.current?.abort(), 800);
  }, [activeRunId]);

  const testConnection = useCallback(async () => {
    setTestResult("Testing…");
    try {
      const r = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const j = await r.json();
      setTestResult(`HTTP ${j.status} ok=${j.ok} url=${j.url}\n${String(j.body).slice(0, 600)}`);
    } catch (e: any) {
      setTestResult(`FAILED: ${String(e?.message ?? e)}`);
    }
  }, [settings]);

  const clear = useCallback(() => {
    setEvents([]);
    setActiveRunId(null);
  }, []);

  const view: RunView = useMemo(() => {
    if (!activeRunId) return emptyView("—", backend);
    const runEvents = events.filter((e) => e.runId === activeRunId);
    const b = runEvents[0]?.backend ?? backend;
    return reduceRun(events, activeRunId, String(b));
  }, [events, activeRunId, backend]);

  // Conformance: compare last completed run of each backend by event types.
  const conformance = useMemo(() => {
    const byRun = new Map<string, LoggedEvent[]>();
    for (const e of events) {
      if (!byRun.has(e.runId)) byRun.set(e.runId, []);
      byRun.get(e.runId)!.push(e);
    }
    const last: Record<string, LoggedEvent[] | undefined> = { mastra: undefined, minimal: undefined };
    for (const [, evts] of byRun) {
      const b = String(evts[0]?.backend);
      if (b === "mastra" || b === "minimal") last[b] = evts;
    }
    if (!last.mastra || !last.minimal) {
      return { ready: false, pass: false, diff: ["run both backends on the same input to compare"] as string[] };
    }
    const a = eventTypeSequence(last.mastra);
    const c = eventTypeSequence(last.minimal);
    const d = diffSequences(a, c);
    return {
      ready: true,
      pass: d.length === 0,
      diff: d.length ? d : [`identical event-type sequence (${a.length} events)`],
    };
  }, [events]);

  return {
    backend, setBackend, task, setTask, settings, setSettings,
    events, activeRunId, running, view, conformance,
    run, stop, clear, testConnection, testResult,
  };
}
