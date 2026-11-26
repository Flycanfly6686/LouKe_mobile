// 程式合成的音效與背景聲。之後可換成正式音檔。
// 背景聲依場景切換：outdoor（雨聲）／indoor（遠處的老戲曲）／quiet（只剩極輕的底噪）／town:<地點>:<day|dusk>（鎮上各地點的配樂）
// 若放了 assets/audio/opera.mp3，室內會改播那個檔案（找不到就用合成的）。
window.SFX = (() => {
  // master＝音效（敲門、驚嚇…）；musicMaster＝背景聲（雨、戲曲、主畫面配樂）
  let ctx = null, master = null, musicMaster = null, rainGain = null, musicGain = null, musicBus = null, muted = false;
  const vol = { music: 0.8, sfx: 0.9 };
  try { const v = JSON.parse(localStorage.getItem("louke_volume") || "null"); if (v) Object.assign(vol, v); } catch (e) {}
  let mode = "outdoor", unease = 0, timer = null, nextNote = 0, phrase = [], prevFreq = 0, fileMusic = null;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = vol.sfx;
    master.connect(ctx.destination);
    musicMaster = ctx.createGain();
    musicMaster.gain.value = vol.music;
    musicMaster.connect(ctx.destination);
    startRain();
    startMusicBus();
    startTitleBus();
    startTownBus();
    startDreadBus();
    setAmbience(mode);
  }

  // ---- 緊張層：畫面上有已識破的畫皮時疊上去（不管目前是哪一首背景）----
  // 不和諧的低鳴（小二度＋三全音、會顫動）、越來越快的心跳、偶爾一聲刮弦
  let dreadGain = null, dreadBus = null, dreadOn = 0, dreadTimer = null, dreadNext = 0, dreadBeat = 0;
  function startDreadBus() {
    dreadGain = ctx.createGain(); dreadGain.gain.value = 0; dreadGain.connect(musicMaster);
    dreadBus = ctx.createGain(); dreadBus.gain.value = 1; dreadBus.connect(dreadGain);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 5;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 260; lfo.connect(lg).connect(lp.frequency); lfo.start();
    [41.2, 43.65, 58.27, 61.74].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i % 2 ? "sawtooth" : "square"; o.frequency.value = f; g.gain.value = 0.06;
      o.connect(g).connect(lp); o.start();
    });
    const trem = ctx.createGain(); trem.gain.value = 0.7;
    const tl = ctx.createOscillator(), tg = ctx.createGain(); tl.frequency.value = 4.8; tg.gain.value = 0.3; tl.connect(tg).connect(trem.gain); tl.start();
    lp.connect(trem).connect(dreadBus);
  }
  function dreadHit(t, vol, f) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(dreadBus); o.start(t); o.stop(t + 0.65);
  }
  function dreadScrape(t, vol) {               // 刮弦：高音鋸齒波滑下來，帶通濾過
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth"; const f0 = 900 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + 1.6);
    f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 6;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    o.connect(f).connect(g).connect(dreadBus); o.start(t); o.stop(t + 1.9);
  }
  function scheduleDread() {
    if (!ctx || !dreadOn) return;
    const now = ctx.currentTime;
    if (dreadNext < now) dreadNext = now + 0.1;
    while (dreadNext < now + 1.2) {
      const gap = Math.max(0.62, 0.95 - dreadBeat * 0.01);          // 心跳越來越快
      dreadHit(dreadNext, 0.7, 52); dreadHit(dreadNext + 0.26, 0.45, 47);
      if (dreadBeat % 6 === 3 && Math.random() < 0.6) dreadScrape(dreadNext + gap / 2, 0.08);
      dreadBeat++; dreadNext += gap;
    }
  }
  // 殺死畫皮的那一刻：緊張層立刻收掉，背景音樂等殺人音效過了再淡回來
  function cutDread(t) {
    if (!dreadOn) return;
    dreadOn = 0; dreadGain.gain.setTargetAtTime(0, t, 0.12);
    if (dreadTimer) { clearInterval(dreadTimer); dreadTimer = null; }
    setTimeout(() => { if (!dreadOn) setAmbience(mode); }, 2500);
  }
  function setDread(on) {
    on = on ? 1 : 0;
    if (on === dreadOn) return;
    dreadOn = on;
    if (!ctx) return;
    const t = ctx.currentTime;
    dreadGain.gain.setTargetAtTime(on ? 1.5 : 0, t, on ? 0.5 : 1.2);   // v0.9.3：0.75 → 1.5
    setAmbience(mode);                                   // 背景音樂：緊張層開著時整個淡出，關掉時淡回來
    if (on) { dreadBeat = 0; dreadNext = 0; if (!dreadTimer) dreadTimer = setInterval(scheduleDread, 250); scheduleDread(); }
    else if (dreadTimer) { clearInterval(dreadTimer); dreadTimer = null; }
  }

  function noiseBuffer(sec, brown = false) {
    const len = ctx.sampleRate * sec, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  function startRain() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(3);
    src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    src.connect(bp).connect(lp).connect(rainGain).connect(musicMaster);
    src.start();
  }

  // ---------- 遠處的老戲曲（合成） ----------
  // 隔著牆、像老唱片：整體低通、帶一點回音和唱片的劈啪聲
  function startMusicBus() {
    musicGain = ctx.createGain(); musicGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1900;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 160;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.19;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    musicBus = ctx.createGain(); musicBus.gain.value = 1;
    musicBus.connect(hp).connect(lp).connect(musicGain).connect(musicMaster);
    lp.connect(delay).connect(fb).connect(delay); delay.connect(musicGain);
    // 唱片劈啪聲
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() < 0.0006 ? (Math.random() - 0.5) * 1.6 : 0) + (Math.random() - 0.5) * 0.02;
    const crackle = ctx.createBufferSource(); crackle.buffer = buf; crackle.loop = true;
    const cg = ctx.createGain(); cg.gain.value = 0.5;
    crackle.connect(cg).connect(musicGain); crackle.start();
  }

  // 五聲音階（宮商角徵羽），以 D 為宮
  const SCALE = [0, 2, 4, 7, 9];
  const freqOf = deg => 293.66 * Math.pow(2, (Math.floor(deg / 5) * 12 + SCALE[((deg % 5) + 5) % 5]) / 12);
  const BEAT = 0.78;

  function makePhrase() {
    // 隨機走動的旋律，句尾拉長音；以級進為主，偶爾跳進
    let deg = 2 + Math.floor(Math.random() * 4);
    const notes = [], n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const step = Math.random() < 0.75 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
      deg = Math.max(-2, Math.min(8, deg + step));
      notes.push({ deg, beats: i === n - 1 ? 3 + Math.floor(Math.random() * 2) : [0.5, 1, 1, 1.5, 2][Math.floor(Math.random() * 5)] });
    }
    notes.push({ rest: true, beats: 1.5 + Math.random() * 2 });
    return notes;
  }

  // 像人聲的「啊——」：鋸齒波經過兩個共振峰，有顫音和滑音，聽不出歌詞
  function voice(t, f, dur) {
    const o = ctx.createOscillator(); o.type = "sawtooth";
    const from = prevFreq || f;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.18, dur * 0.3));
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.8);
    lfo.connect(lg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 650 + Math.random() * 150; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1080 + Math.random() * 200; f2.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.08);
    g.gain.setValueAtTime(0.5, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
    prevFreq = f;
  }
  // 胡琴：低八度跟著旋律，比人聲小聲
  function huqin(t, f, dur) {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f / 2;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.12); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  // 梆子／板：短促的木頭聲
  function clapper(t, vol = 0.4) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.04);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2300; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(bp).connect(g).connect(musicBus); n.start(t);
  }
  // 小鑼：句首敲一下
  function gong(t) {
    const o = ctx.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(700, t); o.frequency.linearRampToValueAtTime(860, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 1);
  }

  function schedule() {
    if (!ctx || mode !== "indoor" || fileMusic) return;
    while (nextNote < ctx.currentTime + 1.2) {
      if (!phrase.length) { phrase = makePhrase(); gong(nextNote); }
      const n = phrase.shift(), dur = n.beats * BEAT;
      if (!n.rest) {
        // 樓裡不對勁時，偶爾唱走音
        const f = freqOf(n.deg) * (Math.random() < unease * 0.25 ? 0.94 : 1);
        voice(nextNote, f, dur); huqin(nextNote, f, dur);
      } else prevFreq = 0;
      for (let b = 0; b < n.beats; b += 1) clapper(nextNote + b * BEAT, b === 0 ? 0.45 : 0.2);
      nextNote += dur;
    }
  }

  // ---------- 主畫面：詭異的懸疑配樂（合成） ----------
  // 低沉的持續音＋走音的音樂盒＋玻璃般的高音泛音＋偶爾一聲像心跳的悶響
  let titleGain = null, titleBus = null, titleTimer = null, nextBox = 0, nextBeat = 0;
  function startTitleBus() {
    titleGain = ctx.createGain(); titleGain.gain.value = 0;
    titleBus = ctx.createGain(); titleBus.gain.value = 1;
    const delay = ctx.createDelay(2); delay.delayTime.value = 0.43;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    titleBus.connect(titleGain); titleBus.connect(delay).connect(lp).connect(fb).connect(delay); lp.connect(titleGain);
    titleGain.connect(musicMaster);
    // 持續低音：兩個略為走調的 D，再疊一個降 E（小二度，不和諧）
    [[36.7, 0.16], [36.95, 0.16], [73.4, 0.06], [77.8, 0.035]].forEach(([f, v]) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = v;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07 + Math.random() * 0.08; lg.gain.value = v * 0.6;
      lfo.connect(lg).connect(g.gain); lfo.start();
      o.connect(g).connect(titleGain); o.start();
    });
    // 風聲般的低噪
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(4, true); n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 380; nf.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    n.connect(nf).connect(ng).connect(titleGain); n.start();
  }
  // 音樂盒：D 小調加降二級，偶爾故意走音
  const BOX = [587.3, 622.3, 698.5, 880, 932.3, 1174.7, 1244.5];
  function boxNote(t, f) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * (Math.random() < 0.2 ? 0.97 : 1);
    const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 3.01;
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 2.6);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.025, t + 0.005); g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    o.connect(g).connect(titleBus); o2.connect(g2).connect(titleBus);
    o.start(t); o.stop(t + 2.7); o2.start(t); o2.stop(t + 0.9);
  }
  // 玻璃般的高音：慢慢浮起又消失
  function glass(t) {
    const f = [1396.9, 1479.98, 1760][Math.floor(Math.random() * 3)];
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.985, t + 6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.018, t + 2.5); g.gain.linearRampToValueAtTime(0, t + 6);
    o.connect(g).connect(titleBus); o.start(t); o.stop(t + 6.1);
  }
  function scheduleTitle() {
    if (!ctx || mode !== "title") return;
    const now = ctx.currentTime;
    while (nextBox < now + 1.5) {
      // 一小句音樂盒（3–6 個音），然後停很久
      const n = 3 + Math.floor(Math.random() * 4);
      let t = nextBox, i = Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        boxNote(t, BOX[i]);
        i = Math.max(0, Math.min(BOX.length - 1, i + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2)));
        t += [0.45, 0.6, 0.9][Math.floor(Math.random() * 3)] * (k === n - 2 ? 1.6 : 1);   // 句尾放慢，像發條快轉完
      }
      if (Math.random() < 0.5) glass(t + 1);
      nextBox = t + 3 + Math.random() * 4;
    }
    while (nextBeat < now + 1.5) {
      // 偶爾兩聲低沉的心跳
      thumpTo(nextBeat, 48, 0.55, titleBus); thumpTo(nextBeat + 0.28, 44, 0.4, titleBus);
      nextBeat += 7 + Math.random() * 6;
    }
  }
  function thumpTo(t, freq, vol, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq * 1.5, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.4);
  }


  // ======================================================
  //  v0.8.7 鎮上各地點的配樂（合成）：地圖、市集、城隍廟、亂葬崗、縣衙，早上／黃昏各一種
  //  放了 assets/audio/town_<地點>_<day|dusk>.mp3（或 town_<地點>.mp3）就改播檔案
  // ======================================================
  let townGain = null, townBus = null, townVerbGain = null, townWindGain = null, droneA = null, droneB = null, droneGain = null;
  let townTimer = null, townKey = "", T = null, tNext = 0, tPhrase = [], tPrev = 0, tBeat = 0, tEv = {};
  const townFiles = {};                 // key → Audio（可播）／false（沒有檔案）／undefined（還在找）
  let townFilePlaying = null;

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function startTownBus() {
    townGain = ctx.createGain(); townGain.gain.value = 0; townGain.connect(musicMaster);
    townBus = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 0.85;
    const verb = ctx.createConvolver(); verb.buffer = impulse(3.4, 2.4);
    townVerbGain = ctx.createGain(); townVerbGain.gain.value = 0.35;
    townBus.connect(dry).connect(townGain);
    townBus.connect(verb).connect(townVerbGain).connect(townGain);
    // 風：低沉的棕噪，慢慢起伏
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(5, true); n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 420; f.Q.value = 0.8;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 220; lfo.connect(lg).connect(f.frequency); lfo.start();
    townWindGain = ctx.createGain(); townWindGain.gain.value = 0;
    n.connect(f).connect(townWindGain).connect(townGain); n.start();
    // 持續低音：兩個略為走調的鋸齒波，濾得很暗
    droneGain = ctx.createGain(); droneGain.gain.value = 0;
    const dl = ctx.createBiquadFilter(); dl.type = "lowpass"; dl.frequency.value = 320;
    droneA = ctx.createOscillator(); droneA.type = "sawtooth"; droneA.frequency.value = 73.4;
    droneB = ctx.createOscillator(); droneB.type = "sawtooth"; droneB.frequency.value = 73.8;
    droneA.connect(dl); droneB.connect(dl); dl.connect(droneGain).connect(townGain);
    droneA.start(); droneB.start();
  }

  // ---- 樂器 ----
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + a + d); }
  // 古琴／琵琶的撥弦：三角波＋泛音，起音略高再落回（像按弦）
  function pluck(t, f, vol, decay = 2.2, slideTo = 0) {
    [[1, 1, 1], [2.003, 0.32, 0.45], [3.01, 0.12, 0.3]].forEach(([m, a, dk]) => {
      const o = ctx.createOscillator(); o.type = m === 1 ? "triangle" : "sine";
      o.frequency.setValueAtTime(f * m * 1.012, t); o.frequency.exponentialRampToValueAtTime(f * m, t + 0.05);
      if (slideTo && m === 1) { o.frequency.setValueAtTime(f, t + decay * 0.25); o.frequency.exponentialRampToValueAtTime(slideTo, t + decay * 0.55); }
      const g = ctx.createGain(); env(g, t, 0.004, vol * a, decay * dk);
      o.connect(g).connect(townBus); o.start(t); o.stop(t + decay * dk + 0.05);
    });
  }
  // 古琴泛音：清亮、空靈的「叮」
  function harmonic(t, f, vol) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * 2;
    const g = ctx.createGain(); env(g, t, 0.003, vol, 3.2);
    o.connect(g).connect(townBus); o.start(t); o.stop(t + 3.3);
  }
  // 笛子：正弦＋一點三角波，慢起音、後段顫音、帶氣聲
  function flute(t, f, dur, vol) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = f;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.4;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.009, t + Math.max(0.2, dur * 0.6));
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.09); g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.linearRampToValueAtTime(0, t + dur);
    g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g); g.connect(townBus);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(Math.min(3, dur + 0.1));
    const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = f * 2; nf.Q.value = 2;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(vol * 0.12, t + 0.05); ng.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(nf).connect(ng).connect(townBus);
    [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + dur + 0.05); }); n.start(t);
  }
  // 二胡：鋸齒波過共振峰，滑音進來
  function erhu(t, f, dur, vol) {
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(tPrev || f, t); o.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.15, dur * 0.3));
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.8;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.7);
    lfo.connect(lg).connect(o.frequency);
    const b1 = ctx.createBiquadFilter(); b1.type = "bandpass"; b1.frequency.value = 900; b1.Q.value = 2.5;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.1); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(b1).connect(lp).connect(g).connect(townBus);
    o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  // 誦經般的低吟：低沉的「嗡」
  function chant(t, f, dur, vol) {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f / 2;
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 380; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 760; f2.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.4); g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(townBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // 木頭聲：梆子、木魚、驚堂木
  function wood(t, freq, vol, len = 0.05) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(freq * 1.2, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * 3);
    o.connect(g).connect(townBus); o.start(t); o.stop(t + len * 3 + 0.02);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.03);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq * 2; bp.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(bp).connect(ng).connect(townBus); n.start(t);
  }
  // 鐘：不和諧的泛音，餘音很長
  function bell(t, f, vol, len = 7) {
    [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]].forEach(([m, a], i) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * m;
      const g = ctx.createGain(); env(g, t, 0.006, vol * a, len / (i + 1));
      o.connect(g).connect(townBus); o.start(t); o.stop(t + len / (i + 1) + 0.05);
    });
  }
  // 鼓：堂鼓、遠處的鼓
  function drum(t, vol, f = 62) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(townBus); o.start(t); o.stop(t + 0.75);
  }
  // 烏鴉：兩聲沙啞的「啊——」
  function crow(t, vol) {
    [0, 0.42].forEach(d => {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(820, t + d); o.frequency.exponentialRampToValueAtTime(560, t + d + 0.28);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1300; bp.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(vol, t + d + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.32);
      o.connect(bp).connect(g).connect(townBus); o.start(t + d); o.stop(t + d + 0.35);
    });
  }
  // 滴漏：水滴
  function drip(t, vol) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(1700, t); o.frequency.exponentialRampToValueAtTime(820, t + 0.07);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(townBus); o.start(t); o.stop(t + 0.13);
  }
  // 耳語：濾過的噪音，忽大忽小
  function whisper(t, vol) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(2.2);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400 + Math.random() * 1200; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 6; k++) g.gain.linearRampToValueAtTime(vol * Math.random(), t + 0.3 * (k + 1));
    g.gain.linearRampToValueAtTime(0, t + 2.1);
    n.connect(bp).connect(g).connect(townBus); n.start(t);
  }

  // ---- 各地點的曲風 ----
  // root：宮音的頻率；home：旋律落在哪一級（0＝宮、明亮；4＝羽、哀傷）；sour：走音的機率
  const THEMES = {
    map: {
      day:  { beat: 0.62, root: 293.66, home: 0, lo: -1, hi: 7, inst: "qin", vol: 0.3, rhy: [1, 1, 1, 2, 0.5, 0.5], rest: [2, 4], drone: [73.4, 0.035], wind: 0.025, verb: 0.35, bassEvery: 4 },
      dusk: { beat: 0.86, root: 246.94, home: 4, lo: -2, hi: 5, inst: "qin", vol: 0.26, rhy: [1, 2, 2, 1, 3], rest: [3, 6], drone: [61.7, 0.06], wind: 0.06, verb: 0.55, sour: 0.12, bassEvery: 4 }
    },
    market: {
      day:  { beat: 0.36, root: 392, home: 0, lo: 0, hi: 9, inst: "dizi", vol: 0.16, rhy: [0.5, 0.5, 1, 1, 0.5, 1.5], rest: [1, 2], perc: "market", pipa: 0.35, verb: 0.22 },
      dusk: { beat: 0.5, root: 329.63, home: 4, lo: -1, hi: 7, inst: "dizi", vol: 0.14, rhy: [1, 1, 2, 0.5, 1.5], rest: [2, 4], perc: "night", pipa: 0.2, drone: [82.4, 0.03], wind: 0.02, verb: 0.45, sour: 0.08, bells: [6, 11] }
    },
    temple: {
      day:  { beat: 0.95, root: 196, home: 0, lo: -2, hi: 4, inst: "chant", vol: 0.24, rhy: [2, 3, 4], rest: [2, 4], perc: "muyu", drone: [98, 0.035], verb: 0.6, bells: [9, 14], bellF: 220 },
      dusk: { beat: 1.15, root: 174.61, home: 4, lo: -3, hi: 3, inst: "chant", vol: 0.2, rhy: [2, 3, 4], rest: [3, 5], perc: "trial", drone: [87.3, 0.06], wind: 0.03, verb: 0.75, sour: 0.3, bells: [11, 17], bellF: 207.7, whisper: [5, 9] }
    },
    grave: {
      day:  { beat: 1.0, root: 220, home: 4, lo: 0, hi: 8, inst: "harm", vol: 0.22, rhy: [1, 2, 2, 3], rest: [4, 7], drone: [55, 0.025], wind: 0.1, verb: 0.6, sour: 0.15, crows: [9, 16] },
      dusk: { beat: 1.25, root: 207.65, home: 4, lo: -2, hi: 6, inst: "harm", vol: 0.16, rhy: [2, 3, 3], rest: [5, 9], drone: [51.9, 0.07], wind: 0.14, verb: 0.75, sour: 0.35, crows: [7, 13], heart: [6, 10], whisper: [10, 16] }
    },
    // ---- 結局配樂（四類＋幾個變化）----
    // 慘劇：低沉持續音、慢心跳、走音的鈴
    endTragic: { day: { beat: 1.3, root: 146.83, home: 4, lo: -3, hi: 3, inst: "harm", vol: 0.14, rhy: [2, 3, 4], rest: [4, 8], drone: [48.99, 0.09], wind: 0.08, verb: 0.75, sour: 0.4, heart: [5, 9], bells: [10, 16], bellF: 196 } },
    // 懲罰：空洞孤單，只有滴水和很遠的鐘
    endPunish: { day: { beat: 1.4, root: 174.61, home: 4, lo: -2, hi: 2, inst: "harm", vol: 0.08, rhy: [3, 4], rest: [6, 10], drone: [58.27, 0.04], verb: 0.8, drip: [1.5, 3], bells: [14, 22], bellF: 220 } },
    // 失心：懲罰的空洞，再加耳語和走音
    endMind: { day: { beat: 1.4, root: 174.61, home: 4, lo: -2, hi: 2, inst: "harm", vol: 0.09, rhy: [3, 4], rest: [5, 9], drone: [58.27, 0.05], verb: 0.85, sour: 0.35, drip: [2, 4], whisper: [5, 9] } },
    // 守住了：古琴慢板，大調、不走音
    endSafe: { day: { beat: 0.8, root: 293.66, home: 0, lo: -1, hi: 7, inst: "qin", vol: 0.26, rhy: [1, 2, 2, 1, 3], rest: [2, 4], verb: 0.5, bassEvery: 4, bells: [12, 20], bellF: 587.33 } },
    // 主線真相：誦經般的長音、遠處的鐘
    endTruth: { day: { beat: 1.1, root: 196, home: 0, lo: -2, hi: 4, inst: "chant", vol: 0.2, rhy: [2, 3, 4], rest: [3, 5], drone: [98, 0.04], verb: 0.65, bells: [8, 13], bellF: 392 } },
    // 成果：一樣的誦經，但走音、有耳語
    endResult: { day: { beat: 1.1, root: 196, home: 0, lo: -2, hi: 4, inst: "chant", vol: 0.18, rhy: [2, 3, 4], rest: [3, 5], drone: [92.5, 0.06], verb: 0.7, sour: 0.35, bells: [9, 15], bellF: 370, whisper: [8, 14] } },
    // 還皮：最溫柔的一首，慢慢的古琴和清鈴
    endGive: { day: { beat: 1.0, root: 220, home: 4, lo: -1, hi: 5, inst: "qin", vol: 0.24, rhy: [2, 2, 3], rest: [3, 5], drone: [55, 0.02], verb: 0.6, bells: [10, 16], bellF: 440, bassEvery: 4 } },
    // 戀人結局：笛子主旋律、琵琶伴奏、偶爾一聲清鈴；大調五聲、不走音、沒有低鳴
    // 片尾字幕：慢版笛子、琵琶輕輕撥、遠處的清鈴，帶一點雨
    credits: {
      day: { beat: 0.95, root: 261.63, home: 0, lo: -1, hi: 7, inst: "dizi", vol: 0.15, rhy: [2, 1, 1, 2, 3, 4], rest: [2, 4], pipa: 0.22, drone: [65.4, 0.025], verb: 0.62, bells: [9, 14], bellF: 523.25, bassEvery: 4 }
    },
    love: {
      day: { beat: 0.5, root: 349.23, home: 0, lo: 0, hi: 9, inst: "dizi", vol: 0.15, rhy: [1, 1, 2, 1, 0.5, 0.5, 2, 3], rest: [1.5, 3], pipa: 0.55, verb: 0.5, bells: [7, 12], bellF: 698.46, bassEvery: 2 }
    },
    yamen: {
      day:  { beat: 0.78, root: 261.63, home: 0, lo: -2, hi: 6, inst: "erhu", vol: 0.22, rhy: [1, 1, 2, 2, 0.5], rest: [2, 3], perc: "court", drone: [65.4, 0.03], verb: 0.4 },
      dusk: { beat: 1.05, root: 233.08, home: 4, lo: -3, hi: 4, inst: "erhu", vol: 0.16, rhy: [2, 3, 4], rest: [4, 7], drone: [58.3, 0.06], verb: 0.6, sour: 0.25, drip: [1.3, 2.6] }
    }
  };
  const fq = (th, deg) => th.root * Math.pow(2, (Math.floor(deg / 5) * 12 + SCALE[((deg % 5) + 5) % 5]) / 12);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const between = ([a, b]) => a + Math.random() * (b - a);

  function townPhrase(th) {
    let deg = th.home + pick([0, 1, 2, -1]);
    const notes = [], n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const step = Math.random() < 0.72 ? pick([-1, 1]) : pick([-2, 2, 3, -3]);
      deg = Math.max(th.lo, Math.min(th.hi, deg + step));
      if (i === n - 1) deg = th.home + pick([0, 0, 5, -5]);          // 句尾回到主音
      notes.push({ deg, beats: i === n - 1 ? pick([2, 3, 4]) : pick(th.rhy) });
    }
    notes.push({ rest: true, beats: between(th.rest) });
    return notes;
  }
  function playNote(th, t, f, dur) {
    if (th.inst === "qin") { pluck(t, f, th.vol, Math.max(1.6, dur * 1.4), Math.random() < 0.2 ? f * pick([1.06, 0.94]) : 0); }
    else if (th.inst === "harm") { if (Math.random() < 0.6) harmonic(t, f, th.vol); else pluck(t, f / 2, th.vol * 0.9, 2.6); }
    else if (th.inst === "dizi") { flute(t, f, dur * 0.95, th.vol); }
    else if (th.inst === "erhu") { erhu(t, f / 2, dur * 0.95, th.vol); }
    else if (th.inst === "chant") { chant(t, f, dur * 0.95, th.vol); }
    if (th.pipa && Math.random() < th.pipa) pluck(t, f / 2, 0.12, 0.6);                  // 琵琶點綴
  }
  function percBeat(th, t, i) {
    const p = th.perc;
    if (p === "market") { wood(t, 1500, i % 2 ? 0.08 : 0.16); if (i % 8 === 0) drum(t, 0.22, 90); if (i % 4 === 2 && Math.random() < 0.5) wood(t + th.beat / 2, 1900, 0.06); }
    else if (p === "night") { if (i % 4 === 0) drum(t, 0.12, 70); if (Math.random() < 0.25) wood(t, 1300, 0.05); }
    else if (p === "muyu") { wood(t, 520, 0.22, 0.09); }
    else if (p === "trial") { if (i % 4 === 0) drum(t, 0.3, 55); if (i % 8 === 6) wood(t, 900, 0.3, 0.04); }      // 升堂的鼓、驚堂木
    else if (p === "court") { if (i % 8 === 0) drum(t, 0.25, 58); if (i % 16 === 12 && Math.random() < 0.6) wood(t, 900, 0.28, 0.04); }
    else if (th.bassEvery && i % th.bassEvery === 0 && Math.random() < 0.6) pluck(t, th.root / 4, th.vol * 0.7, 2.4);  // 低音弦
  }
  function events(th, now) {
    const want = (k, range, fn) => {
      if (!range) return;
      if (!tEv[k]) tEv[k] = now + between(range) * 0.5;
      while (tEv[k] < now + 1.2) { fn(tEv[k]); tEv[k] += between(range); }
    };
    want("bell", th.bells, t => bell(t, (th.bellF || 440) * (th.sour && Math.random() < th.sour ? 0.96 : 1), 0.12));
    want("crow", th.crows, t => crow(t, 0.05));
    want("heart", th.heart, t => { drum(t, 0.35, 48); drum(t + 0.3, 0.25, 44); });
    want("whisper", th.whisper, t => whisper(t, 0.05));
    want("drip", th.drip, t => drip(t, 0.08));
  }
  function scheduleTown() {
    if (!ctx || !T || townFilePlaying) return;
    const now = ctx.currentTime;
    while (tNext < now + 1.2) {
      if (!tPhrase.length) tPhrase = townPhrase(T);
      const n = tPhrase.shift(), dur = n.beats * T.beat;
      if (!n.rest) {
        let f = fq(T, n.deg);
        if (T.sour && Math.random() < T.sour) f *= pick([0.94, 1.06]);   // 走音：越晚越不對勁
        playNote(T, tNext, f, dur);
        tPrev = f;
      } else tPrev = 0;
      for (let b = 0; b < n.beats; b += 1) percBeat(T, tNext + b * T.beat, tBeat++);
      tNext += dur;
    }
    events(T, now);
  }
  function townFile(key, place) {
    // 先找 town_<地點>_<day|dusk>.mp3，再找 town_<地點>.mp3
    const tryLoad = name => {
      if (townFiles[name] !== undefined) return townFiles[name];
      townFiles[name] = null;
      const a = new Audio(`assets/audio/${name}.mp3`); a.loop = true; a.volume = 0;
      a.addEventListener("canplay", () => { townFiles[name] = a; if (townKey === key) setAmbience(mode); }, { once: true });
      a.addEventListener("error", () => { townFiles[name] = false; if (townKey === key) setAmbience(mode); }, { once: true });
      return null;
    };
    const exact = tryLoad(`town_${place}_${key.split(":")[1]}`);
    if (exact) return exact;
    if (townFiles[`town_${place}_${key.split(":")[1]}`] === false) return tryLoad(`town_${place}`) || null;
    return null;
  }
  // m 形如 "town:market:dusk"
  function setTown(m) {
    const t = ctx.currentTime, on = m.startsWith("town:");
    if (!on) {
      townGain.gain.setTargetAtTime(0, t, 0.4);
      if (townFilePlaying) { townFilePlaying.pause(); townFilePlaying = null; }
      townKey = ""; return;
    }
    const [, place, phase] = m.split(":"), key = `${place}:${phase}`;
    const file = townFile(key, place);
    if (key !== townKey) {
      townKey = key; T = THEMES[place] && THEMES[place][phase] || THEMES.map.day;
      tPhrase = []; tEv = {}; tPrev = 0; tBeat = 0;
      tNext = t + 0.9;                                           // 換地點：先淡出，再從新的曲子開始
      townGain.gain.setTargetAtTime(0, t, 0.25);
      townVerbGain.gain.setTargetAtTime(T.verb || 0.35, t, 0.5);
      townWindGain.gain.setTargetAtTime(T.wind || 0, t, 1.2);
      const [df, dv] = T.drone || [73.4, 0];
      droneA.frequency.setTargetAtTime(df, t, 0.6); droneB.frequency.setTargetAtTime(df * 1.006, t, 0.6);
      droneGain.gain.setTargetAtTime(dv, t, 1.2);
    }
    if (townFilePlaying && townFilePlaying !== file) { townFilePlaying.pause(); townFilePlaying = null; }
    if (file) {
      townFilePlaying = file;
      file.volume = dreadOn ? 0 : 0.4 * vol.music;
      file.play().catch(() => {});
      townGain.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    townGain.gain.setTargetAtTime(dreadOn ? 0 : 0.9 * (1 - unease * 0.5), t + (dreadOn ? 0 : 0.6), dreadOn ? 0.4 : 0.8);
    if (!townTimer) townTimer = setInterval(scheduleTown, 250);
    scheduleTown();
  }

  // 驚呼的錄音檔（選用）：assets/audio/gasp.mp3
  let gaspFile = null;
  function tryGaspFile() {
    if (gaspFile !== null) return;
    gaspFile = undefined;
    const a = new Audio("assets/audio/gasp.mp3");
    a.addEventListener("canplay", () => { gaspFile = a; }, { once: true });
    a.addEventListener("error", () => { gaspFile = false; }, { once: true });
  }
  function tryFileMusic() {
    if (fileMusic !== null) return;
    const a = new Audio("assets/audio/opera.mp3");
    a.loop = true; a.volume = 0;
    a.addEventListener("canplay", () => { fileMusic = a; setAmbience(mode); }, { once: true });
    a.addEventListener("error", () => { fileMusic = false; }, { once: true });
    fileMusic = undefined;
  }

  function setAmbience(m) {
    mode = m;
    if (!ctx) return;
    const t = ctx.currentTime;
    const town = m.startsWith("town:");
    const rain = /^town:(love|endSafe|endGive)/.test(m) ? 0 : m === "outdoor" ? 0.07 : town ? 0.03 : m === "title" ? 0.025 : m === "quiet" ? 0.012 : 0;
    rainGain.gain.setTargetAtTime(dreadOn ? rain * 0.5 : rain, t, 0.5);
    setTown(m);
    titleGain.gain.setTargetAtTime(m === "title" ? 0.9 : 0, t, m === "title" ? 1.2 : 0.4);
    if (m === "title") {
      if (nextBox < t) { nextBox = t + 1.2; nextBeat = t + 4; }
      if (!titleTimer) titleTimer = setInterval(scheduleTitle, 300);
      scheduleTitle();
    }
    const level = 0.55 * (1 - unease * 0.8);           // 畫皮越多，曲聲越小
    musicGain.gain.setTargetAtTime(m === "indoor" && !fileMusic && !dreadOn ? level : 0, t, dreadOn ? 0.4 : 0.8);
    if (fileMusic) {
      fileMusic.volume = m === "indoor" && !dreadOn ? 0.35 * vol.music * (1 - unease * 0.8) : 0;
      if (m === "indoor") fileMusic.play().catch(() => {}); else fileMusic.pause();
    }
    if (m === "indoor") {
      if (nextNote < ctx.currentTime) { nextNote = ctx.currentTime + 0.3; phrase = []; }
      if (!timer) timer = setInterval(schedule, 250);
      schedule();
    }
  }

  function thump(t, freq = 85, vol = 0.9) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.25);
    const n = ctx.createBufferSource(), ng = ctx.createGain(), f = ctx.createBiquadFilter();
    n.buffer = noiseBuffer(0.05); f.type = "lowpass"; f.frequency.value = 900;
    ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(f).connect(ng).connect(master); n.start(t);
  }

  return {
    init() { init(); tryFileMusic(); tryGaspFile(); },
    setAmbience,
    // 0～1：樓裡畫皮的比例，越高曲聲越小、越常走音
    setUnease(v) { unease = Math.max(0, Math.min(1, v)); if (ctx) setAmbience(mode); },
    // 畫面上有已識破的畫皮：true 疊上緊張層，false 淡回原本的背景
    setDread(on) { setDread(on); },
    // 桃木釘殺死畫皮：釘進木頭的悶響 → 皮塌下去的洩氣聲 → 一聲清鈴（除掉了）
    killFake() {
      if (!ctx) return;
      const t = ctx.currentTime;
      cutDread(t);
      thump(t, 70, 1.2);
      const c = ctx.createBufferSource(), cf = ctx.createBiquadFilter(), cg = ctx.createGain();      // 木頭裂開的脆響
      c.buffer = noiseBuffer(0.12); cf.type = "highpass"; cf.frequency.value = 2200;
      cg.gain.setValueAtTime(0.25, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      c.connect(cf).connect(cg).connect(master); c.start(t);
      const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();      // 洩氣：濾波器往下掃
      n.buffer = noiseBuffer(2.2, true); nf.type = "lowpass"; nf.Q.value = 2;
      nf.frequency.setValueAtTime(1400, t + 0.25); nf.frequency.exponentialRampToValueAtTime(120, t + 2.1);
      ng.gain.setValueAtTime(0, t + 0.2); ng.gain.linearRampToValueAtTime(0.5, t + 0.45); ng.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      n.connect(nf).connect(ng).connect(master); n.start(t + 0.2);
      const o = ctx.createOscillator(), og = ctx.createGain();                                     // 往下沉的低音
      o.type = "triangle"; o.frequency.setValueAtTime(220, t + 0.25); o.frequency.exponentialRampToValueAtTime(48, t + 2);
      og.gain.setValueAtTime(0, t + 0.25); og.gain.linearRampToValueAtTime(0.12, t + 0.4); og.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
      o.connect(og).connect(master); o.start(t + 0.25); o.stop(t + 2.2);
      [1318.5, 1975.5].forEach((f, i) => {                                                          // 清鈴
        const b = ctx.createOscillator(), bg = ctx.createGain(), bt = t + 2.1;
        b.type = "sine"; b.frequency.value = f;
        bg.gain.setValueAtTime(0, bt); bg.gain.linearRampToValueAtTime(i ? 0.03 : 0.07, bt + 0.01); bg.gain.exponentialRampToValueAtTime(0.0008, bt + 3);
        b.connect(bg).connect(master); b.start(bt); b.stop(bt + 3.1);
      });
    },
    // 殺錯真人：沉重的不和諧重音＋悶擊＋幾滴血
    killReal() {
      if (!ctx) return;
      const t = ctx.currentTime;
      cutDread(t);
      [55, 58.3, 82.4, 116.5].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = i < 2 ? "sawtooth" : "triangle"; o.frequency.value = fq; f.type = "lowpass"; f.frequency.value = 900;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 5);
        o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 5.1);
      });
      thump(t, 45, 1.3); thump(t + 0.35, 38, 1.0);
      [1.2, 1.9, 2.5, 3.4].forEach(d => {                                                          // 血滴
        const o = ctx.createOscillator(), g = ctx.createGain(), dt = t + d;
        o.type = "sine"; o.frequency.setValueAtTime(950, dt); o.frequency.exponentialRampToValueAtTime(420, dt + 0.07);
        g.gain.setValueAtTime(0.09, dt); g.gain.exponentialRampToValueAtTime(0.001, dt + 0.12);
        o.connect(g).connect(master); o.start(dt); o.stop(dt + 0.13);
      });
    },
    // 身旁的人倒抽一口氣。voices＝在場的人的聲音類型（"m" 男、"f" 女、"c" 小孩、"old_m"／"old_f" 老人、"mute" 只有氣音），最多四層
    // heavy＝殺錯人時更長、更重，女人和小孩會帶出一點短促的叫聲
    // 放了 assets/audio/gasp.mp3 就改播那個檔
    gasp(voices, heavy) {
      if (!ctx || !voices || !voices.length) return;
      const t0 = ctx.currentTime + (heavy ? 0.5 : 0.7);
      if (gaspFile) { gaspFile.currentTime = 0; gaspFile.volume = Math.min(1, 0.5 * vol.sfx * (heavy ? 1.2 : 1)); gaspFile.play().catch(() => {}); return; }
      // 每種聲音：氣音的口腔共鳴（起→終）、喉音的音高、喉音大小
      const V = {
        m:     { f: [550, 900],   to: [950, 1300],  p: [105, 135], voice: 0.05 },
        old_m: { f: [500, 800],   to: [850, 1150],  p: [95, 120],  voice: 0.035, rasp: true },
        f:     { f: [900, 1300],  to: [1450, 2000], p: [210, 270], voice: 0.06 },
        old_f: { f: [800, 1150],  to: [1250, 1700], p: [180, 220], voice: 0.04, rasp: true },
        c:     { f: [1200, 1600], to: [1900, 2500], p: [300, 380], voice: 0.07 },
        mute:  { f: [700, 1000],  to: [1000, 1300], p: [0, 0],     voice: 0 }
      };
      const r = ([a, b]) => a + Math.random() * (b - a);
      voices.slice().sort(() => Math.random() - 0.5).slice(0, 4).forEach((k, i) => {
        const v = V[k] || V.m, t = t0 + i * (0.05 + Math.random() * 0.09);
        const len = (heavy ? 0.75 : 0.5) + Math.random() * 0.2 - (k === "c" ? 0.1 : 0), lv = 1 / Math.sqrt(i + 1) * (k === "mute" ? 0.5 : 1);
        const f0 = r(v.f), f1v = r(v.to);
        // 氣音
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer(len + 0.1);
        const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain();
        f1.type = "bandpass"; f1.Q.value = v.rasp ? 3 : 5; f1.frequency.setValueAtTime(f0, t); f1.frequency.linearRampToValueAtTime(f1v, t + len);   // 吸氣時口型張開
        f2.type = "highpass"; f2.frequency.value = k === "m" || k === "old_m" ? 250 : 450;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime((heavy ? 0.42 : 0.3) * lv, t + 0.07);
        g.gain.setValueAtTime((heavy ? 0.38 : 0.26) * lv, t + len * 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + len);
        src.connect(f1).connect(f2).connect(g).connect(master); src.start(t);
        // 喉音：聽得出男女老少的那一點「啊」，音高往上揚
        if (v.voice) {
          const o = ctx.createOscillator(), of = ctx.createBiquadFilter(), og = ctx.createGain(), p0 = r(v.p);
          o.type = "sawtooth"; o.frequency.setValueAtTime(p0, t + 0.03); o.frequency.exponentialRampToValueAtTime(p0 * (heavy ? 1.45 : 1.25), t + len * 0.7);
          if (v.rasp) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 23; lg.gain.value = p0 * 0.04; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + len + 0.1); }
          of.type = "bandpass"; of.Q.value = 2.5; of.frequency.setValueAtTime(f0, t); of.frequency.linearRampToValueAtTime(f1v, t + len);
          const cry = heavy && (k === "f" || k === "c") ? 1.8 : 1;                 // 殺錯人：女人小孩短促地叫出聲
          og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(v.voice * cry * lv, t + 0.09); og.gain.exponentialRampToValueAtTime(0.001, t + len * (cry > 1 ? 0.95 : 0.7));
          o.connect(of).connect(og).connect(master); o.start(t); o.stop(t + len + 0.1);
        }
      });
    },
    // 識破那一刻：低音重擊＋一聲尖嘯滑上去
    reveal() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [55, 58.3, 77.8, 82.4].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.value = fq; f.type = "lowpass"; f.frequency.value = 1100;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
        o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 3.6);
      });
      const s = ctx.createOscillator(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
      s.type = "sawtooth"; s.frequency.setValueAtTime(320, t); s.frequency.exponentialRampToValueAtTime(1500, t + 0.9);
      sf.type = "bandpass"; sf.frequency.value = 1600; sf.Q.value = 3;
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.16, t + 0.5); sg.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      s.connect(sf).connect(sg).connect(master); s.start(t); s.stop(t + 1.5);
      thump(t, 42, 1.3);
    },
    knock() { if (!ctx) return; const t = ctx.currentTime + 0.05; [0, 0.32, 0.64].forEach(d => thump(t + d)); },
    door() { if (!ctx) return; thump(ctx.currentTime + 0.02, 55, 1); },
    lamp() {
      if (!ctx) return;
      const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(), t = ctx.currentTime;
      n.buffer = noiseBuffer(0.6); f.type = "bandpass"; f.frequency.value = 700;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      n.connect(f).connect(g).connect(master); n.start(t);
    },
    sting() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [55, 58.3, 82.4, 116.5].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i < 2 ? "sawtooth" : "triangle"; o.frequency.value = fq;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 4);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
        o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 4.1);
      });
      thump(t, 45, 1.2);
    },
    // 小嚇：短促的尖銳刮擦聲＋重擊
    jolt() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.35);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.45);
      thump(t, 60, 1.3);
    },
    // 音量：0～1，會記在瀏覽器裡
    getVolume() { return { ...vol }; },
    setVolume(kind, v) {
      vol[kind] = Math.max(0, Math.min(1, v));
      try { localStorage.setItem("louke_volume", JSON.stringify(vol)); } catch (e) {}
      if (!ctx) return;
      (kind === "music" ? musicMaster : master).gain.setTargetAtTime(vol[kind], ctx.currentTime, 0.05);
      if (fileMusic) setAmbience(mode);
    }
  };
})();
