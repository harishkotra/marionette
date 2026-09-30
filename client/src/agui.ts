// Single shared AG-UI state: raw event log -> reducer -> rendered view.
// No framework-specific client code — this tree is identical for both backends.

export interface AguiEvent {
  type: string;
  runId: string;
  timestamp: string;
  backend: "mastra" | "minimal";
  messageId?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  argsText?: string;
  result?: unknown;
  deltaState?: unknown;
  snapshot?: unknown;
  message?: string;
  code?: string;
  [k: string]: unknown;
}

export interface LoggedEvent extends AguiEvent {
  receivedAt: number;
  latencyMs: number | null;
}

export interface ToolCard {
  id: string;
  name: string;
  argsText: string;
  result: unknown | null;
  status: "running" | "done";
}

export interface RunView {
  runId: string;
  backend: string;
  text: string;
  tools: ToolCard[];
  stateTree: Record<string, unknown>;
  status: "running" | "finished" | "error" | "aborted";
  error: string | null;
}

export function emptyView(runId: string, backend: string): RunView {
  return { runId, backend, text: "", tools: [], stateTree: {}, status: "running", error: null };
}

// Pure reducer: event log -> view. Everything rendered comes from the stream.
export function reduceRun(events: LoggedEvent[], runId: string, backend: string): RunView {
  const view = emptyView(runId, backend);
  const toolArgs: Record<string, string> = {};
  for (const e of events) {
    if (e.runId !== runId) continue;
    switch (e.type) {
      case "TEXT_MESSAGE_CONTENT":
        view.text += String(e.delta ?? "");
        break;
      case "TOOL_CALL_START": {
        const id = String(e.toolCallId ?? `tool-${view.tools.length}`);
        view.tools.push({ id, name: String(e.toolCallName ?? "unknown"), argsText: "", result: null, status: "running" });
        toolArgs[id] = "";
        break;
      }
      case "TOOL_CALL_ARGS": {
        const id = String(e.toolCallId ?? "");
        toolArgs[id] = (toolArgs[id] ?? "") + String(e.argsText ?? "");
        const t = view.tools.find((t) => t.id === id);
        if (t) t.argsText = toolArgs[id];
        break;
      }
      case "TOOL_CALL_END": {
        const id = String(e.toolCallId ?? "");
        const t = view.tools.find((t) => t.id === id);
        if (t) {
          t.result = e.result ?? null;
          t.status = "done";
        }
        break;
      }
      case "STATE_SNAPSHOT":
        view.stateTree = { ...((e.snapshot as Record<string, unknown>) ?? {}) };
        break;
      case "STATE_DELTA": {
        const ops = Array.isArray(e.deltaState) ? (e.deltaState as any[]) : [];
        for (const op of ops) {
          const path = String(op.path ?? "").replace(/^\//, "");
          if (path === "plan") (view.stateTree as any).plan = op.value;
          else if (path.startsWith("results/")) {
            const cur = Array.isArray((view.stateTree as any).results) ? [...(view.stateTree as any).results] : [];
            cur[Number(path.split("/")[1])] = op.value;
            (view.stateTree as any).results = cur;
          } else if (path === "parseError") (view.stateTree as any).parseError = op.value;
          else (view.stateTree as any)[path] = op.value;
        }
        break;
      }
      case "RUN_FINISHED":
        view.status = "finished";
        break;
      case "RUN_ERROR":
        if (e.code === "ABORTED") view.status = "aborted";
        else {
          view.status = "error";
          view.error = String(e.message ?? "unknown error");
        }
        if (e.code === "ABORTED") view.error = "Cancelled by user (server ABORTED event).";
        break;
      default:
        break;
    }
  }
  return view;
}

// Conformance: same event-type sequence modulo ids/timestamps?
export function eventTypeSequence(events: LoggedEvent[]): string[] {
  return events.map((e) => {
    if (e.type === "TOOL_CALL_ARGS") return "TOOL_CALL_ARGS";
    return e.type;
  });
}

export function diffSequences(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) out.push(`[${i}] mastra=${a[i] ?? "∅"} minimal=${b[i] ?? "∅"}`);
  }
  return out;
}
