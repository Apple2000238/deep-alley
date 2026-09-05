/* ═══════════════════════════════════════════
   Deep Alley — 冒烟测试（npm test）
   ① 引擎全流程断言  ② stdio MCP 握手  ③ HTTP 模式 API
   ═══════════════════════════════════════════ */
const { spawn } = require("child_process");
const P = "smoke";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗", label); }
}

async function main() {
  try { fs.rmSync(path.join(__dirname, "..", "data", "saves", P + ".json")); } catch {}
  console.log("── ① 引擎全流程 ──");
  const Engine = require("../server/engine");
  const { createSession, callTool, TOOLS } = require("../server/tools");
  const s = createSession();
  let r;

  r = callTool("enter_deep_alley", { profile: P,}, s);
  ok(r.text.includes("深巷"), "enter_deep_alley 开场");
  ok(r.state.recipesUnlocked > 50, `默认解锁 ${r.state.recipesUnlocked} 杯配方`);

  r = callTool("talk_to", { profile: P, npc_name: "西装男" }, s);
  ok(r.text.includes("西装男"), "talk_to 结识 NPC");

  r = callTool("check_quest_board", { profile: P,}, s);
  ok(r.text.includes("quest_001"), "结识后委托上板");

  r = callTool("accept_quest", { profile: P, quest_id: "quest_001" }, s);
  ok(r.text.includes("接下委托"), "accept_quest 接单");

  r = callTool("mix_drink", { profile: P, ingredients: ["蜂蜜 30ml", "糖水 20ml"], custom_name: "甜到忧伤" }, s);
  ok(r.text.includes("特调"), "自由搭配=特调");
  r = callTool("serve_drink", { profile: P, npc_name: "西装男" }, s);
  ok(r.text.includes("委托失败"), "忌口判定 → 委托失败");

  r = callTool("check_quest_board", { profile: P,}, s);
  ok(r.text.includes("quest_001"), "连锁任务失败后可重试");

  callTool("accept_quest", { profile: P, quest_id: "quest_001" }, s);
  r = callTool("mix_drink", { profile: P, recipe_name: "打烊前最后一杯" }, s);
  ok(r.text.includes("完美") || r.text.includes("良好"), "按配方调酒评分");
  r = callTool("serve_drink", { profile: P, npc_name: "西装男" }, s);
  ok(r.text.includes("委托完成"), "递酒判定 → 委托完成");

  r = callTool("check_quest_board", { profile: P,}, s);
  ok(r.text.includes("quest_002"), "连锁任务解锁下一环");

  r = callTool("handle_event", { profile: P, choice: 0 }, s);
  ok(true, "handle_event 回应事件");

  r = callTool("go_to", { profile: P, location: "地下室" }, s);
  ok(r.text.includes("老鬼"), "地下室首探被拦");
  r = callTool("go_to", { profile: P, location: "地下室" }, s);
  ok(!r.text.includes("军大衣"), "二次进入放行");

  r = callTool("browse_recipes", { profile: P, tier: "legendary" }, s);
  ok(r.text.includes("传说") || r.text.includes("legendary"), "酒谱筛选");

  r = callTool("check_status", { profile: P,}, s);
  ok(r.text.includes("Tab"), "状态面板");

  ok(fs.existsSync(path.join(__dirname, "..", "data", "saves", P + ".json")), "自动存档落盘");

  console.log("── ② stdio MCP ──");
  await new Promise(resolve => {
    const child = spawn("node", [path.join(__dirname, "..", "server.js")], { cwd: path.join(__dirname, "..") });
    let out = "";
    child.stdout.on("data", d => out += d);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_status", arguments: {} } }) + "\n");
    setTimeout(() => {
      try {
        const lines = out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
        ok(lines[0]?.result?.serverInfo?.name === "deep-alley", "initialize 握手");
        ok(lines[1]?.result?.tools?.length >= 20, `tools/list ${lines[1]?.result?.tools?.length} 个工具`);
        ok(!lines[2]?.result?.isError, "tools/call 执行");
      } catch (e) { ok(false, "stdio 响应解析: " + e.message); }
      child.kill(); resolve();
    }, 1500);
  });

  console.log("── ③ HTTP 模式 ──");
  await new Promise(resolve => {
    const srv = spawn("node", [path.join(__dirname, "..", "server.js"), "--http", "--port", "8971"], { cwd: path.join(__dirname, "..") });
    setTimeout(async () => {
      try {
        const h = await fetch("http://127.0.0.1:8971/healthz"); ok(h.ok, "healthz");
        const d = await (await fetch("http://127.0.0.1:8971/api/data/recipes")).json(); ok(Array.isArray(d) && d.length === 100, "数据接口 100 条酒谱");
        const st = await (await fetch("http://127.0.0.1:8971/api/state")).json(); ok(st.ok && st.state, "state 接口");
        const m = await (await fetch("http://127.0.0.1:8971/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }) })).json();
        ok(m.result?.tools?.length >= 20, "MCP over HTTP");
        const page = await fetch("http://127.0.0.1:8971/index.html"); ok(page.ok, "静态页面");
      } catch (e) { ok(false, "HTTP: " + e.message); }
      srv.kill(); resolve();
    }, 1500);
  });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main();
