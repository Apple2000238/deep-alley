/* ═══════════════════════════════════════════
   Deep Alley — 冒烟测试（npm test）
   ① 路由与全流程  ② 事件去重  ③ 旧名兼容
   ④ v2：情绪/时段/分层/自创酒/碎片关联/缺席/将明
   ⑤ stdio  ⑥ HTTP
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
  ok(r.text.includes("深巷") && r.text.includes("入夜"), "session.enter 开场（含时段名）");

  const st = s.get(P);
  // 拨到深夜，让西装男（dusk 没来）登场
  st.clock = 23 * 60 + 5; st.lastPhase = "dusk";
  r = call("alley_move", { action: "look" });
  ok(r.text.includes("深夜"), "move.look 时段已切换为深夜");

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
  ok(fs.existsSync(path.join(__dirname, "..", "data", "saves", P + ".json")), "存档落盘");

  r = call("alley_bar", { action: "dance" });
  ok(r.isError && r.text.includes("mix / serve / drink"), "非法 action 得到可选值提示");

  console.log("── ② 事件系统：去重与单次判定 ──");
  st.pendingEvent = "event_008";
  r = call("alley_interact", { action: "event", choice: 0 });
  ok(r.text.includes("吵架的情侣"), "事件正常处理");
  ok(st.pendingEvent === null, "处理后 pending 清除");
  ok(!r.text.includes("正有事件等待回应"), "处理后状态不再提示等待事件");
  st.flags.doneEventsToday = Engine.DATA.events.map(e => e.id);
  st.pendingEvent = null;
  ok(Engine._internal.rollEvent(st) === null, "同夜去重：事件池耗尽后不再掷出");

  console.log("── ③ 旧版单工具名兼容 ──");
  r = callTool("mix_drink", { profile: P, recipe_name: "琥珀落日" }, s);
  ok(r.text.includes("琥珀落日"), "旧名 mix_drink 仍可用");
  r = callTool("check_status", { profile: P }, s);
  ok(r.text.includes("Tab"), "旧名 check_status 仍可用");

  console.log("── ④ v2 特性：情绪/时段/分层/自创酒/碎片/缺席/将明 ──");

  // 4.1 对话分层：好感9+ 只出 trust 层
  st.relationships["煤球"].affinity = 9;
  const lines = [];
  for (let i = 0; i < 8; i++) {
    st.relationships["煤球"].affinity = 9;
    lines.push(call("alley_interact", { action: "talk", npc_name: "煤球" }).text);
  }
  ok(lines.every(t => !t.includes("（警惕）") && !t.includes("（客套）")), "对话分层：trust 好感不再出现 stranger 台词");

  // 4.2 情绪偏好：琥珀落日（nostalgia 0.7）→ 西装男（threshold 0.5）
  st.clock = 25 * 60 + 10; st.lastPhase = "late";
  call("alley_bar", { action: "mix", recipe_name: "琥珀落日" });
  r = call("alley_bar", { action: "serve", npc_name: "西装男" });
  const prefHit = r.text.includes("她也喜欢这种的") || r.text.includes("在想什么");
  if (!prefHit) console.log("    [debug serve full]\n" + r.text + "\n    isError:", r.isError);
  ok(prefHit, "情绪偏好命中 → NPC 特殊台词");

  // 4.3 自创酒全流程：注册 → 三人喝过 → 巷子口碑
  r = call("alley_bar", { action: "mix", ingredients: ["辣椒油 5ml", "菠萝汁 60ml", "海盐焦糖 15ml", "打抛叶 3片"], custom_name: "辣菠萝坟场" });
  ok(r.text.includes("私房酒单"), "特调命名 → 私房酒单");
  for (const npc of ["老周", "酒瓶张", "王婶"]) {
    call("alley_bar", { action: "mix", ingredients: ["辣椒油 5ml", "菠萝汁 60ml", "海盐焦糖 15ml", "打抛叶 3片"], custom_name: "辣菠萝坟场" });
    call("alley_bar", { action: "serve", npc_name: npc });
    st.clock = Math.min(st.clock + 20, 27 * 60 - 5);
  }
  const custom = (st.customRecipes || []).find(x => x.name === "辣菠萝坟场");
  ok(custom && custom.servedTo.length >= 3 && custom.famous, "自创酒被3人喝过 → 巷子口碑");
  r = call("alley_info", { action: "status" });
  ok(r.text.includes("私房酒单") && r.text.includes("辣菠萝坟场"), "status 显示私房酒单");

  // 4.4 记忆碎片关联
  st.memories.push("第一杯为别人调的苦", "甜的练习");
  Engine._internal.checkMemoryLinks(st);
  ok(st.memories.includes("有个人在等你记起来"), "碎片关联 → 暗线碎片浮出");

  // 4.5 嘴碎泄漏：在煤球面前说漏西装男的秘密（聊天本身带 +1 好感，净变化 ≥ -2 即视为泄密生效）
  st.location = "酒吧"; // 回到酒吧（煤球在场）
  st.flags["secret_西装男"] = true;
  const affBefore = st.relationships["西装男"].affinity;
  r = call("alley_interact", { action: "talk", npc_name: "煤球", say: "我跟你说，西装男的袖口内侧绣着一个名字，字母已经被摩挲得快看不清了。" });
  const leaked = st.gossipLeaks?.length >= 1 && r.text.includes("说漏嘴") && st.relationships["西装男"].affinity <= affBefore - 1;
  if (!leaked) console.log("    [debug] leaks:", JSON.stringify(st.gossipLeaks), "aff:", affBefore, "->", st.relationships["西装男"].affinity, "\n    [talk text]\n" + r.text);
  ok(leaked, "嘴碎泄密 → 泄漏记录 + 被泄密者掉好感");

  // 4.6 缺席后果：模拟 4 天没来
  st.updatedAt = Date.now() - 4 * 86400000;
  const dayBefore = st.day;
  r = call("alley_session", { action: "enter" });
  ok(st.day >= dayBefore + 4, "缺席 4 天 → 游戏内日期跳进");
  ok(r.text.includes("天没来了") || r.text.includes("煤球瘦"), "缺席后果叙事出现");

  // 4.7 将明独处
  st.clock = 27 * 60 + 5; st.lastPhase = "late";
  r = call("alley_interact", { action: "talk", npc_name: "自己" });
  ok(r.text.includes("回想今晚的事"), "将明独处：回忆今晚");

  console.log("── ⑤ stdio MCP ──");
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

  console.log("── ⑥ HTTP 模式 ──");
  await new Promise(resolve => {
    const srv = spawn("node", [path.join(__dirname, "..", "server.js"), "--http", "--port", "8971"], { cwd: path.join(__dirname, "..") });
    setTimeout(async () => {
      try {
        const h = await fetch("http://127.0.0.1:8971/healthz"); ok(h.ok, "healthz");
        const d = await (await fetch("http://127.0.0.1:8971/api/data/recipes")).json();
        ok(Array.isArray(d) && d.length === 100 && d[0].emotion, "数据接口 100 条酒谱（含 emotion）");
        const st2 = await (await fetch("http://127.0.0.1:8971/api/state")).json(); ok(st2.ok && st2.state, "state 接口");
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
