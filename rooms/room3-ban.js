/* Human Hours Museum v2 · Room 3 · "The Blackout"
   Australia's social media ban for under-16s (took effect Dec. 10, 2025).
   Hero: a giant floating phone whose screen runs a midnight countdown, then every app goes dark.
   Wall: LED news ticker, LOG IN DENIED sign, human/machine readout, two link signs.
   Immersive: scroll-scrubbed 3D story (about 6 screens) ending on black glass.
   Classic script. Registers HH.registerRoom(3, ...). All copy comes from config.js or is neutral UI. */
(function () {
  "use strict";
  if (!window.HH || !HH.registerRoom || !HH.kit) return;

  var kit = HH.kit, T = HH.THEME, F = HH.FONTS;
  var TAU = Math.PI * 2, PI = Math.PI;

  /* ---------------- layout (anchor-local meters) ---------------- */
  var HERO = { x: -1.3, y: 2.12, z: 0.62, yaw: 0.28 };
  var PW = 1.5, PH = 3.0, PT = 0.13;              // phone body
  var SW = 1.38, SH = 2.76, PXM = SW / 512;       // screen (canvas 512 x 1024 design units)
  var RX = 0.95;                                  // left edge of the right-hand column
  var G_ = 7.0;                                   // card gravity
  var SHOW = { zero: 2.7, dark0: 3.1, dark1: 0.28, stamp: 5.9, end: 7.2 };

  var TIMES = [];
  (function () { for (var i = 30; i < 60; i++) TIMES.push("23:59:" + i); TIMES.push("00:00:00"); })();
  var COLS = ["#6aa7ff", "#ff6fd8", "#8dffb0", "#ffa24a", "#ffe14d", "#9d6bff", "#3cecff", "#ff7a7a", "#7ee0ff", "#c7a6ff"];
  var BADGES = [3, 12, 1, 7, 5, 2, 9, 4, 8, 6];

  var S = null; // runtime state for the room (closure, so it works however the engine binds)

  /* ---------------- small helpers ---------------- */
  function str(v) { return v == null ? "" : String(v); }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function hash(n) {
    n = (n << 13) ^ n;
    var m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
    m = (Math.imul(n, m) + 1376312589) & 0x7fffffff;
    return m / 2147483647;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }
  function rrShape(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -PI / 2, 0, false);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, PI / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, PI / 2, PI, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, PI, PI * 1.5, false);
    return s;
  }
  /* right half of a rounded-rect outline, top-center to bottom-center (clockwise) */
  function rrHalf(w, h, r, seg) {
    var pts = [], hw = w / 2, hh = h / 2, i, a;
    pts.push(new THREE.Vector3(0, hh, 0));
    pts.push(new THREE.Vector3(hw - r, hh, 0));
    for (i = 1; i <= seg; i++) { a = PI / 2 - (PI / 2) * i / seg; pts.push(new THREE.Vector3(hw - r + r * Math.cos(a), hh - r + r * Math.sin(a), 0)); }
    pts.push(new THREE.Vector3(hw, -hh + r, 0));
    for (i = 1; i <= seg; i++) { a = -(PI / 2) * i / seg; pts.push(new THREE.Vector3(hw - r + r * Math.cos(a), -hh + r + r * Math.sin(a), 0)); }
    pts.push(new THREE.Vector3(0, -hh, 0));
    return pts;
  }
  function mirrorX(pts) { return pts.map(function (p) { return new THREE.Vector3(-p.x, p.y, p.z); }); }
  function mergeGeos(list) {
    var pos = [], nor = [], uv = [];
    list.forEach(function (g) {
      var ng = g.index ? g.toNonIndexed() : g;
      var p = ng.attributes.position.array, n = ng.attributes.normal.array, u = ng.attributes.uv.array, i;
      for (i = 0; i < p.length; i++) pos.push(p[i]);
      for (i = 0; i < n.length; i++) nor.push(n[i]);
      for (i = 0; i < u.length; i++) uv.push(u[i]);
      if (ng !== g) ng.dispose();
      g.dispose();
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }
  /* corner brackets as one merged geometry */
  function bracketGeo(hx, hy, len, th, z) {
    var parts = [], sx, sy, g;
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (c) {
      sx = c[0]; sy = c[1];
      g = new THREE.BoxGeometry(len, th, th); g.translate(sx * (hx - len / 2), sy * hy, z || 0); parts.push(g);
      g = new THREE.BoxGeometry(th, len, th); g.translate(sx * hx, sy * (hy - len / 2), z || 0); parts.push(g);
    });
    return mergeGeos(parts);
  }
  /* Canvas -> additive plane. worldH = plane height in meters. */
  function canvasMesh(wPx, hPx, worldH, draw, normal) {
    var tex = kit.canvasTexture(wPx, hPx, draw);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending
    });
    mat.toneMapped = false;
    var w = worldH * wPx / hPx;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, worldH), mat);
    mesh.userData.size = { w: w, h: worldH };
    return mesh;
  }
  /* width of the visible text of a single-line kit.neonText mesh (without its glow padding) */
  function ntWidth(m, glow) {
    var s = m.userData.size, pad = Math.ceil((glow == null ? 28 : glow) * 2.2) + 8, H = 160 + 2 * pad;
    return s.w - 2 * (s.h * pad / H);
  }
  function hiddenHit(w, h) { return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ visible: false })); }

  /* ---------------- fallback glyphs (shown only until the logo atlas has loaded) ---------------- */
  function glyph(g, i, cx, cy, r, col) {
    g.save(); g.translate(cx, cy);
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = r * 0.2; g.lineCap = "round"; g.lineJoin = "round";
    var k;
    switch (i % 10) {
      case 0: g.beginPath(); g.arc(0, 0, r * 0.74, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.26, 0, TAU); g.fill(); break;
      case 1: g.beginPath(); g.arc(-r * 0.32, 0, r * 0.5, 0, TAU); g.stroke(); g.beginPath(); g.arc(r * 0.32, 0, r * 0.5, 0, TAU); g.stroke(); break;
      case 2: g.beginPath(); g.moveTo(-r * 0.5, r * 0.62); g.lineTo(0, -r * 0.7); g.lineTo(r * 0.5, r * 0.62); g.closePath(); g.fill(); break;
      case 3: g.beginPath(); for (k = 0; k < 6; k++) { var a = PI / 6 + k * PI / 3; g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); } g.closePath(); g.stroke();
        g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill(); break;
      case 4: g.fillRect(-r * 0.62, -r * 0.5, r * 1.24, r * 0.2); g.fillRect(-r * 0.62, -r * 0.1, r * 0.8, r * 0.2); g.fillRect(-r * 0.62, r * 0.3, r * 1.04, r * 0.2); break;
      case 5: g.beginPath(); g.moveTo(0, -r * 0.78); g.lineTo(r * 0.78, 0); g.lineTo(0, r * 0.78); g.lineTo(-r * 0.78, 0); g.closePath(); g.stroke();
        g.fillRect(-r * 0.16, -r * 0.16, r * 0.32, r * 0.32); break;
      case 6: g.fillRect(-r * 0.14, -r * 0.7, r * 0.28, r * 1.4); g.fillRect(-r * 0.7, -r * 0.14, r * 1.4, r * 0.28); break;
      case 7: g.beginPath(); g.arc(0, -r * 0.18, r * 0.58, PI, 0); g.stroke(); g.beginPath(); g.arc(0, r * 0.3, r * 0.58, 0, PI); g.stroke(); break;
      case 8: g.beginPath(); g.moveTo(-r * 0.6, r * 0.05); g.lineTo(0, -r * 0.45); g.lineTo(r * 0.6, r * 0.05); g.stroke();
        g.beginPath(); g.moveTo(-r * 0.6, r * 0.55); g.lineTo(0, r * 0.05); g.lineTo(r * 0.6, r * 0.55); g.stroke(); break;
      default: for (k = 0; k < 9; k++) { g.beginPath(); g.arc(((k % 3) - 1) * r * 0.5, (((k / 3) | 0) - 1) * r * 0.5, r * 0.12, 0, TAU); g.fill(); }
    }
    g.restore();
  }


  /* ---------------- logo atlas ----------------
     assets/sns-logos.png = 4 x 2 cells of 256 px (Facebook, Instagram, Threads, TikTok / YouTube, X, Twitch, Snapchat).
     ATL.src is a 4 x 3 canvas: cells 0-7 = the png, 8 = Kick and 9 = Reddit (drawn here), 10 = unknown name.
     ATL.dim = src x 0.85 (keeps bloom calm), ATL.grey = dark greyscale (removed accounts).
     Until the png loads (or if it fails) cells 0-7 show abstract fallback tiles. */
  var ATL_NAMES = ["facebook", "instagram", "threads", "tiktok", "youtube", "x", "twitch", "snapchat", "kick", "reddit"];
  var ATL = { started: false, img: null, src: null, dim: null, grey: null, subs: [] };

  function cellOf(name, i) {
    var k = String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]/g, "");
    var c = ATL_NAMES.indexOf(k);
    return c >= 0 ? c : 10;
  }
  function fallbackCell(g, c, x, y) {
    g.save(); g.translate(x, y);
    roundRect(g, 0, 0, 256, 256, 56);
    var gr = g.createLinearGradient(0, 0, 256, 256);
    gr.addColorStop(0, "#3a49b0"); gr.addColorStop(1, "#111850");
    g.fillStyle = gr; g.fill();
    glyph(g, c, 128, 128, 88, COLS[c % COLS.length]);
    g.restore();
  }
  function drawKickCell(g, x, y) {
    g.save(); g.translate(x, y);
    roundRect(g, 0, 0, 256, 256, 56); g.fillStyle = "#0a0a0a"; g.fill();
    g.strokeStyle = "#53fc18"; g.lineWidth = 46; g.lineCap = "butt"; g.lineJoin = "miter";
    g.beginPath(); g.moveTo(88, 52); g.lineTo(88, 204); g.stroke();
    g.beginPath(); g.moveTo(108, 146); g.lineTo(178, 64); g.stroke();
    g.beginPath(); g.moveTo(118, 124); g.lineTo(184, 204); g.stroke();
    g.restore();
  }
  function drawRedditCell(g, x, y) {
    g.save(); g.translate(x, y);
    roundRect(g, 0, 0, 256, 256, 56); g.fillStyle = "#ff4500"; g.fill();
    g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.ellipse(128, 156, 72, 50, 0, 0, TAU); g.fill();
    g.beginPath(); g.arc(58, 130, 17, 0, TAU); g.fill();
    g.beginPath(); g.arc(198, 130, 17, 0, TAU); g.fill();
    g.lineWidth = 9; g.beginPath(); g.moveTo(128, 108); g.lineTo(146, 62); g.lineTo(178, 70); g.stroke();
    g.beginPath(); g.arc(186, 72, 13, 0, TAU); g.fill();
    g.fillStyle = "#ff4500"; g.strokeStyle = "#ff4500";
    g.beginPath(); g.arc(100, 152, 12, 0, TAU); g.fill();
    g.beginPath(); g.arc(156, 152, 12, 0, TAU); g.fill();
    g.lineWidth = 8; g.beginPath(); g.arc(128, 160, 32, 0.25 * PI, 0.75 * PI); g.stroke();
    g.restore();
  }
  function buildAtlas() {
    var i, g;
    if (!ATL.src) {
      ATL.src = document.createElement("canvas"); ATL.src.width = 1024; ATL.src.height = 768;
      ATL.dim = document.createElement("canvas"); ATL.dim.width = 1024; ATL.dim.height = 768;
      ATL.grey = document.createElement("canvas"); ATL.grey.width = 1024; ATL.grey.height = 768;
    }
    g = ATL.src.getContext("2d", { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.clearRect(0, 0, 1024, 768);
    var haveImg = false;
    if (ATL.img) { try { g.drawImage(ATL.img, 0, 0, 1024, 512, 0, 0, 1024, 512); haveImg = true; } catch (e) { haveImg = false; } }
    if (!haveImg) for (i = 0; i < 8; i++) fallbackCell(g, i, (i % 4) * 256, ((i / 4) | 0) * 256);
    drawKickCell(g, 0, 512); drawRedditCell(g, 256, 512); fallbackCell(g, 0, 512, 512);
    // dimmed colour copy (x 0.85)
    var d = ATL.dim.getContext("2d");
    d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = "source-over"; d.clearRect(0, 0, 1024, 768);
    d.drawImage(ATL.src, 0, 0);
    d.globalCompositeOperation = "source-atop"; d.fillStyle = "rgba(0,0,0,0.15)"; d.fillRect(0, 0, 1024, 768);
    d.globalCompositeOperation = "source-over";
    // dark greyscale copy
    var gg = ATL.grey.getContext("2d");
    gg.setTransform(1, 0, 0, 1, 0, 0); gg.globalCompositeOperation = "source-over"; gg.clearRect(0, 0, 1024, 768);
    try {
      var im = g.getImageData(0, 0, 1024, 768), px = im.data, L;
      for (i = 0; i < px.length; i += 4) {
        L = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * 0.42;
        px[i] = L; px[i + 1] = L; px[i + 2] = L * 1.06;
      }
      gg.putImageData(im, 0, 0);
    } catch (e) {
      gg.drawImage(ATL.src, 0, 0);
      gg.globalCompositeOperation = "source-atop"; gg.fillStyle = "rgba(4,6,20,0.72)"; gg.fillRect(0, 0, 1024, 768);
      gg.globalCompositeOperation = "source-over";
    }
  }
  function loadAtlas(ctx) {
    if (!ATL.dim) buildAtlas();
    if (ATL.started) return;
    ATL.started = true;
    try {
      var img = new Image();
      img.onload = function () {
        try {
          ATL.img = img; buildAtlas();
          ATL.subs.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
        } catch (e) { /* keep fallback tiles */ }
      };
      img.onerror = function () {};
      img.src = ((ctx && ctx.assetBase) || "") + "assets/sns-logos.png";
    } catch (e) { /* keep fallback tiles */ }
  }
  function atlasSub(fn) { ATL.subs.push(fn); return function () { var k = ATL.subs.indexOf(fn); if (k >= 0) ATL.subs.splice(k, 1); }; }
  /* draw one platform logo into a square at (x, y), size s. lit 1 = colour, 0 = removed (dark greyscale). */
  function drawLogo(g, name, i, x, y, s, lit) {
    if (!ATL.dim) buildAtlas();
    var c = cellOf(name, i), sx = (c % 4) * 256, sy = ((c / 4) | 0) * 256;
    g.save();
    try { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; } catch (e) {}
    if (lit < 0.99) { g.globalAlpha = 1; g.drawImage(ATL.grey, sx, sy, 256, 256, x, y, s, s); }
    if (lit > 0.01) { g.globalAlpha = lit; g.drawImage(ATL.dim, sx, sy, 256, 256, x, y, s, s); }
    g.restore();
  }

  var TP = { cx: 0, top: 0 };
  function tilePos(i, n, out) {
    var row = (i / 3) | 0, inRow = Math.min(3, n - row * 3), k = i - row * 3;
    out.cx = 256 + (k - (inRow - 1) / 2) * 166;
    out.top = 140 + row * 196;
  }

  /* one app tile: real logo + name. lit 1 = running, 0 = removed. Design box 124 wide icon. */
  function drawTile(g, cx, top, i, lit, name, badge) {
    var S2 = 124, x = cx - S2 / 2;
    g.save();
    roundRect(g, x, top, S2, S2, 30);
    g.fillStyle = "#05071a"; g.fill();
    drawLogo(g, name, i, x + 3, top + 3, S2 - 6, lit);
    roundRect(g, x + 1, top + 1, S2 - 2, S2 - 2, 29);
    g.lineWidth = 2; g.strokeStyle = lit > 0.5 ? "rgba(5,7,26,0.9)" : "rgba(141,147,200,0.3)"; g.stroke();
    if (lit < 0.99) {
      g.globalAlpha = (1 - lit) * 0.75; g.strokeStyle = "#ff3fd0"; g.lineWidth = 5; g.lineCap = "round";
      g.beginPath(); g.moveTo(cx - 14, top + S2 / 2 - 14); g.lineTo(cx + 14, top + S2 / 2 + 14);
      g.moveTo(cx + 14, top + S2 / 2 - 14); g.lineTo(cx - 14, top + S2 / 2 + 14); g.stroke();
      g.globalAlpha = 1;
    }
    g.font = "500 22px " + F.mono; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(201,205,242," + (0.34 + 0.66 * lit).toFixed(2) + ")";
    g.fillText(name, cx, top + S2 + 24);
    if (badge && lit > 0.5) {
      g.fillStyle = "#ff3fd0"; g.beginPath(); g.arc(x + S2 - 6, top + 6, 17, 0, TAU); g.fill();
      g.fillStyle = "#fff"; g.font = "700 20px " + F.mono; g.fillText(String(badge), x + S2 - 6, top + 7);
    }
    g.restore();
  }

  function drawWallpaper(g, w, h) {
    var k = w / 512;
    g.setTransform(k, 0, 0, k, 0, 0);
    var gr = g.createLinearGradient(0, 0, 0, 1024);
    gr.addColorStop(0, "#0e1342"); gr.addColorStop(0.55, "#170f48"); gr.addColorStop(1, "#070922");
    g.fillStyle = gr; g.fillRect(0, 0, 512, 1024);
    var r1 = g.createRadialGradient(110, 330, 0, 110, 330, 330);
    r1.addColorStop(0, "rgba(123,59,255,0.30)"); r1.addColorStop(1, "rgba(123,59,255,0)");
    g.fillStyle = r1; g.fillRect(0, 0, 512, 1024);
    var r2 = g.createRadialGradient(430, 820, 0, 430, 820, 320);
    r2.addColorStop(0, "rgba(60,236,255,0.16)"); r2.addColorStop(1, "rgba(60,236,255,0)");
    g.fillStyle = r2; g.fillRect(0, 0, 512, 1024);
    g.strokeStyle = "rgba(123,59,255,0.14)"; g.lineWidth = 1;
    for (var x = 0; x <= 512; x += 64) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 1024); g.stroke(); }
    for (var y = 0; y <= 1024; y += 64) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(512, y + 0.5); g.stroke(); }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawStamp(g, a, sc) {
    g.save();
    g.translate(256, 560); g.rotate(-0.13); g.scale(sc, sc); g.globalAlpha = Math.min(1, a * 1.2);
    var w = 430, h = 168;
    g.fillStyle = "rgba(24,4,30,0.82)"; roundRect(g, -w / 2, -h / 2, w, h, 12); g.fill();
    g.shadowColor = "#ff3fd0"; g.shadowBlur = 22;
    g.strokeStyle = "#ff5fdc"; g.lineWidth = 7; roundRect(g, -w / 2, -h / 2, w, h, 12); g.stroke();
    g.lineWidth = 2; roundRect(g, -w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 7); g.stroke();
    g.shadowBlur = 14; g.fillStyle = "#ff7fe4"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "700 72px " + F.display;
    if ("letterSpacing" in g) g.letterSpacing = "4px";
    g.fillText("UNDER 16", 0, -32);
    g.font = "700 38px " + F.display;
    if ("letterSpacing" in g) g.letterSpacing = "2px";
    g.fillText("ACCOUNT REMOVED", 0, 40);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.shadowBlur = 8; g.beginPath(); g.arc(0, 8, 4, 0, TAU); g.fill();
    g.restore();
  }

  function drawScreen(g, w, h, st) {
    var k = w / 512, n = st.n, i, on = 0;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.shadowBlur = 0; g.textBaseline = "middle";
    g.drawImage(st.bg, 0, 0, 512, 1024);
    // camera island, signal, battery
    g.fillStyle = "#010208"; roundRect(g, 196, 12, 120, 28, 14); g.fill();
    g.fillStyle = "#101640"; g.beginPath(); g.arc(224, 26, 6, 0, TAU); g.fill();
    g.fillStyle = "rgba(201,205,242,0.85)";
    for (i = 0; i < 4; i++) g.fillRect(34 + i * 9, 34 - (i + 1) * 5, 6, (i + 1) * 5);
    g.strokeStyle = "rgba(201,205,242,0.8)"; g.lineWidth = 2; roundRect(g, 440, 17, 34, 17, 4); g.stroke();
    g.fillStyle = "rgba(201,205,242,0.85)"; g.fillRect(443, 20, 22, 11); g.fillRect(476, 22, 3, 7);
    // countdown + date
    g.textAlign = "left"; g.font = "700 42px " + F.mono; g.fillStyle = "#eef0ff"; g.fillText(st.time, 28, 78);
    g.textAlign = "right"; g.font = "500 25px " + F.mono; g.fillStyle = st.flash > 0.3 ? "#ff6fe0" : "#c9cdf2"; g.fillText(st.date, 484, 80);
    g.fillStyle = "rgba(184,139,255,0.3)"; g.fillRect(28, 110, 456, 1.5);
    // tiles
    if (st.tiles || st.slots) {
      for (i = 0; i < n; i++) {
        tilePos(i, n, TP);
        if (st.tiles) drawTile(g, TP.cx, TP.top, i, st.lit[i], st.names[i], BADGES[i % 10]);
        else {
          g.strokeStyle = "rgba(141,147,200,0.22)"; g.lineWidth = 2; g.setLineDash([8, 8]);
          roundRect(g, TP.cx - 62, TP.top, 124, 124, 30); g.stroke(); g.setLineDash([]);
        }
      }
    }
    for (i = 0; i < n; i++) if (st.lit[i] > 0.5) on++;
    // bottom readout
    g.textAlign = "left"; g.font = "500 18px " + F.mono; g.fillStyle = "#8d93c8";
    g.fillText("ONLINE " + pad2(on) + " / " + pad2(n), 34, 956);
    g.fillStyle = "rgba(184,139,255,0.28)"; g.fillRect(34, 974, 444, 3);
    g.fillStyle = on > 0 ? "#b88bff" : "#ff3fd0"; g.fillRect(34, 974, n ? 444 * on / n : 0, 3);
    g.fillStyle = "rgba(238,240,255,0.55)"; roundRect(g, 186, 996, 140, 6, 3); g.fill();
    if (st.dim < 0.999) { g.fillStyle = "rgba(2,3,10," + (1 - st.dim).toFixed(3) + ")"; g.fillRect(0, 0, 512, 1024); }
    if (st.stamp > 0.01) drawStamp(g, st.stamp, st.stampScale);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function scrKey(st) {
    var M = 2147483647, k = (st.timeIdx * 2 + st.dateIdx) % M, s = 0, i;
    k = (k * 13 + Math.round(st.flash * 4)) % M;
    for (i = 0; i < st.n; i++) s = (s * 7 + Math.round(st.lit[i] * 5)) % 1000000007;
    k = (k * 1000003 + s) % M;
    k = (k * 17 + Math.round(st.stamp * 8)) % M;
    k = (k * 3 + (st.slots ? 1 : 0)) % M;
    k = (k * 11 + Math.round(st.dim * 10)) % M;
    return k;
  }

  /* ---------------- screen shader: scanlines, chromatic split, glitch slices, black glass ---------------- */
  var SCR_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var SCR_FS = [
    "uniform sampler2D map;uniform float uTime;uniform float uAber;uniform float uGlitch;uniform float uBright;",
    "uniform float uScan;uniform float uGlass;uniform float uShift;uniform float uNoise;",
    "varying vec2 vUv;",
    "float sq(float x){return x*x;}",
    "float h1(float n){return fract(sin(n*127.1)*43758.5453);}",
    "float h2(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}",
    "void main(){",
    "  vec2 uv=vUv;",
    "  float blk=floor(uv.y*26.0);",
    "  float tk=floor(uTime*16.0);",
    "  float gr=h1(blk*3.7+tk*11.3);",
    "  float on=step(1.0-uGlitch*0.5,gr)*step(0.001,uGlitch);",
    "  uv.x+=(h1(blk+tk*5.1)-0.5)*0.16*uGlitch*on;",
    "  float ab=uAber*0.0035+on*0.01;",
    "  vec3 c;",
    "  c.r=texture2D(map,uv+vec2(ab,0.0)).r;",
    "  c.g=texture2D(map,uv).g;",
    "  c.b=texture2D(map,uv-vec2(ab,0.0)).b;",
    "  c=pow(c,vec3(2.2));",
    "  float rows=110.0;",
    "  float fw=fwidth(vUv.y*rows);",
    "  float ln=mix(0.5+0.5*sin(vUv.y*rows*6.2832),0.5,smoothstep(0.12,0.3,fw));",
    "  c*=1.0-uScan*(1.0-0.85*uGlass)*0.2*(1.0-ln);",
    "  float d=fract(uTime*0.1)-(1.0-vUv.y);",
    "  c+=vec3(0.03,0.22,0.5)*exp(-d*d*700.0)*0.16*uScan*(1.0-uGlass);",
    "  vec2 q=vUv-0.5;",
    "  c*=1.0-0.9*dot(q,q);",
    "  c*=uBright;",
    "  float sh=1.0-smoothstep(0.0,0.14,abs(vUv.x*0.7+vUv.y*0.45-0.62-uShift*0.8));",
    "  c+=vec3(0.45,0.5,1.0)*sh*0.05;",
    "  if(uGlass>0.0){",
    "    float xm=0.16+uShift;float xc=0.84+uShift;",
    "    float m1=exp(-sq((vUv.x-xm)*6.0));float m1c=exp(-sq((vUv.x-xm)*34.0));",
    "    float m2=exp(-sq((vUv.x-xc)*7.0));float m2c=exp(-sq((vUv.x-xc)*38.0));",
    "    vec3 r=vec3(1.0,0.10,0.55)*(m1*0.30+m1c*0.9)+vec3(0.04,0.65,1.0)*(m2*0.26+m2c*0.8);",
    "    r*=0.25+0.75*smoothstep(0.02,0.3,vUv.y)*(1.0-smoothstep(0.6,1.0,vUv.y));",
    "    r+=vec3(0.45,0.5,1.0)*sh*0.14;",
    "    r+=vec3(0.5,0.1,0.9)*exp(-sq((vUv.y-0.32+uShift*0.2)*60.0))*0.22;",
    "    c=mix(c,vec3(0.003),uGlass)+r*uGlass;",
    "  }",
        "  gl_FragColor=vec4(max(c,0.0),1.0);",
    "}"
  ].join("\n");

  function makeScreenMat(tex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex }, uTime: { value: 0 }, uAber: { value: 0.7 }, uGlitch: { value: 0 }, uBright: { value: 0.86 },
        uScan: { value: 1 }, uGlass: { value: 0 }, uShift: { value: 0 }, uNoise: { value: 1 }
      },
      vertexShader: SCR_VS, fragmentShader: SCR_FS, extensions: { derivatives: true }
    });
  }

  /* ---------------- the phone ---------------- */
  function buildPhone(o) {
    var low = !!o.low, cw = low ? 384 : 512, ch = low ? 768 : 1024, names = o.names || [], i;
    var st = {
      time: TIMES[27], timeIdx: 27, date: "9 DEC 2025", dateIdx: 0, flash: 0, n: names.length, names: names, lit: [],
      tiles: o.tiles !== false, slots: false, stamp: 0, stampScale: 1, dim: 1, bg: null
    };
    for (i = 0; i < 10; i++) st.lit.push(1);
    var bg = document.createElement("canvas"); bg.width = cw; bg.height = ch;
    drawWallpaper(bg.getContext("2d"), cw, ch);
    st.bg = bg;
    var tex = kit.canvasTexture(cw, ch, function (g, w, h) { drawScreen(g, w, h, st); });
    var mat = makeScreenMat(tex);
    var group = new THREE.Group();

    // body: bevelled rounded slab
    var bodyGeo = new THREE.ExtrudeGeometry(rrShape(PW - 0.04, PH - 0.04, 0.2), {
      depth: PT - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: low ? 6 : 12
    });
    bodyGeo.translate(0, 0, -(PT - 0.04) / 2);
    var body = new THREE.Mesh(bodyGeo, kit.darkMat("#0c1030", { roughness: 0.3, metalness: 0.78 }));
    group.add(body);
    // side buttons
    var bp = [];
    [[PW / 2 + 0.005, 0.55, 0.3], [-PW / 2 - 0.005, 0.85, 0.2], [-PW / 2 - 0.005, 0.48, 0.2], [-PW / 2 - 0.005, 1.1, 0.1]].forEach(function (b) {
      var g1 = new THREE.BoxGeometry(0.03, b[2], 0.05); g1.translate(b[0], b[1], 0); bp.push(g1);
    });
    group.add(new THREE.Mesh(mergeGeos(bp), kit.darkMat("#1a2166", { roughness: 0.35, metalness: 0.8 })));
    // screen
    var sg = new THREE.ShapeGeometry(rrShape(SW, SH, 0.13), 10);
    var spos = sg.attributes.position, suv = sg.attributes.uv;
    for (i = 0; i < spos.count; i++) suv.setXY(i, spos.getX(i) / SW + 0.5, spos.getY(i) / SH + 0.5);
    var screen = new THREE.Mesh(sg, mat);
    screen.position.z = PT / 2 + 0.003;
    group.add(screen);
    // split neon rim: magenta on one side, cyan on the other
    var half = rrHalf(PW + 0.014, PH + 0.014, 0.206, low ? 5 : 8);
    var rimR = kit.neonTube(half, { color: T.magenta, radius: 0.0085, intensity: 1.5, segments: half.length * 2 });
    var rimL = kit.neonTube(mirrorX(half), { color: T.cyan, radius: 0.0085, intensity: 1.5, segments: half.length * 2 });
    group.add(rimR); group.add(rimL);
    var rimBaseR = rimR.material.color.clone(), rimBaseL = rimL.material.color.clone();
    // glows behind
    var glowV = kit.glowSprite("#7b3bff", 3.8, 0.2); glowV.position.z = -0.5; group.add(glowV);
    var glowM = kit.glowSprite("#ff3fd0", 3.3, 0.0); glowM.position.z = -0.55; group.add(glowM);

    var lastKey = -1, lastT = -9;
    function refresh(force, now) {
      var k = scrKey(st);
      if (!force && k === lastKey) return;
      if (!force && now - lastT < 0.033) return;
      lastKey = k; lastT = now;
      tex.redraw(function (g, w, h) { drawScreen(g, w, h, st); });
    }
    return {
      group: group, st: st, tex: tex, mat: mat, screen: screen, body: body, rimR: rimR, rimL: rimL, rimBaseR: rimBaseR, rimBaseL: rimBaseL,
      glowV: glowV, glowM: glowM, refresh: refresh
    };
  }

  /* ---------------- notification cards ---------------- */
  function cardTex(name, idx, low) {
    var cw = low ? 320 : 480, ch = Math.round(cw * 104 / 320);
    return kit.canvasTexture(cw, ch, function (g, w) {
      var k = w / 320;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, 320, 104);
      roundRect(g, 4, 4, 312, 96, 14);
      g.fillStyle = "rgba(10,14,48,0.9)"; g.fill();
      var bd = g.createLinearGradient(4, 4, 316, 100);
      bd.addColorStop(0, "rgba(255,63,208,0.7)"); bd.addColorStop(1, "rgba(60,236,255,0.7)");
      g.strokeStyle = bd; g.lineWidth = 2; g.stroke();
      roundRect(g, 16, 18, 68, 68, 16); g.fillStyle = "#05071a"; g.fill();
      drawLogo(g, name, idx, 17, 19, 66, 1);
      g.textBaseline = "middle"; g.textAlign = "left";
      g.font = "500 22px " + F.mono;
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "rgba(255,63,208,0.45)"; g.fillText(name, 99, 38);
      g.fillStyle = "rgba(60,236,255,0.45)"; g.fillText(name, 101, 38);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#eef0ff"; g.fillText(name, 100, 38);
      g.font = "400 13px " + F.mono; g.fillStyle = "#8d93c8"; g.fillText("NEW NOTIFICATION", 100, 62);
      g.textAlign = "right"; g.fillText("NOW", 304, 30);
      g.fillStyle = "rgba(201,205,242,0.22)"; g.fillRect(100, 78, 150, 5); g.fillRect(100, 88, 100, 4);
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
  }

  /* ---------------- haze + data rain (vertex-shader driven, zero CPU per frame) ---------------- */
  function makeHaze(o) {
    var r = kit.rand(o.seed || 7), i, N = o.dust, M = o.rain;
    var U = { uTime: { value: 0 } };
    var dp = new Float32Array(N * 3), ds = new Float32Array(N * 4);
    for (i = 0; i < N; i++) {
      dp[i * 3] = o.x0 + r() * (o.x1 - o.x0); dp[i * 3 + 1] = 0; dp[i * 3 + 2] = o.z0 + r() * (o.z1 - o.z0);
      ds[i * 4] = 0.05 + r() * 0.12; ds[i * 4 + 1] = r(); ds[i * 4 + 2] = 0.5 + r() * 0.9; ds[i * 4 + 3] = r() * TAU;
    }
    var dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dg.setAttribute("aS", new THREE.BufferAttribute(ds, 4));
    var common = {
      uTime: U.uTime, uH0: { value: o.y0 }, uH1: { value: o.y1 }, uCx: { value: o.cx }, uCw: { value: o.cw }
    };
    var dm = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uSize: { value: o.size || 0.06 }, uColor: { value: kit.color(T.violet, 0.9) }, uAlpha: { value: 0.55 } }, common),
      vertexShader: [
        "float sq(float x){return x*x;}attribute vec4 aS;uniform float uTime;uniform float uH0;uniform float uH1;uniform float uSize;uniform float uCx;uniform float uCw;varying float vA;",
        "void main(){float rg=uH1-uH0;float y=uH1-mod(aS.y*rg+uTime*aS.x,rg);",
        "vec3 p=vec3(position.x+sin(uTime*0.35+aS.w)*0.12,y,position.z+cos(uTime*0.27+aS.w)*0.1);",
        "float f=smoothstep(uH0,uH0+0.5,y)*(1.0-smoothstep(uH1-0.6,uH1,y));",
        "float sp=0.2+0.8*exp(-sq((p.x-uCx)/uCw));",
        "vA=f*sp*(0.4+0.6*fract(aS.w*3.1));",
        "vec4 mv=modelViewMatrix*vec4(p,1.0);",
        "gl_PointSize=clamp(uSize*aS.z*430.0/-mv.z,1.0,14.0);gl_Position=projectionMatrix*mv;}"
      ].join("\n"),
      fragmentShader: "uniform vec3 uColor;uniform float uAlpha;varying float vA;void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.0,d)*vA*uAlpha;gl_FragColor=vec4(uColor,a);}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var dust = new THREE.Points(dg, dm); dust.frustumCulled = false;

    var rp = new Float32Array(M * 2 * 3), re = new Float32Array(M * 2), rs = new Float32Array(M * 2 * 3);
    for (i = 0; i < M; i++) {
      var x = o.x0 + r() * (o.x1 - o.x0), z = o.z0 + r() * (o.z1 - o.z0), sp = 1.1 + r() * 1.2, ph = r(), ln = 0.25 + r() * 0.4;
      for (var e = 0; e < 2; e++) {
        var j = i * 2 + e;
        rp[j * 3] = x; rp[j * 3 + 1] = 0; rp[j * 3 + 2] = z;
        re[j] = e; rs[j * 3] = sp; rs[j * 3 + 1] = ph; rs[j * 3 + 2] = ln;
      }
    }
    var rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    rg.setAttribute("aEnd", new THREE.BufferAttribute(re, 1));
    rg.setAttribute("aS", new THREE.BufferAttribute(rs, 3));
    var rm = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: kit.color(T.cyan, 0.9) }, uAlpha: { value: 0.32 } }, common),
      vertexShader: [
        "float sq(float x){return x*x;}attribute float aEnd;attribute vec3 aS;uniform float uTime;uniform float uH0;uniform float uH1;uniform float uCx;uniform float uCw;varying float vA;",
        "void main(){float rg=uH1-uH0;float y=uH1-mod(aS.y*rg+uTime*aS.x,rg);",
        "vec3 p=vec3(position.x+(uH1-y)*0.035,y-aEnd*aS.z,position.z);p.x+=aEnd*aS.z*0.035;",
        "float f=smoothstep(uH0,uH0+0.4,y)*(1.0-smoothstep(uH1-0.5,uH1,y));",
        "float sp=0.15+0.85*exp(-sq((p.x-uCx)/uCw));",
        "vA=f*sp*(1.0-aEnd);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}"
      ].join("\n"),
      fragmentShader: "uniform vec3 uColor;uniform float uAlpha;varying float vA;void main(){gl_FragColor=vec4(uColor,vA*uAlpha);}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var rain = new THREE.LineSegments(rg, rm); rain.frustumCulled = false;
    return { dust: dust, rain: rain, U: U };
  }

  /* ---------------- textures: emitter ring, wall grid, light cone, skyline ---------------- */
  function ringTex(low) {
    var s = low ? 256 : 512;
    return kit.canvasTexture(s, s, function (g, w) {
      var c = w / 2, R = w / 2 - 4, a, k = w / 512;
      g.clearRect(0, 0, w, w); g.translate(c, c); g.scale(k, k);
      var Rr = 252;
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, Rr, 0, TAU); g.stroke();
      g.lineWidth = 2;
      for (a = 0; a < 360; a += 4) {
        var len = a % 30 === 0 ? 16 : 7, rad = a * PI / 180;
        g.globalAlpha = a % 30 === 0 ? 0.95 : 0.5;
        g.beginPath(); g.moveTo(Math.cos(rad) * (Rr - 3), Math.sin(rad) * (Rr - 3)); g.lineTo(Math.cos(rad) * (Rr - 3 - len), Math.sin(rad) * (Rr - 3 - len)); g.stroke();
      }
      g.globalAlpha = 0.55; g.lineWidth = 2; g.setLineDash([5, 9]);
      g.beginPath(); g.arc(0, 0, 190, 0, TAU); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 0.9; g.lineWidth = 6;
      g.beginPath(); g.arc(0, 0, 140, 0.3, 1.2); g.stroke();
      g.beginPath(); g.arc(0, 0, 140, 3.4, 4.4); g.stroke();
      g.globalAlpha = 0.4; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.moveTo(0, -26); g.lineTo(0, 26); g.stroke();
      void R;
    });
  }
  function gridTex() {
    return kit.canvasTexture(512, 512, function (g) {
      g.clearRect(0, 0, 512, 512);
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.2;
      for (var i = 0; i <= 512; i += 32) {
        g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 512); g.stroke();
        g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(512, i + 0.5); g.stroke();
      }
      g.globalCompositeOperation = "destination-in";
      var rg = g.createRadialGradient(256, 256, 20, 256, 256, 256);
      rg.addColorStop(0, "rgba(0,0,0,1)"); rg.addColorStop(0.55, "rgba(0,0,0,0.5)"); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
    });
  }
  function poolTex() {
    return kit.canvasTexture(256, 256, function (g) {
      var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    });
  }
  function coneTex() {
    return kit.canvasTexture(16, 128, function (g) {
      var gr = g.createLinearGradient(0, 128, 0, 0);
      gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.5, "rgba(255,255,255,0.25)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 16, 128);
    });
  }
  function skylineTex(seed, low, dark) {
    var w = low ? 1024 : 2048, h = low ? 256 : 512;
    return kit.canvasTexture(w, h, function (g) {
      var r = kit.rand(seed), x = 0, k = w / 2048, wc = [T.violet, T.cyan, T.amber, T.magenta];
      g.clearRect(0, 0, w, h);
      while (x < w) {
        var bw = (36 + r() * 120) * k, bh = h * (0.16 + r() * 0.62);
        var gr = g.createLinearGradient(0, h - bh, 0, h);
        gr.addColorStop(0, dark ? "#080b24" : "#0d1235"); gr.addColorStop(1, "#05071a");
        g.fillStyle = gr; g.fillRect(x, h - bh, bw, bh);
        g.fillStyle = "rgba(123,59,255,0.35)"; g.fillRect(x, h - bh, bw, 1.5);
        for (var wy = h - bh + 8 * k; wy < h - 6; wy += 11 * k) {
          for (var wx = x + 5 * k; wx < x + bw - 6 * k; wx += 9 * k) {
            if (r() < 0.13) { g.fillStyle = wc[(r() * 4) | 0]; g.globalAlpha = 0.25 + r() * 0.6; g.fillRect(wx, wy, 3.5 * k, 5 * k); }
          }
        }
        g.globalAlpha = 1;
        if (r() < 0.18) { g.fillStyle = r() < 0.5 ? T.magenta : T.cyan; g.globalAlpha = 0.85; g.fillRect(x + bw * 0.15, h - bh + 14 * k, bw * 0.7, 2.5 * k); g.globalAlpha = 1; }
        x += bw + r() * 12 * k;
      }
      var hz = g.createLinearGradient(0, h * 0.35, 0, h * 0.8);
      hz.addColorStop(0, "rgba(123,59,255,0)"); hz.addColorStop(1, "rgba(123,59,255,0.16)");
      g.fillStyle = hz; g.fillRect(0, h * 0.35, w, h * 0.45);
      var fd = g.createLinearGradient(0, h * 0.62, 0, h * 0.89);
      fd.addColorStop(0, "rgba(4,5,12,0)"); fd.addColorStop(1, "rgba(4,5,12,1)");
      g.fillStyle = fd; g.fillRect(0, h * 0.62, w, h * 0.38);
    });
  }

  /* =====================================================================
     ROOM
     ===================================================================== */
  function build(ctx) {
    var ex = ctx.exhibit || {}, facts = ex.facts || {};
    var names = (facts.platforms || []).map(str).slice(0, 10);
    var nP = names.length || 10;
    var low = ctx.quality === "low", reduced = !!ctx.reducedMotion, i;
    loadAtlas(ctx);
    var root = new THREE.Group(); root.name = "room3-ban";
    ctx.anchor.add(root);

    S = {
      ctx: ctx, root: root, low: low, reduced: reduced, active: false, t: -1, clock: 0, flash: 0, signK: 0.38, magK: 0,
      fx: { glitch: 0, aber: 0.7 }, thud: 0, hudKey: -1, names: names, cCyan: kit.color(T.cyan, 0.55), cMag: kit.color(T.magenta, 0.55)
    };

    /* ===== wall light: soft pool, thin grid, shadow ===== */
    var poolMat = new THREE.MeshBasicMaterial({ map: poolTex(), color: kit.color("#9d86ff", 0.04), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    poolMat.toneMapped = false;
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.8), poolMat);
    pool.position.set(HERO.x + 0.3, HERO.y, 0.012); pool.renderOrder = -3; root.add(pool);

    var gridMat = new THREE.MeshBasicMaterial({ map: gridTex(), color: kit.color(T.violet, 0.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    gridMat.toneMapped = false;
    var grid = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), gridMat);
    grid.position.set(HERO.x + 0.2, HERO.y, 0.016); grid.renderOrder = -2; root.add(grid);

    var shTex = kit.canvasTexture(256, 256, function (g) {
      g.clearRect(0, 0, 256, 256); g.save(); g.translate(128, 128); g.scale(0.58, 0.82);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
      gr.addColorStop(0, "rgba(0,0,0,0.9)"); gr.addColorStop(0.6, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(-256, -256, 512, 512); g.restore();
    });
    var shMat = new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 4.4), shMat);
    shadow.position.set(HERO.x + 0.4, HERO.y - 0.1, 0.02); shadow.renderOrder = -1; root.add(shadow);

    /* ===== hologram emitter on the floor + light column ===== */
    var ringMat = new THREE.MeshBasicMaterial({ map: ringTex(low), color: kit.color(T.cyan, 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ringMat.toneMapped = false;
    var ring = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), ringMat);
    ring.rotation.x = -PI / 2; ring.position.set(HERO.x, 0.025, HERO.z); root.add(ring);
    S.ring = ring; S.ringMat = ringMat;
    /* ===== phone ===== */
    var ph = buildPhone({ low: low, names: names, tiles: true });
    ph.group.position.set(HERO.x, HERO.y, HERO.z);
    ph.group.rotation.y = HERO.yaw;
    root.add(ph.group);
    S.ph = ph;
    ph.refresh(true, 0);
    if (ctx.addClickable) {
      ctx.addClickable(ph.screen, function () { if (S.active) { S.t = S.reduced ? SHOW.end : 0; S.flash = 1; applyShow(S.t); } }, "Replay the blackout");
    }

    /* ===== HUD brackets + tiny mono readouts around the phone (small, own-object only) ===== */
    var hud = new THREE.Group();
    hud.position.set(HERO.x, HERO.y, HERO.z); hud.rotation.y = HERO.yaw; root.add(hud);
    var BX = 1.1, BY = 1.74;
    hud.add(new THREE.Mesh(bracketGeo(BX, BY, 0.26, 0.011, 0), kit.neonMat(T.violet, 0.9)));
    var monoLbl = function (txt, x, y, align, color) {
      var m = kit.neonText(txt, { font: F.mono, weight: "500", height: 0.066, color: color || "#b9bdf0", glow: 5, core: 0.15, align: align, letterSpacing: 10 });
      m.position.set(x, y, 0); m.material.color.setScalar(0.85); hud.add(m); return m;
    };
    monoLbl("SYS · CH 03", -BX + 0.08, BY - 0.13, "left");
    monoLbl(nP + " PLATFORMS", BX - 0.08, -BY + 0.13, "right");
    monoLbl("REC", BX - 0.17, BY - 0.13, "right", T.magenta);
    var recDot = new THREE.Mesh(new THREE.CircleGeometry(0.019, 14), kit.neonMat(T.magenta, 1.8));
    recDot.position.set(BX - 0.09, BY - 0.13, 0); hud.add(recDot);
    S.recDot = recDot; S.recBase = recDot.material.color.clone();
    // live corner readout: date, clock, platforms still online
    S.hudBL = canvasMesh(512, 112, 0.15, function () {});
    S.hudBL.position.set(-BX + 0.06 + S.hudBL.userData.size.w / 2, -BY + 0.15, 0); hud.add(S.hudBL);
    S.hudDate = str(facts.date);
    drawHud(0);

    /* ===== notification cards (pooled) ===== */
    var cardDefs = [[1, -2.4, 3.2, 1.05], [6, 0.12, 3.3, 1.1], [4, -2.3, 1.7, 1.3], [8, 0.22, 2.1, 0.95], [3, 0.02, 0.95, 1.2]];
    if (low) cardDefs.length = 4;
    S.cards = [];
    if (names.length) {
      cardDefs.forEach(function (d, ci) {
        var idx = d[0] % names.length;
        var tex = cardTex(names[idx], idx, low);
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.96 });
        mat.toneMapped = false;
        var mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.312), mat);
        mesh.position.set(d[1], d[2], d[3]); mesh.rotation.y = d[1] < -1 ? 0.28 : -0.1;
        root.add(mesh);
        S.cards.push({
          mesh: mesh, mat: mat, x: d[1], y: d[2], z: d[3], ry: mesh.rotation.y, ph: ci * 1.7,
          delay: ci * 0.1, vx: (ci % 2 ? 0.3 : -0.3) * (0.6 + (ci % 3) * 0.3), vz: 0.12 * (ci % 3), spin: (ci % 2 ? 1 : -1) * (0.7 + ci * 0.15), tilt: 0.5 + ci * 0.1,
          tHit: Math.sqrt(2 * Math.max(0.1, d[2] - 0.2) / G_)
        });
      });
    }

    /* ===== LOG IN DENIED ===== */
    var sign = kit.neonText("LOG IN DENIED", { font: F.neon, color: T.magenta, height: 0.4, glow: 26, core: 0.6, letterSpacing: 5 });
    var stw = ntWidth(sign, 26);
    sign.position.set(RX + stw / 2, 3.5, 0.07); root.add(sign);
    S.signMat = sign.material;
    var fw = stw + 0.44, fh = 0.62, fx = RX - 0.22, fy = 3.5 - fh / 2;
    var frame = kit.neonTube([new THREE.Vector3(fx, fy, 0.06), new THREE.Vector3(fx + fw, fy, 0.06), new THREE.Vector3(fx + fw, fy + fh, 0.06), new THREE.Vector3(fx, fy + fh, 0.06)],
      { closed: true, radius: 0.012, intensity: 1.4, color: T.magenta, segments: 24 });
    root.add(frame);
    S.frameMat = frame.material; S.frameBase = frame.material.color.clone();
    var fb = new THREE.Mesh(bracketGeo(fw / 2 + 0.1, fh / 2 + 0.1, 0.14, 0.008, 0), kit.neonMat(T.violet, 0.8));
    fb.position.set(fx + fw / 2, fy + fh / 2, 0.06); root.add(fb);
    var cap = kit.neonText([str(ex.meta && ex.meta[0]), str(ex.meta && ex.meta[1])].filter(Boolean).join("\n").toUpperCase(),
      { font: F.mono, weight: "500", height: 0.07, color: "#b9bdf0", glow: 5, core: 0.2, align: "left", lineGap: 1.6, letterSpacing: 6 });
    cap.position.set(RX, 2.98, 0.05); cap.material.color.setScalar(0.85); root.add(cap);

    /* ===== human vs machine readout (shared museum language) ===== */
    function readLine(label, value, color, y) {
      if (!value) return;
      var l = kit.neonText(String(label).toUpperCase(), { font: F.mono, weight: "500", height: 0.066, color: T.violet, glow: 0, core: 0, align: "left", letterSpacing: 14 });
      l.position.set(RX, y + 0.175, 0.04); root.add(l);
      var v = kit.neonText(String(value), { font: F.neon, height: 0.165, color: color, glow: 22, core: 0.5, align: "left", letterSpacing: 4 });
      v.position.set(RX, y, 0.04); root.add(v);
    }
    var hu = ex.human || {}, ma = ex.machine || {};
    readLine(hu.label || "Human time", str(hu.short), T.amber, 2.3);
    readLine(ma.label || "Machine time", str(ma.short), T.cyan, 1.74);
    // hairlines between the groups
    var hl = [];
    [2.7, 1.38].forEach(function (y) { var g1 = new THREE.PlaneGeometry(2.45, 0.005); g1.translate(RX + 1.225, y, 0.04); hl.push(g1); });
    root.add(new THREE.Mesh(mergeGeos(hl), kit.neonMat(T.ink, 1.7)));

    /* ===== link signs: "▶ WORD" in magenta ===== */
    function linkSign(label, y, onClick, hint) {
      var g1 = new THREE.Group(); g1.position.set(RX + 0.3, y, 0.05);
      var tri = kit.neonTube([new THREE.Vector3(-0.3, 0.05, 0), new THREE.Vector3(-0.3, -0.05, 0), new THREE.Vector3(-0.215, 0, 0)],
        { closed: true, radius: 0.0065, segments: 30, color: T.magenta, intensity: 1.8 });
      g1.add(tri);
      var word = kit.neonText(label, { font: F.display, weight: "600", height: 0.105, color: T.magenta, glow: 18, core: 0.45, align: "left", letterSpacing: 12 });
      word.position.set(-0.165, 0, 0); g1.add(word);
      var ww = ntWidth(word, 18);
      var hit = hiddenHit(ww + 0.5, 0.3); hit.position.set(-0.3 + (ww + 0.5) / 2, 0, 0.01); g1.add(hit);
      root.add(g1);
      var rec = { group: g1, word: word, tri: tri, flash: 0 };
      ctx.addClickable(hit, function () { rec.flash = 1; onClick(); }, hint);
      return rec;
    }
    S.links = [];
    if (ctx.addClickable) {
      S.links.push(linkSign("STEP INSIDE", 1.08, function () { if (ctx.openImmersive) ctx.openImmersive(); }, "Step inside the blackout"));
      var link = ex.links && ex.links[0];
      if (link && link.url) {
        S.links.push(linkSign(str(link.label || "Read the article").toUpperCase(), 0.66, function () { if (ctx.openLink) ctx.openLink(link.url); }, str(link.label) || "Read the article"));
      }
    }

    /* ===== plaque under the phone + optional teen plate ===== */
    var plaq = kit.neonText([str(ex.kind), str(ex.meta && ex.meta[0])].filter(Boolean).join("\n").toUpperCase(),
      { font: F.mono, weight: "500", height: 0.07, color: "#b9bdf0", glow: 5, core: 0.2, align: "left", lineGap: 1.6, letterSpacing: 6 });
    plaq.position.set(HERO.x - 1.0, 0.42, 0.3); plaq.material.color.setScalar(0.8); root.add(plaq);
    var tick = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.2), kit.neonMat(T.violet, 0.9));
    tick.position.set(HERO.x - 1.06, 0.42, 0.3); root.add(tick);
    if (str(facts.teenName)) {
      var tk = kit.neonText("WHO IS IN THE STORY", { font: F.mono, weight: "500", height: 0.06, color: T.violet, glow: 0, core: 0, align: "left", letterSpacing: 12 });
      tk.position.set(RX, 0.34, 0.05); root.add(tk);
      var tn = kit.neonText((str(facts.teenName) + (str(facts.teenAge) ? ", " + str(facts.teenAge) : "")).toUpperCase(), { font: F.display, weight: "700", height: 0.12, color: T.amber, glow: 14, core: 0.45, align: "left", letterSpacing: 4 });
      tn.position.set(RX, 0.2, 0.05); root.add(tn);
    }

    /* ===== LED news ticker across the wall ===== */
    var TICK = "AUSTRALIA · DEC. 10, 2025 · UNDER-16 SOCIAL MEDIA BAN TAKES EFFECT · " + nP + " PLATFORMS · FINES UP TO " + (str(facts.fine) || "A$49.5 million").toUpperCase() + " FOR COMPANIES ·";
    var bandH = 0.32, TW = 4096, TH = 128;
    var tickTex = kit.canvasTexture(TW, TH, function (g, w, h) {
      g.fillStyle = "#04051a"; g.fillRect(0, 0, w, h);
      var px = 52;
      g.font = "500 " + px + "px " + F.mono; g.textBaseline = "middle"; g.textAlign = "left";
      var cw2 = g.measureText("M").width, L = TICK.length;
      if (L * cw2 > w - 150) { px = Math.floor(px * (w - 150) / (L * cw2)); g.font = "500 " + px + "px " + F.mono; cw2 = g.measureText("M").width; }
      for (var c = 0; c < L; c++) {
        var ch = TICK.charAt(c);
        g.fillStyle = ch === "·" ? "#ff3fd0" : "#dfe2ff";
        g.fillText(ch, 40 + c * cw2, h / 2 + 3);
      }
    });
    tickTex.wrapS = THREE.RepeatWrapping; tickTex.wrapT = THREE.ClampToEdgeWrapping;
    var tickW = TW * (bandH / TH);
    var tickMat = new THREE.MeshBasicMaterial({ map: tickTex, color: kit.color("#f4f4ff", 0.85) });
    tickMat.toneMapped = false;
    var tickMesh = new THREE.Mesh(new THREE.PlaneGeometry(tickW, bandH), tickMat);
    tickMesh.position.set(0, 4.42, 0.04); root.add(tickMesh);
    S.tickTex = tickTex;
    var ledTex = kit.canvasTexture(16, 16, function (g) {
      g.fillStyle = "#000"; g.fillRect(0, 0, 16, 16);
      g.globalCompositeOperation = "destination-out";
      g.beginPath(); g.arc(8, 8, 5.4, 0, TAU); g.fill();
    });
    ledTex.wrapS = ledTex.wrapT = THREE.RepeatWrapping; ledTex.repeat.set(tickW / 0.016, bandH / 0.016);
    var ledMat = new THREE.MeshBasicMaterial({ map: ledTex, transparent: true, opacity: 0.6, depthWrite: false });
    var led = new THREE.Mesh(new THREE.PlaneGeometry(tickW, bandH), ledMat);
    led.position.set(0, 4.42, 0.043); root.add(led);
    var rl = [];
    [bandH / 2 + 0.014, -bandH / 2 - 0.014].forEach(function (y) { var g1 = new THREE.PlaneGeometry(tickW, 0.011); g1.translate(0, y, 0); rl.push(g1); });
    var rails = new THREE.Mesh(mergeGeos(rl), kit.neonMat(T.purple, 1.5));
    rails.position.set(0, 4.42, 0.045); root.add(rails);
    // end caps: LIVE tag and channel
    var capL = canvasMesh(256, 72, 0.26, function (g, w, h) {
      g.fillStyle = "rgba(255,63,208,0.9)"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#04051a"; g.font = "700 40px " + F.mono; g.textBaseline = "middle"; g.textAlign = "left";
      if ("letterSpacing" in g) g.letterSpacing = "6px";
      g.fillText("● LIVE", 22, h / 2 + 2);
    }, true);
    capL.position.set(-tickW / 2 + capL.userData.size.w / 2 + 0.05, 4.42, 0.05); root.add(capL);
    var capR = canvasMesh(256, 72, 0.26, function (g, w, h) {
      g.fillStyle = "#04051a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(184,139,255,0.7)"; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = "#b88bff"; g.font = "500 36px " + F.mono; g.textBaseline = "middle"; g.textAlign = "center";
      if ("letterSpacing" in g) g.letterSpacing = "6px";
      g.fillText("CH 03", w / 2, h / 2 + 2);
    }, true);
    capR.position.set(tickW / 2 - capR.userData.size.w / 2 - 0.05, 4.42, 0.05); root.add(capR);

    /* ===== haze and data rain in the spotlight ===== */
    var hz = makeHaze({ seed: 33, dust: low ? 40 : 90, rain: low ? 26 : 60, x0: -4.6, x1: 4.6, z0: 0.5, z1: 2.6, y0: 0.05, y1: 4.2, cx: HERO.x, cw: 2.6, size: 0.06 });
    root.add(hz.dust); root.add(hz.rain);
    S.haze = hz;

    // when the logo atlas arrives, redraw the phone screen and the notification cards
    if (S.unsub) S.unsub();
    S.unsub = atlasSub(function () {
      if (!S) return;
      if (S.ph) S.ph.refresh(true, S.clock || 0);
      if (S.cards) S.cards.forEach(function (c) { if (c.mat && c.mat.map && c.mat.map.redraw) c.mat.map.redraw(); });
    });

    applyShow(S.reduced ? -1 : -1);
    return null;
  }

  /* live corner readout (date, clock, platforms online) */
  function drawHud(online) {
    if (!S || !S.hudBL) return;
    var st = S.ph.st, n = st.n;
    var tex = S.hudBL.material.map;
    tex.redraw(function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textBaseline = "middle"; g.textAlign = "left";
      g.font = "500 30px " + F.mono;
      if ("letterSpacing" in g) g.letterSpacing = "4px";
      g.fillStyle = "#b9bdf0"; g.fillText((S.hudDate ? S.hudDate + "  " : "") + st.time, 6, 34);
      g.fillStyle = online > 0 ? "#8d93c8" : "#ff6fe0"; g.font = "500 26px " + F.mono;
      g.fillText("ONLINE " + pad2(online) + " / " + pad2(n), 6, 80);
    });
  }

  /* show state -> screen state */
  function win(t, a, len) { return t >= a && t < a + len ? 1 - (t - a) / len : 0; }
  function applyShow(t) {
    if (!S || !S.ph) return;
    var st = S.ph.st, n = st.n, i, on = 0;
    var glitch = 0, sign = 0.38, mag = 0;
    if (t < 0) {
      st.timeIdx = 27; st.dateIdx = 0; st.flash = 0; st.stamp = 0; st.stampScale = 1; st.dim = 1;
      for (i = 0; i < 10; i++) st.lit[i] = 1;
    } else {
      st.timeIdx = t < 0.9 ? 27 : t < 1.8 ? 28 : t < 2.7 ? 29 : 30;
      st.dateIdx = t >= SHOW.zero ? 1 : 0;
      st.flash = t >= SHOW.zero ? Math.max(0, 1 - (t - SHOW.zero) / 0.5) : 0;
      for (i = 0; i < 10; i++) {
        var d0 = SHOW.dark0 + i * SHOW.dark1;
        st.lit[i] = 1 - kit.smoothstep(d0, d0 + 0.3, t);
      }
      var sp = kit.clamp((t - SHOW.stamp) / 0.32, 0, 1);
      st.stamp = sp; st.stampScale = 1.5 - 0.5 * kit.easeOutCubic(sp);
      st.dim = 1 - 0.4 * kit.smoothstep(5.6, 6.4, t);
      if (!S.reduced) glitch = Math.max(win(t, SHOW.zero, 0.45), win(t, SHOW.stamp, 0.3), win(t, 6.25, 0.5));
      sign = 0.38 + 0.87 * kit.smoothstep(5.8, 6.3, t);
      mag = kit.smoothstep(SHOW.zero, SHOW.zero + 0.4, t) * 0.5 + kit.smoothstep(5.8, 6.3, t) * 0.5;
    }
    st.time = TIMES[st.timeIdx];
    st.date = st.dateIdx ? "10 DEC 2025" : "9 DEC 2025";
    for (i = 0; i < n; i++) if (st.lit[i] > 0.5) on++;
    S.fx.glitch = glitch; S.fx.aber = 0.7 + glitch * 3.0;
    S.signT = sign; S.magT = mag;
    var key = st.timeIdx * 100 + on;
    if (key !== S.hudKey) { S.hudKey = key; drawHud(on); }
    S.ph.refresh(t <= 0 || t >= SHOW.end || S.forceRefresh, S.clock);
    S.forceRefresh = false;
  }

  /* logo chips in the label panel */
  var panelRoot = null, panelUnsub = null;
  function paintChips() {
    if (!panelRoot) return;
    var cs = panelRoot.querySelectorAll(".hh3-ico"), k;
    for (k = 0; k < cs.length; k++) {
      var g = cs[k].getContext("2d");
      g.clearRect(0, 0, 40, 40);
      drawLogo(g, cs[k].getAttribute("data-n"), k, 0, 0, 40, 1);
    }
  }

  /* ---------------- room definition ---------------- */
  HH.registerRoom(3, {
    build: function (ctx) { return build(ctx); },

    enter: function (ctx) {
      if (!S) return;
      S.active = true;
      S.t = S.reduced ? SHOW.end : 0;
      S.forceRefresh = true;
      applyShow(S.t);
    },

    leave: function (ctx) {
      if (!S) return;
      S.active = false;
      S.t = -1;
      S.forceRefresh = true;
      applyShow(-1);
    },

    /* test hook: jump the show to a time in seconds (not used by the engine) */
    debugSeek: function (t) { if (S) { S.active = true; S.t = Math.max(0, t); S.forceRefresh = true; applyShow(S.t); } },

    update: function (ctx, dt, t, state) {
      if (!S || !S.ph) return;
      dt = Math.min(dt || 0, 0.1);
      S.clock += dt;
      if (state && state.visible === false) return;
      var red = S.reduced, ph = S.ph, U = ph.mat.uniforms, i, clk = S.clock;
      var tt = red ? 0 : clk;

      // show clock
      if (S.t >= 0 && S.t < SHOW.end) { S.t = Math.min(SHOW.end, S.t + dt); applyShow(S.t); }
      else ph.refresh(false, clk);
      var showT = S.t;

      // shader + haze time
      U.uTime.value = tt; S.haze.U.uTime.value = tt;
      U.uGlitch.value = S.fx.glitch; U.uAber.value = S.fx.aber;

      // phone float, thud at midnight
      var thud = showT >= SHOW.zero && showT < SHOW.zero + 0.4 && !red ? Math.sin(PI * (showT - SHOW.zero) / 0.4) : 0;
      ph.group.position.set(HERO.x, HERO.y + (red ? 0 : Math.sin(clk * 0.53) * 0.02) - thud * 0.04, HERO.z - thud * 0.1);
      ph.group.rotation.y = HERO.yaw + (red ? 0 : Math.sin(clk * 0.31) * 0.025);
      ph.group.rotation.z = red ? 0 : Math.sin(clk * 0.4) * 0.008;

      // magenta takes over the rim and glow after the blackout
      S.magK = kit.damp(S.magK, S.magT || 0, 5, dt);
      ph.glowM.material.opacity = 0.3 * S.magK;
      ph.glowV.material.opacity = 0.2 - 0.08 * S.magK;
      var rimK = 0.95 + 0.4 * S.magK + (S.active ? 0.1 : 0);
      ph.rimR.material.color.copy(ph.rimBaseR).multiplyScalar(rimK);
      ph.rimL.material.color.copy(ph.rimBaseL).multiplyScalar(rimK * (1 - 0.35 * S.magK));
      S.ringMat.color.copy(S.magK > 0.5 ? S.cMag : S.cCyan);
      if (!red) S.ring.rotation.z = clk * 0.12;

      // sign: dim until the stamp lands, then full; short flicker during the glitch
      var tgt = S.signT == null ? 0.38 : S.signT;
      S.signK = kit.damp(S.signK, tgt, 6, dt);
      var sk = S.signK;
      if (!red && S.fx.glitch > 0.05) sk *= 0.45 + 0.9 * hash(Math.floor(clk * 24));
      S.signMat.color.setScalar(sk);
      S.frameMat.color.copy(S.frameBase).multiplyScalar(0.4 + 0.6 * Math.min(1.2, sk));
      S.recDot.material.color.copy(S.recBase).multiplyScalar(red || Math.sin(clk * 3.2) > -0.2 ? 1 : 0.2);

      // ticker scroll
      if (!red) S.tickTex.offset.x = (S.tickTex.offset.x + dt * 0.05) % 1;

      // links
      S.flash = Math.max(0, S.flash - dt * 1.8);
      for (i = 0; i < S.links.length; i++) {
        var L = S.links[i];
        L.flash = Math.max(0, L.flash - dt * 2);
        var pulse = S.active && !red ? 0.08 * Math.sin(clk * 2.4 + i) : 0;
        L.word.material.color.setScalar(0.95 + pulse + L.flash * 0.9);
      }

      // cards: hover, then fall at midnight
      for (i = 0; i < S.cards.length; i++) {
        var c = S.cards[i], m = c.mesh, fall = showT >= 0 ? showT - (SHOW.zero + c.delay) : -1;
        if (fall <= 0) {
          m.visible = true;
          m.position.set(c.x, c.y + (red ? 0 : Math.sin(clk * 0.8 + c.ph) * 0.05), c.z);
          m.rotation.set(0, c.ry, red ? 0 : Math.sin(clk * 0.5 + c.ph) * 0.04);
          c.mat.opacity = 0.96;
        } else {
          var tau = Math.min(fall, c.tHit);
          m.position.set(c.x + c.vx * tau, Math.max(0.2, c.y - 0.5 * G_ * tau * tau), c.z + c.vz * tau);
          m.rotation.set(c.tilt * tau, c.ry, c.spin * tau);
          var fade = 1 - kit.clamp((fall - c.tHit) / 0.8, 0, 1);
          c.mat.opacity = 0.96 * fade;
          m.visible = fade > 0.01;
        }
      }
    },

    panel: function (el, ctx) {
      if (!el) return;
      var ex = (ctx && ctx.exhibit) || {}, f = ex.facts || {}, plats = f.platforms || [], esc = HH.kit.esc, h = "";
      if (plats.length) {
        h += '<div class="hh-sec"><div class="hh-h">' + plats.length + ' platforms</div><div class="hh-row">';
        plats.forEach(function (p) { h += '<span class="hh-chip"><canvas class="hh3-ico" width="40" height="40" data-n="' + esc(p) + '"></canvas>' + esc(p) + "</span>"; });
        h += "</div></div>";
      }
      el.innerHTML = h;
      if (ctx) loadAtlas(ctx);
      kit.injectCSS("hh-room3-chip-css", ".hh3-ico{width:20px;height:20px;border-radius:5px;vertical-align:-5px;margin-right:7px}");
      panelRoot = el;
      paintChips();
      if (!panelUnsub) panelUnsub = atlasSub(paintChips);
    },

    immersive: {
      title: "Blackout",
      cta: "Step inside the blackout",
      mount: function (scroller, ctx) { return mountImmersive(scroller, ctx); }
    }
  });

  /* =====================================================================
     IMMERSIVE
     ===================================================================== */
  var FLOOR_Y = -2.2;

  function injectHudCSS() {
    kit.injectCSS("hh-room3-css", [
      ".hh3-hud{position:absolute;inset:0;pointer-events:none;font:500 11px/1.4 " + F.mono + ";letter-spacing:.16em;text-transform:uppercase;color:" + T.dim + "}",
      ".hh3-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(184,139,255,.04) 0 1px,transparent 1px 3px)}",
      ".hh3-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 58%,rgba(2,3,10,.5) 100%)}",
      ".hh3-b{position:absolute;width:22px;height:22px;border:0 solid rgba(184,139,255,.6)}",
      ".hh3-b.tl{top:max(14px,2.2vh);left:max(14px,2.2vw);border-top-width:1px;border-left-width:1px}",
      ".hh3-b.tr{top:max(14px,2.2vh);right:max(14px,2.2vw);border-top-width:1px;border-right-width:1px}",
      ".hh3-b.bl{bottom:max(14px,2.2vh);left:max(14px,2.2vw);border-bottom-width:1px;border-left-width:1px}",
      ".hh3-b.br{bottom:max(14px,2.2vh);right:max(14px,2.2vw);border-bottom-width:1px;border-right-width:1px}",
      ".hh3-t{position:absolute;text-shadow:0 0 8px rgba(184,139,255,.5),1px 0 rgba(255,63,208,.45),-1px 0 rgba(60,236,255,.45)}",
      ".hh3-t.tl{top:calc(var(--top, 0px) + 66px);left:calc(max(14px,2.2vw) + 32px)}",
      ".hh3-t.tr{top:calc(var(--top, 0px) + 66px);right:calc(max(14px,2.2vw) + 32px);color:" + T.magenta + "}",
      ".hh3-t.bl{bottom:calc(max(14px,2.2vh) + 6px);left:calc(max(14px,2.2vw) + 32px)}",
      ".hh3-rec{display:inline-block;width:7px;height:7px;border-radius:50%;background:" + T.magenta + ";margin-right:8px;box-shadow:0 0 8px " + T.magenta + ";animation:hh3blink 1.2s steps(2,jump-none) infinite}",
      ".hh3-ck{color:" + T.white + ";font-size:13px}",
      "@keyframes hh3blink{50%{opacity:.15}}",
      "@media (prefers-reduced-motion: reduce){.hh3-rec{animation:none}}",
      "@media (max-width:560px){.hh3-t{font-size:10px;letter-spacing:.1em}}"
    ].join("\n"));
  }

  var POST_FS = [
    "uniform sampler2D tDiffuse;uniform float uTime;uniform float uAber;uniform float uGlitch;uniform float uGrain;varying vec2 vUv;",
    "float h2(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}",
    "void main(){",
    "  vec2 uv=vUv;vec2 d=uv-0.5;",
    "  float tk=floor(uTime*18.0);float blk=floor(uv.y*34.0);",
    "  float on=step(0.9,h2(vec2(blk,tk)))*uGlitch;",
    "  uv.x+=on*(h2(vec2(blk+3.0,tk))-0.5)*0.07;",
    "  float k=uAber*0.006+on*0.012;",
    "  vec3 c;",
    "  c.r=texture2D(tDiffuse,uv+d*k).r;c.g=texture2D(tDiffuse,uv).g;c.b=texture2D(tDiffuse,uv-d*k).b;",
    "  c*=1.0-0.04*(0.5+0.5*sin(gl_FragCoord.y*2.0944));",
    "  c+=(h2(gl_FragCoord.xy+tk*7.0)-0.5)*0.03*uGrain;",
    "  c*=1.0-0.8*dot(d,d);",
    "  gl_FragColor=vec4(c,1.0);",
    "}"
  ].join("\n");

  function mountImmersive(scroller, ctx) {
    var ex = ctx.exhibit || {}, facts = ex.facts || {}, site = ctx.site || HH.SITE || {};
    var names = (facts.platforms || []).map(str).slice(0, 10), nT = names.length;
    var low = ctx.quality === "low";
    var reduced = !!ctx.reducedMotion || !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    kit.injectUICSS(); injectHudCSS(); loadAtlas(ctx);
    var unsubAtlas = null;

    /* chapters */
    var chs = [];
    chs.push({ kicker: "23:59 · DEC. 9, 2025", title: "One minute left", side: "left" });
    chs.push({ kicker: "00:00 · DEC. 10, 2025", title: "The ban takes effect", body: "Australia. Users under 16 can no longer have accounts.", side: "right" });
    chs.push({ kicker: (nT || 10) + " PLATFORMS", title: names.join(" · "), side: "left" });
    chs.push({ kicker: str(facts.fine) ? "UP TO " + str(facts.fine).toUpperCase() : "FINES", title: "Fines are for the companies, not the teens", side: "right" });
    var hasTeen = !!str(facts.teenName);
    if (hasTeen) {
      var q = str(facts.teenQuote);
      chs.push({
        kicker: "WHO IS IN THE STORY", side: "left",
        title: str(facts.teenName) + (str(facts.teenAge) ? ", " + str(facts.teenAge) : ""),
        body: q ? "“" + q + "”" : "",
        html: '<div class="hh-ch-k" style="margin-top:10px;color:' + T.dim + '">BBC News</div>'
      });
    }
    chs.push({
      kicker: str(site.genZ || "Generation Z · born 1997–2012").toUpperCase(), title: "Dark screen", side: "right",
      html: '<div style="margin-top:14px;pointer-events:auto"><button type="button" class="hh-btn hh-room3-back" style="pointer-events:auto">Back to the museum</button></div>'
    });
    var n = chs.length;
    chs.forEach(function (c, i) { c.at = i / (n - 1); });
    var A = { a1: chs[1].at, a2: chs[2].at, a3: chs[3].at, teen: hasTeen ? chs[4].at : null };
    var sideSign = chs.map(function (c) { return c.side === "left" ? 1 : c.side === "right" ? -1 : 0; });

    var IM = {
      phone: null, tiles: [], cards: [], A: A, off: 0, hud: null, hudClock: "", hudOnTxt: "", post: null,
      cCyan: kit.color(T.cyan, 0.6), cMag: kit.color(T.magenta, 0.6),
      qPhone: new THREE.Quaternion(), qA: new THREE.Quaternion(), yAxis: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3()
    };

    /* camera choreography: azimuth / radius / height around the phone, plus a look target */
    var pileP = n === 6 ? chs[4].at : (A.a3 + 1) / 2;
    var K = [
      { p: 0, az: 0.42, r: 9.0, h: 1.1, lx: 0, ly: 0.2, lz: 0 },
      { p: A.a1, az: 0.08, r: 5.0, h: 0.2, lx: 0, ly: 0.1, lz: 0 },
      { p: A.a2, az: -0.8, r: 7.2, h: 1.3, lx: 0, ly: 0, lz: 0 },
      { p: A.a3, az: 0.5, r: 8.0, h: 1.0, lx: 0, ly: -0.6, lz: 0 },
      { p: pileP, az: 0.25, r: 7.4, h: 1.3, lx: 0.2, ly: -0.5, lz: 0.4 },
      { p: 1, az: 0.0, r: 5.4, h: 0.1, lx: 0, ly: 0, lz: 0 }
    ];

    var stage = kit.immersiveStage(scroller, {
      length: 6,
      chapters: chs,
      setup: function (s) { setup(s); },
      frame: function (p, dt, t, s) { frame(p, dt, t, s); }
    });

    var chEls = scroller.querySelectorAll(".hh-ch");
    if (chEls[2]) { var t3 = chEls[2].querySelector(".hh-ch-t"); if (t3) t3.style.fontSize = "clamp(20px,2.6vw,34px)"; }
    var backBtn = scroller.querySelector(".hh-room3-back");
    function onBack() { window.dispatchEvent(new CustomEvent("hh:close-immersive")); }
    if (backBtn) backBtn.addEventListener("click", onBack);

    /* one tile texture (own closure per tile, so a later redraw keeps the right logo) */
    function tileTex(idx, lit, tcs) {
      return kit.canvasTexture(tcs, tcs, function (g, w) {
        var k = w / 192;
        g.setTransform(k, 0, 0, k, 0, 0);
        drawTile(g, 96, 14, idx, lit, names[idx], lit ? BADGES[idx % 10] : 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      });
    }

    /* ---------- scene ---------- */
    function setup(s) {
      var scene = s.scene, i;
      scene.fog = new THREE.Fog(kit.color(T.void), 9, 34);
      scene.add(new THREE.AmbientLight(kit.color("#5a60b0"), 0.55));
      var lm = new THREE.PointLight(kit.color(T.magenta), 1.6, 16); lm.position.set(4.5, 1.2, 3.5); scene.add(lm);
      var lc = new THREE.PointLight(kit.color(T.cyan), 1.5, 16); lc.position.set(-4.5, 0.8, 3.5); scene.add(lc);

      // phone
      var ph = buildPhone({ low: low, names: names, tiles: false });
      scene.add(ph.group); IM.phone = ph;
      ph.mat.uniforms.uBright.value = 0.92;

      // floor grid + emitter ring
      var fg = kit.canvasTexture(256, 256, function (g) {
        g.clearRect(0, 0, 256, 256);
        g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 2;
        g.strokeRect(1, 1, 254, 254);
      });
      fg.wrapS = fg.wrapT = THREE.RepeatWrapping; fg.repeat.set(70, 70);
      var fm = new THREE.MeshBasicMaterial({ map: fg, color: kit.color(T.violet, 0.22), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      fm.toneMapped = false;
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), fm);
      floor.rotation.x = -PI / 2; floor.position.y = FLOOR_Y; scene.add(floor);
      var floorBase = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ color: kit.color("#05061a") }));
      floorBase.rotation.x = -PI / 2; floorBase.position.y = FLOOR_Y - 0.01; scene.add(floorBase);
      var rm = new THREE.MeshBasicMaterial({ map: ringTex(low), color: kit.color(T.cyan, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      rm.toneMapped = false;
      var ring = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), rm);
      ring.rotation.x = -PI / 2; ring.position.y = FLOOR_Y + 0.01; scene.add(ring); IM.ring = ring; IM.ringMat = rm;

      // skyline layers
      [[-34, 7, 100, 24, 11, 0.8, false], [-21, 4.6, 64, 15, 23, 0.6, true]].forEach(function (d) {
        var m = new THREE.MeshBasicMaterial({ map: skylineTex(d[4], low, d[6]), transparent: true, depthWrite: false, fog: false, color: kit.color("#ffffff", d[5]) });
        m.toneMapped = false;
        var sk = new THREE.Mesh(new THREE.PlaneGeometry(d[2], d[3]), m);
        sk.position.set(0, d[1], d[0]); scene.add(sk);
      });

      // neon bars flanking the scene
      [[-7.5, T.cyan], [7.5, T.magenta]].forEach(function (d) {
        scene.add(kit.neonTube([new THREE.Vector3(d[0], FLOOR_Y, -4.5), new THREE.Vector3(d[0], 5.5, -4.5)], { radius: 0.035, color: d[1], intensity: 1.3, segments: 4 }));
        var gs = kit.glowSprite(d[1], 2.6, 0.16); gs.position.set(d[0], 1.5, -4.4); scene.add(gs);
      });

      // haze + data rain
      var hz = makeHaze({ seed: 71, dust: low ? 70 : 150, rain: low ? 40 : 90, x0: -7, x1: 7, z0: -3.5, z1: 6, y0: FLOOR_Y, y1: 4.6, cx: 0, cw: 5, size: 0.085 });
      scene.add(hz.dust); scene.add(hz.rain); IM.haze = hz;

      // tiles
      var tcs = low ? 128 : 192, TS = 192 * PXM, tileGeo = new THREE.PlaneGeometry(TS, TS);
      IM.ATTX = []; IM.ATTY = []; IM.OR = []; IM.OY = []; IM.OPH = []; IM.PX = []; IM.PY = []; IM.PZ = []; IM.QP = [];
      var rr = kit.rand(515), eul = new THREE.Euler();
      for (i = 0; i < nT; i++) {
        tilePos(i, nT, TP);
        IM.ATTX.push((TP.cx - 256) * PXM); IM.ATTY.push((512 - (TP.top + 82)) * PXM);
        IM.OR.push(1.9 + 0.32 * (i % 3)); IM.OY.push(1.25 * Math.sin(i * 2.2 + 0.4)); IM.OPH.push(rr() * 0.5);
        IM.PX.push((rr() - 0.5) * 2.2); IM.PZ.push(0.2 + rr() * 1.6); IM.PY.push(FLOOR_Y + 0.02 + i * 0.012);
        IM.QP.push(new THREE.Quaternion().setFromAxisAngle(IM.yAxis, rr() * TAU).multiply(new THREE.Quaternion().setFromEuler(eul.set(-PI / 2 + (rr() - 0.5) * 0.12, 0, 0))));
        var litT = tileTex(i, 1, tcs), darkT = tileTex(i, 0, tcs);
        var mat = new THREE.MeshBasicMaterial({ map: litT, transparent: true, depthWrite: false });
        mat.toneMapped = false;
        var mesh = new THREE.Mesh(tileGeo, mat);
        scene.add(mesh);
        IM.tiles.push({ mesh: mesh, mat: mat, lit: litT, dark: darkT, isDark: false });
      }

      // notification cards rising in chapter 1
      var nC = low ? 5 : 8;
      for (i = 0; i < nC && nT; i++) {
        var ci = (i * 3 + 1) % nT;
        var cm = new THREE.MeshBasicMaterial({ map: cardTex(names[ci], ci, low), transparent: true, depthWrite: false, opacity: 0 });
        cm.toneMapped = false;
        var cmesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.312), cm);
        cmesh.visible = false; scene.add(cmesh);
        var sgn = i % 2 ? 1 : -1;
        IM.cards.push({ mesh: cmesh, mat: cm, x: sgn * (1.25 + 0.4 * (i % 3)), y0: -2.4 - i * 0.55, z: 0.3 + 0.25 * (i % 4), rise: 3.6 + (i % 3) * 0.6, drop: 5 + i * 0.3, ph: i * 1.3, ry: -sgn * 0.25 });
      }

      // redraw logos when the atlas arrives
      unsubAtlas = atlasSub(function () {
        if (IM.phone) IM.phone.refresh(true, 0);
        IM.tiles.forEach(function (t) { t.lit.redraw(); t.dark.redraw(); });
        IM.cards.forEach(function (c) { if (c.mat.map && c.mat.map.redraw) c.mat.map.redraw(); });
      });

      // glass-pass finish: chromatic split, scanlines, grain, vignette
      if (THREE.ShaderPass && s.pipeline && s.pipeline.composer) {
        try {
          var gp = new THREE.ShaderPass({
            uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAber: { value: 0.6 }, uGlitch: { value: 0 }, uGrain: { value: reduced ? 0 : 1 } },
            vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
            fragmentShader: POST_FS
          });
          s.pipeline.composer.addPass(gp); IM.post = gp;
        } catch (e) { IM.post = null; }
      }

      // HUD overlay (DOM, crisp)
      var pin = s.root.querySelector(".hh-stage-pin");
      if (pin) {
        var hud = document.createElement("div"); hud.className = "hh3-hud";
        hud.innerHTML = '<div class="hh3-scan"></div><div class="hh3-vig"></div><i class="hh3-b tl"></i><i class="hh3-b tr"></i><i class="hh3-b bl"></i><i class="hh3-b br"></i>' +
          '<div class="hh3-t tl">SYS · CH 03</div><div class="hh3-t tr"><span class="hh3-rec"></span>REC</div>' +
          '<div class="hh3-t bl"><div>' + kit.esc(str(facts.date)) + '</div><div class="hh3-ck" data-k="ck">23:59:30</div><div data-k="on">ONLINE ' + pad2(nT) + ' / ' + pad2(nT) + '</div></div>';
        pin.appendChild(hud);
        IM.hud = hud; IM.hudCk = hud.querySelector('[data-k="ck"]'); IM.hudOnEl = hud.querySelector('[data-k="on"]'); IM.hudOnTxt = "";
      }
    }

    /* ---------- per frame ---------- */
    var cq = new THREE.Quaternion(), eulY = new THREE.Euler();
    function frame(p, dt, t, s) {
      var ph = IM.phone, st = ph.st, U = ph.mat.uniforms, cam = s.camera, i;
      if (!ph) return;
      var mt = reduced ? 0 : t;
      var w1 = A.a2 - A.a1, w3 = A.a3 - A.a2;

      /* --- timeline factors (everything is a pure function of p, so scrubbing back works) --- */
      var clk = kit.clamp(p / (A.a1 - 0.025), 0, 1);
      var flip = p >= A.a1 - 0.02;
      st.timeIdx = flip ? 30 : Math.min(29, Math.floor(clk * 30));
      st.time = TIMES[st.timeIdx]; st.dateIdx = flip ? 1 : 0; st.date = flip ? "10 DEC 2025" : "9 DEC 2025";
      st.flash = flip ? 1 - kit.smoothstep(A.a1 - 0.02, A.a1 + 0.05, p) : 0;
      var stampIn = kit.smoothstep(A.a1, A.a1 + 0.045, p);
      st.stamp = stampIn * (1 - kit.smoothstep(A.a3 - 0.06, A.a3 + 0.02, p));
      st.stampScale = 1.5 - 0.5 * kit.easeOutCubic(stampIn);
      var dRaw = kit.smoothstep(A.a2 - 0.5 * w1, A.a2 + 0.3 * w1, p);
      st.slots = dRaw > 0.02;
      var ds0 = A.a2 + 0.08 * w3, ds1 = A.a3 - 0.06 * w3;
      var fRaw = kit.smoothstep(A.a3 - 0.3 * w3, A.a3 + 0.75 * w3, p);
      var glass = kit.smoothstep(0.84, 0.98, p);
      st.dim = 1 - 0.35 * kit.smoothstep(A.a2, A.a3, p);
      var glitch = reduced ? 0 : Math.max(0, 1 - Math.abs(p - (A.a1 + 0.03)) / 0.035, (1 - Math.abs(p - (A.a3 - 0.02)) / 0.03) * 0.6);
      glitch = Math.max(0, glitch);
      var blackout = kit.smoothstep(A.a1 - 0.02, A.a1 + 0.04, p);

      /* --- camera --- */
      var j = 0; while (j < K.length - 2 && p > K[j + 1].p) j++;
      var a = K[j], b = K[j + 1];
      var u = kit.clamp((p - a.p) / Math.max(1e-4, b.p - a.p), 0, 1);
      var e = u * 0.35 + kit.easeInOutSine(u) * 0.65;
      var portrait = cam.aspect < 0.9;
      var r = kit.lerp(a.r, b.r, e) * (portrait ? 1.5 : 1);
      var az = kit.lerp(a.az, b.az, e), h = kit.lerp(a.h, b.h, e);
      var sway = reduced ? 0 : 1;
      cam.position.set(Math.sin(az) * r + Math.sin(mt * 0.23) * 0.12 * sway, h + Math.sin(mt * 0.31) * 0.07 * sway, Math.cos(az) * r);
      IM.look.set(kit.lerp(a.lx, b.lx, e), kit.lerp(a.ly, b.ly, e), kit.lerp(a.lz, b.lz, e));
      cam.lookAt(IM.look);
      if (glitch > 0) cam.rotateZ(Math.sin(p * 900) * 0.012 * glitch);
      // shift the subject to the side opposite the chapter text
      var f = p * (n - 1), i0 = Math.min(n - 2, Math.floor(f)), fr = f - i0;
      var sv = kit.lerp(sideSign[i0], sideSign[i0 + 1], kit.smoothstep(0.35, 0.65, fr));
      IM.off = reduced ? sv : kit.damp(IM.off, sv, 4, dt);
      var cwid = s.renderer.domElement.clientWidth || 1, chei = s.renderer.domElement.clientHeight || 1;
      if (portrait) cam.setViewOffset(cwid, chei, 0, chei * 0.2, cwid, chei);
      else cam.setViewOffset(cwid, chei, -IM.off * cwid * 0.19, 0, cwid, chei);

      /* --- phone --- */
      var yaw = 0.35 * (1 - kit.smoothstep(0, A.a1, p)) + (-0.14) * kit.smoothstep(A.a2, A.a3, p);
      yaw *= 1 - glass;
      var bob = Math.sin(mt * 0.6) * 0.05 * (1 - glass * 0.6);
      var sy = yaw + Math.sin(mt * 0.35) * 0.04 * (1 - glass);
      ph.group.position.set(0, bob, 0);
      ph.group.rotation.set(0, sy, 0);
      var sinY = Math.sin(sy), cosY = Math.cos(sy);
      ph.mat.uniforms.uTime.value = mt;
      U.uGlitch.value = glitch; U.uAber.value = 0.7 + glitch * 3.0; U.uGlass.value = glass;
      U.uShift.value = cam.position.x * 0.07 + (reduced ? 0 : Math.sin(mt * 0.3) * 0.03);
      ph.glowM.material.opacity = 0.32 * blackout * (1 - 0.6 * kit.smoothstep(A.a3, A.a3 + 0.2, p)) * (1 - glass);
      ph.glowV.material.opacity = (0.26 - 0.12 * blackout) * (1 - glass);
      var rimK = 1.0 + 0.5 * blackout;
      ph.rimR.material.color.copy(ph.rimBaseR).multiplyScalar(rimK);
      ph.rimL.material.color.copy(ph.rimBaseL).multiplyScalar(rimK);
      IM.haze.U.uTime.value = mt;
      IM.ring.rotation.z = mt * 0.1;
      IM.ringMat.color.copy(blackout > 0.5 ? IM.cMag : IM.cCyan);

      /* --- tiles --- */
      var spin = (Math.min(p, A.a3) - A.a2) * 9;
      IM.qPhone.setFromAxisAngle(IM.yAxis, sy);
      cq.copy(cam.quaternion);
      var onCount = 0;
      for (i = 0; i < nT; i++) {
        var tl = IM.tiles[i], m = tl.mesh;
        var d0 = ds0 + (ds1 - ds0) * 0.8 * (i / Math.max(1, nT - 1));
        var lit = 1 - kit.smoothstep(d0, d0 + 0.2 * (ds1 - ds0), p);
        st.lit[i] = lit; if (lit > 0.5) onCount++;
        var dk = lit < 0.5;
        if (tl.isDark !== dk) { tl.isDark = dk; tl.mat.map = dk ? tl.dark : tl.lit; }
        tl.mat.color.setScalar(0.35 + 0.65 * Math.abs(lit - 0.5) * 2);
        var dI = kit.smoothstep(0, 1, kit.clamp(dRaw * 1.6 - (i / nT) * 0.6, 0, 1));
        var fI = kit.clamp(fRaw * 1.5 - (i / nT) * 0.5, 0, 1);
        var ax = IM.ATTX[i] * cosY + 0.075 * sinY, az2 = -IM.ATTX[i] * sinY + 0.075 * cosY, ay = IM.ATTY[i] + bob;
        var th = i / nT * TAU + spin + IM.OPH[i];
        var ox = Math.cos(th) * IM.OR[i], oz = Math.sin(th) * IM.OR[i] * 0.9, oy = IM.OY[i] + 0.3 * Math.sin(th);
        var x = ax + (ox - ax) * dI, y = ay + (oy - ay) * dI, z = az2 + (oz - az2) * dI;
        var fe = kit.easeInOutSine(fI);
        x += (IM.PX[i] - x) * fe; z += (IM.PZ[i] - z) * fe; y += (IM.PY[i] - y) * fI * fI;
        m.position.set(x, y, z);
        IM.qA.copy(IM.qPhone).slerp(cq, dI).slerp(IM.QP[i], fe);
        m.quaternion.copy(IM.qA);
        m.scale.setScalar(1 + 0.12 * dI * (1 - fI) + 0.3 * fI);
      }

      /* --- notification cards rising, then dropping at midnight --- */
      var rise = p / Math.max(0.01, A.a1), fall = kit.smoothstep(A.a1 - 0.01, A.a1 + 0.09, p);
      var cop = kit.smoothstep(0, 0.03, p) * (1 - kit.smoothstep(A.a1 + 0.03, A.a1 + 0.1, p)) * 0.96;
      for (i = 0; i < IM.cards.length; i++) {
        var c = IM.cards[i];
        c.mat.opacity = cop;
        c.mesh.visible = cop > 0.01;
        if (c.mesh.visible) {
          c.mesh.position.set(c.x + Math.sin(mt * 0.7 + c.ph) * 0.05, c.y0 + c.rise * rise - fall * fall * c.drop, c.z);
          c.mesh.rotation.set(0, c.ry, Math.sin(mt * 0.5 + c.ph) * 0.04 + fall * fall * 0.8 * (i % 2 ? 1 : -1));
        }
      }

      /* --- screen redraw (only when content changed) --- */
      ph.refresh(false, t);

      /* --- post + HUD --- */
      if (IM.post) {
        IM.post.uniforms.uTime.value = mt; IM.post.uniforms.uGlitch.value = glitch * 0.7;
        IM.post.uniforms.uAber.value = 0.6 + glitch * 3.5 + glass * 0.4;
      }
      if (IM.hudCk) {
        if (st.time !== IM.hudClock) { IM.hudClock = st.time; IM.hudCk.textContent = st.time; }
        var onTxt = "ONLINE " + pad2(onCount) + " / " + pad2(nT);
        if (onTxt !== IM.hudOnTxt) { IM.hudOnTxt = onTxt; if (IM.hudOnEl) IM.hudOnEl.textContent = onTxt; }
      }
      void eulY;
    }

    return {
      destroy: function () {
        if (backBtn) backBtn.removeEventListener("click", onBack);
        if (unsubAtlas) { unsubAtlas(); unsubAtlas = null; }
        try { stage.stage.camera.clearViewOffset(); } catch (e) {}
        stage.destroy();
      }
    };
  }
})();
