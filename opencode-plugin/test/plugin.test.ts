import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isWithinProject, loadConfig, sendTraceEvent, SessionAccumulator } from "../src/index.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nala-trace-azh540-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("OpenCode plugin configuration", () => {
  it("uses user, project, custom-file, and environment values in precedence order", async () => {
    const root = await temporaryDirectory();
    const project = join(root, "project");
    const userConfig = join(root, "user-config");
    await mkdir(join(project, ".opencode"), { recursive: true });
    await mkdir(userConfig, { recursive: true });
    await writeFile(
      join(userConfig, "nala-trace.env"),
      "OPENCODE_TRACE_API_URL=http://user.example\nOPENCODE_TRACE_API_TOKEN=user-token\n",
    );
    await writeFile(
      join(project, ".opencode", "nala-trace.env"),
      "OPENCODE_TRACE_API_URL=http://project.example\nOPENCODE_TRACE_API_TOKEN=project-token\n",
    );
    await writeFile(
      join(project, "custom.env"),
      "OPENCODE_TRACE_API_URL=http://custom.example/root\nOPENCODE_TRACE_API_TOKEN=file-token\n",
    );

    const config = await loadConfig({
      projectDirectory: project,
      homeDirectory: root,
      env: {
        OPENCODE_CONFIG_DIR: userConfig,
        OPENCODE_TRACE_CONFIG_FILE: "custom.env",
        OPENCODE_TRACE_API_TOKEN: "environment-token",
        OPENCODE_TRACE_API_TIMEOUT: "5000",
      },
    });

    expect(config).toEqual({
      apiUrl: "http://custom.example/root",
      apiToken: "environment-token",
      timeoutMs: 2000,
    });
  });

  it("requires a valid HTTP endpoint and token", async () => {
    const root = await temporaryDirectory();
    const project = join(root, "project");
    await mkdir(join(project, ".opencode"), { recursive: true });
    await writeFile(
      join(project, ".opencode", "nala-trace.env"),
      "OPENCODE_TRACE_API_URL=file:///tmp/ingest\nOPENCODE_TRACE_API_TOKEN=local-token\n",
    );

    await expect(loadConfig({ projectDirectory: project, homeDirectory: root, env: {} })).resolves.toBeUndefined();
  });
});
describe("project location filter", () => {
  it("accepts the project and descendants but rejects a sibling path", () => {
    const root = join(tmpdir(), "nala-trace-project");
    expect(isWithinProject([root], root)).toBe(true);
    expect(isWithinProject([root], join(root, "nested"))).toBe(true);
    expect(isWithinProject([root], root + "-other")).toBe(false);
    expect(isWithinProject([root], undefined)).toBe(false);
    if (process.platform === "win32") {
      expect(isWithinProject([root], root.toUpperCase())).toBe(true);
    }
  });
});

describe("canonical event mapping", () => {
  it("keeps prompt and camelCase tool input while aggregating only per-step usage", () => {
    const session = new SessionAccumulator("ses_fixture", "2.0.27");
    session.updateFromSessionInfo({
      title: "Fixture session",
      agent: "build",
      model: { providerID: "opencode", id: "deepseek-v4.1-flash-free" },
    });

    const start = session.sessionStart();
    const prompt = session.prompt({
      sessionID: "ses_fixture",
      messageID: "msg_fixture",
      delivery: "steer",
      prompt: { text: "Read the marker", files: [], skills: ["inspect"] },
    });
    const toolInput = { filePath: "probe-marker.txt", includeLineNumbers: true };
    const before = session.toolBefore({
      sessionID: "ses_fixture",
      messageID: "msg_fixture",
      agent: "build",
      id: "call_fixture",
      tool: "read",
      input: toolInput,
    });
    const after = session.toolAfter({
      sessionID: "ses_fixture",
      messageID: "msg_fixture",
      agent: "build",
      id: "call_fixture",
      tool: "read",
      input: toolInput,
      status: "completed",
      result: { content: "nala-trace marker" },
    });

    expect(start.hook_event_name).toBe("SessionStart");
    expect(start.session_title).toBe("Fixture session");
    expect(start.runtime_metadata).toEqual({
      client: "opencode",
      client_version: "2.0.27",
      model: "deepseek-v4.1-flash-free",
      provider: "opencode",
      agent: "build",
    });
    expect(prompt?.hook_event_name).toBe("UserPromptSubmit");
    expect(prompt?.prompt).toEqual({ text: "Read the marker", files: [], skills: ["inspect"] });
    expect(before?.hook_event_name).toBe("PreToolUse");
    expect(before?.tool_input).toEqual(toolInput);
    expect(after?.hook_event_name).toBe("PostToolUse");
    expect(after?.tool_response).toEqual({ content: "nala-trace marker" });

    session.openCodeEvent({
      id: "execution_fixture",
      type: "session.execution.started",
      data: { sessionID: "ses_fixture" },
    });
    session.openCodeEvent({
      id: "text_fixture",
      type: "session.text.ended",
      data: { sessionID: "ses_fixture", assistantMessageID: "assistant_fixture", ordinal: 0, text: "nala-trace-ok" },
    });
    session.openCodeEvent({
      id: "step_one",
      type: "session.step.ended",
      data: {
        sessionID: "ses_fixture",
        tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 2, write: 1 } },
      },
    });
    session.openCodeEvent({
      id: "step_two",
      type: "session.step.ended",
      data: {
        sessionID: "ses_fixture",
        tokens: { input: 8, output: 4, reasoning: 1, cache: { read: 0, write: 0 } },
      },
    });
    const stop = session.openCodeEvent({
      id: "execution_done",
      type: "session.execution.succeeded",
      data: { sessionID: "ses_fixture" },
    });

    expect(stop?.hook_event_name).toBe("Stop");
    expect(stop?.turn_id).toBe("msg_fixture");
    expect(stop?.last_assistant_message).toBe("nala-trace-ok");
    expect(stop?.usage_source).toBe("opencode_step");
    expect(stop?.usage).toEqual({
      input_tokens: 18,
      cached_input_tokens: 2,
      output_tokens: 9,
      reasoning_tokens: 4,
      total_tokens: 27,
      cache_write_tokens: 1,
    });
    expect(session.openCodeEvent({
      id: "idle_after_stop",
      type: "session.idle",
      data: { sessionID: "ses_fixture" },
    })).toBeUndefined();
  });
});

describe("ingest delivery", () => {
  it("sends one authenticated JSON request and accepts a 202 response", async () => {
    let requestMethod: string | undefined;
    let requestPath: string | undefined;
    let requestToken: string | undefined;
    let requestPayload: unknown;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestMethod = request.method;
        requestPath = request.url;
        const tokenHeader = request.headers["x-nala-labs-api-key"];
        requestToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
        requestPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(202, { "content-type": "application/json" });
        response.end('{"accepted":true}');
      });
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", () => resolvePromise());
    });

    try {
      const address = server.address() as AddressInfo;
      const payload = { session_id: "ses_fixture", hook_event_name: "SessionStart" };
      await expect(
        sendTraceEvent(
          { apiUrl: "http://127.0.0.1:" + address.port, apiToken: "test-token", timeoutMs: 500 },
          payload,
        ),
      ).resolves.toBe(true);
      expect(requestMethod).toBe("POST");
      expect(requestPath).toBe("/ingest");
      expect(requestToken).toBe("test-token");
      expect(requestPayload).toEqual(payload);
    } finally {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
    }
  });
});
