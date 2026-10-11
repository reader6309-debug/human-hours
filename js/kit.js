/* Human Hours · shared kit (helpers used by the engine, every room, and the dev harness).
   Requires THREE r128 (global) plus examples/js EffectComposer, RenderPass, ShaderPass,
   UnrealBloomPass, CopyShader, LuminosityHighPassShader, GammaCorrectionShader. */
var HH = window.HH = window.HH || {};
(function () {
  "use strict";
  var kit = HH.kit = HH.kit || {};

  /* Rooms register themselves here; the engine (or dev harness) builds them. */
  HH.rooms = HH.rooms || {};
  HH.registerRoom = function (n, def) { HH.rooms[n] = def; };

  /* ---------- palette + type ---------- */
  HH.THEME = {
    void: "#04050c",    // deepest background, fog
    navy: "#0a0f2e",    // walls
    navy2: "#131a48",   // raised panels
    ink: "#1d2566",     // trims, grid lines
    purple: "#7b3bff",  // main structure neon
    violet: "#b88bff",  // soft neon, secondary text glow
    magenta: "#ff3fd0", // rare accent (alarm, blackout, web)
    cyan: "#3cecff",    // MACHINE time
    amber: "#ffb23f",   // HUMAN time
    white: "#eef0ff",
    dim: "#8d93c8"
  };
  HH.FONTS = {
    display: '"Chakra Petch", "Noto Sans KR", system-ui, sans-serif',
    neon: '"Tilt Neon", "Chakra Petch", system-ui, sans-serif',
    body: '"IBM Plex Sans", "Noto Sans KR", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
    kr: '"Noto Sans KR", system-ui, sans-serif',
    krDisplay: '"Black Han Sans", "Noto Sans KR", system-ui, sans-serif'
  };
  HH.FONT_URL = "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Chakra+Petch:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans+KR:wght@400;700;900&family=Tilt+Neon&display=swap";

  /* Resolves when the faces used on canvas are loaded (or after 3 s, whichever first). */
  kit.loadFonts = function () {
    if (kit._fonts) return kit._fonts;
    var faces = ['700 64px "Chakra Petch"', '400 64px "Chakra Petch"', '400 64px "Tilt Neon"', '400 32px "IBM Plex Mono"',
      '500 32px "IBM Plex Sans"', '700 64px "Noto Sans KR"', '400 64px "Black Han Sans"'];
    var all = document.fonts && document.fonts.load
      ? Promise.all(faces.map(function (f) { return document.fonts.load(f, "Aa가").catch(function () {}); }))
      : Promise.resolve();
    kit._fonts = Promise.race([all, new Promise(function (r) { setTimeout(r, 3000); })]);
    return kit._fonts;
  };

  /* ---------- math ---------- */
  kit.clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  kit.lerp = function (a, b, t) { return a + (b - a) * t; };
  kit.smoothstep = function (a, b, x) { var t = kit.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  kit.easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  kit.easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  kit.easeOutExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  kit.easeInOutSine = function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; };
  /* Frame-rate independent exponential smoothing. */
  kit.damp = function (cur, target, lambda, dt) { return kit.lerp(cur, target, 1 - Math.exp(-lambda * dt)); };
  /* Deterministic random: var r = kit.rand(42); r() -> [0,1). */
  kit.rand = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  kit.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---------- color ----------
     The pipeline ends in a gamma pass, so material colors must be linear.
     ALWAYS build material colors with kit.color("#hex"). */
  kit.color = function (hex, mul) {
    var c = new THREE.Color(hex).convertSRGBToLinear();
    if (mul) c.multiplyScalar(mul);
    return c;
  };

  /* ---------- materials ---------- */
  /* Self-lit neon. intensity > 1 pushes it past the bloom threshold. */
  kit.neonMat = function (hex, intensity, extra) {
    var m = new THREE.MeshBasicMaterial(Object.assign({ color: kit.color(hex, intensity || 1.4) }, extra || {}));
    m.toneMapped = false;
    return m;
  };
  /* Dark lit surface (walls, plinths, frames). Stays under the bloom threshold. */
  kit.darkMat = function (hex, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: kit.color(hex || HH.THEME.navy), roughness: 0.62, metalness: 0.25
    }, opts || {}));
  };

  /* ---------- textures ---------- */
  kit._texCache = {};
  kit.loadTexture = function (url) {
    if (kit._texCache[url]) return kit._texCache[url];
    var p = new Promise(function (resolve, reject) {
      new THREE.TextureLoader().load(url, function (t) {
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;
        resolve(t);
      }, undefined, function (e) { reject(e || new Error("texture failed: " + url)); });
    });
    kit._texCache[url] = p;
    return p;
  };
  /* Canvas texture. draw(ctx2d, w, h) is called now; call tex.redraw(draw) later to repaint. */
  kit.canvasTexture = function (w, h, draw) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var g = cv.getContext("2d");
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    tex.redraw = function (fn) { g.clearRect(0, 0, w, h); (fn || draw)(g, w, h); tex.needsUpdate = true; };
    if (draw) draw(g, w, h);
    tex.needsUpdate = true;
    tex.canvas2d = g;
    return tex;
  };

  /* ---------- neon text ----------
     kit.neonText("ROOM 01", { height: 0.4, color: HH.THEME.cyan })
     -> THREE.Mesh (plane, centered). height = world height of ONE line in meters.
     opts: color, height, font (CSS family), weight, glow (0 = flat printed text), core (white core 0..1),
           align ('center'|'left'|'right'), lineGap (1.25), letterSpacing (px at 128px), maxWidthPx (wrap), additive (true). */
  kit.neonText = function (text, opts) {
    opts = opts || {};
    var color = opts.color || HH.THEME.violet;
    var px = 128;
    var font = (opts.weight || "400") + " " + px + "px " + (opts.font || HH.FONTS.neon);
    var glow = opts.glow == null ? 28 : opts.glow;
    var core = opts.core == null ? 0.55 : opts.core;
    var lineGap = opts.lineGap || 1.25;
    var pad = Math.ceil(glow * 2.2) + 8;
    var meas = document.createElement("canvas").getContext("2d");
    meas.font = font;
    if ("letterSpacing" in meas && opts.letterSpacing) meas.letterSpacing = opts.letterSpacing + "px";
    var lines = [];
    String(text).split("\n").forEach(function (para) {
      if (!opts.maxWidthPx) { lines.push(para); return; }
      var words = para.split(" "), cur = "";
      words.forEach(function (w) {
        var t = cur ? cur + " " + w : w;
        if (meas.measureText(t).width > opts.maxWidthPx && cur) { lines.push(cur); cur = w; } else cur = t;
      });
      lines.push(cur);
    });
    var tw = Math.max.apply(null, lines.map(function (l) { return meas.measureText(l).width; }).concat([4]));
    var W = Math.ceil(tw + pad * 2), H = Math.ceil(px * lineGap * lines.length + pad * 2);
    var scale = Math.min(1, 4096 / W, 4096 / H);
    var align = opts.align || "center";
    var tex = kit.canvasTexture(Math.ceil(W * scale), Math.ceil(H * scale), function (g) {
      g.save(); g.scale(scale, scale);
      g.font = font; g.textBaseline = "middle"; g.textAlign = align;
      if ("letterSpacing" in g && opts.letterSpacing) g.letterSpacing = opts.letterSpacing + "px";
      var x = align === "center" ? W / 2 : align === "left" ? pad : W - pad;
      lines.forEach(function (l, i) {
        var y = pad + px * lineGap * (i + 0.5);
        if (glow > 0) {
          g.shadowColor = color; g.fillStyle = color;
          g.shadowBlur = glow * 1.6; g.fillText(l, x, y);
          g.shadowBlur = glow * 0.6; g.fillText(l, x, y);
          g.shadowBlur = 0;
          if (core > 0) {
            g.globalAlpha = core; g.fillStyle = "#ffffff"; g.fillText(l, x, y); g.globalAlpha = 1;
          }
        } else {
          g.fillStyle = color; g.fillText(l, x, y);
        }
      });
      g.restore();
    });
    var h = (opts.height || 0.4) * (H / (px * lineGap));
    var w = h * (W / H);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending
    });
    mat.toneMapped = false;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.userData.size = { w: w, h: h };
    mesh.userData.align = align;
    if (align === "left") mesh.geometry.translate(w / 2 - (pad / H) * h, 0, 0);
    if (align === "right") mesh.geometry.translate(-w / 2 + (pad / H) * h, 0, 0);
    return mesh;
  };

  /* Neon tube through points (THREE.Vector3[]). opts: color, radius, intensity, closed, smooth (curve vs straight). */
  kit.neonTube = function (points, opts) {
    opts = opts || {};
    var curve;
    if (opts.smooth) {
      curve = new THREE.CatmullRomCurve3(points, !!opts.closed, "catmullrom", 0.5);
    } else {
      curve = new THREE.CurvePath();
      var pts = opts.closed ? points.concat([points[0]]) : points;
      for (var i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    }
    var segs = opts.segments || Math.max(8, points.length * (opts.smooth ? 12 : 2));
    var geo = new THREE.TubeGeometry(curve, segs, opts.radius || 0.018, 8, false);
    return new THREE.Mesh(geo, kit.neonMat(opts.color || HH.THEME.purple, opts.intensity || 1.6));
  };

  /* Soft additive glow sprite. */
  kit._glowTex = {};
  kit.glowSprite = function (hex, size, opacity) {
    if (!kit._glowTex[hex]) {
      kit._glowTex[hex] = kit.canvasTexture(128, 128, function (g) {
        var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, hex); gr.addColorStop(0.25, hex + "aa"); gr.addColorStop(1, hex + "00");
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      });
    }
    var m = new THREE.SpriteMaterial({ map: kit._glowTex[hex], transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: opacity == null ? 0.8 : opacity });
    m.toneMapped = false;
    var s = new THREE.Sprite(m);
    s.scale.set(size || 1, size || 1, 1);
    return s;
  };

  /* ---------- postprocessing ---------- */
  kit.createPipeline = function (renderer, scene, camera, opts) {
    opts = opts || {};
    var size = renderer.getSize(new THREE.Vector2());
    var composer = new THREE.EffectComposer(renderer);
    var renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);
    var bloom = null;
    if (opts.bloom !== false) {
      bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x, size.y),
        opts.bloomStrength == null ? 0.9 : opts.bloomStrength,
        opts.bloomRadius == null ? 0.45 : opts.bloomRadius,
        opts.bloomThreshold == null ? 0.68 : opts.bloomThreshold);
      composer.addPass(bloom);
    }
    var gamma = new THREE.ShaderPass(THREE.GammaCorrectionShader);
    composer.addPass(gamma);
    return {
      composer: composer, bloom: bloom, renderPass: renderPass,
      setSize: function (w, h) { composer.setSize(w, h); if (bloom) bloom.setSize(w, h); },
      render: function (dt) { composer.render(dt); },
      dispose: function () {
        try { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); } catch (e) {}
      }
    };
  };

  kit.disposeTree = function (obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(function (m) {
        for (var k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
    });
  };

  /* ---------- CSS injected once (immersive stage + shared bits) ---------- */
  kit.injectCSS = function (id, css) {
    if (document.getElementById(id)) return;
    var s = document.createElement("style"); s.id = id; s.textContent = css;
    document.head.appendChild(s);
  };


  /* ---------- shared label-panel classes (engine + dev harness inject this) ----------
     Rooms may use these inside panel(el, ctx):
     .hh-sec (block)  .hh-h (mini heading)  .hh-row (wrapping row)  .hh-btn / .hh-btn.amber / .hh-btn.magenta (neon link button)
     .hh-chip (pill)  .hh-mono (data text)  .hh-note (draft-only note; hidden when DRAFT_MODE is false)
     .hh-list (clean list)  .hh-kr (Korean text) */
  kit.injectUICSS = function () {
    var T = HH.THEME, F = HH.FONTS;
    kit.injectCSS("hh-ui-css", [
      ".hh-sec{display:grid;gap:10px;min-width:0}",
      ".hh-h{font:500 11px/1.2 " + F.mono + ";letter-spacing:.16em;text-transform:uppercase;color:" + T.violet + "}",
      ".hh-row{display:flex;flex-wrap:wrap;gap:8px;min-width:0}",
      ".hh-btn{display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid currentColor;color:" + T.cyan + ";background:rgba(60,236,255,.06);font:600 13px/1.1 " + F.display + ";letter-spacing:.08em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:box-shadow .2s,background .2s}",
      ".hh-btn:hover,.hh-btn:focus-visible{background:rgba(60,236,255,.14);box-shadow:0 0 18px rgba(60,236,255,.45),inset 0 0 12px rgba(60,236,255,.2);outline:none}",
      ".hh-btn.amber{color:" + T.amber + ";background:rgba(255,178,63,.06)}.hh-btn.amber:hover,.hh-btn.amber:focus-visible{background:rgba(255,178,63,.14);box-shadow:0 0 18px rgba(255,178,63,.45)}",
      ".hh-btn.magenta{color:" + T.magenta + ";background:rgba(255,63,208,.06)}.hh-btn.magenta:hover,.hh-btn.magenta:focus-visible{background:rgba(255,63,208,.14);box-shadow:0 0 18px rgba(255,63,208,.45)}",
      ".hh-btn[aria-disabled=true]{opacity:.45;cursor:not-allowed;box-shadow:none}",
      ".hh-btn small{font:400 11px " + F.mono + ";letter-spacing:.06em;text-transform:none;opacity:.75}",
      ".hh-chip{display:inline-flex;align-items:center;padding:3px 9px;border:1px solid rgba(184,139,255,.4);color:" + T.violet + ";font:500 11px/1.3 " + F.mono + ";letter-spacing:.08em}",
      ".hh-mono{font-family:" + F.mono + ";font-variant-numeric:tabular-nums}",
      ".hh-kr{font-family:" + F.kr + "}",
      ".hh-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}",
      ".hh-note{font:400 13px/1.5 " + F.kr + ";color:#ffd9a0;border:1px dashed rgba(255,178,63,.45);background:rgba(255,178,63,.05);padding:8px 10px}",
      ".hh-note::before{content:'DRAFT NOTE · ';font:500 10px " + F.mono + ";letter-spacing:.14em;color:" + T.amber + "}",
      "body.hh-final .hh-note,body.hh-final .hh-draft-only{display:none!important}"
    ].join("\n"));
  };

  /* ---------- immersive scroll stage ----------
     A scroll-driven 3D story inside `scroller` (the engine's full-screen overlay element, which scrolls).
     var stage = kit.immersiveStage(scroller, {
       length: 6,                       // track length in screens
       chapters: [{ at: 0.0, kicker: "23:59 · DEC 9, 2025", title: "...", body: "...", side: "left" }],
       setup: function (s) {},          // s = { THREE, scene, camera, renderer }  build your scene
       frame: function (p, dt, t, s) {} // p = smoothed scroll progress 0..1
     });
     return { destroy: stage.destroy };  // from your immersive.mount()
     Chapter text is museum copy (facts, dates, quotes). Never put Henry's explanation text here. */
  kit.immersiveStage = function (scroller, opts) {
    kit.injectCSS("hh-stage-css", [
      ".hh-stage{position:relative;min-height:100%;color:" + HH.THEME.white + ";font-family:" + HH.FONTS.body + "}",
      ".hh-stage-pin{position:sticky;top:0;height:var(--hh-vh,100vh);overflow:hidden}",
      ".hh-stage-pin canvas{display:block;width:100%;height:100%}",
      ".hh-stage-track{position:relative;pointer-events:none}",
      ".hh-ch{position:absolute;left:0;right:0;display:flex;padding:0 max(16px,6vw);opacity:.08;transform:translateY(24px);transition:opacity .5s ease,transform .6s cubic-bezier(.2,.8,.2,1)}",
      ".hh-ch.on{opacity:1;transform:none}",
      ".hh-ch.left{justify-content:flex-start}.hh-ch.right{justify-content:flex-end}.hh-ch.center{justify-content:center;text-align:center}",
      ".hh-ch-in{max-width:min(34rem,100%);min-width:0;padding:18px 20px;background:linear-gradient(180deg,rgba(4,5,12,.72),rgba(10,15,46,.6));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(184,139,255,.28)}",
      ".hh-ch-k{font:500 12px/1.3 " + HH.FONTS.mono + ";letter-spacing:.14em;text-transform:uppercase;color:" + HH.THEME.cyan + "}",
      ".hh-ch-t{margin:.35em 0 .3em;font:700 clamp(26px,4.4vw,52px)/1.02 " + HH.FONTS.display + ";text-wrap:balance;letter-spacing:.01em}",
      ".hh-ch-b{font:400 clamp(15px,1.5vw,18px)/1.55 " + HH.FONTS.body + ";color:#c9cdf2}",
      ".hh-stage-bar{position:absolute;left:0;top:0;height:3px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg," + HH.THEME.amber + "," + HH.THEME.magenta + "," + HH.THEME.cyan + ")}",
      ".hh-stage-count{position:absolute;right:max(16px,3vw);bottom:max(16px,3vh);font:500 12px " + HH.FONTS.mono + ";letter-spacing:.14em;color:" + HH.THEME.dim + "}",
      "@media (prefers-reduced-motion: reduce){.hh-ch{transition:none;transform:none}}"
    ].join("\n"));

    var length = opts.length || 6;
    var root = document.createElement("div"); root.className = "hh-stage";
    var pin = document.createElement("div"); pin.className = "hh-stage-pin";
    var canvas = document.createElement("canvas");
    var bar = document.createElement("div"); bar.className = "hh-stage-bar";
    var count = document.createElement("div"); count.className = "hh-stage-count";
    pin.appendChild(canvas); pin.appendChild(bar); pin.appendChild(count);
    var track = document.createElement("div"); track.className = "hh-stage-track";
    root.appendChild(pin); root.appendChild(track);
    scroller.appendChild(root);

    var chapters = (opts.chapters || []).map(function (c, i) {
      var el = document.createElement("div");
      el.className = "hh-ch " + (c.side || (i % 2 ? "right" : "left"));
      el.innerHTML = '<div class="hh-ch-in">' +
        (c.kicker ? '<div class="hh-ch-k">' + kit.esc(c.kicker) + "</div>" : "") +
        (c.title ? '<div class="hh-ch-t">' + kit.esc(c.title) + "</div>" : "") +
        (c.body ? '<div class="hh-ch-b">' + kit.esc(c.body) + "</div>" : "") +
        (c.html || "") + "</div>";
      track.appendChild(el);
      return { at: c.at, el: el };
    });

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(kit.color(HH.THEME.void), 1);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    var s = { THREE: THREE, scene: scene, camera: camera, renderer: renderer, root: root, canvas: canvas };
    var pipe = kit.createPipeline(renderer, scene, camera, opts.pipeline || {});
    s.pipeline = pipe;

    var vh = 0;
    function layout() {
      vh = scroller.clientHeight || window.innerHeight;
      var vw = scroller.clientWidth || window.innerWidth;
      root.style.setProperty("--hh-vh", vh + "px");
      track.style.marginTop = (-vh) + "px";
      track.style.height = (length * vh) + "px";
      chapters.forEach(function (c) { c.el.style.top = (c.at * (length - 1) * vh + vh * 0.42) + "px"; });
      renderer.setSize(vw, vh, false);
      pipe.setSize(vw, vh);
      camera.aspect = vw / vh; camera.updateProjectionMatrix();
    }
    if (opts.setup) opts.setup(s);
    layout();
    window.addEventListener("resize", layout);

    var p = 0, raw = 0, t = 0, last = performance.now(), raf = 0, dead = false;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    function loop(now) {
      if (dead) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      var max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      raw = kit.clamp(scroller.scrollTop / max, 0, 1);
      p = reduce ? raw : kit.damp(p, raw, 7, dt);
      bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
      var active = 0;
      chapters.forEach(function (c, i) {
        var on = Math.abs(raw - c.at) < 0.5 / Math.max(1, chapters.length - 1) + 0.02;
        c.el.classList.toggle("on", on);
        if (raw >= c.at - 0.02) active = i;
      });
      if (chapters.length) count.textContent = String(active + 1).padStart(2, "0") + " / " + String(chapters.length).padStart(2, "0");
      if (opts.frame) opts.frame(p, dt, t, s);
      pipe.render(dt);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return {
      stage: s,
      progress: function () { return p; },
      destroy: function () {
        dead = true; cancelAnimationFrame(raf);
        window.removeEventListener("resize", layout);
        kit.disposeTree(scene); pipe.dispose();
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (e) {}
        root.remove();
      }
    };
  };
})();
