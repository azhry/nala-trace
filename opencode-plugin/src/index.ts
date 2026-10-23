import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Plugin } from "@opencode/plugin";

const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_QUEUE_SIZE = 128;
const MAX_TRACKED_SESSIONS = 512;
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 2000;
const SESSION_LOOKUP_TIMEOUT_MS = 1000;

type Environment = Record<string, string | undefined>;

export interface IngestConfig {
  apiUrl: string;
  apiToken: string;
  timeoutMs: number;
}

export interface TracePayload extends Record<string, unknown> {
  session_id: string;
  hook_event_name: string;
}

interface OpenCodeTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

interface TurnState {
  id: string;
  usage: OpenCodeTokenUsage;
  hasUsage: boolean;
  textParts: Map<string, Map<number, string>>;
  textOrder: string[];
  lastAssistantMessage?: string;
}

export interface SessionState {
  sessionID: string;
  clientVersion: string;
  title?: string;
  model?: string;
  provider?: string;
  agent?: string;
  started: boolean;
  accepted?: boolean;
  scopeResolved: boolean;
  scopePromise?: Promise<boolean>;
  activeTurn?: TurnState;
  pendingTurnID?: string;
}

interface CaptureTask {
  sessionID: string;
  locationDirectory?: string;
  activity: boolean;
  apply: (state: SessionState) => TracePayload | TracePayload[] | undefined;
}

interface SessionInfoLike {
  title?: unknown;
  model?: unknown;
  agent?: unknown;
  location?: unknown;
}

type PluginContext = Plugin.Context;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return undefined;
}

function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

function validApiUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
    return value.trim();
  } catch {
    return undefined;
  }
}

function timeoutValue(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.floor(parsed)));
}

export async function loadConfig(input: {
  projectDirectory: string;
  env?: Environment;
  homeDirectory?: string;
}): Promise<IngestConfig | undefined> {
  const env = input.env ?? process.env;
  const homeDirectory = input.homeDirectory ?? homedir();
  const configuredDirectory = stringValue(env.OPENCODE_CONFIG_DIR);
  const xdgDirectory = stringValue(env.XDG_CONFIG_HOME) ?? join(homeDirectory, ".config");
  const userDirectory = configuredDirectory ? resolve(configuredDirectory) : join(xdgDirectory, "opencode");
  const customConfigFile = stringValue(env.OPENCODE_TRACE_CONFIG_FILE);
  const configFiles = [
    join(userDirectory, "nala-trace.env"),
    join(input.projectDirectory, ".opencode", "nala-trace.env"),
  ];
  if (customConfigFile) {
    configFiles.push(resolve(input.projectDirectory, customConfigFile));
  }

  const fileValues: Record<string, string> = {};
  for (const configFile of configFiles) Object.assign(fileValues, await readEnvFile(configFile));

  const apiUrl = validApiUrl(
    firstString(env.OPENCODE_TRACE_API_URL, fileValues.OPENCODE_TRACE_API_URL) ?? "",
  );
  const apiToken = firstString(env.OPENCODE_TRACE_API_TOKEN, fileValues.OPENCODE_TRACE_API_TOKEN);
  if (!apiUrl || !apiToken) return undefined;

  const timeout = firstString(env.OPENCODE_TRACE_API_TIMEOUT, fileValues.OPENCODE_TRACE_API_TIMEOUT);
  return {
    apiUrl,
    apiToken,
    timeoutMs: timeoutValue(timeout),
  };
}

function normalizePath(value: string): string {
  const normalized = resolve(value).replace(/\\/g, "/");
  if (/^[A-Za-z]:\/$/.test(normalized)) {
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }
  const trimmed = normalized.replace(/\/+$/, "") || "/";
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

export function isWithinProject(projectRoots: string[], candidate: string | undefined): boolean {
  if (!candidate) return false;
  const target = normalizePath(candidate);
  return projectRoots.some((root) => {
    const base = normalizePath(root);
    return target === base || target.startsWith(base.endsWith("/") ? base : base + "/");
  });
}

function runtimeMetadata(state: SessionState): Record<string, string> {
  const result: Record<string, string> = {
    client: "opencode",
    client_version: state.clientVersion,
  };
  if (state.model) result.model = state.model;
  if (state.provider) result.provider = state.provider;
  if (state.agent) result.agent = state.agent;
  return result;
}

function basePayload(state: SessionState, hookEventName: string, turnID?: string): TracePayload {
  const payload: TracePayload = {
    session_id: state.sessionID,
    hook_event_name: hookEventName,
    timestamp: new Date().toISOString(),
    runtime_metadata: runtimeMetadata(state),
  };
  if (state.title) payload.session_title = state.title;
  if (state.agent) payload.agent = state.agent;
  if (turnID) payload.turn_id = turnID;
  return payload;
}

function readModel(state: SessionState, value: unknown): void {
  const model = asRecord(value);
  if (!model) return;
  const id = firstString(model.id, model.model, model.modelID, model.model_id);
  const provider = firstString(model.providerID, model.provider, model.provider_id);
  if (id) state.model = id;
  if (provider) state.provider = provider;
}

function updateFromSessionInfo(state: SessionState, value: unknown): void {
  const info = asRecord(value) as SessionInfoLike | undefined;
  if (!info) return;
  const title = stringValue(info.title);
  const agent = stringValue(info.agent);
  if (title) state.title = title;
  if (agent) state.agent = agent;
  readModel(state, info.model);
}

function emptyUsage(): OpenCodeTokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function tokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function readTokenUsage(value: unknown): OpenCodeTokenUsage | undefined {
  const tokens = asRecord(value);
  if (!tokens) return undefined;
  const cache = asRecord(tokens.cache);
  const keys = ["input", "output", "reasoning"];
  const hasCoreUsage = keys.some((key) => Object.prototype.hasOwnProperty.call(tokens, key));
  const hasCacheUsage = Boolean(cache && ("read" in cache || "write" in cache));
  if (!hasCoreUsage && !hasCacheUsage) return undefined;
  return {
    input: tokenCount(tokens.input),
    output: tokenCount(tokens.output),
    reasoning: tokenCount(tokens.reasoning),
    cacheRead: tokenCount(cache?.read),
    cacheWrite: tokenCount(cache?.write),
  };
}

function createTurn(id: string): TurnState {
  return {
    id,
    usage: emptyUsage(),
    hasUsage: false,
    textParts: new Map(),
    textOrder: [],
  };
}

function addUsage(turn: TurnState, value: unknown): void {
  const usage = readTokenUsage(value);
  if (!usage) return;
  turn.hasUsage = true;
  turn.usage.input += usage.input;
  turn.usage.output += usage.output;
  turn.usage.reasoning += usage.reasoning;
  turn.usage.cacheRead += usage.cacheRead;
  turn.usage.cacheWrite += usage.cacheWrite;
}

function recordAssistantText(turn: TurnState, messageID: string, ordinal: number, text: string): void {
  let parts = turn.textParts.get(messageID);
  if (!parts) {
    parts = new Map();
    turn.textParts.set(messageID, parts);
    turn.textOrder.push(messageID);
  }
  parts.set(ordinal, text);
  const joined = Array.from(parts.entries())
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1])
    .join("");
  if (joined.trim()) turn.lastAssistantMessage = joined;
}

export class SessionAccumulator {
  readonly state: SessionState;

  constructor(sessionID: string, clientVersion: string);
  constructor(state: SessionState);
  constructor(sessionIDOrState: string | SessionState, clientVersion?: string) {
    this.state =
      typeof sessionIDOrState === "string"
        ? {
            sessionID: sessionIDOrState,
            clientVersion: clientVersion ?? "unknown",
            started: false,
            scopeResolved: false,
          }
        : sessionIDOrState;
  }

  updateFromSessionInfo(value: unknown): void {
    updateFromSessionInfo(this.state, value);
  }

  sessionStart(): TracePayload {
    return basePayload(this.state, "SessionStart");
  }

  prompt(eventValue: unknown): TracePayload | undefined {
    const event = asRecord(eventValue);
    if (!event) return undefined;
    const messageID = stringValue(event.messageID);
    const prompt = asRecord(event.prompt);
    if (!messageID || !prompt) return undefined;

    const delivery = stringValue(event.delivery);
    let turnID = this.state.activeTurn?.id;
    if (!turnID || delivery === "queue") {
      this.state.pendingTurnID = messageID;
      turnID = messageID;
    }
    const payload = basePayload(this.state, "UserPromptSubmit", turnID);
    payload.prompt = event.prompt;
    return payload;
  }

  toolBefore(eventValue: unknown): TracePayload | undefined {
    const event = asRecord(eventValue);
    if (!event) return undefined;
    const sessionID = stringValue(event.sessionID);
    const toolName = stringValue(event.tool);
    const toolUseID = stringValue(event.id);
    if (sessionID !== this.state.sessionID || !toolName || !toolUseID) return undefined;
    const agent = stringValue(event.agent);
    if (agent && !this.state.agent) this.state.agent = agent;
    const turnID = this.state.activeTurn?.id ?? this.state.pendingTurnID ?? stringValue(event.messageID);
    const payload = basePayload(this.state, "PreToolUse", turnID);
    if (agent) payload.agent = agent;
    payload.tool_name = toolName;
    payload.tool_use_id = toolUseID;
    payload.tool_input = event.input;
    return payload;
  }

  toolAfter(eventValue: unknown): TracePayload | undefined {
    const event = asRecord(eventValue);
    if (!event) return undefined;
    const sessionID = stringValue(event.sessionID);
    const toolName = stringValue(event.tool);
    const toolUseID = stringValue(event.id);
    if (sessionID !== this.state.sessionID || !toolName || !toolUseID) return undefined;
    const agent = stringValue(event.agent);
    if (agent && !this.state.agent) this.state.agent = agent;
    const turnID = this.state.activeTurn?.id ?? this.state.pendingTurnID ?? stringValue(event.messageID);
    const payload = basePayload(this.state, "PostToolUse", turnID);
    if (agent) payload.agent = agent;
    payload.tool_name = toolName;
    payload.tool_use_id = toolUseID;
    payload.tool_input = event.input;
    if (event.status === "completed") {
      payload.tool_response = event.result;
      payload.tool_status = "completed";
    } else if (event.status === "error") {
      payload.tool_response = { error: event.error };
      payload.tool_status = "error";
    } else {
      return undefined;
    }
    return payload;
  }

  openCodeEvent(eventValue: unknown): TracePayload | undefined {
    const event = asRecord(eventValue);
    if (!event) return undefined;
    const type = stringValue(event.type);
    const data = asRecord(event.data);
    if (!type || !data || stringValue(data.sessionID) !== this.state.sessionID) return undefined;

    if (type === "session.agent.selected") {
      const agent = firstString(data.agent, data.agentID, data.agent_id);
      if (agent) this.state.agent = agent;
      return undefined;
    }
    if (type === "session.model.selected") {
      readModel(this.state, data.model);
      return undefined;
    }
    if (type === "session.renamed") {
      const title = stringValue(data.title);
      if (title) this.state.title = title;
      return undefined;
    }
    if (type === "session.execution.started") {
      const eventID = stringValue(event.id);
      const turnID = this.state.pendingTurnID ?? eventID;
      if (turnID) this.state.activeTurn = createTurn(turnID);
      if (this.state.pendingTurnID === turnID) this.state.pendingTurnID = undefined;
      return undefined;
    }
    if (type === "session.text.ended") {
      const messageID = stringValue(data.assistantMessageID);
      const text = typeof data.text === "string" ? data.text : undefined;
      const turn = this.ensureTurn(stringValue(event.id));
      if (turn && messageID && text !== undefined) {
        const ordinal = tokenCount(data.ordinal);
        recordAssistantText(turn, messageID, ordinal, text);
      }
      return undefined;
    }
    if (type === "session.step.ended" || type === "session.step.failed") {
      const turn = this.ensureTurn(stringValue(event.id));
      if (turn) addUsage(turn, data.tokens);
      return undefined;
    }
    if (
      type === "session.execution.succeeded" ||
      type === "session.execution.failed" ||
      type === "session.execution.interrupted" ||
      type === "session.idle"
    ) {
      return this.finishTurn(type, data);
    }
    return undefined;
  }

  private ensureTurn(fallbackID?: string): TurnState | undefined {
    if (this.state.activeTurn) return this.state.activeTurn;
    const id = this.state.pendingTurnID ?? fallbackID;
    if (!id) return undefined;
    this.state.activeTurn = createTurn(id);
    if (this.state.pendingTurnID === id) this.state.pendingTurnID = undefined;
    return this.state.activeTurn;
  }

  private finishTurn(type: string, data: Record<string, unknown>): TracePayload | undefined {
    const turn = this.state.activeTurn ?? this.ensureTurn();
    if (!turn) return undefined;
    const outcome =
      type === "session.execution.succeeded"
        ? "succeeded"
        : type === "session.execution.failed"
          ? "failed"
          : type === "session.execution.interrupted"
            ? "interrupted"
            : "idle";
    const payload = basePayload(this.state, "Stop", turn.id);
    payload.execution_outcome = outcome;
    if (turn.lastAssistantMessage) payload.last_assistant_message = turn.lastAssistantMessage;
    if (turn.hasUsage) {
      payload.usage_source = "opencode_step";
      payload.usage = {
        input_tokens: turn.usage.input,
        cached_input_tokens: turn.usage.cacheRead,
        output_tokens: turn.usage.output,
        reasoning_tokens: turn.usage.reasoning,
        total_tokens: turn.usage.input + turn.usage.output,
        cache_write_tokens: turn.usage.cacheWrite,
      };
    }
    const error = asRecord(data.error);
    const errorMessage = stringValue(error?.message);
    if (errorMessage) payload.execution_error = errorMessage;

    this.state.activeTurn = undefined;
    return payload;
  }
}

function ingestUrl(apiUrl: string): string | undefined {
  try {
    const url = new URL(apiUrl);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path.endsWith("/ingest") ? path : path + "/ingest";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function sendTraceEvent(
  config: IngestConfig,
  payload: TracePayload,
  outerSignal?: AbortSignal,
): Promise<boolean> {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return false;
  }
  if (Buffer.byteLength(body, "utf8") > MAX_EVENT_BYTES) return false;
  const url = ingestUrl(config.apiUrl);
  if (!url) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, MAX_TIMEOUT_MS));
  const abort = () => controller.abort();
  if (outerSignal?.aborted) controller.abort();
  else outerSignal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nala-Labs-API-Key": config.apiToken,
      },
      body,
      signal: controller.signal,
    });
    try {
      await response.body?.cancel();
    } catch {
      // Response bodies are not part of the ingest contract.
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener("abort", abort);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function sessionInfoWithTimeout(context: PluginContext, sessionID: string): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      context.session.get({ sessionID }).catch(() => undefined),
      new Promise<undefined>((resolvePromise) => {
        timeout = setTimeout(() => resolvePromise(undefined), SESSION_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class CapturePipeline {
  private readonly queue: CaptureTask[] = [];
  private readonly sessions = new Map<string, SessionAccumulator>();
  private readonly projectRoots: string[];
  private readonly clientVersion: string;
  private readonly config: IngestConfig;
  private readonly context: PluginContext;
  private accepting = true;
  private closed = false;
  private processing = false;
  private processingPromise?: Promise<void>;
  private activeController?: AbortController;

  constructor(context: PluginContext, config: IngestConfig) {
    this.context = context;
    this.config = config;
    this.projectRoots = [
      context.location.project.directory,
      context.location.project.canonical,
    ];
    this.clientVersion = context.app.version;
  }

  capture(task: CaptureTask): void {
    if (!this.accepting || this.closed) return;
    if (this.queue.length + (this.processing ? 1 : 0) >= MAX_QUEUE_SIZE) return;
    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    if (this.processingPromise || this.closed) return;
    this.processing = true;
    this.processingPromise = this.run().finally(() => {
      this.processing = false;
      this.processingPromise = undefined;
      if (this.queue.length && !this.closed) this.drain();
    });
  }

  private async run(): Promise<void> {
    while (this.queue.length && !this.closed) {
      const task = this.queue.shift();
      if (!task) continue;
      try {
        await this.processTask(task);
      } catch {
        // Capture failures are intentionally isolated from the OpenCode session.
      }
    }
  }

  private getSession(sessionID: string): SessionAccumulator | undefined {
    let session = this.sessions.get(sessionID);
    if (session) {
      this.sessions.delete(sessionID);
      this.sessions.set(sessionID, session);
      return session;
    }
    if (this.sessions.size >= MAX_TRACKED_SESSIONS) return undefined;
    session = new SessionAccumulator(sessionID, this.clientVersion);
    this.sessions.set(sessionID, session);
    return session;
  }

  private async resolveScope(session: SessionAccumulator, eventDirectory?: string): Promise<boolean> {
    const state = session.state;
    if (state.scopeResolved) {
      if (state.accepted) return !eventDirectory || isWithinProject(this.projectRoots, eventDirectory);
      if (eventDirectory && isWithinProject(this.projectRoots, eventDirectory)) {
        state.accepted = true;
      }
      return state.accepted === true;
    }
    if (state.scopePromise) return state.scopePromise;

    state.scopePromise = (async () => {
      if (eventDirectory && !isWithinProject(this.projectRoots, eventDirectory)) {
        state.accepted = false;
        state.scopeResolved = true;
        return false;
      }
      const info = await sessionInfoWithTimeout(this.context, state.sessionID);
      session.updateFromSessionInfo(info);
      const infoRecord = asRecord(info);
      const location = asRecord(infoRecord?.location);
      const infoDirectory = stringValue(location?.directory);
      if (infoDirectory && !isWithinProject(this.projectRoots, infoDirectory)) {
        state.accepted = false;
      } else {
        state.accepted =
          isWithinProject(this.projectRoots, eventDirectory) ||
          isWithinProject(this.projectRoots, infoDirectory);
      }
      state.scopeResolved = true;
      return state.accepted === true;
    })();
    return state.scopePromise;
  }

  private async processTask(task: CaptureTask): Promise<void> {
    const session = this.getSession(task.sessionID);
    if (!session) return;
    if (!(await this.resolveScope(session, task.locationDirectory))) return;
    if (task.locationDirectory && !isWithinProject(this.projectRoots, task.locationDirectory)) return;

    const state = session.state;
    if (task.activity && !state.started) {
      state.started = true;
      await this.deliver(session.sessionStart());
    }
    const result = task.apply(state);
    if (!result) return;
    const events = Array.isArray(result) ? result : [result];
    for (const event of events) await this.deliver(event);
  }

  private async deliver(payload: TracePayload): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    try {
      await sendTraceEvent(this.config, payload, controller.signal);
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  async close(): Promise<void> {
    this.accepting = false;
    const deadline = Date.now() + MAX_TIMEOUT_MS;
    while (this.processingPromise) {
      const current = this.processingPromise;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const completed = await Promise.race([current.then(() => true), delay(remaining).then(() => false)]);
      if (!completed) break;
    }
    const current = this.processingPromise;
    if (current) {
      this.closed = true;
      this.queue.length = 0;
      this.activeController?.abort();
      await Promise.race([current, delay(100)]);
      return;
    }
    this.closed = true;
    this.queue.length = 0;
  }
}

function eventRecord(value: unknown): {
  sessionID: string;
  locationDirectory?: string;
  type: string;
  event: Record<string, unknown>;
} | undefined {
  const event = asRecord(value);
  const data = asRecord(event?.data);
  const sessionID = stringValue(data?.sessionID);
  const type = stringValue(event?.type);
  if (!event || !sessionID || !type) return undefined;
  const location = asRecord(event.location);
  return {
    sessionID,
    locationDirectory: stringValue(location?.directory),
    type,
    event,
  };
}

const ACTIVITY_EVENTS = new Set([
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.ended",
  "session.idle",
]);

const METADATA_EVENTS = new Set([
  "session.agent.selected",
  "session.model.selected",
  "session.renamed",
]);

function startEventSubscription(context: PluginContext, pipeline: CapturePipeline): AbortController {
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const value of context.event.subscribe({ signal: controller.signal })) {
        const parsed = eventRecord(value);
        if (!parsed || (!ACTIVITY_EVENTS.has(parsed.type) && !METADATA_EVENTS.has(parsed.type))) continue;
        pipeline.capture({
          sessionID: parsed.sessionID,
          locationDirectory: parsed.locationDirectory,
          activity: ACTIVITY_EVENTS.has(parsed.type),
          apply: (state) => new SessionAccumulator(state).openCodeEvent(parsed.event),
        });
      }
    } catch {
      // An unavailable event stream does not affect the active session.
    }
  })();
  return controller;
}

async function setup(context: PluginContext): Promise<(() => Promise<void>) | undefined> {
  const projectDirectory = context.location.project.directory;
  const config = await loadConfig({ projectDirectory });
  if (!config) return undefined;

  const pipeline = new CapturePipeline(context, config);
  const subscription = startEventSubscription(context, pipeline);
  const registrations: Array<{ dispose: () => Promise<void> }> = [];

  // Hook registration failures leave the other capture paths available.
  try {
    registrations.push(
      await context.session.hook("prompt", (event) => {
        const sessionID = stringValue(event.sessionID);
        if (!sessionID) return;
        pipeline.capture({
          sessionID,
          activity: true,
          apply: (state) => new SessionAccumulator(state).prompt(event),
        });
      }),
    );
  } catch {
  }

  try {
    registrations.push(
      await context.tool.hook("execute.before", (event) => {
        const sessionID = stringValue(event.sessionID);
        if (!sessionID) return;
        pipeline.capture({
          sessionID,
          activity: true,
          apply: (state) => new SessionAccumulator(state).toolBefore(event),
        });
      }),
    );
  } catch {
  }

  try {
    registrations.push(
      await context.tool.hook("execute.after", (event) => {
        const sessionID = stringValue(event.sessionID);
        if (!sessionID) return;
        pipeline.capture({
          sessionID,
          activity: true,
          apply: (state) => new SessionAccumulator(state).toolAfter(event),
        });
      }),
    );
  } catch {
  }

  return async () => {
    subscription.abort();
    // A disposal failure must not keep later hooks or the delivery queue open.
    for (const registration of registrations) {
      try {
        await registration.dispose();
      } catch {
      }
    }
    await pipeline.close();
  };
}

export default Plugin.define({
  id: "nala-trace-opencode",
  setup,
});
