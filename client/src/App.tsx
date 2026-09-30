import { CanvasPane, EventLogPane, SettingsPanel } from "./panes";
import { useAguiDemo, type Backend } from "./useAgui";

const SAMPLE_A = "Plan a 3-step launch checklist for a neighbourhood bakery.";
const SAMPLE_B = "Research three competitor espresso machines under $500 and pick a winner.";

export default function App() {
  const d = useAguiDemo();

  return (
    <div style={{ fontFamily: "system-ui", background: "#0d0d0f", color: "#eee", minHeight: "100vh", padding: 16 }}>
      <h2 style={{ margin: "0 0 4px" }}>AG-UI · one UI, two backends</h2>
      <div style={{ color: "#888", fontSize: 13, marginBottom: 10 }}>
        Single shared component tree renders purely from AG-UI events. No framework-specific client code.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        {(["mastra", "minimal"] as Backend[]).map((b) => (
          <button
            key={b}
            onClick={() => d.setBackend(b)}
            style={{
              fontWeight: d.backend === b ? "bold" : "normal",
              background: d.backend === b ? "#1e5eff" : "#222",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {b === "mastra" ? "Mastra" : "Minimal"}
          </button>
        ))}
        <span
          title="protocol conformance"
          style={{
            borderRadius: 12,
            padding: "4px 12px",
            fontSize: 12,
            background: d.conformance.ready && d.conformance.pass ? "#0a5c2e" : "#333",
            color: d.conformance.ready && d.conformance.pass ? "#00e676" : "#aaa",
            border: "1px solid #555",
          }}
        >
          {d.conformance.ready && d.conformance.pass
            ? "● protocol conformance: PASS"
            : "○ protocol conformance: pending"}
        </span>
        <span style={{ fontSize: 12, color: "#888" }}>
          run both backends on the same input — badge goes green only when event-type sequences match
        </span>
      </div>

      <SettingsPanel
        settings={d.settings}
        setSettings={d.setSettings}
        onTest={d.testConnection}
        testResult={d.testResult}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #444", background: "#111", color: "#eee" }}
          value={d.task}
          onChange={(e) => d.setTask(e.target.value)}
          placeholder="Type a task…"
        />
        <button onClick={() => d.run()} disabled={d.running} style={{ padding: "8px 18px" }}>
          {d.running ? "Running…" : "Run"}
        </button>
        <button onClick={d.stop} disabled={!d.running} style={{ padding: "8px 18px" }}>
          Stop
        </button>
        <button onClick={d.clear} disabled={d.running} style={{ padding: "8px 18px" }}>
          Clear
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, fontSize: 12 }}>
        <span style={{ color: "#888" }}>Try two visibly different inputs:</span>
        <button onClick={() => { d.setTask(SAMPLE_A); }}>sample A: bakery</button>
        <button onClick={() => { d.setTask(SAMPLE_B); }}>sample B: espresso</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, height: 480 }}>
        <div style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 6, background: "#16161a", fontSize: 12, color: "#888" }}>
            raw event log ({d.events.length} events)
          </div>
          <div style={{ height: 440 }}>
            <EventLogPane events={d.events} />
          </div>
        </div>
        <div style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 6, background: "#16161a", fontSize: 12, color: "#888" }}>
            rendered view — backend: {d.view.backend} · run {String(d.activeRunId ?? "—").slice(0, 8)}
          </div>
          <div style={{ height: 440 }}>
            <CanvasPane view={d.view} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, border: "1px solid #333", borderRadius: 8, padding: 10 }}>
        <b style={{ fontSize: 13 }}>Event-type diff (mastra vs minimal, ids ignored)</b>
        <pre style={{ fontSize: 12, background: "#111", padding: 8, borderRadius: 6 }}>
          {d.conformance.diff.join("\n")}
        </pre>
      </div>

      <footer style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: "#888" }}>
        Built by{" "}
        <a href="https://harishkotra.me" target="_blank" rel="noreferrer" style={{ color: "#4da3ff" }}>
          Harish Kotra
        </a>{" "}
        · Checkout my other builds at{" "}
        <a href="https://dailybuild.xyz" target="_blank" rel="noreferrer" style={{ color: "#4da3ff" }}>
          dailybuild.xyz
        </a>
      </footer>
    </div>
  );
}
