/* ═══════════════════════════════════════════
   Deep Alley — MCP 工具定义与分发
   工具描述（提示词）按 AI 玩家的实际体验设计：
   · 说清楚"什么时候该用我"
   · 说清楚参数怎么填、填错会怎样
   · 返回值里永远带"接下来你可以"的提示
   ═══════════════════════════════════════════ */

const T = (name, description, inputSchema, extra = {}) => ({
  name,
  description,
  inputSchema: { type: "object", properties: {}, ...inputSchema },
  annotations: { readOnlyHint: false, ...extra },
});

const TOOLS = [

  T("enter_deep_alley",
`【先调用我】进入"深巷"——一条地图上搜不到的深夜小巷，你是巷尾酒吧的调酒师。
首次调用会开场：介绍世界观、巷规、今晚天气和你手里的状态；之后每次调用会汇报"昨晚到今天"的进度。
玩法的完整说明随时可用 game_guide 查看。你做的每个动作都会推进店内时间（21:00 开店 → 04:00 自动打烊换日）。
返回的文本末尾永远有「▸ 接下来你可以」——照着做即可推进剧情。`,
    { properties: {
      player_name: { type: "string", description: "可选。你在巷子里的名字，默认叫「调酒师」。" },
      profile: { type: "string", description: "可选。存档档位名，默认 default。想开新档再填，如 profile=\"小明的小号\"。" },
    } }),

  T("look_around",
`环顾当前地点：看到场景描述、在场的人（含好感度）、吧台状态。
什么时候用：进店第一步、到新地点、想确认"现在谁在"、不记得自己在哪。
隐藏人物不会轻易现身——雨夜的后巷、凌晨三点的酒吧、大醉之后的吧台正中，都可能有惊喜。`,
    { properties: {} }, { readOnlyHint: true }),

  T("go_to",
`在巷子里移动。可去：酒吧、宵夜档、便利店、天台、后巷、地下室、巷口。
什么时候用：想换场景、委托要求去某地（fetch/explore 类）、想找某个不在场的人（去 TA 常在的地方）。
注意：第一次闯地下室会被看门人老鬼拦下——先 talk_to 老鬼混个脸熟。`,
    { properties: {
      location: { type: "string", enum: ["酒吧", "宵夜档", "便利店", "天台", "后巷", "地下室", "巷口"], description: "目的地。填错地名不会移动，会得到提示。" },
    } }),

  T("talk_to",
`和某个人说话。这是深巷的核心玩法：聊天涨好感、解锁委托板上的委托、听到对方的心事和秘密。
参数 npc_name 要用准确的名字（look_around 或 browse_npcs 可查）。say 可选，填你想说的话，会影响叙事。
提示：帮人做 social 类委托 = 去和指定的目标 NPC talk_to；fetch 类委托找到东西后，也是 talk_to 委托人来交付。`,
    { properties: {
      npc_name: { type: "string", description: "对方的名字，如：老周、煤球（猫也算）、西装男、婆婆。" },
      say: { type: "string", description: "可选。你想说的话，一句话即可。" },
    } }),

  T("mix_drink",
`调一杯酒——招牌玩法。两种方式：
① 按配方：给 recipe_name（如「琥珀落日」）。材料默认齐全；自己给 ingredients 则按匹配度评分。
② 自由搭配：只给 ingredients 数组（如 ["金酒 40ml","青柠汁 20ml","薄荷 5片"]）。引擎会匹配最接近的已解锁配方；什么都不像就成了「无名特调」。
评分：完美(≥95%) / 良好 / 平平 / 失败。品质影响卖价与委托判定——drink_request 类委托要求味道(flavor)与氛围(mood)对口，忌口材料千万别放。
调好的酒会放在吧台上，接着用 serve_drink 递给某位客人。调酒会消耗配方成本（Tab）并推进约 18 分钟。
彩蛋：连续失败 3 次、在特定天气/时刻/醉酒度调酒，都可能顿悟隐藏配方。`,
    { properties: {
      recipe_name: { type: "string", description: "可选。配方名（中文/英文/编号皆可），如「琥珀落日」「深巷雾灯」。" },
      ingredients: { type: "array", items: { type: "string" }, description: "可选。材料数组，如 [\"威士忌 45ml\",\"蜂蜜糖浆 15ml\",\"柠檬汁 10ml\"]。与 recipe_name 二选一或同时给。" },
      method: { type: "string", description: "可选。做法：摇和/搅拌/直调/兑和/分层。与配方不符会扣分。" },
      custom_name: { type: "string", description: "可选。给这杯酒起个名字（自由搭配时尤其推荐）。" },
    } }),

  T("serve_drink",
`把吧台上调好的那杯递给某位客人。客人会按自己的口味评价（涨/掉好感），并支付酒钱。
这是 drink_request 委托的判定时机：递给委托人时，引擎按"味道对口+氛围对口+没碰忌口"判定成败。
什么时候用：mix_drink 之后。注意 serve 一次就空杯了，想连续请客要再调。`,
    { properties: {
      npc_name: { type: "string", description: "递给谁。用准确名字。" },
    } }),

  T("drink_self",
`自己喝掉吧台上那杯。含酒精的会+15 醉酒值（清醒度下降）；无酒精的几乎没影响。
什么时候用：想触发醉酒事件线、想"借酒壮胆"、或单纯想尝尝自己的手艺。
警告：醉酒值≥80 时你会看见不该看见的东西（比如吧台正中凭空多出的胖子）。`,
    { properties: {} }),

  T("explore",
`在当前地点细细搜一圈：找委托要的物品、捡小巷里的零碎、发现只属于这里的细节。
什么时候用：fetch 委托让你去某地找东西（先 go_to 再 explore）；explore 类委托到达指定地点后 explore 一次判定；纯粹想看看这条巷子藏了什么。`,
    { properties: {} }),

  T("buy_from",
`向摊主/商人买东西（吃宵夜、买花、买猫粮、抽签……）。会花钱、涨好感、部分食物回饱腹度。
卖家的货看 npc 的 sells 字段；browse_npcs 或 talk_to 里能看到。`,
    { properties: {
      npc_name: { type: "string", description: "卖家名字：老周/阿香/王婶/阿伟/花婶/半仙/老报/老笔。" },
      item: { type: "string", description: "可选。要买的东西；不给就买第一样。" },
    } }),

  T("rest",
`靠着吧台歇 30 分钟：醉酒值 -12，时间推进。
什么时候用：喝多了想醒醒酒；店里暂时没人；想等某个只在特定时刻出现的人（比如凌晨三点的"前任店主"）。`,
    { properties: {} }),

  T("handle_event",
`回应正在发生的事件。当返回文本里出现 ⚡【事件】块时，世界在等你表态——用 choice 选择一个分支（0 开始编号）。
每个分支的后果不同：钱、好感、记忆碎片、配方解锁、甚至连锁后续事件。不回应也行，会走"超时"结局（一般平庸，偶尔古怪）。`,
    { properties: {
      choice: { type: "number", description: "选第几个分支（从 0 开始）。事件块里每个选项前的数字就是它。" },
    } }),

  T("check_quest_board",
`看委托板：进行中的委托、可接的委托（含编号）、已完成/搞砸的数量。
什么时候用：接活之前、想知道委托进度、忘了某单要什么。
委托从哪来：和 NPC 混熟（talk_to）之后，TA 的委托会出现在板上；连锁委托做完一环才解锁下一环；「无人」的委托一开始就贴在板上。`,
    { properties: {} }, { readOnlyHint: true }),

  T("accept_quest",
`接下委托板上的一单。参数 quest_id 用编号（如 quest_001），check_quest_board 里能看到。
接单后会拿到委托人的原话和判定要点：调酒类的要什么味道/氛围/忌口；跑腿的要找什么、去哪找；社交的要找谁聊；挑战的门槛是什么。
进行中的委托可以在 abandon_quest 放弃。`,
    { properties: {
      quest_id: { type: "string", description: "委托编号，如 quest_003。" },
    } }),

  T("abandon_quest",
`放弃一单进行中的委托。有些委托有 fail_penalty（掉声望），放弃不算失败、不扣分。
什么时候用：发现委托与自己良心冲突（真的会有这种委托）、或者实在找不到物品想止损。`,
    { properties: {
      quest_id: { type: "string", description: "委托编号。" },
    } }),

  T("check_status",
`看你的完整状态面板：时间/天气/位置、Tab 余额、清醒度、饱腹、声望与等级、配方解锁进度、行囊、熟人好感排行、进行中的委托、最近的记忆碎片。
什么时候用：任何时候想不起来"我是谁我在哪我该干嘛"。`,
    { properties: {} }, { readOnlyHint: true }),

  T("browse_recipes",
`翻酒谱图鉴（只显示已解锁的）。支持筛选与分页，每页 10 条。
什么时候用：调酒前找灵感、看某杯酒的完整档案（材料/做法/杯型/故事）、想算还有多少杯没解锁。
筛选参数可以组合，例如 tier=legendary、flavor=烟熏、mood=失恋、keyword=雨。`,
    { properties: {
      tier: { type: "string", enum: ["common", "uncommon", "rare", "legendary"], description: "可选。稀有度筛选。" },
      base_spirit: { type: "string", description: "可选。基酒筛选：伏特加/金酒/朗姆/龙舌兰/威士忌/白兰地/清酒/烧酒/无酒精基底。" },
      flavor: { type: "string", description: "可选。味道筛选：甜/酸/苦/辣/咸/清爽/浓烈/温暖/烟熏/花香/果香/草本/奶味/气泡。" },
      mood: { type: "string", description: "可选。氛围筛选：疗愈/深夜/独酌/庆祝/失恋/壮胆/告白/怀旧/暴躁/迷幻/清醒/送别。" },
      keyword: { type: "string", description: "可选。按名字搜索（中英文都行）。" },
      page: { type: "number", description: "可选。页码，默认 1。" },
    } }, { readOnlyHint: true }),

  T("browse_npcs",
`翻巷子名册：打过照面的人的名字、身份、位置、好感度、说话风格。
什么时候用：忘了某个人是谁、想找某个商人、想看还剩多少面孔没见过（隐藏人物会以"没见过"的形式计数——去对的地方、对的时机找）。`,
    { properties: {
      location: { type: "string", description: "可选。按常驻地点筛选：酒吧/宵夜档/便利店/地下室/天台/巷子/隐藏。" },
    } }, { readOnlyHint: true }),

  T("save_game",
`立即存档。其实每个动作后都会自动存档，这个工具用于"此刻必须有仪式感"的时刻（比如完成连锁委托、调出传说配方之后）。`,
    { properties: {} }),

  T("load_game",
`读档：把指定档位的状态读回来。参数 profile 缺省读当前档。
什么时候用：手滑搞砸了重要委托（存档还在）、或者想看看"另一个档位的自己"。`,
    { properties: {
      profile: { type: "string", description: "可选。档位名，缺省当前档。" },
    } }),

  T("new_game",
`开新档：抹掉当前档位，回到第 1 夜的 21:05。
危险操作：旧档会被覆盖，且没有后悔药。参数 profile 可以换个新档位名来保留旧档。`,
    { properties: {
      profile: { type: "string", description: "可选。新档档位名；不填则覆盖当前档。" },
      player_name: { type: "string", description: "可选。新的名字。" },
    } }, { destructiveHint: true }),

  T("game_guide",
`完整的玩法指南：一夜的流程、调酒与配方解锁机制、五类委托的完成方式、事件系统、状态与等级、隐藏内容清单（15 杯隐藏配方、4 位隐藏 NPC、传说配方「巷子的名字」）。
什么时候用：第一次玩、不确定某条机制、或者玩家问你怎么玩。`,
    { properties: {} }, { readOnlyHint: true }),
];

const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

let Engine; // 延迟 require，避免循环依赖
function getEngine() {
  if (!Engine) Engine = require("./engine");
  return Engine;
}

/* ── 分发：把 MCP 调用翻译成引擎动作 ── */
function createSession() {
  // profile -> state（内存缓存，引擎在每个动作后自动落盘）
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

function callTool(name, args = {}, session) {
  const E = getEngine();
  if (!TOOL_NAMES.has(name)) {
    return { text: `没有「${name}」这个工具。可用工具用 tools/list 查看。`, isError: true };
  }
  const st = session.get(args.profile);
  try {
    let r;
    switch (name) {
      case "enter_deep_alley": r = Engine.enter(st, args.player_name); break;
      case "look_around": r = Engine.look(st); break;
      case "go_to": r = Engine.go_to(st, args.location); break;
      case "talk_to": r = Engine.talk_to(st, args.npc_name, args.say); break;
      case "mix_drink": r = Engine.mix_drink(st, args); break;
      case "serve_drink": r = Engine.serve_drink(st, args.npc_name); break;
      case "drink_self": r = Engine.drink_self(st); break;
      case "explore": r = Engine.explore(st); break;
      case "buy_from": r = Engine.buy_from(st, args.npc_name, args.item); break;
      case "rest": r = Engine.rest(st); break;
      case "handle_event": r = Engine.handle_event(st, args.choice !== undefined ? Number(args.choice) : undefined); break;
      case "check_quest_board": r = Engine.check_quest_board(st); break;
      case "accept_quest": r = Engine.accept_quest(st, args.quest_id); break;
      case "abandon_quest": r = Engine.abandon_quest(st, args.quest_id); break;
      case "check_status": r = Engine.check_status(st); break;
      case "browse_recipes": r = Engine.browse_recipes(st, args); break;
      case "browse_npcs": r = Engine.browse_npcs(st, args); break;
      case "save_game": r = Engine.save_game(st); break;
      case "load_game": r = Engine.load_game(st, args.profile); session.replace(args.profile || st.profile, st); break;
      case "new_game": r = Engine.new_game(st, args.profile, args.player_name); session.replace(args.profile || st.profile, st); break;
      case "game_guide": r = Engine.guide(); break;
      default: r = { text: "未实现。" };
    }
    return r;
  } catch (e) {
    return { text: `巷子打了个盹，出了点小差错：${e.message}\n你可以重试一次，或换个做法。`, isError: true };
  }
}

/* 把引擎结果格式化为 MCP content 文本 */
function toText(r) {
  let out = r.text || "";
  if (r.hints && r.hints.length) {
    out += "\n\n▸ 接下来你可以：\n" + r.hints.map(h => `  · ${h}`).join("\n");
  }
  return out;
}

module.exports = { TOOLS, callTool, toText, createSession };
