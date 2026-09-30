import { CanvasPane, EventLogPane, SettingsPanel } from "./panes";
import { useAguiDemo, type Backend } from "./useAgui";

const SAMPLE_A = "Plan a 3-step launch checklist for a neighbourhood bakery.";
const SAMPLE_B = "Research three competitor espresso machines under $500 and pick a winner.";

export default function App() {
  const d = useAguiDemo();
  const pass = d.conformance.ready && d.conformance.pass;

  return (
    <div className="obs">
      <header className="masthead">
        <div>
          <div className="eyebrow">AG-UI · Protocol observatory</div>
          <h1>
            One UI, <em>two backends.</em>
          </h1>
          <p className="standfirst">
            A single component tree renders a Mastra agent and a hand-rolled emitter purely
            from AG-UI events. Nothing here knows which backend is speaking.
          </p>
        </div>
        <div className={`badge${pass ? " pass" : ""}`} role="status">
          <span className="dot" aria-hidden />
          <span>
            <strong>{pass ? "● protocol conformance: PASS" : "○ protocol conformance: pending"}</strong>
            <small>green only when both backends emit the same event-type sequence</small>
          </span>
        </div>
      </header>

      <section className="deck" aria-label="Run controls">
        <div className="deck-row">
          <div className="segmented" role="group" aria-label="Backend">
            {(["mastra", "minimal"] as Backend[]).map((b) => (
              <button key={b} aria-pressed={d.backend === b} onClick={() => d.setBackend(b)}>
                {b === "mastra" ? "Mastra" : "Minimal"}
              </button>
            ))}
          </div>
          <input
            className="task-input"
            value={d.task}
            onChange={(e) => d.setTask(e.target.value)}
            placeholder="Type a task for the agent…"
            aria-label="Task"
          />
          <button className="btn btn-run" onClick={() => d.run()} disabled={d.running}>
            {d.running ? "Running…" : "Run"}
          </button>
          <button className="btn btn-stop" onClick={d.stop} disabled={!d.running}>
            Stop
          </button>
          <button className="btn" onClick={d.clear} disabled={d.running}>
            Clear
          </button>
        </div>
        <div className="deck-row samples">
          <span>Two visibly different inputs:</span>
          <button className="chip" onClick={() => d.setTask(SAMPLE_A)}>sample A: bakery</button>
          <button className="chip" onClick={() => d.setTask(SAMPLE_B)}>sample B: espresso</button>
        </div>
      </section>

      <SettingsPanel
        settings={d.settings}
        setSettings={d.setSettings}
        onTest={d.testConnection}
        testResult={d.testResult}
      />

      <main className="grid">
        <section className="pane" aria-label="Raw event stream">
          <EventLogPane events={d.events} />
        </section>
        <section className="pane" aria-label="Rendered view">
          <CanvasPane view={d.view} runId={d.activeRunId} />
        </section>
      </main>

      <section className={`diff${pass ? " pass" : " wait"}`} aria-label="Conformance diff">
        <h3>Event-type diff · mastra vs minimal, ids ignored</h3>
        <pre>{d.conformance.diff.join("\n")}</pre>
      </section>

      <footer className="obs-foot">
        Built by <a href="https://harishkotra.me" target="_blank" rel="noreferrer">Harish Kotra</a>
        {" "}· Checkout my other builds at{" "}
        <a href="https://dailybuild.xyz" target="_blank" rel="noreferrer">dailybuild.xyz</a>
      </footer>
    </div>
  );
}
