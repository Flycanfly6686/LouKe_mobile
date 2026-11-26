// ============================================================
//  樓客 手機版追加程式（只在 mobile 打包時加進去，不改 game/ 的檔案）
//  ・字級：手機上放大（原本 1em = 舞台寬 / 80）
//  ・聲音：iPhone 切回前景、靜音鍵、第一次觸控時把聲音喚醒
//  ・離線：註冊 service worker
// ============================================================
(function () {
  // ---- 聲音：記下遊戲建立的 AudioContext，之後才能喚醒 ----
  const Orig = window.AudioContext || window.webkitAudioContext;
  const ctxs = [];
  if (Orig) {
    const Wrapped = function (...a) { const c = new Orig(...a); ctxs.push(c); return c; };
    Wrapped.prototype = Orig.prototype;
    window.AudioContext = Wrapped; window.webkitAudioContext = Wrapped;
  }
  const wake = () => ctxs.forEach(c => { if (c.state !== "running" && c.state !== "closed") c.resume().catch(() => {}); });

  // iPhone 的靜音鍵會把網頁音效關掉；先播一段無聲的 <audio>，讓聲音走「媒體」通道
  let unlocked = false;
  function unlock() {
    wake();
    if (unlocked) return; unlocked = true;
    try {
      const a = document.createElement("audio");
      a.setAttribute("x-webkit-airplay", "deny"); a.preload = "auto"; a.loop = true; a.volume = 0.01;
      a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      a.play().catch(() => {});
    } catch (e) {}
  }
  ["touchend", "click"].forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
  window.addEventListener("pageshow", wake);

  // 兩指縮放：關掉（雙擊放大由 CSS 的 touch-action: manipulation 處理，連點對話不會被吃掉）
  document.addEventListener("gesturestart", e => e.preventDefault());

  // ---- 版面：手機的字級由 mobile.css 決定；轉向後補發一次 resize，讓新手提示重新對位 ----
  window.addEventListener("orientationchange", () => setTimeout(() => window.dispatchEvent(new Event("resize")), 300));
  window.addEventListener("load", () => {
    // 頂端列在客人資訊後面換行（手機版的 CSS 才會用到）
    const gi = document.getElementById("guest-info");
    if (gi && !(gi.nextElementSibling && gi.nextElementSibling.classList.contains("br"))) { const br = document.createElement("span"); br.className = "br"; gi.after(br); }
    // 直拿手機的提示
    const h = document.createElement("div"); h.id = "rotate-hint";
    h.innerHTML = '<div class="phone-icon"></div><div>請把手機轉成橫向</div><small>建議加入主畫面、戴耳機遊玩</small>';
    document.body.appendChild(h);
  });

  // ---- 離線：service worker ----
  const hasSW = "serviceWorker" in navigator && location.protocol !== "file:";
  if (hasSW) navigator.serviceWorker.register("sw.js").catch(() => {});

  // ---- 下載畫面：全部圖片下載完才能玩 ----
  //  game.js 原本一次 new Image() 兩百多張（約 45 MB），手機會卡住；改成這裡用 fetch 一次抓 4 張，只下載不解碼。
  //  抓到的檔案經過 sw 存進快取，之後顯示、離線遊玩都從快取拿；第二次開啟幾乎瞬間完成。
  //  ALL 由 build_mobile.py 填入：[[路徑, 位元組], ...]
  const ALL = [["assets/end_burned.jpg", 205378, "88833b04c6"], ["assets/end_dawn.jpg", 203131, "ec708e9f89"], ["assets/end_give.jpg", 198409, "9a578b9b70"], ["assets/end_harem.jpg", 188941, "bab5c4e943"], ["assets/end_jail.jpg", 154724, "6a4ff2cb24"], ["assets/end_lover_shen.jpg", 165402, "50cf320473"], ["assets/end_lover_su.jpg", 141523, "2553af7ff6"], ["assets/end_lover_yagu.jpg", 185893, "418fbf947c"], ["assets/end_lover_ye.jpg", 189829, "c3e259c160"], ["assets/end_lover_yun.jpg", 178356, "bd649eec84"], ["assets/end_mask.jpg", 170989, "9d89ef1ef9"], ["assets/end_mind.jpg", 123281, "421782660c"], ["assets/end_result.jpg", 166413, "a8cb666389"], ["assets/end_shura.jpg", 237904, "272acb78ed"], ["assets/end_taken.jpg", 181531, "63b8869315"], ["assets/event_afu.jpg", 165716, "6372203481"], ["assets/event_chen.jpg", 167894, "4ae5e5fc1a"], ["assets/event_doctor.jpg", 165937, "f8d29bbf25"], ["assets/event_gu.jpg", 164893, "ac766fb8e9"], ["assets/event_han.jpg", 160821, "e15a1d49e9"], ["assets/event_he.jpg", 173038, "db9c499cbb"], ["assets/event_liu.jpg", 168474, "88a0f91592"], ["assets/event_mother.jpg", 163280, "af2b365fd4"], ["assets/event_passer_f.jpg", 166520, "14ec4bcf85"], ["assets/event_passer_fy.jpg", 166186, "8afb9cbf40"], ["assets/event_passer_m.jpg", 168733, "ad3494cedb"], ["assets/event_qian.jpg", 162235, "37b8f930c2"], ["assets/event_qin.jpg", 164082, "28d5407df8"], ["assets/event_shen.jpg", 162659, "6794ba232d"], ["assets/event_su.jpg", 166519, "70b4061de8"], ["assets/event_tou.jpg", 164020, "6cf8d934dc"], ["assets/event_wang.jpg", 164679, "6bfd0bdd0a"], ["assets/event_yagu.jpg", 168687, "e89d110893"], ["assets/event_ye.jpg", 171437, "7c50fdeb9d"], ["assets/event_yun.jpg", 163688, "2eb8537af7"], ["assets/event_zhou.jpg", 162772, "96af9ef590"], ["assets/fig_afu.png", 40102, "49b24f25e2"], ["assets/fig_afu_fake.png", 35558, "0d148d4295"], ["assets/fig_chen.png", 52246, "2bc9a7e942"], ["assets/fig_chen_fake.png", 46342, "f1991540a1"], ["assets/fig_doctor.png", 51946, "f59fa91a01"], ["assets/fig_doctor_fake.png", 45752, "9b8e35a897"], ["assets/fig_gu.png", 57386, "80d9699522"], ["assets/fig_gu_fake.png", 43838, "999afc3c5e"], ["assets/fig_han.png", 45880, "725179568d"], ["assets/fig_han_fake.png", 38918, "d30097a120"], ["assets/fig_he.png", 83948, "0653b1c7b8"], ["assets/fig_he_fake.png", 74473, "a5d46158d9"], ["assets/fig_heizi.png", 13861, "82c5c4dac7"], ["assets/fig_liu.png", 52297, "c54ab01eeb"], ["assets/fig_liu_fake.png", 43782, "c844461ffe"], ["assets/fig_meng.png", 65388, "75f26c8698"], ["assets/fig_mother.png", 43623, "6731beaf06"], ["assets/fig_mother_fake.png", 36400, "9f05fb0078"], ["assets/fig_passer_f.png", 47539, "b88da38dbf"], ["assets/fig_passer_f_fake.png", 39766, "03cccb5381"], ["assets/fig_passer_fy.png", 46713, "8d6131f2b0"], ["assets/fig_passer_fy_fake.png", 39778, "5491d6a997"], ["assets/fig_passer_m.png", 60920, "34f11bb915"], ["assets/fig_passer_m_fake.png", 51774, "64bc948600"], ["assets/fig_qian.png", 56690, "47b9dea561"], ["assets/fig_qian_fake.png", 50116, "c939d8ae02"], ["assets/fig_qin.png", 56653, "26cfcaa0e8"], ["assets/fig_qin_fake.png", 47344, "861c436d23"], ["assets/fig_shen.png", 41128, "2216a2b544"], ["assets/fig_shen_fake.png", 34626, "b5195344d0"], ["assets/fig_su.png", 46783, "e44b992fd3"], ["assets/fig_su_fake.png", 40786, "ab718acc5b"], ["assets/fig_tou.png", 50892, "1a98707d9d"], ["assets/fig_tou_fake.png", 39548, "b3b264d1d6"], ["assets/fig_wang.png", 54930, "5a6c1ac59b"], ["assets/fig_wang_fake.png", 51196, "cb0318803c"], ["assets/fig_wen.png", 59066, "f7365353f1"], ["assets/fig_xiaoqi.png", 94799, "a0d88b8971"], ["assets/fig_yagu.png", 48898, "ef84ec060f"], ["assets/fig_yagu_fake.png", 43740, "af1aacb38d"], ["assets/fig_ye.png", 63441, "6d5abba562"], ["assets/fig_ye_fake.png", 60385, "f2b4ea3da1"], ["assets/fig_yun.png", 52230, "c05e9cef05"], ["assets/fig_yun_fake.png", 44976, "fb8e053347"], ["assets/fig_zhou.png", 53501, "2b57c46f64"], ["assets/fig_zhou_fake.png", 44749, "125fc99b28"], ["assets/fig_zou.png", 53899, "0f277d26e0"], ["assets/hall.jpg", 150626, "5d1687a1a7"], ["assets/hands_afu_2.jpg", 212817, "66aa09fc6f"], ["assets/hands_afu_3.jpg", 213930, "7b4e8d41d4"], ["assets/hands_afu_4.jpg", 214262, "b713be9e91"], ["assets/hands_afu_5.jpg", 210551, "c62ca99016"], ["assets/hands_afu_6.jpg", 204774, "84a91c733d"], ["assets/hands_chen_1.jpg", 212504, "b472271ba7"], ["assets/hands_chen_2.jpg", 212027, "fd1bd55b05"], ["assets/hands_chen_3.jpg", 214008, "c63a59db5c"], ["assets/hands_chen_4.jpg", 213422, "6d3e3ad7c4"], ["assets/hands_chen_5.jpg", 209904, "8989889538"], ["assets/hands_chen_6.jpg", 204315, "75ed275ca9"], ["assets/hands_doctor_2.jpg", 216739, "e5218b0ab9"], ["assets/hands_doctor_3.jpg", 213517, "e1d430010d"], ["assets/hands_doctor_4.jpg", 216704, "38dd92f542"], ["assets/hands_doctor_5.jpg", 214312, "d67dc1bb87"], ["assets/hands_doctor_6.jpg", 210657, "6e08993acb"], ["assets/hands_generic_a_2.jpg", 193992, "a4809cf5e7"], ["assets/hands_generic_a_3.jpg", 196676, "bd8548ca76"], ["assets/hands_generic_a_4.jpg", 201807, "d249bab5f1"], ["assets/hands_generic_a_5.jpg", 194265, "72f0898c7d"], ["assets/hands_generic_a_6.jpg", 188382, "8482d398e2"], ["assets/hands_gu_2.jpg", 224135, "019247e796"], ["assets/hands_gu_3.jpg", 218062, "07e11fe94d"], ["assets/hands_gu_4.jpg", 219521, "7d5c6a4549"], ["assets/hands_gu_5.jpg", 219379, "8359c54ba7"], ["assets/hands_gu_6.jpg", 216321, "1a457bdaed"], ["assets/hands_han_2.jpg", 223889, "de9e0c16e9"], ["assets/hands_han_3.jpg", 217622, "1c2d2356f8"], ["assets/hands_han_4.jpg", 219686, "0aebe33869"], ["assets/hands_han_5.jpg", 219334, "485223a7c4"], ["assets/hands_han_6.jpg", 216485, "ef3bda96c0"], ["assets/hands_he_2.jpg", 216429, "01c34d391b"], ["assets/hands_he_3.jpg", 213550, "df2adb3a01"], ["assets/hands_he_4.jpg", 216669, "8eba9a3706"], ["assets/hands_he_5.jpg", 214195, "7380cfdd96"], ["assets/hands_he_6.jpg", 210588, "e006d86640"], ["assets/hands_liu_2.jpg", 208983, "04fc140729"], ["assets/hands_liu_3.jpg", 208182, "a8bc00b141"], ["assets/hands_liu_4.jpg", 215877, "de670597fd"], ["assets/hands_liu_5.jpg", 212367, "ac3864559c"], ["assets/hands_liu_6.jpg", 208512, "5d8538430b"], ["assets/hands_passer_m_2.jpg", 213876, "0581a02ac3"], ["assets/hands_passer_m_3.jpg", 214262, "afb0b85d5f"], ["assets/hands_passer_m_4.jpg", 215694, "82916e5ccf"], ["assets/hands_passer_m_5.jpg", 210153, "2ff745fdd2"], ["assets/hands_passer_m_6.jpg", 199885, "0b3ae7a38d"], ["assets/hands_qian_2.jpg", 212803, "f66136bc5e"], ["assets/hands_qian_3.jpg", 214216, "aeeedbf9ae"], ["assets/hands_qian_4.jpg", 213838, "f588c31f6a"], ["assets/hands_qian_5.jpg", 210773, "2a8c2776bd"], ["assets/hands_qian_6.jpg", 204638, "f2d5afdfe6"], ["assets/hands_qin_2.jpg", 224410, "3e0bb5e076"], ["assets/hands_qin_3.jpg", 218095, "4e56ada5c3"], ["assets/hands_qin_4.jpg", 219592, "6532073a94"], ["assets/hands_qin_5.jpg", 219553, "01267c2941"], ["assets/hands_qin_6.jpg", 216573, "bd499cc2f2"], ["assets/hands_shen_2.jpg", 212216, "ce0f3e2934"], ["assets/hands_shen_3.jpg", 213733, "727350ba7b"], ["assets/hands_shen_4.jpg", 213557, "f07496eab3"], ["assets/hands_shen_5.jpg", 209870, "846732c634"], ["assets/hands_shen_6.jpg", 204815, "1774797d28"], ["assets/hands_tou_2.jpg", 212936, "e98e7716b2"], ["assets/hands_tou_3.jpg", 214162, "b093f8f9e9"], ["assets/hands_tou_4.jpg", 214381, "280a283e8f"], ["assets/hands_tou_5.jpg", 210597, "1855ce1f6d"], ["assets/hands_tou_6.jpg", 204581, "e8a5ac72cc"], ["assets/hands_yun_2.jpg", 212875, "4d55f6dfe9"], ["assets/hands_yun_3.jpg", 214139, "bdcd33e326"], ["assets/hands_yun_4.jpg", 214114, "2c1d95fb1f"], ["assets/hands_yun_5.jpg", 210658, "20130c8ead"], ["assets/hands_yun_6.jpg", 204398, "e45dba1102"], ["assets/hands_zhou_2.jpg", 224305, "722e99ef0a"], ["assets/hands_zhou_3.jpg", 215879, "c6d8f36d56"], ["assets/hands_zhou_4.jpg", 219131, "ad9edac454"], ["assets/hands_zhou_5.jpg", 216771, "27ab4f2d6d"], ["assets/hands_zhou_6.jpg", 212706, "4733a3507c"], ["assets/kitchen.jpg", 151604, "f9c410b1de"], ["assets/loc_corridor.jpg", 163686, "b5cdd853e1"], ["assets/loc_counter.jpg", 162346, "edb816dae7"], ["assets/loc_hall.jpg", 150053, "348300c37d"], ["assets/loc_kitchen.jpg", 150840, "2395fbaf14"], ["assets/loc_room1.jpg", 164799, "776a7287ea"], ["assets/loc_room2.jpg", 157784, "ae5fd056f2"], ["assets/loc_room3.jpg", 162084, "3032fc4067"], ["assets/loc_woodshed.jpg", 180281, "73f8604b27"], ["assets/loc_yard.jpg", 162284, "5d6fc643bf"], ["assets/paper.jpg", 35803, "099dbc29cc"], ["assets/street_afu_real.jpg", 220062, "495d3b0f8b"], ["assets/street_chen_real.jpg", 222319, "0401fcc06d"], ["assets/street_doctor_real.jpg", 223374, "27cdb23422"], ["assets/street_empty.jpg", 217386, "e381550353"], ["assets/street_gu_real.jpg", 220884, "8e83da2041"], ["assets/street_han_real.jpg", 218328, "caeee90414"], ["assets/street_he_real.jpg", 217195, "9ad671bcef"], ["assets/street_liu_real.jpg", 220066, "eaecc0a1e7"], ["assets/street_mother_real.jpg", 217343, "2563a10dc0"], ["assets/street_passer_f_real.jpg", 225906, "105a0cf977"], ["assets/street_passer_fy_real.jpg", 223559, "ea4f97ca60"], ["assets/street_passer_m_real.jpg", 222814, "a696189559"], ["assets/street_qian_real.jpg", 215851, "14d3c15f2a"], ["assets/street_qin_real.jpg", 220361, "671435afba"], ["assets/street_shen_real.jpg", 215023, "26867624f7"], ["assets/street_su_real.jpg", 216014, "585db58018"], ["assets/street_tou_real.jpg", 224400, "23e2a73236"], ["assets/street_wang_collar.jpg", 211681, "a72c362455"], ["assets/street_wang_real.jpg", 211347, "ecce332a9a"], ["assets/street_yagu_real.jpg", 214034, "f95b18cf4c"], ["assets/street_ye_real.jpg", 214468, "5efa3893e0"], ["assets/street_yun_real.jpg", 214756, "e5181fa408"], ["assets/street_zhou_real.jpg", 219761, "d72975d29c"], ["assets/thanks.jpg", 196192, "2aaf7725b9"], ["assets/title.jpg", 193321, "d46f4d0d0e"], ["assets/town_grave_day.jpg", 210823, "db755debd0"], ["assets/town_grave_night.jpg", 167277, "6d6225c5dc"], ["assets/town_map.jpg", 244437, "dab6ab11df"], ["assets/town_market_day.jpg", 194627, "272aa83b25"], ["assets/town_market_night.jpg", 185343, "812741a295"], ["assets/town_temple_day.jpg", 219731, "68b4583652"], ["assets/town_temple_night.jpg", 186902, "201dcbcdd9"], ["assets/town_yamen_day.jpg", 177663, "a87530ade8"], ["assets/town_yamen_night.jpg", 151716, "f442797c29"]];
  window.LOUKE_PRELOAD = function () {};   // game.js 的預載交給下面的下載畫面

  const gate = document.createElement("div");
  gate.id = "dl-gate";
  gate.innerHTML = '<div class="dl-title">樓　客</div><div class="dl-bar"><div class="dl-fill"></div></div>' +
    '<div class="dl-text">準備中……</div><div class="dl-note">第一次開啟需要下載遊戲圖片，下載完之後可以離線遊玩</div>' +
    '<button class="dl-retry" hidden>重新下載</button>';
  document.body.appendChild(gate);
  const fill = gate.querySelector(".dl-fill"), text = gate.querySelector(".dl-text"), retryBtn = gate.querySelector(".dl-retry");
  const TOTAL = ALL.reduce((s, f) => s + f[1], 0), MB = b => (b / 1048576).toFixed(1);
  let doneBytes = 0;
  const show = () => {
    const p = TOTAL ? doneBytes / TOTAL : 1;
    fill.style.width = (p * 100).toFixed(1) + "%";
    text.textContent = `下載中　${Math.floor(p * 100)}%　（${MB(doneBytes)} / ${MB(TOTAL)} MB）`;
  };

  // 一個檔案：圖片快取裡已經有同一個版本（路徑＋雜湊）就跳過；沒有就下載、自己存進去。失敗重試兩次。
  //（自己存，不靠 sw 攔截，所以 sw 什麼時候接手都不會漏存；sw.js 用同樣的鍵讀）
  let imgCache = null;
  const get = async ([u, , hsh]) => {
    const key = new URL(u + "?h=" + hsh, location.href).href;
    if (imgCache && await imgCache.match(key).catch(() => null)) return true;
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(u + "?h=" + hsh);   // 帶雜湊：舊版 sw 認不得就會直接上網抓，不會拿到舊圖
        if (r.ok) {
          if (imgCache) await imgCache.put(key, r); else await r.blob();
          return true;
        }
      } catch (e) {}
      await new Promise(ok => setTimeout(ok, 800 * (t + 1)));
    }
    return false;
  };
  async function run(list) {
    const q = list.slice(), failed = [];
    retryBtn.hidden = true; show();
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (q.length) {
        const f = q.shift();
        if (await get(f)) { doneBytes += f[1]; show(); } else failed.push(f);
      }
    }));
    if (failed.length) {
      text.textContent = `有 ${failed.length} 個檔案下載失敗，請確認網路後重試`;
      retryBtn.hidden = false;
      retryBtn.onclick = () => run(failed);
      return;
    }
    fill.style.width = "100%"; text.textContent = "下載完成";
    gate.classList.add("done");
    setTimeout(() => gate.remove(), 600);
  }
  // 打開圖片快取（瀏覽器不支援、或是 file:// 開啟時就只下載不存）
  const openCache = async () => {
    try { if (hasSW && window.caches) imgCache = await caches.open("louke-img"); } catch (e) {}
  };
  // 已經裝過舊版：先問一下有沒有新版（離線或超過 5 秒就算了）。有的話等新版接手後重新整理，
  // 這次開啟就玩到新版，下載畫面也只會抓內容變了的圖
  const checkUpdate = async () => {
    if (!hasSW || !navigator.serviceWorker.controller) return;
    text.textContent = "檢查更新中……";
    try {
      const reg = await navigator.serviceWorker.ready;
      await Promise.race([reg.update(), new Promise(ok => setTimeout(ok, 5000))]);
      if (reg.installing || reg.waiting) {
        text.textContent = "發現新版本，更新中……";
        await Promise.race([
          new Promise(ok => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true })),
          new Promise(ok => setTimeout(ok, 20000)),
        ]);
        location.reload();
        return new Promise(() => {});   // 等重新整理，不往下跑
      }
    } catch (e) {}
  };
  checkUpdate().then(openCache).then(() => run(ALL));
})();
