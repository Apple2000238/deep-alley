/* ═══════════════════════════════════════════
   Deep Alley — 冒烟测试（npm test）
   ① 6 工具 action 路由 + 旧名兼容 + 事件去重  ② stdio MCP 握手  ③ HTTP 模式
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
  console.log("── ① 工具路由与引擎全流程 ──");
  const Engine = require("../server/engine");
  const { createSession, callTool, TOOLS, LEGACY } = require("../server/tools");
  const s = createSession();
  const call = (tool, args = {}) => callTool(tool, { profile: P, ...args }, s);

  ok(TOOLS.length === 6, `tools/list 6 个动作域工具（实际 ${TOOLS.length}）`);
  ok(Object.keys(LEGACY).length === 21, `旧版 ${Object.keys(LEGACY).length} 个单工具名保持兼容`);

  let r = call("alley_session", { action: "enter", player_name: "冒烟测试员" });
  ok(r.text.includes("深巷"), "session.enter 开场");

  r = call("alley_move", { action: "look" });
  ok(r.text.includes("在场"), "move.look 环顾");

  r = call("alley_interact", { action: "talk", npc_name: "西装男" });
  ok(r.text.includes("西装男"), "interact.talk 结识 NPC");

  r = call("alley_quest", { action: "board" });
  ok(r.text.includes("quest_001"), "结识后委托上板");

  r = call("alley_quest", { action: "accept", quest_id: "quest_001" });
  ok(r.text.includes("接下委托"), "quest.accept 接单");

  r = call("alley_bar", { action: "mix", ingredients: ["蜂蜜 30ml", "糖水 20ml"], custom_name: "甜到忧伤" });
  ok(r.text.includes("特调"), "自由搭配=特调");
  r = call("alley_bar", { action: "serve", npc_name: "西装男" });
  ok(r.text.includes("委托失败"), "忌口判定 → 委托失败");

  r = call("alley_quest", { action: "board" });
  ok(r.text.includes("quest_001"), "连锁任务失败后可重试");

  call("alley_quest", { action: "accept", quest_id: "quest_001" });
  r = call("alley_bar", { action: "mix", recipe_name: "打烊前最后一杯" });
  ok(r.text.includes("完美") || r.text.includes("良好"), "按配方调酒评分");
  r = call("alley_bar", { action: "serve", npc_name: "西装男" });
  ok(r.text.includes("委托完成"), "递酒判定 → 委托完成");

  r = call("alley_quest", { action: "board" });
  ok(r.text.includes("quest_002"), "连锁任务解锁下一环");

  r = call("alley_move", { action: "go", location: "地下室" });
  ok(r.text.includes("老鬼"), "地下室首探被拦");
  r = call("alley_move", { action: "go", location: "地下室" });
  ok(!r.text.includes("军大衣"), "二次进入放行");

  r = call("alley_info", { action: "recipes", mood: "失恋" });
  ok(r.text.includes("酒谱图鉴"), "info.recipes 筛选");

  r = call("alley_info", { action: "status" });
  ok(r.text.includes("Tab"), "info.status 状态面板");

  r = call("alley_session", { action: "save" });
  ok(r.text.includes("存档"), "session.save 存档");
  ok(fs.existsSync(path.join(__dirname, "..", "data", "saves", P + ".json")), "存档落盘");

  // 非法 action 的路由提示
  r = call("alley_bar", { action: "dance" });
  ok(r.isError && r.text.includes("mix / serve / drink"), "非法 action 得到可选值提示");

  console.log("── ② 事件系统：去重与单次判定 ──");
  const st = s.get(P); // 引擎状态本体（session 包装之下）
  st.pendingEvent = "event_008"; // 吵架的情侣（choice 0 扣 60 Tab）
  r = call("alley_interact", { action: "event", choice: 0 });
  ok(r.text.includes("吵架的情侣"), "事件正常处理");
  ok(st.pendingEvent === null, "处理后 pending 清除");
  ok(!r.text.includes("正有事件等待回应"), "处理后状态不再提示等待事件");
  // 核心：同一夜里事件不会重复掷中（这是"事件循环卡死"的根因修复）
  st.flags.doneEventsToday = Engine.DATA.events.map(e => e.id);
  st.pendingEvent = null;
  const rolled = Engine._internal.rollEvent(st);
  ok(rolled === null, "同夜去重：事件池耗尽后不再掷出");
  st.flags.doneEventsToday = [];
  st.pendingEvent = null;
  const rolled2 = Engine._internal.rollEvent(st);
  ok(rolled2 === null || typeof rolled2.id === "string", "事件池次日重置后恢复正常掷取");

  console.log("── ③ 旧版单工具名兼容 ──");
  r = callTool("mix_drink", { profile: P, recipe_name: "琥珀落日" }, s);
  ok(r.text.includes("琥珀落日"), "旧名 mix_drink 仍可用");
  r = callTool("check_status", { profile: P }, s);
  ok(r.text.includes("Tab"), "旧名 check_status 仍可用");

  console.log("── ④ stdio MCP ──");
  await new Promise(resolve => {
    const child = spawn("node", [path.join(__dirname, "..", "server.js")], { cwd: path.join(__dirname, "..") });
    let out = "";
    child.stdout.on("data", d => out += d);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "alley_bar", arguments: { action: "mix", recipe_name: "琥珀落日" } } }) + "\n");
    setTimeout(() => {
      try {
        const lines = out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
        ok(lines[0]?.result?.serverInfo?.name === "deep-alley", "initialize 握手");
        ok(lines[1]?.result?.tools?.length === 6, "tools/list = 6");
        ok(!lines[2]?.result?.isError && lines[2]?.result?.content?.[0]?.text?.includes("琥珀落日"), "tools/call(action 路由) 执行");
      } catch (e) { ok(false, "stdio 响应解析: " + e.message); }
      child.kill(); resolve();
    }, 1500);
  });

  console.log("── ⑤ HTTP 模式 ──");
  await new Promise(resolve => {
    const srv = spawn("node", [path.join(__dirname, "..", "server.js"), "--http", "--port", "8971"], { cwd: path.join(__dirname, "..") });
    setTimeout(async () => {
      try {
        const h = await fetch("http://127.0.0.1:8971/healthz"); ok(h.ok, "healthz");
        const d = await (await fetch("http://127.0.0.1:8971/api/data/recipes")).json(); ok(Array.isArray(d) && d.length === 100, "数据接口 100 条酒谱");
        const st = await (await fetch("http://127.0.0.1:8971/api/state")).json(); ok(st.ok && st.state, "state 接口");
        const m = await (await fetch("http://127.0.0.1:8971/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }) })).json();
        ok(m.result?.tools?.length === 6, "MCP over HTTP tools/list = 6");
        const page = await fetch("http://127.0.0.1:8971/index.html"); ok(page.ok, "静态页面");
      } catch (e) { ok(false, "HTTP: " + e.message); }
      srv.kill(); resolve();
    }, 1500);
  });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main();
