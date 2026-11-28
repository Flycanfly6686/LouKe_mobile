// 《樓客》測試版主程式（M2：七夜、經濟、白天地圖、處置）
(() => {
  const S = window.STORY, A = window.ASSET_DATA, E = S.economy;
  if (S.questsExtra && !S._merged) { S.quests.push(...S.questsExtra); S._merged = true; }
  const $ = id => document.getElementById(id);
  const VERSION = "v0.9.6";   // 改版時只改這裡：主畫面左下角、設定畫面都會跟著變（企劃書的版本紀錄也記得補）
  const COPYRIGHT = "© 2026 FLY";
  $("copyright").textContent = `${VERSION}　${COPYRIGHT}`;
  const stage = $("stage"), scene = $("scene"), fx = $("fx"), g2d = fx.getContext("2d"), lampEl = $("lamp");
  // session：回到主畫面或讀檔時加一，舊流程裡還在等待的計時器就不會再繼續執行
  let session = 0;
  const sleep = ms => { const s = session; return new Promise(r => setTimeout(() => { if (s === session) r(); }, ms)); };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);
  const fill = (t, p, extra = {}) => t.replace(/\{n\}/g, p ? S.people[p.id].name : "").replace(/\{b\}/g, extra.b ?? "");
  const TELL_TYPES = ["eye", "hand", "doc"];
  const taxOf = n => (S.economy.taxBy || {})[n] || S.economy.tax;          // 每次收稅的金額

  // ---------- 版面：1em = 舞台寬 / 80 ----------
  const fit = () => { stage.style.fontSize = stage.clientWidth / 80 + "px"; };
  window.addEventListener("resize", fit); fit();

  // ---------- 預載 ----------
  const preload = ["title.jpg", "street_empty.jpg", "paper.jpg"];
  Object.keys(A.locations).forEach(l => preload.push(`loc_${l}.jpg`));
  Object.entries(A.chars).forEach(([id, c]) => {
    preload.push(`fig_${id}.png`, `fig_${id}_fake.png`);
    if (c.eyes) preload.push(`street_${id}_real.jpg`, `event_${id}.jpg`);   // 門口不分真假都用真人圖
  });
  // 手部圖：2–6 號是破綻和正常手；1 號（多一節指節，已拿掉）只有天生痕跡用到的才載入
  [...new Set(Object.values(A.chars).map(c => c.hands).filter(Boolean))].forEach(h => { for (let k = 2; k <= 6; k++) preload.push(`hands_${h}_${k}.jpg`); });
  Object.entries(S.handTalk.marks).forEach(([id, m]) => { if (m.img === 1 && A.chars[id]) preload.push(`hands_${A.chars[id].hands}_1.jpg`); });
  window.LOUKE_PRELOAD(preload);   // 手機版：分批慢慢抓（mobile.js）
  // 換場景時順便換背景聲：街上、後院、柴房有雨聲；其他室內白天放戲曲；深夜、噩夢只剩底噪
  const OUTDOOR = /^(street_|hands_|loc_yard|loc_woodshed|town_)/;
  let curScene = "";
  const setScene = f => {
    curScene = f;
    scene.src = "assets/" + f;
    const tm = f.match(/^town_(\w+?)(?:_(day|night))?\.jpg$/);           // 鎮上：每個地點有自己的配樂，黃昏換另一種
    const m = f === "title.jpg" ? "title" : tm ? `town:${tm[1]}:${tm[2] ? (tm[2] === "night" ? "dusk" : "day") : (isDusk() ? "dusk" : "day")}`
      : OUTDOOR.test(f) ? "outdoor" : (G && G.phase === "day" && f.startsWith("loc_")) ? "indoor" : "quiet";
    SFX.setAmbience(m);
  };

  // ---------- 文字 ----------
  let typer = null, waiter = null, idle = false, waitingSay = 0;   // waitingSay：有對話在等玩家點下一句
  function type(el, text, speed = 30) {
    return new Promise(res => {
      const chars = [...text];
      let i = 0;
      if (typer) typer.finish();       // 被新文字打斷時，讓上一段的等待也結束，避免流程卡住
      el.textContent = "";
      const me = { t: 0, finish() { clearTimeout(me.t); el.textContent = text; typer = null; res(); } };
      typer = me;
      const tick = () => {
        if (typer !== me) return;
        if (i >= chars.length) { typer = null; res(); return; }
        const c = chars[i++];
        el.textContent += c;
        me.t = setTimeout(tick, "，。？！…\n」".includes(c) ? speed * 6 : speed);
      };
      tick();
    });
  }
  function waitClick(host) {
    if (waiter) waiter();              // 還有舊的等待沒結束：先讓它結束，避免兩段流程互相卡死
    const mark = document.createElement("span");
    mark.className = "next"; mark.textContent = "▼";
    host.appendChild(mark);
    return new Promise(res => { waiter = () => { waiter = null; mark.remove(); res(); }; });
  }
  const clearMarks = () => document.querySelectorAll("#dialog .next, #narration .next").forEach(m => m.remove());   // 重置畫面後，不要留下沒人在等的 ▼
  function advance() { if (typer) typer.finish(); else if (waiter) waiter(); }
  $("dialog").addEventListener("click", advance);
  $("narration").addEventListener("click", advance);

  // 名錄：畫面上出現某個字詞時，解鎖對應詞條的下一段
  function initLex() {
    G.lex = {};
    S.lexicon.forEach(e => { if (e.stages[0] && !e.stages[0].key) G.lex[e.id] = 1; });
  }
  function scanLex(text) {
    if (!G || !G.lex || !text) return;
    S.lexicon.forEach(e => {
      let n = G.lex[e.id] || 0, changed = false;
      while (e.stages[n] && e.stages[n].key && text.includes(e.stages[n].key)) { n++; changed = true; }
      if (changed) { G.lex[e.id] = n; G.lexNew = true; codexLex(e.id, n); $("btn-journal").classList.add("dot"); }
    });
  }

  // ---------- 對話紀錄：最近 800 句（跟著存檔一起存） ----------
  const LOG = [];
  function logLine(who, text) {
    if (window.__onLine) window.__onLine(who, text);     // 測試用：記下每一句（平常沒有作用）
    if (!text || !String(text).trim()) return;
    // 地點描述、「你走到某人身邊」這類畫面說明不記
    const places = [...Object.values(S.locations).map(l => l.name), ...Object.values(S.town.places).map(l => l.name), S.town.mapTitle];
    if (places.includes(who) || /^你走到|^你在.+遇到了/.test(text)) return;
    const last = LOG[LOG.length - 1], tag = G ? `${S.dates[G.night - 1] || ""}　${G.phase === "day" ? "白天" : "夜"}` : "";
    if (last && last.t === text && last.w === who) return;
    LOG.push({ w: who || "", t: String(text), tag });
    if (LOG.length > 800) LOG.shift();
  }
  function openLog() {
    const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    let lastTag = "";
    const rows = LOG.map(l => {
      const head = l.tag && l.tag !== lastTag ? `<div class="day">${esc(l.tag)}</div>` : "";
      lastTag = l.tag || lastTag;
      return head + (l.w ? `<p><span class="w">${esc(l.w)}</span>${esc(l.t)}</p>` : `<p class="n">${esc(l.t)}</p>`);
    }).join("");
    openPanel("對話紀錄", `<div class="log">${rows || "<p>還沒有任何對話。</p>"}</div>`, body => {
      setTimeout(() => { const l = body.querySelector(".log"); if (l) l.scrollTop = l.scrollHeight; }, 0);   // 打開時停在最新的一句
    });
  }
  // 條件文字：【id？那個人在樓裡時的寫法｜不在時的寫法】；{any:a,b} 換成在場的人名
  const hereNow = id => { const p = G && G.people[id]; return !!p && p.status === "in" && !p.known; };
  function condText(t, here = hereNow) {
    if (!t || !G) return t;
    const metNow = id => { const p = G.people[id]; return !!p && !!p.admittedNight; };
    // 先處理裡層，再處理外層（允許巢狀）
    let prev;
    do { prev = t; t = t.replace(/【(met:)?(\w+)？([^｜【】]*)(?:｜([^【】]*))?】/g, (m, mt, id, a, b) => (mt ? metNow(id) : here(id)) ? a : (b || "")); } while (t !== prev);
    return t
      .replace(/\{any:([\w,]+)\}/g, (m, ids) => { const n = ids.split(",").filter(id => here(id)).map(id => name(G.people[id])); return n.length ? n.join("、") : "樓裡的人"; });
  }
  async function say(speaker, text, wait = false) {
    text = condText(text);
    // 啞姑不會說話：要她「說」的共用台詞改成寫在紙上（動作描寫、畫皮故意開口的句子不改）
    const M = S.mute;
    if (M && speaker === S.people[M.id].name && text && !text.startsWith("（") && !text.includes("開口")) text = M.wrap.replace("{t}", text);
    scanLex(text);
    if (wait) { setActions([]); waitingSay++; }
    logLine(speaker, text);
    $("speaker").textContent = speaker || "";
    if (G && G.truth && G.sanity < 40 && speaker && Object.values(S.people).some(d => d.name === speaker) && Math.random() < 0.06) {
      // 心神過低：名字欄閃過梁長生的名字（只是嚇人，不影響任何結果）
      $("speaker").textContent = S.truth.name;
      setTimeout(() => { if ($("speaker").textContent === S.truth.name) $("speaker").textContent = speaker; }, 450);
      truthClue("name");
    }
    await type($("text"), text);
    if (wait) { try { await waitClick($("dialog")); } finally { waitingSay = Math.max(0, waitingSay - 1); } }
  }
  async function narrate(lines) {
    $("narration").classList.remove("hidden");
    for (const line of lines) {
      scanLex(line); logLine("", line);
      await type($("narration-text"), line, 50);
      await waitClick($("narration"));
    }
    $("narration").classList.add("hidden");
  }
  const fading = () => $("fade").classList.contains("on");
  const busy = () => fading() || waitingSay > 0;          // 畫面切換中、或對話還在等你點：人物和地點都不能點
  // 背景跟目前的位置對不上時（例如點太快、兩個流程交錯），直接校正
  const ensureScene = f => { if (curScene !== f && !fading()) setScene(f); };
  async function fadeTo(fn) {
    $("fade").classList.add("on");
    await sleep(700);
    await fn();
    $("fade").classList.remove("on");
    await sleep(400);
  }

  // ---------- 新手提示 ----------
  const coachOn = () => { try { return localStorage.getItem("louke_coach") !== "off"; } catch (e) { return false; } };
  const coachSeen = () => { try { return JSON.parse(localStorage.getItem("louke_coach_seen") || "{}"); } catch (e) { return {}; } };
  function coachMark(k) { try { const s = coachSeen(); s[k] = 1; localStorage.setItem("louke_coach_seen", JSON.stringify(s)); } catch (e) {} }
  function coachSet(on) { try { localStorage.setItem("louke_coach", on ? "on" : "off"); if (on) localStorage.removeItem("louke_coach_seen"); } catch (e) {} if (!on) coachEnd(); }
  let coachState = null;
  function coachTarget(sel) {
    if (sel.startsWith("btn:")) return [...document.querySelectorAll("#actions button")].find(b => b.textContent.startsWith(sel.slice(4)));
    return document.querySelector(sel);
  }
  function coach(group) {
    if (coachState || !coachOn() || coachSeen()[group] || !S.coach[group]) return;
    coachMark(group);
    let box = $("coach");
    if (!box) {
      box = document.createElement("div"); box.id = "coach";
      box.innerHTML = `<p></p><div class="coach-row"><button data-c="skip"></button><button data-c="next"></button></div>`;
      document.body.appendChild(box);
      // 提示出現時：整個畫面蓋一層（擋住點擊），只有提示框能按；目標周圍挖亮、其他地方調暗
      const mask = document.createElement("div"); mask.id = "coach-mask";
      const hole = document.createElement("div"); hole.id = "coach-hole";
      ["click", "mousedown", "touchstart"].forEach(ev => mask.addEventListener(ev, e => { e.stopPropagation(); e.preventDefault(); }));
      document.body.appendChild(mask); document.body.appendChild(hole);
      box.addEventListener("click", e => {
        e.stopPropagation();
        const c = e.target.dataset && e.target.dataset.c;
        if (c === "skip") coachEnd();
        if (c === "next") { coachState.i++; coachShow(); }
      });
    }
    coachState = { group, i: 0 };
    coachShow();
  }
  function coachShow() {
    if (!coachState) return;
    const steps = S.coach[coachState.group];
    if (coachState.i >= steps.length) return coachEnd();
    const [, text] = steps[coachState.i], box = $("coach");
    box.querySelector("p").textContent = condText(text);
    box.querySelector("[data-c=skip]").textContent = S.coach.skip;
    box.querySelector("[data-c=next]").textContent = coachState.i === steps.length - 1 ? S.coach.done : S.coach.next;
    box.classList.add("on");
    $("coach-mask").classList.add("on");
    coachPlace();
  }
  function coachPlace() {
    if (!coachState) return;
    document.querySelectorAll(".coach-glow").forEach(x => x.classList.remove("coach-glow"));
    const box = $("coach"), t = coachTarget(S.coach[coachState.group][coachState.i][0]);
    const W = window.innerWidth, H = window.innerHeight, bw = box.offsetWidth, bh = box.offsetHeight;
    const mask = $("coach-mask"), hole = $("coach-hole");
    if (!t || !t.offsetParent) {
      hole.classList.remove("on"); mask.classList.add("dim");        // 沒有目標：整個畫面調暗
      box.style.left = (W - bw) / 2 + "px"; box.style.top = H * 0.18 + "px"; return;
    }
    t.classList.add("coach-glow");
    const r = t.getBoundingClientRect(), pad = 6;
    mask.classList.remove("dim");
    Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
    hole.classList.add("on");
    let top = r.top - bh - 14; if (top < 8) top = Math.min(r.bottom + 14, H - bh - 8);
    const left = Math.max(8, Math.min(W - bw - 8, r.left + r.width / 2 - bw / 2));
    box.style.left = left + "px"; box.style.top = top + "px";
  }
  function coachEnd() {
    coachState = null;
    document.querySelectorAll(".coach-glow").forEach(x => x.classList.remove("coach-glow"));
    const box = $("coach"); if (box) box.classList.remove("on");
    ["coach-mask", "coach-hole"].forEach(id => { const x = $(id); if (x) x.classList.remove("on", "dim"); });
  }
  window.addEventListener("resize", () => coachPlace());

  function setActions(list, isIdle = false) {
    idle = isIdle;                     // 只有地圖畫面和人物選單算「閒著」，可以手動存檔
    const box = $("actions");
    box.innerHTML = "";
    list.forEach(a => {
      if (a === "sep" || a === "br") { const s = document.createElement("span"); s.className = a; box.appendChild(s); return; }
      const b = document.createElement("button");
      b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      b.disabled = !!a.disabled;
      b.addEventListener("click", e => { e.stopPropagation(); if (!b.disabled && !fading()) a.fn(); });   // 畫面切換中不接受點擊
      box.appendChild(b);
    });
    if (coachState) setTimeout(coachPlace, 0);
  }

  // ---------- 文件與面板 ----------
  let docClose = null;
  function openDoc(html) {
    $("doc").innerHTML = html;
    $("doc-modal").classList.remove("hidden");
    fitDoc();
    return new Promise(res => { docClose = res; });
  }
  // 直書的紙放不下時（手機字比較大），一點一點縮字直到整張放得下
  function fitDoc() {
    const d = $("doc");
    d.style.fontSize = "";
    let f = parseFloat(getComputedStyle(d).fontSize);
    for (let i = 0; i < 24 && (d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1); i++) {
      f *= 0.95; d.style.fontSize = f + "px";
    }
  }
  window.addEventListener("resize", () => { if (!$("doc-modal").classList.contains("hidden")) fitDoc(); });
  $("btn-doc-close").addEventListener("click", () => {
    $("doc-modal").classList.add("hidden");
    if (docClose) { const f = docClose; docClose = null; f(); }
  });
  function openPanel(title, html, bind) {
    $("panel-title").textContent = title;
    $("panel-body").innerHTML = html;
    $("panel-modal").classList.remove("hidden");
    if (bind) bind($("panel-body"));
  }
  let panelClose = null;
  const closePanel = () => {
    $("panel-modal").classList.add("hidden");
    if (panelClose) { const f = panelClose; panelClose = null; f(); }
  };
  // 遊戲介紹：第一次開始遊戲時自動跳出，之後在設定裡打開
  function openGuide() {
    const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    openPanel("遊戲介紹", `<div class="guide">${S.guide.map(([h, t]) => `<h3>${h}</h3><p>${esc(t)}</p>`).join("")}</div>`);
    $("panel").scrollTop = 0;
    return new Promise(res => { panelClose = res; });
  }
  const guideSeen = () => { try { return localStorage.getItem("louke_guide") === "seen"; } catch (e) { return true; } };
  const markGuide = () => { try { localStorage.setItem("louke_guide", "seen"); } catch (e) {} };
  $("btn-panel-close").addEventListener("click", closePanel);

  const seal = (text, bad) => `<div class="seal${bad ? " bad" : ""}">${text.replace("\n", "<br>")}</div>`;
  function foodHint() {                                // 某兩夜的告示末尾，偷偷寫著畫皮不吃飯
    const i = (G.foodHints || []).indexOf(G.night);
    if (i < 0) return "";
    const t = S.food.hints[i];
    if (!(G.foodNotes = G.foodNotes || []).includes(t)) G.foodNotes.push(t);
    return t;
  }
  function noticeHtml() {
    const t = G.tells;
    return `<h2>霜渡縣衙　告示</h2>
      <p>近日畫皮作祟，混跡行旅之中，夜叩店門，假作投宿。</p>
      <p>經仵作驗得，今夜畫皮者有破綻三端：</p>
      <p class="rule">其一，${t.eye.notice}</p>
      <p class="rule">其二，${t.hand.notice}</p>
      <p class="rule">其三，${t.doc.notice}</p>
      ${ruleOf() ? `<p class="rule year">${S.ruleNotice}${ruleOf().notice}</p>` : ""}
      ${foodHint() ? `<p class="note">${foodHint()}</p>` : ""}
      <p>畫皮未必盡顯其形，凡見一端，即可斷之。</p>
      <p>殺畫皮者，賞錢${E.bounty}文。誤殺良民者，以殺人論。</p>
      <p class="note">${S.era}${S.dates[G.night - 1]}</p>
      ${seal("霜渡\n縣印", false)}`;
  }
  function docHtml(p) {
    const d = S.people[p.id].doc, bad = p.fake && p.tell === "doc" ? G.tells.doc.id : null;
    const row = (label, val) => `<p><span class="label">${label}　</span>${val}</p>`;
    return `<h2>路　引</h2>
      ${row("姓名", d.name)}${row("籍貫", d.from)}${row("年歲", d.age)}
      ${row("面貌", bad === "face" ? d.faceBad : d.face)}
      ${row("事由", d.purpose)}
      ${row("簽發", S.era + (bad === "date" ? d.dateBad : d.date))}
      <p class="note">右給沿途關津，驗明放行。</p>
      ${seal(d.seal, bad === "seal")}
      ${G.flags && G.flags.sealCopy ? `<p class="note">${bad === "seal" ? S.sealCopy.docBad : S.sealCopy.docOk}</p>` : ""}`;
  }

  // ---------- 狀態 ----------
  let G = null;
  const P = id => G.people[id];
  const artOf = id => (S.people[id] && S.people[id].art) || id;
  const albumName = p => { const d = S.people[p.id]; return d.kind === "passer" ? `${d.name}（${d.doc.name}）` : (d.fullName || d.name); };   // 過客共用男女兩套立繪
  // 叩門的畫面：王嫂的畫皮版有時穿著左衽（壽衣）的衣服，用偽人版立繪
  const doorScene = p => `street_${artOf(p.id)}_${p.collarShow ? "collar" : "real"}.jpg`;
  const name = p => S.people[p.id].name;
  const inside = () => Object.values(G.people).filter(p => p.status === "in" || p.status === "locked");
  const active = () => Object.values(G.people).filter(p => p.status === "in");

  function newGame() {
    LOG.length = 0;
    clearPassers();
    G = {
      truth: { pts: [], layer: 1, relics: {}, told: {} },
      rule: pick(S.rules).id, dog: null, townDone: {}, townVisits: 0, out: false, townAt: null,
      night: 1, coins: E.startCoins, items: { ...E.startItems }, sanity: 100, wrongKills: 0, pendingLeave: false,
      ap: 0, loc: "hall", tells: null, people: {}, refusedLast: [], mugwort: false, phase: "night", sel: null,
      done: new Set(), flags: {}, griefQueue: [], guard: false, phantom: null, plot: null, murdered: null,
      stats: { refused: 0, killedFakes: 0, paper: 0, events: 0, quests: 0 },
      quests: {}, clues: [], clueTypes: [], memory: 0, lover: null, lovers: [], sleepUntil: 0, master: null, masterExposed: false,
      sand: 0, carve: null, assemblyDay: 0, accuseDay: 0, crowdAngry: false,
      food: E.startFood, foodHints: S.food.hintNights.map(([a, b]) => a + Math.floor(Math.random() * (b - a + 1))), foodNotes: []
    };
    Object.entries(S.people).forEach(([id, d]) => {
      if (!A.chars[id] || !A.chars[id].art) return;     // 還沒有立繪的角色先不出場
      G.people[id] = { id, status: d.kind === "staff" ? "in" : "out", fake: false, tell: null, known: false, affection: 0, loc: "hall", lamp: false, asked: new Set(),
                       chatIdx: 0, room: d.room || (d.kind === "staff" ? "staff" : "dorm"), secretTold: false, met: d.kind === "staff" };
      if (d.kind === "staff") codexMark("met", id);
    });
    // 門主：從第一到第五夜會來的客人裡隨機挑一位，他一進門就是畫皮
    const cands = [];
    S.nights.forEach((n, i) => { if (i < 5) n.arrivals.forEach(id => { if (G.people[id]) cands.push(id); }); });
    G.master = cands.length ? pick(cands) : null;
    initLex();
    // 大事件：每局隨機落在區間裡，同一夜只會有一件
    const used = new Set(); G.big = {};
    ["relief", "inspect", "famine"].forEach(k => {
      const [a, b] = S.bigEvents[k].window, opts = [];
      for (let n = a; n <= b; n++) if (!used.has(n)) opts.push(n);
      G.big[k] = pick(opts); used.add(G.big[k]);
    });
  }
  // 離開客棧：依離開的方式決定會不會回來、回來的是不是本人
  const R = () => S.returns;
  function scheduleBack(p, fake) {
    const [a, b] = R().delay, d = a + Math.floor(Math.random() * (b - a + 1));
    const night = Math.min(G.night + d, R().lastNight);
    if (night <= G.night) return;                       // 太晚了，回不來
    p.returnNight = night; p.returnFake = fake;
  }
  // 人物欄用：記下哪一天、為什麼離開或死亡
  function markEnd(p, why) { if (p) { p.endNight = G.night; p.endWhy = why || ""; } }
  function leaveInn(p, how, why) {
    if (!p) return;
    p.status = "gone"; p.leftHow = how; markEnd(p, why);
    if (S.people[p.id] && S.people[p.id].kind === "passer") return;      // 過客走了就不回來
    const r = Math.random();
    if (r < R().leftNone) return;
    scheduleBack(p, p.fake || r < R().leftNone + R().leftFake);
  }
  const arrivalNight = id => S.nights.findIndex(n => n.arrivals.includes(id)) + 1;
  const isIn = p => p && (p.status === "in" || p.status === "locked");

  // 讓玩家從幾個選項中選一個，回傳選到的值
  function choose(prompt, options, speaker = "") {
    return new Promise(res => {
      setActions(options.map(o => ({ label: o.label, cls: o.cls, disabled: o.disabled, fn: () => { setActions([]); res(o.value); } })));
      say(speaker, prompt);
    });
  }
  // 要走的人裡，夥計和可以當伴侶的人可以花錢慰留
  const keepable = p => !!p && !p.fake && (S.people[p.id].kind === "staff" || RM().targets.includes(p.id));
  const wantLeave = (p, text, why) => (G.staffWant = G.staffWant || []).push({ id: p.id, text, why });
  async function staffStay() {
    const seen = new Set();
    const want = (G.staffWant || []).map(w => typeof w === "string" ? { id: w } : w).filter(w => !seen.has(w.id) && seen.add(w.id));
    G.staffWant = [];
    const X = S.staffStay;
    for (const w of want) {
      const p = P(w.id);
      if (!p || p.status !== "in") continue;
      const n = name(p), mute = S.mute && w.id === S.mute.id, staff = S.people[w.id].kind === "staff";
      $("hud").classList.remove("hidden");
      const keep = await choose((mute ? X.askMute : X.ask).replace(/\{n\}/g, n), [
        { label: X.keep.replace("{c}", X.cost), value: true, disabled: G.coins < X.cost },
        { label: X.let.replace("{n}", n), value: false }]);
      if (keep) { G.coins -= X.cost; affect(p, 1); updateTopbar(); await say("", (mute ? X.keptMute : staff ? X.kept : X.keptGuest).replace(/\{n\}/g, n).replace("{c}", X.cost), true); }
      else { leaveInn(p, "left", w.why || "慰留不成，離開"); await say("", w.text || X.gone.replace(/\{n\}/g, n), true); }
    }
    return false;
  }
  // 吵架、偷竊的任務：有一方已經不在樓裡，就作罷
  async function staleTasks() {
    const away = id => !P(id) || !["in", "locked"].includes(P(id).status);
    const C = S.crowd;
    if (G.quarrel && (away(G.quarrel.a) || away(G.quarrel.b))) {
      const x = away(G.quarrel.a) ? G.quarrel.a : G.quarrel.b; G.quarrel = null;
      await say("", C.quarrel.off.replace(/\{x\}/g, name(P(x))), true);
    }
    if (G.theft && (away(G.theft.v) || away(G.theft.t))) {
      const v = G.theft.v; G.theft = null;
      if (away(v)) await say("", C.theft.off.replace(/\{v\}/g, name(P(v))), true);
    }
  }
  // 心神：快見底時警告一次；歸零就崩潰
  async function mindCheck() {
    if (G.sanity < S.mind.floor) G.sanity = S.mind.floor;
    if (G.sanity <= S.mind.floor) { ending("mindless"); return true; }
    if (G.sanity <= S.mind.warnAt && !G.mindWarned) { G.mindWarned = true; await narrate([S.mind.warn]); }
    else if (G.sanity > S.mind.warnAt + 10) G.mindWarned = false;
    return false;
  }
  // 人物欄顯示的全名：有些人的真名要等劇情揭開（例如王嫂）
  const shownFull = p => { const d = S.people[p.id]; return d.alias && !G.flags[d.aliasUntil] ? d.alias : (d.fullName || d.name); };
  // 不重複抽：同一個 key 抽完一輪才重來
  function freshPick(key, arr) {
    if (!arr || !arr.length) return "";
    const D_ = (G.deck = G.deck || {});
    let left = (D_[key] || []).filter(i => i < arr.length);
    if (!left.length) left = arr.map((_, i) => i);
    const i = pick(left);
    D_[key] = left.filter(x => x !== i);
    return arr[i];
  }
  // 白天看得出來的破綻：依那個人挑（啞的人沒有「說話」的破綻；昨晚才到的人還沒一起吃過飯）
  function tellsOf(p) {
    const d = S.people[p.id], mute = S.mute && p.id === S.mute.id, fresh = p.admittedNight === G.night;
    return [...S.dayTells, ...(d.dayTells || [])].filter(t => !(mute && /說話|搭了幾句/.test(t)) && !(fresh && /飯菜|吃飯|鹹菜/.test(t)));
  }
  // 播一段劇本：[[說話者 id 或 "", 文字], ...]
  async function playLines(lines, vars = {}) {
    for (const [who, text] of lines) {
      const t = text.replace(/\{(\w)\}/g, (m, k) => vars[k] ?? m);
      const spk = S.people[who] || (S.townPeople || {})[who];   // 樓裡的人或鎮上的人
      await say(who ? (spk ? spk.name : who) : "", t, true);
    }
  }
  const nm = id => S.people[id].name;
  const capOf = k => (E.itemCap || {})[k] ?? 99;
  const ruleOf = () => G && G.rule && S.rules.find(r => r.id === G.rule);
  const ruleIs = id => !!G && G.rule === id;
  const priceOf = k => k === "oil" && ruleIs("fire") ? S.items.oil.price * 2 : S.items[k].price;
  const foodPrice = () => E.foodPrice * (G.famine ? 2 : 1);
  const lampLeft = () => Math.min(G.items.oil, (E.lampPerNight || 1) - ((G.nightUsed || {}).oil || 0));   // 今晚還能舉幾次燈（不超過燈油）
  const isDusk = () => !!G && G.phase === "day" && G.ap <= S.town.duskAt;
  const dogOk = () => !!G && G.dog && G.dog.alive;
  const usedTonight = k => (G.nightUsed || {})[k];
  // 疑點：把你發現的線索記在對應的人身上（當眾對質時可以拿出來）
  function note(p, text, power) {
    if (!p || !text) return;
    G.dossier = G.dossier || {};
    const list = (G.dossier[p.id] = G.dossier[p.id] || []);
    if (!list.some(x => x.text === text)) list.push({ text, power });
  }
  // 疑點清單：記下的＋跟線索吻合的
  function dossierOf(p) {
    const list = [...((G.dossier || {})[p.id] || [])];
    const t = S.traits[p.id] || {};
    // 符合門主線索（至少兩條、而且全部吻合）
    if (G.master && !G.masterExposed && G.clueTypes.length >= 2) {
      const ok = G.clueTypes.every(k => k === "sex" ? t.sex === S.traits[G.master].sex : k === "age" ? t.age === S.traits[G.master].age
        : k === "local" ? !!t.local === !!S.traits[G.master].local : k === "night" ? arrivalNight(p.id) === arrivalNight(G.master)
        : (p.room || "dorm") === (P(G.master).room || "dorm"));
      if (ok) list.push({ text: "符合門主的線索", power: 2 });
    }
    // 符合守夜所見、命案現場的痕跡
    (G.glimpseTraits || []).forEach(g => {
      const hit = g.k === "bed" ? (p.room || "dorm") === g.v : t[g.k] === g.v;
      if (hit) list.push({ text: `符合「${g.text}」`, power: 1.5 });
    });
    return list;
  }

  // 改變好感，並在畫面上跳一行小字
  let toastT = 0;
  // 日常互動（閒聊、奉茶）的好感：每人每天有上限
  function dailyAffect(p, n) {
    if (!G.affDay || G.affDay.night !== G.night) G.affDay = { night: G.night, got: {} };
    const got = G.affDay.got[p.id] || 0, cap = E.dailyAffection || 2, add = Math.min(n, cap - got);
    if (add > 0) { G.affDay.got[p.id] = got + add; affect(p, add); return; }
    if (!p.met) return;
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; stage.appendChild(el); }
    const line = document.createElement("div");
    line.className = "down"; line.textContent = "♡ " + S.affection.capped.replace("{n}", S.people[p.id].name);
    el.appendChild(line); setTimeout(() => line.remove(), 2600);
  }
  function affect(p, n) {
    if (!p || !n) return;
    p.affection += n;
    if (!p.met) return;
    const t = (n > 0 ? S.affection.up : S.affection.down).replace("{n}", S.people[p.id].name);
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; stage.appendChild(el); }
    const line = document.createElement("div");
    line.className = n > 0 ? "up" : "down";
    line.textContent = (n > 0 ? "♥ " : "♡ ") + t;
    el.appendChild(line);
    setTimeout(() => line.remove(), 2600);
  }
  const bedName = r => (S.beds[r] && S.beds[r].name) || "—";

  // ---------- 主線：關於「你自己」的疑點與四層真相 ----------
  const TR = () => S.truth;
  const hasTruth = id => !!G && !!G.truth && G.truth.pts.includes(id);
  function truthClue(id) {
    if (!G || !G.truth || hasTruth(id) || !TR().clues[id]) return;
    G.truth.pts.push(id);
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; stage.appendChild(el); }
    const line = document.createElement("div");
    line.className = "truth"; line.textContent = TR().toast;
    el.appendChild(line);
    setTimeout(() => line.remove(), 2600);
  }
  const truthN = () => (G && G.truth ? G.truth.pts.length : 0);
  const truthReady = k => truthN() >= TR().need[k] && G.night >= TR().minNight[k];
  async function truthLayer2() {
    if (!G.truth || G.truth.layer !== 1 || !truthReady(1)) return;
    G.truth.layer = 2;
    await narrate(TR().l2);
  }
  async function truthLayer3() {
    G.truth.layer = 3;
    await narrate(TR().l3);
  }
  async function truthLayer4() {
    G.truth.layer = 4;
    await narrate(TR().l4);
  }
  // 「我是人」：有人知道真相還願意留下
  function humanOk() {
    const told = Object.keys(G.truth.told || {}).some(id => { const p = P(id); return p && p.status === "in" && !p.fake; });
    const close = inside().filter(p => !p.fake && p.affection >= TR().humanAff).length;
    return told || close >= TR().humanNeed;
  }
  const relicsOk = () => G.truth.relics.tag && G.truth.relics.cart;

  function makeFake(p) {
    p.fake = true;
    // 破綻偏向眼睛（眼 50%、手 25%、路引 25%）；蒙著眼的人照不出眼睛，只會是手或路引
    const r = Math.random();
    p.tell = S.people[p.id].noEyes ? pick(["hand", "doc"]) : r < 0.5 ? "eye" : r < 0.75 ? "hand" : "doc";
  }

  function updateTopbar() {
    if (G.sanity < S.mind.floor) G.sanity = S.mind.floor;          // 心神最低到 0
    const isDay = G.phase === "day";
    $("night-info").textContent = `${S.dates[G.night - 1]}　${isDay ? (isDusk() ? "黃昏" : "白天") : "夜"}　（第 ${G.night} 夜／共 ${S.nights.length} 夜）`;
    $("coins").textContent = `銅錢 ${G.coins} 文`;
    $("food").textContent = `${S.food.label} ${G.food ?? 0}`;
    $("mind").textContent = `${S.mind.label} ${mindWord()}`;
    $("mind").classList.toggle("low", G.sanity < 50);
    $("ap").classList.toggle("last", isDay && G.ap === 1);
    $("ap").textContent = isDay ? `行動 ${"●".repeat(Math.max(0, G.ap))}${"○".repeat(Math.max(0, E.actionsPerDay - G.ap))}` : "";
    stage.classList.toggle("shaken", G.sanity < 50);
  }
  function mindWord() {
    const L = S.mind.levels;
    if (G.sanity < S.mind.lieBelow && Math.random() < S.mind.lieChance) return pick(L)[1];   // 心神很低：連這個字都看錯
    return (L.find(([min]) => G.sanity >= min) || L[L.length - 1])[1];
  }
  function setGuestInfo(t) { $("guest-info").textContent = t || ""; $("guest-info").title = t || ""; }   // 太長被截斷時，滑鼠移上去看全文

  // ---------- 燈火與眼睛 ----------
  function clearFx() { g2d.clearRect(0, 0, fx.width, fx.height); }
  function drawEyes(eyes, tell) {
    clearFx();
    const [r, g, b] = tell.color, rgba = a => `rgba(${r},${g},${b},${a})`;
    eyes.forEach(([x, y]) => {
      const glow = g2d.createRadialGradient(x, y, 0, x, y, 26);
      glow.addColorStop(0, rgba(0.55)); glow.addColorStop(1, rgba(0));
      g2d.fillStyle = glow; g2d.beginPath(); g2d.arc(x, y, 26, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = rgba(0.95);
      g2d.beginPath();
      if (tell.mode === "blank") g2d.ellipse(x, y, 9, 6, 0, 0, Math.PI * 2); else g2d.arc(x, y, 7, 0, Math.PI * 2);
      g2d.fill();
      g2d.fillStyle = "#050505";
      if (tell.mode === "iris") { g2d.beginPath(); g2d.arc(x, y, 2, 0, Math.PI * 2); g2d.fill(); }
      if (tell.mode === "slit") { g2d.beginPath(); g2d.ellipse(x, y, 1.5, 6, 0, 0, Math.PI * 2); g2d.fill(); }
    });
  }
  function applyLamp(p) {
    if (!p.lamp) { stage.classList.remove("lamp-on"); clearFx(); return; }
    const eyes = A.chars[p.id].eyes;
    const cx = (eyes[0][0] + eyes[1][0]) / 2, cy = (eyes[0][1] + eyes[1][1]) / 2 + 20;
    lampEl.style.background = `radial-gradient(circle at ${cx / 12.8}% ${cy / 7.2}%, rgba(255,170,80,.42) 0%, rgba(255,140,50,.16) 16%, rgba(0,0,0,0) 40%)`;
    stage.classList.add("lamp-on");
    if (S.people[p.id].noEyes) clearFx();
    else if (p.fake && p.tell === "eye") drawEyes(eyes, G.tells.eye);
    else if (G.sanity < 50 && Math.random() < 0.35) {      // 心神不寧：活人的眼睛也閃一下
      drawEyes(eyes, pick(S.tells.eye));
      setTimeout(clearFx, 350);
    } else clearFx();
  }

  // ======================================================
  //  夜：叩門盤查
  // ======================================================
  function doorActions(p) {
    return [
      S.people[p.id].doc ? { label: "查看路引", fn: () => openDoc(docHtml(p)) } : { label: S.staffDoor.noDoc, disabled: true, fn: () => {} },
      { label: "查看雙手", fn: () => showHands(p) },
      { label: "問話", fn: () => showQuestions(p) },
      { label: lampLeft() <= 0 && !p.lamp ? "舉燈照臉（今晚已用完）" : `舉燈照臉（燈油 ${G.items.oil}，今晚還能 ${Math.max(0, lampLeft())} 次）`, disabled: p.lamp || G.items.oil <= 0 || lampLeft() <= 0, fn: () => useLamp(p) },
      { label: usedTonight("salt") && !p.salted ? "奉鹽茶（今晚已用過）" : `奉鹽茶（鹽 ${G.items.salt}）`, disabled: p.salted || G.items.salt <= 0 || usedTonight("salt"), fn: () => useSalt(p) },
      ...(G.items.mirror > 0 || p.mirrored ? [{ label: usedTonight("mirror") && !p.mirrored ? S.mirror.used : S.mirror.label.replace("{c}", G.items.mirror), disabled: p.mirrored || G.items.mirror <= 0 || usedTonight("mirror"), fn: () => useMirror(p) }] : []),
      ...(dogOk() ? [{ label: usedTonight("dog") ? S.food.dogUsed : (G.food || 0) < S.food.dog ? S.food.dogNone : S.food.dogLabel,
                      disabled: usedTonight("dog") || (G.food || 0) < S.food.dog, fn: () => useDog(p) }] : []),
      "br",                                              // 開門／拒之門外：另起一行，放左下角
      { label: "開門", cls: "decide", fn: () => decide(p, true) },
      { label: "拒之門外", cls: "danger gap", fn: () => decide(p, false) }
    ];
  }
  async function backToDoor(p, line) {
    stage.classList.remove("hands-view");
    setScene(doorScene(p));
    applyLamp(p);
    setActions(doorActions(p));
    await say("", line || `${name(p)}站在雨裡，等著你開口。`);
  }
  // 看雙手：畫皮的破綻、或是這個人天生的痕跡（畫皮穿的是同一張皮，痕跡也一樣）
  const handMark = p => S.handTalk.marks[p.id];
  function handImg(p) {
    if (p.fake && p.tell === "hand") return G.tells.hand.id;
    return handMark(p) ? handMark(p).img : 6;
  }
  function handActions(p) {
    return [
      { label: p.handAsked ? `${S.handTalk.label}${S.handTalk.asked}` : S.handTalk.label, disabled: p.handAsked, fn: () => askHands(p) },
      "sep",
      { label: "收回目光", fn: () => backToDoor(p) }
    ];
  }
  async function showHands(p) {
    stage.classList.remove("lamp-on"); clearFx();
    stage.classList.add("hands-view");
    setScene(`hands_${A.chars[p.id].hands}_${handImg(p)}.jpg`);
    setActions(handActions(p));
    await say("", `${name(p)}把雙手伸到門前，攤在雨裡給你看。`);
  }
  async function askHands(p) {
    p.handAsked = true;
    setActions([]);
    await say("你", "你的手怎麼了？");
    await sleep(300);
    const H = S.handTalk, m = handMark(p), showsTell = p.fake && p.tell === "hand";
    let t;
    if (m && (!showsTell || G.tells.hand.id === m.tell)) t = p.fake ? m.fake : m.real;   // 天生的痕跡：畫皮學著說，但會錯一點點
    else if (showsTell) t = (H.excuseBy[p.id] || {})[G.tells.hand.id] || H.excuse[G.tells.hand.id];   // 露出破綻：硬找理由
    else t = pick(H.plain);
    await say(name(p), t.replace(/\{n\}/g, name(p)));
    setActions(handActions(p));
  }
  function showQuestions(p) {
    const qs = S.people[p.id].questions || [];
    const back = p.returning ? [{
      label: S.returns.askLabel, disabled: p.asked.has("back"),
      fn: async () => {
        p.asked.add("back"); setActions([]);
        await say("你", "上回的事，你還記得嗎？");
        await sleep(400);
        const how = p.leftHow === "refused" ? "refused" : p.leftHow === "expelled" ? "expelled" : "left";
        await say(name(p), pick(S.returns[p.fake ? "fake" : "real"][how]).replace(/\{n\}/g, name(p)));
        if (p.fake) note(p, "說起上回的事，對不上", 1.5);
        showQuestions(p);
      }
    }] : [];
    setActions([
      ...back,
      ...qs.map((q, i) => ({
        label: q.q, disabled: p.asked.has(i),
        fn: async () => {
          p.asked.add(i);
          setActions([]);
          await say("你", q.q);
          await sleep(400);
          await say(name(p), p.fake && !(ruleIs("mimic") && Math.random() < 0.6) ? q.fake : q.real);
          showQuestions(p);
        }
      })),
      "sep",
      { label: "不問了", fn: () => backToDoor(p) }
    ]);
  }
  async function useLamp(p) {
    G.items.oil--; p.lamp = true; G.nightUsed = G.nightUsed || {}; G.nightUsed.oil = (G.nightUsed.oil || 0) + 1;
    SFX.lamp();
    applyLamp(p);
    setActions([]);
    await say("", S.people[p.id].noEyes ? "你把油燈湊近門縫。白紗遮著她的眼睛，什麼也照不出來。" : "你把油燈湊近門縫，火光照亮了那張臉。");
    if (p.fake && ruleIs("fire")) {
      const R0 = S.rules.find(r => r.id === "fire");
      note(p, R0.note, 2);
      await say("", R0.flinch.replace(/\{n\}/g, name(p)));
    }
    // 破綻不在眼睛的畫皮：偶爾有細微的異樣（活人也偶爾會，所以只是弱線索）
    const O = S.lampOdd;
    if (!S.people[p.id].noEyes && !(p.fake && p.tell === "eye") && Math.random() < (p.fake ? O.fake : O.real)) {
      note(p, O.note, 1);
      await sleep(400);
      await say("", pick(O.text));
    }
    setActions(doorActions(p));
  }
  async function useMirror(p) {
    p.mirrored = true; (G.nightUsed = G.nightUsed || {}).mirror = true;
    setActions([]);
    if (p.fake) {
      SFX.sting();
      note(p, S.mirror.note, 3);
      await say("", S.mirror.fake.replace(/\{n\}/g, name(p)), true);
      if (!ruleIs("mirror")) { G.items.mirror--; await say("", S.mirror.crack, true); }
    } else await say("", S.mirror.real.replace(/\{n\}/g, name(p)), true);
    if (!hasTruth("mirror")) { await say("", TR().mirrorLine, true); truthClue("mirror"); }
    setActions(doorActions(p));
  }
  async function useDog(p) {
    p.sniffed = true; (G.nightUsed = G.nightUsed || {}).dog = true;
    G.food -= S.food.dog; updateTopbar();
    setActions([]);
    const acc = ruleIs("dog") ? S.dog.ruleAccuracy : S.dog.accuracy;
    const bark = p.fake ? Math.random() < acc : Math.random() < S.dog.falseBark * (ruleIs("dog") ? 0.2 : 1);
    if (bark) { SFX.jolt(); note(p, S.dog.barkNote, 1.5); }
    await say("", bark ? S.dog.bark : S.dog.quiet, true);
    setActions(doorActions(p));
  }
  async function useSalt(p) {
    G.items.salt--; p.salted = true; (G.nightUsed = G.nightUsed || {}).salt = true;
    setActions([]);
    await say("", `你從門縫遞出一碗鹽茶。`);
    await sleep(500);
    if (G.sand > 0) {                                   // 跟畫皮何老闆買的「鹽」，其實是沙
      G.sand--;
      await say("", S.special.salt.sandUsed, true);
    } else if (p.fake && !ruleIs("salty") && Math.random() < 0.7) await say(name(p), pick(["……不渴。", "（接過碗，沒有喝，又遞了回來。）", "茶涼了。我不喝涼的。"]));
    else await say(name(p), pick(["（一口氣喝乾）呼……活過來了。", "多謝掌櫃，鹹了點，不過暖和。", "（小口小口喝完了）謝謝。"]));
    setActions(doorActions(p));
  }
  // 沒開門（昏睡時）：跟拒之門外一樣決定命運，只是沒有畫面
  function refuseQuiet(p) {
    p.status = "refused"; p.leftHow = "refused"; markEnd(p, "");
    G.refusedLast.push(p);
    const r = Math.random();
    if (p.fake) { if (r < R().refusedFakeBack) scheduleBack(p, true); }
    else if (r < R().refusedDie) p.diedOutside = true;
    else scheduleBack(p, r < R().refusedDie + R().refusedFake);
  }

  async function decide(p, open) {
    // 開門、拒之門外都要再確認一次，避免誤觸
    const ok = await confirmBox(open ? `讓${name(p)}進門？\n開了門，就不能反悔了。` : `把${name(p)}擋在門外？\n雨很大。`, open ? "開門" : "拒之門外", !open);
    if (!ok) return;
    setActions([]);
    stage.classList.remove("lamp-on", "hands-view"); clearFx();
    if (p.ghost) {                                       // 死者回來叩門
      p.ghost = false;
      if (open) { SFX.door(); p.status = "in"; p.admittedNight = G.night; await say("", S.masterKnock.admitted.replace(/\{n\}/g, name(p)), true); }
      else {
        p.status = p.ghostPrev; p.fake = p.ghostOrig.fake; p.tell = p.ghostOrig.tell;   // 擋在門外：死者還是原本的死者
        p.ghostOrig.refused = true;
        SFX.sting(); await say("", S.masterKnock.refused, true); await remember();
      }
      const r0 = p._resolve; p._resolve = null; if (r0) r0();
      return;
    }
    if (open) {
      SFX.door();
      p.status = "in"; p.admittedNight = G.night;
      if (p.id === "wang" && !p.fake) G.flags.wangSeen = true;
      await say("", `你拉開門閂。\n${name(p)}跨過門檻，走進了歸雁樓。`, true);
    } else {
      p.status = "refused"; p.leftHow = "refused"; markEnd(p, "");
      G.refusedLast.push(p);
      const r = Math.random();
      if (p.fake) { if (r < R().refusedFakeBack) scheduleBack(p, true); }
      else if (r < R().refusedDie) p.diedOutside = true;
      else scheduleBack(p, r < R().refusedDie + R().refusedFake);
      G.stats.refused++;
      await say("", "你沒有開門。\n門外靜了很久，腳步聲才慢慢遠去。", true);
    }
    const r = p._resolve; p._resolve = null;   // 接回 knock() 的等待
    if (r) r();
  }

  async function knock(p, idx, total) {
    await fadeTo(async () => {
      clearFigures(); stage.classList.remove("hands-view");
      setScene("street_empty.jpg"); setGuestInfo(`第 ${idx + 1} 位客人／共 ${total} 位`);
      setActions([]); $("speaker").textContent = ""; $("text").textContent = "";
    });
    await sleep(400);
    SFX.knock();
    p.met = true; if (S.people[p.id].kind !== "passer") codexMark("met", p.id);
    if (!p.knockNight) p.knockNight = G.night;
    await say("", "叩、叩、叩。", true);
    const decided = new Promise(res => { p._resolve = res; });   // 先掛好，玩家可能在說話途中就做決定
    if (S.people[p.id].collarTell) p.collarShow = p.fake && Math.random() < S.people[p.id].collarTell;
    setScene(doorScene(p));
    setActions(doorActions(p));
    coach("door");
    if (p.id === "wang") truthClue("wang");
    const self = S.people[p.id].kind === "passer" ? S.people[p.id].doc.name : (S.people[p.id].callName || name(p));   // 自稱：過客用路引上的名字
    if (p.ghost) {
      await say("", S.masterKnock.knock.replace(/\{n\}/g, name(p)), true);
      setActions(doorActions(p));                         // 等點擊時按鈕被清掉了，放回來
      say(name(p), (p.id === S.mute.id ? S.mute.ghostSpeak + "\n" : "") + pick(S.masterKnock.lines));
    } else {
      const special = p.returning && p.leftReason === "special" && S.returns.special[p.id] && !p.specialUsed;
      if (special) p.specialUsed = true;
      if (p.returning && p.id === S.mute.id) { say("", S.mute.knockBack); await decided; return; }
      const kn = special ? S.returns.special[p.id].replace(/^叩、叩。\n/, "")
        : p.returning ? pick([].concat(S.returns.knock[p.leftHow === "refused" ? "refused" : "left"])).replace(/\{n\}/g, self) : S.people[p.id].knock;
      say(name(p), kn);
    }
    await decided;
  }

  // ---------- 過客：只住一晚的路人 ----------
  function clearPassers() {
    Object.keys(S.people).forEach(id => { if (S.people[id].kind === "passer") { delete S.people[id]; delete A.chars[id]; } });
  }
  function registerPasser(def) {
    S.people[def.id] = def;
    A.chars[def.id] = A.chars[def.art];
  }
  function makePasser() {
    const X = S.passers, sex = Math.random() < 0.5 ? "m" : "f", look = pick(X.looks[sex]);
    G.passerSeq = (G.passerSeq || 0) + 1;
    const id = `passer${G.passerSeq}`;
    const nm0 = pick(X.surnames) + pick(X.given[sex]);
    const [from, seal] = pick(X.from), [face, faceBad] = pick(look.faces), purpose = pick(X.purposes[sex]);
    const fill = t => t.replace(/\{f\}/g, from.replace("　", "")).replace(/\{p\}/g, purpose.split("　")[0]);
    const def = {
      id, kind: "passer", sex, art: look.art, name: X.tag + X.seq[(G.passerSeq - 1) % X.seq.length], room: "dorm", prefs: ["hall"],
      knock: pick(X.knock[sex]),
      doc: { name: nm0, from, age: pick(look.ages), face, faceBad, purpose, date: pick(X.dates),
             dateBad: S.dates[Math.min(S.dates.length - 1, G.night + 1)], seal },
      questions: X.questions.map(q => ({ q: q.q, real: fill(pick(q.real)), fake: pick(q.fake) })),
      chat: ["（過客縮在角落，一句話也不想多說。）"],
      refusedReal: X.refusedReal, refusedFake: X.refusedFake, admittedFake: X.dream.replace(/\{n\}/g, X.tag + X.seq[(G.passerSeq - 1) % X.seq.length])
    };
    (G.passerDefs = G.passerDefs || {})[id] = def;
    registerPasser(def);
    G.people[id] = { id, status: "out", fake: false, tell: null, known: false, affection: 0, loc: "hall", lamp: false, salted: false,
                     asked: new Set(), chatIdx: 0, room: "dorm", secretTold: false, met: false, passerNight: G.night };
    if (Math.random() < X.fakeChance) makeFake(G.people[id]);
    return G.people[id];
  }
  // 湊滿每晚的叩門人數；回來的人佔過客的名額，但至少來一位過客
  function passersTonight(already) {
    const n = Math.max(1, (E.knockPerNight || 3) - already);
    return Array.from({ length: n }, makePasser);
  }
  const isPasser = p => !!p && !!S.people[p.id] && S.people[p.id].kind === "passer";
  // 傍晚（入夜時）：昨晚住進來的過客走了
  function passersLeave(lines) {
    Object.values(G.people).filter(p => isPasser(p) && (p.status === "in" || p.status === "locked") && p.passerNight < G.night).forEach(p => {
      const X = S.passers, n = name(p), locked = p.status === "locked";
      lines.push((locked ? (p.fake ? X.leaveLocked : X.leaveLockedReal) : p.fake ? X.leaveFake : X.leaveReal).replace(/\{n\}/g, n));
      p.status = "gone"; p.leftHow = "passer"; p.returnNight = null; markEnd(p, "住了一晚，離開");
    });
  }

  async function startNight() {
    G.phase = "night";
    G.refusedLast = [];
    G.nightUsed = {};                                    // 燈和鹽茶，一夜各一次
    comeHome();
    clearFigures();
    const cfg = S.nights[G.night - 1];
    G.tells = { eye: pick(S.tells.eye), hand: pick(S.tells.hand), doc: pick(S.tells.doc) };

    // 門外事件（第二夜到攻城前一夜）
    let ev = null;
    if (!cfg.final && G.night >= 2 && G.night < S.nights.length && Math.random() < S.doorEvents.chance) ev = pick(S.doorEvents.list);
    if (ev && ev.id === "flood") G.noLeave = true;
    if (ev && ev.id === "ferry") G.ferry = true;
    const all = Object.values(G.people);
    if (ev && ev.id === "deserters") all.forEach(p => { if (p.returnNight > G.night) p.returnNight = G.night; });

    // 今晚來的客人：新客人＋延後的客人＋回來的人
    const fresh = [...(G.deferred || []), ...cfg.arrivals].map(P).filter(p => p && p.status === "out" && !p.returning);
    const back = all.filter(p => p.returnNight === G.night && (p.status === "refused" || p.status === "gone"));
    G.deferred = [];
    if (ev && ev.id === "curfew") {
      // 宵禁：今晚沒人來，新客人延到明晚，回來的人也晚一夜
      G.deferred = fresh.map(p => p.id);
      back.forEach(p => { p.returnNight = G.night + 1 < S.nights.length ? G.night + 1 : null; });
    }
    const arrivals = ev && ev.id === "curfew" ? [] : [...fresh, ...back];
    if (G.night === S.bigEvents.masterKnock.night) {
      const dead = Object.values(G.people).filter(p => p.status === "dead" || p.status === "murdered" || p.diedOutside);
      if (dead.length) {
        const g = pick(dead);
        g.ghostPrev = g.status; g.ghost = true; g.status = "out";
        g.ghostOrig = { fake: g.fake, tell: g.tell, night: G.night };   // 原本的身分，真相簿要用
        g.lamp = false; g.salted = false; g.asked = new Set();
        if (!g.fake) makeFake(g);
        arrivals.push(g);
      }
    }
    if (!cfg.final && !(ev && ev.id === "curfew") && !(G.sleepUntil && G.night <= G.sleepUntil)) arrivals.push(...passersTonight(arrivals.length));
    const chance = cfg.fakeChance ?? 0.45;
    fresh.forEach(p => { if (arrivals.includes(p) && (p.id === G.master || Math.random() < chance)) makeFake(p); });
    back.forEach(p => {
      if (!arrivals.includes(p)) return;
      p.status = "out"; p.returning = true; p.returnedNight = G.night; p.returnNight = null;
      p.lamp = false; p.salted = false; p.mirrored = false; p.sniffed = false; p.handAsked = false; p.asked = new Set();
      if (p.returnFake && !p.fake) { makeFake(p); p.replacedNight = G.night; }
      if (p.leftHow === "refused" && !p.fake) p.affection -= 2;   // 還在門外，先不跳提示
    });
    if (cfg.minFakes && arrivals.filter(p => p.fake).length < cfg.minFakes && arrivals.length) makeFake(pick(arrivals));

    setScene("loc_hall.jpg");
    $("hud").classList.remove("hidden");
    updateTopbar(); setGuestInfo("");
    const gone = []; passersLeave(gone);
    if (gone.length) await narrate(gone);
    if (G.sleepUntil && G.night <= G.sleepUntil) {
      // 昏睡中：沒有人開門
      arrivals.forEach(p => { if (p.ghost) { p.ghost = false; p.status = p.ghostPrev; } else refuseQuiet(p); });
      await narrate([S.romance.sleepNight]);
      if (cfg.final) return finalNight();
      return deepNight();
    }
    if (cfg.note) await narrate([cfg.note]);
    if (ev) await narrate([ev.text]);
    if (arrivals.some(p => p.ghost)) await narrate([S.masterKnock.note]);
    if (cfg.final) {                                    // 攻城夜：貼的是守城令
      $("speaker").textContent = ""; $("text").textContent = S.finalEve.edictText;
      setActions([]);
      await openDoc(S.finalEve.edict + `<p class="note">${S.era}${S.dates[G.night - 1]}</p>${seal("霜渡\n縣印", false)}`);
    } else if (arrivals.length) {                       // 沒有人叩門的夜，不用看告示
      $("speaker").textContent = ""; $("text").textContent = "櫃台上壓著縣衙今早送來的告示。";
      setActions([]);
      await openDoc(noticeHtml());
    }

    for (let i = 0; i < arrivals.length; i++) await knock(arrivals[i], i, arrivals.length);
    setGuestInfo("");
    if (cfg.final) return finalNight();
    await deepNight();
  }

  // ======================================================
  //  深夜：畫皮行動
  // ======================================================
  function massacreCheck() {
    const total = inside().length + 1;                 // +1 = 掌櫃
    return active().filter(p => p.fake).length * 2 > total;
  }

  async function deepNight() {
    $("hud").classList.add("hidden");
    await fadeTo(async () => setScene("loc_hall.jpg"));
    await narrate([G.mugwort ? "夜深了。\n艾草的煙在樓裡慢慢散開。" : "夜深了。\n你吹熄了大堂的燈。"]);
    await knownDeal();
    if (massacreCheck()) return ending("massacre");
    await resolvePlot();

    const replaced = [];
    // 戀人還是活人、還在樓裡，就會替你守夜
    refreshLover();
    const lover = G.lover && P(G.lover);
    const loverGuard = lover && lover.status === "in" && !lover.fake;
    if (loverGuard) G.guard = true;
    let chance = G.guard ? E.replaceChance / 2 : E.replaceChance;
    if (G.masterExposed) chance /= 2;
    if (G.complacent > 0) { chance *= 1.5; G.complacent--; }
    if (!G.mugwort) {
      active().filter(p => p.fake).forEach(f => {
        if (Math.random() >= chance) return;
        const victims = active().filter(v => !v.fake && !isPasser(v));
        if (!victims.length) return;
        // 畫皮會利用感情：優先找被換掉的人最親近的人下手
        const near = S.bonds.flatMap(b => b.a === f.id ? [b.b] : b.b === f.id ? [b.a] : [])
          .map(P).filter(v => v && v.status === "in" && !v.fake);
        const v = near.length && Math.random() < 0.5 ? pick(near) : pick(victims);
        makeFake(v); v.replacedNight = G.night;
        replaced.push(v);
      });
    }
    G.mugwort = false;
    resolveTail();
    // 樓裡的畫皮越多，掌櫃越睡不安穩（不直接告訴玩家）
    G.sanity -= 3 * active().filter(p => p.fake).length;

    // 夜裡的動靜：真人、畫皮都可能有，所以看不出誰是畫皮
    const lines = [];
    if (loverGuard) lines.push(S.lover.guard.replace("{l}", name(lover)));
    else if (G.guard) lines.push(S.guardNight);
    if (replaced.length) {
      SFX.sting();
      lines.push("三更時分，走廊上傳來拖行的聲音。\n有扇門開了，又關上。", "之後，什麼聲音也沒有了。");
      G.sanity -= 5;
    } else if (active().length && Math.random() < 0.7) {
      const who = pick(active());
      let ev = pick(S.nightEvents);
      // 啞姑不會說話：說話聲、開口回答的動靜，換成她自己的版本
      if (S.mute && who.id === S.mute.id && /說話聲|「睡不著」/.test(ev)) ev = pick(S.mute.nightQuiet);
      lines.push(ev.replace(/\{n\}/g, name(who)));
    } else {
      lines.push("這一夜，歸雁樓很安靜。\n只有雨聲。");
    }
    G.guard = false;
    await narrate(lines);

    // 噩夢：理智越低越常做。夢到誰都有可能，畫皮只是稍微常見一點
    const pool = active().filter(p => A.chars[p.id].eyes).flatMap(p => p.fake ? [p, p] : [p]);
    const dreamChance = Math.min(0.6, 0.15 + (100 - G.sanity) / 200);
    if (pool.length && Math.random() < dreamChance) {
      G.dreamt = G.dreamt || [];
      const fresh = pool.filter(p => !G.dreamt.includes(p.id) && !p.known);
      const d = pick(fresh.length ? fresh : pool);
      G.dreamt.push(d.id);
      await narrate(["你睡著了。\n你做了一個夢。"]);
      setScene(`event_${artOf(d.id)}.jpg`);
      SFX.sting();
      $("hud").classList.remove("hidden"); setGuestInfo("");
      await say("噩夢", S.people[d.id].admittedFake, true);
      $("hud").classList.add("hidden");
      await fadeTo(async () => setScene("loc_hall.jpg"));
      await narrate(["你猛地驚醒，渾身是汗。\n窗外只有雨聲。……只是夢吧？"]);
      G.sanity -= 5;
      if (G.night >= 3 && Math.random() < 0.4) await remember();   // 噩夢裡，偶爾想起從前的事
    }
    await morning();
  }

  // ======================================================
  //  天明：收房錢、開銷、壞結局檢查
  // ======================================================
  // 每天早上的去留結算：跟上一次結算比，誰離開、誰死了、誰住進來
  async function rosterDigest() {
    const D = S.digest, prev = G.rosterSnap || {}, now = {};
    const IN = ["in", "locked"], END = ["dead", "murdered"];
    const left = [], died = [], came = [];
    Object.values(G.people).forEach(p => {
      now[p.id] = p.status;
      const was = prev[p.id] || "out";
      if (p.status === "gone" && was !== "gone") left.push(name(p) + (p.endWhy ? `（${p.endWhy}）` : ""));
      else if (END.includes(p.status) && !END.includes(was)) died.push(name(p) + `（${p.endWhy || D.murdered}）`);
      else if (IN.includes(p.status) && !IN.includes(was)) came.push(name(p) + (was === "gone" ? D.back : ""));
    });
    G.rosterSnap = now;
    if (!left.length && !died.length && !came.length) return;
    const rows = [D.title.replace("{d}", S.dates[G.night - 1])];
    if (left.length) rows.push(D.left + left.join("\n　　　"));
    if (died.length) rows.push(D.died + died.join("\n　　　"));
    if (came.length) rows.push(D.came + came.join("、"));
    rows.push(D.count.replace("{n}", inside().length + 1));
    await narrate([rows.join("\n")]);
  }
  async function morning() {
    await fadeTo(async () => setScene("loc_kitchen.jpg"));
    const lines = ["雞鳴。\n灶房的火生起來了，天亮了。"];
    // 沒人看見的錯殺：屍體隔天才被發現，大家以為是畫皮幹的
    if ((G.unseenBodies || []).length) {
      G.unseenBodies.forEach(id => lines.push(S.witness.unseenMorning.replace(/\{v\}/g, nm(id))));
      G.unseenBodies = []; G.crowdAngry = true;
      const han = P("han");
      if (han && han.status === "in" && !han.fake && Math.random() < S.witness.hanInvestigate) {
        lines.push(S.witness.hanFound);
        G.wrongKills++;                                   // 被查出來，算一次縣衙警告
      }
    }
    if (G.murdered) {
      lines.push(S.plot.murderMorning.replace(/\{v\}/g, nm(G.murdered)) + (G.letterMissed ? "\n" + S.plot.notFound : ""));
      G.murdered = null; G.letterMissed = false; G.crowdAngry = true;
    }
    if (G.tailReport) { lines.push(G.tailReport); G.tailReport = null; }
    if (G.plot && !plotLive()) { lines.push(fillPlot(S.plot.off)); G.plot = null; }
    const C = S.crowd;
    if (G.quarrel && G.quarrel.night < G.night + 1) {
      const x = P(pick([G.quarrel.a, G.quarrel.b]));
      if (x && x.status === "in") {
        if (keepable(x)) wantLeave(x, C.quarrel.leave.replace(/\{x\}/g, name(x)), "吵架沒人調解，退房");
        else { leaveInn(x, "left", "吵架沒人調解，退房"); lines.push(C.quarrel.leave.replace(/\{x\}/g, name(x))); }
      }
      G.quarrel = null;
    }
    if (G.theft) {
      const v = P(G.theft.v);
      if (v && v.status === "in") { if (keepable(v)) wantLeave(v, C.theft.leave.replace(/\{v\}/g, name(v)), "錢袋沒找回，退房"); else { leaveInn(v, "left", "錢袋沒找回，退房"); lines.push(C.theft.leave.replace(/\{v\}/g, name(v))); } }
      G.theft = null;
    }
    Object.values(G.people).forEach(q => {
      if (q.sober !== undefined && q.status === "locked") { q.status = "in"; q.loc = "hall"; lines.push(C.drunk.release.replace(/\{a\}/g, name(q))); }
      delete q.sober;
      if (q.hurt && q.status === "in" && G.night >= q.hurt.deadline) {
        q.status = "dead"; q.diedOfWounds = true; q.hurt = null; markEnd(q, "傷重不治");
        lines.push(C.died.replace(/\{t\}/g, name(q)));
      }
    });
    // 阿福追啞姑：每兩夜前進一步
    const af = P("afu"), yg = P("yagu"), AC = S.afuCourt;
    if (G.lovers.includes("yagu") && af && af.status === "in" && !af.fake) {
      af.leftReason = "special"; leaveInn(af, "left", "啞姑選了你，黯然離開"); lines.push(AC.lost);
    } else if (af && yg && af.status === "in" && yg.status === "in" && !af.fake && !yg.fake && !G.flags.afuYagu && !G.lovers.includes("yagu") && AC.nights.includes(G.night)) {
      G.afuCourt = (G.afuCourt || 0) + 1;
      lines.push(AC.steps[G.afuCourt - 1]);
      if (G.afuCourt >= AC.steps.length) G.flags.afuYagu = true;
    }
    // 顧老的木像
    if (G.carve) {
      const g = P("gu"), t = P(G.carve);
      if (g && isIn(g) && t) {
        const faceless = g.fake || t.fake;
        lines.push((faceless ? S.special.carve.fake : S.special.carve.real).replace(/\{v\}/g, name(t)));
        if (faceless) note(t, "顧老雕的木像，刻不出臉", 3);
      }
      G.carve = null;
    }
    if (G.silentSwap) { lines.push(G.silentSwap); G.silentSwap = null; G.sanity -= 5; }
    // 香灰：昨天撒的，看今早有沒有腳印
    if (G.ash === G.night - 1) {
      G.ash = null;
      const fk = active().filter(p => p.fake);
      if (!hasTruth("ash") && G.night >= 3 && Math.random() < 0.25) { lines.push(TR().ashLine); truthClue("ash"); }
      else if (fk.length && Math.random() < S.ash.hitChance) lines.push(S.ash.hit.replace(/\{b\}/g, bedName(roomOf(pick(fk)))));
      else lines.push(S.ash.none);
    }
    // 黑子：樓裡有畫皮，就有可能被毒死
    if (dogOk() && active().some(p => p.fake) && Math.random() < S.dog.poisonChance) { G.dog.alive = false; lines.push(S.dog.poison); }
    // 進行中的託付：要找的人已經不在（也不會回來），這條託付就辦不成了
    questLostCheck().forEach(t => lines.push(t));

    G.refusedLast.forEach(p => {
      const d = S.people[p.id];
      const t = (p.returnNight ? null : p.fake ? d.refusedFake : d.refusedReal) || pick(R().neutral).replace(/\{n\}/g, d.name);
      lines.push(`昨夜被你擋在門外的${d.name}——\n${t}`);
    });

    Object.values(G.people).filter(p => p.hanEscape && p.status === "locked").forEach(p => {
      p.hanEscape = null; leaveInn(p, "left", "從柴房逃走");
      lines.push(S.hanCall.escape.replace(/\{n\}/g, name(p)));
      const h = P("han"); if (h) note(h, S.hanCall.escapeNote, 3);
    });
    const stay = G.noLeave; G.noLeave = false;
    if (G.ferry) {
      G.ferry = false;
      const cand = active().filter(p => S.people[p.id].kind === "guest" && !p.fake);
      if (cand.length && Math.random() < 0.6 && !stay) { const f = pick(cand), t = S.doorEvents.ferryLeave.replace(/\{n\}/g, name(f)); if (keepable(f)) wantLeave(f, t, "渡口開船，搭船離開"); else { leaveInn(f, "left", "渡口開船，搭船離開"); lines.push(t); } }
    }
    if (!stay) G.griefQueue.forEach(({ id, text, why }) => {
      const o = P(id);
      if (o && o.status === "in") {
        if (keepable(o)) wantLeave(o, text, why || "心寒離開");
        else { leaveInn(o, "left", why || "心寒離開"); lines.push(text); }
      }
    });
    if (!stay) G.griefQueue = [];

    if (G.pendingLeave && !stay) {
      const leaver = active().filter(p => S.people[p.id].kind === "guest");
      if (leaver.length) {
        const l = pick(leaver), t = `${name(l)}一大早就結了帳，冒雨走了。昨天的事，嚇壞了他們。`;
        if (keepable(l)) wantLeave(l, t, "被樓裡的事嚇得退房"); else { leaveInn(l, "left", "被樓裡的事嚇得退房"); lines.push(t); }
      }
      G.pendingLeave = false;
    }

    // 房錢：依身分付現、以工抵租、幫忙做事、跑腿
    const payers = active().filter(p => ["guest", "passer"].includes(S.people[p.id].kind));
    let cash = 0, paperAmt = 0, cashCount = 0;
    const payNotes = [];
    // 第一次寫完整的一句；之後同一種付法的人合成一句（畫皮做事不對勁的描述每次都寫，那是線索）
    G.paySeen = G.paySeen || {};
    const again = { labor: [], help: [], errand: [] };
    let helpFood = 0;
    const note1 = (p, t, type) => { if (G.paySeen[p.id]) again[type].push(p); else { G.paySeen[p.id] = true; payNotes.push(t.replace(/\{n\}/g, name(p))); } };
    payers.forEach(p => {
      const pay = (S.pay || {})[p.id];
      if (!pay) {
        cashCount++;
        if (p.fake) paperAmt += E.roomRate; else cash += E.roomRate;
      } else if (pay.type === "labor") {
        // 以工抵租：不收錢；畫皮也照樣說得像模像樣（看不出來）
        const done = pay.doneFlag && G.flags[pay.doneFlag] && !p.fake;
        if (done && !G.paySeen[p.id + ":done"]) { G.paySeen[p.id + ":done"] = true; payNotes.push(pay.textDone); }
        else note1(p, pay.text, "labor");
      } else if (pay.type === "help") {
        if (p.fake) payNotes.push(pay.fakeText.replace(/\{n\}/g, name(p)));
        else { G.food = (G.food || 0) + (pay.food || 1); helpFood += pay.food || 1; note1(p, pay.text, "help"); }
      } else if (pay.type === "errand") { if (p.fake) { if (!p.known) payNotes.push(pay.fakeText); } else note1(p, pay.text, "errand"); }
    });
    const RP = S.payRepeat, list = ps => ps.map(name).join("、");
    if (again.labor.length) payNotes.push(RP.labor.replace("{l}", list(again.labor)));
    if (again.help.length) payNotes.push(RP.help.replace("{l}", list(again.help)).replace("{c}", again.help.reduce((a, p) => a + (S.pay[p.id].food || 1), 0)));
    if (again.errand.length) payNotes.push(RP.errand.replace("{l}", list(again.errand)));
    const rentTotal = cash + paperAmt, gain = cash;
    let ledger = cashCount ? `你在櫃台點收昨夜的房錢：${cashCount} 位客人，共 ${rentTotal} 文。` : "昨夜沒有付現錢的客人。";
    if (paperAmt) { ledger += `\n可是有 ${paperAmt} 文……摸起來是紙做的。\n樓裡有人付的是冥錢。你把紙錢收進櫃台的抽屜。`; G.paper = (G.paper || 0) + paperAmt; }
    else if (cashCount) ledger += "\n每一枚都是真銅錢。";
    lines.push(ledger);
    if (payNotes.length) lines.push(payNotes.join("\n"));
    G.stats.paper += paperAmt;
    (G.ledger = G.ledger || []).push({ date: S.dates[G.night - 1], total: rentTotal, paper: paperAmt });

    G.coins += gain;
    let money = "";
    if (E.taxNights.includes(G.night)) { const t = taxOf(G.night); G.coins -= t; money = `繳了縣衙稅銀 ${t} 文，`; }
    lines.push(`${money}你手上還有 ${G.coins} 文。`);
    if (E.taxNights.includes(G.night + 1) && G.coins >= 0) {           // 明天收稅：先通知
      const t = taxOf(G.night + 1), W = S.taxWarn;
      lines.push(W.text.replace("{c}", t) + (G.coins < t ? "\n" + W.short.replace("{h}", G.coins).replace("{d}", t - G.coins) : ""));
    }

    await narrate(lines);
    if (await staffStay()) return;
    await rosterDigest();
    if (await mindCheck()) return;
    if (G.wrongKills >= 2) return ending("jailed");
    if (G.coins < 0) return ending("seized");

    const total = inside().length + 1, fakes = active().filter(p => p.fake).length;
    G.warned = fakes * 2 >= total - 1 && fakes > 0;
    await day();
  }

  // ======================================================
  //  白天：客棧地圖
  // ======================================================
  function assignLocations() {
    const count = {};
    Object.keys(S.locations).forEach(l => count[l] = 0);
    shuffle(inside()).forEach(p => {
      if (p.status === "locked") { p.loc = "woodshed"; count.woodshed++; return; }
      if (p.hurt && S.locations[roomOf(p)]) { p.loc = roomOf(p); count[p.loc]++; return; }     // 傷著、病著：躺在房裡
      const prefs = p.fake && Math.random() < 0.6 ? S.fakePrefs : S.people[p.id].prefs;
      const want = [pick(prefs), ...prefs, "hall"].find(l => count[l] < S.locations[l].cap);
      p.loc = want || "hall"; count[p.loc]++;
    });
    // 有劇情要發生的兩人，白天常會湊到同一個地方
    const sc = S.scenes.find(s => ready(s) && s.who.every(w => P(w) && P(w).status === "in" && !P(w).hurt));
    if (sc && Math.random() < 0.8) {
      const first = P(sc.who[0]);
      const others = sc.who.slice(1).map(P).filter(p => p.loc !== first.loc);
      const n = inside().filter(p => p.loc === first.loc).length;
      const loc = n + others.length <= S.locations[first.loc].cap ? first.loc : "hall";
      sc.who.map(P).forEach(p => { p.loc = loc; });
    }
  }
  const sceneHere = here => S.scenes.some(s => ready(s) && s.who.every(w => here.some(p => p.id === w)));

  async function day() {
    G.phase = "day";
    G.closing = false;
    if (G.sleepUntil) {
      if (G.night < G.sleepUntil) {                     // 還在昏睡：今天跳過
        await narrate([S.romance.sleepDay]);
        G.closing = false;
        return endDay(true);
      }
      G.sleepUntil = 0;
      await narrate([S.romance.wake]);
    }
    G.ap = G.tired ? Math.ceil(E.actionsPerDay / 2) : E.actionsPerDay;   // 守了一夜，今天很累
    G.tired = false;
    G.loc = "hall"; G.sel = null;
    assignLocations();
    G.phantom = null;
    SFX.setUnease(active().filter(p => p.fake).length / (inside().length + 1) * 2);
    $("hud").classList.remove("hidden");
    updateTopbar();
    await goTo("hall", true);
    if (G.warned) await say("", S.warnQuiet, true);
    await startPlot();
    await bigEventToday();
    if (G.phase === "day") await crowdEvent();
    if (G.phase !== "day") return;                       // 查房查出事，可能直接結局
    if (G.crowdAngry) { G.crowdAngry = false; await assembly(true); }   // 出了人命，大家自己聚到大廳
    if (!G.dog && G.night >= S.dog.dayFound) { G.dog = { alive: true }; await say("", S.dog.found, true); await say("", TR().dogLine, true); truthClue("dog"); }
    await truthLayer2();
    // 看過墳、還沒問秦嬸，秦嬸就不在了：自己想通（避免主線卡死）
    { const q = P("qin"), tr = G.truth;
      if (tr && tr.grave && tr.layer === 2 && !(q && q.status === "in" && !q.fake)) { await say("", TR().selfThird, true); await truthLayer3(); } }
    await dayEvent();
    if (G.phase !== "day") return;
    const gone = pickAway();
    if (gone.length) await say("", S.outing.announce.replace("{l}", gone.map(name).join("、")), true);
    makePhantom();
    autoSave("day");
    await showLocation();
  }

  // ---------- 人多的衝突：打架、吵架、偷竊、酒醉、搶飯、生病 ----------
  const hurtOf = p => p && p.hurt && p.status === "in";
  function hurt(p, type) { p.hurt = { type, deadline: G.night + S.crowd.hurtDays }; }
  function pairPick(pool) {
    // 有舊怨的人優先湊成一對
    const pairs = [];
    pool.forEach(a => (S.grudges[a.id] || []).forEach(b => { const q = P(b); if (q && pool.includes(q)) pairs.push([a, q]); }));
    if (pairs.length && Math.random() < 0.6) return pick(pairs);
    const a = pick(pool), b = pick(pool.filter(x => x !== a));
    return b ? [a, b] : null;
  }
  async function crowdEvent() {
    const C = S.crowd, n = inside().length;
    const chance = (C.levels.find(([k]) => n >= k) || [0, 0])[1];
    if (!chance || Math.random() > chance) return;
    const pool = active().filter(p => !p.hurt);
    if (pool.length < 2) return;
    const fill2 = (t, a, b, extra = {}) => t.replace(/\{a\}/g, name(a)).replace(/\{b\}/g, b ? name(b) : "").replace(/\{d\}/g, C.hurtDays).replace(/\{c\}/g, extra.c ?? "").replace(/\{x\}/g, extra.x ? name(extra.x) : "");
    const kinds = ["fight", "quarrel", "theft", "drunk", "sick"];
    if (G.famine) kinds.push("grab");
    const k = pick(kinds);
    const adults = pool.filter(p => !C.noTrouble.includes(p.id));
    if (k === "fight") {
      let [a, b] = pairPick(pool) || [];
      if (a && C.noTrouble.includes(a.id)) [a, b] = [b, a];
      if (a && C.noTrouble.includes(a.id)) return;
      if (!a) return;
      await say("衝突", fill2(C.fight.text, a, b), true);
      if (a.fake) await say("", fill2(C.fight.fakeStay, a, b), true);
      else {
        if (S.mute && a.id === S.mute.id) await say("", fill2(C.fight.leaveMute, a, b), true);
        else await say(name(a), fill2(C.fight.leave, a, b), true);
        if (keepable(a)) wantLeave(a, fill2(C.fight.gone, a, b), "打架後離開"); else leaveInn(a, "left", "打架後離開");
      }
      if (b.fake) await say("", fill2(C.fight.fakeHurt, a, b), true);
      hurt(b, "injured");
      await say("", fill2(C.fight.hurt, a, b), true);
      await staffStay();
    } else if (k === "quarrel") {
      const [a, b] = pairPick(pool) || [];
      if (!a) return;
      G.quarrel = { a: a.id, b: b.id, night: G.night };
      await say("衝突", fill2(C.quarrel.text, a, b), true);
      await say("", C.quarrel.task, true);
    } else if (k === "theft") {
      const v = pick(pool), t = pick(pool.filter(x => x !== v));
      if (!t) return;
      G.theft = { v: v.id, t: t.id, night: G.night };
      await say("衝突", fill2(C.theft.text.replace(/\{v\}/g, name(v)), v), true);
      await say("", C.theft.task.replace(/\{v\}/g, name(v)), true);
    } else if (k === "drunk") {
      if (!adults.length) return;
      const a = pick(adults);
      if (a.fake) { await say("衝突", fill2(C.drunk.fakeText, a), true); note(a, "喝了一整罈酒，一點醉意也沒有", 2); return; }
      const c = 20 + Math.floor(Math.random() * 3) * 10;
      await say("衝突", fill2(C.drunk.text, a), true);
      const pay = await choose("要怎麼處理？", [{ label: fill2(C.drunk.pay, a, null, { c }), value: true, disabled: G.coins < c }, { label: C.drunk.lock, value: false }]);
      if (pay) { G.coins -= c; updateTopbar(); await say("", fill2(C.drunk.paid, a, null, { c }), true); }
      else { a.status = "locked"; a.loc = "woodshed"; a.sober = G.night; await say("", fill2(C.drunk.locked, a), true); }
    } else if (k === "grab") {
      const [a, b] = pairPick(pool) || [];
      if (!a) return;
      await say("衝突", fill2(C.grab.text, a, b), true);
      affect(b, -1);
      if (!b.fake) { hurt(b, "sick"); await say("", fill2(C.grab.sick, a, b), true); }
    } else if (k === "sick") {
      const a = pick(pool);
      if (a.fake) { await say("衝突", fill2(C.sick.fake, a), true); note(a, "淋了一夜雨，一點事也沒有", 2); return; }
      hurt(a, "sick");
      await say("衝突", fill2(C.sick.text, a), true);
      await say("", fill2(C.sick.hurt, a), true);
    }
  }
  // 調解吵架
  async function mediate() {
    const C = S.crowd.quarrel, q = G.quarrel, a = P(q.a), b = P(q.b);
    spend(); setActions([]);
    const t = x => x.replace(/\{a\}/g, name(a)).replace(/\{b\}/g, name(b));
    const c = await choose("要怎麼調解？", [{ label: t(C.sideA), value: "a" }, { label: t(C.sideB), value: "b" }, { label: C.wine, value: "w", disabled: G.coins < E.winePrice }]);
    G.quarrel = null;
    if (c === "w") {
      G.coins -= E.winePrice; updateTopbar();
      const avg = (Math.max(0, a.affection) + Math.max(0, b.affection)) / 2;
      if (Math.random() < 0.5 + avg * 0.1) { affect(a, 1); affect(b, 1); await say("", t(C.wineOk), true); }
      else { await say("", t(C.wineFail), true); [a, b].forEach(x => { if (Math.random() < 0.5) G.griefQueue.push({ id: x.id, text: C.leave.replace(/\{x\}/g, name(x)), why: "調解不成，退房" }); }); }
    } else {
      const loser = c === "a" ? b : a;
      affect(loser, -2);
      if (S.locations[roomOf(loser)]) loser.loc = roomOf(loser);
      await say("", C.sided.replace(/\{x\}/g, name(loser)), true);
      if (Math.random() < 0.5) G.griefQueue.push({ id: loser.id, text: C.leave.replace(/\{x\}/g, name(loser)), why: "調解時你沒站他那邊，退房" });
    }
    await showLocation();
  }
  // 治療：請治療者，或自己用金創藥
  async function heal(healer) {
    const C = S.crowd, sick = inside().filter(hurtOf);
    const t = await choose(C.healAsk.replace("{n}", name(healer)), [...sick.map(x => ({ label: `${name(x)}（${C.tag[x.hurt.type]}）`, value: x })), { label: "算了", value: null }]);
    if (!t) return selectPerson(healer);
    spend(); setActions([]);
    if (healer.fake) { t.hurt.deadline--; await say("", C.healFake.replace(/\{n\}/g, name(healer)).replace(/\{t\}/g, name(t)), true); note(healer, "治療之後，傷勢反而更重了", 2.5); }
    else { t.hurt = null; affect(t, 1); await say("", C.healOk.replace(/\{n\}/g, name(healer)).replace(/\{t\}/g, name(t)), true); }
    await afterAction(healer);
  }
  async function useMedicine(p) {
    const C = S.crowd;
    spend(); G.items.medicine--; setActions([]);
    if (Math.random() < 0.5) { p.hurt = null; affect(p, 1); await say("", C.medOk.replace(/\{t\}/g, name(p)), true); }
    else await say("", C.medFail.replace(/\{t\}/g, name(p)), true);
    await afterAction(p);
  }

  // ---------- 大事件 ----------
  async function bigEventToday() {
    const B = G.big || {};
    if (B.relief === G.night && !B.reliefDone) { B.reliefDone = true; await reliefEvent(); }
    if (B.inspect === G.night && !B.inspectDone) { B.inspectDone = true; await inspectEvent(); }
    if (B.famine === G.night && !G.famine) {
      G.famine = true;
      await say("斷糧", S.famine.start, true);
      const ck = cookOf();
      if (ck && !ck.fake && ck.id === "qin") await say(name(ck), S.famine.qinHelp, true);
      else if (ck && !ck.fake && ck.id === "yagu") await say("", S.famine.yaguHelp, true);
    }
  }
  // 假援軍：一份公文，真假各半
  async function reliefEvent() {
    const X = S.relief, real = Math.random() < 0.5;
    await say("公文", X.intro, true);
    await openDoc(X.doc.replace("{date}", S.era + S.dates[G.night - 1]).replace("{seal}", seal("霜渡\n縣印", !real)));
    if (G.flags.sealCopy) await say("", real ? S.sealCopy.docOk : S.sealCopy.docBad, true);
    const believe = await choose(X.ask, [{ label: X.believe, value: true }, { label: X.doubt, value: false }]);
    if (believe && real) { G.sanity = Math.min(100, G.sanity + 10); await say("", X.trueBelieve, true); }
    else if (believe) { G.complacent = 2; await say("", X.fakeBelieve, true); await say("", X.fakeAfter, true); }
    else await say("", real ? X.trueDoubt : X.fakeDoubt, true);
  }
  // 縣衙查房：柴房關著的人要解釋；沒人看見的錯殺可能被查到
  async function inspectEvent() {
    const X = S.inspect;
    await say("查房", X.intro, true);
    for (const p of inside().filter(q => q.status === "locked")) {
      await say("官差", X.locked.replace(/\{n\}/g, name(p)), true);
      const c = await choose("要怎麼回答？", [{ label: X.explain, value: "explain" }, { label: X.bribe, value: "bribe", disabled: G.coins < 30 }]);
      if (c === "bribe") { G.coins -= 30; await say("", X.bribed, true); }
      else if (p.fake) await say("", X.explainFake.replace(/\{n\}/g, name(p)), true);
      else { G.coins -= 40; await say("", X.explainReal, true); }
      updateTopbar();
    }
    const victims = Object.values(G.people).filter(q => q.secretKilled);
    if (victims.length && Math.random() < 0.4) {
      await say("查房", X.found.replace(/\{n\}/g, name(pick(victims))), true);
      G.wrongKills++;
      if (G.wrongKills >= 2) return ending("jailed");
    } else await say("", X.clean, true);
  }

  // ---------- 小驚嚇：地圖上多一個人 ----------
  function makePhantom() {
    G.phantom = null;
    if (Math.random() > S.phantom.chance) return;
    const empty = Object.keys(S.spots).filter(l => l !== "woodshed" && !inside().some(p => p.loc === l));
    if (!empty.length) return;
    const loc = pick(empty), r = Math.random();
    const ppl = active().filter(p => p.loc !== "woodshed" && !p.away);
    if (r < 0.5 && ppl.length) {                     // 某個人一早就躲在那裡：其他地方都找不到他
      const p = pick(ppl);
      p.hideFrom = p.loc; p.loc = loc; p.hiding = true;
      G.phantom = { loc, done: false, kind: "person", who: p.id };
    } else G.phantom = { loc, done: false, kind: r < 0.8 ? "nothing" : "critter" };
  }
  const hidingNow = p => !!p.hiding;
  function unhide(p) { p.hiding = false; p.hideFrom = null; }
  // 黃昏還沒去查看：藏著的人自己走出來
  function phantomDusk() {
    const ph = G.phantom;
    if (!ph || ph.done || ph.kind !== "person" || !isDusk()) return "";
    ph.done = true;
    const p = P(ph.who);
    if (!p || !p.hiding) return "";
    const s = S.spots[ph.loc];
    unhide(p);                                       // 他就從那個角落走出來，留在那裡
    if (p.status !== "in") return "";
    const PH = S.phantom, mute = S.mute && p.id === S.mute.id;
    const t = G.loc !== ph.loc ? PH.duskOutAway.replace("{l}", S.locations[ph.loc].name) : mute ? PH.duskOutMute : PH.duskOut;
    return t.replace(/\{n\}/g, name(p)).replace(/\{s\}/g, s);
  }
  const phantomHere = () => G.phantom && !G.phantom.done && G.phantom.loc === G.loc;

  function jumpOverlay(src, silhouette) {
    const d = document.createElement("div");
    d.className = "jump" + (silhouette ? " shadow" : "");
    d.innerHTML = `<img src="assets/${src}" alt="">`;
    stage.appendChild(d);
    setTimeout(() => d.remove(), silhouette ? 380 : 1400);
  }

  async function checkPhantom() {
    const ph = G.phantom; ph.done = true;
    setActions([]);
    const s = S.spots[G.loc], ppl = active().filter(p => p.loc !== "woodshed" && !p.away && !p.hiding);   // 出門的人不在樓裡
    const hid = ph.kind === "person" ? P(ph.who) : null;
    if (hid && hid.hiding && hid.status === "in") {
      const p = hid;
      SFX.jolt(); jumpOverlay(`fig_${artOf(p.id)}.png`);
      unhide(p);                                              // 他一早就躲在這裡
      G.sanity -= 3;
      await sleep(500);
      const txt = p.id === S.mute.id && !p.fake ? S.mute.phantom : pick(p.fake ? S.phantom.personFake : S.phantom.personReal);
      await say("", fill(txt, p).replace(/\{s\}/g, s), true);
    } else if (ph.kind !== "critter") {
      if (hid) unhide(hid);
      const p = pick(ppl.length ? ppl : Object.values(G.people).filter(q => q.status !== "out"));
      SFX.jolt(); if (p) jumpOverlay(`fig_${artOf(p.id)}.png`, true);
      G.sanity -= 5;
      await sleep(450);
      await say("", pick(S.phantom.nothing).replace(/\{s\}/g, s), true);
      G.phantomAfter = true;                                  // 下一幕接著說，不要突兀地寫「一個人也沒有」
    } else {
      SFX.lamp();
      await say("", pick(S.phantom.critter).replace(/\{s\}/g, s), true);
    }
    await showLocation();
  }

  // ---------- 殺人預告 ----------
  // {r}＝被點名的睡處、{n}＝兇手、{b}＝被問起的人
  const fillPlot = (t, extra = {}) => t.replace(/\{r\}/g, G.plot ? bedName(G.plot.room) : "").replace(/\{n\}/g, extra.n ?? (G.plot ? nm(G.plot.culprit) : "")).replace(/\{b\}/g, extra.b ?? "");
  // 還沒搜過的密函候選地點
  const plotLive = () => !!G.plot && !!P(G.plot.culprit) && ["in", "locked"].includes(P(G.plot.culprit).status);
  const letterLeft = () => plotLive() && !G.plot.found ? G.plot.candidates.filter(l => !G.plot.searched.includes(l)) : [];
  const locNames = ls => ls.map(l => S.locations[l].name).join("、");
  const roomOf = p => p.room || "dorm";
  function plotRemind() {
    if (!G.plot) return setGuestInfo("");
    if (!G.plot.found) return setGuestInfo(S.plot.searching.replace("{l}", locNames(letterLeft())));
    const w = G.plot.killNight === G.night + 1 ? "今晚" : "明晚";
    setGuestInfo(fillPlot(S.plot.remind).replace("{w}", w) + (G.plot.guarded ? "・你今晚守夜" : ""));
  }
  // 殺人預告：先只知道「樓裡藏了一封密函」，要在 3–4 個可能的地點裡找到真的那一封
  // 密函只寫睡處和時辰，不寫要換誰
  async function startPlot() {
    if (G.plot) { plotRemind(); return; }
    if (G.night > S.nights.length - 4 || Math.random() > S.plot.chance) return;     // 最後一夜是攻城夜，預告最晚在前一夜動手
    const fakes = active().filter(p => p.fake);
    if (!fakes.length) return;
    const culprit = pick(fakes);
    const rooms = [...new Set(active().filter(p => !p.fake && p !== culprit && !isPasser(p)).map(roomOf))];
    if (!rooms.length) return;
    const candidates = shuffle(Object.keys(S.spots)).slice(0, Math.random() < 0.3 ? 4 : 3);
    G.plot = { culprit: culprit.id, room: pick(rooms), killNight: G.night + 2, victimTold: false,
               found: false, letterLoc: pick(candidates), candidates, searched: [], guarded: false };
    SFX.sting();
    await say("密函", pick(S.plot.rumor), true);
    await say("", S.plot.candidates.replace("{l}", locNames(candidates)), true);
    plotRemind();
  }
  async function searchLetter() {
    spend(); setActions([]);
    const pl = G.plot, s = S.spots[G.loc];
    if (G.loc === pl.letterLoc) {
      pl.found = true;
      SFX.sting();
      await say("", S.plot.searchHit.replace("{s}", s), true);
      await say("密函", fillPlot(pick(S.plot.notice)), true);
    } else {
      pl.searched.push(G.loc);
      await say("", pick(S.plot.searchMiss).replace(/\{s\}/g, s), true);
    }
    await showLocation();
  }
  // 掌櫃親自守夜：只能在動手的那一天、到被點名的睡處去
  const guardLoc = () => G.plot && G.plot.found && S.beds[G.plot.room] ? S.beds[G.plot.room].loc : null;
  async function guardRoom() {
    if (!(await confirmBox(fillPlot(S.plot.guardConfirm), "守夜"))) return;
    G.plot.guarded = true;
    await say("", fillPlot(S.plot.guardSet), true);
    await showLocation();
  }
  // 找到證據：在人物頭上標記
  async function gotEvidence(text, extra) {
    const c = P(G.plot.culprit);
    c.evidence = true;
    note(c, "行兇證據：" + fillPlot(text, extra).replace(/\n/g, ""), 3);
    await say("證據", fillPlot(text, extra), true);
    renderFigures();
  }
  const isCulprit = p => G.plot && G.plot.culprit === p.id && p.status === "in";

  // 深夜：預告的那一晚
  async function resolvePlot() {
    const pl = G.plot;
    if (!pl || pl.killNight !== G.night) return;
    const c = P(pl.culprit);
    const occupants = active().filter(p => !p.fake && p !== c && roomOf(p) === pl.room);
    if (!occupants.length) { G.plot = null; return; }               // 那間房已經沒有活人了
    if (c.status === "locked") { const t = fillPlot(S.plot.foiledLocked); G.plot = null; G.sanity = Math.min(100, G.sanity + 5); return narrate([t]); }
    if (c.status !== "in") { const t = fillPlot(S.plot.foiledGone); G.plot = null; return narrate([t]); }
    if (G.mugwort) { pl.killNight++; return narrate([fillPlot(S.plot.foiledMugwort)]); }
    if (pl.guarded) {                                               // 你守住了，還瞥見了兇手的一個特徵
      const t = S.traits[c.id] || {}, Gl = S.plot.glimpse;
      const opts = [];
      if (t.sex) opts.push({ text: Gl.sex[t.sex], k: "sex", v: t.sex });
      if (t.age) opts.push({ text: Gl.age[t.age], k: "age", v: t.age });
      opts.push({ text: Gl.bed.replace("{b}", bedName(roomOf(c))), k: "bed", v: roomOf(c) });
      const o = pick(opts), g = o.text;
      (G.glimpses = G.glimpses || []).push(g);
      (G.glimpseTraits = G.glimpseTraits || []).push(o);
      G.plot = null; G.tired = true;
      return narrate([fillPlot(S.plot.guarded).replace("{g}", g)]);
    }
    const lover = G.lover && P(G.lover);
    if (lover && lover.status === "in" && !lover.fake && Math.random() < 0.5) {
      G.plot = null;
      return narrate([fillPlot(S.plot.loverGuard).replace("{l}", name(lover))]);
    }
    const v = pick(occupants);
    if (Math.random() < S.plot.replaceChance) {
      // 無聲地換掉一個人：天亮後大家都在，但其中一個已經不是原來的人
      makeFake(v); v.replacedNight = G.night;
      G.silentSwap = pl.found ? fillPlot(S.plot.replacedFound) : S.plot.replacedVague;
    } else {
      SFX.sting();
      if (pl.found) await narrate([fillPlot(S.plot.murder)]);
      v.status = "murdered"; v.killedBy = c.id; markEnd(v, ""); G.murdered = v.id; G.sanity -= 10; G.letterMissed = !pl.found;
    }
    G.plot = null;
  }

  // ---------- 劇情：旁聽的對話與白天事件 ----------
  const ready = x => G.night >= (x.night || 1) && !G.done.has(x.id) && (!x.need || G.done.has(x.need));

  // 從在場的人裡找一段還沒演過的劇情；有畫皮在場就演畫皮版
  async function playScene(present) {
    const ids = present.map(p => p.id);
    const sc = S.scenes.find(s => ready(s) && s.who.every(w => ids.includes(w)));
    if (!sc) return false;
    G.done.add(sc.id);
    const fake = sc.who.map(P).find(p => p.fake);
    if (fake) {
      const alt = sc.fake && sc.fake[fake.id];
      await playLines(alt || [sc.lines[0], ["", S.fakeTwist]], { f: name(fake) });
    } else {
      await playLines(sc.lines);
      if (sc.sanity) G.sanity = Math.min(100, G.sanity + sc.sanity);
      if (sc.effect === "guard") G.guard = true;
    }
    return true;
  }

  async function dayEvent() {
    const ev = S.events.find(e => ready(e) && e.who.every(w => P(w) && P(w).status === "in"));
    if (!ev || Math.random() > 0.75) return;
    G.done.add(ev.id);
    const fake = ev.who.map(P).find(p => p.fake);
    if (fake) {                                      // 畫皮混在裡面：事情演到一半就不對勁了
      await playLines([ev.lines[0], ev.lines[1] || ev.lines[0], ["", S.fakeTwist]].slice(0, 3), { f: name(fake) });
      return;
    }
    await playLines(ev.lines);
    const opts = ev.choices.map((c, i) => ({ label: c.label + (c.coins ? `（${-c.coins} 文）` : ""), value: i, disabled: c.coins && G.coins + c.coins < 0 }));
    const c = ev.choices[await choose("你要怎麼做？", opts)];
    G.stats.events++;
    if (c.coins) { G.coins += c.coins; updateTopbar(); }
    if (c.flag) G.flags[c.flag] = true;
    Object.entries(c.aff || {}).forEach(([id, n]) => affect(P(id), n));
    Object.entries(c.item || {}).forEach(([k, n]) => { G.items[k] += n; });
    if (c.lock && P(c.lock)) { P(c.lock).status = "locked"; P(c.lock).loc = "woodshed"; }
    await playLines(c.lines);
    (c.leave || []).forEach(id => { const q = P(id); if (q) { q.leftReason = "special"; leaveInn(q, "left", (S.leaveWhy[c.flag] || {})[id] || "隨事件離開"); } });
    renderFigures();
  }

  // 換場景時先清掉對話框，免得上一個畫面的字在淡入後閃一下
  function blankDialog() { $("speaker").textContent = ""; $("text").textContent = ""; }
  function clearFigures() { $("figures").innerHTML = ""; }
  // 畫面上出現已識破的畫皮 → 緊張配樂；換到沒有牠的畫面就淡回去
  function syncDread(force) {
    const on = force === true || (!!G && !!document.querySelector("#figures .fig.known") && $("result").classList.contains("hidden"));
    SFX.setDread(on);
  }
  new MutationObserver(() => syncDread()).observe($("figures"), { childList: true });
  const dayOpen = () => G && G.phase === "day" && !G.closing;   // 白天、而且還沒開始入夜
  function renderFigures() {
    const box = $("figures");
    box.innerHTML = "";
    if (!dayOpen()) return [];                       // 夜裡晚到的流程不要把白天的人物畫回來
    if (G.out) { renderTown(box); return []; }
    if (G.sanity < 10 && !hasTruth("self") && G.loc !== "hall" && Math.random() < 0.3) {
      const d = document.createElement("div");
      d.className = "fig self"; d.style.height = "70%"; d.style.left = "14%";
      d.innerHTML = `<img src="assets/fig_${pick(Object.keys(A.chars))}.png" alt=""><span class="tag">${TR().selfFig}</span>`;
      d.addEventListener("click", async e => { e.stopPropagation(); if (busy()) return; d.remove(); SFX.jolt(); setActions([]); await say("", TR().selfText, true); truthClue("self"); await showLocation(); });
      box.appendChild(d);
    }
    if (G.loc === "yard" && dogOk()) {
      const d = document.createElement("div");
      d.className = "fig dog"; d.style.height = "24%"; d.style.left = "86%";
      d.innerHTML = `<img src="assets/fig_heizi.png" alt=""><span class="tag">${S.dog.tag}</span>`;
      d.addEventListener("click", e => { e.stopPropagation(); if (!busy()) dogMenu(); });
      box.appendChild(d);
    }
    const here = inside().filter(p => p.loc === G.loc && !hidingNow(p));
    const n = here.length;
    const h = n <= 3 ? 74 : n <= 5 ? 62 : 52;
    here.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "fig" + (G.sel === p.id ? " sel" : "") + (p.known ? " known" : "");
      d.dataset.id = p.id;
      d.style.height = h + "%";
      d.style.left = ((i + 1) / (n + 1)) * 100 + "%";
      const ev = p.evidence && !p.known && p.status === "in" ? `（${S.plot.evidenceTag}）` : "";
      d.innerHTML = `<img src="assets/${p.known ? `fig_${artOf(p.id)}_fake.png` : `fig_${artOf(p.id)}.png`}" alt=""><span class="tag">${name(p)}${p.known ? "（畫皮）" : ""}${p.hurt ? `（${S.crowd.tag[p.hurt.type]}）` : ""}${ev}${p.status === "locked" ? "（關押中）" : ""}</span>`;
      d.addEventListener("click", e => { e.stopPropagation(); if (!busy()) selectPerson(p); });
      box.appendChild(d);
    });
    return here;
  }

  async function goTo(loc, silent) {
    G.loc = loc; G.sel = null;
    closePanel();
    setActions([]); clearFigures();          // 移動途中不能再點按鈕或人物
    await fadeTo(async () => { blankDialog(); setScene(`loc_${loc}.jpg`); renderFigures(); });
    if (!silent) await showLocation();
  }

  // ======================================================
  //  v0.8：香灰、黑子、外出到霜渡鎮
  // ======================================================
  async function useAsh() {
    G.items.ash--; G.ash = G.night;
    setActions([]);
    await say("", S.ash.used, true);
    await showLocation();
  }
  function dogMenu() {
    if (!dayOpen()) return;
    const petted = G.dog.petDay === G.night;
    setActions([
      { label: S.dog.petLabel, disabled: petted, fn: async () => {
        G.dog.petDay = G.night; G.sanity = Math.min(100, G.sanity + 3);
        setActions([]); await say("", S.dog.pet, true); await showLocation(); } },
      "sep", { label: S.dog.back, fn: () => showLocation() }
    ], true);
    say(S.dog.tag, petted ? S.dog.petDone : "黑子抬起頭看你，尾巴在地上掃了兩下。");
  }

  const T = () => S.town;
  const townDone = k => G.townDone && G.townDone[k] === G.night;
  const markTown = k => { (G.townDone = G.townDone || {})[k] = G.night; };
  const townBg = pid => `town_${pid}_${isDusk() ? "night" : "day"}.jpg`;
  function renderTown(box) {
    const spot = (label, x, y, fn) => {
      const b = document.createElement("button");
      b.className = "town-spot"; b.textContent = label; b.title = label;
      b.style.left = x + "%"; b.style.top = y + "%";
      b.addEventListener("click", e => { e.stopPropagation(); if (!busy()) fn(); });
      box.appendChild(b);
    };
    if (!G.townAt) {
      Object.entries(T().places).forEach(([pid, pl]) => spot(pl.name, pl.x, pl.y, () => G.ap > 0 && enterPlace(pid)));
      spot(T().inn.name, T().inn.x, T().inn.y, backToInn);
      return;
    }
    const pl = T().places[G.townAt], npc = S.townPeople[pl.npc];
    const d = document.createElement("div");
    d.className = "fig"; d.style.height = "74%"; d.style.left = "50%";
    d.innerHTML = `<img src="assets/fig_${pl.npc}.png" alt=""><span class="tag">${npc.name}</span>`;
    d.addEventListener("click", e => { e.stopPropagation(); if (!busy()) townChat(pl.npc); });
    box.appendChild(d);
    awayAt(G.townAt).forEach((p, i) => {                // 出門的客人
      const f = document.createElement("div");
      f.className = "fig"; f.style.height = "66%"; f.style.left = [22, 78, 10, 90][i % 4] + "%";
      f.innerHTML = `<img src="assets/fig_${artOf(p.id)}.png" alt=""><span class="tag">${name(p)}</span>`;
      f.addEventListener("click", e => { e.stopPropagation(); if (!busy()) townGuest(p); });
      box.appendChild(f);
    });
  }
  // ---------- 出門的客人 ----------
  const awayAt = pid => active().filter(p => p.away && (p.awayFake ? pid === "grave" && isDusk() : p.away === pid));
  function pickAway() {
    const O = S.outing;
    if (G.night < O.fromNight) return [];
    const busy = new Set();
    const sc = S.scenes.find(s => ready(s) && s.who.every(w => P(w) && P(w).status === "in"));   // 今天要談事情的那兩人留在樓裡
    if (sc) sc.who.forEach(w => busy.add(w));
    const pool = active().filter(p => O.places[p.id] && p.met && !p.hurt && !p.away && !p.hiding && !p.known && !busy.has(p.id));
    if (!pool.length || active().length < 4) return [];       // 樓裡人太少就不出門
    const n = Math.random() < 0.5 ? 1 : 2, chosen = [];
    const sp = pool.filter(p => O.special[p.id] && !(G.outSpecial || {})[p.id] && !p.fake);
    if (sp.length && Math.random() < 0.5) chosen.push(pick(sp));
    shuffle(pool).forEach(p => { if (chosen.length < n && !chosen.includes(p)) chosen.push(p); });
    chosen.forEach(p => {
      p.awayFake = p.fake && Math.random() < O.fakeGrave;
      p.away = p.awayFake ? "grave" : O.places[p.id];
      p.awayLoc = p.loc; p.loc = "town";
    });
    return chosen;
  }
  function comeHome() {
    Object.values(G.people).forEach(p => { if (p.hiding) { p.loc = p.hideFrom || "hall"; unhide(p); } });
    Object.values(G.people).forEach(p => {
      if (!p.away) return;
      p.away = null; p.awayFake = false;
      if (p.loc === "town") p.loc = p.awayLoc || "hall";
    });
  }
  function townGuest(p) {
    if (!dayOpen() || !G.townAt) return;
    const O = S.outing, talked = (G.townTalk || {})[p.id] === G.night;
    const sp = !p.fake && O.special[p.id] && !(G.outSpecial || {})[p.id] && O.places[p.id] === G.townAt ? O.special[p.id] : null;
    setActions([
      { label: talked ? O.chatDone : O.chatLabel, disabled: talked, fn: async () => {
        setActions([]); (G.townTalk = G.townTalk || {})[p.id] = G.night;
        if (p.awayFake) { SFX.jolt(); G.sanity -= 3; note(p, O.fakeNote, 2); await say("", O.fakeLine.replace(/\{n\}/g, name(p)), true); }
        else { dailyAffect(p, 1); await say(name(p), O.lines[p.id] || "……", true); }
        townGuest(p);
      } },
      ...(sp ? [{ label: sp.label, cls: "quest", fn: () => townSpecial(p, sp) }] : []),
      "sep", { label: O.back, fn: () => showTown(" ") }
    ], true);
    say(`${name(p)}　${hearts(p.affection)}`, `你在${T().places[G.townAt].name}遇到了${name(p)}。`);
  }
  async function townSpecial(p, sp) {
    setActions([]);
    (G.outSpecial = G.outSpecial || {})[p.id] = true;
    await playLines(sp.intro);
    const o = await choose(sp.label, sp.opts.map(x => ({ label: x.label, value: x, disabled: x.coins && G.coins < -x.coins })));
    if (o.coins) { G.coins += o.coins; updateTopbar(); }
    if (o.sanity) G.sanity = Math.min(100, G.sanity + o.sanity);
    if (o.dossier) G.hanFile = true;
    await playLines(o.text);
    if (o.aff) affect(p, o.aff);
    if (o.clue) truthClue(o.clue);
    townGuest(p);
  }
  async function goOut() {
    G.sel = null; clearFigures(); closePanel();
    const go = await choose(T().goAsk, [{ label: T().goYes, value: true }, { label: T().goNo, value: false }]);
    if (!go) return showLocation();
    G.out = true; G.townAt = null; G.sel = null; G.townVisits = 0;
    setActions([]); clearFigures(); closePanel();
    await say("", T().leaveText, true);
    await fadeTo(async () => { blankDialog(); setScene("town_map.jpg"); renderFigures(); });
    await showTown();
  }
  async function showTown(text) {
    if (!dayOpen()) return;
    if (!G.out) return showLocation(text);              // 已經回到樓裡：不要把鎮上的畫面疊上來
    ensureScene(G.townAt ? townBg(G.townAt) : "town_map.jpg");
    waitingSay = 0;
    if (!waiter) clearMarks();
    renderFigures();
    if (!G.townAt) {
      const noAp = G.ap <= 0;
      setActions([...Object.entries(T().places).map(([pid, pl]) => ({ label: `${pl.name}（1 行動）`, disabled: noAp, fn: () => enterPlace(pid) })),
        "sep", { label: T().backLabel, fn: backToInn }], true);
      coach("town");
      if (isDusk()) G.duskTold = G.night;
      await say(T().mapTitle, text || (isDusk() ? T().mapDusk + "\n" : "") + T().mapText);
    } else {
      const pid = G.townAt, pl = T().places[pid];
      setActions([...placeActions(pid), "sep", { label: T().leavePlace, fn: leavePlace }], true);
      if (awayAt(pid).length) coach("town");
      const dusk = isDusk() && G.duskTold !== G.night ? (G.duskTold = G.night, T().mapDusk + "\n") : "";
      await say(pl.name, text || (isDusk() ? dusk + pl.night : pl.day));
    }
    if (G.ap <= 0 && !G.townAt) await outOfTime();
  }
  async function enterPlace(pid) {
    if (G.ap <= 0) return;
    spend(); G.townVisits = (G.townVisits || 0) + 1;
    G.townAt = pid;
    setActions([]); clearFigures();
    await fadeTo(async () => { blankDialog(); setScene(townBg(pid)); renderFigures(); });
    const npc = T().places[pid].npc;
    G.townMet = G.townMet || {};
    if (!G.townMet[npc]) { G.townMet[npc] = true; await playLines(S.townPeople[npc].intro); }
    await showTown();
  }
  async function leavePlace() {
    G.townAt = null;
    setActions([]); clearFigures();
    await fadeTo(async () => { blankDialog(); setScene("town_map.jpg"); renderFigures(); });
    await showTown();
  }
  async function backToInn() {
    G.out = false; G.townAt = null; G.loc = "hall"; G.sel = null;
    setActions([]); clearFigures();
    await fadeTo(async () => { blankDialog(); setScene("loc_hall.jpg"); renderFigures(); });
    // 人不在的時候，樓裡比較容易出事
    const v = G.townVisits || 0; G.townVisits = 0;
    let msg = T().backText;
    if (v && Math.random() < 1 - Math.pow(1 - T().trouble, v)) {
      const pool = active().filter(p => !p.hurt && !p.away);
      if (!G.quarrel && pool.length >= 2 && Math.random() < 0.5) {
        const [a, b] = shuffle(pool);
        G.quarrel = { a: a.id, b: b.id, night: G.night };
        msg += "\n" + T().troubleQuarrel.replace(/\{a\}/g, name(a)).replace(/\{b\}/g, name(b));
      } else {
        const c = Math.min(G.coins, 10 + Math.floor(Math.random() * 3) * 10);
        G.coins -= c; updateTopbar();
        const wit = ["afu", "qin", "tou"].map(P).find(o => o && o.status === "in" && !o.hurt && !o.known);
        msg += "\n" + T().troubleTheft.replace(/\{c\}/g, c).replace("{w}", wit ? T().theftWho.replace("{n}", name(wit)) : T().theftNone);
      }
    }
    await say("", msg, true);
    await showLocation();
  }
  function townChat(npc) {
    if (!dayOpen() || !G.townAt) return;
    const d = S.townPeople[npc];
    G.townChat = G.townChat || {};
    const i = G.townChat[npc] || 0;
    G.townChat[npc] = i + 1;
    // 剛剛可能點過出門的客人：下方換回這個地點本身的選項，不要留著那個人的選單
    setActions([...placeActions(G.townAt), "sep", { label: T().leavePlace, fn: leavePlace }], true);
    const after = d.chatAfter && (i >= d.chat.length || (npc === "meng" && G.truth && G.truth.layer >= 3));
    say(d.name, after ? freshPick("town:" + npc, d.chatAfter) : d.chat[i % d.chat.length]);
    if (i % d.chat.length === d.chat.length - 1) truthClue(npc);
  }
  // 從樓裡的人挑一個（打聽、查戶籍用）
  async function pickGuest(prompt) {
    const list = inside().filter(p => p.met && S.people[p.id].doc);   // 夥計沒有路引、戶籍
    if (!list.length) { await say("", T().noGuest, true); return null; }
    return choose(prompt, [...list.map(p => ({ label: name(p), value: p })), { label: "算了", value: null }]);
  }
  function placeActions(pid) {
    const t = T(), dusk = isDusk(), pl = t.places[pid];
    const act = (label, key, fn, extra = {}) => ({ label, disabled: townDone(key) || extra.disabled, fn: async () => { setActions([]); const r = await fn(); if (r !== false) markTown(key); await showTown(" "); } });
    const chat = { label: `${t.chatLabel}（${S.townPeople[pl.npc].name}・不花行動）`, fn: () => townChat(pl.npc) };
    if (pid === "market") return [
      { label: t.shopLabel, fn: () => openShop("market") },
      dusk ? act(t.rumorLabel, "rumor", async () => {
        const fk = active().filter(p => p.fake), all = active();
        if (!all.length) return say("", T().noGuest, true);
        const target = fk.length && Math.random() < 0.6 ? pick(fk) : pick(all);
        await say("夜市", pick(t.rumors).replace(/\{b\}/g, bedName(roomOf(target))) + "\n" + t.rumorTail, true);
      }) : act(t.boatLabel, "boat", async () => {
        const p = await pickGuest(t.boatAsk); if (!p) return false;
        G.coins -= t.boatPrice; updateTopbar();
        const local = (S.traits[p.id] || {}).local;
        if (local) return say("船家", t.boatLocal.replace(/\{n\}/g, name(p)), true);
        const seen = p.fake ? Math.random() < 0.5 : Math.random() < 0.85;
        if (!seen) note(p, t.boatNote, 1.5);
        await say("船家", (seen ? t.boatSeen : t.boatUnseen).replace(/\{n\}/g, name(p)), true);
      }, { disabled: G.coins < t.boatPrice }),
      chat
    ];
    const rate = t.paperRate || 5, paperC = Math.floor((G.paper || 0) / rate);
    const exchange = { label: paperC > 0 ? t.paperLabel.replace("{p}", paperC * rate).replace("{c}", paperC) : t.paperNone, disabled: paperC <= 0, fn: async () => {
      setActions([]);
      G.paper -= paperC * rate; G.coins += paperC; updateTopbar();
      await say("老溫", t.paperDo.replace(/\{c\}/g, paperC), true);
      if (!G.paperAsked) { G.paperAsked = true; await say("老溫", t.paperAsk, true); }
      await showTown(" ");
    } };
    const O = S.outing, dossier = G.hanFile && !G.hanFileDone ? [{ label: O.dossierLabel, cls: "quest", fn: async () => {
      setActions([]); G.hanFileDone = true;
      await playLines(O.dossierDone);
      G.coins += O.dossierCoins; updateTopbar();
      const h = P("han"); if (h) affect(h, O.dossierAff);
      await showTown(" ");
    } }] : [];
    if (pid === "temple") return dusk ? [
      ...dossier,
      exchange,
      act(t.trialLabel, "trial", async () => {
        G.sanity -= 10; SFX.sting();
        await say("城隍夜審", t.trial, true);
        if (G.master && !G.masterExposed && G.clueTypes.length < 5) { await say("城隍夜審", t.trialClue, true); await addClue(); }
        else await say("城隍夜審", t.trialNone, true);
      }), chat
    ] : [
      act(t.lotLabel, "lot", async () => {
        G.coins -= t.lotPrice; updateTopbar();
        const r = Math.random(), k = inside().filter(p => p.fake).length;
        if (r < 0.35) await say("籤詩", k ? t.lotGood.replace(/\{k\}/g, "零一二三四五六七八九十"[Math.min(k, 10)]) : t.lotGoodNone, true);
        else if (r < 0.7) { G.sanity = Math.min(100, G.sanity + 5); await say("籤詩", t.lotMid, true); }
        else { G.sanity -= 5; await say("籤詩", t.lotBad, true); }
      }, { disabled: G.coins < t.lotPrice }),
      act(t.incenseLabel, "incense", async () => {
        G.coins -= t.incensePrice; G.sanity = Math.min(100, G.sanity + 15); updateTopbar();
        await say("", t.incense, true);
      }, { disabled: G.coins < t.incensePrice }),
      ...dossier,
      exchange,
      chat
    ];
    const tr = G.truth;
    if (pid === "grave" && dusk && tr.layer === 2 && !tr.grave && truthReady(2)) return [
      { label: TR().graveLabel, cls: "quest", fn: async () => {
        setActions([]); tr.grave = true;
        await playLines(TR().grave);
        const q = P("qin");
        if (!(q && q.status === "in" && !q.fake)) await truthLayer3();   // 秦嬸不在了，就自己想通
        else await say("", TR().graveAfter, true);
        await showTown(" ");
      } }, chat
    ];
    if (pid === "grave" && dusk && tr.layer >= 3 && !tr.relics.tag) return [
      { label: TR().relicTagLabel, cls: "quest", fn: async () => { setActions([]); tr.relics.tag = true; SFX.sting(); await say("", TR().relicTag, true); await showTown(" "); } },
      act(t.nightDigLabel, "nightdig", async () => { G.sanity -= 10; await say("", t.nightDigNone, true); }), chat
    ];
    if (pid === "yamen" && dusk && tr.layer === 3 && !tr.saw && truthReady(3)) return [
      { label: TR().yamenLabel, cls: "quest", fn: async () => {
        setActions([]); tr.saw = true; SFX.sting();
        await playLines(TR().yamen);
        await say("", TR().sawAfter, true);
        await showTown(" ");
      } }, chat
    ];
    if (pid === "grave") return dusk ? [
      act(t.nightDigLabel, "nightdig", async () => {
        G.sanity -= 10;
        if (Math.random() < 0.6 && G.master && !G.masterExposed && G.clueTypes.length < 5) { await say("", t.nightDigClue, true); await addClue(); }
        else await say("", t.nightDigNone, true);
        if (Math.random() < 0.35) { G.complacent = (G.complacent || 0) + 1; SFX.jolt(); await say("", t.followed, true); }
      }), chat
    ] : [
      act(t.digLabel, "dig", async () => {
        G.sanity -= 3;
        const r = Math.random();
        if (r < 0.3 && G.master && !G.masterExposed && G.clueTypes.length < 5) { await say("", t.digClue, true); await addClue(); }
        else if (r < 0.7) { G.coins += 15; updateTopbar(); await say("", t.digCoins, true); }
        else await say("", t.digNone, true);
      }), chat
    ];
    // 縣衙
    const han = P("han"), cheap = han && han.status === "in" && !han.fake, price = cheap ? t.registerHan : t.registerPrice;
    return dusk ? [
      act(t.peekLabel, "peek", () => say("", pick(t.peek), true)), chat
    ] : [
      act(t.registerLabel.replace("{c}", price), "register", async () => {
        const p = await pickGuest(t.registerAsk); if (!p) return false;
        G.coins -= price; updateTopbar();
        if (cheap) await say("", t.registerHanNote, true);
        const d = S.people[p.id].doc;
        if (p.fake && Math.random() < 0.65) { note(p, t.registerNote, 2.5); await say("鄒主簿", t.registerDead.replace(/\{n\}/g, d.name).replace(/\{f\}/g, d.from), true); }
        else await say("鄒主簿", t.registerOk.replace(/\{n\}/g, d.name), true);
      }, { disabled: G.coins < price }),
      chat
    ];
  }

  // ======================================================
  //  v0.5：掌櫃的過去、門主線索、大廳議事、個人支線、角色特殊玩法
  // ======================================================
  async function remember() {
    if (G.memory >= S.past.length) return;
    const hudOn = !$("hud").classList.contains("hidden");
    await narrate([`${S.pastTitle}\n\n${S.past[G.memory]}`]);
    G.memory++;
    if (hudOn) $("hud").classList.remove("hidden");
  }

  // 門主線索：每次揭露門主的一項特徵
  function clueText(type) {
    const m = G.master, t = S.traits[m] || {}, C = S.master.clue;
    if (type === "sex") return C.sex.replace("{v}", t.sex);
    if (type === "age") return C.age[t.age];
    if (type === "local") return C.local[String(!!t.local)];
    if (type === "night") return C.night.replace("{v}", (P(m) && P(m).knockNight) || arrivalNight(m));
    const r = S.people[m].room;
    return C.room.replace("{v}", bedName(r || "dorm"));
  }
  function nextClue() {
    if (!G.master || G.masterExposed) return null;
    const mp = P(G.master);
    const left = ["sex", "age", "local", "night", "room"].filter(t => !G.clueTypes.includes(t) && !(t === "room" && !(mp && mp.admittedNight)));
    if (!left.length) return null;
    const type = pick(left);
    G.clueTypes.push(type);
    const text = clueText(type);
    G.clues.push(text);
    return text;
  }
  async function addClue() {
    const c = nextClue();
    if (c) await say("線索", `${c}\n${S.master.clueIntro}`, true);
  }

  // ---------- 大廳議事 ----------
  const isMuteP = p => !!S.mute && p.id === S.mute.id;
  async function assembly(auto) {
    if (!auto) spend();
    G.assemblyDay = G.night;
    setActions([]);
    if (G.loc !== "hall") await goTo("hall", true);
    const A_ = S.assembly;
    await say("議事", auto ? A_.afterMurder : A_.open, true);
    const npcs = active().filter(p => !p.away && !p.hiding && !p.hurt);
    if (npcs.length < 3) { await say("", A_.nobody, true); return showLocation(); }
    // 親眼看過你釘死畫皮的人，會先站出來替你說話
    const voucher = npcs.find(p => p.vouch && !p.fake);
    if (voucher) await say(name(voucher), (isMuteP(voucher) ? S.mute.vouch : S.witness.vouch).replace(/\{w\}/g, name(voucher)), true);
    const isStaff = p => S.people[p.id].kind === "staff";
    const isMute = isMuteP;
    // 啞姑不會說話：理由裡要「說話」才成立的句子，她用不上
    const mutefilter = (a, arr) => isMute(a) ? arr.filter(t => !/說話|搭了幾句/.test(t)) : arr;
    const culprit = G.plot && P(G.plot.culprit);
    // 真夥計不會平白無故指認同事；除非已經有證據、或已經識破了
    const canAccuse = (a, p) => a.fake || !isStaff(a) || !isStaff(p) || p.known || (culprit === p && culprit.evidence);
    const votes = new Map(), accusers = new Map(), defenders = new Map(), spoke = new Set();
    const fakesOf = except => npcs.filter(p => p.fake && p !== except);
    // ---- 第一輪：指認 ----
    for (const a of shuffle(npcs).slice(0, Math.random() < 0.5 ? 2 : 3)) {
      if (spoke.has(a)) continue;   // 已經站出來袒護過的人，不再發言
      let b = null, line = "";
      const others = npcs.filter(p => p !== a);
      if (a.fake) {
        const reals = others.filter(p => !p.fake);
        if (!reals.length) continue;
        b = pick(reals);
        line = freshPick("accuseFake:" + G.night, A_.accuseFake).replace(/\{b\}/g, name(b));
        if (Math.random() < 0.35) line += "\n" + pick(A_.fakeTell).replace(/\{a\}/g, name(a));
      } else {
        const pool = others.filter(p => canAccuse(a, p));
        const known = pool.find(p => p.known);
        const grudge = (S.grudges[a.id] || []).map(P).filter(p => p && p.status === "in" && pool.includes(p));
        const fakes = fakesOf(a).filter(p => pool.includes(p));
        if (culprit && culprit.evidence && culprit.status === "in" && culprit !== a) b = culprit;
        else if (known) b = known;
        else if (fakes.length && Math.random() < 0.5) b = pick(fakes);
        else if (grudge.length && Math.random() < 0.6) b = pick(grudge);
        else if (pool.length && Math.random() < 0.6) b = pick(pool);
        if (!b) continue;
        if (grudge.includes(b) && !b.fake && Math.random() < 0.7) line = pick(A_.grudge).replace(/\{b\}/g, name(b));
        else {
          const reasons = mutefilter(a, A_.reasons);
          const reason = b.fake && Math.random() < 0.6 ? fill(pick(mutefilter(a, tellsOf(b))), b) : pick(reasons).replace(/\{b\}/g, name(b));
          const forms = A_.accuseReal.filter(f => !(S.people[a.id].noEyes && f.includes("看見")));
          line = freshPick("accuse:" + G.night, forms).replace(/\{b\}/g, name(b)).replace("{r}", reason);
        }
      }
      spoke.add(a);
      votes.set(b, (votes.get(b) || 0) + 1);
      accusers.set(b, [...(accusers.get(b) || []), a]);
      await say(name(a), line, true);
      // ---- 有人站出來袒護：只回應「剛被指認的人」；每場最多兩位 ----
      if (defenders.size < 2 && !defenders.has(b)) {
        const cands = npcs.filter(p => !spoke.has(p) && p !== b);
        let d = null;
        if (isStaff(b)) d = cands.find(p => !p.fake && isStaff(p) && Math.random() < 0.7);              // 夥計護夥計
        if (!d && b.fake) d = cands.find(p => p.fake && Math.random() < 0.4);                           // 畫皮護畫皮
        if (!d) d = cands.find(p => !p.fake && !(S.grudges[p.id] || []).map(P).includes(b) && Math.random() < 0.25);
        if (d) {
          spoke.add(d);
          defenders.set(b, d);
          const pool = isMute(d) ? A_.defendMute : (isStaff(b) && isStaff(d) ? A_.defendStaff : A_.defendIn);
          let dl = freshPick("defend:" + G.night + (isMute(d) ? "m" : isStaff(b) && isStaff(d) ? "s" : "g"), pool).replace(/\{a\}/g, name(a)).replace(/\{b\}/g, name(b)).replace(/\{d\}/g, name(d));
          if (d.fake && Math.random() < 0.35) dl += "\n" + pick(A_.fakeTell).replace(/\{a\}/g, name(d));
          await say(name(d), dl, true);
        }
      }
    }
    if (!votes.size) { await say("", A_.nobody, true); return showLocation(); }
    // 袒護的人替被指認者抵一票；票數最高的人才會被議論
    const net = p => (votes.get(p) || 0) - (defenders.has(p) ? 1 : 0);
    const best = Math.max(...[...votes.keys()].map(net));
    if (best <= 0) { await say("", A_.stalemate, true); if (!auto) await showLocation(); return; }
    const tops = [...votes.keys()].filter(p => net(p) === best);
    let top = tops[0];
    if (tops.length > 1) {
      await say("", A_.tie.replace("{list}", tops.map(name).join("、")), true);
      const t = await choose("要處理誰？", [...tops.map(p => ({ label: name(p), value: p })), { label: A_.disbandLabel, value: null }]);
      if (!t) { await say("", A_.disband, true); if (!auto) await showLocation(); return; }
      top = t;
    }
    const nb = name(top), C = A_.choices;
    await say("", A_.verdict.replace(/\{b\}/g, nb), true);
    const c = await choose(`要怎麼處理${nb}？`, [
      { label: C.lock.replace("{b}", nb), value: "lock", cls: "danger" },
      { label: C.defend.replace("{b}", nb), value: "defend" },
      { label: C.dismiss, value: "dismiss" }
    ]);
    if (c === "lock") { top.status = "locked"; top.loc = "woodshed"; if (!top.fake) affect(top, -3); await say("", A_.lockText.replace(/\{b\}/g, nb), true); }
    else if (c === "defend") { affect(top, 2); (accusers.get(top) || []).forEach(a => { if (!a.fake) affect(a, -1); }); await say("", A_.defendText.replace(/\{b\}/g, nb), true); }
    else await say("", A_.dismissText.replace(/\{b\}/g, nb), true);
    if (!auto) await showLocation();
  }

  // ---------- 個人支線 ----------
  const qs = id => (G.quests[id] = G.quests[id] || { step: 0, done: false, broken: false });
  const alive = p => p && ["in", "locked"].includes(p.status);
  // 找出可以在「target」（人物 id 或 "loc:地點"）推進的支線
  function questsAt(target) {
    return S.quests.filter(q => {
      const st = qs(q.id), owner = P(q.owner), step = q.steps[st.step];
      if (st.done || st.broken || !step || !alive(owner)) return false;
      if (q.id === "yagu" && G.flags.afuYagu) return false;
      if (owner.hurt) return false;
      if (q.id === "afu" && G.lovers.includes("yagu")) return false;
      if (!step.at.includes(target)) return false;
      if (st.step === 0) return owner.status === "in" && owner.affection >= (step.minAff || 0) && questReady(q);
      return true;
    });
  }
  // 支線開頭前先確認：後面每一步要找的人，樓裡至少都有一個在（另可用 needs 指定額外需要的人）
  function questReady(q) {
    const groups = q.steps.slice(1).map(s => s.at).filter(g => !g.some(t => t.startsWith("loc:"))).map(g => g.slice());
    (q.needs || []).forEach(id => groups.push([id]));
    return groups.every(g => g.some(id => alive(P(id))));
  }
  // 人還在樓裡，或離開了但之後還會回來，都算「還等得到」
  const reachable = p => alive(p) || (p && (p.status === "out" || (["gone", "refused"].includes(p.status) && p.returnNight > G.night)));
  function questLostCheck() {
    const out = [];
    S.quests.forEach(q => {
      const st = qs(q.id);
      if (st.done || st.broken || st.step === 0) return;
      const owner = P(q.owner);
      const groups = q.steps.slice(st.step).map(s => s.at).filter(g => !g.some(t => t.startsWith("loc:")));
      (q.needs || []).forEach(id => groups.push([id]));
      const missing = groups.find(g => !g.some(id => reachable(P(id))));
      if (reachable(owner) && !missing) return;
      st.broken = true;
      const x = reachable(owner) ? missing[0] : q.owner;
      const cn = id => S.people[id].callName || nm(id);
      out.push(S.questLost.replace(/\{t\}/g, q.title).replace(/\{n\}/g, cn(q.owner)).replace(/\{x\}/g, cn(x)));
    });
    return out;
  }
  function questButtons(target) {
    return questsAt(target).map(q => {
      const step = q.steps[qs(q.id).step], cost = step.cost && step.cost.coins, its = (step.cost && step.cost.items) || {};
      const itemTxt = Object.entries(its).map(([k, n]) => `${n} 份${S.items[k].name}`).join("、");
      const lack = Object.entries(its).some(([k, n]) => (G.items[k] || 0) < n);
      return { label: `【${q.title}】${step.label}${cost ? `（${cost} 文）` : ""}${itemTxt ? `（${itemTxt}）` : ""}`, cls: "quest",
               disabled: G.ap <= 0 || (cost && G.coins < cost) || lack, fn: () => runQuest(q, target) };
    });
  }
  async function runQuest(q, target) {
    const st = qs(q.id), step = q.steps[st.step], owner = P(q.owner);
    const who = target.startsWith("loc:") ? null : P(target);
    spend(); setActions([]);
    // 支線的主人已經被換掉：牠不記得你們之間的事
    if (who && who === owner && owner.fake && st.step > 0) {
      st.broken = true;
      await say("", S.questForget.replace(/\{t\}/g, q.title).replace(/\{n\}/g, name(owner)), true);
      return afterAction(who);
    }
    if (who && who !== owner && who.fake) {
      await say("", S.questTargetFake.replace(/\{n\}/g, name(who)), true);
      return afterAction(who);
    }
    if (step.cost && step.cost.coins) { G.coins -= step.cost.coins; updateTopbar(); }
    Object.entries((step.cost && step.cost.items) || {}).forEach(([k, n]) => { G.items[k] -= n; });
    await playLines(who && who.fake && step.fakeLines ? step.fakeLines : step.lines, { n: who ? name(who) : "" });
    if (step.truth && !(who && who.fake)) truthClue(step.truth);
    if (step.memory) await remember();
    if (step.choices) {
      const opts = step.choices.filter(c => !c.needIn || hereNow(c.needIn)).map(c => ({ label: c.label, value: c }));
      const c = await choose("你要怎麼回答？", opts);
      st.choice = step.choices.indexOf(c);
      if (c.flag) G.flags[c.flag] = true;
      if (c.sanity) G.sanity = Math.min(100, G.sanity + c.sanity);
      Object.entries(c.aff || {}).forEach(([id, n]) => affect(P(id), n));
      Object.entries(c.item || {}).forEach(([k, n]) => { G.items[k] = Math.min(capOf(k), G.items[k] + n); });
      if (c.fillSalt) G.items.salt = capOf("salt");
      if (c.coins) { G.coins += c.coins; updateTopbar(); }
      await playLines(c.lines);
      (c.leave || []).forEach(id => { const q = P(id); if (q) { q.leftReason = "special"; leaveInn(q, "left", (S.leaveWhy[c.flag] || {})[id] || "隨託付離開"); } });
      if (c.lover) await loveUp(P(q.owner), 2);
    }
    if (step.flag) G.flags[step.flag] = true;
    if (step.sanity) G.sanity = Math.max(0, Math.min(100, G.sanity + step.sanity));
    if (step.special === "porridge") await porridgeTest();
    if (step.after) await playLines(step.after);
    if (step.clue) await addClue();
    st.step++;
    if (st.step >= q.steps.length) { st.done = true; st.doneNight = G.night; G.stats.quests++; await questReward(q, st); }
    await afterAction(who);
  }

  async function questReward(q, st) {
    const QR = S.questReward, B = QR.base, X = QR.extra[q.id] || {}, C = (X.choice || {})[st.choice] || {};
    const owner = P(q.owner), parts = [];
    if (owner && B.aff) { owner.affection += B.aff; parts.push(`${name(owner)}好感 +${B.aff}`); }
    const san = (B.sanity || 0) + (X.sanity || 0) + (C.sanity || 0);
    if (san) { G.sanity = Math.min(100, G.sanity + san); parts.push(`心神 +${san}`); }
    const coins = (X.coins || 0) + (C.coins || 0);
    if (coins) { G.coins += coins; parts.push(`得到 ${coins} 文`); }
    const food = (X.food || 0) + (C.food || 0);
    if (food) { G.food = (G.food || 0) + food; parts.push(`糧食 +${food}`); }
    Object.entries({ ...(X.item || {}), ...(C.item || {}) }).forEach(([k, n]) => { G.items[k] = Math.min(capOf(k), G.items[k] + n); parts.push(`${S.items[k].name} +${n}`); });
    updateTopbar();
    if (parts.length) await say("", QR.summary.replace("{r}", parts.join("、")), true);
  }
  async function porridgeTest() {
    const X = S.porridge, ppl = active().filter(q => !q.away);
    const refused = ppl.filter(q => q.fake && Math.random() < 0.7);
    const drank = ppl.filter(q => !refused.includes(q));
    if (drank.length) await say("", X.drank.replace("{names}", drank.map(name).join("、")), true);
    if (refused.length) {
      refused.forEach(q => note(q, X.note, 2.5));
      await say("", X.refused.replace("{names}", refused.map(name).join("、")), true);
    } else await say("", X.none, true);
    await say(name(P("qin")), X.after, true);
  }

  // ---------- 戀愛 ----------
  const RM = () => S.romance;
  const isTarget = p => p && RM().targets.includes(p.id);
  const loveOf = p => (p && p.love) || 0;
  const flowers = n => "❀".repeat(Math.min(5, Math.max(0, n))) + "·".repeat(5 - Math.min(5, Math.max(0, n)));
  // 主要戀人：還在樓裡、情意最高的那位（守夜、結局用）
  function refreshLover() {
    const live = G.lovers.map(P).filter(q => q && isIn(q)).sort((a, b) => loveOf(b) - loveOf(a));
    G.lover = live.length ? live[0].id : (G.lovers[0] || null);
  }
  function addLover(id) {
    if (!G.lovers.includes(id)) { G.lovers.push(id); (G.giftDay = G.giftDay || {})[id] = G.night; }   // 禮物從隔天開始
    const q = P(id); q.love = Math.max(loveOf(q), RM().confessAt);
    refreshLover();
  }
  // 情意上升；跨過 3、5 時觸發戀愛事件
  async function loveUp(p, n) {
    const before = loveOf(p);
    p.love = before + n;
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; stage.appendChild(el); }
    const line = document.createElement("div"); line.className = "up love";
    line.textContent = "❀ " + RM().up.replace("{n}", name(p)); el.appendChild(line); setTimeout(() => line.remove(), 2600);
    const ev = RM().events[p.id] || [];
    const play = async idx => {
      if (!ev[idx]) return;
      if (p.fake) await playLines([ev[idx][0], ["", S.fakeTwist]], { f: name(p) });
      else await playLines(ev[idx], { h: housemates(p) });
    };
    if (before < RM().flirtAt && p.love >= RM().flirtAt) await play(0);
    if (before < RM().confessAt && p.love >= RM().confessAt) await play(1);
  }
  // 啞姑畫的「一家人」：只畫現在還在樓裡的人（夥計優先），最多三個
  function housemates(p) {
    const order = ["qin", "afu", "tou", "mother", "ye", "gu"];
    const here = inside().filter(o => o !== p && o.status === "in" && !o.known && o.met !== false)
      .sort((a, b) => ((order.indexOf(a.id) + 1) || 99) - ((order.indexOf(b.id) + 1) || 99));
    return here.length ? here.slice(0, 3).map(name).join("、") : "每一個她認得的客人";
  }
  function romanceButtons(p) {
    if (!isTarget(p) || p.status !== "in" || p.known) return [];
    const R_ = RM(), noAp = G.ap <= 0, list = [];
    // 戀人的禮物：每天一次、不花行動
    if (G.lovers.includes(p.id) && S.loverGift.gifts[p.id]) {
      const got = (G.giftDay || {})[p.id] === G.night;
      list.push({ label: got ? S.loverGift.done : S.loverGift.label, cls: "love", disabled: got, fn: () => takeGift(p) });
    }
    if (p.hurt) return list;
    const full = loveOf(p) >= R_.confessAt, cost = full ? R_.freeTag : "（1 行動）", needAp = !full && noAp;   // 情意滿了：不花行動
    const talked = (G.talkDay || {})[p.id] === G.night;              // 談心：每人每天一次
    if (p.affection >= R_.talkNeed) list.push({ label: talked ? R_.talkDone : `${R_.talkLabel}${cost}`, cls: "love", disabled: needAp || talked, fn: () => talkTo(p) });
    const flirted = (G.flirtDay || {})[p.id] === G.night;           // 曖昧：每人每天一次
    if (loveOf(p) >= R_.flirtAt) list.push({ label: flirted ? R_.flirtDone : `${R_.flirtLabel}${cost}`, cls: "love", disabled: needAp || flirted, fn: () => flirt(p) });
    if (loveOf(p) >= R_.confessAt && !G.lovers.includes(p.id)) list.push({ label: R_.confessLabel, cls: "love", disabled: noAp, fn: () => confess(p) });
    return list;
  }
  async function takeGift(p) {
    const LG = S.loverGift;
    (G.giftDay = G.giftDay || {})[p.id] = G.night;
    setActions([]);
    if (p.fake) {
      SFX.jolt(); note(p, LG.fakeNote, 2);
      await say("", LG.fake[p.id], true);
      return afterAction(p);
    }
    const g = freshPick("gift:" + p.id, LG.gifts[p.id]), gain = [];
    if (g.sanity) { G.sanity = Math.min(100, G.sanity + g.sanity); gain.push(LG.gain.sanity.replace("{v}", g.sanity)); }
    if (g.coins) { G.coins += g.coins; gain.push(LG.gain.coins.replace("{v}", g.coins)); }
    if (g.food) G.food = (G.food || 0) + g.food;
    updateTopbar();
    await say("", g.text + (gain.length ? "\n" + gain.join("") : ""), true);
    await afterAction(p);
  }
  async function talkTo(p) {
    const R_ = RM(), full = loveOf(p) >= R_.confessAt;
    if (!full) spend();
    setActions([]);
    (G.talkDay = G.talkDay || {})[p.id] = G.night;
    if (p.fake) {
      await say(name(p), pick(R_.fakeTalk), true);
      if (Math.random() < 0.5) note(p, R_.fakeNote, 1.5);
    } else await say(name(p), full ? freshPick("talkFull:" + p.id, R_.talkFull[p.id]) : R_.talk[p.id][Math.min(4, loveOf(p))], true);
    if (!full) await loveUp(p, 1);
    await afterAction(p);
  }
  async function flirt(p) {
    const R_ = RM(), full = loveOf(p) >= R_.confessAt;
    if (!full) spend();
    setActions([]);
    (G.flirtDay = G.flirtDay || {})[p.id] = G.night;
    await say("", p.fake ? R_.fakeFlirt.replace(/\{n\}/g, name(p)) : freshPick("flirt:" + p.id, R_.flirt[p.id]), true);
    if (await jealousy(p)) return;
    affect(p, RM().flirtAff || 1);                                  // 曖昧也加好感（不算在閒聊、奉茶的每日上限裡）
    if (!full) await loveUp(p, 1);
    await afterAction(p);
  }
  async function confess(p) {
    spend(); setActions([]);
    await playLines(RM().confess[p.id]);
    if (p.fake) await say("", S.fakeTwist.replace(/\{f\}/g, name(p)), true);
    addLover(p.id);
    if (await jealousy(p)) return;
    await afterAction(p);
  }
  // 在情意 3 以上的人面前，跟別人曖昧或表白：被發現了
  // 回傳 true 表示流程已經結束（昏睡、被殺）
  async function jealousy(p) {
    const R_ = RM();
    const seen = active().filter(b => b !== p && b.loc === G.loc && isTarget(b) && (loveOf(b) >= R_.flirtAt || G.lovers.includes(b.id)));
    for (const b of seen) {
      if (b.fake) { await say("", R_.fakeCaught.replace(/\{n\}/g, name(b)), true); note(b, "看見你跟別人親近，一點也不在乎", 2); continue; }
      SFX.sting();
      await say(name(b), R_.caught[b.id], true);
      const r = Math.random();
      G.lovers = G.lovers.filter(x => x !== b.id); b.love = 0; refreshLover();
      if (r < 0.5) { await say("", R_.jealousLeave.replace(/\{n\}/g, name(b)), true); leaveInn(b, "left", "吃醋離開"); continue; }
      if (r < 0.8) {
        await say("", R_.jealousDrug.replace(/\{n\}/g, name(b)), true);
        G.sleepUntil = G.night + 2;
        endDay(true);
        return true;
      }
      G.killer = b.id;
      await say("", R_.jealousKill.replace(/\{n\}/g, name(b)), true);
      ending("jealous");
      return true;
    }
    return false;
  }

  // ---------- 角色的特殊玩法 ----------
  function specialButtons(p) {
    if (p.status !== "in") return [];
    const X = S.special, noAp = G.ap <= 0, list = [];
    const tr = G.truth;
    if (p.id === "qin" && !p.fake && tr.grave && tr.layer === 2) list.push({ label: TR().qinLabel, cls: "quest", disabled: noAp, fn: async () => {
      spend(); setActions([]); await playLines(TR().qin); await truthLayer3(); await afterAction(p); } });
    if (p.id === "han" && !p.fake && tr.layer === 3 && !tr.saw && truthReady(3)) list.push({ label: TR().hanLabel, cls: "quest", disabled: noAp, fn: async () => {
      spend(); setActions([]); tr.saw = true; await playLines(TR().han); await say("", TR().sawAfter, true); await afterAction(p); } });
    if (p.id === "gu") list.push({ label: `請顧老雕像（${X.carve.price} 文）`, disabled: noAp || !!G.carve || G.coins < X.carve.price, fn: () => carve(p) });
    if (p.id === "he") {
      const left = X.salt.maxBuys - (G.heBuys || 0), full = G.items.salt >= capOf("salt");
      list.push({ label: left <= 0 ? X.salt.soldOut : full ? X.salt.full : `買鹽（1 包 ${X.salt.price} 文，還能買 ${left} 次）`,
                  disabled: left <= 0 || full || G.coins < X.salt.price, fn: () => buySalt(p) });
    }
    if (p.id === "afu") {
      const T = S.afuTail, hurt = G.afuHurt === G.night;
      list.push({ label: hurt ? T.hurtLabel : G.tail ? "（阿福今晚已經在盯人了）" : T.label, disabled: hurt || !!G.tail || noAp || G.coins < T.price, fn: () => afuTail(p) });
    }
    if (p.id === "tou") list.push({ label: `請石頭打聽（${X.errand.price} 文）`, disabled: noAp || G.coins < X.errand.price, fn: () => errand(p) });
    return list;
  }
  async function afuTail(p) {
    const T = S.afuTail, others = inside().filter(o => o !== p);
    const t = await choose(T.ask, [...others.map(o => ({ label: name(o), value: o })), { label: "算了", value: null }]);
    if (!t) return selectPerson(p);
    spend(); G.coins -= T.price; updateTopbar();
    G.tail = t.id;
    await say(name(p), T.ok, true);
    await afterAction(p);
  }
  // 夜裡：阿福盯人的結果（天亮時回報）
  function resolveTail() {
    const T = S.afuTail, a = P("afu"), t = G.tail && P(G.tail);
    G.tail = null;
    if (!a || a.status !== "in" || !t) return;
    if (active().some(q => q.fake && q !== a) && Math.random() < T.attackChance) { G.afuHurt = G.night; G.tailReport = T.attacked; return; }
    let r;
    if (a.fake) r = t.fake ? T.lieReport : pick(T.fakeReport);   // 阿福自己是畫皮：替同類掩護、栽贓真人
    else r = t.fake ? pick(T.fakeReport) : pick(T.realReport);
    r = r.replace(/\{n\}/g, name(t));
    if (r !== T.lieReport.replace(/\{n\}/g, name(t)) && T.fakeReport.some(x => x.replace(/\{n\}/g, name(t)) === r)) note(t, "阿福盯了一夜：" + r.replace(/^[^：]*：/, ""), 2);
    G.tailReport = r;
  }

  async function carve(p) {
    const others = inside().filter(o => o !== p);
    const t = await choose(S.special.carve.ask, [...others.map(o => ({ label: name(o), value: o })), { label: "算了", value: null }]);
    if (!t) return selectPerson(p);
    spend(); G.coins -= S.special.carve.price; updateTopbar();
    G.carve = t.id;
    await say(name(p), `好，${name(t)}。老頭子記下了。明早給你。`, true);
    await afterAction(p);
  }
  async function buySalt(p) {
    const X = S.special.salt;
    setActions([]);
    G.coins -= X.price * X.qty; G.items.salt = Math.min(capOf("salt"), G.items.salt + X.qty); G.heBuys = (G.heBuys || 0) + 1; updateTopbar();
    if (p.fake) G.sand += X.qty;
    await say(name(p), p.fake ? X.buyFake : X.buy, true);
    await afterAction(p);
  }
  async function errand(p) {
    const X = S.special.errand;
    spend(); G.coins -= X.price; updateTopbar(); setActions([]);
    const others = active().filter(o => o !== p);
    const reals = others.filter(o => !o.fake), fakes = others.filter(o => o.fake && !o.known);
    let t;
    if (p.fake && reals.length) { const r = pick(reals); t = X.lie.replace(/\{r\}/g, name(r)); note(r, "石頭說半夜看見他站在井邊", 1); }
    else if (fakes.length && Math.random() < 0.6) { const f = pick(fakes); t = X.seeFake.replace(/\{f\}/g, name(f)); note(f, "石頭說半夜看見他站在井邊", 1); }
    else t = X.seeReal.replace(/\{r\}/g, reals.length ? name(pick(reals)) : "沒有人");
    await say(name(p), t, true);
    await afterAction(p);
  }

  // ---------- 跨局圖鑑（存在瀏覽器裡） ----------
  function codexGet() {
    const empty = { met: {}, secrets: {}, endings: {}, titles: {}, lex: {} };
    try { return Object.assign(empty, JSON.parse(localStorage.getItem("louke_codex") || "{}")); }
    catch (e) { return empty; }
  }
  function codexMark(kind, key) {
    try {
      const c = codexGet();
      if (c[kind][key]) return;
      c[kind][key] = true;
      localStorage.setItem("louke_codex", JSON.stringify(c));
    } catch (e) {}
  }

  function codexLex(id, n) {
    try {
      const c = codexGet();
      if ((c.lex[id] || 0) >= n) return;
      c.lex[id] = n;
      localStorage.setItem("louke_codex", JSON.stringify(c));
    } catch (e) {}
  }
  // 名錄的畫面（lexMap：詞條 id → 解鎖了幾段）
  function lexHtml(lexMap) {
    const cats = [...new Set(S.lexicon.map(e => e.cat))];
    const got = S.lexicon.filter(e => lexMap[e.id]).length;
    return `<p class="journal-note">解鎖的詞條：${got}／${S.lexicon.length}。詞條會隨著你聽到、看到的事，慢慢補上新的內容。</p>` + cats.map(cat =>
      `<h3 class="sub">${cat}</h3><div class="lex">${S.lexicon.filter(e => e.cat === cat).map(e => {
        const n = lexMap[e.id] || 0;
        if (!n) return `<div class="lex-item locked"><b>？？？</b></div>`;
        const more = n < e.stages.length ? `<p class="lex-more">（還有 ${e.stages.length - n} 段未解開）</p>` : "";
        return `<div class="lex-item"><b>${e.title}</b>${e.stages.slice(0, n).map(st => `<p>${st.text}</p>`).join("")}${more}</div>`;
      }).join("")}</div>`).join("");
  }

  // ---------- 人物卡片 ----------
  const revealed = p => p && p.fake && (p.known || p.status === "dead");
  const figOf = p => revealed(p) ? `fig_${artOf(p.id)}_fake.png` : `fig_${artOf(p.id)}.png`;
  const ROSTER = () => Object.keys(S.people).filter(id => A.chars[id] && A.chars[id].art && S.people[id].kind !== "passer");
  function personCard(id, known, extra = "", red = false, img = `fig_${id}.png`) {
    const pr = S.profiles[id] || {};
    if (!known) return `<div class="card unknown"><div class="pic" style="background-image:url(assets/fig_${id}.png)"></div><div class="nm">？？？</div><div class="what">尚未遇見</div></div>`;
    return `<div class="card click${red ? " fake" : ""}" data-id="${id}"><div class="pic" style="background-image:url(assets/${img})"></div>
      <div class="nm">${S.people[id].name}</div><div class="what">${pr.role || ""}</div>${extra}</div>`;
  }
  const hearts = a => {
    if (a < 0) return "（記恨你）";
    const n = Math.min(5, Math.max(0, a));
    return "♥".repeat(n) + "♡".repeat(5 - n);
  };
  const ST = { in: "在樓裡", locked: "關在柴房", dead: "死了", gone: "離開了", refused: "被拒於門外", out: "", murdered: "被畫皮殺害" };
  // 狀態＋什麼時候、為什麼（離開、死亡、被拒）
  const stText = p => {
    const s = ST[p.status] || "";
    if (!["gone", "dead", "murdered", "refused"].includes(p.status)) return s;
    const n = p.endNight || p.knockNight;
    const why = p.status === "refused" ? "" : p.endWhy;
    return n ? `${s}（${S.dates[n - 1]}${why ? "・" + why : ""}）` : s;
  };

  // ---------- 線索簿（分頁：線索／人物一覽） ----------
  let journalTab = "clues";
  function truthHtml() {
    const tr = G.truth, T0 = TR(), H = T0.hint, L = tr.layer;
    const layers = T0.layers.map((l, i) => i < L
      ? `<div class="item"><span class="nm gold">${l.title}</span><span class="ds">${l.desc}</span></div>`
      : `<div class="item"><span class="nm">？？？</span><span class="ds">還沒想起來</span></div>`).join("");
    const left = k => Math.max(0, T0.need[k] - truthN());
    let hint;
    if (L === 1) hint = truthN() ? H.l2.replace("{d}", T0.minNight[1]) : H.l1;
    else if (L === 2) hint = tr.grave ? H.l3c : truthReady(2) ? H.l3b : H.l3.replace("{k}", left(2));
    else if (L === 3) hint = tr.saw ? H.l4c : truthReady(3) ? H.l4b : H.l4.replace("{k}", left(3));
    else hint = H.done;
    const clues = tr.pts.map(id => `<p>・${T0.clues[id]}</p>`).join("");
    const relics = L >= 3 ? `<h3 class="sub">${H.relic}</h3><div class="journal">${Object.entries(T0.relicNames).map(([k, n]) => `<p>${tr.relics[k] ? "✔" : "・"} ${n}</p>`).join("")}</div>` : "";
    const tell = L >= 3 && G.lovers.length ? `<p class="hint">${H.tellHint}</p>` : "";
    return `<div class="shop">${layers}</div><p class="hint">${condText(hint)}</p>${tell}
      <h3 class="sub">${T0.cluesTitle}（${truthN()}）</h3><div class="journal">${clues || `<p>${T0.none}</p>`}</div>${relics}`;
  }
  function openJournal(tab) {
    if (!G) return;
    if (tab) journalTab = tab;
    const tabs = `<div class="tabs">${[["clues", "線　索"], ["truth", TR().tab], ["people", "人物一覽"], ["lex", "名　錄"]].map(([k, t]) =>
      `<button data-tab="${k}" class="${journalTab === k ? "on" : ""}">${t}${k === "lex" && G.lexNew ? " ●" : ""}</button>`).join("")}</div>`;
    let body;
    if (journalTab === "truth") body = truthHtml();
    else if (journalTab === "lex") {
      G.lexNew = false; $("btn-journal").classList.remove("dot");
      body = lexHtml(G.lex || {});
    } else if (journalTab === "people") {
      body = `<p class="journal-note">點人物看詳細資料。還沒遇過的人只會顯示剪影。</p><div class="truth roster-grid">${ROSTER().map(id => {
        const p = P(id), met = p && p.met;
        return personCard(id, met, met ? `<div class="st">${stText(p)}${revealed(p) ? "・畫皮" : ""}</div>` : "", met && revealed(p), met ? figOf(p) : undefined);
      }).join("")}</div>`;
    } else {
      const qrows = S.quests.filter(q => G.quests[q.id] && (G.quests[q.id].step > 0 || G.quests[q.id].broken)).map(q => {
        const st = G.quests[q.id], step = q.steps[st.step];
        const state = st.broken ? "（託付你的人，已經不記得這件事了）" : st.done ? "（已完成）" : step && step.hint ? condText(step.hint) : "";
        return `<div class="item"><span class="nm">${q.title}</span><span class="ds">${S.people[q.owner].name}・${state}</span></div>`;
      }).join("");
      const clues = G.clues.map(c => `<p>・${c}</p>`).join("");
      const past = S.past.slice(0, G.memory).map(c => `<p>${c.replace(/\n/g, "<br>")}</p>`).join("");
      const lover = G.lovers.length ? `<p>你和${G.lovers.map(nm).join("、")}，心意相通。</p>` : "";
      const accuseHint = G.clues.length >= 2 && !G.masterExposed ? "<p class='hint'>有把握的話，可以在「處置」裡指認門主。</p>" : "";
      body = `<h3 class="sub">託付</h3><div class="shop">${qrows || "<p>還沒有人託付你什麼。和客人多聊聊、奉杯茶吧。</p>"}</div>
        <h3 class="sub">門　主</h3><div class="journal">${clues || "<p>無面門的頭領，藏在某個人的皮裡。完成客人的託付、或釘死畫皮時，會得到線索。</p>"}${accuseHint}${G.masterExposed ? "<p>門主已經現形。</p>" : ""}</div>
        ${(G.foodNotes || []).length ? `<h3 class="sub">${S.food.journal}</h3><div class="journal">${G.foodNotes.map(g => `<p>・${g}</p>`).join("")}</div>` : ""}
        ${(G.glimpses || []).length ? `<h3 class="sub">守夜所見</h3><div class="journal">${G.glimpses.map(g => `<p>・${g}</p>`).join("")}</div>` : ""}
        <h3 class="sub">從　前</h3><div class="journal">${past || "<p>……你不太願意去想以前的事。</p>"}</div>${lover}`;
    }
    openPanel("線索簿", tabs + body, b => {
      b.querySelectorAll("[data-tab]").forEach(x => x.addEventListener("click", () => openJournal(x.dataset.tab)));
      b.querySelectorAll(".card.click").forEach(x => x.addEventListener("click", () => personDetail(x.dataset.id)));
    });
  }

  // 人物詳細：隨著你挖到的東西慢慢補上（不會透露誰是畫皮，除非已經現形）
  function personDetail(id) {
    const p = P(id), d = S.people[id], pr = S.profiles[id] || {};
    const rows = [`<p>${pr.bio || ""}</p>`];
    rows.push(`<p class="kv"><span>狀態</span>${stText(p)}${revealed(p) ? "・<b class='red'>已現形：畫皮</b>" : ""}${G.lovers.includes(id) ? "・<b class='love'>戀人</b>" : ""}</p>`);
    if (p.status !== "out") {
      rows.push(`<p class="kv"><span>好感</span>${hearts(p.affection)}</p>`);
      if (isTarget(p)) rows.push(`<p class="kv"><span>情意</span>${flowers(loveOf(p))}${loveOf(p) < RM().flirtAt ? `　（情意 ${RM().flirtAt} 解鎖曖昧）` : loveOf(p) < RM().confessAt ? `　（情意 ${RM().confessAt} 解鎖表白）` : ""}</p>`);
      const A_ = S.affection, q0 = S.quests.find(x => x.owner === id), qst0 = q0 && G.quests[q0.id];
      let next = "";
      if (q0 && !(qst0 && (qst0.step > 0 || qst0.broken)) && p.affection < (q0.steps[0].minAff || 0)) next = A_.nextQuest.replace("{k}", q0.steps[0].minAff - p.affection);
      else if (d.secret && !p.secretTold && !p.fakeSecretTold) next = p.affection >= 3 ? A_.secretReady : A_.nextSecret.replace("{k}", 3 - p.affection);
      if (next) rows.push(`<p class="kv hint"><span></span>${next.replace(/\{n\}/g, d.name)}</p>`);
    }
    if (d.doc) rows.push(`<p class="kv"><span>路引</span>${d.doc.from}・${d.doc.age}・${d.doc.purpose}</p>`);
    const room = p.room || d.room;
    if (room) rows.push(`<p class="kv"><span>睡處</span>${bedName(room)}</p>`);
    const q = S.quests.find(x => x.owner === id), qst = q && G.quests[q.id];
    if (qst && (qst.step > 0 || qst.broken)) rows.push(`<p class="kv"><span>託付</span>${q.title}・${qst.broken ? "他已經不記得了" : qst.done ? "已完成" : "進行中"}</p>`);
    const dos = dossierOf(p);
    if (p.status !== "out") rows.push(`<h3 class="sub">${S.dossier.title}</h3>${dos.length ? dos.map(x => `<p class="quote">・${x.text}</p>`).join("") : `<p class="journal-note">${S.dossier.none}</p>`}`);
    if (p.secretTold && d.secret) rows.push(`<h3 class="sub">秘　密</h3><p class="quote">${d.secret.replace(/\n/g, "<br>")}</p>`);
    const heard = (G.heard && G.heard[id]) || [];
    if (heard.length) rows.push(`<h3 class="sub">別人怎麼說</h3>${heard.map(h => `<p class="quote"><span>${S.people[h.from].name}：</span>${h.text.replace(/\n/g, "<br>")}</p>`).join("")}`);
    openPanel(d.fullName || d.name, `<div class="detail"><div class="pic" style="background-image:url(assets/${figOf(p)})"></div><div class="info"><p class="role">${pr.role || ""}</p>${rows.join("")}</div></div>
      <button class="back" data-back>← 返回一覽</button>`, b => b.querySelector("[data-back]").addEventListener("click", () => openJournal("people")));
  }

  // ---------- 主畫面：跨局圖鑑 ----------
  let codexTab = "people";
  function openCodex(tab) {
    if (tab) codexTab = tab;
    const c = codexGet();
    const tabs = `<div class="tabs">${[["people", "人　物"], ["endings", "結　局"],["titles", "稱　號"], ["lex", "名　錄"]].map(([k, t]) => `<button data-tab="${k}" class="${codexTab === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
    let body = "";
    if (codexTab === "lex") body = lexHtml(c.lex);
    else if (codexTab === "people") {
      const ids = ROSTER(), n = ids.filter(id => c.met[id]).length;
      body = `<p class="journal-note">遇過的人：${n}／${ids.length}</p><div class="truth roster-grid">${ids.map(id => personCard(id, c.met[id])).join("")}</div>`;
    } else if (codexTab === "endings") {
      const keys = Object.keys(S.endings);
      // 看過的結局旁邊放插圖縮圖（TOWN_DATA.endings：結局 → 圖檔；舊版是陣列，就不放）
      const EA0 = (window.TOWN_DATA || {}).endings || {}, EA = Array.isArray(EA0) ? {} : EA0;
      const node = n => n.k ? (() => {
        const v = S.endings[n.k], seen = c.endings[n.k], img = seen && EA[n.k];
        const thumb = img ? `<span class="thumb" data-img="${img}" data-cap="${v.title}" style="background-image:url(assets/${img})" title="看插圖"></span>` : "";
        return `<li class="leaf${seen ? " seen" : ""}${img ? " has-art" : ""}">${thumb}<span class="nm${seen ? (v.bad ? " red" : " gold") : ""}">${seen ? v.title : "？？？"}</span><span class="cond">條件：${n.cond}</span>${seen ? `<span class="ds">${v.desc.replace(/\{[lk]\}/g, "她").replace(/\n/g, " ")}</span>` : ""}</li>`;
      })() : `<li class="branch"><span class="bl">${n.label}</span><ul>${n.children.map(node).join("")}</ul></li>`;
      body = `<p class="journal-note">看過的結局：${keys.filter(k => c.endings[k]).length}／${keys.length}</p><ul class="etree"><li class="branch root"><span class="bl">第一夜</span><ul>${S.endingTree.map(node).join("")}</ul></li></ul>`;
    } else {
      const all = [...Object.values(S.titles), ...S.epilogues.filter(e => e.title).map(e => ({ name: e.title, desc: "後日談" })), { name: "有情人", desc: "戀人的後日談" }];
      const uniq = all.filter((t, i) => all.findIndex(x => x.name === t.name) === i);
      body = `<p class="journal-note">拿過的稱號：${uniq.filter(t => c.titles[t.name]).length}／${uniq.length}</p><div class="shop titles">${uniq.map(t => c.titles[t.name]
        ? `<div class="item"><span class="nm gold">【${t.name}】</span><span class="ds">${t.desc}</span></div>`
        : `<div class="item"><span class="nm">【？？？】</span><span class="ds">尚未取得</span></div>`).join("")}</div>`;
    }
    openPanel("圖　鑑", tabs + body, b => {
      b.querySelectorAll("[data-tab]").forEach(x => x.addEventListener("click", () => openCodex(x.dataset.tab)));
      b.querySelectorAll(".card.click").forEach(x => x.addEventListener("click", () => codexDetail(x.dataset.id)));
      b.querySelectorAll(".etree .thumb").forEach(x => x.addEventListener("click", () => viewArt(x.dataset.img, x.dataset.cap)));
    });
  }
  // 全螢幕看一張插圖，點任何地方或按 Esc 關閉
  function viewArt(img, cap) {
    const v = document.createElement("div");
    v.className = "art-view";
    v.innerHTML = `<div class="art-img" style="background-image:url(assets/${img})"></div><div class="art-cap">${cap || ""}</div>`;
    const close = e => { if (e.type === "keydown" && e.key !== "Escape") return; e.stopPropagation(); v.remove(); document.removeEventListener("keydown", close, true); };
    v.addEventListener("click", close);
    document.addEventListener("keydown", close, true);
    document.body.appendChild(v);
  }
  function codexDetail(id) {
    const c = codexGet(), d = S.people[id], pr = S.profiles[id] || {};
    const secret = c.secrets[id] && d.secret
      ? `<h3 class="sub">秘　密</h3><p class="quote">${d.secret.replace(/\n/g, "<br>")}</p>`
      : `<p class="journal-note">（還沒聽過${d.name}的秘密）</p>`;
    openPanel(d.fullName || d.name, `<div class="detail"><div class="pic" style="background-image:url(assets/fig_${id}.png)"></div><div class="info"><p class="role">${pr.role || ""}</p><p>${pr.bio || ""}</p>${secret}</div></div>
      <button class="back" data-back>← 返回圖鑑</button>`, b => b.querySelector("[data-back]").addEventListener("click", () => openCodex("people")));
  }

  // 地圖提示開關（預設開，記在瀏覽器裡）
  function mapHints() { try { return localStorage.getItem("louke_maphint") !== "off"; } catch (e) { return true; } }
  function setMapHints(on) { try { localStorage.setItem("louke_maphint", on ? "on" : "off"); } catch (e) {} }

  // ---------- 設定 ----------
  function openSettings() {
    const v = SFX.getVolume(), inGame = !!G && $("title-screen").classList.contains("hidden");
    const slider = (k, label) => `<div class="vol"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(v[k] * 100)}" data-vol="${k}"><b>${Math.round(v[k] * 100)}</b></div>`;
    openPanel("設　定", `<div class="settings">
        ${inGame ? `<button data-act="save">存　檔</button>` : ""}
        <button data-act="load">讀取存檔</button>
        <button data-act="guide">遊戲介紹</button>
        ${slider("music", "音樂音量")}${slider("sfx", "音效音量")}
        <label class="toggle"><input type="checkbox" data-coach ${coachOn() ? "checked" : ""}><span>新手提示</span><small>第一次叩門、第一次白天時，指出每個按鈕的用途（重新打開會從頭再提示一次）</small></label>
        <label class="toggle"><input type="checkbox" data-hint ${mapHints() ? "checked" : ""}><span>地圖提示</span><small>在地圖上標出預告目標、可推進的託付、有人在談事情的地點（密函的可能位置一定會顯示）</small></label>
        ${inGame ? `<button data-act="title" class="danger">回到主畫面</button>` : ""}
        <p class="ver">樓客 ${VERSION}　${COPYRIGHT}</p>
      </div>`, b => {
      b.querySelectorAll("input[data-vol]").forEach(r => r.addEventListener("input", () => {
        SFX.init();
        SFX.setVolume(r.dataset.vol, r.value / 100);
        r.nextElementSibling.textContent = r.value;
        if (r.dataset.vol === "sfx") { clearTimeout(r._t); r._t = setTimeout(() => SFX.knock(), 150); }   // 調音效時試聽一下
      }));
      b.querySelector("input[data-hint]").addEventListener("change", e => setMapHints(e.target.checked));
      b.querySelector("input[data-coach]").addEventListener("change", e => coachSet(e.target.checked));
      b.querySelectorAll("button[data-act]").forEach(x => x.addEventListener("click", async () => {
        const a = x.dataset.act;
        if (a === "save") { closePanel(); await manualSave(); }
        if (a === "guide") { closePanel(); await openGuide(); openSettings(); }
        if (a === "load") {
          if (inGame && !(await confirmBox("讀取存檔？\n目前沒有存檔的進度會遺失。", "讀取"))) return;
          openLoadPanel();
        }
        if (a === "title") {
          closePanel();
          if (await confirmBox("回到主畫面？\n沒有存檔的進度會遺失。", "回主畫面", true)) showTitle();
        }
      }));
    });
  }

  function dayActions() {
    const list = [
      { label: "客棧地圖", fn: openMap },
    ];
    const noAp = G.ap <= 0;
    const here = active().filter(p => p.loc === G.loc && !hidingNow(p));
    if (phantomHere()) list.push({ label: `查看${S.spots[G.loc]}`, fn: checkPhantom });
    if (letterLeft().includes(G.loc)) list.push({ label: S.plot.searchLabel, cls: "danger", disabled: noAp, fn: searchLetter });
    if (guardLoc() === G.loc && !G.plot.guarded) {
      const tonight = G.plot.killNight === G.night + 1;
      list.push({ label: fillPlot(tonight ? S.plot.guardLabel : S.plot.guardWait), cls: "danger", disabled: !tonight, fn: guardRoom });
    }
    if (G.loc === "hall" && G.night >= 2 && G.assemblyDay !== G.night && active().length >= 3)
      list.push({ label: "召集議事（1 行動）", disabled: noAp, fn: () => assembly(false) });
    list.push(...questButtons("loc:" + G.loc));
    if (G.loc === "counter") list.push({ label: "翻看帳本", fn: openLedger });
    if (G.loc === "counter" && G.truth.saw && G.truth.layer === 3) list.push({ label: TR().ledgerLabel, cls: "quest", fn: async () => {
      setActions([]); SFX.sting(); await playLines(TR().ledger); await truthLayer4(); await showLocation(); } });
    if (G.loc === "woodshed" && G.truth.layer >= 3 && !G.truth.relics.cart) list.push({ label: TR().relicCartLabel, cls: "quest", disabled: noAp, fn: async () => {
      spend(); setActions([]); G.truth.relics.cart = true; await say("", TR().relicCart, true); await showLocation(); } });
    if (here.length >= 2) list.push({ label: sceneHere(here) ? "旁聽・似乎在談什麼（1 行動）" : "旁聽（1 行動）", disabled: noAp, fn: () => overhear(here) });
    if (G.loc === "corridor") list.push({ label: "貼門偷聽（1 行動）", disabled: noAp, fn: eavesdrop });
    if (G.loc === "corridor" && (G.items.ash > 0 || G.ash === G.night)) list.push({ label: G.ash === G.night ? S.ash.done : S.ash.label.replace("{c}", G.items.ash), disabled: G.ash === G.night, fn: useAsh });
    if (G.loc.startsWith("room")) {
      const can = searchable(G.loc).length > 0;
      list.push({ label: can ? "搜房（1 行動）" : S.loot.none, disabled: noAp || !can, fn: searchRoom });
    }
    list.push("sep", { label: S.town.leaveLabel, fn: goOut }, { label: "入夜", cls: "danger", fn: () => endDay(false) });
    return list;
  }

  // 旁聽：同一個地點兩人以上
  async function overhear(here) {
    spend(); setActions([]);
    if (!(await playScene(here))) {
      const f = here.find(p => p.fake), o = here.find(p => p !== f);
      const t = f && Math.random() < 0.6
        ? fill(pick(S.overhearFake), null).replace(/\{f\}/g, name(f)).replace(/\{o\}/g, name(o))
        : (() => { const [a, b] = shuffle(here); return pick(S.overhearReal).replace(/\{a\}/g, name(a)).replace(/\{b\}/g, name(b)); })();
      await say("旁聽", t, true);
    }
    await showLocation();
  }

  // 走廊偷聽：聽有人在的客房
  async function eavesdrop() {
    spend(); setActions([]);
    const rooms = ["room1", "room2", "room3"].map(r => active().filter(p => p.loc === r)).filter(a => a.length);
    if (!rooms.length) { await say("偷聽", "你把耳朵貼在每一扇門上。房裡都沒有人。", true); return showLocation(); }
    const ppl = pick(rooms);
    const roomName = S.locations[ppl[0].loc].name;
    await say("偷聽", `你把耳朵貼在${roomName}的門上。`, true);
    if (ppl.length >= 2 && await playScene(ppl)) return showLocation();
    const f = ppl.find(p => p.fake);
    const who = f && Math.random() < 0.7 ? f : pick(ppl);
    const t = who.fake && who === f ? pick(S.eavesFake) : who.id === S.mute.id ? S.mute.eaves : pick(S.eavesReal);
    await say("偷聽", fill(t, who), true);
    await showLocation();
  }

  // 搜房：翻看不在房裡的住客的行李
  // 這間房裡能翻的行李：活著但不在房裡的住客，以及還沒翻過的死者遺物（被趕走、離開的人把行李帶走了）
  const isDead = p => p.status === "dead" || p.status === "murdered";
  const searchable = loc => Object.values(G.people).filter(p => p.room === loc &&
    (isDead(p) ? !p.looted : (isIn(p) && p.loc !== loc)));

  async function searchRoom() {
    const owners = searchable(G.loc);
    if (!owners.length) return showLocation();
    const pickP = await choose("要翻誰的行李？", [...owners.map(p => ({ label: isDead(p) ? S.loot.label.replace("{n}", name(p)) : name(p), value: p })), { label: "算了", value: null }]);
    if (!pickP) return showLocation();
    spend();
    if (G.theft && G.theft.t === pickP.id) {
      const C = S.crowd.theft, v = P(G.theft.v);
      await say("搜房", (pickP.fake ? C.foundFake : C.found).replace(/\{t\}/g, name(pickP)).replace(/\{v\}/g, name(v)), true);
      if (pickP.fake) note(pickP, "偷來的錢袋裡，銅錢都變成了紙錢", 2.5);
      affect(v, 2); affect(pickP, -2);
      await say("", C.returned.replace(/\{t\}/g, name(pickP)).replace(/\{v\}/g, name(v)), true);
      G.theft = null;
    }
    else if (isDead(pickP)) await lootDead(pickP);
    else if (isCulprit(pickP)) await gotEvidence(pick(S.plot.evidenceSearch));
    else {
      const odd = pickP.fake && Math.random() < 0.7;
      const t = odd ? fill(pick(S.searchFake), pickP) : S.people[pickP.id].belongings;
      if (odd) note(pickP, "搜房找到：" + t, 2);
      await say("搜房", t, true);
    }
    await showLocation();
  }

  // 翻死者的遺物
  async function lootDead(p) {
    const L = S.loot, d = S.people[p.id];
    p.looted = true;
    if (p.fake) {
      // 殺對的畫皮：牠的行李裡有線索
      await say("遺物", L.fakeIntro, true);
      const others = active().filter(o => o.fake && !o.known);
      if (G.plot && !G.plot.found) {
        const l = S.locations[G.plot.letterLoc].name;
        G.plot.searched = G.plot.candidates.filter(c => c !== G.plot.letterLoc);   // 其他候選地點都劃掉
        await say("遺物", L.letterHint.replace(/\{l\}/g, l), true);
      } else {
        const c = Math.random() < 0.5 || !others.length ? nextClue() : null;
        if (c) await say("遺物", L.masterHint.replace("{c}", c), true);
        else if (others.length) await say("遺物", L.listHint.replace(/\{r\}/g, bedName(pick(others).room)), true);
      }
      return;
    }
    // 真人：私人物品
    await say("遺物", d.belongings, true);
    // 命案現場：兇手留下的痕跡
    if (p.status === "murdered" && p.killedBy && P(p.killedBy)) {
      const k = P(p.killedBy), t = S.traits[k.id] || {}, sc = L.scene, opts = [];
      if (t.sex) opts.push({ text: sc.sex[t.sex], k: "sex", v: t.sex });
      if (t.age) opts.push({ text: sc.age[t.age], k: "age", v: t.age });
      opts.push({ text: sc.bed.replace("{b}", bedName(k.room)), k: "bed", v: k.room || "dorm" });
      const o = pick(opts), g = o.text;
      (G.glimpses = G.glimpses || []).push(g);
      (G.glimpseTraits = G.glimpseTraits || []).push(o);
      await say(L.sceneTitle, g, true);
    }
    // 沒寄出去的信：來不及說出口的秘密
    if (d.secret && !p.secretTold) {
      p.secretTold = true; G.flags["secret_" + p.id] = true; codexMark("secrets", p.id);
      await say("遺物", L.letter, true);
      await say(d.name, d.secret, true);
      if (["qin", "han", "liu", "doctor"].includes(p.id)) await remember();
    } else await say("遺物", L.noLetter.replace(/\{n\}/g, d.name), true);
    // 拿不拿遺物裡的錢
    const c = 20 + Math.floor(Math.random() * 3) * 10;
    await say("遺物", L.money.replace("{c}", c), true);
    const take = await choose("要怎麼做？", [{ label: L.take, value: true }, { label: L.leave, value: false }]);
    if (take) { G.coins += c; G.sanity -= 5; updateTopbar(); await say("", L.took, true); }
    else await say("", L.left, true);
  }

  function openLedger() {
    const rows = inside().filter(p => S.people[p.id].kind === "guest").map(p =>
      `<div class="item"><span class="nm">${albumName(p)}</span><span class="ds">第 ${p.admittedNight} 夜入住・${bedName(p.room)}${p.status === "locked" ? "・關在柴房" : ""}</span></div>`).join("");
    const money = (G.ledger || []).map(l => `<div class="item"><span class="nm">${l.date}</span><span class="ds">收房錢 ${l.total} 文${l.paper ? `，其中紙錢 ${l.paper} 文` : ""}</span></div>`).join("");
    openPanel("歸雁樓帳本", `<div class="shop">${rows || "<p>樓裡沒有住客。</p>"}</div><h3 class="sub">房錢</h3><div class="shop">${money || "<p>還沒有收過房錢。</p>"}</div>`);
  }

  async function showLocation(text) {
    if (!dayOpen()) return;                          // 已經入夜：晚到的流程直接略過
    if (G.out) return showTown(text);
    await staleTasks();
    waitingSay = 0;                                  // 回到可以自由操作的畫面：保險起見歸零
    if (!waiter) clearMarks();
    ensureScene(`loc_${G.loc}.jpg`);
    const here = renderFigures();
    const L = S.locations[G.loc];
    setActions(dayActions(), true);
    coach("day");
    if (G.night >= 2 || coachSeen().day) coach("eco");
    if (G.loc === "kitchen" && here.some(p => p.id === "qin")) coach("qin");
    if (G.ap === 1) coach("last");
    if (G.foodShortSeen) coach("short");
    plotRemind();
    const out = phantomDusk();
    if (out) { await say("", out, true); return showLocation(text); }
    const after = G.phantomAfter && !here.length; G.phantomAfter = false;
    const who = after ? S.phantom.after : phantomHere() && !here.length ? S.phantom.arrive.replace(/\{s\}/g, S.spots[G.loc])
      : here.length ? `這裡有：${here.map(name).join("、")}。點選人物可以互動。` : "這裡一個人也沒有。";
    const ph = A.locations[G.loc]?.placeholder ? "（此地背景為暫代圖）" : "";
    const dogLine = G.loc === "yard" && dogOk() ? "\n黑子趴在柴堆旁，尾巴輕輕掃著地。" : "";
    const desc = !here.length && L.descEmpty ? L.descEmpty : L.desc;   // 沒人的時候，換一句不矛盾的描述
    await say(L.name, text || `${desc}\n${who}${ph}${dogLine}`);
    if (G.ap <= 0) await outOfTime();
  }

  function rosterHtml() {
    const O = S.outing;
    const rows = Object.keys(S.locations).map(l => {
      const ps = inside().filter(p => p.loc === l && !hidingNow(p));
      return ps.length ? `<b>${S.locations[l].name}</b>：${ps.map(name).join("、")}` : "";
    }).filter(Boolean);
    const out = inside().filter(p => p.away);
    if (out.length) rows.push(`<b>${O.rosterOut}</b>：${out.map(p => `${name(p)}（${p.awayFake ? "不知道去了哪" : T().places[p.away].name}）`).join("、")}`);
    return `<div class="map-roster"><b>${O.rosterTitle}</b><br>${rows.join("<br>") || "樓裡沒有別人。"}</div>`;
  }
  function openMap() {
    const counts = {};
    inside().forEach(p => counts[p.loc] = (counts[p.loc] || 0) + 1);
    if (G.phantom && !G.phantom.done && G.phantom.kind !== "person") counts[G.phantom.loc] = (counts[G.phantom.loc] || 0) + 1;   // 地圖上多出來的那一個（藏著的人本來就算在裡面）
    const hintsOn = mapHints();
    const targetLoc = guardLoc();
    const cell = (loc, cls = "") => {
      const L = S.locations[loc];
      // 地圖提示：密函候選（一定顯示）、預告目標、可推進的託付、有人在談事情
      const tags = [], marks = [];
      if (letterLeft().includes(loc)) { marks.push("m-letter"); tags.push(`<i class="t-letter">？密函</i>`); }
      else if (G.plot && !G.plot.found && G.plot.searched.includes(loc)) tags.push(`<i class="t-done">已搜過</i>`);
      if (hintsOn) {
        const here = active().filter(p => p.loc === loc);
        if (targetLoc === loc) { marks.push("m-target"); tags.push(`<i class="t-target">預告：${bedName(G.plot.room)}</i>`); }
        if (questsAt("loc:" + loc).length || here.some(p => questsAt(p.id).length)) { marks.push("m-quest"); tags.push(`<i class="t-quest">託付</i>`); }
        if (here.length >= 2 && sceneHere(here)) { marks.push("m-scene"); tags.push(`<i class="t-scene">有人在談</i>`); }
      }
      return `<button data-loc="${loc}" class="${cls}${G.loc === loc ? " here" : ""} ${marks[0] || ""}">${L.name}<small>${counts[loc] || 0} 人${L.cap < 99 ? `／上限 ${L.cap}` : ""}${G.loc === loc ? "・你在這裡" : ""}</small>${tags.length ? `<span class="tags">${tags.join("")}</span>` : ""}</button>`;
    };
    openPanel("歸雁樓", `<div class="map">
        <div class="floor">二　樓</div>${cell("room1")}${cell("room2")}${cell("room3")}${cell("corridor", "corridor")}
        <div class="floor">一　樓</div>${cell("counter")}${cell("hall", "hall")}${cell("kitchen")}
        <div class="floor">後　頭</div>${cell("woodshed")}${cell("yard")}<div></div>
      </div>${rosterHtml()}<p class="map-legend">移動不花行動點。　<i class="t-letter">？密函</i> 可能藏著密函${hintsOn ? `　<i class="t-target">預告</i> 密函點名的睡處　<i class="t-quest">託付</i> 可以推進託付　<i class="t-scene">有人在談</i> 旁聽會有劇情` : ""}</p>`,
      body => body.querySelectorAll("button[data-loc]").forEach(b => b.addEventListener("click", () => goTo(b.dataset.loc))));
  }

  function shopHtml(where, mult = 1) {
    const F = S.food, fp = Math.ceil(foodPrice() * mult);
    const heads = inside().length + 1, need = heads * F.eat, lack = need - (G.food || 0);   // 跟晚飯扣糧的算法一樣
    const needTx = F.need.replace("{n}", heads).replace("{d}", need) + (lack > 0 ? F.needShort.replace("{c}", G.food || 0).replace("{l}", lack) : F.needOk.replace("{c}", G.food || 0));
    const food = `<div class="item"><span class="nm">${F.buyLabel}</span><span class="ds">${F.buyDesc}${G.famine ? "（糧價翻倍）" : ""}<br><span class="need${lack > 0 ? " short" : ""}">${needTx}</span></span><span class="qty">有 ${G.food || 0}</span>
       <button data-food="1" ${G.coins < fp ? "disabled" : ""}>${F.buy1}・${fp} 文</button><button data-food="5" ${G.coins < fp * 5 ? "disabled" : ""}>${F.buy5}・${fp * 5} 文</button></div>`;
    return `<div class="money">銅錢 ${G.coins} 文</div><div class="shop">${food}${Object.entries(S.items).filter(([, it]) => (it.where || "market") === where).map(([k, it]) => {
      const pr = Math.ceil(priceOf(k) * mult);
      return `<div class="item"><span class="nm">${it.name}</span><span class="ds">${it.desc}</span><span class="qty">有 ${G.items[k]}</span>
       <button data-buy="${k}" ${G.coins < pr || G.items[k] >= capOf(k) ? "disabled" : ""}>${G.items[k] >= capOf(k) ? "帶滿了" : pr + " 文"}</button></div>`; }).join("")}</div>`;
  }
  function openShop(where = "market", mult = 1, title) {
    openPanel(title || (mult > 1 ? S.food.qinTitle : S.town.shopTitle), shopHtml(where, mult), function bind(body) {
      body.querySelectorAll("button[data-buy]").forEach(b => b.addEventListener("click", () => {
        const k = b.dataset.buy, pr = Math.ceil(priceOf(k) * mult);
        if (G.coins < pr || G.items[k] >= capOf(k)) return;
        G.coins -= pr; G.items[k]++;
        updateTopbar();
        body.innerHTML = shopHtml(where, mult); bind(body);
      }));
      body.querySelectorAll("button[data-food]").forEach(b => b.addEventListener("click", () => {
        const n = +b.dataset.food, pr = Math.ceil(foodPrice() * mult) * n;
        if (G.coins < pr) return;
        G.coins -= pr; G.food = (G.food || 0) + n;
        updateTopbar();
        body.innerHTML = shopHtml(where, mult); bind(body);
      }));
    });
  }
  // 陳小六跑腿：不加價，他出門一整天
  async function chenErrand(p) {
    setActions([]);
    await say("", S.chenErrand.go, true);
    G.chenRun = G.night;
    p.away = "market"; p.awayLoc = p.loc; p.loc = "town";
    G.sel = null;
    showLocation();
    openShop("market", 1, S.chenErrand.title);
  }
  // 秦嬸代買：貴一成，她出門一整天
  async function qinShop() {
    const q = P("qin");
    setActions([]);
    await say("", S.food.qinGo, true);
    G.qinShop = G.night;
    q.away = "market"; q.awayLoc = q.loc; q.loc = "town";
    G.sel = null;
    showLocation();
    openShop("market", S.food.qinMarkup);
  }
  function openItems() {
    const wrong = G.sanity < 20 ? pick(Object.keys(S.items)) : null;     // 心神很低：看錯一樣東西的數量（只是顯示）
    const rows = Object.entries(S.items).map(([k, it]) =>
      `<div class="item"><span class="nm">${it.name}</span><span class="ds">${it.desc}</span><span class="qty">有 ${k === wrong ? G.items[k] + 1 : G.items[k]}</span></div>`).join("");
    const nt = E.taxNights.find(n => G.phase === "day" ? n > G.night : n >= G.night), W = S.taxWarn;   // 白天時，今早的稅已經收過了
    const taxLine = nt ? W.next.replace("{n}", nt).replace("{c}", taxOf(nt)) : W.none;
    openPanel("身上的道具", `<div class="money">銅錢 ${G.coins} 文${G.paper ? `　紙錢 ${G.paper} 文（可到城隍廟換銅錢）` : ""}<br><small>${taxLine}</small></div><div class="shop">${rows}</div>`);
  }

  // ---------- 與人物互動 ----------
  function spend() {
    G.ap--; updateTopbar();
    if (G.ap === 1 && G.phase === "day" && G.lastWarned !== G.night) {
      G.lastWarned = G.night;
      let el = $("toast");
      if (!el) { el = document.createElement("div"); el.id = "toast"; stage.appendChild(el); }
      const lack = (inside().length + 1) * S.food.eat - (G.food || 0);
      [S.dinner.lastToast, ...(lack > 0 ? [S.dinner.lastFood.replace("{c}", lack)] : [])].forEach(t => {
        const line = document.createElement("div"); line.className = "warn"; line.textContent = t;
        el.appendChild(line); setTimeout(() => line.remove(), 4000);
      });
    }
  }

  const affCapped = p => !!G.affDay && G.affDay.night === G.night && (G.affDay.got[p.id] || 0) >= (E.dailyAffection || 2);
  const freeChatUsed = p => !!G.affDay && G.affDay.night === G.night && !!(G.affDay.free || {})[p.id];
  function chatButton(p, noAp, locked) {
    if (!affCapped(p)) return { label: "閒聊", disabled: noAp || locked, fn: () => chat(p) };
    const used = freeChatUsed(p);
    return { label: used ? S.chatCap.done : S.chatCap.free, disabled: used || locked, fn: () => chat(p, true) };
  }
  function selectPerson(p) {
    if (!dayOpen()) return;
    G.sel = p.id;
    renderFigures();
    const d = S.people[p.id], noAp = G.ap <= 0;
    const locked = p.status === "locked";
    if (p.known) {                                         // 已經識破的畫皮：不再閒聊、談心、曖昧，只能觀察、處置
      setActions([
        { label: "觀察", disabled: noAp, fn: () => observe(p) },
        { label: "處置……", disabled: noAp, fn: () => disposeMenu(p) },
        "sep",
        { label: "返回", fn: () => { G.sel = null; showLocation(); } }
      ], true);
      return say(`${shownFull(p)}（畫皮）`, locked ? S.knownMenu.locked.replace(/\{n\}/g, name(p)) : S.knownMenu.free.replace(/\{n\}/g, name(p)));
    }
    const list = [
      chatButton(p, noAp, locked),
      { label: "問起他人", disabled: noAp || locked, fn: () => askAbout(p) },
      { label: `奉茶（${E.teaPrice} 文）${affCapped(p) ? S.chatCap.tea : ""}`, disabled: noAp || locked || G.coins < E.teaPrice, fn: () => tea(p) },
      { label: "觀察", disabled: noAp, fn: () => observe(p) },
      { label: "跟蹤（2 行動）", disabled: G.ap < 2 || locked, fn: () => follow(p) },
      ...(locked ? [] : questButtons(p.id)),
      ...(p.id === "chen" && !locked && (S.pay || {}).chen ? [G.chenRun === G.night
        ? { label: S.chenErrand.away, disabled: true, fn: () => {} }
        : { label: S.chenErrand.label, fn: () => chenErrand(p) }] : []),
      ...(p.id === "qin" && !locked && !p.hurt ? [{ label: S.food.qinLabel, fn: () => qinShop() }] : []),
      ...specialButtons(p),
      ...romanceButtons(p),
      ...(G.truth.layer >= 3 && p.id === "wang" && !G.truth.told.wang && !locked ? [{ label: TR().tellWang.label, cls: "quest", disabled: noAp, fn: () => tellWang(p) }] : []),
      ...(G.truth.layer >= 3 && G.lovers.includes(p.id) && !G.truth.told[p.id] && !locked && TR().tell[p.id] ? [{ label: TR().tellLabel.replace("{n}", name(p)), cls: "quest", disabled: noAp, fn: () => tellTruth(p) }] : []),
      ...(hurtOf(p) ? [{ label: S.crowd.medLabel.replace("{c}", G.items.medicine), disabled: noAp || G.items.medicine <= 0, fn: () => useMedicine(p) }] : []),
      ...(S.crowd.healers.includes(p.id) && p.status === "in" && !p.hurt && inside().some(hurtOf) ? [{ label: S.crowd.healLabel.replace("{n}", name(p)), disabled: noAp, fn: () => heal(p) }] : []),
      ...(G.quarrel && [G.quarrel.a, G.quarrel.b].includes(p.id) ? [{ label: S.crowd.quarrel.label.replace("{a}", nm(G.quarrel.a)).replace("{b}", nm(G.quarrel.b)), cls: "quest", disabled: noAp, fn: mediate }] : []),
      { label: "處置……", disabled: noAp, fn: () => disposeMenu(p) },
      "sep",
      { label: "返回", fn: () => { G.sel = null; showLocation(); } }
    ];
    setActions(list, true);
    say(`${shownFull(p)}　${hearts(p.affection)}${isTarget(p) && p.affection >= RM().talkNeed ? "　" + flowers(loveOf(p)) : ""}`, locked ? `${name(p)}被鎖在柴房裡，隔著門板看著你。` : `你走到${name(p)}身邊。`);
  }

  async function tellWang(p) {
    const W = TR().tellWang;
    spend(); setActions([]);
    G.truth.told.wang = true;
    if (p.fake) { note(p, TR().tellNote, 3); await say("", TR().tellFake.replace(/\{n\}/g, name(p)), true); return afterAction(p); }
    await playLines(W.intro);
    if (p.affection >= W.stayAff) { G.flags.wangStay = true; await playLines(W.stay); affect(p, 1); return afterAction(p); }
    delete G.truth.told.wang;                       // 她走了，不算「知道真相還願意留下」
    G.flags.wangLeft = true;
    await playLines(W.leave);
    leaveInn(p, "left", "知道真相後離開"); p.returnNight = null;
    await afterAction(null);
  }
  async function tellTruth(p) {
    spend(); setActions([]);
    G.truth.told[p.id] = true;
    if (p.fake) { note(p, TR().tellNote, 3); await say("", TR().tellFake.replace(/\{n\}/g, name(p)), true); }
    else { await playLines(TR().tell[p.id]); affect(p, 1); }
    await afterAction(p);
  }

  async function afterAction(p) {
    if (!dayOpen()) return;
    if (p && (p.status === "in" || p.status === "locked") && p.loc === G.loc && G.ap > 0) selectPerson(p);
    else { G.sel = null; await showLocation(); }   // 行動點用完時，showLocation 會接著入夜
  }

  async function chat(p, free) {
    if (free) (G.affDay.free = G.affDay.free || {})[p.id] = true; else spend();
    setActions([]);
    const d = S.people[p.id];
    // 真人照順序說新的話，說完了才重複；畫皮說的話混著專屬和共用台詞
    let line = p.fake ? pick([...(d.fakeChat || []), ...S.fakeChat])
      : p.chatIdx < d.chat.length ? d.chat[p.chatIdx++] : pick(d.chat);
    // 特別台詞：樓裡有某人時才會說（例如錢婆婆認出婦人），每句只說一次
    const special = Object.entries(d.chatIf || {}).find(([who]) => {
      const o = G.people[who];
      return o && (o.status === "in" || o.status === "locked") && !(p.saidIf || []).includes(who);
    });
    if (special && !p.fake) { line = special[1]; (p.saidIf = p.saidIf || []).push(special[0]); }
    if (G.plot && roomOf(p) === G.plot.room && !G.plot.victimTold && !p.fake && !isCulprit(p)) { line = S.plot.victimChat; G.plot.victimTold = true; }
    if (G.lovers.length && !G.lovers.includes(p.id) && S.loverReact[p.id] && !p.fake && !p.loverReacted) { p.loverReacted = true; line = S.loverReact[p.id]; }
    // 戀人：活人說情話；被換掉的戀人會說些讓人發毛的話
    if (G.lovers.includes(p.id) && Math.random() < 0.6) line = p.fake ? pick(S.lover.fakeChat) : pick(S.lover.chat[p.id] || d.chat);
    // 啞姑：偶爾畫出樓裡「沒有臉」的人
    if (p.id === "yagu" && Math.random() < S.special.sketch.chance) {
      const X = S.special.sketch, others = active().filter(o => o !== p && !o.known);
      const target = p.fake ? pick(others.filter(o => !o.fake).concat([null])) : pick(others.filter(o => o.fake).concat([null]));
      line = target ? X.hit.replace("{s}", S.people[target.id].sketch || name(target)) : X.none;
      if (target) note(target, "啞姑的畫裡，這個人沒有臉", 1.5);
    }
    let truthKey = null;
    const TL = TR().chatLines[p.id];
    if (TL && !p.fake && !hasTruth(p.id) && G.night >= TR().chatNight && Math.random() < TR().chatChance) { line = TL.replace("{h}", housemates(p)); truthKey = p.id; }
    if (!free) dailyAffect(p, 1);
    await say(d.name, line, true);
    if (truthKey) truthClue(truthKey);
    await afterAction(p);
  }

  async function askAbout(p) {
    const others = inside().filter(o => o !== p);
    if (!others.length) return say("", "樓裡沒有別人可以問。");
    const o = await choose(`要向${name(p)}打聽誰？`, [...others.map(o => ({ label: name(o), value: o })), { label: "算了", value: null }]);
    if (!o) return selectPerson(p);
    spend();
    const d = S.people[p.id];
    let t;
    if (!p.fake && isCulprit(o) && Math.random() < 0.5) {
      await gotEvidence(S.plot.evidenceAsk, { b: name(o) });
      return afterAction(p);
    }
    if (p.id === "ye") {                               // 葉姑娘聽心跳：約兩成會聽錯；她是畫皮的話，反著說
      const H = S.special.heart;
      if (!G.yeHeard || G.yeHeard.night !== G.night) G.yeHeard = { night: G.night, r: {} };
      if (G.yeHeard.r[o.id] === undefined) G.yeHeard.r[o.id] = p.fake ? Math.random() < 0.3 : Math.random() < H.accuracy;
      const right = G.yeHeard.r[o.id];
      t = (o.fake === right ? H.none : H.some);
      if (t === H.none) note(o, "葉姑娘說，聽不到心跳", 1.5);
    }
    else if (p.fake) t = pick(S.askFake);
    else if (o.fake && Math.random() < 0.6) t = pick(isMuteP(p) ? S.askAboutFake.filter(x => !/說話/.test(x)) : S.askAboutFake);
    else t = (d.opinions && d.opinions[o.id]) || pick(S.opinionsDefault);
    const said = fill(t, p, { b: name(o) });
    G.heard = G.heard || {};
    const list = (G.heard[o.id] = G.heard[o.id] || []);
    if (!list.some(h => h.text === said)) list.push({ from: p.id, text: said });
    await say(d.name, said, true);
    await afterAction(p);
  }

  async function tea(p) {
    spend(); setActions([]);
    G.coins -= E.teaPrice; updateTopbar();
    const d = S.people[p.id];
    const drinks = !p.fake || Math.random() < 0.25;       // 畫皮偶爾也會勉強喝一口
    if (p.id === S.mute.id) await say("", drinks ? S.mute.tea : S.mute.teaFake, true);
    else await say("", fill(pick(drinks ? S.teaReal : S.teaFake), p), true);
    dailyAffect(p, 2);
    if (p.fake && p.affection >= 3 && !p.fakeSecretTold && S.fakeSecrets[p.id]) {
      p.fakeSecretTold = true;                 // 畫皮的「秘密」跟本人的說法對不上
      note(p, "說的秘密，跟之前的說法對不上", 2);
      await say(d.name, S.fakeSecrets[p.id], true);
    }
    if (!p.fake) {
      if (p.affection >= 3 && d.secret && !p.secretTold) {
        p.secretTold = true; G.flags["secret_" + p.id] = true; codexMark("secrets", p.id);
        await say(d.name, d.secret, true);
        if (["qin", "han", "liu", "doctor"].includes(p.id)) await remember();   // 這幾個人的秘密，會勾起掌櫃的回憶
      }
    }
    await afterAction(p);
  }

  async function follow(p) {
    G.ap -= 2; updateTopbar(); setActions([]);
    const odd = p.fake && Math.random() < 0.7;
    const own = [S.people[p.id].follow, ...((S.followMore || {})[p.id] || [])].filter(Boolean);
    const t = odd ? freshPick("followFake", S.followFake) : own.length ? freshPick("follow:" + p.id, own) : pick(S.dayNormal);
    if (odd) note(p, "跟蹤時看見：" + fill(t, p).replace(/\n/g, ""), 2);
    await fadeTo(async () => {});
    if (isCulprit(p)) await gotEvidence(S.plot.evidenceFollow);
    else await say("跟蹤", fill(t, p), true);
    await afterAction(p);
  }

  async function observe(p) {
    spend(); setActions([]);
    const own = S.people[p.id].dayTells || [];          // 角色專屬的破綻
    const rate = G.flags.liuSpared ? 0.85 : 0.7;         // 柳先生教過看破綻的訣竅
    const tell = p.fake && Math.random() < rate;
    const mute = S.mute && p.id === S.mute.id;
    const t = tell ? pick([...tellsOf(p), ...own]) : pick(S.dayNormal.filter(x => !(mute && /搭了幾句|說話/.test(x))));
    if (isCulprit(p) && Math.random() < 0.5) await gotEvidence(S.plot.evidenceObserve);
    else { if (tell) note(p, "你親眼看見：" + fill(t, p), 2); await say("", fill(t, p), true); }
    await afterAction(p);
  }

  function disposeMenu(p) {
    const locked = p.status === "locked", isGuest = ["guest", "passer"].includes(S.people[p.id].kind);
    setActions([
      locked ? { label: "放出來", fn: () => release(p) } : { label: `關進柴房（銅鎖 ${G.items.lock}）`, disabled: G.items.lock <= 0, fn: () => lockUp(p) },
      { label: "趕出去", disabled: !isGuest || locked, fn: () => expel(p) },
      ...(p.evidence && !p.known ? [{ label: "拿出證據對質", cls: "decide", fn: () => confront(p) }] : []),
      ...(G.master && !G.masterExposed && G.clues.length >= 2 && p.status !== "dead"
        ? [{ label: G.accuseDay === G.night ? "（今天已經指認過了）" : S.master.accuseLabel, cls: "danger", disabled: G.accuseDay === G.night, fn: () => accuseMaster(p) }] : []),
      { label: `貼硃砂符（${G.items.talisman}）`, disabled: G.items.talisman <= 0 || p.known, fn: () => talisman(p) },
      ...(p.known && p.fake && p.id !== "han" && P("han") && P("han").met && isIn(P("han"))
        ? [{ label: hanAvail(p) ? S.hanCall.label : S.hanCall.labelNo, cls: "danger", disabled: !hanAvail(p) || G.ap <= 0, fn: () => callHan(p) }] : []),
      { label: `桃木釘（${G.items.peach}）`, cls: "danger", disabled: G.items.peach <= 0, fn: () => confirmKill(p) },
      "sep",
      { label: "算了", fn: () => selectPerson(p) }
    ]);
    say("", `要怎麼處置${name(p)}？`);
  }

  async function lockUp(p) {
    const ws = witnessesOf(p);
    if (!p.known && ws.length) {
      const reals = ws.filter(w => !w.fake);
      const avg = reals.length ? reals.reduce((a, w) => a + w.affection, 0) / reals.length : 9;
      if (!dossierOf(p).length && avg < 3) {
        spend(); setActions([]);
        const w0 = reals[0] || ws[0];
        await say(name(w0), S.debate.stopLock.replace(/\{w\}/g, name(w0)).replace(/\{n\}/g, name(p)), true);
        const R_ = S.rebut[p.id];
        if (R_) await say(name(p), pick(p.fake ? R_.fake : R_.real), true);
        await say("", S.debate.lockHesitate, true);
        const go = await choose("要怎麼做？", [{ label: S.debate.lockAnyway, value: true }, { label: S.debate.lockCancel, value: false }]);
        if (!go) return afterAction(p);
        reals.forEach(w => affect(w, -1));
        return doLock(p);
      }
    }
    spend();
    return doLock(p);
  }
  async function doLock(p) {
    G.items.lock--; setActions([]);
    p.status = "locked"; p.loc = "woodshed";
    await say("", fill(S.dispose.lockText, p), true);
    if (p.known && p.fake) await knownDispose(p, "lock");
    await afterAction(null);
  }
  async function release(p) {
    spend(); setActions([]);
    p.status = "in"; p.loc = "hall";
    await say("", fill(S.dispose.releaseText, p), true);
    await afterAction(null);
  }
  async function expel(p) {
    spend(); setActions([]);
    const ws0 = p.known && p.fake ? witnessesOf(p) : null;
    const K = S.knownReact;
    if (ws0) await say(fakeName(p), pick(K.expelTaunt), true);       // 被趕出門之前，回頭嘲諷一句
    leaveInn(p, "expelled", "被你趕出去");
    await say("", fill(S.dispose.expelText, p), true);
    if (ws0) {                                          // 牠已經走了，在場的人用剛剛的名單
      markDisposal("expel");
      for (const w of shuffle(ws0.filter(w => !w.fake)).slice(0, 2)) await say(name(w), pick(isMuteP(w) ? S.mute.seeExpel : K.expelSee).replace(/\{w\}/g, name(w)), true);
    }
    await afterAction(null);
  }
  // 指認門主：對了，門主現形；錯了，心神大降、對方記恨
  async function accuseMaster(p) {
    spend(); setActions([]);
    G.accuseDay = G.night;
    if (p.id === G.master) {
      SFX.sting();
      await playLines(S.master.accuseRight, { n: name(p) });
      await exposeMaster(p);
    } else {
      await playLines(S.master.accuseWrong, { n: name(p) });
      G.sanity -= 10; affect(p, -3);
    }
    await afterAction(p);
  }
  async function exposeMaster(p) {
    G.masterExposed = true; p.known = true;
    const alive = p.status === "in" || p.status === "locked";
    if (alive) syncDread(true);                          // 現形但還活著：緊張配樂
    // 殺死的剛好是門主：講清楚；用指認揭穿、還活著：門主現形了
    await say("", alive ? S.master.exposedEffect : S.master.killedEffect.replace(/\{n\}/g, name(p)), true);
    if (G.memory < S.past.length) await remember();
  }

  // 有行兇證據：當面拆穿，效果同硃砂符，但不花道具
  async function confront(p) {
    spend(); setActions([]);
    p.known = true; SFX.reveal(); syncDread(true);
    await say("", fill(S.plot.confront, p), true);
    await knownTaunt(p);
    await witnessReact(p, "reveal");
    await afterAction(p);
  }

  async function talisman(p) {
    spend(); G.items.talisman--; setActions([]);
    if (p.fake) { p.known = true; SFX.reveal(); syncDread(true); await say("", fill(S.dispose.talismanFake, p), true); await knownTaunt(p); await witnessReact(p, "reveal"); }
    else { affect(p, -2); await say("", fill(S.dispose.talismanReal, p), true); }
    await afterAction(p);
  }
  // ---------- 識破之後 ----------
  const fakeName = p => `${name(p)}（畫皮）`;
  async function knownTaunt(p) {
    const T_ = S.knownTaunt, t = T_[p.id] || pick(T_.passer);
    await say(fakeName(p), t, true);
  }
  // 不同處置：畫皮最後一句＋在場的人的反應（只對已識破的畫皮）
  async function knownDispose(p, type) {
    const K = S.knownReact;
    markDisposal(type);
    if (type === "lock" || type === "expel") {
      await say(fakeName(p), pick(K[type + "Taunt"]), true);
      const ws = shuffle(witnessesOf(p).filter(w => !w.fake)).slice(0, 2);
      for (const w of ws) await say(name(w), pick(K[type + "See"]).replace(/\{w\}/g, name(w)), true);
    }
  }
  function markDisposal(type) { (G.disposals = G.disposals || []).push({ night: G.night, type }); }
  // 喊韓捕快來
  const hanAvail = p => { const h = P("han"); return !!h && h !== p && h.status === "in" && !h.away && !h.hiding && !h.known; };
  async function callHan(p, atNight) {
    const H_ = S.hanCall, han = P("han");
    if (!atNight) spend();
    setActions([]);
    await say("", H_.call, true);
    if (!han.fake) {
      await say(name(han), pick(H_.real), true);
      await say(fakeName(p), pick(H_.taunt), true);
      p.status = "dead"; G.stats.killedFakes++; markEnd(p, "被韓九處決"); SFX.killFake();
      G.coins += H_.bounty; updateTopbar();
      await say("", H_.done.replace("{c}", H_.bounty), true);
      affect(han, 1); markDisposal("han");
      if (p.id === G.master && !G.masterExposed) await exposeMaster(p);
      else { const c = nextClue(); if (c) await say("", S.master.dying.replace("{c}", c), true); }
    } else {                                            // 韓九自己就是畫皮：押進柴房，隔天就跑了
      await say(name(han), H_.fakeLine, true);
      p.status = "locked"; p.loc = "woodshed"; p.hanEscape = G.night;
      markDisposal("lock");
      await say("", H_.fakeDone, true);
    }
    if (!atNight) await afterAction(null);
  }
  // C：識破了卻沒處理，半夜來敲你的房門
  async function knownDeal() {
    const cand = active().filter(p => p.known && p.fake);
    if (!cand.length) return;
    const p = pick(cand), K = S.knownDeal;
    $("hud").classList.remove("hidden"); setGuestInfo("");
    SFX.knock();
    if (p.id === G.master) {
      G.sanity -= 10;
      await say("", K.master.replace(/\{n\}/g, name(p)), true);
    } else {
      await say("", K.knock, true);
      await say(fakeName(p), K.offer.replace(/\{n\}/g, name(p)), true);
      const c = await choose(K.ask, [{ label: K.yes, value: "yes" }, { label: K.no, value: "no" }, ...(hanAvail(p) ? [{ label: K.han, value: "han" }] : [])]);
      if (c === "yes") {
        await say("", K.yesText.replace(/\{n\}/g, name(p)), true);
        leaveInn(p, "left", "被你放走");
        const clue = G.master && !G.masterExposed ? nextClue() : null;
        if (clue) await say("", K.clue.replace("{c}", clue), true);
        else { G.coins += K.coinsAmount; updateTopbar(); await say("", K.coins.replace(/\{n\}/g, name(p)), true); }
      } else if (c === "han") await callHan(p, true);
      else { G.sanity -= 10; await say("", K.noText, true); }
    }
    $("hud").classList.add("hidden");
  }
  function confirmKill(p) {
    setActions([
      { label: "動手", cls: "danger", fn: () => kill(p) },
      { label: "再想想", fn: () => disposeMenu(p) }
    ]);
    say("", `你握緊了桃木釘。\n${p.known ? "符紙已經證明牠不是人。" : "一旦釘下去，就沒有回頭路了。"}`);
  }
  // ---------- 目擊者 ----------
  // 同一個地點、沒被關起來的人
  const witnessesOf = p => active().filter(o => o !== p && o.loc === G.loc);
  const bonded = (a, b) => S.bonds.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  // kind：kill（殺死）或 reveal（揭穿）
  async function witnessReact(p, kind) {
    const W = S.witness, ws = witnessesOf(p).filter(w => !w.known);
    if (!ws.length) return ws;
    // 有牽絆的人優先，其次是畫皮（確保線索會出現），再來是其他人
    const order = [...ws.filter(w => bonded(w.id, p.id)), ...shuffle(ws.filter(w => !bonded(w.id, p.id) && w.fake)), ...shuffle(ws.filter(w => !bonded(w.id, p.id) && !w.fake))];
    for (const w of order.slice(0, W.max)) {
      const slip = w.fake && Math.random() < W.fakeSlip;      // 畫皮的反應不對勁（線索）
      if (slip) note(w, kind === "reveal" ? "看見同伴被揭穿時，反應不對勁" : "看見有人被殺時，反應不對勁", 2);
      let t;
      if (w.id === S.mute.id && !w.fake && !slip && kind === "kill") t = bonded(w.id, p.id) ? pick(S.mute.seeBond) : pick(p.fake ? S.mute.seeFake : S.mute.seeReal);   // 啞姑不會尖叫、也不會喊
      else if (w.id === "han" && !w.fake && kind === "kill") t = p.fake ? W.hanFake : W.hanReal;
      else if (!w.fake && bonded(w.id, p.id) && kind === "kill") t = p.fake ? W.bondFake : W.bondReal;
      else if (kind === "reveal") t = slip ? pick(W.fakeSeeReveal) : w.id === S.mute.id ? S.mute.reveal : (S.seeReveal[w.id] || pick(W.realSeeReveal));
      else if (slip) t = pick(p.fake ? W.fakeSeeFake : W.fakeSeeReal);
      else {
        const own = W.lines[w.id] && W.lines[w.id][p.fake ? "fake" : "real"];
        const usedToday = (G.ownReact = G.ownReact || {})[w.id] === G.night;
        t = own && !usedToday ? own : pick(p.fake ? W.realSeeFake : W.realSeeReal);
        if (own && !usedToday) G.ownReact[w.id] = G.night;
      }
      const call = S.people[p.id].callName || name(p);          // 親近的人叫的名字（例如「秀娘」而不是「婦人」）
      await say(name(w), t.replace(/\{w\}/g, name(w)).replace(/\{v\}/g, call), true);
    }
    return ws;
  }

  async function kill(p) {
    // 有其他人在場、而且還沒現形：要先說服大家
    if (!p.known && witnessesOf(p).length) {
      if ((G.blocked || {})[p.id] === G.night) { await say("", S.debate.fail.replace(/\{n\}/g, name(p)), true); return afterAction(p); }
      return publicDebate(p, "kill");
    }
    return doKill(p, {});
  }

  // 當眾對質：提出證據 → 對方反駁 → 在場的人表態
  async function publicDebate(p, kind) {
    const D_ = S.debate, ws = witnessesOf(p);
    spend(); setActions([]);
    const w0 = ws.find(w => !w.fake) || ws[0];
    await say(name(w0), (kind === "kill" ? D_.stop : D_.stopLock).replace(/\{w\}/g, name(w0)).replace(/\{n\}/g, name(p)), true);
    // ① 提出證據（最多三樣）
    const pool = dossierOf(p), chosen = [];
    while (chosen.length < 3) {
      const left = pool.filter(x => !chosen.includes(x));
      const opts = left.map(x => ({ label: x.text.length > 22 ? x.text.slice(0, 22) + "…" : x.text, value: x }));
      if (chosen.length) opts.push({ label: S.dossier.done, value: "done" });
      else opts.push({ label: S.dossier.noEvidence, value: "bare" });
      if (!left.length && chosen.length) break;
      const c = await choose(D_.pick, opts);
      if (c === "done") break;
      if (c === "bare") { await say("你", D_.bare, true); break; }
      chosen.push(c);
      await say("你", D_.present.replace("{t}", c.text), true);
    }
    let power = chosen.reduce((a, x) => a + x.power, 0);
    // ② 對方反駁（畫皮的反駁太流暢、或說錯細節）
    const R_ = S.rebut[p.id];
    if (R_) await say(name(p), pick(p.fake ? R_.fake : R_.real), true);
    const slip = p.fake && Math.random() < 0.5;
    // ③ 在場的人表態
    let yes = 0;
    const shown = shuffle(ws).slice(0, 3);
    for (const w of ws) {
      let ok;
      if (w.fake) ok = !p.fake;                          // 畫皮巴不得你殺錯人
      else ok = power + Math.max(0, w.affection) / 2 + (w.vouch ? 1 : 0) - (bonded(w.id, p.id) ? 2 : 0) + (slip ? 1 : 0) >= 3;
      if (ok) yes++;
      if (shown.includes(w)) {
        const t = ok ? (w.fake ? D_.react.fakeYes : D_.react.yes) : w.id === S.mute.id ? S.mute.debateNo : D_.react.no;
        await say(name(w), t.replace(/\{w\}/g, name(w)).replace(/\{n\}/g, name(p)), true);
      }
    }
    if (yes * 2 > ws.length) {
      if (kind === "kill") { await say("", D_.pass, true); return doKill(p, { noSpend: true, verdict: true }); }
      await say("", D_.lockPass.replace(/\{n\}/g, name(p)), true);
      return doLock(p);
    }
    await say("", D_.fail.replace(/\{n\}/g, name(p)), true);
    affect(p, -3);
    (G.blocked = G.blocked || {})[p.id] = G.night;
    if (kind === "kill") {
      const force = await choose("要怎麼做？", [{ label: D_.force, value: true, cls: "danger" }, { label: "算了", value: false }]);
      if (force) {
        if (Math.random() < 0.5) { G.items.peach--; await say("", D_.forceFail, true); return afterAction(p); }
        return doKill(p, { noSpend: true });
      }
    }
    return afterAction(p);
  }

  // 驚呼的聲音類型：男、女、小孩、老人；啞姑只有氣音
  function voiceOf(p) {
    const VO = S.voices || {};
    if (VO[p.id]) return VO[p.id];
    const d = S.people[p.id] || {}, t = S.traits[p.id];
    if (d.kind === "passer") return d.sex === "f" ? "f" : "m";
    if (!t) return "m";
    return t.age === "老" ? (t.sex === "女" ? "old_f" : "old_m") : t.sex === "女" ? "f" : "m";
  }
  async function doKill(p, opts) {
    if (!opts.noSpend) spend();
    G.items.peach--; setActions([]);
    p.status = "dead"; markEnd(p, "被你用桃木釘刺死");
    const seenBy = witnessesOf(p);
    if (p.fake) {
      G.stats.killedFakes++; markDisposal("kill");
      if (p.affection >= 5) G.stats.ghostLove = true;        // 好感拉滿（五顆心）的畫皮，親手釘死：人鬼殊途
      G.coins += E.bounty; updateTopbar();
      SFX.killFake(); SFX.gasp(seenBy.map(voiceOf), false);
      await say("", fill(S.dispose.killFake, p, { b: E.bounty }), true);
      await witnessReact(p, "kill");
      seenBy.forEach(w => { if (!w.fake) { affect(w, S.affection.witnessUp); w.vouch = true; } });   // 親眼看過，之後會替你說話
      if (p.id === G.master && !G.masterExposed) await exposeMaster(p);
      else { const c = nextClue(); if (c) await say("", S.master.dying.replace("{c}", c), true); }
    } else {
      G.sanity -= 25; updateTopbar();
      SFX.killReal(); SFX.gasp(seenBy.map(voiceOf), true);
      await say("", fill(S.dispose.killReal, p), true);
      if (seenBy.length) {
        // 有人看見：縣衙警告、目擊者記恨、可能退房
        await witnessReact(p, "kill");
        G.wrongKills++;
        if (G.wrongKills >= 2) return ending("jailed");
        await say("縣衙", S.dispose.wrongKill1, true);
        G.pendingLeave = true;
        if (!opts.verdict) seenBy.forEach(w => {
          if (w.fake || bonded(w.id, p.id)) return;            // 有牽絆的人另外用心碎的台詞離開
          affect(w, -3);
          if (Math.random() < 0.5) G.griefQueue.push({ id: w.id, text: S.witness.leaveText.replace(/\{w\}/g, name(w)), why: "看見你殺人，離開" });
        });
      } else {
        // 沒人看見：可以推給畫皮，不會有縣衙警告
        G.secretKills = (G.secretKills || 0) + 1; p.secretKilled = true;
        (G.unseenBodies = G.unseenBodies || []).push(p.id);
        await say("", S.witness.unseen.replace(/\{v\}/g, name(p)), true);
      }
      // 死者親近的人，明早會離開（就算以為是畫皮幹的，一樣心碎）
      S.bonds.forEach(b => {
        const other = b.a === p.id ? b.b : b.b === p.id ? b.a : null;
        if (other && P(other) && P(other).status === "in" && !P(other).fake && !G.griefQueue.some(g => g.id === other)) G.griefQueue.push({ id: other, text: b.grief[other], why: "親近的人死了，傷心離開" });
      });
    }
    await afterAction(null);
  }

  async function outOfTime() {
    if (G.closing) return;             // 已經在入夜流程中
    setActions([]);
    if (G.out) { G.out = false; G.townAt = null; G.loc = "hall"; await say("", S.town.forcedBack, true); }
    await say("", S.dinner.call[cookKey()], true);
    await endDay(true);
  }

  // ---------- 晚飯 ----------
  // 掌廚的人：秦嬸 → 啞姑 → 阿福 → 自己（被關、受傷、已識破的不算；沒識破的畫皮照樣掌廚）
  const cookOf = () => S.dinner.cooks.map(P).find(p => p && p.status === "in" && !p.hurt && !p.known) || null;
  const cookKey = () => (cookOf() || { id: "self" }).id;
  async function dinner(asleep) {
    const D = S.dinner, F = S.food;
    const returned = Object.values(G.people).filter(p => p.away && p.status === "in");
    comeHome();
    if (!asleep) {
      $("hud").classList.remove("hidden");
      await fadeTo(async () => { blankDialog(); clearFigures(); setScene("loc_hall.jpg"); });
      const ck = cookOf();
      const list = ps => ps.map(name).join("、");
      if (returned.length) await say("晚飯", D.back.replace("{l}", list(returned)), true);
      await say("晚飯", D.open[ck ? ck.id : "self"], true);
      const locked = inside().filter(p => p.status === "locked"), hurtP = active().filter(p => p.hurt);
      const who = [];
      if (locked.length) who.push(D.locked.replace("{l}", list(locked)).replace("{c}", ck ? name(ck) : "你"));
      if (hurtP.length) who.push(D.hurt.replace("{l}", list(hurtP)));
      if (who.length) await say("晚飯", who.join("\n"), true);
      let told = 0;
      const KR = S.knownReact;
      // 今天處置過的畫皮：每種處置一句
      const types = [...new Set((G.disposals || []).filter(d => d.night === G.night).map(d => d.type))];
      for (const t of types) if (KR.dinner[t]) { told++; await say("晚飯", KR.dinner[t], true); }
      // 蘇姑娘和沈霜：相認之後，晚飯偶爾有一句
      const su_ = P("su"), sh_ = P("shen");
      if (su_ && sh_ && su_.status === "in" && sh_.status === "in" && !su_.fake && !sh_.fake && G.done.has("ss1") && !G.ssDinner && Math.random() < 0.5) {
        G.ssDinner = true; told++; await say("晚飯", D.ssLine, true);
      }
      // A：識破了卻還在樓裡走動
      const free = active().filter(p => p.known && p.fake);
      if (free.length) {
        told++;
        await say("晚飯", KR.free.replace(/\{n\}/g, free.map(name).join("、")), true);
        active().filter(p => !p.known).forEach(p => { p.affection -= 1; });
      }
      // 今天完成的託付：飯桌上的後續
      for (const q of S.quests) {
        const st = G.quests[q.id], a = S.questAfter[q.id];
        if (!st || !st.done || st.doneNight !== G.night || st.afterShown || !a) continue;
        if (![...a.who, ...((a.whoChoice || {})[st.choice || 0] || [])].every(id => P(id) && P(id).status === "in")) continue;
        st.afterShown = true; told++;
        const t = Array.isArray(a.text) ? a.text[st.choice || 0] : a.text;
        const qinOk = cookOf() === P("qin");
        if (t) await say("晚飯", t.replace(/【秦：(.*?)】/g, qinOk ? "$1" : ""), true);
      }
      // 今天沒聽到的對話：都是真人的話，在飯桌上演出（畫皮版還是要自己去旁聽）
      const sc = S.scenes.find(s => ready(s) && s.who.every(w => P(w) && P(w).status === "in"));
      if (sc && !sc.who.map(P).some(p => p.fake)) {
        G.done.add(sc.id); told++;
        await playLines(sc.lines);
        if (sc.sanity) G.sanity = Math.min(100, G.sanity + sc.sanity);
        if (sc.effect === "guard") G.guard = true;
      }
      if (!told && !who.length) await say("晚飯", pick(D.quiet), true);
    }
    // 伙房：每人每天吃 2 份（客人、夥計、掌櫃都算；畫皮也照人頭煮，只是不吃）
    // 數碗的線索只有秦嬸會說；省糧（摻野菜熬粥）秦嬸、啞姑都會
    const cook = cookOf(), q = cook && cook.id === "qin" ? cook : null;
    const qinHelp = !!cook && ["qin", "yagu"].includes(cook.id) && !cook.fake;
    const eaters = inside().length + 1;
    let need = eaters * F.eat;
    if (G.famine && qinHelp) need = Math.ceil(need * 0.75);
    const ate = Math.min(need, G.food || 0), short = need - ate;
    G.food = (G.food || 0) - ate; updateTopbar();
    const lines = [];
    if (ate) lines.push((G.famine && qinHelp ? F.morningFamine.replace("{k}", name(cook)) : F.morning).replace("{n}", eaters).replace("{c}", ate).replace("{r}", G.food));
    if (q) {
      const k = inside().filter(p => p.fake && p !== q).length;
      if (!q.fake && k) {
        const room = inside().some(p => p.fake && p !== q && p.hurt);
        lines.push((G.bowlsSeen ? F.bowls : F.bowlsFirst).replace("{k}", F.num[Math.min(k, 10)]) + (room ? F.bowlsRoom : "")); G.bowlsSeen = true;
      }
      else if (q.fake && Math.random() < 0.6) lines.push(F.bowlsFake);
    }
    if (short > 0) lines.push(F.short.replace("{c}", short));
    for (const t of lines) await say(asleep ? "" : "晚飯", t, true);
    if (short > 0) {
      G.sanity -= 5;
      active().forEach(p => affect(p, -1));
      const guests = active().filter(p => ["guest", "passer"].includes(S.people[p.id].kind) && !p.fake);
      if (guests.length && Math.random() < 0.5 && !G.noLeave) {
        const st = pick(guests), t = F.shortLeave.replace(/\{n\}/g, name(st));
        if (keepable(st)) { wantLeave(st, t, "斷糧，餓著肚子離開"); await staffStay(); }
        else { leaveInn(st, "left", "斷糧，餓著肚子離開"); await say("", t, true); }
      }
      G.foodShortSeen = true;
    }
    coach("dinner");
    // 小互動：敬大家一杯
    const here = active();
    if (!asleep && here.length && G.coins >= E.winePrice) {
      const yes = await choose(D.wineAsk, [{ label: D.wineLabel.replace("{c}", E.winePrice), value: true }, { label: D.wineNo, value: false }], "晚飯");
      if (yes) {
        G.coins -= E.winePrice; updateTopbar();
        here.forEach(p => { p.affection += 1; });
        await say("晚飯", D.wine, true);
      }
    }
  }

  async function endDay(forced) {
    if (G.phase !== "day" || G.closing) return;
    G.out = false; G.townAt = null;
    G.closing = true;
    // 主動按「入夜」時一定先確認，避免誤觸；有艾草就順便問要不要點
    const asleep = G.sleepUntil && G.night < G.sleepUntil;
    if (!asleep && !forced) {
      const go = await choose(G.ap > 0 ? `還有 ${G.ap} 次行動沒用。確定要吃晚飯、入夜嗎？` : "確定要吃晚飯、入夜嗎？",
        [{ label: "吃晚飯、入夜", cls: "danger", value: true }, { label: "再等等", value: false }]);
      if (!go) { G.closing = false; return showLocation(); }
    }
    await dinner(asleep);
    if (G.phase !== "day") return;
    const hasMug = !asleep && G.items.mugwort > 0 && !G.mugwort;
    if (hasMug) {
      const use = await choose("天黑了。今晚要點艾草嗎？", [{ label: `點燃艾草再入夜（剩 ${G.items.mugwort}）`, value: "mug" }, { label: "入夜", cls: "danger", value: "go" }]);
      if (use === "mug") { G.items.mugwort--; G.mugwort = true; }
    }
    G.phase = "night";
    clearFigures();
    G.night++;
    autoSave("night");
    await startNight();
  }

  // ======================================================
  //  第七夜與結局
  // ======================================================
  async function truthFinal() {
    const F = TR().final;
    SFX.knock();
    await narrate(F.knock);
    const ok = humanOk(), rel = relicsOk();
    const c = await choose(F.prompt, [
      { label: F.peel, value: "peel" },
      { label: F.result, value: "result", cls: "danger" },
      { label: ok ? F.human : F.humanLocked, value: "human", disabled: !ok },
      { label: rel ? F.give : F.giveLocked, value: "give", disabled: !rel }
    ], "門主");
    ending(c);
  }
  // ---------- 攻城夜 ----------
  const mainChar = p => S.people[p.id].kind !== "passer";
  async function finalRollCall() {
    const F = S.finalEve, list = ps => ps.map(name).join("、");
    const here = active().filter(mainChar), locked = inside().filter(p => mainChar(p) && p.status === "locked");
    const gone = Object.values(G.people).filter(p => mainChar(p) && p.admittedNight && !["in", "locked", "out"].includes(p.status));
    const lines = [F.rollIntro, here.length ? F.rollIn.replace("{l}", list(here)) : F.rollNone];
    if (locked.length) lines.push(F.rollLocked.replace("{l}", list(locked)));
    if (gone.length) lines.push(F.rollGone.replace("{l}", list(gone)));
    await narrate(lines);
    $("hud").classList.remove("hidden"); setGuestInfo("");
    const speakers = [...here].filter(p => p.status === "in").sort((a, b) => b.affection - a.affection).slice(0, F.rollMax);
    for (const p of speakers) {
      const t = p.fake && Math.random() < 0.5 ? F.lastFake.replace(/\{n\}/g, name(p)) : F.last[p.id];
      if (t) await say(name(p), t, true);
    }
    $("hud").classList.add("hidden");
  }
  async function finalGuard() {
    const F = S.finalEve;
    const lover = G.lover && P(G.lover);
    if (lover && lover.status === "in" && !lover.fake) return narrate([F.guardLover.replace(/\{n\}/g, name(lover))]);
    const friend = inside().filter(p => p.status === "in" && !p.fake && mainChar(p) && p.affection >= F.guardAff).sort((a, b) => b.affection - a.affection)[0];
    await narrate([friend ? F.guardFriend.replace(/\{n\}/g, name(friend)) : F.guardAlone]);
  }
  async function finalKnock() {
    const F = S.finalEve;
    await narrate([F.drums]);
    SFX.knock();
    const dead = Object.values(G.people).filter(p => mainChar(p) && p.met && (p.status === "dead" || p.status === "murdered" || p.diedOutside));
    const refused = Object.values(G.people).filter(p => mainChar(p) && p.met && p.status === "refused" && !p.diedOutside);
    const who = dead.length ? pick(dead) : refused.length ? pick(refused) : null;
    const voice = who ? F.voiceKnown.replace(/\{n\}/g, name(who)).replace("{why}", (dead.includes(who) ? F.whyDead : F.whyRefused).replace(/\{n\}/g, name(who)))
      : F.voiceUnknown;
    $("hud").classList.remove("hidden"); setGuestInfo("");
    await say("", F.knock, true);
    await say("", voice, true);
    const c = await choose(F.choose, [{ label: F.stay, value: "stay" }, { label: F.listen, value: "listen" }]);
    if (c === "listen") { SFX.sting(); await say("", F.listenText, true); }
    await say("", F.stayText, true);
    $("hud").classList.add("hidden");
  }
  async function finalNight() {
    $("hud").classList.add("hidden");
    await fadeTo(async () => setScene("loc_hall.jpg"));
    if (massacreCheck()) return ending("massacre");
    const fakes = active().filter(p => p.fake).length;
    await finalRollCall();
    await narrate(["戰鼓響了一整夜。\n你守在大門後，一夜沒有闔眼。"]);
    await finalGuard();
    if (G.truth && G.truth.layer >= 4) return truthFinal();          // 解開四層真相：最後叩門的是門主
    await finalKnock();
    if (fakes) {
      $("hud").classList.remove("hidden"); setGuestInfo("");
      const burn = await choose(S.finalBurn.ask, [{ label: S.finalBurn.yes, value: true, cls: "danger" }, { label: S.finalBurn.no, value: false }]);
      return ending(burn ? "burned" : "massacreStay");
    }
    const lover = G.lover && P(G.lover);
    if (G.masterExposed && G.memory >= S.past.length) return ending("faceless");
    // 好幾位戀人都還在：修羅場
    const lovers = G.lovers.map(P).filter(q => q && isIn(q) && !q.fake).sort((a, b) => loveOf(b) - loveOf(a));
    if (lovers.length >= 2) {
      if (loveOf(lovers[0]) - loveOf(lovers[1]) >= 2) { G.lover = lovers[0].id; G.shura = "one"; return ending("shuraOne"); }
      if (lovers.every(q => loveOf(q) >= RM().confessAt)) { G.shura = "all"; return ending("shuraAll"); }
      G.shura = "none"; return ending("shuraNone");
    }
    if (lover && !lover.fake && isIn(lover)) return ending("returning");
    ending("defended");
  }

  function ending(key) {
    SFX.setDread(false);
    const v = S.endings[key];
    G.phase = "end"; G.endKey = key;
    clearFigures();
    stage.classList.remove("lamp-on", "hands-view", "shaken"); clearFx();
    $("hud").classList.add("hidden");
    // 結局插圖：TOWN_DATA.endings 是「結局 → 圖檔」（一張圖可以共用）；舊版是陣列
    const EA = (window.TOWN_DATA || {}).endings || {};
    const lv = G.lover && P(G.lover);
    const loverArt = ["returning", "shuraOne"].includes(key) && lv && !lv.fake && !Array.isArray(EA) ? EA["lover_" + G.lover] : "";
    const art = loverArt || (Array.isArray(EA) ? (EA.includes(key) ? `end_${key}.jpg` : "") : (EA[key] || ""));
    $("result").style.backgroundImage = art ? `url(assets/${art})` : "";
    $("result").style.backgroundSize = art ? "cover" : "";
    $("result").classList.toggle("art", !!art);
    $("result-title").textContent = v.title;
    $("result-title").className = v.bad ? "bad" : "";
    $("result-desc").textContent = v.desc.replace(/\{l\}/g, G.lover ? S.people[G.lover].name : "").replace(/\{k\}/g, G.killer ? S.people[G.killer].name : "");
    const st = { in: "在樓裡", locked: "關在柴房", dead: "死了", gone: "離開了", refused: "被拒於門外", out: "沒有來", murdered: "被畫皮殺害" };

    // 後日談：相關的人都活著、是真人，而且做過對應的選擇
    const alive = id => { const p = P(id); return p && !p.fake && ["in", "locked", "gone"].includes(p.status); };
    const stays = id => { const p = P(id); return p && !p.fake && ["in", "locked"].includes(p.status); };
    const epis = key === "massacre" ? [] : S.epilogues.filter(e => G.flags[e.flag] && e.need.every(alive) && (e.stay || []).every(stays) && (!e.ending || e.ending === key) && !(e.not || []).some(f => G.flags[f]));
    epis.forEach((e, i) => { if (e.lover && G.lover && e.lover[G.lover]) epis[i] = { ...e, text: e.lover[G.lover] }; });
    epis.forEach((e, i) => { epis[i] = { ...epis[i], text: condText(epis[i].text, alive) }; });
    if (key === "shuraAll") G.lovers.filter(alive).forEach(id => { if (S.loverEpilogue[id] && id !== G.lover) epis.unshift({ text: S.loverEpilogue[id] }); });
    if (!["massacre", "jealous", "shuraNone"].includes(key) && G.lover && alive(G.lover) && S.loverEpilogue[G.lover]) epis.unshift({ text: S.loverEpilogue[G.lover], title: "有情人" });

    // 稱號
    const T = S.titles, got = [];
    if (["defended", "returning", "faceless"].includes(key) && G.wrongKills === 0) got.push(T.sharp);
    if (G.masterExposed) got.push(T.master);
    if (G.memory >= S.past.length) got.push(T.past);
    if (G.stats.quests >= 3) got.push(T.helper);
    if (G.stats.killedFakes >= 2) got.push(T.hunter);
    if (G.stats.refused >= 4) got.push(T.cold);
    if (G.stats.refused === 0 && G.night >= S.nights.length) got.push(T.open);
    if (G.stats.paper > 100) got.push(T.paper);
    if (G.stats.events >= 3) got.push(T.busy);
    if (G.wrongKills > 0 || G.secretKills > 0) got.push(T.killer);
    if (G.stats.ghostLove) got.push(T.ghostLove);
    epis.forEach(e => e.title && got.push({ name: e.title, desc: "後日談" }));

    // 真相簿：每個住過的人翻開，畫皮的那張是紅色的模樣
    const cards = Object.values(G.people).filter(p => p.status !== "out").map(p => {
      const d = S.people[p.id], hasEv = A.chars[p.id].eyes;
      const go = p.ghostOrig, wasFake = go ? go.fake : p.fake;
      const img = wasFake && hasEv ? `event_${artOf(p.id)}.jpg` : `fig_${artOf(p.id)}.png`;
      let what = wasFake ? (p.replacedNight ? `畫皮・第 ${p.replacedNight} 夜被換` : `畫皮・第 ${p.admittedNight || p.knockNight || "?"} 夜叩門`) : "活人";
      if (p.returnedNight) what += "・" + S.returns.annotate.replace("{d}", p.returnedNight);
      if (go) what += "・" + (go.refused ? S.masterKnock.albumRefused : S.masterKnock.albumAdmitted).replace("{d}", go.night);
      return `<div class="card${wasFake ? " fake" : ""}"><div class="pic" style="background-image:url(assets/${img})"></div>
        <div class="nm">${albumName(p)}</div><div class="what">${what}</div><div class="st">${p.diedOutside ? "死在門外" : p.diedOfWounds ? "傷重而死" : st[go ? p.ghostPrev : p.status]}</div></div>`;
    }).join("");

    $("result-rows").innerHTML = `<p style="color:var(--teal-dim)">撐到第 ${G.night} 夜・銅錢 ${G.coins} 文・誤殺 ${G.wrongKills} 人</p>
      ${got.length ? `<div class="titles">${got.map(t => `<span title="${t.desc}">【${t.name}】</span>`).join("")}</div>` : ""}
      ${epis.length ? `<div class="epilogue">${epis.map(e => `<p>${e.text}</p>`).join("")}</div>` : ""}
      <h3 class="sub">真　相　簿</h3>
      <div class="truth">${cards}</div>`;
    // 先只露出結局卡，點一下播謝幕，謝幕完才展開結算和真相簿
    const box = $("result");
    let nx = $("result-next");
    if (!nx) { nx = document.createElement("small"); nx.id = "result-next"; $("result-desc").after(nx); }
    nx.textContent = S.credits.next;
    box.classList.add("card");
    box.classList.remove("hidden");
    const onCard = () => {
      if (box.classList.contains("cg")) return;
      box.removeEventListener("click", onCard);
      credits(() => box.classList.remove("card"));
    };
    const armCard = () => setTimeout(() => box.addEventListener("click", onCard), 700);   // 晚一點才接點擊，免得上一個畫面的點擊直接跳過
    if (loverArt && S.loverCG[G.lover]) loverCG(S.loverCG[G.lover], armCard);
    else { SFX.setUnease(0); SFX.setAmbience("town:" + (S.endingMusic[key] || "endPunish") + ":day"); armCard(); }   // 每個結局有自己的配樂
    codexMark("endings", key);
    got.forEach(t => codexMark("titles", t.name));
  }

  // 戀人結局 CG：圖先單獨全螢幕、配幾段文字和輕鬆的曲子，最後結算畫面才淡入
  function loverCG(lines, done) {
    const box = $("result");
    SFX.setUnease(0); SFX.setAmbience("town:love:day");
    box.classList.add("cg");
    let cap = $("result-cg");
    if (!cap) { cap = document.createElement("div"); cap.id = "result-cg"; box.appendChild(cap); }
    let i = -1, timer = null;
    const step = () => {
      clearTimeout(timer);
      if (++i >= lines.length) {
        box.removeEventListener("click", step);
        cap.classList.remove("on");
        box.classList.remove("cg");
        done && done();
        return;
      }
      cap.classList.remove("on");
      setTimeout(() => {
        cap.innerHTML = `<p>${lines[i]}</p><small>${S.loverCG.next}</small>`;
        cap.classList.add("on");
      }, i ? 450 : 1200);
      timer = setTimeout(step, (i ? 450 : 1200) + 3200 + lines[i].length * 90);
    };
    box.addEventListener("click", step);
    step();
  }

  // 片尾字幕：結局圖模糊壓暗當背景，字幕由下往上捲，最後停在一句話
  function credits(done) {
    const C = S.credits, box = $("credits"), roll = $("credits-roll"), end = $("credits-end"), hint = $("credits-hint"), thanks = $("credits-thanks");
    new Image().src = "assets/thanks.jpg";
    thanks.classList.remove("on"); box.classList.remove("lit");
    $("credits-bg").style.backgroundImage = $("result").style.backgroundImage || "";
    roll.innerHTML = `<h1>${C.title}</h1>`
      + C.roles.map(([r, ns]) => `<div class="cr"><span class="r">${r}</span><span class="n">${ns.join("<br>")}</span></div>`).join("")
      + `<h3>${C.castLabel}</h3>` + C.cast.map(([r, n]) => `<div class="cr c"><span class="r">${r}</span><span class="n">${n || ""}</span></div>`).join("")
      + `<h4>${C.townLabel}</h4><p class="th">${C.town.join("<br>")}</p>`
      + `<h3>${C.thanks.label}</h3><p class="th">${C.thanks.names.join("<br>")}</p><p class="note">${C.thanks.note}</p>`
      + `<p class="bye">${C.bye}</p>`
      + `<p class="legal">${C.legal.join("<br>")}</p>`;
    end.textContent = C.last; end.classList.remove("on");
    hint.textContent = C.hint;
    box.classList.remove("hidden");
    SFX.setUnease(0); SFX.setAmbience("town:credits:day");
    // 每一格重新量高度：中途轉手機、縮放視窗也會捲到底
    let y = box.clientHeight, fast = false, last = performance.now(), raf = 0, stage2 = false, stage3 = false, closable = false, t2 = 0, t2at = 0;
    const px = () => (box.clientHeight + roll.offsetHeight) / 70 * (fast ? 5 : 1);   // 正常速度約 70 秒捲完（含登場人物）
    roll.style.opacity = ""; roll.style.transform = `translateY(${y}px)`;
    const finish = () => {                                  // 字幕捲完（或按跳過）：只留最後一句
      if (stage2) return; stage2 = true;
      cancelAnimationFrame(raf); roll.style.opacity = "0";
      end.classList.add("on"); hint.textContent = ""; t2at = performance.now();
      t2 = setTimeout(showThanks, 4500);
    };
    const showThanks = () => {                              // 最後一句淡出，換感謝遊玩圖；再點一下進結算
      if (stage3) return; stage3 = true;
      clearTimeout(t2); end.classList.remove("on");
      thanks.classList.add("on"); box.classList.add("lit");
      t2 = setTimeout(() => { closable = true; hint.textContent = C.back; }, 1800);
    };
    const tick = now => {
      y -= Math.min(0.1, (now - last) / 1000) * px(); last = now;
      roll.style.transform = `translateY(${y}px)`;
      if (y <= -roll.offsetHeight) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const close = () => {
      cancelAnimationFrame(raf); clearTimeout(t2);
      box.classList.add("hidden"); box.classList.remove("lit"); thanks.classList.remove("on");
      box.removeEventListener("click", onClick); $("credits-skip").removeEventListener("click", onSkip); document.removeEventListener("keydown", onKey, true);
      if (G && G.endKey) SFX.setAmbience("town:" + (S.endingMusic[G.endKey] || "endPunish") + ":day");
      done && done();
    };
    const onClick = () => {
      if (!stage2) { fast = !fast; hint.textContent = fast ? C.slow : C.hint; }
      else if (!stage3) { if (performance.now() - t2at > 1500) showThanks(); }
      else if (closable) close();
    };
    const onSkip = e => { e.stopPropagation(); if (!stage2) finish(); else if (!stage3) showThanks(); else close(); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", onClick);
    $("credits-skip").addEventListener("click", onSkip);
    document.addEventListener("keydown", onKey, true);
  }

  // ======================================================
  //  確認視窗
  // ======================================================
  let confirmResolve = null;
  function confirmBox(text, yes = "確定", danger = false, no = "取消") {
    $("confirm-text").textContent = text;
    $("confirm-yes").textContent = yes;
    $("confirm-yes").classList.toggle("danger", danger);
    $("confirm-no").textContent = no;
    $("confirm").classList.remove("hidden");
    return new Promise(res => { confirmResolve = res; });
  }
  function closeConfirm(v) {
    $("confirm").classList.add("hidden");
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(v); }
  }
  $("confirm-yes").addEventListener("click", e => { e.stopPropagation(); closeConfirm(true); });
  $("confirm-no").addEventListener("click", e => { e.stopPropagation(); closeConfirm(false); });

  // ======================================================
  //  存檔：自動存檔（每天開店後、每晚入夜前）＋白天手動存檔
  // ======================================================
  const MANUAL_SLOTS = 10;
  const saveKey = slot => slot === "auto" ? "louke_save_auto" : `louke_save_m${slot}`;
  const allSlots = () => ["auto", ...Array.from({ length: MANUAL_SLOTS }, (_, i) => String(i + 1))];
  // 舊版只有一格手動存檔：搬到第 1 格
  try {
    const old = localStorage.getItem("louke_save_manual");
    if (old && !localStorage.getItem(saveKey("1"))) localStorage.setItem(saveKey("1"), old);
    if (old) localStorage.removeItem("louke_save_manual");
  } catch (e) {}
  const hasAnySave = () => allSlots().some(s => readSave(s));
  function serialize(kind) {
    const copy = { ...G, done: [...G.done], refusedLast: [], people: {} };
    Object.entries(G.people).forEach(([id, p]) => { const q = { ...p, asked: [...p.asked] }; delete q._resolve; copy.people[id] = q; });
    return { v: 5, kind, savedAt: Date.now(), night: G.night, coins: G.coins, G: copy, log: LOG.slice() };
  }
  function writeSave(slot, kind) {
    try { localStorage.setItem(saveKey(slot), JSON.stringify(serialize(kind))); return true; }
    catch (e) { return false; }
  }
  function readSave(slot) {
    try { const t = localStorage.getItem(saveKey(slot)); return t ? JSON.parse(t) : null; }
    catch (e) { return null; }
  }
  function autoSave(kind) { writeSave("auto", kind); }
  const saveLabel = d => {
    const t = new Date(d.savedAt), pad = n => String(n).padStart(2, "0");
    return `${S.dates[d.night - 1]}・第 ${d.night} 夜・${d.kind === "night" ? "入夜前" : "白天"}・銅錢 ${d.coins} 文<small>${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}</small>`;
  };

  // 只有白天、沒有在跑劇情的時候可以手動存檔
  async function manualSave() {
    if (!G || G.phase !== "day" || G.closing || !idle) {
      await confirmBox("現在不能存檔。\n白天在地圖上、沒有對話進行時才能存檔。", "知道了", false, "關閉");
      return;
    }
    const rows = Array.from({ length: MANUAL_SLOTS }, (_, k) => {
      const slot = String(k + 1), d = readSave(slot);
      return `<button data-slot="${slot}">存檔 ${slot}　${d ? saveLabel(d) : "<small>（空欄位）</small>"}</button>`;
    }).join("");
    openPanel("存　檔", `<div class="saves">${rows}</div>`, body =>
      body.querySelectorAll("button[data-slot]").forEach(b => b.addEventListener("click", async () => {
        const slot = b.dataset.slot, old = readSave(slot);
        const label = old ? saveLabel(old).replace(/<small>.*<\/small>/, "") : "";
        if (old && !(await confirmBox(`要覆蓋存檔 ${slot} 嗎？\n${label}`, "覆蓋"))) return;
        const ok = writeSave(slot, "day");
        closePanel();
        await confirmBox(ok ? `已存到存檔 ${slot}。` : "存檔失敗：瀏覽器不允許儲存資料。", "好", false, "關閉");
      })));
  }

  // 停掉目前所有流程、清空畫面
  function resetFlow() {
    session++;
    if (typer) clearTimeout(typer.t);
    typer = null; waiter = null; docClose = null; idle = false; waitingSay = 0; clearMarks();
    if (confirmResolve) { confirmResolve = null; }
    ["narration", "doc-modal", "panel-modal", "confirm", "result", "hud"].forEach(id => $(id).classList.add("hidden"));
    $("fade").classList.remove("on");
    stage.classList.remove("lamp-on", "hands-view", "shaken"); clearFx();
    clearFigures(); setActions([]);
    $("speaker").textContent = ""; $("text").textContent = ""; setGuestInfo("");
    document.querySelectorAll(".jump").forEach(j => j.remove());
  }

  function showTitle() {
    coachEnd(); SFX.setDread(false);
    resetFlow();
    G = null;
    setScene("title.jpg");
    $("title-screen").classList.remove("hidden");
    $("btn-load").disabled = !hasAnySave();
  }

  function openLoadPanel() {
    const rows = allSlots().map(slot => {
      const d = readSave(slot), title = slot === "auto" ? "自動存檔" : `存檔 ${slot}`;
      return `<button data-slot="${slot}" ${d ? "" : "disabled"}>${title}　${d ? saveLabel(d) : "<small>（沒有存檔）</small>"}</button>`;
    }).join("");
    openPanel("讀取存檔", `<div class="saves">${rows}</div>`, body =>
      body.querySelectorAll("button[data-slot]").forEach(b => b.addEventListener("click", () => loadGame(b.dataset.slot))));
  }

  async function loadGame(slot) {
    const d = readSave(slot);
    if (!d) return;
    LOG.length = 0;
    (d.log || []).forEach(l => LOG.push(l));          // 舊存檔沒有紀錄
    SFX.init();
    resetFlow();
    $("title-screen").classList.add("hidden");
    G = d.G;
    G.done = new Set(G.done || []);
    if (!G.rosterSnap) { G.rosterSnap = {}; Object.values(G.people).forEach(p => { G.rosterSnap[p.id] = p.status; }); }   // 舊存檔：從讀檔這刻開始比
    G.refusedLast = [];
    Object.values(G.people).forEach(p => {
      p.asked = new Set(p.asked || []);
      if (G.food === undefined) { G.food = E.startFood; G.foodHints = []; G.foodNotes = []; }
      if (p.met === undefined) p.met = p.status !== "out" || S.people[p.id].kind === "staff";   // 舊存檔沒有這個欄位
    });
    if (!G.lex) initLex();
    if (!G.lovers) G.lovers = G.lover ? [G.lover] : [];
    G.items = { ...E.startItems, ...G.items };
    if (G.tells && G.tells.hand && !S.tells.hand.some(h => h.id === G.tells.hand.id)) G.tells.hand = pick(S.tells.hand);   // 舊存檔：已拿掉的手部破綻換一個
    G.truth = G.truth || { pts: [], layer: 1, relics: {}, told: {} };   // 舊存檔沒有主線進度
    clearPassers(); Object.values(G.passerDefs || {}).forEach(registerPasser);            // 舊存檔沒有的道具補上 0
    if (d.kind === "night") return startNight();
    // 白天：回到存檔時所在的地點
    G.phase = "day"; G.closing = false; G.sel = null;
    $("hud").classList.remove("hidden");
    updateTopbar();
    await goTo(G.loc || "hall", true);
    await showLocation();
  }

  // ---------- 開始 ----------
  async function begin() {
    resetFlow();
    newGame();
    setScene("loc_hall.jpg");
    await narrate(S.intro);
    await startNight();
  }

  window.__debug = { get G() { return G; }, questLostCheck: () => questLostCheck(), truthLayer2: () => truthLayer2(), ending, loadGame, showTitle, crowdEvent: () => crowdEvent(), showLocation: () => showLocation(), finalNight: () => finalNight(), endDay: f => endDay(f), openShop: (w, m) => openShop(w, m), showHands: id => showHands(G.people[id]) };

  setScene("title.jpg");
  $("btn-load").disabled = !hasAnySave();
  $("btn-start").addEventListener("click", async () => {
    if (hasAnySave() && !(await confirmBox("開始新的遊戲？\n存檔不會被刪除，但自動存檔會被新進度覆蓋。", "開始"))) return;
    SFX.init();
    if (!guideSeen()) { markGuide(); await openGuide(); }
    $("title-screen").classList.add("hidden"); begin();
  });
  $("btn-load").addEventListener("click", openLoadPanel);
  $("title-screen").addEventListener("click", () => SFX.init());   // 瀏覽器規定：點過畫面之後才能出聲
  $("btn-settings").addEventListener("click", openSettings);
  $("btn-title-settings").addEventListener("click", openSettings);
  $("btn-codex").addEventListener("click", () => openCodex());
  $("btn-again").addEventListener("click", () => begin());
  $("btn-again").insertAdjacentHTML("afterend", ' <button id="btn-result-title" class="big">回到主畫面</button>');
  $("btn-result-title").addEventListener("click", showTitle);
  $("btn-credits").addEventListener("click", () => credits());
  $("btn-notice").addEventListener("click", () => G && G.tells && openDoc(noticeHtml()));
  $("btn-items").addEventListener("click", () => G && openItems());
  $("btn-log").addEventListener("click", () => openLog());
  $("btn-journal").addEventListener("click", () => openJournal(G && G.lexNew ? "lex" : undefined));
})();
