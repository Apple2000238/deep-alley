/* ═══════════════════════════════════════════
   Deep Alley 深巷 — 游戏引擎
   纯逻辑层，无 I/O 依赖（除读写存档）。
   被 MCP（stdio/HTTP）与网页 REST 共用。
   ═══════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SAVE_DIR = path.join(DATA_DIR, "saves");

const DATA = {
  recipes: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "recipes.json"), "utf8")),
  npcs: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "npcs.json"), "utf8")),
  quests: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "quests.json"), "utf8")),
  events: JSON.parse(fs.readFileSync(path.join(DATA_DIR, "events.json"), "utf8")),
};
DATA.recipesById = Object.fromEntries(DATA.recipes.map(r => [r.id, r]));
DATA.npcsByName = Object.fromEntries(DATA.npcs.map(n => [n.name, n]));
DATA.questsById = Object.fromEntries(DATA.quests.map(q => [q.id, q]));

const LOCATIONS = ["酒吧", "宵夜档", "便利店", "天台", "后巷", "地下室", "巷口"];
const WEATHERS = ["晴", "微雨", "大雨", "雾", "大风", "月圆", "降温", "雨后", "连雨", "台风", "冰雹"];
const WEATHER_WEIGHTS = { "晴": 24, "微雨": 18, "月圆": 12, "雾": 10, "大雨": 8, "大风": 7, "降温": 7, "雨后": 6, "连雨": 4, "台风": 2, "冰雹": 2 };
const OPEN_MIN = 21 * 60;      // 21:00 开店
const CLOSE_MIN = 28 * 60;     // 04:00 打烊（+7h）
const MAX_AFFINITY = 10;

const LEVELS = [
  [0, "LV1 新客"], [8, "LV2 熟脸"], [18, "LV3 帮工"], [30, "LV4 吧台助手"],
  [45, "LV5 常客"], [65, "LV6 巷内红人"], [90, "LV7 调酒师"], [120, "LV8 深巷名人"], [160, "LV9 巷子传说"],
];

const rnd = () => Math.random();
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fmtClock(min) {
  min = Math.floor(min % (24 * 60));
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function levelOf(rep) {
  let name = LEVELS[0][1];
  for (const [need, n] of LEVELS) if (rep >= need) name = n;
  return name;
}
function stripQty(ing) {
  return ing.replace(/[0-9０-９]+(\.[0-9]+)?(ml|g|克|毫升|颗|片|个|滴|撮|枝|包|瓣|块|勺|喷|串|小枝|片|卷|结|荚|颗)?/gi, "").replace(/\s+/g, "").trim();
}

/* ── 存档 ── */
function savePath(profile) {
  const safe = String(profile || "default").replace(/[^\w\u4e00-\u9fa5-]/g, "_");
  return path.join(SAVE_DIR, `${safe}.json`);
}
function newGame(profile = "default") {
  return {
    profile, version: 1,
    day: 1, clock: OPEN_MIN + 5, weather: "微雨",
    tab: 300, reputation: 0, drunk: 0, hunger: 80,
    location: "酒吧",
    inventory: [{ name: "旧唱片", note: "老康送的，说有时候放放。" }],
    flags: { areas: ["酒吧", "宵夜档", "便利店", "天台", "后巷", "巷口"], metHidden: [], failStreak: 0, perfectStreak: 0, mastery: 0, allNightDone: false, mixCount: 0, serveCount: 0 },
    recipesUnlocked: DATA.recipes.filter(r => r.unlock.type === "default").map(r => r.id),
    recipesCrafted: {},
    relationships: {},      // name -> {affinity, visits, met, lastDay}
    quests: { accepted: [], completed: [], failed: [], board: [] },
    barTop: null,           // {recipeId, name, quality, flavor_tags, mood_tags, lowAlcohol}
    pendingEvent: null,
    memories: [],
    eventLog: [],           // {day, time, text}
    actionCount: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}
function loadGame(profile) {
  try {
    const s = JSON.parse(fs.readFileSync(savePath(profile), "utf8"));
    if (!s.version) return null;
    return s;
  } catch { return null; }
}
function persist(state) {
  state.updatedAt = Date.now();
  try {
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(savePath(state.profile), JSON.stringify(state, null, 1));
  } catch (e) { /* 磁盘问题不致命 */ }
}

/* ── 工具函数 ── */
function rel(st, name) {
  if (!st.relationships[name]) st.relationships[name] = { affinity: 0, visits: 0, met: false, lastDay: 0 };
  return st.relationships[name];
}
function addAffinity(st, name, delta) {
  if (!DATA.npcsByName[name]) return;
  const r = rel(st, name);
  const before = r.affinity;
  r.affinity = clamp(r.affinity + delta, 0, MAX_AFFINITY);
  if (delta > 0 && before < 5 && r.affinity >= 5) addMemory(st, `${name}把你当自己人了`);
  checkAffinityUnlocks(st);
}
function checkAffinityUnlocks(st) {
  // 好感型配方解锁统一交给 checkUnlockConditions（在每次动作的 pack 中兜底执行）
  checkUnlockConditions(st, "silent");
}
function addMemory(st, text) {
  if (st.memories.includes(text)) return;
  st.memories.push(text);
  st.eventLog.unshift({ day: st.day, time: fmtClock(st.clock), text: `🪶 记忆碎片：「${text}」` });
}
function addLog(st, text) {
  st.eventLog.unshift({ day: st.day, time: fmtClock(st.clock), text });
  if (st.eventLog.length > 120) st.eventLog.length = 120;
}
function addItem(st, name, note) {
  const it = st.inventory.find(i => i.name === name);
  if (it) it.qty = (it.qty || 1) + 1;
  else st.inventory.push({ name, note: note || "", qty: 1 });
  st.eventLog.unshift({ day: st.day, time: fmtClock(st.clock), text: `🎒 获得「${name}」` });
}
function hasItem(st, name) { return st.inventory.some(i => i.name === name); }
function removeItem(st, name) {
  const i = st.inventory.findIndex(x => x.name === name);
  if (i >= 0) { st.inventory.splice(i, 1); return true; }
  return false;
}
function unlockRecipe(st, id, silent) {
  if (st.recipesUnlocked.includes(id)) return false;
  st.recipesUnlocked.push(id);
  const r = DATA.recipesById[id];
  if (!silent) {
    addLog(st, `📖 新配方解锁：${r ? r.name : id}`);
    addMemory(st, `学会了调「${r ? r.name : id}」`);
  }
  return true;
}
function visibleNpcsAt(st, loc) {
  const clock = st.clock % (24 * 60);
  return DATA.npcs.filter(n => {
    if (n.location === "隐藏") {
      // 隐藏 NPC 出现条件
      if (n.name === "蓑衣人") return (st.weather === "大雨" || st.weather === "连雨") && loc === "后巷";
      if (n.name === "无名") return loc === "酒吧" && clock >= 3 * 60 && clock <= 4 * 60;
      if (n.name === "酒仙") return st.drunk >= 80 && loc === "酒吧";
      if (n.name === "远客") return st.weather === "台风" && loc === "酒吧";
      return false;
    }
    if (n.location !== loc && !(n.name === "大橘" || n.name === "煤球")) return false;
    // 猫：煤球常驻酒吧，大橘常驻巷子，特殊
    if ((n.name === "煤球" || n.name === "大橘") && n.location !== loc) return false;
    // 简化的作息：夜间营业时段基本都在
    return true;
  });
}
function npcOnDutyNote(npc, st) {
  const clock = st.clock % (24 * 60);
  if (clock < 4 * 60 || clock >= 21 * 60) return npc.schedule.night;
  return npc.schedule.day;
}

/* ── 解锁检查 ── */
function checkUnlockConditions(st, trigger) {
  const newly = [];
  for (const r of DATA.recipes) {
    if (st.recipesUnlocked.includes(r.id)) continue;
    const u = r.unlock || { type: "default" };
    let ok = false;
    switch (u.type) {
      case "default": ok = true; break;
      case "reputation": ok = st.reputation >= u.value; break;
      case "affinity": ok = (st.relationships[u.npc] || {}).affinity >= u.value; break;
      case "weather": ok = st.weather === u.value; break;
      case "time": {
        // 深夜限定：clock 在 21:00→04:00 之间跨越午夜，"02:00 之后"指午夜后的那段
        const c = st.clock % 1440;
        if (u.value) { const t0 = parseHM(u.value); ok = c >= t0 && c < 4 * 60; }
        else if (u.from) { ok = c >= parseHM(u.from) && c < 4 * 60; }
        else ok = false;
        break;
      }
      case "drunk": ok = st.drunk >= u.value; break;
      case "fail_streak": ok = st.flags.failStreak >= u.value; break;
      case "perfect_streak": ok = st.flags.perfectStreak >= u.value; break;
      case "mastery": ok = st.flags.mastery >= u.value; break;
      case "all_night": ok = st.flags.allNightDone; break;
      case "hidden_met": ok = (st.flags.metHidden || []).length >= u.value; break;
      case "item": ok = hasItem(st, u.value); break;
      case "quest": ok = st.quests.completed.includes(u.value); break;
      case "event": ok = false; /* 由事件效果直接解锁 */ break;
    }
    if (ok) { if (unlockRecipe(st, r.id)) newly.push(r); }
  }
  if (newly.length && trigger !== "silent") {
    // 文案由调用方拼进叙事
  }
  return newly;
}
function parseHM(s) {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + (m || 0);
}

/* ── 委托板 ── */
function refreshBoard(st) {
  const board = [];
  for (const q of DATA.quests) {
    if (st.quests.completed.includes(q.id) && !q.repeatable) continue;
    if (st.quests.accepted.some(a => a.id === q.id)) continue;
    if (q.chain_next !== null && q.chain_next !== undefined) {
      // 链式任务：仅当是链首或前序已完成时上板
      const prevDone = DATA.quests.some(x => x.chain_next === q.id && st.quests.completed.includes(x.id));
      const isChainStart = !DATA.quests.some(x => x.chain_next === q.id);
      if (!isChainStart && !prevDone) continue;
    } else if (DATA.quests.some(x => x.chain_next === q.id)) {
      // 链的末环（chain_next=null）：同样等前序完成
      const prevDone = DATA.quests.some(x => x.chain_next === q.id && st.quests.completed.includes(x.id));
      if (!prevDone) continue;
    }
    if (q.repeatable) { board.push(q.id); continue; }
    // 一次性：失败的不再上板——但连锁任务失败后可以重试（别让剧情卡死）
    if (st.quests.failed.includes(q.id)) {
      const inChain = q.chain_next !== null && q.chain_next !== undefined || DATA.quests.some(x => x.chain_next === q.id);
      if (!inChain) continue;
    }
    // 一次性：见过委托人即可见（失败后重试也不被好感门槛卡住）
    const giverRel = st.relationships[q.giver];
    if (q.giver === "无人" || (giverRel && giverRel.met)) board.push(q.id);
  }
  st.quests.board = board;
}
function acceptQuest(st, id) {
  const q = DATA.questsById[id];
  if (!q) return { ok: false, msg: "没有这个委托。" };
  if (st.quests.accepted.some(a => a.id === id)) return { ok: false, msg: "已经接了。" };
  if (!st.quests.board.includes(id)) return { ok: false, msg: "委托板上看不到它——先去认识委托人，或先完成它的前置。" };
  st.quests.accepted.push({ id, sinceDay: st.day, mixesSince: 0, done: false });
  return { ok: true, msg: `接下委托「${q.title}」` };
}

/* ── 委托判定 ── */
function gradeOf(score) {
  if (score >= 0.95) return "完美";
  if (score >= 0.7) return "良好";
  if (score >= 0.4) return "平平";
  return "失败";
}
function tryCompleteQuests(st, ctx) {
  // ctx: {servedTo?, drink?, exploreLoc?, talkedTo?, item?}
  const msgs = [];
  for (const a of [...st.quests.accepted]) {
    if (a.done) continue;
    const q = DATA.questsById[a.id];
    if (!q) continue;
    let done = null; // true/false
    if (q.type === "drink_request" && ctx.servedTo) {
      if (q.giver !== ctx.servedTo && q.giver !== "无人") continue;
      const c = q.success_conditions || {};
      const d = ctx.drink || {};
      const okReq = (c.flavor_required || []).every(f => (d.flavor_tags || []).includes(f));
      const okForb = !(c.flavor_forbidden || []).some(f => (d.flavor_tags || []).includes(f));
      // 氛围宽松判定：有交集即可；「完美」品质的酒被认为能胜任任何氛围
      const okMood = !(c.mood_required || []).length
        || (c.mood_required || []).some(m => (d.mood_tags || []).includes(m))
        || d.quality === "完美";
      const okSpec = !c.specific_recipe || d.recipeId === c.specific_recipe;
      done = okReq && okForb && okMood && okSpec;
    } else if (q.type === "fetch" && ctx.talkedTo === q.giver && ctx.item) {
      done = ctx.item === q.success_conditions.target_item;
    } else if (q.type === "social" && ctx.talkedTo === q.success_conditions.target_npc) {
      done = true;
    } else if (q.type === "explore" && ctx.exploreLoc === q.success_conditions.target_location) {
      // 探索委托：到达并探索即完成（简单可靠）
      done = rnd() < 0.9;
    } else if (q.type === "challenge" && ctx.drink) {
      const c = q.success_conditions || {};
      a.mixesSince = (a.mixesSince || 0) + 1;
      const needQ = c.quality_required || "良好";
      const qRank = { "失败": 0, "平平": 1, "良好": 2, "完美": 3 };
      let ok = qRank[ctx.drink.quality] >= qRank[needQ];
      if (c.specific_recipe) ok = ok && ctx.drink.recipeId === c.specific_recipe;
      if (c.flavor_required) ok = ok && c.flavor_required.every(f => (ctx.drink.flavor_tags || []).includes(f));
      if (c.drink_count) ok = ok && a.mixesSince <= c.drink_count;
      if (c.rps_win) ok = ok && rnd() < 0.5;
      done = ok;
    }
    if (done === null) continue;
    a.done = true;
    st.quests.accepted = st.quests.accepted.filter(x => x !== a);
    if (done) completeQuest(st, q, msgs);
    else failQuest(st, q, msgs);
  }
  return msgs;
}
function completeQuest(st, q, msgs) {
  st.quests.completed.push(q.id);
  const rw = q.reward || {};
  if (rw.tab) { st.tab += rw.tab; }
  if (rw.reputation) { st.reputation += rw.reputation; }
  if (rw.item) addItem(st, rw.item);
  if (rw.unlock) {
    if (rw.unlock.recipe) unlockRecipe(st, rw.unlock.recipe);
    if (rw.unlock.memory) addMemory(st, rw.unlock.memory);
    if (rw.unlock.area) st.flags.areas.push(rw.unlock.area);
  }
  if (rw.affinity) for (const [n, v] of Object.entries(rw.affinity)) addAffinity(st, n, v);
  // 陷阱委托的坏结果提示
  const trap = (q.tags || []).includes("陷阱");
  msgs.push(`✅ 委托完成「${q.title}」${rw.tab ? ` · +${rw.tab} Tab` : ""}${rw.reputation ? ` · 声望${rw.reputation > 0 ? "+" : ""}${rw.reputation}` : ""}${trap ? " · ⚠️ 结果并不像你想的那样……" : ""}`);
  msgs.push(q.success_dialogue);
  addLog(st, `📋 委托完成：「${q.title}」`);
}
function failQuest(st, q, msgs) {
  st.quests.failed.push(q.id);
  const p = q.fail_penalty || {};
  if (p.tab) st.tab = Math.max(0, st.tab - p.tab);
  if (p.reputation) st.reputation += p.reputation;
  msgs.push(`❌ 委托失败「${q.title}」${p.reputation ? ` · 声望${p.reputation}` : ""}`);
  msgs.push(q.fail_dialogue);
  addLog(st, `📋 委托失败：「${q.title}」`);
}

/* ── 事件系统 ── */
function rollEvent(st) {
  if (st.pendingEvent) return null;
  const doneToday = st.flags.doneEventsToday || (st.flags.doneEventsToday = []);
  const clock = st.clock % 1440;
  const candidates = DATA.events.filter(e => {
    const c = e.trigger_condition || {};
    if (c.location && c.location !== "any" && c.location !== st.location) return false;
    if (c.weather && c.weather !== "any" && c.weather !== st.weather) return false;
    if (c.time && c.time !== "any" && c.time !== fmtSlot(clock)) return false;
    if (c.prerequisite_event) { if (!st.flags.doneEvents || !st.flags.doneEvents.includes(c.prerequisite_event)) return false; }
    if (doneToday.includes(e.id)) return false; // 同一夜不重复——防止事件循环卡死
    if (c.min_affinity) {
      for (const [n, v] of Object.entries(c.min_affinity)) if ((st.relationships[n] || {}).affinity < v) return false;
    }
    if (c.min_affinity_any) {
      const anyMax = Math.max(0, ...Object.values(st.relationships).map(r => r.affinity));
      if (anyMax < c.min_affinity_any) return false;
    }
    if (c.max_visit_gap) {
      const gaps = Object.values(st.relationships).map(r => st.day - (r.lastDay || st.day));
      if (!gaps.some(g => g >= c.max_visit_gap)) return false;
    }
    if (c.birthday && !st.flags.birthdayTonight) return false;
    // drunk 档位
    const dlevel = st.drunk >= 70 ? "大醉" : st.drunk >= 25 ? "微醺" : "清醒";
    if (c.drunk_level && c.drunk_level !== "any") {
      if (e.trigger === "drunk" && c.drunk_level !== dlevel) return false;
      if (e.trigger !== "drunk" && c.drunk_level !== "any") return false;
    }
    return true;
  });
  if (!candidates.length) return null;
  // 加权抽取
  const weighted = [];
  for (const e of candidates) {
    let w = (e.trigger_condition.probability || 0.05) * 100;
    weighted.push([e, w]);
  }
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let roll = rnd() * Math.min(total, 55); // 控制事件频率
  for (const [e, w] of weighted) {
    if (roll < w) { st.pendingEvent = e.id; doneToday.push(e.id); return e; }
    roll -= w;
  }
  return null;
}
function fmtSlot(clock) {
  if (clock >= 21 * 60 || clock < 4 * 60) return "21:00"; // 夜间档
  if (clock < 19 * 60) return "19:00";
  return "19:00";
}
function applyEffect(st, effect) {
  const lines = [];
  if (!effect) return lines;
  if (effect.tab) { st.tab += effect.tab; lines.push(`Tab ${effect.tab > 0 ? "+" : ""}${effect.tab}`); }
  if (effect.drunk) { st.drunk = clamp(st.drunk + effect.drunk, 0, 100); lines.push(`醉酒 ${effect.drunk > 0 ? "+" : ""}${effect.drunk}`); }
  if (effect.hunger) { st.hunger = clamp(st.hunger + effect.hunger, 0, 100); lines.push(`饱腹 ${effect.hunger > 0 ? "+" : ""}${effect.hunger}`); }
  if (effect.reputation) { st.reputation += effect.reputation; lines.push(`声望 ${effect.reputation > 0 ? "+" : ""}${effect.reputation}`); }
  if (effect.npc_relationship) for (const [n, v] of Object.entries(effect.npc_relationship)) { addAffinity(st, n, v); lines.push(`${n} 好感${v > 0 ? "+" : ""}${v}`); }
  if (effect.unlock_memory) { addMemory(st, effect.unlock_memory); }
  if (effect.unlock_recipe) { if (unlockRecipe(st, effect.unlock_recipe)) lines.push(`解锁配方「${DATA.recipesById[effect.unlock_recipe].name}」`); }
  if (effect.unlock_area && !st.flags.areas.includes(effect.unlock_area)) { st.flags.areas.push(effect.unlock_area); lines.push(`解锁区域「${effect.unlock_area}」`); }
  if (effect.item) { addItem(st, effect.item); }
  if (effect.drink_score_bonus) lines.push("今晚的酒 +1 分");
  return lines;
}

/* ── 时间推进 ── */
function advanceTime(st, minutes) {
  st.clock += minutes;
  const crossed4am = st.clock >= CLOSE_MIN;
  if (crossed4am) {
    st.flags.allNightDone = true;
    checkUnlockConditions(st, "silent");
    st.day += 1;
    st.clock = OPEN_MIN;
    st.drunk = Math.max(0, st.drunk - 60);
    st.hunger = clamp(st.hunger - 20, 0, 100);
    st.flags.failStreak = 0; st.flags.perfectStreak = 0;
    st.barTop = null;
    st.flags.birthdayTonight = false;
    st.flags.doneEventsToday = []; // 新的一夜，事件池重置
    // 换天气
    const bag = [];
    for (const [w, wt] of Object.entries(WEATHER_WEIGHTS)) bag.push(...Array(wt).fill(w));
    st.weather = pick(bag);
    addLog(st, `———— 第 ${st.day} 夜 · ${st.weather} ————`);
    return `🌙 天亮了。你打烊、锁门、睡下。一觉醒来是第 ${st.day} 夜，今晚${st.weather}。`;
  }
  return null;
}

/* ── 结果打包 ── */
function pack(st, narrative, hints, extra = {}) {
  refreshBoard(st);
  const newlyUnlocked = checkUnlockConditions(st, "silent");
  if (newlyUnlocked.length) {
    narrative += `\n\n📖 恍惚间，你记下了新配方：${newlyUnlocked.map(r => `「${r.name}」(${r.name_en})`).join("、")}。`;
  }
  const lv = levelOf(st.reputation);
  const text = `【深巷 · 第${st.day}夜 ${fmtClock(st.clock)} · ${st.location} · ${st.weather}】\n\n${narrative}\n\n——\n状态：Tab ${st.tab} ｜ 清醒度 ${100 - st.drunk}/100 ｜ 饱腹 ${st.hunger} ｜ 声望 ${st.reputation}（${lv}）\n${st.pendingEvent ? "⚡ 正有事件等待回应：用 handle_event 选择。" : ""}`;
  persist(st);
  return {
    text,
    hints: hints && hints.length ? hints : defaultHints(st),
    event: st.pendingEvent ? eventForMcp(st) : null,
    state: publicState(st),
    ...extra,
  };
}
function defaultHints(st) {
  const h = [];
  if (st.pendingEvent) h.push("handle_event：回应正在发生的事件（优先）");
  else {
    h.push("look_around：看看四周有什么人");
    h.push("mix_drink：调一杯酒（可报配方名，或自由搭配材料）");
    if (st.barTop) h.push(`serve_drink：把「${st.barTop.name}」递给某位客人`);
    h.push("check_quest_board：委托板可能有新单子");
  }
  h.push("go_to：换个地方走走（" + LOCATIONS.join("/") + "）");
  return h.slice(0, 5);
}
function publicState(st) {
  return {
    day: st.day, time: fmtClock(st.clock), weather: st.weather, location: st.location,
    tab: st.tab, sobriety: 100 - st.drunk, hunger: st.hunger,
    reputation: st.reputation, level: levelOf(st.reputation),
    inventory: st.inventory, barTop: st.barTop,
    recipesUnlocked: st.recipesUnlocked.length, recipesTotal: DATA.recipes.length,
    memories: st.memories, eventLog: st.eventLog.slice(0, 12),
    quests: { accepted: st.quests.accepted.map(a => qBrief(DATA.questsById[a.id])), completedCount: st.quests.completed.length },
    relationships: Object.fromEntries(Object.entries(st.relationships).map(([k, v]) => [k, v.affinity])),
    pendingEvent: st.pendingEvent ? eventForMcp(st) : null,
  };
}
function qBrief(q) {
  if (!q) return null;
  return { id: q.id, title: q.title, type: q.type, giver: q.giver, difficulty: q.difficulty, hint: q.request_dialogue };
}
function eventForMcp(st) {
  const e = DATA.events.find(x => x.id === st.pendingEvent);
  if (!e) return null;
  return { id: e.id, title: e.title, description: e.description, choices: e.choices.map((c, i) => ({ index: i, text: c.text })), timeout_hint: e.no_choice_timeout };
}

/* ══════════ 对外动作 ══════════ */
const Engine = {
  DATA, LOCATIONS,

  enter(st, playerName) {
    const fresh = !st.introDone;
    if (!st.playerName) st.playerName = playerName || "调酒师";
    if (fresh) { st.introDone = true; st.playerName = playerName || st.playerName; }
    refreshBoard(st);
    const intro = fresh
      ? `门上的铜铃「叮铃」一响。你把围裙系上，擦亮吧台，抬头看了看墙上的老挂钟——21:05，开店了。

这里是深巷（Deep Alley），一条地图上搜不到的小巷：尽头是你的酒吧，中间是老周的宵夜档、阿伟的便利店，楼上有人唱歌，楼下有人打拳，巷子里还有猫。巷规三条：不问来路，不劝酒，天亮前必须走。

你是这里的调酒师。今晚${st.weather}。客人会来，委托会来，事件也会来——把它们接住，就是这一夜的全部。`
      : `铜铃一响，你回到吧台。第 ${st.day} 夜，${st.weather}。上次的进度都还在：Tab ${st.tab}，声望 ${st.reputation}（${levelOf(st.reputation)}），已解锁配方 ${st.recipesUnlocked.length}/${DATA.recipes.length}，记忆碎片 ${st.memories.length} 条。`;
    const tips = fresh
      ? [
          "『新手四步』：look_around 看看谁在场 → talk_to 聊天混脸熟（解锁委托）→ mix_drink 调酒 → serve_drink 递给客人",
          "调酒可以报配方名（如 mix_drink recipe_name=琥珀落日），也可以自由搭配材料",
          "出现 ⚡ 事件时优先用 handle_event 回应；酒谱、名册、状态都能随时查",
        ]
      : ["看看 check_quest_board 和委托进度", "去不同地点会遇到不同的人和事件"];
    return pack(st, intro, tips);
  },

  look(st) {
    const npcs = visibleNpcsAt(st, st.location);
    const names = npcs.map(n => n.name);
    for (const n of npcs) { const r = rel(st, n.name); if (!r.met) { r.met = true; r.visits++; r.lastDay = st.day; if (n.location === "隐藏") { st.flags.metHidden.push(n.name); addLog(st, `🕯️ 遇见隐藏人物：${n.name}`); } } else { r.visits++; r.lastDay = st.day; } }
    const locDesc = {
      "酒吧": "你的店。暖黄的灯，吧台后一整墙的酒，老康的钢琴立在角落。门口的铜铃偶尔被夜风吹响。",
      "宵夜档": "老周的摊子炉火正旺，镬气混着孜然味飘出十米。阿香在旁边收拾碗筷，塑料凳子上永远坐满了夜归的人。",
      "便利店": "阿伟的24小时便利店，白得发亮的灯光。关东煮咕嘟咕嘟，货架上的饭团摆得整整齐齐。",
      "天台": "楼顶的风比地面大。晾衣绳、藤椅、几盆花，还有阿猫的吉他声。抬头能看见被楼切成小块的夜空。",
      "后巷": "巷子最暗的一段。墙根长着薄荷，纸箱码在角落，第三根电线杆下的灯忽明忽暗。",
      "地下室": "楼梯往下，灯光变成暖红色。拳台的灯亮着，赌桌那边烟雾缭绕，低音炮在地板上震动。",
      "巷口": "巷子的出口，路灯亮着。往外一步就是车水马龙的另一个世界——往里一步，是深巷。",
    }[st.location] || "巷子里。";
    const present = names.length
      ? npcs.map(n => {
          const r = st.relationships[n.name] || {};
          const aff = r.met ? `（好感 ${r.affinity}/${MAX_AFFINITY}）` : "（第一次见）";
          return `· ${n.emoji || ""} ${n.name} — ${n.title} ${aff}`;
        }).join("\n")
      : "（此刻没人。夜还长。）";
    const narrative = `${locDesc}\n\n在场：\n${present}\n\n${st.barTop ? `吧台上放着你调的「${st.barTop.name}」（${st.barTop.quality}）——还没递出去。` : "吧台干净，随时可以开摇。"}`;
    return pack(st, narrative, [
      ...(npcs.length ? [`talk_to：和 ${names.slice(0, 3).join(" / ")} 聊聊`] : []),
      "go_to：去别处逛逛",
      "explore：在这儿搜一搜",
    ]);
  },

  go_to(st, location) {
    if (!LOCATIONS.includes(location)) {
      return pack(st, `你想了想「${location}」——巷子里没有这个地方。能去的是：${LOCATIONS.join("、")}。`, ["go_to：换一个正确地名"]);
    }
    if (location === "地下室" && !st.flags.areas.includes("地下四层") && !st.relationships["老鬼"]) {
      if (!st.flags.dBAllowed) {
        st.flags.dBAllowed = true; // 第一次会被老鬼拦下，第二次放行（巷子不会真拒绝一个好奇的人）
        return pack(st, `你往楼梯口走了两步，被一把军大衣拦住。老鬼从台灯后抬起眼皮：『下面不是逛街的地方。』——但他没真的拦死。也许下次再来，或者先跟他聊聊（talk_to 老鬼）。`, ["talk_to 老鬼：套个近乎", "go_to 别处"]);
      }
    }
    st.location = location;
    const travel = {
      "酒吧": "你掀开门帘回到吧台，铜铃叮铃一响。",
      "宵夜档": "你走到宵夜档，炉火的暖意扑面而来。老周的锅铲敲得梆梆响。",
      "便利店": "便利店的自动门『叮咚』开了，冷柜的白光让人清醒。",
      "天台": "你爬了两段楼梯上天台，风一下子把夜吹宽了。",
      "后巷": "你拐进后巷，脚步声在墙与墙之间来回弹。",
      "地下室": "你顺着楼梯往下，低音从地板传上来。老鬼看了你一眼，没拦——算你过关了。",
      "巷口": "你走到巷口，路灯下能看见大路上的车流飞驰。",
    }[location];
    // 移动后 NPC 相识
    for (const n of visibleNpcsAt(st, location)) {
      const r = rel(st, n.name);
      if (!r.met) { r.met = true; r.visits++; r.lastDay = st.day; if (n.location === "隐藏") { st.flags.metHidden.push(n.name); addLog(st, `🕯️ 遇见隐藏人物：${n.name}`); } }
    }
    const ev = rollEvent(st);
    let narrative = travel;
    if (ev) narrative += "\n\n" + eventBlock(st, ev);
    return pack(st, narrative);
  },

  talk_to(st, name, say) {
    const npc = DATA.npcsByName[name];
    if (!npc) {
      const known = Object.keys(st.relationships).filter(k => (st.relationships[k] || {}).met);
      return pack(st, `你环顾四周——巷子里没有叫「${name}」的人。${known.length ? `你认识的人里或许有TA：${known.slice(0, 6).join("、")}。` : "先 look_around 看看谁在场吧。"}`, ["look_around"]);
    }
    if (!visibleNpcsAt(st, st.location).some(n => n.name === name)) {
      const where = npc.location === "隐藏" ? "……TA不在这个时候、这个地方出现。" : `${npc.name}现在不在${st.location}。TA常在${npc.location}（${npcOnDutyNote(npc, st)}）。`;
      return pack(st, where, ["go_to 去TA常在的地方"]);
    }
    const r = rel(st, name);
    if (!r.met) { r.met = true; if (npc.location === "隐藏") { st.flags.metHidden.push(name); } }
    r.visits++; r.lastDay = st.day;
    const gain = r.affinity < 3 ? 1 : (r.affinity < 6 ? 1 : rnd() < 0.4 ? 1 : 0);
    if (gain) addAffinity(st, name, gain);

    const greet = pick(npc.greetings);
    const extra = [];
    if (say) extra.push(`你说了：「${say}」`);
    // 关系节点
    if (r.affinity >= 3 && r.visits % 4 === 0) extra.push(`${npc.name}难得多说了一句：『${npc.relationship_unlock}。』`);
    if (r.affinity >= 6 && !st.flags[`secret_${name}`]) { st.flags[`secret_${name}`] = true; extra.push(`（趁人少，${npc.name}凑近说了件小事——${npc.secret}）`); addMemory(st, `${name}的秘密`); }
    // 喜好提示
    extra.push(`（TA喜欢：${npc.likes.join("、")}｜讨厌：${npc.dislikes.join("、")}）`);
    let narrative = `${npc.emoji || ""} ${npc.name}｜${npc.title}\n\n${greet}\n${extra.length ? "\n" + extra.join("\n") : ""}`;
    // social 委托判定
    const msgs = tryCompleteQuests(st, { talkedTo: name });
    if (msgs.length) narrative += "\n\n" + msgs.join("\n\n");
    // fetch 交付判定
    for (const a of [...st.quests.accepted]) {
      const q = DATA.questsById[a.id];
      if (q && q.type === "fetch" && q.giver === name) {
        const item = q.success_conditions.target_item;
        if (hasItem(st, item)) {
          removeItem(st, item);
          const m = tryCompleteQuests(st, { talkedTo: name, item });
          if (m.length) narrative += "\n\n" + m.join("\n\n");
        } else {
          narrative += `\n\n（${name}提了提「${q.title}」——你还缺「${item}」。去 ${q.success_conditions.target_location} explore 找找。）`;
        }
      }
    }
    const hints = [`再聊一句 talk_to ${name}`, npc.sells ? `buy_from ${name}（TA卖：${npc.sells.join("、")}）` : `serve_drink ${name}：把吧台上的酒递给TA`];
    return pack(st, narrative, hints);
  },

  mix_drink(st, params = {}) {
    const { recipe_name, ingredients, method, custom_name } = params;
    let target = null;
    if (recipe_name) {
      target = DATA.recipes.find(r => r.name === recipe_name || r.name_en.toLowerCase() === String(recipe_name).toLowerCase() || r.id === recipe_name);
      if (!target) return pack(st, `酒单上没有叫「${recipe_name}」的酒。想调别的？browse_recipes 翻翻图鉴，或直接自由搭配材料。`, ["browse_recipes"]);
      if (!st.recipesUnlocked.includes(target.id)) {
        st.flags.failStreak++;
        return pack(st, `你对着酒架发了一会儿呆——「${target.name}」的方子你还没摸透（解锁条件：${target.unlock_condition}）。不如先调你能调的，或者自由发挥。`, ["browse_recipes：看看已解锁的酒"]);
      }
    }
    let matchScore, used;
    if (target) {
      used = target.ingredients;
      const given = Array.isArray(ingredients) && ingredients.length ? ingredients : used;
      matchScore = evalIngredients(given, used);
      if (method && method !== target.method) matchScore -= 0.15;
    } else {
      // 自由搭配：找最接近的已解锁配方
      if (!Array.isArray(ingredients) || !ingredients.length) {
        return pack(st, "你把摇壶拿起来又放下——总得有点材料。给我 ingredients 数组（如 [\"威士忌 45ml\",\"柠檬汁 10ml\",\"蜂蜜糖浆 15ml\"]），或报个 recipe_name。", ["browse_recipes：找灵感"]);
      }
      let best = null, bestScore = 0;
      for (const r of DATA.recipes) {
        if (!st.recipesUnlocked.includes(r.id)) continue;
        const s = evalIngredients(ingredients, r.ingredients);
        if (s > bestScore) { bestScore = s; best = r; }
      }
      if (best && bestScore >= 0.5) { target = best; matchScore = bestScore; used = ingredients; }
      else {
        // 真正的黑暗料理/特调
        st.flags.mixCount++; st.tab = Math.max(0, st.tab - 15);
        const grade = "特调";
        st.barTop = { recipeId: null, name: custom_name || "无名特调", quality: grade, flavor_tags: guessFlavors(ingredients), mood_tags: [], lowAlcohol: true };
        advanceTime(st, 15);
        return pack(st, `你把${ingredients.join("、")}一股脑摇在一起。喝了一口——说不上好喝，但绝对是独一无二的特调。你给它起名「${st.barTop.name}」（特调）。也许有哪位客人就吃这一套？`, [`serve_drink：把它递给某位客人试试`]);
      }
    }
    const grade = gradeOf(matchScore);
    st.flags.mixCount++;
    st.tab = Math.max(0, st.tab - (target.cost || 20));
    if (grade === "完美") { st.flags.perfectStreak++; st.flags.failStreak = 0; }
    else if (grade === "失败") { st.flags.failStreak++; st.flags.perfectStreak = 0; }
    else { st.flags.failStreak = 0; st.flags.perfectStreak = 0; }
    if (!st.recipesCrafted[target.id]) { st.flags.mastery++; st.recipesCrafted[target.id] = 1; }
    else st.recipesCrafted[target.id]++;
    st.barTop = { recipeId: target.id, name: custom_name || target.name, quality: grade, flavor_tags: target.flavor_tags, mood_tags: target.mood_tags, lowAlcohol: target.base_spirit === "无酒精基底" };
    const t = advanceTime(st, 18);
    const proc = mixNarrative(target, grade);
    let narrative = `${proc}\n\n吧台上是「${st.barTop.name}」——${grade}。${t ? "\n\n" + t : ""}`;
    const hints = [`serve_drink 某人：递出去`, "check_quest_board：看看有没有对口委托", "drink_self：自己尝一口"];
    // 挑战类委托判定（把这次调制交给挑战任务）
    const msgs = tryCompleteQuests(st, { drink: st.barTop });
    if (msgs.length) narrative += "\n\n" + msgs.join("\n\n");
    return pack(st, narrative, hints);
  },

  serve_drink(st, npcName) {
    if (!st.barTop) return pack(st, "吧台上没有调好的酒。先 mix_drink 一杯。", ["mix_drink"]);
    const npc = DATA.npcsByName[npcName];
    if (!npc) return pack(st, `这里没有「${npcName}」。在场的人用 look_around 看。`, ["look_around"]);
    const drink = st.barTop;
    let narrative;
    const r = rel(st, npcName);
    // 口味反应
    const liked = drink.flavor_tags.filter(f => npc.likes.some(l => l.includes(f))).length;
    const disliked = drink.flavor_tags.filter(f => npc.dislikes.some(l => l.includes(f))).length;
    let taste = 0;
    if (liked) { taste += liked; addAffinity(st, npcName, Math.min(2, liked)); }
    if (disliked) { taste -= disliked; addAffinity(st, npcName, -1); }
    const tasteLine = taste > 0 ? `${npc.name}眼睛亮了一下：「${pick(["这个味道……有点东西。", "诶，你怎么知道我吃这套？", "再来一杯——不是，记我账上也要再来一杯。"])}」`
      : taste < 0 ? `${npc.name}喝了一小口，礼貌地放下：「……嗯。挺特别的。」（TA好像不太喜欢）`
      : `${npc.name}端起来喝了一口：「嗯，谢谢。夜里就需要这么一杯。」`;
    // 收入
    const base = DATA.recipesById[drink.recipeId];
    const mult = drink.quality === "完美" ? 1.2 : drink.quality === "良好" ? 1 : drink.quality === "平平" ? 0.7 : 0.4;
    const earn = Math.round((base ? base.sell_price : 40) * mult);
    st.tab += earn;
    st.flags.serveCount++;
    st.barTop = null;
    const t = advanceTime(st, 15);
    narrative = `你把「${drink.name}」（${drink.quality}）推到${npc.name}面前。\n\n${tasteLine}\n\nTA付了 ${earn} Tab。${t ? "\n\n" + t : ""}`;
    // 委托判定
    const msgs = tryCompleteQuests(st, { servedTo: npcName, drink });
    if (msgs.length) narrative += "\n\n" + msgs.join("\n\n");
    const ev = rollEvent(st);
    if (ev) narrative += "\n\n" + eventBlock(st, ev);
    return pack(st, narrative);
  },

  drink_self(st) {
    if (!st.barTop) return pack(st, "吧台上没酒。调一杯再喝——或者只是歇会儿（rest）。", ["mix_drink", "rest"]);
    const d = st.barTop;
    const alcohol = !d.lowAlcohol;
    st.drunk = clamp(st.drunk + (alcohol ? 15 : 2), 0, 100);
    st.hunger = clamp(st.hunger + 5, 0, 100);
    st.barTop = null;
    addLog(st, `🍹 自己喝了一杯「${d.name}」`);
    const t = advanceTime(st, 12);
    let narrative = `你给自己倒了一杯「${d.name}」。${alcohol ? "酒精顺着喉咙滑下去，夜色变得柔软了一点。清醒度降到 " + (100 - st.drunk) + "。" : "不醉人，但很熨帖。"}${st.drunk >= 80 ? "视野开始发暖——你隐约觉得吧台正中坐着一个胖子在朝你笑。" : ""}${t ? "\n\n" + t : ""}`;
    return pack(st, narrative, ["rest：歇一会儿醒醒酒", "mix_drink：再来一杯"]);
  },

  explore(st) {
    const loc = st.location;
    const t = advanceTime(st, 15);
    const finds = [];
    // 探索委托完成判定
    const msgs = tryCompleteQuests(st, { exploreLoc: loc });
    // 特殊物品
    if (st.weather === "雾" && loc === "后巷" && !st.flags.foundWetMatch && DATA.quests.some(q => q.id === "quest_065" && st.quests.completed.includes(q.id))) {
      st.flags.foundWetMatch = true; addItem(st, "湿火柴盒"); finds.push("你在第三根电线杆下摸到一只擦得干干净净的铁盒——湿火柴盒。");
    }
    if (loc === "后巷" && rnd() < 0.3 && !hasItem(st, "猫毛")) { addItem(st, "猫毛", "煤球在你裤腿上留下的。"); finds.push("裤腿上多了几根猫毛——煤球贴贴的证据。"); }
    if (loc === "便利店" && rnd() < 0.3 && !hasItem(st, "小鱼干")) { addItem(st, "小鱼干", "阿伟按内部价算的。"); finds.push("阿伟从货架深处摸出一包小鱼干：『煤球的。记你账上。』"); }
    if (loc === "天台" && rnd() < 0.2 && !hasItem(st, "流星照片")) { finds.push("地上有张打印的照片：流星很小，睡相很大。你把它捡了起来。"); addItem(st, "流星照片"); }
    // 随机小发现
    if (!finds.length && rnd() < 0.35) {
      const misc = [
        ["一枚硬币", "你在墙缝里抠出一枚硬币——不知道谁许的愿。"],
        ["半张电影票根", "票根上的字迹晕了，日期是二十年前。"],
        ["一颗话梅", "不知道谁掉的。你含了含，是甜的。"],
      ];
      const [n2, d2] = pick(misc);
      if (!hasItem(st, n2)) { addItem(st, n2, d2); finds.push(`${d2}（获得「${n2}」）`); }
      else finds.push("你在巷子里走了走，什么都没捡到，但腿暖和了一点。");
    }
    let narrative = `你在${loc}细细搜了一圈。${finds.length ? "\n\n" + finds.join("\n") : "\n\n没有什么新发现——但每一条砖缝你都看过了，这就够了。"}`;
    if (msgs.length) narrative += "\n\n" + msgs.join("\n\n");
    if (t) narrative += "\n\n" + t;
    const ev = rollEvent(st);
    if (ev) narrative += "\n\n" + eventBlock(st, ev);
    return pack(st, narrative);
  },

  buy_from(st, npcName, item) {
    const npc = DATA.npcsByName[npcName];
    if (!npc || !npc.sells) return pack(st, `${npcName || "TA"}不做买卖。卖东西的是：${DATA.npcs.filter(n => n.sells).map(n => `${n.name}（${n.sells.join("/")}）`).join("；")}。`);
    const item2 = item || npc.sells[0];
    if (!npc.sells.includes(item2)) return pack(st, `${npc.name}的摊上只有：${npc.sells.join("、")}。`, [`buy_from ${npcName} ${npc.sells[0]}`]);
    const price = { "炒粉": 25, "烤生蚝": 30, "糖水": 12, "烤玉米": 10, "炒面": 22, "馄饨": 20, "卤味": 28, "关东煮": 15, "咖啡": 12, "冰啤酒": 15, "单支花": 8, "手捧花": 60, "栀子花环": 30, "签文": 5, "平安符": 10, "晚报": 3, "旧杂志": 5, "代写书信": 5, "春联": 8 }[item2] || 15;
    if (st.tab < price) return pack(st, `囊中羞涩——${item2}要 ${price} Tab，你只有 ${st.tab}。`, ["mix_drink：先赚点酒钱"]);
    st.tab -= price;
    if (item2 === "炒粉" || item2 === "馄饨" || item2 === "关东煮" || item2 === "糖水" || item2 === "烤玉米") st.hunger = clamp(st.hunger + 35, 0, 100);
    addAffinity(st, npcName, 1);
    addItem(st, item2);
    const t = advanceTime(st, 12);
    const line = { "炒粉": "老周锅气十足地给你多加了个蛋：『趁热！』", "糖水": "阿香把糖水端给你，小声说：『周叔今天心情好，多给了一勺红豆。』", "单支花": "花婶把最新鲜的一枝塞给你：『送人？还是自己开心开心？』" }[item2] || `${npc.name}麻利地递给你${item2}。`;
    return pack(st, `你买了「${item2}」（-${price} Tab）。${line}${t ? "\n\n" + t : ""}`);
  },

  rest(st) {
    st.drunk = clamp(st.drunk - 12, 0, 100);
    const t = advanceTime(st, 30);
    return pack(st, `你靠着吧台闭眼歇了一会儿。摇壶安静了，冰箱的嗡嗡声变得清晰。${t ? "\n\n" + t : ""}`, ["look_around"]);
  },

  check_quest_board(st) {
    refreshBoard(st);
    const board = st.quests.board;
    const acc = st.quests.accepted.map(a => DATA.questsById[a.id]);
    let narrative = "📋 委托板（老槐树下，字条被夜风吹得哗哗响）\n";
    if (acc.length) {
      narrative += "\n【进行中】\n" + acc.map(q => `· ${q.title}｜${q.type}｜委托人：${q.giver}${q.chain_next ? "（连锁）" : ""}`).join("\n");
    }
    narrative += "\n\n【可接】\n" + (board.length ? board.map(id => {
      const q = DATA.questsById[id];
      return `· ${id}「${q.title}」${q.repeatable ? "（日常）" : ""}｜${q.type}｜难度${q.difficulty}｜委托人：${q.giver}`;
    }).join("\n") : "（暂时没有。多和巷子里的人聊天，委托会自己找上门。）");
    narrative += `\n\n【已完成】${st.quests.completed.length} 个｜【搞砸了】${st.quests.failed.length} 个`;
    return pack(st, narrative, ["accept_quest：报委托编号接单", "look_around"]);
  },

  accept_quest(st, id) {
    const res = acceptQuest(st, id);
    if (!res.ok) return pack(st, res.msg, ["check_quest_board"]);
    const q = DATA.questsById[id];
    let narrative = `${res.msg}\n\n${q.giver === "无人" ? "（委托人没有露面。纸条上的字很清瘦。）" : `（${q.giver}的状态：${q.giver_state}）`}\n\nTA说：「${q.request_dialogue}」`;
    if (q.type === "drink_request") narrative += `\n\n判定要点：要「${(q.success_conditions.flavor_required || ["任意"]).join("/")}${(q.success_conditions.mood_required || []).length ? "」+氛围「" + q.success_conditions.mood_required.join("/") : ""}」${(q.success_conditions.flavor_forbidden || []).length ? "，别放「" + q.success_conditions.flavor_forbidden.join("/") + "」" : ""}。`;
    if (q.type === "fetch") narrative += `\n\n要找的东西：「${q.success_conditions.target_item}」，去 ${q.success_conditions.target_location} explore。`;
    if (q.type === "social") narrative += `\n\n去找「${q.success_conditions.target_npc}」聊聊（TA在${q.success_conditions.target_location || "附近"}）。`;
    if (q.type === "explore") narrative += `\n\n去 ${q.success_conditions.target_location} explore 探一探。`;
    if (q.type === "challenge") narrative += `\n\n这是一场考验。按 TA 的规矩来——调酒要过「${q.success_conditions.quality_required || "良好"}」这关。`;
    return pack(st, narrative, ["mix_drink / explore / talk_to：按提示行动"]);
  },

  abandon_quest(st, id) {
    const before = st.quests.accepted.length;
    st.quests.accepted = st.quests.accepted.filter(a => a.id !== id);
    if (st.quests.accepted.length < before) {
      addLog(st, `📋 放弃委托：「${DATA.questsById[id] ? DATA.questsById[id].title : id}」`);
      return pack(st, `你把「${id}」的字条轻轻放回了板上。有些事，承认自己做不了，也是一种诚实。`);
    }
    return pack(st, "没有在进行中的这个委托。", ["check_quest_board"]);
  },

  handle_event(st, choiceIndex) {
    const e = DATA.events.find(x => x.id === st.pendingEvent);
    if (!e) return pack(st, "眼下并没有事件要回应。该干嘛干嘛。", ["look_around"]);
    let choice;
    if (typeof choiceIndex === "number") choice = e.choices[choiceIndex];
    else if (typeof choiceIndex === "string") choice = e.choices.find(c => c.text.includes(choiceIndex)) || e.choices[Number(choiceIndex)];
    st.flags.doneEvents = st.flags.doneEvents || [];
    if (!st.flags.doneEvents.includes(e.id)) st.flags.doneEvents.push(e.id);
    st.pendingEvent = null;
    if (!choice) {
      // 超时
      const lines = applyEffect(st, {});
      return pack(st, `你没有回应。「${e.title}」就这样过去了。\n\n${e.no_choice_timeout}`);
    }
    const lines = applyEffect(st, choice.effect);
    const t = advanceTime(st, 12);
    let narrative = `⚡ ${e.title}\n\n${e.description}\n\n你选择：${choice.text}\n\n${choice.result}`;
    if (lines.length) narrative += `\n\n（${lines.join("｜")}）`;
    if (t) narrative += "\n\n" + t;
    // 不在这里立刻掷下一个事件——让这一段余韵落地，下一个动作再掷
    return pack(st, narrative);
  },

  check_status(st) {
    refreshBoard(st);
    const rels = Object.entries(st.relationships).filter(([, v]) => v.met)
      .sort((a, b) => b[1].affinity - a[1].affinity)
      .slice(0, 8)
      .map(([k, v]) => `${k} ${v.affinity}/${MAX_AFFINITY}`).join("｜") || "还没有熟人";
    let narrative = `🏷️ ${st.playerName || "调酒师"}（${levelOf(st.reputation)}）
第 ${st.day} 夜 · ${fmtClock(st.clock)} · ${st.weather} · 在${st.location}
Tab ${st.tab} ｜ 清醒度 ${100 - st.drunk}/100 ｜ 饱腹 ${st.hunger}/100
声望 ${st.reputation} ｜ 配方 ${st.recipesUnlocked.length}/${DATA.recipes.length}（调过 ${Object.keys(st.recipesCrafted).length} 种）｜ 委托完成 ${st.quests.completed.length} ｜ 记忆 ${st.memories.length}
行囊：${st.inventory.map(i => i.name).join("、") || "空的"}
熟人：${rels}
进行中委托：${st.quests.accepted.map(a => DATA.questsById[a.id].title).join("、") || "无"}`;
    if (st.memories.length) narrative += `\n\n🪶 最近的记忆：${st.memories.slice(-3).map(m => `「${m}」`).join("")}`;
    return pack(st, narrative);
  },

  browse_recipes(st, filter = {}) {
    const { tier, base_spirit, flavor, mood, keyword, page } = filter;
    let list = DATA.recipes.filter(r => st.recipesUnlocked.includes(r.id));
    let lockedCount = DATA.recipes.length - list.length;
    if (tier) list = list.filter(r => r.tier === tier);
    if (base_spirit) list = list.filter(r => r.base_spirit === base_spirit);
    if (flavor) list = list.filter(r => r.flavor_tags.includes(flavor));
    if (mood) list = list.filter(r => r.mood_tags.includes(mood));
    if (keyword) list = list.filter(r => (r.name + r.name_en).toLowerCase().includes(String(keyword).toLowerCase()));
    const pageSize = 10;
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const p = clamp(Number(page) || 1, 1, pages);
    const slice = list.slice((p - 1) * pageSize, p * pageSize);
    const hiddenShown = DATA.recipes.filter(r => r.hidden && !st.recipesUnlocked.includes(r.id)).length;
    let narrative = `📖 酒谱图鉴（已解锁 ${st.recipesUnlocked.length}/${DATA.recipes.length}${tier || base_spirit || flavor || mood || keyword ? `，筛出 ${list.length} 条` : ""}${lockedCount ? `，还有 ${lockedCount} 杯等解锁（其中隐藏 ${hiddenShown} 杯）` : ""}）第 ${p}/${pages} 页\n\n`;
    narrative += slice.map(r => `· ${r.emoji}「${r.name}」${r.name_en}｜${r.tier}｜${r.base_spirit}｜难度${r.difficulty}｜${r.flavor_tags.join("/")}｜卖 ${r.sell_price} Tab\n  ${r.description}`).join("\n");
    if (p < pages) narrative += `\n\n（下一页：browse_recipes page=${p + 1}）`;
    return pack(st, narrative, [`mix_drink recipe_name=...`, ...(!filter.tier && !filter.keyword ? ["browse_recipes tier=legendary / flavor=烟熏 / mood=失恋 筛选"] : [])]);
  },

  browse_npcs(st, filter = {}) {
    let list = DATA.npcs.filter(n => (st.relationships[n.name] || {}).met);
    if (filter.location) list = list.filter(n => n.location === filter.location);
    const known = list.length;
    let narrative = `📕 巷子名册（打过照面 ${known}/${DATA.npcs.length}${filter.location ? `，在「${filter.location}」的 ${list.length} 人` : ""}）\n\n`;
    narrative += list.slice(0, 12).map(n => {
      const r = st.relationships[n.name] || {};
      return `· ${n.emoji} ${n.name}｜${n.title}｜${n.location}｜好感 ${r.affinity}/${MAX_AFFINITY}｜${n.dialogue_style.slice(0, 18)}…`;
    }).join("\n");
    if (known < DATA.npcs.length) narrative += `\n\n（还有 ${DATA.npcs.length - known} 张面孔没见过——有的在别的地点，有的要等雨、等雾、等凌晨三点、等你喝到一定份上。）`;
    return pack(st, narrative, ["go_to / look_around：去认识更多人"]);
  },

  save_game(st) {
    persist(st);
    return pack(st, `💾 已存档（第 ${st.day} 夜 ${fmtClock(st.clock)}，档位：${st.profile}）。巷子会记得你做到的一切。`, ["look_around"]);
  },

  load_game(st, profile) {
    const p = profile || st.profile;
    const s = loadGame(p);
    if (!s) return pack(st, `档位「${p}」是空的。`, ["enter：重新开张"]);
    st.profile = s.profile; Object.assign(st, s);
    return pack(st, `📥 读档成功：第 ${st.day} 夜 ${fmtClock(st.clock)}。`, ["look_around"]);
  },

  new_game(st, profile, playerName) {
    const p = profile || st.profile || "default";
    const s = newGame(p);
    if (playerName) s.playerName = playerName;
    // 原地替换内容，保持对象引用
    for (const k of Object.keys(st)) delete st[k];
    Object.assign(st, s);
    return Engine.enter(st, playerName);
  },

  guide() {
    return {
      text: `🏮 Deep Alley 深巷 · 玩法指南

【你是谁】深巷尽头的调酒师。经营酒吧，认识巷子里的人，接委托，见证故事。

【一夜怎么过】21:00 开店 → 客人来（look_around）→ 聊天（talk_to，混好感、解锁委托）→ 调酒（mix_drink）→ 递酒（serve_drink，收钱、推进委托）→ 事件（handle_event）→ 04:00 自动打烊进入下一夜。

【调酒】
· 按配方：mix_drink recipe_name="琥珀落日"（材料齐全=完美；缺料降档）
· 自由搭配：mix_drink ingredients=["金酒 40ml","青柠汁 20ml"] —— 会匹配最接近的配方，不像任何配方就是"特调"
· 配方解锁：默认款直接可用；其余靠声望/好感/天气/时刻/醉酒/剧情解锁。失败 3 次也会顿悟隐藏款。

【委托】委托板在 check_quest_board。五种类型：
· drink_request：按要求调酒递给委托人（味道+氛围要对口，忌口别碰）
· fetch：去指定地点 explore 找到物品，talk_to 委托人交付
· social：去和指定的人 talk_to
· explore：去指定地点 explore
· challenge：按要求完成一次（或多次）达到品质的调酒
连锁任务做完一环解锁下一环。注意：有些委托是陷阱，完成反而有坏结果。

【事件】出现 ⚡ 时用 handle_event(0/1/2) 回应；不回应走 no_choice_timeout。

【状态】tab 钱｜清醒度=100-醉酒（自己喝酒会降）｜饱腹（宵夜档吃饭补）｜声望=等级（LV1新客→LV9巷子传说）。

【隐藏内容】15 杯隐藏配方、4 位隐藏 NPC（雨夜的蓑衣人、凌晨三点的无名、醉眼里的酒仙、台风夜的远客）、传说配方「巷子的名字」要调遍 99 杯。

【原则】所有动作都会推进时间。天亮会自动打烊换日。`,
      hints: ["enter：正式进巷子", "look_around", "mix_drink"],
    };
  },
};

/* ── 调酒匹配 ── */
function evalIngredients(given, target) {
  const g = new Set(given.map(stripQty).filter(Boolean));
  const t = target.map(stripQty).filter(Boolean);
  if (!t.length) return 0;
  let hit = 0;
  for (const ing of t) {
    if (g.has(ing)) hit++;
    else if ([...g].some(x => x.includes(ing) || ing.includes(x))) hit += 0.6;
  }
  let score = hit / t.length;
  if (g.size > t.length * 2) score -= 0.1; // 乱加一堆
  return clamp(score, 0, 1);
}
function guessFlavors(ingredients) {
  const kw = { "柠檬": "酸", "柠": "酸", "蜂蜜": "甜", "糖": "甜", "奶": "奶味", "椰": "果香", "苏打": "气泡", "气": "气泡", "薄": "草本", "茶": "草本", "辣": "辣", "椒": "辣", "盐": "咸", "咖啡": "苦", "苦精": "苦", "威士忌": "烟熏", "泥煤": "烟熏", "梅": "果香", "橙": "果香", "荔": "果香", "西柚": "果香", "玫瑰": "花香", "花": "花香" };
  const tags = new Set();
  for (const ing of ingredients) for (const [k, v] of Object.entries(kw)) if (ing.includes(k)) tags.add(v);
  if (!tags.size) tags.add("浓烈");
  return [...tags].slice(0, 4);
}
function mixNarrative(r, grade) {
  const open = [
    "你把摇壶握在掌心，冰块撞出细碎的响。",
    "酒瓶在你手上一字排开，灯光穿过酒液，琥珀色的。",
    "你先闻了闻每瓶酒，然后开始量。",
  ];
  const byGrade = {
    "完美": `每一滴都落在该落的地方。摇匀、滤冰、入杯——${r.garnish !== "无" ? `最后${r.garnish}落在杯口，像本来就长在那里。` : "杯口干干净净，就像这杯不需要多余的话。"}`,
    "良好": `手法没有失手，味道差一点点火候——但客人喝不出来的那半步，你自己知道。`,
    "平平": `这杯能喝，但说不出去哪儿。像赶末班车回家的人，安全，没什么可说的。`,
    "失败": `冰加多了，或者顺序错了——总之味道散了。倒掉的时候你盯着下水口看了两秒，下次再来。`,
  };
  return `${pick(open)}\n\n${byGrade[grade]}\n\n（${r.method}｜${r.glass}｜成本 ${r.cost} Tab）`;
}
function eventBlock(st, ev) {
  return `⚡【事件】${ev.title}\n${ev.description}\n\n▸ 回应：handle_event(choice_index) —\n${ev.choices.map((c, i) => `  ${i}. ${c.text}`).join("\n")}\n（不做选择的话：${ev.no_choice_timeout}）`;
}

module.exports = Engine;
Engine.loadGame = loadGame;
Engine.newGame = newGame;
Engine.persist = persist;
Engine.publicState = publicState;
Engine._internal = { tryCompleteQuests, rollEvent, eventBlock, refreshBoard, acceptQuest, checkUnlockConditions };
