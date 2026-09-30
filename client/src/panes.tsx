import { useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, type Settings } from "./useAgui";
import type { LoggedEvent, RunView } from "./agui";

type Family = "all" | "run" | "text" | "tools" | "state";

const FAMILY_OF: Record<string, Family> = {
  RUN_STARTED: "run",
  RUN_FINISHED: "run",
  RUN_ERROR: "run",
  TEXT_MESSAGE_START: "text",
  TEXT_MESSAGE_CONTENT: "text",
  TEXT_MESSAGE_END: "text",
  TOOL_CALL_START: "tools",
  TOOL_CALL_ARGS: "tools",
  TOOL_CALL_END: "tools",
  STATE_SNAPSHOT: "state",
  STATE_DELTA: "state",
};

function pillClass(e: LoggedEvent): string {
  switch (e.type) {
    case "RUN_STARTED": return "run";
    case "RUN_FINISHED": return "done";
    case "RUN_ERROR": return e.code === "ABORTED" ? "tool" : "fail";
    case "TEXT_MESSAGE_CONTENT": return "chunk";
    case "TOOL_CALL_END": return "done";
    case "STATE_SNAPSHOT":
    case "STATE_DELTA": return "state";
    default:
      if (e.type.startsWith("TOOL_CALL")) return "tool";
      if (e.type.startsWith("TEXT_MESSAGE")) return "text";
      return "run";
  }
}

function payload(e: LoggedEvent): string {
  const s = (e.delta ?? e.argsText ?? e.message ?? "").toString();
  const tool = e.toolCallName ? `tool=${e.toolCallName} ` : "";
  const id = e.toolCallId ? `#${String(e.toolCallId).slice(0, 8)} ` : "";
  return `${tool}${id}${s}`.slice(0, 200) || "—";
}

export function EventLogPane({ events }: { events: LoggedEvent[] }) {
  const [family, setFamily] = useState<Family>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<Family, number> = { all: events.length, run: 0, text: 0, tools: 0, state: 0 };
    for (const e of events) c[FAMILY_OF[e.type] ?? "run"]++;
    return c;
  }, [events]);

  const visible = family === "all" ? events : events.filter((e) => (FAMILY_OF[e.type] ?? "run") === family);
  const maxLat = Math.max(0, ...visible.map((e) => e.latencyMs ?? 0));

  useEffect(() => {
    if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [events.length, autoScroll, family]);

  return (
    <>
      <div className="pane-head">
        <span className="pane-title">Event <b>stream</b></span>
        <span className="pane-sub">{events.length} events</span>
      </div>
      <div className="pane-head" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <div className="samples" role="group" aria-label="Filter events by family">
          {(["all", "run", "text", "tools", "state"] as Family[]).map((f) => (
            <button key={f} className="chip" aria-pressed={family === f} onClick={() => setFamily(f)}>
              {f} · {counts[f]}
            </button>
          ))}
        </div>
        <button className="chip" aria-pressed={autoScroll} onClick={() => setAutoScroll((v) => !v)}>
          autoscroll {autoScroll ? "on" : "off"}
        </button>
      </div>
      <div className="pane-body" ref={bodyRef}>
        <div className="stream">
          {visible.length === 0 && (
            <div className="stream-empty">
              No events on this channel yet. Pick a backend, type a task, press Run — every
              frame the server emits lands here with its timestamp and gap.
            </div>
          )}
          {visible.map((e, i) => (
            <div className="ev" key={`${e.runId}-${i}`}>
              <span>
                <time>{new Date(e.receivedAt).toISOString().slice(11, 23)}</time>{" "}
                <span className="lat">{e.latencyMs != null ? `+${e.latencyMs}ms` : ""}</span>
              </span>
              <span className={`pill ${pillClass(e)}`}>{e.type}</span>
              <span className="payload" title={payload(e)}>
                <code>[{e.backend}/{e.runId.slice(0, 8)}]</code> {payload(e)}
              </span>
              <span
                className="latbar"
                style={{ width: `${maxLat > 0 && e.latencyMs != null ? 6 + 94 * (e.latencyMs / maxLat) : 4}%` }}
                title={e.latencyMs != null ? `gap ${e.latencyMs}ms` : "first event"}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function CanvasPane({ view, runId }: { view: RunView; runId: string | null }) {
  const keys = Object.keys(view.stateTree ?? {}).length;
  return (
    <>
      <div className="pane-head">
        <span className="pane-title">Rendered <b>view</b></span>
        <span className="pane-sub">
          backend: {view.backend} · run {runId ? runId.slice(0, 8) : "—"}
        </span>
      </div>
      <div className="pane-body">
        <div className="canvas">
          <div className="statusline" data-s={view.status}>
            <span className="beacon" aria-hidden />
            <span className="k">status:</span> <strong>{view.status}</strong>
            {view.error && <span className="err">— {view.error}</span>}
          </div>

          <h3>Assistant text · TEXT_MESSAGE_CONTENT</h3>
          <p className="prose">{view.text || <span className="none">(stream the run — tokens land here)</span>}</p>

          <h3>Tool calls · {view.tools.length}</h3>
          {view.tools.length === 0 && (
            <p className="prose"><span className="none">(each planned step becomes a card)</span></p>
          )}
          {view.tools.map((t, i) => (
            <div className="toolcard" key={t.id}>
              <div className="toolcard-head">
                <span className="toolnum">{String(i + 1).padStart(2, "0")}</span>
                <span className="toolname">{t.name}</span>
                <span className={`toolstatus ${t.status}`}>{t.status}</span>
              </div>
              <dl className="kv">
                <dt>args</dt>
                <dd className="args">{t.argsText || "…"}</dd>
                {t.result != null && (
                  <>
                    <dt>result</dt>
                    <dd className="result">{JSON.stringify(t.result)}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}

          <h3>Live state tree · {keys} {keys === 1 ? "key" : "keys"}</h3>
          <p className="prose">{JSON.stringify(view.stateTree, null, 2)}</p>
        </div>
      </div>
    </>
  );
}

export function SettingsPanel({
  settings,
  setSettings,
  onTest,
  testResult,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  onTest: () => void;
  testResult: string;
}) {
  const ok = testResult.startsWith("HTTP 2");
  return (
    <details className="settings">
      <summary>
        <b>LLM settings</b>
        <span>
          {settings.model} @ {settings.baseURL} · stored in localStorage, never on the server
        </span>
      </summary>
      <div className="settings-body">
        <div className="presets">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button
              key={k}
              className="chip"
              onClick={() => setSettings({ baseURL: p.baseURL, apiKey: settings.apiKey, model: p.model })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="field">Base URL
          <input
            value={settings.baseURL}
            onChange={(e) => setSettings({ ...settings, baseURL: e.target.value })}
            placeholder="http://localhost:11434/v1"
          />
        </label>
        <label className="field">API key
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            placeholder="(empty for Ollama / LM Studio)"
          />
        </label>
        <label className="field">Model
          <input
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          />
        </label>
        <div className="test-line">
          <button className="btn" onClick={onTest}>Test connection</button>
          <pre className={`test-out${ok ? " ok" : ""}`}>{testResult}</pre>
        </div>
      </div>
    </details>
  );
}
