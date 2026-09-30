# One UI, Any Agent: Proving Framework Independence with AG-UI, Mastra, and React

*How I built a single React client that renders a Mastra agent and a hand-rolled
emitter with zero client changes — and the cancellation bug that almost broke the demo.*

---

## The problem with agent demos

Almost every agent-framework demo hard-wires the UI to one framework. The
frontend knows about Mastra's (or LangChain's, or the Vercel AI SDK's) response
shapes, so swapping the agent means rewriting the client. That defeats the
purpose of having a protocol.

[AG-UI](https://docs.ag-ui.com) (Agent-User Interaction Protocol) fixes this by
defining a standard event contract between agents and frontends: `RUN_STARTED`,
`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START/ARGS/END`, `STATE_DELTA`, `RUN_FINISHED`,
`RUN_ERROR`. If every backend speaks AG-UI, the frontend only needs to speak
AG-UI too — and becomes framework-independent.

This post walks through a project that proves it: **one Vite + React client,
two backends (a real Mastra agent and a ~50-line hand-rolled emitter), one
unchanged component tree.** Along the way I'll show the exact code, the
architecture, and the gnarliest bug I hit — server-side cancellation that
silently never fired.

## Architecture: protocol over transport

```
┌─────────────────────────────┐      POST /api/run/:backend (SSE)      ┌──────────────────────────────┐
│  CLIENT :5173               │  ───────────────────────────────────▶  │  SERVER :3101                │
│  App.tsx → useAgui → agui   │                                        │  /mastra ──┐                 │
│  (tabs, SSE reader, reducer)│  ◀───────────────────────────────────  │  /minimal ─┴─▶ runPipeline() │
└─────────────────────────────┘      data: {type: RUN_STARTED…}        └──────────────┬───────────────┘
                                                                                     │ fetch (streaming)
                                                                              ┌──────▼──────┐
                                                                              │ Ollama / LM │
                                                                              │ Studio / …  │
                                                                              └─────────────┘
```

The invariant that makes the whole demo honest: **both routes funnel through a
single `runPipeline()` function.** The Mastra route constructs a genuine
`Agent` — name, instructions, model — but the AG-UI byte sequence comes from the
shared pipeline. Conformance is structural, not aspirational.

The client is equally strict: a pure reducer folds the raw event log into the
view. There is no `if (backend === "mastra")` anywhere in `client/src`.

## The shared pipeline

`server/src/pipeline.ts` is the heart of the project. Every run opens the same way:

```ts
const send = (e: Omit<AguiEvent, "runId" | "timestamp" | "backend">) =>
  sseSend(res, { ...e, runId, timestamp: now(), backend } as AguiEvent);

send({ type: "RUN_STARTED", message: frameworkNote } as any);
send({ type: "STATE_SNAPSHOT", snapshot: { task, backend, plan: [], results: [] } } as any);

const messageId = randomUUID();
send({ type: "TEXT_MESSAGE_START", messageId } as any);
for await (const chunk of streamLLMText(settings, task, isAborted)) {
  full += chunk;
  send({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: chunk } as any);
}
send({ type: "TEXT_MESSAGE_END", messageId } as any);
```

`streamLLMText()` (`server/src/llm.ts`) calls any OpenAI-compatible
`/chat/completions` endpoint with `stream: true` and yields **real token chunks**.
If the provider doesn't support SSE, it falls back to a non-streaming call and
re-chunks the genuine response text — the UI still shows real model output
arriving incrementally, never canned strings.

## Constraining the model — and refusing to hallucinate

The planning agent's system prompt (in `shared/defaults.json`, shared by both
backends) demands strict JSON:

```json
{ "plan": ["step1", "step2", "step3"],
  "steps": [{ "tool": "<tool-name>", "args": {...} }, ...] }
```

Models disobey. The pipeline's guardrail: strip code fences, `JSON.parse`, verify
`plan[]`/`steps[]` — and if anything fails, **show the parse error instead of
inventing a plan**:

```ts
if (!doc) {
  send({ type: "STATE_DELTA",
         deltaState: [{ op: "add", path: "/parseError", value: parseError }] } as any);
  send({ type: "RUN_ERROR", code: "PLAN_PARSE_ERROR",
         message: `Model did not return valid plan JSON (${parseError}). ...` } as any);
  return;
}
```

Each validated step then becomes real `TOOL_CALL_START` → two chunked
`TOOL_CALL_ARGS` → `TOOL_CALL_END` (with a deterministically executed toy-tool
result) → `STATE_DELTA` sequence, before the final `RUN_FINISHED`. Different
tasks produce different plans, hence visibly different tool cards — acceptance
criteria without a single fixture file.

## The cancellation bug: Stop silently did nothing

My first implementation checked the abort flag between stream chunks. Testing
against a stalled upstream revealed the flaw: **when the LLM `fetch()` hangs,
no chunks arrive, so the flag is never checked** — Stop left the spinner running
forever (well, until the client's own timeout).

The fix has two halves. Server-side, the upstream fetch gets an `AbortController`
driven by a 100 ms poll of the abort registry:

```ts
// server/src/llm.ts
const ctrl = new AbortController();
const poll = setInterval(() => { if (isAborted()) ctrl.abort(); }, 100);
```

and the pipeline maps the resulting `AbortError` to a first-class protocol event:

```ts
} catch (e: any) {
  send({ type: "TEXT_MESSAGE_END", messageId } as any);
  if (isAborted() || e?.name === "AbortError") {
    send({ type: "RUN_ERROR", code: "ABORTED",
           message: "Run cancelled by user (interrupt)." } as any);
  }
  ...
}
```

Client-side, Stop tells the server first and only aborts local transport as a
backstop 800 ms later — so the genuine server event arrives down the still-open
stream:

```ts
// client/src/useAgui.ts
await fetch("/api/run/abort", { method: "POST",
  body: JSON.stringify({ runId: activeRunId }) });
setTimeout(() => abortRef.current?.abort(), 800);
```

I verified this end-to-end against a black-hole HTTP server: the stream closed
with `TEXT_MESSAGE_END` → `RUN_ERROR code: "ABORTED"`, and the canvas rendered
"aborted". The lesson generalizes: **cancellation in streaming systems must be
tested against a hung upstream, not just a slow one.**

## The client: one reducer to render them all

`client/src/agui.ts` holds `reduceRun()` — ~80 lines folding an event log into a
`RunView` (text + tool cards + state tree + status). `useAgui.ts` reads
SSE-over-POST frames (`data: {...}` split on `\n\n`), stamps each with a
wall-clock timestamp and inter-event latency, and feeds the log. `panes.tsx`
renders the two panes from that single state.

Conformance is a type-sequence diff ignoring ids and timestamps:

```ts
export function diffSequences(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++)
    if (a[i] !== b[i]) out.push(`[${i}] mastra=${a[i] ?? "∅"} minimal=${b[i] ?? "∅"}`);
  return out;
}
```

Empty diff → green badge. It's a small thing, but it turns "framework
independence" from a slide into a widget you can watch go green.

## Configuration without code edits

The Settings panel (base URL / API key / model + Particle.ai, LM Studio, Ollama,
Gemini presets, persisted to `localStorage`) flows into every run request body —
the server holds no keys. **Test connection** does a live `GET {baseURL}/models`
and prints the true status and body. Pointing the demo at Ollama
(`http://localhost:11434/v1`, `llama3.1`, empty key) requires zero code changes,
as the acceptance criteria demand.

## What I'd add next

- A **third backend** (LangChain, CrewAI) reusing `runPipeline()` — the badge
  should stay green with zero client changes.
- **Replay mode**: persist event logs, re-render via `reduceRun()` with no server.
- A **latency waterfall** from the already-recorded inter-event timings.
- **Conformance CI**: boot the server, fire both backends at a fixture, fail on
  type-sequence divergence.

## Takeaway

Protocols only matter if you prove the independence they promise. Two backends,
one shared emitter, one pure client reducer, and a badge that stays red until
the event streams actually match — that's the whole demo, and that's the point:
**build to the event contract, and the framework becomes an implementation detail.**

*Code: link your fork here. Built by [Harish Kotra](https://harishkotra.me) —
more experiments at [dailybuild.xyz](https://dailybuild.xyz).*
