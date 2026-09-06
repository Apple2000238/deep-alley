# 🏮 深巷 Deep Alley

**一家开在 MCP 里的深夜酒吧。** 一条地图上搜不到的小巷：尽头是你的酒吧，中间是老周的宵夜档和阿伟的便利店，楼上有人唱歌，楼下有人打拳，巷子里还有两只猫。

AI 玩家（Claude / GPT / 任何支持 MCP 的客户端）通过 MCP 工具**真的住进这条巷子**：调酒、经营、认识 50 位邻居、接 80 张委托字条、经历 100 件巷闻。网页是同一家店的门面——人类玩家打开浏览器，看到的是 AI 调酒师正在经营的同一个世界、同一份存档。

## 内容规模

| 内容 | 数量 | 说明 |
|---|---|---|
| 🥃 酒谱 | 100 杯 | 常见40/少见30/稀有20/传说10，其中 **15 杯隐藏配方**（要特定天气、时刻、醉酒度、失败次数甚至剧情才能顿悟） |
| 🧑 邻居 | 50 位 | 酒吧15/宵夜档8/地下室8/天台5/游荡10/**隐藏4**（雨夜的蓑衣人、凌晨三点的前任店主、醉眼里的酒仙、台风夜的远客），含双胞胎姐弟、债主与拳手、前恋人等关系网 |
| 📋 委托 | 80 条 | 点酒30/跑腿15/社交15/探索10/考验10，**8 条连锁任务线**、5 张「无人」字条、3 个陷阱委托 |
| ⚡ 事件 | 100 件 | 随机40/天气15/时刻15/醉酒10/好感10/**连锁10**，含停电、深夜市集、台风登陆等 5 件巷子级大事件 |

另有：昼夜循环（21:00 开店 → 04:00 打烊）、**夜的四个时段**（入夜/深夜/凌晨/将明，NPC 分时段出没，各有动作节奏）、天气系统、Tab 经济、清醒度/饱腹、声望九级（LV1 新客 → LV9 巷子传说）、记忆碎片收集、传说配方「巷子的名字」（调遍 99 杯才解锁）。

## 可玩度系统（v2）

- **情绪色谱**：每杯酒有 `warmth / weight / nostalgia` 三维情绪值。递酒时 NPC 会顺着情绪说话——暖而怀旧的酒让人想起以前，锐利轻盈的酒让人说「够劲」。
- **情绪偏好**：50 位 NPC 各有 `emotion_preference`（对什么情绪的酒有特殊反应），命中触发专属台词和额外好感。
- **对话分层**：每人 20 句分层台词（stranger 0-2 / familiar 3-5 / close 6-8 / trust 9-10）——同一个人，好感不同，说的话完全不同；trust 层是只有你能听的心事。
- **自创酒被世界记住**：自由搭配的特调可以命名，进私房酒单；被 3 位 NPC 喝过会成为「巷子口碑」，NPC 会主动来点「老样子」。
- **关系网 gossip**：35 对 NPC 关系。你给某人递酒，TA 的前恋人会在角落看一眼；在 A 面前说漏 B 的秘密，B 的好感会掉——巷子传话很快。
- **缺席后果**：你几天不来，好感会淡、煤球会瘦、委托会过期。回来时有人跟你说「还以为你不干了」。
- **将明独处**：凌晨三点后是「将明」时段——可以 `alley_interact(action="talk", npc_name="自己")`，回顾今晚的记忆碎片。
- **碎片暗线**：17 组记忆碎片之间有关联，凑齐会浮现新的碎片——最终拼出一条暗线：*你也不记得自己是怎么来到这条巷子的。你和煤球，也许是同一种来法。*

---

## 快速开始

零依赖，只要 Node ≥ 18。

```bash
git clone https://github.com/Apple2000238/deep-alley.git
cd deep-alley
npm start          # HTTP 模式：网页 + REST + MCP over HTTP，默认端口 8899
```

打开 `http://localhost:8899/` —— 网页与 MCP 共享 `data/saves/default.json` 这一份存档。

### 把 AI 调酒师放进巷子（MCP 配置）

**方式一：stdio（Claude Desktop / Cursor / Cherry Studio / Cline 等）**

```json
{
  "mcpServers": {
    "deep-alley": {
      "command": "node",
      "args": ["/绝对路径/deep-alley/server.js"]
    }
  }
}
```

> 想让 AI 用独立存档：在 `args` 里加 `"--profile", "ai-1"`，或设环境变量 `DEEP_ALLEY_PROFILE`。

**方式二：HTTP 远程连接（服务器已常驻时）**

| 前端里的类型 | 填的 URL |
|---|---|
| Streamable HTTP（新协议，推荐） | `http://你的服务器:8899/mcp` |
| SSE（旧协议，很多前端单独提供这个类型） | `http://你的服务器:8899/sse` |

> 注意 URL 要带 `http://` 前缀。两种传输都已用官方 MCP SDK 实测通过；浏览器类前端（如网页版 MCP 客户端）需要的 CORS 细节（OPTIONS 预检、`Mcp-Session-Id` 暴露头）也已处理。

配置好后，对 AI 说一句「**去深巷开一晚酒吧**」即可。AI 会先调 `enter_deep_alley` 开场，然后按每个工具返回的「▸ 接下来你可以」自主推进。

---

## MCP 工具（6 个动作域，action 路由）

| 工具 | action | 说明 |
|---|---|---|
| `alley_session` | enter / guide / save / load / new | **先调 `action:"enter"` 开场**；玩法指南、存读档、开新档 |
| `alley_move` | look / go / explore / rest | 环顾（在场的人+好感度）、移动（酒吧/宵夜档/便利店/天台/后巷/地下室/巷口）、搜寻、歇脚 |
| `alley_interact` | talk / buy / event | 聊天（涨好感/解锁委托/听秘密）、买卖、回应 ⚡ 事件（choice=分支号） |
| `alley_bar` | mix / serve / drink | 调酒（recipe_name 或自由搭配 ingredients）、递酒（口味+酒钱+委托判定）、自饮（醉酒度） |
| `alley_quest` | board / accept / abandon | 委托板、接单（返回判定要点）、放弃 |
| `alley_info` | status / recipes / npcs | 状态面板、酒谱图鉴（tier/基底/味道/氛围/关键词筛选+分页）、巷子名册 |

每个 action 的参数与提示词都写明「什么时候用、参数怎么填、错了会怎样」，返回文本永远带「▸ 接下来你可以」——**为 AI 玩家的体验专门设计**。v1 的 21 个单工具名（`mix_drink` 等）仍可调用，老配置不受影响，但不再出现在 tools/list 里。

## 玩法循环

```
21:00 开店 → look_around 看谁来了 → talk_to 混脸熟（委托上板）
→ accept_quest 接单 → mix_drink 调酒（味道/氛围/忌口要对口）
→ serve_drink 递出去（收钱+判定）→ handle_event 接住巷子抛来的事件
→ 04:00 自动打烊换日（天气重掷、酒醒、新的一天）
```

五类委托的完成方式：**点酒**（按要求调酒递给委托人）、**跑腿**（去指定地点 explore 找东西，talk_to 交付）、**社交**（去和指定的人 talk_to）、**探索**（去指定地点 explore）、**考验**（按门槛完成调酒挑战）。连锁任务失败可重试；小心陷阱委托——完成反而有坏结果。

## 架构

```
deep-alley/
├── server.js            入口：默认 stdio MCP；--http 时 = MCP HTTP + 网页静态 + REST
├── server/
│   ├── engine.js        游戏引擎（纯逻辑：时间/天气/调酒判定/委托/事件/好感/存档）
│   ├── tools.js         MCP 工具定义（提示词）与分发
│   └── mcp.js           JSON-RPC 2.0 协议层（stdio 与 Streamable HTTP 复用）
├── app.js               网页逻辑（同一世界模式 / 图鉴降级模式）
├── index.html … archive.html   7 个页面
├── styles.css           潮汐岛系设计语言（暖沙底 · 青灰渐变 · 衬线标题）
├── data/
│   ├── recipes.json / npcs.json / quests.json / events.json
│   └── saves/           存档（每档一个 JSON，自动落盘）
└── test/smoke.js        冒烟测试（npm test）
```

- **同一个世界**：HTTP 模式下，网页与所有 MCP 客户端共享同一段内存状态与存档文件；AI 调的酒实时出现在网页的巷志里。
- **图鉴降级**：服务器不在线时，网页自动切换为纯图鉴模式（数据本地可读，游玩入口提示启动命令）。
- **零依赖**：没有 npm 依赖，MCP 协议（stdio + Streamable HTTP）手写实现。

## REST API（网页用）

| 端点 | 说明 |
|---|---|
| `GET /api/state` | 当前世界状态快照 |
| `POST /api/action` | `{action, ...}` 执行动作：look/go/talk/mix/serve/drink_self/explore/rest/event/board/accept/abandon/buy |
| `GET /api/data/:name` | recipes / npcs / quests / events 原始数据 |
| `GET /healthz` | 健康检查 |
| `POST /mcp` | MCP Streamable HTTP 端点 |

## 测试

```bash
npm test   # 引擎全流程 + stdio 握手 + HTTP 模式，25 项断言
```

## 设计说明

- 网页设计语言为「潮汐岛」系：暖沙底 `#f5f1eb`、青灰渐变 Hero、白底圆角卡片、衬线标题（Noto Serif SC）+ 无衬线标签（Inter），移动端响应式。
- 酒谱、NPC、委托、事件全部内容为原创中文文案——名字有意境，对话像微型小说，避免现实经典鸡尾酒名。
- 彩蛋：传说配方「潮汐岛」要等台风夜才会想起方子——那是隔壁街那家老店的招牌。

---

深巷 · Deep Alley — 雨后的巷子总有一盏灯亮着。🏮
