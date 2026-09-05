#!/usr/bin/env node
/* ═══════════════════════════════════════════
   Deep Alley — 服务入口
   默认：stdio MCP（Claude Desktop / Cursor / Cherry Studio 直接配置）
   --http --port 8899：HTTP 模式 = Streamable HTTP MCP(/mcp) + 网页静态服务 + REST API
   同一进程内，网页与 MCP 共享同一份存档（"同一个世界"）。
   ═══════════════════════════════════════════ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const args = process.argv.slice(2);
const hasHttp = args.includes("--http");
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) || 8899 : 8899;
const profileIdx = args.indexOf("--profile");
const PROFILE = profileIdx >= 0 ? args[profileIdx + 1] : (process.env.DEEP_ALLEY_PROFILE || "default");

const Engine = require("./server/engine");
const { callTool, toText } = require("./server/tools");
const { handleMessage, runStdio } = require("./server/mcp");
const session = require("./server/tools").createSession();

const ROOT = __dirname; // server.js 位于项目根目录
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (!hasHttp) {
  runStdio(session, PROFILE);
} else {
  const state = session.get(PROFILE); // 预热：网页与 MCP 共享这份状态
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const p = decodeURIComponent(parsed.pathname);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Authorization",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

    /* ── MCP over Streamable HTTP ── */
    if (p === "/mcp") {
      if (req.method === "GET") { res.writeHead(405, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "SSE not supported; use POST" })); return; }
      if (req.method !== "POST") { res.writeHead(405, cors); res.end(); return; }
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        let msg;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
          return;
        }
        const sid = req.headers["mcp-session-id"];
        const resp = handleMessage(msg, session, sid ? `default` : PROFILE);
        if (!resp) { res.writeHead(202, cors); res.end(); return; } // 通知
        res.writeHead(200, {
          ...cors,
          "Content-Type": "application/json; charset=utf-8",
          "Mcp-Session-Id": sid || "deep-alley-" + PROFILE,
        });
        res.end(JSON.stringify(resp));
      });
      return;
    }

    /* ── REST API（网页"同一个世界"模式） ── */
    if (p === "/api/state") {
      const st = session.get(PROFILE);
      json(res, 200, { ok: true, world: true, profile: PROFILE, state: Engine.publicState(st) });
      return;
    }
    if (p === "/api/action" && req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        let a;
        try { a = JSON.parse(body); } catch { json(res, 400, { ok: false, error: "bad json" }); return; }
        const st = session.get(PROFILE);
        const allow = {
          look: () => Engine.look(st),
          go: () => Engine.go_to(st, a.location),
          talk: () => Engine.talk_to(st, a.npc, a.say),
          mix: () => Engine.mix_drink(st, { recipe_name: a.recipe, ingredients: a.ingredients, custom_name: a.name }),
          serve: () => Engine.serve_drink(st, a.npc),
          drink_self: () => Engine.drink_self(st),
          explore: () => Engine.explore(st),
          rest: () => Engine.rest(st),
          event: () => Engine.handle_event(st, a.choice !== undefined ? Number(a.choice) : undefined),
          board: () => Engine.check_quest_board(st),
          accept: () => Engine.accept_quest(st, a.quest_id),
          abandon: () => Engine.abandon_quest(st, a.quest_id),
          buy: () => Engine.buy_from(st, a.npc, a.item),
          recipes: () => Engine.browse_recipes(st, a),
          npcs: () => Engine.browse_npcs(st, a),
        };
        const fn = allow[a.action];
        if (!fn) { json(res, 400, { ok: false, error: "unknown action" }); return; }
        try {
          const r = fn();
          json(res, 200, { ok: true, text: r.text, hints: r.hints, event: r.event, state: r.state });
        } catch (e) {
          json(res, 500, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (p.startsWith("/api/data/")) {
      const name = p.split("/").pop().replace(".json", "");
      const file = path.join(ROOT, "data", name + ".json");
      if (["recipes", "npcs", "quests", "events"].includes(name) && fs.existsSync(file)) {
        res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
        fs.createReadStream(file).pipe(res);
      } else { json(res, 404, { ok: false, error: "no such data" }); }
      return;
    }
    if (p === "/healthz") { json(res, 200, { ok: true, up: true }); return; }

    /* ── 静态文件 ── */
    let file = p === "/" ? "/index.html" : p;
    file = file.split("?")[0];
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 — 巷子里没有这个地方");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(full).pipe(res);
  });

  function json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...{ "Access-Control-Allow-Origin": "*" } });
    res.end(JSON.stringify(obj));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🏮 Deep Alley HTTP 模式已启动`);
    console.log(`   网页:   http://0.0.0.0:${PORT}/`);
    console.log(`   MCP:    http://0.0.0.0:${PORT}/mcp  (Streamable HTTP)`);
    console.log(`   存档:   profile="${PROFILE}"（网页与 AI 共享同一份）`);
  });
}
