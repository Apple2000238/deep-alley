/* ═══════════════════════════════════════════
   Deep Alley — MCP 协议层（JSON-RPC 2.0）
   传输无关：stdio（按行 JSON）与 Streamable HTTP 复用 handleMessage。
   支持 initialize / ping / tools/list / tools/call。
   ═══════════════════════════════════════════ */
const { TOOLS, callTool, toText } = require("./tools");

const SERVER_INFO = { name: "deep-alley", title: "深巷 Deep Alley — MCP 调酒游戏", version: "1.0.0" };

function handleMessage(msg, session, requestedProfile) {
  if (!msg || typeof msg !== "object") {
    return err(null, -32600, "Invalid Request");
  }
  const { id, method, params } = msg;

  // 通知：无需回复
  if (id === undefined || id === null) {
    if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
    return null;
  }

  try {
    switch (method) {
      case "initialize": {
        return ok(id, {
          protocolVersion: (params && params.protocolVersion) || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "深巷（Deep Alley）是一款通过 MCP 游玩的文字调酒/经营/叙事游戏。你是深巷酒吧的调酒师。" +
            "先调用 enter_deep_alley 开场，之后按返回文本中「▸ 接下来你可以」的提示行动即可。" +
            "出现 ⚡ 事件时优先用 handle_event 回应。" +
            "核心循环：look_around → talk_to（混好感/解锁委托）→ mix_drink → serve_drink（判定委托/收钱）→ check_quest_board 接单。",
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        if (!params || typeof params.name !== "string") {
          return err(id, -32602, "params.name required");
        }
        const args = params.arguments || {};
        const profile = args.profile || requestedProfile;
        const r = callTool(params.name, { ...args, profile }, session);
        const content = [{ type: "text", text: toText(r) }];
        return ok(id, {
          content,
          structuredContent: { hints: r.hints || [], event: r.event || null, state: r.state || null },
          isError: !!r.isError,
        });
      }
      case "resources/list":
        return ok(id, { resources: [] });
      case "prompts/list":
        return ok(id, { prompts: [] });
      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(id, -32603, `Internal error: ${e.message}`);
  }
}

function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function err(id, code, message) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }

/* ── stdio 传输 ── */
function runStdio(session, profile) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch {
        sendToStdout(err(null, -32700, "Parse error"));
        continue;
      }
      const resp = handleMessage(msg, session, profile);
      if (resp) sendToStdout(resp);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  // 永远不要往 stdout 打日志
  const warn = (...a) => process.stderr.write("[deep-alley] " + a.join(" ") + "\n");
  warn("stdio server ready. profile =", profile);
}
function sendToStdout(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

module.exports = { handleMessage, runStdio, SERVER_INFO };
