// Mock OpenAI-compatible LLM for screenshots/demos when no real LLM exists.
// Serves: GET /v1/models, POST /v1/chat/completions (streaming SSE + non-streaming).
// Plans vary by task keyword so sample A vs sample B render different tool cards.
import http from "node:http";

const PLAN_BAKERY = {
  plan: [
    "Research high-footfall locations and competitor bakeries nearby",
    "Cost the launch checklist: ovens, permits and first-month supplies",
    "Write the opening-day announcement note",
  ],
  steps: [
    { tool: "web_search", args: { query: "bakery oven suppliers neighbourhood launch checklist" } },
    { tool: "calc", args: { expr: "(4500 + 1200 + 800) * 1.08" } },
    { tool: "write_note", args: { title: "Bakery launch day", body: "Doors open 7am, free sourdough samples." } },
  ],
};

const PLAN_ESPRESSO = {
  plan: [
    "Search three competitor espresso machines under $500",
    "Score them on price, pressure and warranty value",
    "Write the final pick recommendation",
  ],
  steps: [
    { tool: "web_search", args: { query: "best espresso machines under $500 compared 2026" } },
    { tool: "calc", args: { expr: "(429 + 349 + 499) / 3" } },
    { tool: "write_note", args: { title: "Espresso pick", body: "Winner: best 15-bar value with 2-year warranty." } },
  ],
};

function planFor(task) {
  return /espresso/i.test(task) ? PLAN_ESPRESSO : PLAN_BAKERY;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
    return;
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let task = "";
      try {
        const j = JSON.parse(body);
        task = (j.messages || []).filter((m) => m.role === "user").map((m) => m.content).join(" ");
        if (j.stream) return streamPlan(res, planFor(task));
      } catch { /* fall through */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(planFor(task)) } }] }));
    });
    return;
  }
  res.writeHead(404).end("not found");
});

function streamPlan(res, plan) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const text = JSON.stringify(plan, null, 1);
  let i = 0;
  const timer = setInterval(() => {
    i += 7;
    const slice = text.slice(Math.max(0, i - 7), i);
    if (slice) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: slice } }] })}\n\n`);
    }
    if (i >= text.length) {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }, 30);
}

server.listen(4141, () => console.log("mock LLM on :4141"));
