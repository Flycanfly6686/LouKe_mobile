// 樓客 離線快取（由 build_mobile.py 產生）
//  ・程式和開場檔案：放在 louke-<版本>，版本號變了就整批重抓（很小）
//  ・圖片：放在 louke-img，鍵是「路徑?h=內容雜湊」；發佈新版時只有內容變了的圖才要重新下載
//    圖片由 mobile.js 的下載畫面抓進來，這裡負責在遊戲要用時從快取拿
const VERSION = "be25ee1f6c";
const FILES = ["./", "index.html", "assets/data.js", "assets/town.js", "audio.js", "game.js", "mobile.css", "mobile.js", "story.js", "style.css", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest", "og.jpg"];
const IMG = {"assets/end_burned.jpg": "88833b04c6", "assets/end_dawn.jpg": "ec708e9f89", "assets/end_give.jpg": "9a578b9b70", "assets/end_harem.jpg": "bab5c4e943", "assets/end_jail.jpg": "6a4ff2cb24", "assets/end_lover_shen.jpg": "50cf320473", "assets/end_lover_su.jpg": "2553af7ff6", "assets/end_lover_yagu.jpg": "418fbf947c", "assets/end_lover_ye.jpg": "c3e259c160", "assets/end_lover_yun.jpg": "bd649eec84", "assets/end_mask.jpg": "9d89ef1ef9", "assets/end_mind.jpg": "421782660c", "assets/end_result.jpg": "a8cb666389", "assets/end_shura.jpg": "272acb78ed", "assets/end_taken.jpg": "63b8869315", "assets/event_afu.jpg": "6372203481", "assets/event_chen.jpg": "4ae5e5fc1a", "assets/event_doctor.jpg": "f8d29bbf25", "assets/event_gu.jpg": "ac766fb8e9", "assets/event_han.jpg": "e15a1d49e9", "assets/event_he.jpg": "db9c499cbb", "assets/event_liu.jpg": "88a0f91592", "assets/event_mother.jpg": "af2b365fd4", "assets/event_passer_f.jpg": "14ec4bcf85", "assets/event_passer_fy.jpg": "8afb9cbf40", "assets/event_passer_m.jpg": "ad3494cedb", "assets/event_qian.jpg": "37b8f930c2", "assets/event_qin.jpg": "28d5407df8", "assets/event_shen.jpg": "6794ba232d", "assets/event_su.jpg": "70b4061de8", "assets/event_tou.jpg": "6cf8d934dc", "assets/event_wang.jpg": "6bfd0bdd0a", "assets/event_yagu.jpg": "e89d110893", "assets/event_ye.jpg": "7c50fdeb9d", "assets/event_yun.jpg": "2eb8537af7", "assets/event_zhou.jpg": "96af9ef590", "assets/fig_afu.png": "49b24f25e2", "assets/fig_afu_fake.png": "0d148d4295", "assets/fig_chen.png": "2bc9a7e942", "assets/fig_chen_fake.png": "f1991540a1", "assets/fig_doctor.png": "f59fa91a01", "assets/fig_doctor_fake.png": "9b8e35a897", "assets/fig_gu.png": "80d9699522", "assets/fig_gu_fake.png": "999afc3c5e", "assets/fig_han.png": "725179568d", "assets/fig_han_fake.png": "d30097a120", "assets/fig_he.png": "0653b1c7b8", "assets/fig_he_fake.png": "a5d46158d9", "assets/fig_heizi.png": "82c5c4dac7", "assets/fig_liu.png": "c54ab01eeb", "assets/fig_liu_fake.png": "c844461ffe", "assets/fig_meng.png": "75f26c8698", "assets/fig_mother.png": "6731beaf06", "assets/fig_mother_fake.png": "9f05fb0078", "assets/fig_passer_f.png": "b88da38dbf", "assets/fig_passer_f_fake.png": "03cccb5381", "assets/fig_passer_fy.png": "8d6131f2b0", "assets/fig_passer_fy_fake.png": "5491d6a997", "assets/fig_passer_m.png": "34f11bb915", "assets/fig_passer_m_fake.png": "64bc948600", "assets/fig_qian.png": "47b9dea561", "assets/fig_qian_fake.png": "c939d8ae02", "assets/fig_qin.png": "26cfcaa0e8", "assets/fig_qin_fake.png": "861c436d23", "assets/fig_shen.png": "2216a2b544", "assets/fig_shen_fake.png": "b5195344d0", "assets/fig_su.png": "e44b992fd3", "assets/fig_su_fake.png": "ab718acc5b", "assets/fig_tou.png": "1a98707d9d", "assets/fig_tou_fake.png": "b3b264d1d6", "assets/fig_wang.png": "5a6c1ac59b", "assets/fig_wang_fake.png": "cb0318803c", "assets/fig_wen.png": "f7365353f1", "assets/fig_xiaoqi.png": "a0d88b8971", "assets/fig_yagu.png": "ef84ec060f", "assets/fig_yagu_fake.png": "af1aacb38d", "assets/fig_ye.png": "6d5abba562", "assets/fig_ye_fake.png": "f2b4ea3da1", "assets/fig_yun.png": "c05e9cef05", "assets/fig_yun_fake.png": "fb8e053347", "assets/fig_zhou.png": "2b57c46f64", "assets/fig_zhou_fake.png": "125fc99b28", "assets/fig_zou.png": "0f277d26e0", "assets/hall.jpg": "5d1687a1a7", "assets/hands_afu_2.jpg": "66aa09fc6f", "assets/hands_afu_3.jpg": "7b4e8d41d4", "assets/hands_afu_4.jpg": "b713be9e91", "assets/hands_afu_5.jpg": "c62ca99016", "assets/hands_afu_6.jpg": "84a91c733d", "assets/hands_chen_1.jpg": "b472271ba7", "assets/hands_chen_2.jpg": "fd1bd55b05", "assets/hands_chen_3.jpg": "c63a59db5c", "assets/hands_chen_4.jpg": "6d3e3ad7c4", "assets/hands_chen_5.jpg": "8989889538", "assets/hands_chen_6.jpg": "75ed275ca9", "assets/hands_doctor_2.jpg": "e5218b0ab9", "assets/hands_doctor_3.jpg": "e1d430010d", "assets/hands_doctor_4.jpg": "38dd92f542", "assets/hands_doctor_5.jpg": "d67dc1bb87", "assets/hands_doctor_6.jpg": "6e08993acb", "assets/hands_generic_a_2.jpg": "a4809cf5e7", "assets/hands_generic_a_3.jpg": "bd8548ca76", "assets/hands_generic_a_4.jpg": "d249bab5f1", "assets/hands_generic_a_5.jpg": "72f0898c7d", "assets/hands_generic_a_6.jpg": "8482d398e2", "assets/hands_gu_2.jpg": "019247e796", "assets/hands_gu_3.jpg": "07e11fe94d", "assets/hands_gu_4.jpg": "7d5c6a4549", "assets/hands_gu_5.jpg": "8359c54ba7", "assets/hands_gu_6.jpg": "1a457bdaed", "assets/hands_han_2.jpg": "de9e0c16e9", "assets/hands_han_3.jpg": "1c2d2356f8", "assets/hands_han_4.jpg": "0aebe33869", "assets/hands_han_5.jpg": "485223a7c4", "assets/hands_han_6.jpg": "ef3bda96c0", "assets/hands_he_2.jpg": "01c34d391b", "assets/hands_he_3.jpg": "df2adb3a01", "assets/hands_he_4.jpg": "8eba9a3706", "assets/hands_he_5.jpg": "7380cfdd96", "assets/hands_he_6.jpg": "e006d86640", "assets/hands_liu_2.jpg": "04fc140729", "assets/hands_liu_3.jpg": "a8bc00b141", "assets/hands_liu_4.jpg": "de670597fd", "assets/hands_liu_5.jpg": "ac3864559c", "assets/hands_liu_6.jpg": "5d8538430b", "assets/hands_passer_m_2.jpg": "0581a02ac3", "assets/hands_passer_m_3.jpg": "afb0b85d5f", "assets/hands_passer_m_4.jpg": "82916e5ccf", "assets/hands_passer_m_5.jpg": "2ff745fdd2", "assets/hands_passer_m_6.jpg": "0b3ae7a38d", "assets/hands_qian_2.jpg": "f66136bc5e", "assets/hands_qian_3.jpg": "aeeedbf9ae", "assets/hands_qian_4.jpg": "f588c31f6a", "assets/hands_qian_5.jpg": "2a8c2776bd", "assets/hands_qian_6.jpg": "f2d5afdfe6", "assets/hands_qin_2.jpg": "3e0bb5e076", "assets/hands_qin_3.jpg": "4e56ada5c3", "assets/hands_qin_4.jpg": "6532073a94", "assets/hands_qin_5.jpg": "01267c2941", "assets/hands_qin_6.jpg": "bd499cc2f2", "assets/hands_shen_2.jpg": "ce0f3e2934", "assets/hands_shen_3.jpg": "727350ba7b", "assets/hands_shen_4.jpg": "f07496eab3", "assets/hands_shen_5.jpg": "846732c634", "assets/hands_shen_6.jpg": "1774797d28", "assets/hands_tou_2.jpg": "e98e7716b2", "assets/hands_tou_3.jpg": "b093f8f9e9", "assets/hands_tou_4.jpg": "280a283e8f", "assets/hands_tou_5.jpg": "1855ce1f6d", "assets/hands_tou_6.jpg": "e8a5ac72cc", "assets/hands_yun_2.jpg": "4d55f6dfe9", "assets/hands_yun_3.jpg": "bdcd33e326", "assets/hands_yun_4.jpg": "2c1d95fb1f", "assets/hands_yun_5.jpg": "20130c8ead", "assets/hands_yun_6.jpg": "e45dba1102", "assets/hands_zhou_2.jpg": "722e99ef0a", "assets/hands_zhou_3.jpg": "c6d8f36d56", "assets/hands_zhou_4.jpg": "ad9edac454", "assets/hands_zhou_5.jpg": "27ab4f2d6d", "assets/hands_zhou_6.jpg": "4733a3507c", "assets/kitchen.jpg": "f9c410b1de", "assets/loc_corridor.jpg": "b5cdd853e1", "assets/loc_counter.jpg": "edb816dae7", "assets/loc_hall.jpg": "348300c37d", "assets/loc_kitchen.jpg": "2395fbaf14", "assets/loc_room1.jpg": "776a7287ea", "assets/loc_room2.jpg": "ae5fd056f2", "assets/loc_room3.jpg": "3032fc4067", "assets/loc_woodshed.jpg": "73f8604b27", "assets/loc_yard.jpg": "5d6fc643bf", "assets/paper.jpg": "099dbc29cc", "assets/street_afu_real.jpg": "495d3b0f8b", "assets/street_chen_real.jpg": "0401fcc06d", "assets/street_doctor_real.jpg": "27cdb23422", "assets/street_empty.jpg": "e381550353", "assets/street_gu_real.jpg": "8e83da2041", "assets/street_han_real.jpg": "caeee90414", "assets/street_he_real.jpg": "9ad671bcef", "assets/street_liu_real.jpg": "eaecc0a1e7", "assets/street_mother_real.jpg": "2563a10dc0", "assets/street_passer_f_real.jpg": "105a0cf977", "assets/street_passer_fy_real.jpg": "ea4f97ca60", "assets/street_passer_m_real.jpg": "a696189559", "assets/street_qian_real.jpg": "14d3c15f2a", "assets/street_qin_real.jpg": "671435afba", "assets/street_shen_real.jpg": "26867624f7", "assets/street_su_real.jpg": "585db58018", "assets/street_tou_real.jpg": "23e2a73236", "assets/street_wang_collar.jpg": "a72c362455", "assets/street_wang_real.jpg": "ecce332a9a", "assets/street_yagu_real.jpg": "f95b18cf4c", "assets/street_ye_real.jpg": "5efa3893e0", "assets/street_yun_real.jpg": "e5181fa408", "assets/street_zhou_real.jpg": "d72975d29c", "assets/thanks.jpg": "2aaf7725b9", "assets/title.jpg": "d46f4d0d0e", "assets/town_grave_day.jpg": "db755debd0", "assets/town_grave_night.jpg": "6d6225c5dc", "assets/town_map.jpg": "dab6ab11df", "assets/town_market_day.jpg": "272aa83b25", "assets/town_market_night.jpg": "812741a295", "assets/town_temple_day.jpg": "68b4583652", "assets/town_temple_night.jpg": "201dcbcdd9", "assets/town_yamen_day.jpg": "a87530ade8", "assets/town_yamen_night.jpg": "f442797c29"};                       // { "assets/x.jpg": "雜湊", ... }
const CACHE = "louke-" + VERSION, IMG_CACHE = "louke-img";
const SCOPE = self.registration.scope;
const imgKey = rel => new URL(rel + "?h=" + IMG[rel], SCOPE).href;

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (let i = 0; i < FILES.length; i += 6) {
      // cache: "reload"：不要拿瀏覽器 HTTP 快取裡的舊檔（GitHub Pages 會讓檔案在瀏覽器留 10 分鐘）
      await Promise.all(FILES.slice(i, i + 6).map(f => fetch(f, { cache: "reload" })
        .then(r => r.ok ? c.put(f, r) : null).catch(() => {})));
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== IMG_CACHE) await caches.delete(k);
    // 圖片快取裡已經不用的舊版本刪掉
    const ic = await caches.open(IMG_CACHE), keep = new Set(Object.keys(IMG).map(imgKey));
    for (const req of await ic.keys()) if (!keep.has(req.url)) await ic.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const rel = url.pathname.startsWith(new URL(SCOPE).pathname) ? decodeURIComponent(url.pathname.slice(new URL(SCOPE).pathname.length)) : "";
  // 下載畫面指定了別的版本（新版剛發佈、這個 sw 還是舊的）：不攔，直接上網
  const want = url.searchParams.get("h");
  if (IMG[rel] && want && want !== IMG[rel]) return;
  // 圖片：用「路徑＋雜湊」找；沒有就上網抓，存起來
  if (IMG[rel]) {
    e.respondWith((async () => {
      const ic = await caches.open(IMG_CACHE), key = imgKey(rel);
      const hit = await ic.match(key);
      if (hit) return hit;
      try {
        const res = await fetch(key);   // 網址帶雜湊：不會拿到瀏覽器 HTTP 快取裡的舊圖
        if (res.ok) await ic.put(key, res.clone());
        return res;
      } catch (err) {
        return new Response("", { status: 504 });
      }
    })());
    return;
  }
  // 其他：先看快取，沒有再上網抓（抓到順便存起來）
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch (err) {
      return new Response("", { status: 504 });
    }
  })());
});
