/* ==========================================================================
   隔空手势模块 · GestureMediaPipe
   --------------------------------------------------------------------------
   独立增量模块：不修改原有 CONFIG / SCENES / ACTIONS / WebAudio / 农历逻辑，
   只作为"额外输入方式"：
     · 左手（handedness = Left）指尖位移  → 调用 window.__pingu.doAction()
     · 右手（handedness = Right）横向滑动 → 调用 window.__pingu.nextCharacter(±1)

   依赖：MediaPipe Hands（CDN：hands.js + wasm 资源）
   生效条件：HTTPS / localhost 且浏览器支持摄像头；http 下按钮自动隐藏。
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- 可调参数 ---------------- */
  var CFG = {
    CDN: [
      "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/",
      "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/",
      "https://unpkg.com/@mediapipe/hands@0.4.1646424915/",
      "https://cdn.jsdelivr.net/npm/@mediapipe/hands/"
    ],

    SWAP_HANDS: false,      // 如果左右手识别反了：改成 true
    INVERT_SWIPE: false,    // 如果右手滑动方向反了：改成 true

    /* 防误识别：只有"像真手、并且确实在动"才触发 */
    MIN_HAND_SCORE: 0.45,        // handedness 置信度（实测真实举手常只有 0.5 左右）
    HAND_MIN_SPAN: 0.06,         // 手腕→中指根至少占画面 6%
    HAND_MAX_SPAN: 0.9,
    HAND_CONFIRM_FRAMES: 3,      // 连续 3 帧都检测到同一只手才算数
    HAND_CENTER_MARGIN: 0.06,    // 手要在画面中间区域（排除画面边缘拿手机的手）
    FINGER_MIN: 2,               // 至少 2 根手指伸展（张开手掌才算"准备好了"）
    ARM_FRAMES: 8,               // 连续 8 帧合格后才"就绪"（约 0.3 秒）
    ARM_IDLE_RESET_MS: 700,      // 手离开画面 0.7 秒后解除就绪、需要重新举手

    LEFT_MOVE_THRESHOLD: 0.09,   // 左手指尖 240ms 内位移超过画面 9%
    LEFT_WINDOW_MS: 240,
    LEFT_SHORT_MS: 80,           // 短窗口：确认此刻还在往同一方向动
    LEFT_SHORT_MIN: 0.02,
    LEFT_COOLDOWN_MS: 600,       // 左手防抖冷却（按要求 0.6s）

    RIGHT_SWIPE_X: 0.16,         // 右手横向滑动阈值（画面宽度 16%）
    RIGHT_WINDOW_MS: 380,        // 滑动观察窗口
    RIGHT_SHORT_MS: 90,
    RIGHT_SHORT_MIN: 0.02,
    RIGHT_COOLDOWN_MS: 700,      // 右手切换冷却

    HAND_SETTLE_MS: 350,         // 手刚进入画面先稳定，避免抬手被误判
    SEND_INTERVAL_MS: 45,        // 送帧节流 ≈22fps
    MAX_NUM_HANDS: 2,
    SELFIE_MODE: true,
    MODEL_COMPLEXITY: 0,

    /* 本地 MediaPipe Tasks Vision（来自 bloom-gesture-kit，Apache-2.0）
       优先用本地模型（不依赖 CDN），失败再回退旧版 CDN Hands */
    TASKS_BUNDLE: "./gesture/lib/vision_bundle.mjs",
    TASKS_WASM: "./gesture/lib/wasm/",
    TASKS_MODEL: "./gesture/models/hand_landmarker.task"
  };

  var TIP = 8;  // 食指指尖
  var HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
  ];
  var API = { active: false, starting: false, error: "" };
  var els = {};
  var hands = null;
  var landmarker = null;
  var engine = "";       // "tasks" | "legacy"
  var stream = null;
  var rafId = 0;
  var lastSend = 0;
  var cdnBase = "";
  var session = 0;
  var firstResultShown = false;
  var lastLeft = 0, lastRight = 0;
  var lastHint = 0;
  var tracks = {
    Left:  { samples: [], visible: false, seenAt: 0, enterAt: 0, frames: 0, armed: false },
    Right: { samples: [], visible: false, seenAt: 0, enterAt: 0, frames: 0, armed: false }
  };
  var initWatchdog = 0;
  var startGuard = 0;
  var resultCount = 0;
  var startedAt = 0;

  function byId(id) { return document.getElementById(id); }
  function now() { return performance.now(); }

  /* ---------------- MediaPipe 资源加载兼容层 ----------------
     旧版 hands.js 会动态注入 wasm/资源脚本；个别浏览器/网络下资源加载器
     会先拿到一个只有 locateFile 的对象，导致读取 .data 资源时报
     "Cannot read properties of undefined"。这里给全局对象补上
     packedAssets / getPreloadedPackage，让它安全回退到普通 XHR 下载。
     （正常环境下此补丁无副作用） */
  function installAssetShim() {
    try {
      var real = undefined;
      Object.defineProperty(window, "createMediapipeSolutionsPackedAssets", {
        configurable: true,
        get: function () { return real; },
        set: function (v) {
          try {
            v = v || {};
            if (!v.packedAssets) v.packedAssets = {};
            if (typeof v.getPreloadedPackage !== "function") {
              v.getPreloadedPackage = function () { return null; };
            }
          } catch (e) {}
          real = v;
        }
      });
    } catch (e) {}
    try {
      if (!window.createMediapipeSolutionsWasm) window.createMediapipeSolutionsWasm = {};
    } catch (e) {}
  }

  /* ---------------- 环境判断 ---------------- */
  function supported() {
    return !!(window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function");
  }

  /* ---------------- 注入 UI（新增元素，不改原有 DOM 结构） ---------------- */
  function injectUI() {
    var style = document.createElement("style");
    style.textContent = [
      ".g-btn{flex:none;width:58px;height:58px;border-radius:18px;border:1px solid rgba(255,255,255,.65);",
      "background:rgba(255,255,255,.55);color:inherit;font-family:inherit;font-weight:800;font-size:10px;",
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;",
      "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:.2s;padding:0;margin-left:2px;}",
      ".g-btn:active{transform:scale(.94)}",
      ".g-btn .g-ico{font-size:19px;line-height:1}",
      ".g-btn.on{background:#2fbf71;color:#fff;border-color:rgba(255,255,255,.85);box-shadow:0 6px 18px rgba(47,191,113,.45)}",
      ".g-btn.on .g-ico{animation:gPulse 1.4s ease-in-out infinite}",
      ".g-btn.busy{opacity:.6;pointer-events:none}",
      "@keyframes gPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}",
      ".g-cam{position:absolute;top:6px;right:6px;z-index:9;width:104px;height:78px;border-radius:14px;overflow:hidden;",
      "background:#000;border:2px solid rgba(255,255,255,.75);box-shadow:0 8px 20px rgba(0,0,0,.28);}",
      ".g-cam video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:block}",
      ".g-cam canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}",
      ".g-cam .g-hint{position:absolute;left:0;right:0;bottom:0;font-size:9px;font-weight:800;color:#fff;",
      "background:rgba(0,0,0,.45);text-align:center;padding:2px 0;letter-spacing:.3px;white-space:nowrap;overflow:hidden}",
      ".g-msg{position:fixed;left:50%;bottom:29%;transform:translate(-50%,8px);z-index:40;max-width:86vw;",
      "background:rgba(30,24,20,.92);color:#fff;font-size:12px;font-weight:700;line-height:1.4;padding:9px 15px;",
      "border-radius:14px;opacity:0;pointer-events:none;transition:.25s;text-align:center;white-space:pre-line}",
      ".g-msg.show{opacity:1;transform:translate(-50%,0)}",
      "@media (max-width:345px){.g-btn{width:48px;height:48px;border-radius:15px;font-size:9px}.g-cam{width:86px;height:66px}}",
      "@media (orientation:landscape) and (max-height:520px){.g-btn{width:46px;height:46px}.g-cam{width:88px;height:66px}}"
    ].join("");
    document.head.appendChild(style);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "gestureBtn";
    btn.className = "g-btn";
    btn.hidden = true;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "开启隔空手势");
    btn.innerHTML = '<span class="g-ico">✋</span><span class="g-txt">隔空</span>';
    (byId("hudRow") || document.body).appendChild(btn);

    var cam = document.createElement("div");
    cam.id = "gestureCam";
    cam.className = "g-cam";
    cam.hidden = true;
    cam.innerHTML = '<video id="gestureVideo" muted playsinline autoplay></video><canvas id="gestureCanvas"></canvas><span class="g-hint">举起手试试</span>';
    byId("stageWrap").appendChild(cam);

    var msg = document.createElement("div");
    msg.id = "gestureMsg";
    msg.className = "g-msg";
    document.body.appendChild(msg);

    els.btn = btn;
    els.cam = cam;
    els.video = byId("gestureVideo");
    els.canvas = byId("gestureCanvas");
    els.ctx2d = els.canvas.getContext("2d");
    els.hint = cam.querySelector(".g-hint");
    els.msg = msg;
  }

  function setBtn(mode) {
    if (!els.btn) return;
    els.btn.classList.toggle("on", mode === "on");
    els.btn.classList.toggle("busy", mode === "busy");
    els.btn.setAttribute("aria-pressed", mode === "on" ? "true" : "false");
    els.btn.setAttribute("aria-label", mode === "on" ? "关闭隔空手势" : "开启隔空手势");
    var txt = els.btn.querySelector(".g-txt");
    if (txt) txt.textContent = mode === "on" ? "关闭" : (mode === "busy" ? "启动中" : "隔空");
  }

  function say(text, ms) {
    if (!els.msg) return;
    els.msg.textContent = text;
    els.msg.classList.add("show");
    clearTimeout(say._t);
    say._t = setTimeout(function () { els.msg.classList.remove("show"); }, ms || 2600);
  }

  /* 开启后把页面底部提示改成手势说明，关闭时恢复 */
  var originalSwipeHint = null;
  function setFooterHint(text) {
    var el = document.getElementById("swipeHint");
    if (!el) return;
    if (originalSwipeHint === null) originalSwipeHint = el.textContent;
    el.textContent = text;
  }
  function restoreFooterHint() {
    var el = document.getElementById("swipeHint");
    if (el && originalSwipeHint !== null) el.textContent = originalSwipeHint;
  }

  /* ---------------- 加载 MediaPipe Hands ---------------- */
  function loadScript(base) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var s = document.createElement("script");
      s.src = base + "hands.js";
      s.async = true;
      function finish(ok, err) {
        if (done) return;
        done = true;
        if (ok) resolve(base);
        else reject(err || new Error("加载失败"));
      }
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false, new Error("无法加载 " + s.src)); };
      // 网络被拦截时 onerror 可能不触发，这里兜一个超时
      setTimeout(function () { finish(false, new Error("加载超时：cdn.jsdelivr.net 访问不了")); }, 9000);
      document.head.appendChild(s);
    });
  }

  function loadMediaPipe() {
    if (typeof window.Hands === "function") {
      return Promise.resolve(cdnBase || CFG.CDN[0]);
    }
    var i = 0;
    function next() {
      if (i >= CFG.CDN.length) return Promise.reject(new Error("手势模型加载失败，请检查网络"));
      var base = CFG.CDN[i++];
      return loadScript(base).catch(function () { return next(); });
    }
    return next();
  }

  function waitVideoReady(video) {
    return new Promise(function (resolve) {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      var done = false;
      function go() { if (!done) { done = true; resolve(); } }
      video.addEventListener("loadeddata", go, { once: true });
      setTimeout(go, 4000);
    });
  }

  function protocolHint() {
    if (location.protocol === "file:") {
      return "\n当前是 file:// 直接打开，浏览器会限制手势模型加载。\n请双击「启动手机版.bat」，改用 http://127.0.0.1:8000 打开；手机使用 https 网址。";
    }
    return "\n请确认网络能访问 cdn.jsdelivr.net；也可以刷新页面后再试。";
  }

  function fail(msg, long) {
    API.error = msg;
    cleanup();
    setBtn("off");
    say("开启失败：" + msg + (long === false ? "" : protocolHint()), long === false ? 4200 : 9000);
  }

  /* ---------------- 启动 / 关闭 ---------------- */
  function start() {
    if (API.active || API.starting) return;
    if (!supported()) { say("隔空手势需要 HTTPS 或 localhost 环境"); return; }
    if (typeof window.__pingu === "undefined") { say("页面还没准备好，请稍后再试"); return; }

    var my = ++session;
    API.starting = true;
    API.error = "";
    resultCount = 0;
    setBtn("busy");
    say("正在启动摄像头并加载手势模型…", 60000);
    installAssetShim();
    clearTimeout(startGuard);
    startGuard = setTimeout(function () {
      if (my === session && API.starting) {
        fail("加载超时（本地模型或网络异常）");
      }
    }, 25000);

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    })
      .then(function (s) {
        if (my !== session) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
        stream = s;
        els.cam.hidden = false;
        els.video.srcObject = s;
        return els.video.play();
      })
      .then(function () {
        if (my !== session) return;
        return waitVideoReady(els.video);
      })
      .then(function () {
        if (my !== session) return;
        return initEngine();
      })
      .then(function () {
        if (my !== session) return;
        API.active = true;
        API.starting = false;
        startedAt = now();
        els.cam.hidden = false;
        sizeCanvas();
        setBtn("on");
        var uaWarn = /MicroMessenger|QQBrowser|Quark|UCBrowser|baidubrowser|; wv\)/i.test(navigator.userAgent)
          ? "\n\n⚠️ 检测到你在 App 内置浏览器里，手势识别可能不稳定，建议用 Chrome / Edge / Safari 打开。"
          : "";
        say("隔空手势已开启\n① 左手：张开手掌举到画面中间，动动手指 = Pingu 做动作\n② 右手：张开手掌，从左往右（或从右往左）滑一下 = 换下一只" + uaWarn, 12000);
        setFooterHint("左手动指=动作 · 右手横滑=换一只");
        startWatchdog(my);
        pump();
      })
      .catch(function (err) {
        if (my !== session) return;
        console.warn("[gesture]", err);
        var msg = (err && err.message) || "启动失败";
        // 常见错误翻译成更好懂的话
        if (/Permission|NotAllowed/i.test(msg)) msg = "摄像头权限被拒绝，请在浏览器地址栏允许摄像头";
        else if (/NotFound|Requested device/i.test(msg)) msg = "没有找到摄像头";
        else if (/packed_assets|Cannot read properties/i.test(msg)) msg = "手势模型资源加载失败（网络或 file:// 限制）";
        fail(msg);
      });  }

  /* ---------------- 手势引擎：优先本地 Tasks Vision，失败回退 CDN Hands ---------------- */
  function absoluteURL(p) {
    try { return new URL(p, location.href).href; } catch (e) { return p; }
  }

  function initEngine() {
    return initTasks().catch(function (err) {
      console.warn("[gesture] Tasks Vision 不可用，回退 CDN Hands:", err && err.message);
      return initLegacy();
    });
  }

  function initTasks() {
    return import(absoluteURL(CFG.TASKS_BUNDLE)).then(function (mod) {
      if (!mod || !mod.FilesetResolver || !mod.HandLandmarker) throw new Error("Tasks Vision 模块无效");
      return mod.FilesetResolver.forVisionTasks(absoluteURL(CFG.TASKS_WASM)).then(function (fileset) {
        var options = {
          baseOptions: {
            modelAssetPath: absoluteURL(CFG.TASKS_MODEL),
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: CFG.MAX_NUM_HANDS,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        };
        return mod.HandLandmarker.createFromOptions(fileset, options).catch(function () {
          options.baseOptions.delegate = "CPU";
          return mod.HandLandmarker.createFromOptions(fileset, options);
        }).then(function (lm) {
          landmarker = lm;
          engine = "tasks";
        });
      });
    });
  }

  function initLegacy() {
    return loadMediaPipe().then(function (base) {
      cdnBase = base;
      if (typeof window.Hands !== "function") throw new Error("MediaPipe 初始化失败（CDN 脚本没执行）");
      hands = new window.Hands({ locateFile: function (file) { return cdnBase + file; } });
      hands.setOptions({
        maxNumHands: CFG.MAX_NUM_HANDS,
        modelComplexity: CFG.MODEL_COMPLEXITY,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
        selfieMode: CFG.SELFIE_MODE
      });
      hands.onResults(onResults);
      engine = "legacy";
      return (typeof hands.initialize === "function") ? hands.initialize() : null;
    });
  }

  function startWatchdog(my) {
    clearTimeout(initWatchdog);
    initWatchdog = setTimeout(function () {
      if (my !== session || !API.active) return;
      if (resultCount > 0) return;
      fail("手势模型没有返回结果", false);
      say("手势模型已加载，但一直没有识别结果。\n请把整只手放进画面、光线亮一点；如果还不行，换 Chrome 或检查网络后刷新重试。", 9000);
    }, 18000);
  }

  function cleanup() {
    API.active = false;
    API.starting = false;
    clearTimeout(initWatchdog);
    clearTimeout(startGuard);
    restoreFooterHint();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    try { if (hands && hands.close) hands.close(); } catch (e) {}
    hands = null;
    try { if (landmarker && landmarker.close) landmarker.close(); } catch (e) {}
    landmarker = null;
    engine = "";
    if (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      stream = null;
    }
    if (els.video) { try { els.video.srcObject = null; } catch (e) {} }
    if (els.cam) els.cam.hidden = true;
    resetTrack(tracks.Left);
    resetTrack(tracks.Right);
    firstResultShown = false;
  }

  function resetTrack(st) {
    st.samples.length = 0;
    st.visible = false;
    st.enterAt = 0;
    st.frames = 0;
    st.armed = false;
  }

  function stop() {
    if (!API.active && !API.starting) return;
    session++;
    cleanup();
    setBtn("off");
    say("已关闭隔空手势，点击圆盘玩法照旧", 2600);
  }

  /* ---------------- 送帧 ---------------- */
  function pump() {
    if (!API.active) return;
    rafId = requestAnimationFrame(pump);
    if (document.hidden) return;
    var v = els.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    var t = now();
    if (t - lastSend < CFG.SEND_INTERVAL_MS) return;
    lastSend = t;
    try {
      if (engine === "legacy" && hands) {
        var p = hands.send({ image: v });
        if (p && p.catch) p.catch(function () {});
      } else if (engine === "tasks" && landmarker) {
        var res = landmarker.detectForVideo(v, performance.now());
        if (res) {
          var mapped = (res.handednesses || []).map(function (h) {
            var c = (h && h[0]) || h || {};
            return { label: c.categoryName || c.label, score: c.score };
          });
          onResults({ multiHandLandmarks: res.landmarks || [], multiHandedness: mapped });
        }
      }
    } catch (e) {
      console.warn("[gesture] detect error", e && e.message);
    }
  }

  /* ---------------- 识别结果 ---------------- */
  function d2(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* 数一数有几根手指是伸开的（张开手掌） */
  function fingersExtended(lm) {
    var wrist = lm[0], n = 0;
    var pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
    for (var i = 0; i < pairs.length; i++) {
      var tip = lm[pairs[i][0]], pip = lm[pairs[i][1]];
      if (d2(tip, wrist) > d2(pip, wrist) * 1.12) n++;
    }
    if (d2(lm[4], wrist) > d2(lm[2], wrist) * 1.05) n++;  // 大拇指
    return n;
  }

  /* 是不是"真的有一只手举在画面中间"（过滤误检 / 画面边缘的手） */
  function handOk(lm, hd) {
    if (!hd || hd.score < CFG.MIN_HAND_SCORE) return false;
    var span = d2(lm[0], lm[9]);              // 手腕 → 中指根
    if (span < CFG.HAND_MIN_SPAN || span > CFG.HAND_MAX_SPAN) return false;
    if (fingersExtended(lm) < CFG.FINGER_MIN) return false;  // 没张开手掌不算
    var cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
    var cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
    var m = CFG.HAND_CENTER_MARGIN;
    if (cx < m || cx > 1 - m) return false;
    if (cy < 0.08 || cy > 0.92) return false; // 太靠上/太靠下（比如拿手机的手）都不算
    for (var i = 0; i < 21; i++) {
      if (lm[i].x < -0.04 || lm[i].x > 1.04 || lm[i].y < -0.04 || lm[i].y > 1.04) return false;
    }
    return true;
  }

  /* ---------------- 小窗里的手部骨架（让弟弟看到"识别到了哪只手"） ---------------- */
  function sizeCanvas() {
    if (!els.canvas || !els.cam) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.canvas.width = Math.round((els.cam.clientWidth || 104) * dpr);
    els.canvas.height = Math.round((els.cam.clientHeight || 78) * dpr);
  }
  function drawHands(hands) {
    if (!els.ctx2d || !els.canvas) return;
    var c = els.ctx2d, W = els.canvas.width, H = els.canvas.height;
    c.clearRect(0, 0, W, H);
    for (var k = 0; k < hands.length; k++) {
      var lm = hands[k].lm, label = hands[k].label, ok = hands[k].ok;
      var color = !ok ? "rgba(255,255,255,.45)"
        : (label === "Left" ? "#7bdff2" : "#ffd166");
      c.strokeStyle = color; c.lineWidth = Math.max(1.5, W / 90); c.globalAlpha = .95;
      for (var i = 0; i < HAND_CONNECTIONS.length; i++) {
        var a = lm[HAND_CONNECTIONS[i][0]], b = lm[HAND_CONNECTIONS[i][1]];
        c.beginPath();
        c.moveTo((1 - a.x) * W, a.y * H);   // 视频是镜像显示的，坐标也镜像
        c.lineTo((1 - b.x) * W, b.y * H);
        c.stroke();
      }
      c.fillStyle = color;
      for (var j = 0; j < lm.length; j++) {
        c.beginPath();
        c.arc((1 - lm[j].x) * W, lm[j].y * H, Math.max(1.2, W / 110), 0, 6.283);
        c.fill();
      }
      c.globalAlpha = 1;
      c.font = "bold " + Math.round(W / 12) + "px system-ui,sans-serif";
      c.fillStyle = color;
      var mark = label === "Left" ? "左" : (label === "Right" ? "右" : "?");
      c.fillText(mark, (1 - lm[0].x) * W - W / 12, Math.max(12, lm[0].y * H + H / 8));
    }
  }

  function onResults(res) {
    if (!res || !res.multiHandLandmarks) return;
    resultCount++;
    clearTimeout(initWatchdog);
    if (!firstResultShown) {
      firstResultShown = true;
      say("已识别摄像头画面，举起手掌试试 ✋", 2600);
    }
    var t = now();
    var seenLeft = false, seenRight = false;
    var drawn = [], rawCount = 0, okCount = 0;

    for (var i = 0; i < res.multiHandLandmarks.length; i++) {
      var lm = res.multiHandLandmarks[i];
      if (!lm || lm.length < 21) continue;
      rawCount++;
      var hd = res.multiHandedness && res.multiHandedness[i];
      var label = hd && (hd.label || hd.categoryName) ? (hd.label || hd.categoryName) : "?";
      if (label !== "?") {
        if (CFG.SWAP_HANDS) label = (label === "Left") ? "Right" : "Left";
        drawn.push({ lm: lm, label: label, ok: handOk(lm, hd) });
      }
      if (!handOk(lm, hd)) continue;           // 不像真手 → 不参与触发
      okCount++;
      if (label === "Left") { seenLeft = true; trackLeft(lm, t); }
      else if (label === "Right") { seenRight = true; trackRight(lm, t); }
    }
    drawHands(drawn);

    if (!seenLeft && t - tracks.Left.seenAt > CFG.ARM_IDLE_RESET_MS) resetTrack(tracks.Left);
    if (!seenRight && t - tracks.Right.seenAt > CFG.ARM_IDLE_RESET_MS) resetTrack(tracks.Right);

    if (t - lastHint > 220) {
      lastHint = t;
      var L = tracks.Left, R = tracks.Right;
      if (resultCount === 0) {
        els.hint.textContent = (startedAt && now() - startedAt > 8000)
          ? "模型没出结果 · 换 Chrome 试试"
          : "模型启动中…";
      } else if (rawCount === 0) {
        els.hint.textContent = "举起手掌试试";
      } else if (okCount === 0) {
        els.hint.textContent = "手靠近一点，张开手掌";
      } else if (!L.armed && !R.armed) {
        els.hint.textContent = "保持手掌 0.3 秒…";
      } else if (L.armed && R.armed) {
        els.hint.textContent = "双手就绪 ✓";
      } else if (L.armed) {
        els.hint.textContent = "左手 ✓ 动动手指";
      } else {
        els.hint.textContent = "右手 ✓ 横向滑";
      }
    }
  }

  /* ---------------- 左手：指尖位移 ---------------- */
  function pushSample(st, x, y, t) {
    st.samples.push({ t: t, x: x, y: y });
    var cut = t - 900;
    while (st.samples.length && st.samples[0].t < cut) st.samples.shift();
  }

  function sampleNear(st, target, tol) {
    var best = null, bd = 1e9;
    for (var i = 0; i < st.samples.length; i++) {
      var d = Math.abs(st.samples[i].t - target);
      if (d < bd) { bd = d; best = st.samples[i]; }
    }
    return (best && bd <= tol) ? best : null;
  }

  function trackLeft(lm, t) {
    var st = tracks.Left;
    var p = lm[TIP];
    pushSample(st, p.x, p.y, t);
    st.seenAt = t;
    st.frames = (st.frames || 0) + 1;
    if (!st.visible) { st.visible = true; st.enterAt = t; return; }
    if (st.frames < CFG.ARM_FRAMES) return;          // 先"举手就绪"
    if (t - st.enterAt < CFG.HAND_SETTLE_MS) return;
    st.armed = true;
    if (t - lastLeft < CFG.LEFT_COOLDOWN_MS) return;
    var ref = sampleNear(st, t - CFG.LEFT_WINDOW_MS, 150);
    var near = sampleNear(st, t - CFG.LEFT_SHORT_MS, 80);
    if (!ref || !near) return;
    var dx = p.x - ref.x, dy = p.y - ref.y;
    var sx = p.x - near.x, sy = p.y - near.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    var slen = Math.sqrt(sx * sx + sy * sy);
    // 长窗口要够远、短窗口还在往同一方向动（排除关键点抖动造成的假动作）
    if (len > CFG.LEFT_MOVE_THRESHOLD && slen > CFG.LEFT_SHORT_MIN && (dx * sx + dy * sy) > 0) {
      lastLeft = t;
      fireLeft();
    }
  }

  /* ---------------- 右手：横向滑动 ---------------- */
  function trackRight(lm, t) {
    var st = tracks.Right;
    var p = lm[TIP];
    pushSample(st, p.x, p.y, t);
    st.seenAt = t;
    st.frames = (st.frames || 0) + 1;
    if (!st.visible) { st.visible = true; st.enterAt = t; return; }
    if (st.frames < CFG.ARM_FRAMES) return;
    if (t - st.enterAt < CFG.HAND_SETTLE_MS) return;
    st.armed = true;
    if (t - lastRight < CFG.RIGHT_COOLDOWN_MS) return;
    var ref = sampleNear(st, t - CFG.RIGHT_WINDOW_MS, 200);
    var near = sampleNear(st, t - CFG.RIGHT_SHORT_MS, 90);
    if (!ref || !near) return;
    var dx = p.x - ref.x, dy = p.y - ref.y;
    var sx = p.x - near.x;
    if (Math.abs(dx) > CFG.RIGHT_SWIPE_X && Math.abs(dx) > Math.abs(dy) * 1.8
        && Math.abs(sx) > CFG.RIGHT_SHORT_MIN && (sx * dx) > 0) {
      lastRight = t;
      fireRight(dx);
    }
  }

  /* ---------------- 调用原有逻辑（只读调用，不改原代码） ---------------- */
  function fireLeft() {
    var api = window.__pingu;
    if (!api || !api.doAction) return;
    api.doAction();                 // 等价于点击左下圆盘：A/B 动作切换
    if (els.hint) els.hint.textContent = "左手 · 动作";
  }

  function fireRight(dx) {
    var api = window.__pingu;
    if (!api || !api.nextCharacter) return;
    var dir = dx > 0 ? 1 : -1;
    if (CFG.INVERT_SWIPE) dir = -dir;
    api.nextCharacter(dir);         // 等价于右手滑动：切下一只 Pingu
    if (els.hint) els.hint.textContent = dir > 0 ? "右手 · 下一只 →" : "← 右手 · 上一只";
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    installAssetShim();
    injectUI();
    if (!supported()) {
      if (els.btn) els.btn.hidden = true;  // http：自动隐藏，原玩法不受影响
      return;
    }
    els.btn.hidden = false;
    els.btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (API.active || API.starting) stop();
      else start();
    });
    window.addEventListener("resize", function () { if (API.active) sizeCanvas(); });
    // MediaPipe 资源加载器偶尔会异步抛错，这里单独兜住，给出可理解的提示
    window.addEventListener("error", function (ev) {
      var msg = (ev && (ev.message || "")) + "";
      if (/hands_solution|createMediapipe|packed_assets|MediaPipe/i.test(msg)) {
        if (API.starting || API.active) {
          console.warn("[gesture] async asset error:", msg);
          fail("手势模型资源加载失败", false);
          say("手势模型资源加载失败：可能是网络拦截或 file:// 限制。\n请改用本地服务器打开（http://127.0.0.1:8000）或部署到 https 再试。", 9000);
        }
      }
    }, true);
  }

  /* 构造一只"测试用"的手：21 个点按真实手型铺开，便于单元测试 */
  function makeSyntheticHand(x, y) {
    var lm = [];
    for (var i = 0; i < 21; i++) lm.push({ x: x, y: y, z: 0 });
    lm[0] = { x: x - 0.02, y: y + 0.14, z: 0 };                 // 手腕
    lm[1] = { x: x - 0.10, y: y + 0.05, z: 0 };
    lm[2] = { x: x - 0.12, y: y + 0.01, z: 0 };
    lm[3] = { x: x - 0.13, y: y - 0.02, z: 0 };
    lm[4] = { x: x - 0.14, y: y - 0.04, z: 0 };
    lm[5] = { x: x - 0.06, y: y - 0.02, z: 0 };
    lm[6] = { x: x - 0.07, y: y - 0.06, z: 0 };
    lm[7] = { x: x - 0.07, y: y - 0.09, z: 0 };
    lm[8] = { x: x - 0.07, y: y - 0.12, z: 0 };                 // 食指指尖
    lm[9] = { x: x, y: y - 0.02, z: 0 };                        // 中指根
    lm[10] = { x: x, y: y - 0.07, z: 0 };
    lm[11] = { x: x, y: y - 0.10, z: 0 };
    lm[12] = { x: x, y: y - 0.12, z: 0 };
    lm[13] = { x: x + 0.05, y: y - 0.01, z: 0 };
    lm[14] = { x: x + 0.06, y: y - 0.05, z: 0 };
    lm[15] = { x: x + 0.06, y: y - 0.08, z: 0 };
    lm[16] = { x: x + 0.06, y: y - 0.10, z: 0 };
    lm[17] = { x: x + 0.10, y: y + 0.02, z: 0 };
    lm[18] = { x: x + 0.12, y: y - 0.01, z: 0 };
    lm[19] = { x: x + 0.13, y: y - 0.03, z: 0 };
    lm[20] = { x: x + 0.13, y: y - 0.05, z: 0 };
    return lm;
  }

  window.GestureMediaPipe = {
    supported: supported,
    start: start,
    stop: stop,
    config: CFG,
    state: function () {
      return {
        supported: supported(), active: API.active, starting: API.starting, error: API.error,
        left: tracks.Left.visible, right: tracks.Right.visible, cdn: cdnBase,
        results: resultCount, protocol: location.protocol, engine: engine
      };
    },
    // 仅测试用：喂一个归一化坐标（会完整走 handOk 防误识别检查）
    _testFeed: function (label, x, y) {
      var t = now();
      if (CFG.SWAP_HANDS) label = (label === "Left") ? "Right" : "Left";
      var lm = makeSyntheticHand(x, y);
      var hd = { score: 1, label: label };
      if (!handOk(lm, hd)) return false;
      if (label === "Left") trackLeft(lm, t);
      else trackRight(lm, t);
      return true;
    },
    // 仅测试用：构造"不像手"的输入（例如画面边缘、很小），应被拒绝
    _testFeedRaw: function (label, x, y, span) {
      var t = now();
      var lm = [];
      for (var i = 0; i < 21; i++) lm.push({ x: x, y: y, z: 0 });
      lm[0] = { x: x, y: y };
      lm[9] = { x: x, y: y - (span || 0.02) };
      var hd = { score: 0.99, label: label };
      if (!handOk(lm, hd)) return false;
      if (label === "Left") trackLeft(lm, t);
      else trackRight(lm, t);
      return true;
    },
    _resetTest: function () {
      resetTrack(tracks.Left); resetTrack(tracks.Right);
      lastLeft = 0; lastRight = 0;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(init, 0); });
  } else {
    setTimeout(init, 0);
  }
})();
