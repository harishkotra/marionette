import defaults from "../defaults.json" with { type: "json" };

export type AguiEventType =
  | "RUN_STARTED" | "TEXT_MESSAGE_START" | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END" | "TOOL_CALL_START" | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END" | "STATE_SNAPSHOT" | "STATE_DELTA"
  | "RUN_FINISHED" | "RUN_ERROR";

export interface AguiEvent {
  type: AguiEventType;
  runId: string;
  timestamp: string;
  backend: "mastra" | "minimal";
  messageId?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  content?: string;
  argsText?: string;
  result?: unknown;
  deltaState?: unknown;
  snapshot?: unknown;
  message?: string;
  code?: string;
}

export const DEFAULTS = (defaults as any).inferenceDefaults as {
  temperature: number; maxTokens: number; stream: boolean;
};
export const PRESETS = (defaults as any).presets as Record<
  string, { label: string; baseURL: string; model: string }
>;
export const SYSTEM_PROMPT = (defaults as any).systemPrompt as string;
export const AGUI_EVENTS = (defaults as any).aguiEvents as string[];

export interface LLMSettings {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface PlanDoc {
  plan: string[];
  steps: { tool: string; args: Record<string, unknown> }[];
}
