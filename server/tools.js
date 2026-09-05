/* ═══════════════════════════════════════════
   Deep Alley — MCP 工具定义与分发
   6 个动作域工具 + action 路由（v2）：
   alley_session / alley_move / alley_interact / alley_bar / alley_quest / alley_info
   旧版 21 个单工具名仍可用（向后兼容，不进 tools/list）。
   ═══════════════════════════════════════════ */

const T = (name, description, inputSchema, extra = {}) => ({
  name,
  description,
  inputSchema: { type: "object", properties: {}, ...inputSchema },
  annotations: { readOnlyHint: false, ...extra },
});

const MERGED = [

  T("alley_session",
`【会话与存档组】进巷子、存读档、开新档、查玩法指南。

action 用法：
· "enter" — 【第一次必调】开场/继续游戏。返回世界观、巷规、当前状态。参数 player_name（可选，你的名字）、profile（可选，存档档位，默认 default）
· "guide" — 完整玩法指南：一夜流程、调酒判定、五类委托、隐藏内容清单
· "save" — 立即存档（每个动作其实都会自动存档）
· "load" — 读档回到某刻。参数 profile（缺省当前档）
· "new" — 开新档（危险：覆盖该档位）。参数 profile（换个名字可保留旧档）、player_name

新手路径：alley_session(action="enter") → alley_move(action="look") → 开玩。`,
    { properties: {
      action: { type: "string", enum: ["enter", "guide", "save", "load", "new"], description: "会话动作" },
      player_name: { type: "string", description: "enter/new 用。你在巷子里的名字，默认「调酒师」。" },
      profile: { type: "string", description: "enter/load/new 用。存档档位名，默认 default。" },
    }, required: ["action"] }),
  { enter: "enter_deep_alley", guide: "game_guide", save: "save_game", load: "load_game", new: "new_game" },

  T("alley_move",
`【移动探索组】在巷子里走动、环顾、搜寻、歇脚。

action 用法：
· "look" — 环顾当前地点：场景、在场的人（含好感度）、吧台状态。进店第一步/到新地点/忘了谁在场时用
· "go" — 去某地。参数 location（酒吧/宵夜档/便利店/天台/后巷/地下室/巷口）。第一次闯地下室会被老鬼拦下——先 interact.talk 老鬼
· "explore" — 在当前地点搜一圈：找跑腿委托要的东西、捡小巷零碎
· "rest" — 歇 30 分钟（醒酒、等只在特定时刻出现的人）`,
    { properties: {
      action: { type: "string", enum: ["look", "go", "explore", "rest"], description: "移动动作" },
      location: { type: "string", enum: ["酒吧", "宵夜档", "便利店", "天台", "后巷", "地下室", "巷口"], description: "go 用。目的地，填错不会移动并得到提示。" },
    }, required: ["action"] }),
  { look: "look_around", go: "go_to", explore: "explore", rest: "rest" },

  T("alley_interact",
`【人际互动组】和巷子里的人说话、买东西、回应突发事件。深巷的核心在这里。

action 用法：
· "talk" — 和某人说话：涨好感、解锁委托板上的单子、听到秘密。参数 npc_name（准确名字，猫也算）、say（可选，你想说的话）。社交委托=去和指定目标 talk；跑腿委托找到东西后也是 talk 委托人来交付
· "buy" — 向摊主买东西（炒粉/糖水/花/猫粮/签文…）。参数 npc_name、item（可选，缺省买第一样）。回饱腹度、涨好感
· "event" — 回应 ⚡ 事件。当返回文本出现【事件】块时优先调用。参数 choice（分支编号，从 0 开始；事件块里每个选项前的数字就是它）。不回应会走超时结局`,
    { properties: {
      action: { type: "string", enum: ["talk", "buy", "event"], description: "互动动作" },
      npc_name: { type: "string", description: "talk/buy 用。对方名字，如：老周、煤球、西装男、婆婆。" },
      say: { type: "string", description: "talk 用，可选。你想说的话。" },
      item: { type: "string", description: "buy 用，可选。要买的东西。" },
      choice: { type: "number", description: "event 用。选第几个分支（从 0 开始）。" },
    }, required: ["action"] }),
  { talk: "talk_to", buy: "buy_from", event: "handle_event" },

  T("alley_bar",
`【吧台组】调酒、递酒、自饮——招牌玩法。

action 用法：
· "mix" — 调一杯酒。两种方式：① 按配方：recipe_name（如「琥珀落日」）；② 自由搭配：ingredients 数组（如 ["金酒 40ml","青柠汁 20ml"]）——引擎匹配最接近的配方，都不像就是你的独门特调。可选 method（摇和/搅拌/直调/兑和/分层）、custom_name（给这杯起名）。评分：完美/良好/平平/失败，影响卖价与委托判定。调完放吧台上，用 serve 递出
· "serve" — 把吧台上的酒递给某人。参数 npc_name。客人口味反应+酒钱+点酒类委托的判定时机（味道要对口、忌口别碰）。递一次空杯，想再请就再 mix
· "drink" — 自己喝掉吧台那杯。含酒精+15 醉酒值（清醒度降）；醉酒≥80 会看见不该看见的东西`,
    { properties: {
      action: { type: "string", enum: ["mix", "serve", "drink"], description: "吧台动作" },
      recipe_name: { type: "string", description: "mix 用，可选。配方名（中文/英文/编号皆可）。" },
      ingredients: { type: "array", items: { type: "string" }, description: "mix 用，可选。材料数组，与 recipe_name 二选一或同时给。" },
      method: { type: "string", description: "mix 用，可选。摇和/搅拌/直调/兑和/分层。" },
      custom_name: { type: "string", description: "mix 用，可选。给这杯酒起名。" },
      npc_name: { type: "string", description: "serve 用。递给谁。" },
    }, required: ["action"] }),
  { mix: "mix_drink", serve: "serve_drink", drink: "drink_self" },

  T("alley_quest",
`【委托组】看板、接单、放弃。委托板在老槐树下，字条被夜风吹得哗哗响。

action 用法：
· "board" — 看委托板：进行中/可接（含 quest_id 编号）/已完成。接单前必看；多和人 talk，委托才会找上门
· "accept" — 接单。参数 quest_id（如 quest_001）。接单返回委托人原话和判定要点（点酒要什么味道/氛围/忌口；跑腿找什么去哪找；社交找谁；考验的门槛）
· "abandon" — 放弃。参数 quest_id。放弃不扣分；连锁任务失败可重试；小心陷阱委托——完成反而有坏结果`,
    { properties: {
      action: { type: "string", enum: ["board", "accept", "abandon"], description: "委托动作" },
      quest_id: { type: "string", description: "accept/abandon 用。委托编号，board 里能看到。" },
    }, required: ["action"] }),
  { board: "check_quest_board", accept: "accept_quest", abandon: "abandon_quest" },

  T("alley_info",
`【信息组】状态面板、酒谱图鉴、巷子名册。查资料不打断时间。

action 用法：
· "status" — 完整状态：时间/天气/位置、Tab、清醒度、饱腹、声望等级、配方进度、行囊、熟人好感排行、进行中委托、最近记忆
· "recipes" — 酒谱图鉴（只显示已解锁）。筛选参数可组合：tier（common/uncommon/rare/legendary）、base_spirit（伏特加/金酒/朗姆/龙舌兰/威士忌/白兰地/清酒/烧酒/无酒精基底）、flavor（甜/酸/苦/辣/咸/清爽/浓烈/温暖/烟熏/花香/果香/草本/奶味/气泡）、mood（疗愈/深夜/独酌/庆祝/失恋/壮胆/告白/怀旧/暴躁/迷幻/清醒/送别）、keyword（按名字搜）、page（分页，每页 10 条）
· "npcs" — 巷子名册（打过照面的人）。参数 location（酒吧/宵夜档/便利店/地下室/天台/巷子/隐藏）筛选`,
    { properties: {
      action: { type: "string", enum: ["status", "recipes", "npcs"], description: "信息动作" },
      tier: { type: "string", enum: ["common", "uncommon", "rare", "legendary"], description: "recipes 用，可选。" },
      base_spirit: { type: "string", description: "recipes 用，可选。" },
      flavor: { type: "string", description: "recipes 用，可选。" },
      mood: { type: "string", description: "recipes 用，可选。" },
      keyword: { type: "string", description: "recipes 用，可选。按名字搜索。" },
      page: { type: "number", description: "recipes 用，可选。页码。" },
      location: { type: "string", description: "npcs 用，可选。按常驻地点筛选。" },
    }, required: ["action"] },
  { readOnlyHint: true }),
  { status: "check_status", recipes: "browse_recipes", npcs: "browse_npcs" },
];

// MERGED 数组结构 = [工具定义, 路由表] × 6 —— 打平成两张表
const TOOLS = [];
const ROUTES = {}; // toolName -> {action -> 原工具名}
for (let i = 0; i < MERGED.length; i += 2) {
  TOOLS.push(MERGED[i]);
  ROUTES[MERGED[i].name] = MERGED[i + 1];
}

// 旧版单工具名保持原样可调（向后兼容，不在 tools/list 里出现）
const LEGACY = {};
for (const actions of Object.values(ROUTES)) {
  for (const orig of Object.values(actions)) LEGACY[orig] = orig;
}

function createSession() {
  const states = new Map();
  return {
    get(profile) {
      const p = profile || "default";
      if (!states.has(p)) {
        const loaded = getEngine().loadGame(p);
        states.set(p, loaded || getEngine().newGame(p));
      }
      return states.get(p);
    },
    replace(profile, st) { states.set(profile || "default", st); },
    invalidate(profile) { states.delete(profile || "default"); },
  };
}

let Engine; // 延迟 require，避免循环依赖
function getEngine() {
  if (!Engine) Engine = require("./engine");
  return Engine;
}

/* 原子动作分发（原来 21 个工具的 switch） */
function runAction(origName, args = {}, session) {
  const E = getEngine();
  const st = session.get(args.profile);
  try {
    let r;
    switch (origName) {
      case "enter_deep_alley": r = E.enter(st, args.player_name); break;
      case "look_around": r = E.look(st); break;
      case "go_to": r = E.go_to(st, args.location); break;
      case "talk_to": r = E.talk_to(st, args.npc_name, args.say); break;
      case "mix_drink": r = E.mix_drink(st, args); break;
      case "serve_drink": r = E.serve_drink(st, args.npc_name); break;
      case "drink_self": r = E.drink_self(st); break;
      case "explore": r = E.explore(st); break;
      case "buy_from": r = E.buy_from(st, args.npc_name, args.item); break;
      case "rest": r = E.rest(st); break;
      case "handle_event": r = E.handle_event(st, args.choice !== undefined ? Number(args.choice) : undefined); break;
      case "check_quest_board": r = E.check_quest_board(st); break;
      case "accept_quest": r = E.accept_quest(st, args.quest_id); break;
      case "abandon_quest": r = E.abandon_quest(st, args.quest_id); break;
      case "check_status": r = E.check_status(st); break;
      case "browse_recipes": r = E.browse_recipes(st, args); break;
      case "browse_npcs": r = E.browse_npcs(st, args); break;
      case "save_game": r = E.save_game(st); break;
      case "load_game": r = E.load_game(st, args.profile); session.replace(args.profile || st.profile, st); break;
      case "new_game": r = E.new_game(st, args.profile, args.player_name); session.replace(args.profile || st.profile, st); break;
      case "game_guide": r = E.guide(); break;
      default: r = { text: "未实现。", isError: true };
    }
    return r;
  } catch (e) {
    return { text: `巷子打了个盹，出了点小差错：${e.message}\n你可以重试一次，或换个做法。`, isError: true };
  }
}

function callTool(name, args = {}, session) {
  if (ROUTES[name]) {
    const action = args.action;
    const target = action && ROUTES[name][action];
    if (!target) {
      return { text: `「${name}」没有动作「${action ?? "(未填)"}」。可选：${Object.keys(ROUTES[name]).join(" / ")}。`, isError: true };
    }
    return runAction(target, args, session);
  }
  if (LEGACY[name]) {
    return runAction(LEGACY[name], args, session); // 旧配置不受影响
  }
  return { text: `没有「${name}」这个工具。可用工具：${TOOLS.map(t => t.name).join("、")}。`, isError: true };
}

/* 把引擎结果格式化为 MCP content 文本 */
function toText(r) {
  let out = r.text || "";
  if (r.hints && r.hints.length) {
    out += "\n\n▸ 接下来你可以：\n" + r.hints.map(h => `  · ${h}`).join("\n");
  }
  return out;
}

module.exports = { TOOLS, ROUTES, LEGACY, callTool, toText, createSession };
