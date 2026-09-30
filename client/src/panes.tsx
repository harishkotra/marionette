import { PRESETS, type Settings } from "./useAgui";

const COLORS: Record<string, string> = {
  RUN_STARTED: "#4da3ff",
  TEXT_MESSAGE_START: "#9e9e9e",
  TEXT_MESSAGE_CONTENT: "#e0e0e0",
  TEXT_MESSAGE_END: "#9e9e9e",
  TOOL_CALL_START: "#ffb74d",
  TOOL_CALL_ARGS: "#ffcc80",
  TOOL_CALL_END: "#66bb6a",
  STATE_SNAPSHOT: "#ba68c0",
  STATE_DELTA: "#ce93d8",
  RUN_FINISHED: "#00e676",
  RUN_ERROR: "#ff5252",
};

export function EventLogPane({ events }: { events: import("./agui").LoggedEvent[] }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, overflowY: "auto", height: "100%", padding: 8 }}>
      {events.length === 0 && <div style={{ color: "#888" }}>no events yet — hit Run.</div>}
      {events.map((e, i) => (
        <div key={i} style={{ borderBottom: "1px solid #222", padding: "2px 0" }}>
          <span style={{ color: "#666" }}>
            {new Date(e.receivedAt).toISOString().slice(11, 23)}{" "}
            {e.latencyMs != null ? `+${e.latencyMs}ms ` : ""}
          </span>
          <span style={{ color: COLORS[e.type] ?? "#fff", fontWeight: "bold" }}>{e.type}</span>{" "}
          <span style={{ color: "#888" }}>[{e.backend}/{e.runId.slice(0, 8)}]</span>{" "}
          <span style={{ color: "#aaa" }}>
            {(e.delta ?? e.argsText ?? e.message ?? "").toString().slice(0, 160)}
            {e.toolCallName ? ` tool=${e.toolCallName}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CanvasPane({ view }: { view: import("./agui").RunView }) {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: 12 }}>
      <div style={{ marginBottom: 8, color: view.status === "finished" ? "#00e676" : view.status === "aborted" ? "#ffb74d" : "#4da3ff" }}>
        status: <b>{view.status}</b> {view.error ? `— ${view.error}` : ""}
      </div>
      <h4>Assistant text (from TEXT_MESSAGE_CONTENT)</h4>
      <pre style={{ whiteSpace: "pre-wrap", background: "#111", padding: 8, borderRadius: 6, minHeight: 60 }}>
        {view.text || <span style={{ color: "#666" }}>(no text yet)</span>}
      </pre>
      <h4>Tool calls ({view.tools.length})</h4>
      {view.tools.length === 0 && <div style={{ color: "#666" }}>(none yet)</div>}
      {view.tools.map((t) => (
        <div key={t.id} style={{ border: "1px solid #444", borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <div>
            <b>{t.name}</b> <span style={{ color: t.status === "done" ? "#00e676" : "#ffb74d" }}>{t.status}</span>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#ffcc80" }}>args: {t.argsText || "…"}</div>
          {t.result != null && (
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#66bb6a" }}>
              result: {JSON.stringify(t.result)}
            </div>
          )}
        </div>
      ))}
      <h4>Live state tree (from STATE_*)</h4>
      <pre style={{ background: "#111", padding: 8, borderRadius: 6, fontSize: 12 }}>
        {JSON.stringify(view.stateTree, null, 2)}
      </pre>
    </div>
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
  return (
    <div style={{ border: "1px solid #333", borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <b>LLM settings</b>{" "}
      <span style={{ color: "#888", fontSize: 12 }}>(persisted to localStorage; server holds no keys)</span>
      <div style={{ display: "flex", gap: 6, margin: "8px 0", flexWrap: "wrap" }}>
        {Object.entries(PRESETS).map(([k, p]) => (
          <button
            key={k}
            onClick={() => setSettings({ baseURL: p.baseURL, apiKey: settings.apiKey, model: p.model })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label>Base URL<br />
        <input
          style={{ width: "100%" }}
          value={settings.baseURL}
          onChange={(e) => setSettings({ ...settings, baseURL: e.target.value })}
          placeholder="http://localhost:11434/v1"
        />
      </label>
      <label>API key<br />
        <input
          style={{ width: "100%" }}
          type="password"
          value={settings.apiKey}
          onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
          placeholder="(empty for Ollama / LM Studio)"
        />
      </label>
      <label>Model<br />
        <input
          style={{ width: "100%" }}
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        />
      </label>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button onClick={onTest}>Test connection</button>
      </div>
      <pre style={{ fontSize: 12, background: "#111", padding: 6, borderRadius: 6, whiteSpace: "pre-wrap" }}>
        {testResult}
      </pre>
    </div>
  );
}
