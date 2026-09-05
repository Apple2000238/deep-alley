/* ═══════════════════════════════════════════
   Deep Alley — 网页端逻辑 app.js
   两种模式：
   · world  — 连上游戏服务器（/api），与 AI 玩家共用同一份存档
   · local  — 服务器不在线，降级为纯图鉴浏览（酒谱/NPC/委托/事件可检索）
   ═══════════════════════════════════════════ */
"use strict";

const DA = {
  mode: "local",
  state: null,          // world 模式下的实时状态
  data: { recipes: [], npcs: [], quests: [], events: [] },
  lastAction: "",

  async fetchJSON(url, opts, timeoutMs = 4000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  },

  async boot() {
    this.markNav();
    // 模式探测
    try {
      const r = await this.fetchJSON("/api/state", {}, 1800);
      if (r && r.ok && r.state) { this.mode = "world"; this.state = r.state; }
    } catch { /* 降级 */ }
    // 数据加载
    const base = this.mode === "world" ? "/api/data/" : "data/";
    for (const k of ["recipes", "npcs", "quests", "events"]) {
      try { this.data[k] = await (await fetch(base + k + ".json")).json(); }
      catch { this.data[k] = []; }
    }
    this.renderSidebar();
    this.renderModeBadge();
    const page = document.body.dataset.page;
    const fn = this["page_" + page];
    if (fn) await fn.call(this);
    if (this.mode === "world") {
      setInterval(() => this.refresh(), 10000);
    }
  },

  async refresh() {
    if (this.mode !== "world") return;
    try {
      const r = await this.fetchJSON("/api/state", {}, 2500);
      if (r && r.ok) {
        const oldEvent = this.state && this.state.pendingEvent;
        this.state = r.state;
        this.renderSidebar();
        if (r.state.pendingEvent && !oldEvent) {
          toast("⚡ 巷子里发生了新事件——去回应它");
        }
        const page = document.body.dataset.page;
        const fn = this["page_" + page];
        if (fn && ["index", "bar", "alley", "quests", "archive"].includes(page)) await fn.call(this);
      }
    } catch { /* 忽略轮询失败 */ }
  },

  async action(payload) {
    if (this.mode !== "world") { toast("未连接游戏服务器（图鉴模式）——运行 node server.js --http 后即可在网页上玩"); return null; }
    try {
      const r = await this.fetchJSON("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, 8000);
      if (!r.ok) { toast("出了点差错：" + (r.error || "?")); return null; }
      this.lastAction = r.text;
      if (r.state) this.state = r.state;
      this.renderSidebar();
      const panel = document.getElementById("narrative");
      if (panel) { panel.textContent = r.text; panel.scrollTop = 0; }
      if (r.event) toast("⚡ 事件等待回应");
      return r;
    } catch (e) {
      toast("连不上服务器：" + e.message);
      return null;
    }
  },

  /* ── 渲染 ── */
  renderModeBadge() {
    const el = document.getElementById("mode-badge");
    if (!el) return;
    el.className = "mode-badge " + (this.mode === "world" ? "world" : "local");
    el.innerHTML = this.mode === "world"
      ? "● 同一个世界 · 已连接游戏服务器"
      : "○ 图鉴模式 · 服务器未启动";
  },

  markNav() {
    const page = document.body.dataset.page;
    document.querySelectorAll(".nav-link[data-nav]").forEach(a => {
      if (a.dataset.nav === page) a.classList.add("active");
    });
  },

  renderSidebar() {
    const el = document.getElementById("sidebar");
    if (!el) return;
    const s = this.state;
    if (!s) {
      el.innerHTML = `
        <div class="sidebar-card profile-card">
          <div class="profile-avatar">巷</div>
          <div class="profile-info"><strong>深巷</strong><span>图鉴模式</span></div>
        </div>
        <div class="sidebar-card">
          <p class="label-sm">SERVER</p>
          <h3 class="sidebar-title">服务器未连接</h3>
          <p class="sidebar-text">图鉴可以随便逛。想真的开店，在项目目录跑：<br><code>node server.js --http</code></p>
        </div>`;
      return;
    }
    const inv = (s.inventory || []).map(i => `<span class="tote-item">${i.name}${i.qty && i.qty > 1 ? " ×" + i.qty : ""}</span>`).join("") || `<span class="tote-item">空的</span>`;
    const acc = ((s.quests && s.quests.accepted) || []).map(q => q ? `<div class="menu-item"><div><strong>${q.title}</strong><p class="menu-desc">${q.giver} · ${q.type}</p></div></div>` : "").join("") || `<p class="sidebar-text">暂无进行中的委托。</p>`;
    const rels = Object.entries(s.relationships || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, v]) => `<div class="neighbor-item"><span class="neighbor-dot ${v > 3 ? "online" : "away"}"></span><div><strong>${k}</strong><span class="neighbor-status">好感 ${v}/10</span></div></div>`).join("")
      || `<div class="neighbor-item"><span class="neighbor-dot away"></span><div><strong>还没有熟人</strong><span class="neighbor-status">去 talk_to 认识他们</span></div></div>`;
    el.innerHTML = `
      <div class="sidebar-card profile-card">
        <div class="profile-avatar">${(s.day || 1) % 10}</div>
        <div class="profile-info"><strong>调酒师</strong><span>${s.level || ""} · 第 ${s.day} 夜</span></div>
      </div>
      <div class="sidebar-card">
        <p class="label-sm">AMBIENCE</p>
        <h3 class="sidebar-title">氛围</h3>
        <p class="sidebar-text">${s.weather || ""} · ${s.time || ""} · 你在${s.location || ""}</p>
        <p class="sidebar-sub">配方 ${s.recipesUnlocked}/${s.recipesTotal} · 记忆 ${(s.memories || []).length} 条</p>
      </div>
      <div class="sidebar-card">
        <p class="label-sm">TOTE</p>
        <h3 class="sidebar-title">行囊</h3>
        <div class="tote-grid">${inv}</div>
      </div>
      <div class="sidebar-card">
        <p class="label-sm">QUESTS</p>
        <h3 class="sidebar-title">进行中</h3>
        <div class="menu-list">${acc}</div>
        <a class="section-link small" href="quests.html">看委托板 →</a>
      </div>
      <div class="sidebar-card">
        <p class="label-sm">NEIGHBORS</p>
        <h3 class="sidebar-title">熟人</h3>
        <div class="neighbor-list">${rels}</div>
        <a class="section-link small" href="npcs.html">看全巷名册 →</a>
      </div>
      <div class="sidebar-card">
        <p class="label-sm">RULE</p>
        <h3 class="sidebar-title">巷规</h3>
        <p class="sidebar-text rule-text">不问来路。不劝酒。打翻的酒自己擦。天亮前必须走。</p>
      </div>`;
  },

  eventCardHTML(ev) {
    if (!ev) return "";
    return `<div class="event-card">
      <p class="label-sm">EVENT · ⚡</p>
      <h3 class="event-title">${ev.title}</h3>
      <p class="event-desc">${ev.description}</p>
      <div class="event-choices">
        ${ev.choices.map(c => `<button class="event-choice-btn" onclick="DA.chooseEvent(${c.index})">${c.index}. ${c.text}</button>`).join("")}
      </div>
      <p class="mixer-note" style="margin-top:10px">不做选择：${ev.timeout_hint || ""}</p>
    </div>`;
  },

  async chooseEvent(i) {
    const r = await this.action({ action: "event", choice: i });
    if (r) { await this["page_" + document.body.dataset.page]?.call(this); }
  },

  narrativeHTML() {
    return `<div class="narrative-panel" id="narrative">${this.lastAction ? "" : ""}</div>`;
  },

  /* ═══ 页面：主页 ═══ */
  async page_index() {
    const s = this.state;
    const hero = document.getElementById("hero");
    if (hero && s) {
      hero.innerHTML = `
        <div class="hero-bg"><div class="hero-lamp"></div></div>
        <div class="hero-content">
          <p class="label-sm light">DEEP ALLEY · NIGHT ${s.day} · ${s.weather}</p>
          <h2 class="hero-title">${weatherTitle(s.weather)}</h2>
          <p class="hero-desc">${weatherDesc(s.weather)} 现在是 ${s.time}，你在${s.location}。</p>
          <div class="stat-grid">
            <div class="stat-box"><span class="stat-label">氛围</span><span class="stat-value">${s.weather}</span></div>
            <div class="stat-box"><span class="stat-label">清醒度</span><span class="stat-value">${s.sobriety} / 100</span></div>
            <div class="stat-box"><span class="stat-label">Tab</span><span class="stat-value">${s.tab}</span></div>
            <div class="stat-box"><span class="stat-label">等级</span><span class="stat-value">${s.level}</span></div>
          </div>
          <p class="hero-notice">${s.pendingEvent ? "⚡ 有事件正在等你回应。" : "委托板在老槐树下。巷口的路灯还亮着。"}</p>
          <div class="hero-actions">
            <a class="btn-primary" href="bar.html" style="text-decoration:none">调一杯</a>
            <a class="btn-secondary" href="recipes.html" style="text-decoration:none">看酒单</a>
            <a class="btn-secondary" href="alley.html" style="text-decoration:none">逛巷子</a>
          </div>
        </div>`;
    } else if (hero) {
      hero.innerHTML = `
        <div class="hero-bg"><div class="hero-lamp"></div></div>
        <div class="hero-content">
          <p class="label-sm light">DEEP ALLEY</p>
          <h2 class="hero-title">雨后的巷子还亮着灯</h2>
          <p class="hero-desc">这里是深巷的内容图鉴：100 杯酒、50 张面孔、80 张委托字条、100 件巷闻。想真的开店——在本机运行 <code>node server.js --http</code>，或用 MCP 把 AI 调酒师放进巷子里。</p>
          <div class="hero-actions">
            <a class="btn-primary" href="recipes.html" style="text-decoration:none">看酒谱</a>
            <a class="btn-secondary" href="npcs.html" style="text-decoration:none">看名册</a>
          </div>
        </div>`;
    }
    // 今晚发生的事
    const tl = document.getElementById("timeline");
    if (tl) {
      const logs = s ? (s.eventLog || []).slice(0, 8) : this.data.events.slice(0, 5).map(e => ({ time: "巷闻", text: `【${e.title}】${e.description}` }));
      tl.innerHTML = logs.map(l => `<div class="timeline-item"><span class="timeline-time">${l.time || ""}</span><p class="timeline-text">${l.text || ""}</p></div>`).join("") || `<div class="empty-hint">还没有故事。第一杯酒调下去，就有了。</div>`;
    }
    // 记忆/故事
    const stories = document.getElementById("stories");
    if (stories) {
      const mems = s ? (s.memories || []).slice(-6).reverse() : [];
      stories.innerHTML = mems.length
        ? mems.map(m => `<div class="story-card"><div class="story-header"><span class="story-type">记忆碎片</span></div><h3 class="story-title">「${m}」</h3><p class="story-desc">被这一夜留下的，都算数。</p></div>`).join("")
        : `<div class="empty-hint">${s ? "还没有记忆碎片。它们会在聊天、调酒和事件的缝隙里出现。" : "连接服务器后，AI 调酒师攒下的记忆会出现在这里。"}</div>`;
    }
  },

  /* ═══ 页面：吧台 ═══ */
  async page_bar() {
    const s = this.state;
    const mixerBox = document.getElementById("mixer");
    if (!mixerBox) return;
    if (!s) {
      mixerBox.innerHTML = `<div class="empty-hint">图鉴模式下调不了酒——去 <a href="recipes.html">酒谱图鉴</a> 逛逛吧。</div>`;
      document.getElementById("bar-event").innerHTML = "";
      return;
    }
    const opts = this.data.recipes.map(r => `<option value="${r.name}">${r.emoji || ""} ${r.name}（${r.tier}）</option>`).join("");
    const npcsHere = this.npcsAt(s.location);
    mixerBox.innerHTML = `
      <p class="label-sm">MIXER</p>
      <h3 class="section-title">调一杯</h3>
      <div class="mixer-row">
        <select id="mix-recipe"><option value="">—— 选一杯酒谱 ——</option>${opts}</select>
      </div>
      <div class="mixer-row">
        <input type="text" id="mix-name" placeholder="或者给自由搭配起个名字（可选）">
      </div>
      <div class="mixer-ingredients" id="mix-ings">
        <div class="mixer-ingredient-row"><input type="text" placeholder="材料，如：金酒 40ml"></div>
      </div>
      <div class="mixer-row">
        <button class="btn-sm" onclick="DA.addIngRow()">+ 一味材料</button>
        <button class="btn-sm-ghost" onclick="DA.doMix()">🥃 摇！</button>
        <button class="btn-sm-ghost" onclick="DA.doSelf()">自己喝一口</button>
        <span class="mixer-note">填了酒谱按酒谱调；只填材料则自由发挥（不像任何配方就是特调）。</span>
      </div>
      <div style="margin-top:20px">
        <p class="label-sm">SERVE</p>
        <h3 class="section-title">递给谁？</h3>
        <div class="mixer-row">
          ${npcsHere.length ? npcsHere.map(n => `<button class="btn-sm-ghost" onclick="DA.doServe('${n.name}')">${n.emoji || ""} ${n.name}</button>`).join("") : `<span class="mixer-note">这里没人——去 <a href="alley.html">巷子</a> 逛逛。</span>`}
        </div>
      </div>`;
    document.getElementById("bar-event").innerHTML = this.eventCardHTML(s.pendingEvent);
  },

  addIngRow() {
    const box = document.getElementById("mix-ings");
    if (!box) return;
    const row = document.createElement("div");
    row.className = "mixer-ingredient-row";
    row.innerHTML = `<input type="text" placeholder="材料，如：柠檬汁 10ml"><button class="btn-sm-ghost" onclick="this.parentNode.remove()">×</button>`;
    box.appendChild(row);
  },

  async doMix() {
    const recipe = document.getElementById("mix-recipe")?.value || "";
    const name = document.getElementById("mix-name")?.value || "";
    const ings = [...document.querySelectorAll("#mix-ings input")].map(i => i.value.trim()).filter(Boolean);
    const payload = ings.length ? { action: "mix", ingredients: ings, name: name || undefined } : { action: "mix", recipe, name: name || undefined };
    if (!recipe && !ings.length) { toast("先选酒谱，或至少填一味材料"); return; }
    await this.action(payload);
    await this.page_bar();
  },

  async doSelf() { await this.action({ action: "drink_self" }); await this.page_bar(); },
  async doServe(npc) { await this.action({ action: "serve", npc }); await this.page_bar(); },

  npcsAt(loc) {
    return this.data.npcs.filter(n => {
      if (n.location === "隐藏") {
        if (n.name === "蓑衣人") return this.state && this.state.weather === "大雨" && loc === "后巷";
        if (n.name === "无名") return this.state && loc === "酒吧" && this.state.time >= "03:00" && this.state.time <= "04:00";
        if (n.name === "酒仙") return this.state && this.state.sobriety <= 20 && loc === "酒吧";
        if (n.name === "远客") return this.state && this.state.weather === "台风" && loc === "酒吧";
        return false;
      }
      return n.location === loc;
    });
  },

  /* ═══ 页面：巷子 ═══ */
  async page_alley() {
    const s = this.state;
    const places = document.getElementById("places");
    if (places) {
      const locs = [
        ["酒吧", "TONIGHT", "调酒、点单、跟调酒师聊天。"],
        ["宵夜档", "LATE NIGHT", "老周的炒粉。坐下来吃点东西。"],
        ["便利店", "24H", "阿伟的店。白光、关东煮和突然的清醒。"],
        ["天台", "UPSTAIRS", "今晚有驻唱。也可以只是坐着。"],
        ["地下室", "DOWNSTAIRS", "赌桌、拳台、不问来路的人。"],
        ["后巷", "ALLEY", "捡东西、遇见人、或者什么都不做。"],
        ["巷口", "EXIT", "走出去就是另一个世界了。"],
      ];
      places.innerHTML = locs.map(([name, tag, desc]) => {
        const here = s && s.location === name;
        return `<div class="place-card">
          <p class="label-sm">${tag}</p>
          <h3 class="place-name">${name}${here ? " · 你在这" : ""}</h3>
          <p class="place-desc">${desc}</p>
          <button class="btn-sm" onclick="DA.doGo('${name}')" ${!s ? "disabled" : ""}>前往</button>
        </div>`;
      }).join("");
    }
    const hereBox = document.getElementById("here");
    if (hereBox) {
      if (!s) { hereBox.innerHTML = `<div class="empty-hint">图鉴模式——去 <a href="npcs.html">名册</a> 或 <a href="recipes.html">酒谱</a> 逛逛。</div>`; }
      else {
        const npcs = this.npcsAt(s.location);
        hereBox.innerHTML = `
          <p class="label-sm">HERE & NOW</p>
          <h3 class="section-title">${s.location} · ${s.weather} · ${s.time}</h3>
          ${npcs.length ? `<div class="card-grid-3" style="margin-top:14px">${npcs.map(n => `
            <div class="npc-card">
              <div class="npc-card-head">
                <div class="npc-avatar">${n.emoji || "🙂"}</div>
                <div><strong>${n.name}</strong><span>${n.title}</span></div>
              </div>
              <p class="recipe-desc">${(n.greetings && n.greetings[0]) || n.backstory}</p>
              <button class="btn-sm" onclick="DA.doTalk('${n.name}')">说说话</button>
            </div>`).join("")}</div>` : `<div class="empty-hint">此刻没人。夜还长。</div>`}
          <div class="mixer-row" style="margin-top:14px">
            <button class="btn-sm-ghost" onclick="DA.action({action:'explore'})">🔍 在这里搜一搜</button>
            <button class="btn-sm-ghost" onclick="DA.action({action:'rest'})">🪑 歇一会儿</button>
          </div>`;
      }
    }
    const evBox = document.getElementById("alley-event");
    if (evBox) evBox.innerHTML = s ? this.eventCardHTML(s.pendingEvent) : "";
  },

  async doGo(loc) { await this.action({ action: "go", location: loc }); await this.page_alley(); },
  async doTalk(name) { await this.action({ action: "talk", npc: name }); await this.page_alley(); },

  /* ═══ 页面：酒谱 ═══ */
  async page_recipes() {
    this.renderRecipes();
    for (const id of ["f-tier", "f-flavor", "f-mood", "f-base", "f-kw"]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => this.renderRecipes());
      if (el && el.type === "text") el.addEventListener("input", () => this.renderRecipes());
    }
  },
  renderRecipes() {
    const box = document.getElementById("recipe-grid");
    if (!box) return;
    const tier = document.getElementById("f-tier")?.value || "";
    const flavor = document.getElementById("f-flavor")?.value || "";
    const mood = document.getElementById("f-mood")?.value || "";
    const base = document.getElementById("f-base")?.value || "";
    const kw = (document.getElementById("f-kw")?.value || "").toLowerCase();
    const unlocked = this.state ? (this.state.recipesUnlockedIds || null) : null;
    const list = this.data.recipes.filter(r =>
      (!tier || r.tier === tier) &&
      (!flavor || r.flavor_tags.includes(flavor)) &&
      (!mood || r.mood_tags.includes(mood)) &&
      (!base || r.base_spirit === base) &&
      (!kw || (r.name + r.name_en).toLowerCase().includes(kw))
    );
    const totalCN = { common: "常见", uncommon: "少见", rare: "稀有", legendary: "传说" };
    box.innerHTML = list.map(r => {
      const locked = this.state && !(this.state.recipesUnlockedKnown || []).includes?.(r.id);
      const isHidden = r.hidden;
      return `<div class="recipe-card ${isHidden && !this.state ? "hidden-recipe" : ""}">
        <div class="recipe-header">
          <span class="recipe-id">${r.id.replace("recipe_", "酒谱 ")}</span>
          <span class="badge badge-${r.tier}">${totalCN[r.tier] || r.tier}</span>
        </div>
        <h3 class="recipe-name">${r.emoji || "🥃"} ${isHidden && !this.state ? "？？" : r.name}</h3>
        <p class="recipe-desc">${isHidden && !this.state ? "隐藏配方——条件到了，自然会懂。" : r.description}</p>
        <p class="recipe-detail">${isHidden && !this.state ? "解锁提示：" + r.unlock_condition : `${r.base_spirit}｜${r.method}｜${r.glass}｜难度 ${r.difficulty}<br>材料：${r.ingredients.join("、")}<br>味道：${r.flavor_tags.join("/")}｜氛围：${r.mood_tags.join("/")}<br>成本 ${r.cost} · 售价 ${r.sell_price} Tab${r.story ? `<br><br>📖 ${r.story}` : ""}`}</p>
      </div>`;
    }).join("") || `<div class="empty-hint">没有匹配的酒谱——换个筛法试试。</div>`;
  },

  /* ═══ 页面：名册 ═══ */
  async page_npcs() {
    this.renderNpcs();
    const el = document.getElementById("f-loc");
    if (el) el.addEventListener("change", () => this.renderNpcs());
    const kw = document.getElementById("f-npc-kw");
    if (kw) kw.addEventListener("input", () => this.renderNpcs());
  },
  renderNpcs() {
    const box = document.getElementById("npc-grid");
    if (!box) return;
    const loc = document.getElementById("f-loc")?.value || "";
    const kw = (document.getElementById("f-npc-kw")?.value || "").toLowerCase();
    const rels = (this.state && this.state.relationships) || {};
    const locCN = { "酒吧": "酒吧", "宵夜档": "宵夜档", "便利店": "便利店", "地下室": "地下室", "天台": "天台", "巷子": "巷子游荡", "隐藏": "隐藏人物" };
    const list = this.data.npcs.filter(n =>
      (!loc || n.location === loc) &&
      (!kw || (n.name + n.title).toLowerCase().includes(kw))
    );
    box.innerHTML = list.map(n => {
      const aff = rels[n.name];
      const met = aff !== undefined;
      return `<div class="npc-card ${met ? "" : "npc-locked"}">
        <div class="npc-card-head">
          <div class="npc-avatar">${n.emoji || "🙂"}</div>
          <div><strong>${n.name}</strong><span>${n.title} · ${locCN[n.location] || n.location} · ${n.age}</span></div>
        </div>
        ${met ? `
          <p class="recipe-desc">${n.appearance}</p>
          <p class="recipe-detail">性格：${n.personality.join("/")}<br>喜欢：${n.likes.join("/")}｜讨厌：${n.dislikes.join("/")}<br>说话风格：${n.dialogue_style}</p>
          <div class="affinity-bar"><div class="affinity-fill" style="width:${aff * 10}%"></div></div>
          <p class="mixer-note" style="margin-top:4px">好感 ${aff}/10${n.sells ? " · 卖：" + n.sells.join("/") : ""}</p>
        ` : `
          <p class="recipe-desc">${n.title}——你们还没打过照面。${n.location === "隐藏" ? "出现条件藏在雨里、雾里、凌晨三点里。" : `TA 常在${locCN[n.location] || n.location}。`}</p>
        `}
      </div>`;
    }).join("") || `<div class="empty-hint">没找到这个人。</div>`;
  },

  /* ═══ 页面：委托板 ═══ */
  async page_quests() {
    const box = document.getElementById("quest-box");
    if (!box) return;
    if (!this.state) {
      // 图鉴模式：全部委托当"字条墙"展示
      box.innerHTML = this.data.quests.slice(0, 24).map(q => questCard(q, null)).join("") + `<div class="empty-hint">图鉴模式只展示前 24 张字条。连接服务器后，这里就是真正的委托板。</div>`;
      return;
    }
    const s = this.state;
    const st = await this.fetchJSON("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "board" }) }).catch(() => null);
    const boardText = st && st.ok ? st.text : "";
    const ids = (boardText.match(/quest_\d+/g) || []);
    const qById = Object.fromEntries(this.data.quests.map(q => [q.id, q]));
    const accIds = (s.quests?.accepted || []).map(q => q.id);
    const done = this.stateCompleted();
    let html = "";
    // 进行中
    html += `<div class="section-header"><div><p class="label-sm">IN PROGRESS</p><h2 class="section-title">进行中</h2></div></div>`;
    html += accIds.length ? accIds.map(id => questCard(qById[id], "accepted")).join("") : `<div class="empty-hint">没有进行中的委托。</div>`;
    // 可接
    html += `<div class="section-header" style="margin-top:32px"><div><p class="label-sm">OPEN</p><h2 class="section-title">可接</h2></div></div>`;
    const openIds = ids.filter(id => !accIds.includes(id));
    html += openIds.length ? openIds.map(id => questCard(qById[id], "open")).join("") : `<div class="empty-hint">板上暂时没有新字条——多和巷子里的人聊聊，委托会找上门。</div>`;
    // 已完成
    html += `<div class="section-header" style="margin-top:32px"><div><p class="label-sm">DONE · ${done.length}</p><h2 class="section-title">已完成</h2></div></div>`;
    html += done.length ? done.map(id => questCard(qById[id], "done")).join("") : `<div class="empty-hint">还没有完成的委托。</div>`;
    box.innerHTML = html;
  },
  stateCompleted() {
    // state 不直接带 completed 列表 → 从 eventLog/服务端取；简化：用 board 接口文本里的【已完成】数量
    // 为让网页可用，读取服务端 board 文本中的编号不可行——改为从数据推断：记忆+日志包含「委托完成」
    const done = [];
    for (const q of this.data.quests) {
      if ((this.state?.eventLog || []).some(l => l.text && l.text.includes("委托完成") && l.text.includes(q.title))) done.push(q.id);
    }
    return done;
  },
  async acceptQuest(id) { await this.action({ action: "accept", quest_id: id }); await this.page_quests(); },
  async abandonQuest(id) { await this.action({ action: "abandon", quest_id: id }); await this.page_quests(); },

  /* ═══ 页面：回忆 ═══ */
  async page_archive() {
    const s = this.state;
    const memBox = document.getElementById("memories");
    if (memBox) {
      const mems = s ? (s.memories || []).slice().reverse() : [];
      memBox.innerHTML = mems.length
        ? mems.map(m => `<span class="memory-chip">🪶 ${m}</span>`).join("")
        : `<div class="empty-hint">${s ? "还没有记忆碎片。" : "连接服务器后，这里会落满这一夜一夜攒下的记忆。"}</div>`;
    }
    const logBox = document.getElementById("fulllog");
    if (logBox) {
      const logs = s ? (s.eventLog || []) : [];
      logBox.innerHTML = logs.length
        ? logs.map(l => `<div class="timeline-item"><span class="timeline-time">第${l.day}夜 ${l.time}</span><p class="timeline-text">${l.text}</p></div>`).join("")
        : `<div class="empty-hint">巷志还是空白的。</div>`;
    }
  },
};

function questCard(q, status) {
  if (!q) return "";
  const typeCN = { drink_request: "点酒", fetch: "跑腿", social: "社交", explore: "探索", challenge: "考验" };
  const chain = q.chain_next ? `<span class="quest-chain">⛓ 连锁·未完</span>` : (status === "done" && isChainEnd(q.id) ? `<span class="quest-chain">⛓ 连锁·终章</span>` : "");
  const inChain = q.chain_next || chainIsLinked(q.id);
  const actions = status === "open" ? `<button class="btn-sm" onclick="DA.acceptQuest('${q.id}')">接下</button>`
    : status === "accepted" ? `<button class="btn-sm-ghost" onclick="DA.abandonQuest('${q.id}')">放弃</button>`
    : status === "done" ? `<span class="mixer-note">已完成 ✓</span>` : "";
  return `<div class="quest-item">
    <div class="quest-meta">
      <span>${q.id}</span><span>·</span><span>${typeCN[q.type] || q.type}</span><span>·</span><span>难度 ${q.difficulty}</span><span>·</span><span>委托人：${q.giver}</span>
      ${q.repeatable ? "<span>·</span><span>日常</span>" : ""}${inChain ? "<span>·</span>" + chain : ""}
      ${(q.tags || []).includes("陷阱") ? "<span>·</span><span style='color:#b8860b'>⚠ 未必如你所想</span>" : ""}
    </div>
    <h3 class="recipe-name">${q.title}</h3>
    <p class="quest-quote">${q.request_dialogue}</p>
    <p class="recipe-desc">${status === "done" ? q.success_dialogue : (status === "open" || status === "accepted") ? "奖励：" + rewardText(q) : ""}</p>
    <div class="recipe-actions">${actions}</div>
  </div>`;
}
function rewardText(q) {
  const rw = q.reward || {};
  const bits = [];
  if (rw.tab) bits.push(rw.tab + " Tab");
  if (rw.reputation) bits.push("声望 " + (rw.reputation > 0 ? "+" : "") + rw.reputation);
  if (rw.item) bits.push("「" + rw.item + "」");
  if (rw.unlock && rw.unlock.memory) bits.push("记忆·" + rw.unlock.memory);
  if (rw.unlock && rw.unlock.recipe) bits.push("配方解锁");
  return bits.join("｜") || "嗯……未必是钱。";
}
function chainIsLinked(id) {
  return DA.data.quests.some(q => q.chain_next === id);
}
function isChainEnd(id) {
  return DA.data.quests.some(q => q.chain_next === id) && !DA.data.quests.find(q => q.id === id)?.chain_next;
}
function weatherTitle(w) {
  return { "微雨": "雨把巷子下成了一首慢歌", "大雨": "大雨里，巷子只剩你的灯", "晴": "难得晴天，连猫都在打盹", "雾": "雾把深巷泡进了牛奶里", "月圆": "今晚的月亮大得不讲道理", "大风": "风把招牌吹得哐哐响", "降温": "一夜入秋，热饮正当季", "雨后": "雨停了，水洼里倒着灯", "连雨": "雨下了一周，潮气爬上了墙", "台风": "台风夜——灯要留到最后", "冰雹": "冰雹在屋顶打鼓" }[w] || "巷子亮着灯";
}
function weatherDesc(w) {
  return { "微雨": "檐水滴答，客人的伞在门口开成一排花。", "大雨": "雨声盖过了钢琴声。", "晴": "阳光晒进吧台，酒都透亮了几分。", "雾": "门口的人影都要走近了才看得清。", "月圆": "天台大概挤满了看月亮的人。", "大风": "记得扶一把巷口的招牌。", "降温": "热饮的订单翻了三倍。", "雨后": "砖缝里的薄荷绿得发亮。", "连雨": "墙角有点可疑的霉味。", "台风": "门窗都加固了，谁来了都收留。", "冰雹": "屋顶的声音像免费打击乐。" }[w] || "";
}
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

window.addEventListener("DOMContentLoaded", () => DA.boot());
