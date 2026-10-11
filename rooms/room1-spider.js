/* Human Hours Museum v2 · Room 1 · The Frame Room
   Exhibit: HH.EXHIBITS[0] (Spider-Man: Into the Spider-Verse).
   - Hero: the film's key art as a landscape comic panel. One ShaderMaterial prints it plate by plate
     (cyan, magenta, yellow, key) on enter, then holds it in register with a faint Ben-Day screen.
   - Neon frame: magenta + cyan tubes offset like two plates, following the plates while they print.
   - A procedural neon spider, animated on twos (pose updates at 12 fps), with an IK gait and pooled web shots.
   - Human / machine readout, a 24-tick frame ruler, a press colour bar and a clickable trailer sign.
   Classic script. Registers with HH.registerRoom(1, ...). */
(function () {
  "use strict";
  var HH = window.HH;
  if (!HH || !HH.registerRoom || !window.THREE) return;

  var TAU = Math.PI * 2;
  var R = null; // room state (closure)

  /* ---------- layout, anchor-local meters ---------- */
  var PW = 4.2, PH = 2.52, PCY = 2.45, PZ = 0.056;        // key art plane (5:3)
  var BX = 2.22, BY0 = PCY - 1.38, BY1 = PCY + 1.38;      // ink border (backing) extents
  var SPS = 1.3;                                           // spider scale
  var H_BODY = 0.088 * SPS;                                // spider body height above a surface
  var HANG_Z = 0.34;
  var THREAD_TOP = new THREE.Vector3(3.0, 6.36, HANG_Z);
  var HANG = new THREE.Vector3(3.0, 4.05, HANG_Z);
  var DROP = new THREE.Vector3(3.0, 3.3, HANG_Z);
  var LAND = new THREE.Vector2(2.6, 3.3);
  var PERCHES = [new THREE.Vector2(2.6, 3.3), new THREE.Vector2(2.6, 2.75), new THREE.Vector2(2.6, 3.62), new THREE.Vector2(1.9, 4.25)];
  var VISITOR = new THREE.Vector3(0, 1.62, 4.6);
  /* web targets: position, radius, faces visitor?, hold seconds */
  var TARGETS = [
    { p: new THREE.Vector3(-2.22, 3.83, 0.11), r: 0.5, face: false, hold: 9 },    // frame, upper-left corner
    { p: new THREE.Vector3(-3.5, 3.65, 0.03), r: 0.42, face: false, hold: 9 },   // wall, above the readout
    { p: new THREE.Vector3(1.3, 1.15, 2.35), r: 0.5, face: true, hold: 2.3 },    // the air toward the visitor
    { p: new THREE.Vector3(3.3, 4.15, 0.03), r: 0.4, face: false, hold: 8 }      // wall, upper right
  ];
  var LOOP_TARGETS = [3, 0, 1, 2];

  /* ---------- temps (no per-frame allocation) ---------- */
  function V3() { return new THREE.Vector3(); }
  var _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _f = V3(), _k = V3(), _h = V3();
  var _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3();
  var UP = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1);

  function surfaceZ(x, y) { return (Math.abs(x) <= BX && y >= BY0 && y <= BY1) ? PZ : 0; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angLerp(a, b, t) { var d = ((b - a) % TAU + TAU * 1.5) % TAU - TAU / 2; return a + d * t; }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* =====================================================================
     KEY ART: one ShaderMaterial prints the supplied artwork as four ink plates
     (cyan, magenta, yellow, key). Each plate is separated from the image, wipes in
     like a press roller, slides in misregistered, then snaps into register.
     ===================================================================== */
  var PRINT_START = [0.15, 0.85, 1.55, 2.1];     // seconds, plate order C M Y K
  var PRINT_DUR = [0.8, 0.8, 0.75, 0.7];
  var PRINT_DIR = [[-1, 0.25], [0.3, -1], [1, -0.25], [-0.25, 1]];
  var PRINT_SLIDE = 0.05;                        // uv distance a plate starts off register
  var PRINT_END = PRINT_START[3] + PRINT_DUR[3];

  var ART_VS = [
    "varying vec2 vUv;",
    "#include <common>",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vUv = uv;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}"
  ].join("\n");
  var ART_FS = [
    "uniform sampler2D uMap;",
    "uniform vec4 uProg;",
    "uniform vec2 uOffC; uniform vec2 uOffM; uniform vec2 uOffY; uniform vec2 uOffK;",
    "uniform float uGain; uniform float uDot; uniform vec2 uSize;",
    "varying vec2 vUv;",
    "#include <common>",
    "#include <fog_pars_fragment>",
    /* ink separation: (1 - c')(1 - k) = 1 - c, so the four plates multiply back to the artwork */
    "vec4 sep(vec3 rgb) {",
    "  vec3 cmy = 1.0 - rgb;",
    "  float k = min(cmy.x, min(cmy.y, cmy.z));",
    "  return vec4((cmy - k) / max(1.0 - k, 0.002), k);",
    "}",
    "float cover(float p, float edge) { return step(edge + 0.0001, p * 1.04); }",
    "void main() {",
    "  float c = sep(texture2D(uMap, vUv + uOffC).rgb).x * cover(uProg.x, vUv.x);",
    "  float m = sep(texture2D(uMap, vUv + uOffM).rgb).y * cover(uProg.y, vUv.y);",
    "  float y = sep(texture2D(uMap, vUv + uOffY).rgb).z * cover(uProg.z, 1.0 - vUv.x);",
    "  float k = sep(texture2D(uMap, vUv + uOffK).rgb).w * cover(uProg.w, 1.0 - vUv.y);",
    "  vec3 col = vec3(0.985, 0.972, 0.945);",
    "  col *= vec3(1.0 - c, 1.0, 1.0);",
    "  col *= vec3(1.0, 1.0 - m, 1.0);",
    "  col *= vec3(1.0, 1.0, 1.0 - y);",
    "  col *= 1.0 - k;",
    /* Ben-Day dots, shadows only */
    "  float lum = dot(col, vec3(0.299, 0.587, 0.114));",
    "  float sh = smoothstep(0.03, 0.1, lum) * (1.0 - smoothstep(0.26, 0.55, lum));",
    "  vec2 p = vUv * uSize / 0.03;",
    "  vec2 q = vec2(0.7071 * (p.x - p.y), 0.7071 * (p.x + p.y));",
    "  float d = length(fract(q) - 0.5);",
    "  float aa = max(fwidth(q.x) + fwidth(q.y), 1e-4) * 0.5;",
    "  float dm = 1.0 - smoothstep(0.2 + 0.2 * sh - aa, 0.2 + 0.2 * sh + aa, d);",
    "  col *= 1.0 - uDot * 0.24 * sh * dm * (1.0 - smoothstep(0.35, 0.8, aa));",
    "  float light = 1.0 - 0.16 * smoothstep(0.25, 0.85, length((vUv - 0.5) * vec2(1.0, 0.85)));",
    "  gl_FragColor = vec4(pow(col, vec3(2.2)) * uGain * light, 1.0);",
    "  #include <fog_fragment>",
    "}"
  ].join("\n");

  /* =====================================================================
     WEB: radial spokes + spiral as thin additive ribbons (unit radius)
     ===================================================================== */
  function buildWebGeometry(seed, spokes, turns) {
    var rng = HH.kit.rand(seed);
    var ang = [], len = [], i;
    for (i = 0; i < spokes; i++) { ang.push((i + (rng() - 0.5) * 0.4) / spokes * TAU); len.push(0.9 + rng() * 0.14); }
    var pos = [], aT = [], aE = [], idx = [];
    function seg(ax, ay, bx, by, t0, t1, hw) {
      var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * hw, ny = dx / L * hw, b = pos.length / 3;
      pos.push(ax + nx, ay + ny, 0, ax - nx, ay - ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0);
      aT.push(t0, t0, t1, t1); aE.push(1, -1, 1, -1);
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    function px(a, r) { return Math.cos(a) * r; }
    function py(a, r) { return Math.sin(a) * r; }
    /* spokes grow out first */
    for (i = 0; i < spokes; i++) seg(px(ang[i], 0.03), py(ang[i], 0.03), px(ang[i], len[i]), py(ang[i], len[i]), 0, 0.36 * len[i], 0.0085);
    /* frame polygon */
    for (i = 0; i < spokes; i++) {
      var j = (i + 1) % spokes;
      seg(px(ang[i], len[i] * 0.88), py(ang[i], len[i] * 0.88), px(ang[j], len[j] * 0.88), py(ang[j], len[j] * 0.88), 0.36, 0.42, 0.007);
    }
    /* hub */
    for (i = 0; i < spokes; i++) {
      var h = (i + 1) % spokes;
      seg(px(ang[i], 0.07), py(ang[i], 0.07), px(ang[h], 0.07), py(ang[h], 0.07), 0.3, 0.36, 0.006);
    }
    /* capture spiral, inner to outer */
    var steps = spokes * turns, r0 = 0.15, r1 = 0.8;
    for (i = 0; i < steps; i++) {
      var a0 = ang[i % spokes] + Math.floor(i / spokes) * TAU, a1 = ang[(i + 1) % spokes] + Math.floor((i + 1) / spokes) * TAU;
      var ra = (r0 + (r1 - r0) * i / steps) * len[i % spokes], rb = (r0 + (r1 - r0) * (i + 1) / steps) * len[(i + 1) % spokes];
      seg(px(a0, ra), py(a0, ra), px(a1, rb), py(a1, rb), 0.42 + 0.58 * i / steps, 0.42 + 0.58 * (i + 1) / steps, 0.0056);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.Float32BufferAttribute(aT, 1));
    geo.setAttribute("aE", new THREE.Float32BufferAttribute(aE, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }
  var WEB_VS = [
    "attribute float aT; attribute float aE;",
    "varying float vT; varying float vE;",
    "#include <common>",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vT = aT; vE = aE;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}"
  ].join("\n");
  var WEB_FS = [
    "uniform vec3 uColor; uniform float uReveal; uniform float uFade;",
    "varying float vT; varying float vE;",
    "#include <common>",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  float a = 1.0 - smoothstep(uReveal - 0.012, uReveal + 0.004, vT);",
    "  float e = 1.0 - abs(vE);",
    "  vec3 col = uColor * e + vec3(1.0, 0.86, 0.97) * e * e * e * 0.9;",
    "  gl_FragColor = vec4(col * a * uFade, 1.0);",
    "  #include <fog_fragment>",
    "}"
  ].join("\n");

  /* =====================================================================
     SPIDER
     ===================================================================== */
  function sc(a) { return a.map(function (v) { return v * SPS; }); }
  var A_REST = [0.5, 1.12, 1.98, 2.56], REACH = sc([0.37, 0.31, 0.29, 0.35]);
  var A_CURL = [0.34, 0.92, 2.15, 2.72], REACH_CURL = sc([0.25, 0.2, 0.19, 0.24]);
  var L1 = sc([0.195, 0.168, 0.158, 0.188]), L2 = sc([0.21, 0.178, 0.168, 0.205]);
  var RAD = sc([0.0105, 0.0084, 0.0054]);
  var STEP_DUR = 0.2;

  function makeRimMaterial(kit, T) {
    var mat = new THREE.MeshStandardMaterial({ color: kit.color("#0b0e26"), roughness: 0.32, metalness: 0.55 });
    var rimK = { value: 1.0 };
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uRimA = { value: kit.color(T.magenta, 1.25) };
      sh.uniforms.uRimB = { value: kit.color(T.cyan, 1.1) };
      sh.uniforms.uRimK = rimK;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uRimA; uniform vec3 uRimB; uniform float uRimK;")
        .replace("#include <tonemapping_fragment>",
          "{ vec3 vd = normalize(vViewPosition); float fr = pow(1.0 - clamp(abs(dot(normal, vd)), 0.0, 1.0), 2.4);\n" +
          "  vec3 rc = mix(uRimA, uRimB, smoothstep(-0.3, 0.3, normal.x + normal.y * 0.35));\n" +
          "  gl_FragColor.rgb += rc * fr * uRimK; }\n#include <tonemapping_fragment>");
    };
    mat.customProgramCacheKey = function () { return "hh-r1-rim"; };
    mat.userData.rimK = rimK;
    return mat;
  }

  function cylinderTo(mesh, from, to, r) {
    _a.subVectors(to, from);
    var L = _a.length();
    if (L < 1e-5) { mesh.scale.set(r, 1e-4, r); mesh.position.copy(from); return; }
    _a.multiplyScalar(1 / L);
    mesh.quaternion.setFromUnitVectors(UP, _a);
    mesh.position.copy(from);
    mesh.scale.set(r, L, r);
  }

  /* =====================================================================
     ROOM
     ===================================================================== */
  HH.registerRoom(1, {
    build: function (ctx) {
      var kit = ctx.kit, T = ctx.theme, F = ctx.fonts, ex = ctx.exhibit || {};
      var low = ctx.quality === "low";
      var reduced = !!ctx.reducedMotion;
      var root = new THREE.Group();
      root.name = "room1-frame";
      ctx.anchor.add(root);

      R = {
        ctx: ctx, root: root, low: low, reduced: reduced, active: false,
        clk: 0, f12: -1, f24: -1, lastStep: 0, rng: kit.rand(7), shotCycle: 0
      };
      this._r = R;

      /* key art starts loading now; the rest of the room builds meanwhile */
      var artPromise = ctx.loadTexture(ctx.assetBase + "assets/spiderverse.jpg");

      /* ---- wall halo: neon light spilling onto the wall ---- */
      var haloTex = kit.canvasTexture(512, 336, function (g, w, h) {
        var s = w / 6.4, fw = 4.54 * s, fh = 2.82 * s, cx = w / 2, cy = h / 2;
        g.lineWidth = 7;
        g.shadowBlur = 44;
        g.strokeStyle = "rgba(255,63,208,0.9)"; g.shadowColor = "rgba(255,63,208,1)";
        g.strokeRect(cx - fw / 2 - 2, cy - fh / 2 - 2, fw, fh);
        g.strokeStyle = "rgba(60,236,255,0.8)"; g.shadowColor = "rgba(60,236,255,1)";
        g.strokeRect(cx - fw / 2 + 2, cy - fh / 2 + 2, fw, fh);
      });
      var haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.14 });
      haloMat.toneMapped = false;
      var halo = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.2), haloMat);
      halo.position.set(0, PCY, 0.006);
      root.add(halo);

      /* ---- thick black ink border (backing) ---- */
      var backing = new THREE.Mesh(new THREE.BoxGeometry(BX * 2, BY1 - BY0, 0.05), kit.darkMat("#020307", { roughness: 0.85, metalness: 0 }));
      backing.position.set(0, PCY, 0.025);
      root.add(backing);

      /* ---- key art: four-plate print shader ---- */
      var blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
      blank.needsUpdate = true;
      var uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uMap: { value: blank },
        uProg: { value: new THREE.Vector4(1, 1, 1, 1) },
        uOffC: { value: new THREE.Vector2() }, uOffM: { value: new THREE.Vector2() },
        uOffY: { value: new THREE.Vector2() }, uOffK: { value: new THREE.Vector2() },
        uGain: { value: 0.66 }, uDot: { value: 0.4 }, uSize: { value: new THREE.Vector2(PW, PH) }
      }]);
      var artMat = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: ART_VS, fragmentShader: ART_FS, fog: true, extensions: { derivatives: true } });
      var art = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), artMat);
      art.position.set(0, PCY, PZ);
      root.add(art);
      R.art = { mesh: art, u: uniforms, mat: artMat };
      R.print = { on: false, t0: 0 };
      R.glitch = { left: 0, timer: 1.5, dirty: false };

      /* ---- neon frame: two offset plates ---- */
      function rrect(hw, hh, r) {
        var pts = [], n = 5, cs = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2], [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, 1.5 * Math.PI]];
        cs.forEach(function (c) {
          for (var i = 0; i <= n; i++) { var a = c[2] + i / n * Math.PI / 2; pts.push(new THREE.Vector3(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, 0)); }
        });
        return pts;
      }
      var tubeSegs = low ? 320 : 640;
      var tubeM = kit.neonTube(rrect(2.27, 1.41, 0.04), { closed: true, radius: 0.011, segments: tubeSegs, color: T.magenta, intensity: 1.75 });
      var tubeC = kit.neonTube(rrect(2.27, 1.41, 0.04), { closed: true, radius: 0.011, segments: tubeSegs, color: T.cyan, intensity: 1.3 });
      R.tubeBase = [new THREE.Vector3(-0.012, PCY + 0.012, 0.075), new THREE.Vector3(0.012, PCY - 0.012, 0.083)];
      tubeM.position.copy(R.tubeBase[0]); tubeC.position.copy(R.tubeBase[1]);
      root.add(tubeM); root.add(tubeC);
      R.tubes = [tubeM, tubeC];

      /* ---- caption + press colour bar, under the panel ---- */
      var capY = 0.6;
      var cap = kit.neonText("KEY ART · SONY PICTURES ANIMATION · 2018", { font: F.mono, weight: "500", height: 0.085, color: T.violet, glow: 0, core: 0, align: "left", letterSpacing: 10 });
      cap.position.set(-BX, capY, 0.02); root.add(cap);
      var barTex = kit.canvasTexture(256, 48, function (g, w, h) {
        var cols = ["#00aeef", "#ec008c", "#fff200", "#101018"], i;
        for (i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(i * 46 + 4, 8, 40, 32); }
        g.strokeStyle = "#d8d8e8"; g.lineWidth = 3;
        g.beginPath(); g.arc(214, 24, 12, 0, TAU); g.moveTo(194, 24); g.lineTo(234, 24); g.moveTo(214, 4); g.lineTo(214, 44); g.stroke();
      });
      var barMat = new THREE.MeshBasicMaterial({ map: barTex, transparent: true, color: kit.color("#9a9aa6") });
      barMat.toneMapped = false;
      var bar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.094), barMat);
      bar.position.set(BX - 0.25, capY, 0.02); root.add(bar);

      /* ---- frame ruler: 24 ticks, every second one a drawing ---- */
      var tickGeo = new THREE.BoxGeometry(0.012, 1, 0.008);
      var tickMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      tickMat.toneMapped = false;
      var ticks = new THREE.InstancedMesh(tickGeo, tickMat, 24);
      ticks.frustumCulled = false;
      R.tickCol = { drawn: kit.color(T.amber, 0.5), held: kit.color(T.violet, 0.16), hot: kit.color(T.amber, 2.4), hotHeld: kit.color(T.violet, 0.7) };
      for (var ti = 0; ti < 24; ti++) {
        var drawn = ti % 2 === 0, th = drawn ? 0.075 : 0.042;
        _m.compose(_a.set(-BX + 0.06 + ti * ((BX * 2 - 0.12) / 23), 0.86 + th / 2, 0.02), _q.identity(), _s.set(1, th, 1));
        ticks.setMatrixAt(ti, _m);
        ticks.setColorAt(ti, drawn ? R.tickCol.drawn : R.tickCol.held);
      }
      ticks.instanceMatrix.needsUpdate = true;
      if (ticks.instanceColor) ticks.instanceColor.needsUpdate = true;
      root.add(ticks);
      R.ticks = ticks; R.tickHot = -1;

      /* ---- human vs machine readout, left of the panel ---- */
      var rx = -2.65;
      function readLine(label, value, color, y) {
        if (label) {
          var l = kit.neonText(String(label).toUpperCase(), { font: F.mono, weight: "500", height: 0.066, color: T.violet, glow: 0, core: 0, align: "right", letterSpacing: 14 });
          l.position.set(rx, y + 0.175, 0.02); root.add(l);
        }
        if (value) {
          var v = kit.neonText(String(value), { font: F.neon, height: 0.165, color: color, glow: 22, core: 0.5, align: "right", letterSpacing: 4 });
          v.position.set(rx, y, 0.02); root.add(v);
        }
      }
      if (ex.human) readLine(ex.human.label || "Human time", ex.human.short, T.amber, 2.66);
      if (ex.machine) readLine(ex.machine.label || "Machine time", ex.machine.short, T.cyan, 2.16);

      /* ---- trailer sign (clickable link), right of the panel ---- */
      var link = ex.links && ex.links[0];
      if (link && link.url) {
        var sign = new THREE.Group();
        sign.position.set(2.95, 1.5, 0.03);
        var tri = kit.neonTube([new THREE.Vector3(-0.3, 0.05, 0), new THREE.Vector3(-0.3, -0.05, 0), new THREE.Vector3(-0.215, 0, 0)],
          { closed: true, radius: 0.0065, segments: 30, color: T.magenta, intensity: 1.8 });
        sign.add(tri);
        var word = kit.neonText("TRAILER", { font: F.display, weight: "600", height: 0.105, color: T.magenta, glow: 18, core: 0.45, align: "left", letterSpacing: 12 });
        word.position.set(-0.165, 0, 0);
        sign.add(word);
        var hit = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(0.1, 0, 0.01);
        sign.add(hit);
        root.add(sign);
        R.sign = { group: sign, word: word, tri: tri, flash: 0 };
        ctx.addClickable(hit, function () {
          R.sign.flash = 1;
          ctx.openLink(link.url);
        }, link.label || "Watch the trailer");
      }

      /* ---- spider ---- */
      var bodyMat = makeRimMaterial(kit, T);
      R.bodyMat = bodyMat;
      var segW = low ? 14 : 22, segH = low ? 10 : 16;
      var spRoot = new THREE.Group();
      var ceph = new THREE.Mesh(new THREE.SphereGeometry(1, segW, segH), bodyMat);
      ceph.scale.set(0.07, 0.086, 0.05); ceph.position.set(0, 0.056, 0.004);
      spRoot.add(ceph);
      var abdG = new THREE.Group();
      abdG.position.set(0, -0.022, 0.006);
      var abd = new THREE.Mesh(new THREE.SphereGeometry(1, segW, segH), bodyMat);
      abd.scale.set(0.086, 0.128, 0.072); abd.position.set(0, -0.112, 0.022);
      abdG.add(abd);
      spRoot.add(abdG);
      var eyeGeo = new THREE.SphereGeometry(1, 10, 8);
      var eyes = new THREE.InstancedMesh(eyeGeo, kit.neonMat("#f3ecff", 2.6), 6);
      [[0.02, 0.13, 0.034, 0.0118], [-0.02, 0.13, 0.034, 0.0118], [0.043, 0.116, 0.026, 0.0078], [-0.043, 0.116, 0.026, 0.0078],
        [0.029, 0.099, 0.046, 0.0064], [-0.029, 0.099, 0.046, 0.0064]].forEach(function (e, i) {
        _m.compose(_a.set(e[0], e[1], e[2]), _q.identity(), _s.set(e[3], e[3], e[3]));
        eyes.setMatrixAt(i, _m);
      });
      eyes.instanceMatrix.needsUpdate = true;
      spRoot.add(eyes);
      var spHit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      spRoot.add(spHit);
      spRoot.scale.setScalar(SPS);
      root.add(spRoot);

      var legGeo = new THREE.CylinderGeometry(0.72, 1, 1, low ? 5 : 7, 1);
      legGeo.translate(0, 0.5, 0);
      var legs = new THREE.InstancedMesh(legGeo, bodyMat, 24);
      legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      legs.frustumCulled = false;
      root.add(legs);
      var joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, low ? 6 : 8, low ? 5 : 6), bodyMat, 16);
      joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      joints.frustumCulled = false;
      root.add(joints);

      /* silk thread (dragline) */
      var silkGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
      silkGeo.translate(0, 0.5, 0);
      var threadMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: kit.color(T.violet, 1.2) }, uTop: { value: new THREE.Vector2(4.55, 5.45) } },
        vertexShader: "varying float vY; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }",
        fragmentShader: "uniform vec3 uColor; uniform vec2 uTop; varying float vY; void main() { gl_FragColor = vec4(uColor * (1.0 - smoothstep(uTop.x, uTop.y, vY)), 1.0); }",
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      threadMat.toneMapped = false;
      var thread = new THREE.Mesh(silkGeo, threadMat);
      thread.frustumCulled = false;
      root.add(thread);
      /* web strand (shot) */
      var strandMat = kit.neonMat(T.magenta, 2.6, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      var strand = new THREE.Mesh(silkGeo, strandMat);
      strand.frustumCulled = false; strand.visible = false;
      root.add(strand);

      var sp = R.sp = {
        root: spRoot, abdG: abdG, legs: legs, joints: joints, thread: thread,
        P: new THREE.Vector3().copy(HANG), psi: Math.PI, lift: 0, liftTarget: 0,
        mode: "hang", plant: 0, queue: [], act: null, actT: 0,
        feet: [], from: [], to: [], stepping: [], stepT: [], curl: [], home: [],
        spin: new THREE.Vector3(), vel: new THREE.Vector2(), prevP: new THREE.Vector3().copy(HANG)
      };
      for (var li = 0; li < 8; li++) {
        sp.feet.push(V3()); sp.from.push(V3()); sp.to.push(V3()); sp.curl.push(V3()); sp.home.push(V3());
        sp.stepping.push(false); sp.stepT.push(0);
      }
      R.strand = { mesh: strand, mat: strandMat, base: kit.color(T.magenta, 2.6), state: "off", u: 0, f: 0, to: V3(), target: null };

      /* ---- web pool (3) ---- */
      var spokes = low ? 10 : 14, turns = low ? 5 : 7;
      R.webs = [];
      for (var wi = 0; wi < 3; wi++) {
        var wu = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          uColor: { value: kit.color(T.magenta, 1.9) }, uReveal: { value: 0 }, uFade: { value: 0 }
        }]);
        var wmat = new THREE.ShaderMaterial({ uniforms: wu, vertexShader: WEB_VS, fragmentShader: WEB_FS, fog: true,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        wmat.toneMapped = false;
        var wm = new THREE.Mesh(buildWebGeometry(101 + wi * 17, spokes, turns), wmat);
        wm.visible = false;
        wm.frustumCulled = false;
        root.add(wm);
        R.webs.push({ mesh: wm, u: wu, state: "off", t: 0, hold: 8, r: 0.5, born: 0, spin: 0 });
      }
      R.flash = kit.glowSprite("#ff3fd0", 1, 0.9);
      R.flash.visible = false;
      R.flashT = 1;
      root.add(R.flash);

      ctx.addClickable(spHit, function () { shootAtVisitor(); }, "Shoot a web");

      /* ---- initial state ---- */
      if (reduced) {
        sp.mode = "planted"; sp.plant = 1;
        sp.P.set(PERCHES[0].x, PERCHES[0].y, surfaceZ(PERCHES[0].x, PERCHES[0].y) + H_BODY);
        sp.psi = 0.55;
        placeFeetHome();
        showWebStatic(0);
      } else {
        hangPose(0);
      }
      applySpider();

      return artPromise.then(function (tex) {
        tex.anisotropy = 8;
        R.art.u.uMap.value = tex;
      }).catch(function () { R.art.u.uProg.value.set(0, 0, 0, 0); });
    },

    enter: function () {
      if (!R) return;
      R.active = true;
      if (R.reduced) return;
      R.print.on = true; R.print.t0 = R.clk;
      printStep();
      var sp = R.sp, end = endMode();
      keepOnlySafeAct();
      sp.queue.length = 0;
      if (end === "hang") {
        sp.queue.push({ t: "drop", dur: 1.25 }, { t: "land", dur: 0.6, to: LAND, psi: 2.2 });
      }
      sp.queue.push({ t: "crawl", to: PERCHES[0], speed: 0.34 }, { t: "wait", dur: 0.3 },
        { t: "shoot", target: 0 }, { t: "wait", dur: 1.4 },
        { t: "shoot", target: 1 }, { t: "wait", dur: 1.9 },
        { t: "shoot", target: 2 }, { t: "loop" });
      R.shotCycle = 0;
    },

    leave: function () {
      if (!R) return;
      R.active = false;
      if (R.reduced) return;
      var sp = R.sp, end = endMode();
      keepOnlySafeAct();
      sp.queue.length = 0;
      if (end === "planted") sp.queue.push({ t: "crawl", to: LAND, speed: 0.42 }, { t: "liftoff", dur: 0.6 });
      sp.queue.push({ t: "climb", dur: 1.9 });
    },

    update: function (ctx, dt, t, state) {
      if (!R) return;
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      R.clk += dt;
      if (state && state.visible === false && !R.active) { R.lastStep = R.clk; return; }
      var f24 = Math.floor(R.clk * 24), f12 = f24 >> 1;
      if (f12 !== R.f12) {
        var sdt = Math.min(R.clk - R.lastStep, 0.25);
        R.lastStep = R.clk; R.f12 = f12;
        if (!R.reduced) { stepSpider(sdt); artStep(sdt); }
      }
      if (f24 !== R.f24) { R.f24 = f24; if (!R.reduced) tickStep(f24 % 24); }
      smoothUpdate(dt);
    }
  });

  /* ---------- key art: print sequence and idle twitch, on twos ---------- */
  var TUBE_PRINT = 0.5, TUBE_TWITCH = 1.5;
  function setOffsets(cx, cy, mx, my, yx, yy, kx, ky, tubeK) {
    var u = R.art.u, tb = R.tubeBase;
    u.uOffC.value.set(cx, cy); u.uOffM.value.set(mx, my);
    u.uOffY.value.set(yx, yy); u.uOffK.value.set(kx, ky);
    R.tubes[0].position.set(tb[0].x + mx * PW * tubeK, tb[0].y + my * PH * tubeK, tb[0].z);
    R.tubes[1].position.set(tb[1].x + cx * PW * tubeK, tb[1].y + cy * PH * tubeK, tb[1].z);
  }
  function printStep() {
    var pr = R.print, u = R.art.u, tq = Math.floor((R.clk - pr.t0) * 12) / 12, i, p, e;
    var done = tq >= PRINT_END, prog = u.uProg.value;
    var ox = [0, 0, 0, 0], oy = [0, 0, 0, 0];
    for (i = 0; i < 4; i++) {
      p = done ? 1 : clamp((tq - PRINT_START[i]) / PRINT_DUR[i], 0, 1);
      e = (1 - p) * (1 - p) * PRINT_SLIDE;
      ox[i] = PRINT_DIR[i][0] * e; oy[i] = PRINT_DIR[i][1] * e;
      if (i === 0) prog.x = p; else if (i === 1) prog.y = p; else if (i === 2) prog.z = p; else prog.w = p;
    }
    u.uDot.value = lerp(1, 0.4, clamp((tq - 2.3) / 0.7, 0, 1));
    setOffsets(ox[0], oy[0], ox[1], oy[1], ox[2], oy[2], ox[3], oy[3], TUBE_PRINT);
    if (done) { pr.on = false; R.glitch.timer = 3 + R.rng() * 3; R.glitch.left = 0; }
  }
  function artStep(sdt) {
    if (R.print.on) { printStep(); return; }
    var g = R.glitch, rng = R.rng;
    g.timer -= sdt;
    if (g.timer <= 0) { g.left = 2 + Math.floor(rng() * 2); g.timer = R.active ? 3.5 + rng() * 4.5 : 6 + rng() * 8; }
    if (g.left > 0) {
      g.left--; g.dirty = true;
      var a = 0.0011 + rng() * 0.0016, b = (rng() - 0.5) * a * 0.8;
      setOffsets(a, b, -a * (0.5 + rng()), -b, (rng() - 0.5) * a * 0.5, (rng() - 0.5) * a * 0.5, 0, 0, TUBE_TWITCH);
    } else if (g.dirty) {
      g.dirty = false;
      setOffsets(0, 0, 0, 0, 0, 0, 0, 0, TUBE_TWITCH);
    }
  }

  /* ---------- 24-tick frame ruler ---------- */
  function tickStep(i) {
    var tk = R.ticks, c = R.tickCol;
    if (R.tickHot >= 0) tk.setColorAt(R.tickHot, R.tickHot % 2 === 0 ? c.drawn : c.held);
    tk.setColorAt(i, i % 2 === 0 ? c.hot : c.hotHeld);
    R.tickHot = i;
    if (tk.instanceColor) tk.instanceColor.needsUpdate = true;
  }

  /* ---------- spider helpers ---------- */
  function bodyPt(out, lx, ly, lz) {
    var sp = R.sp, c = Math.cos(sp.psi), s = Math.sin(sp.psi);
    return out.set(sp.P.x + c * lx - s * ly, sp.P.y + s * lx + c * ly, sp.P.z + lz);
  }
  function legSide(i) { return i < 4 ? -1 : 1; }
  function homeFoot(out, i) {
    var k = i % 4, s = legSide(i);
    bodyPt(out, s * Math.sin(A_REST[k]) * REACH[k], Math.cos(A_REST[k]) * REACH[k] + 0.03 * SPS, 0);
    out.z = surfaceZ(out.x, out.y);
    return out;
  }
  function curlFoot(out, i, wig) {
    var k = i % 4, s = legSide(i), a = A_CURL[k] + wig, r = REACH_CURL[k];
    return bodyPt(out, s * Math.sin(a) * r, Math.cos(a) * r + 0.03 * SPS, 0.012 * SPS);
  }
  function placeFeetHome() {
    var sp = R.sp;
    for (var i = 0; i < 8; i++) { homeFoot(sp.feet[i], i); sp.stepping[i] = false; }
  }
  function hangPose(clk) {
    var sp = R.sp;
    for (var i = 0; i < 8; i++) curlFoot(sp.feet[i], i, Math.sin(clk * 2.1 + i * 1.7) * 0.06);
  }
  function endMode() {
    var sp = R.sp;
    if (sp.act && sp.act.t === "land") return "planted";
    if (sp.act && sp.act.t === "liftoff") return "hang";
    return sp.mode;
  }
  function keepOnlySafeAct() {
    var sp = R.sp;
    if (sp.act && sp.act.t !== "land" && sp.act.t !== "liftoff") { sp.act = null; sp.liftTarget = 0; }
  }

  function solveLeg(i, H, Ft, outK, outA) {
    var k = i % 4;
    var a = L1[k], b = L2[k];
    /* ankle: a little above the foot, toward the hip */
    _h.subVectors(H, Ft); _h.z = 0;
    var hl = _h.length(); if (hl > 1e-5) _h.multiplyScalar(1 / hl); else _h.set(0, 0, 0);
    outA.copy(Ft).addScaledVector(_h, 0.045 * SPS); outA.z += 0.03 * SPS;
    _d.subVectors(outA, H);
    var d = _d.length();
    if (d < 1e-5) { _d.set(0, 0, 1); d = 1e-5; } else _d.multiplyScalar(1 / d);
    if (d > a + b - 0.002) { d = a + b - 0.002; outA.copy(H).addScaledVector(_d, d); }
    if (d < Math.abs(a - b) + 0.01) d = Math.abs(a - b) + 0.01;
    /* pole: up (out of the surface) and outward from the body */
    _e.subVectors(Ft, R.sp.P); _e.z = 0;
    var el = _e.length(); if (el > 1e-5) _e.multiplyScalar(0.45 / el);
    _e.z += 1;
    _e.addScaledVector(_d, -_e.dot(_d));
    if (_e.lengthSq() < 1e-8) _e.set(0, 0, 1);
    _e.normalize();
    var ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
    outK.copy(H).addScaledVector(_d, a * ca).addScaledVector(_e, a * sa);
  }

  function setSeg(mesh, idx, A, B, r) {
    _f.subVectors(B, A);
    var L = _f.length();
    if (L < 1e-5) { _f.set(0, 1, 0); L = 1e-5; } else _f.multiplyScalar(1 / L);
    _q.setFromUnitVectors(UP, _f);
    _m.compose(A, _q, _s.set(r, L, r));
    mesh.setMatrixAt(idx, _m);
  }
  function setJoint(mesh, idx, A, r) {
    _m.compose(A, _q2.identity(), _s.set(r, r, r));
    mesh.setMatrixAt(idx, _m);
  }

  /* writes the spider's transforms (called on steps only) */
  function applySpider() {
    var sp = R.sp;
    sp.root.position.copy(sp.P);
    sp.root.rotation.set(0, 0, sp.psi);
    sp.abdG.rotation.x = sp.lift;
    for (var i = 0; i < 8; i++) {
      var k = i % 4, s = legSide(i);
      bodyPt(_b, s * 0.04 * SPS, (0.086 - k * 0.022) * SPS, -0.004 * SPS);
      solveLeg(i, _b, sp.feet[i], _k, _c);
      setSeg(sp.legs, i * 3, _b, _k, RAD[0]);
      setSeg(sp.legs, i * 3 + 1, _k, _c, RAD[1]);
      setSeg(sp.legs, i * 3 + 2, _c, sp.feet[i], RAD[2]);
      setJoint(sp.joints, i * 2, _k, 0.0098 * SPS);
      setJoint(sp.joints, i * 2 + 1, _c, 0.0072 * SPS);
    }
    sp.legs.instanceMatrix.needsUpdate = true;
    sp.joints.instanceMatrix.needsUpdate = true;
    /* spinnerets: abdomen tip after lift */
    var cl = Math.cos(sp.lift), sl = Math.sin(sp.lift), ty = -0.236, tz = 0.012;
    bodyPt(sp.spin, 0, (-0.022 + ty * cl - tz * sl) * SPS, (0.006 + ty * sl + tz * cl) * SPS);
    cylinderTo(sp.thread, THREAD_TOP, sp.spin, 0.0042);
  }

  /* gait for planted legs */
  function gait(sdt) {
    var sp = R.sp, i, busyA = false, busyB = false;
    for (i = 0; i < 8; i++) {
      if (!sp.stepping[i]) continue;
      sp.stepT[i] += sdt / STEP_DUR;
      var u = Math.min(1, sp.stepT[i]);
      sp.feet[i].lerpVectors(sp.from[i], sp.to[i], easeInOut(u));
      sp.feet[i].z += Math.sin(Math.PI * u) * 0.055 * SPS;
      if (u >= 1) { sp.stepping[i] = false; sp.feet[i].copy(sp.to[i]); }
      else if (group(i)) busyB = true; else busyA = true;
    }
    var bestA = -1, bestB = -1;
    for (i = 0; i < 8; i++) {
      if (sp.stepping[i]) continue;
      homeFoot(sp.home[i], i);
      var dd = sp.feet[i].distanceTo(sp.home[i]);
      if (dd > 0.07 * SPS) { if (group(i)) bestB = Math.max(bestB, dd); else bestA = Math.max(bestA, dd); }
    }
    var go = -1;
    if (bestA > 0 && !busyB && (bestA >= bestB || busyA)) go = 0;
    else if (bestB > 0 && !busyA) go = 1;
    if (go < 0) return;
    for (i = 0; i < 8; i++) {
      if (sp.stepping[i] || group(i) !== go) continue;
      if (sp.feet[i].distanceTo(sp.home[i]) < 0.03 * SPS) continue;
      sp.from[i].copy(sp.feet[i]);
      sp.to[i].copy(sp.home[i]);
      sp.to[i].x += sp.vel.x * 0.12; sp.to[i].y += sp.vel.y * 0.12;
      sp.to[i].z = surfaceZ(sp.to[i].x, sp.to[i].y);
      sp.stepping[i] = true; sp.stepT[i] = 0;
    }
  }
  function group(i) { return ((i % 4) + (i < 4 ? 0 : 1)) % 2; }

  function nextAct() {
    var sp = R.sp;
    sp.act = sp.queue.shift() || null;
    sp.actT = 0;
    if (!sp.act) return;
    var a = sp.act;
    a.p0 = (a.p0 || V3()).copy(sp.P);
    a.psi0 = sp.psi;
    if (a.t === "loop") {
      sp.act = null;
      if (R.active) {
        var pr = PERCHES[Math.floor(R.rng() * PERCHES.length)];
        var tg = LOOP_TARGETS[R.shotCycle++ % LOOP_TARGETS.length];
        sp.queue.push({ t: "crawl", to: pr, speed: 0.3 }, { t: "wait", dur: 2.2 + R.rng() * 1.8 }, { t: "shoot", target: tg }, { t: "loop" });
      }
      nextAct();
    }
  }

  function stepSpider(sdt) {
    var sp = R.sp;
    sp.prevP.copy(sp.P);
    if (!sp.act && sp.queue.length) nextAct();
    var a = sp.act;
    if (a) sp.actT += sdt;
    var done = false, u;

    if (!a) {
      if (sp.mode === "hang") {
        sp.P.x = HANG.x + Math.sin(R.clk * 0.85) * 0.022 + (sp.P.x - HANG.x) * 0;
        sp.P.y = lerp(sp.P.y, HANG.y + Math.sin(R.clk * 0.6) * 0.012, 0.3);
        sp.psi = Math.PI + Math.sin(R.clk * 0.85 + 0.7) * 0.07;
        hangPose(R.clk);
      }
    } else if (a.t === "drop") {
      u = Math.min(1, sp.actT / a.dur);
      var e = u < 0.82 ? easeInOut(u / 0.82) * 1.045 : 1.045 - 0.045 * easeOut((u - 0.82) / 0.18);
      sp.P.x = lerp(a.p0.x, DROP.x, Math.min(1, u * 2));
      sp.P.y = lerp(a.p0.y, DROP.y, e);
      sp.P.z = HANG_Z;
      sp.psi = angLerp(a.psi0, Math.PI, Math.min(1, u * 2));
      hangPose(R.clk * 2);
      done = u >= 1;
    } else if (a.t === "land") {
      u = Math.min(1, sp.actT / a.dur);
      var eu = easeInOut(u);
      var tz = surfaceZ(a.to.x, a.to.y) + H_BODY;
      sp.P.set(lerp(a.p0.x, a.to.x, eu), lerp(a.p0.y, a.to.y, eu), lerp(a.p0.z, tz, eu) + Math.sin(Math.PI * u) * 0.03);
      sp.psi = angLerp(a.psi0, a.psi, eu);
      var pe = clamp((u - 0.35) / 0.65, 0, 1);
      for (var i = 0; i < 8; i++) {
        curlFoot(_c, i, 0); homeFoot(_k, i);
        sp.feet[i].lerpVectors(_c, _k, easeOut(pe));
      }
      if (u >= 1) { sp.mode = "planted"; sp.plant = 1; placeFeetHome(); done = true; }
    } else if (a.t === "liftoff") {
      u = Math.min(1, sp.actT / a.dur);
      var lu = easeInOut(u);
      sp.mode = "hang";
      sp.P.set(lerp(a.p0.x, DROP.x, lu), lerp(a.p0.y, DROP.y, lu), lerp(a.p0.z, HANG_Z, lu));
      sp.psi = angLerp(a.psi0, Math.PI, lu);
      for (var j = 0; j < 8; j++) {
        if (!a.feet0) a.feet0 = [];
        if (!a.feet0[j]) a.feet0[j] = V3().copy(sp.feet[j]);
        curlFoot(_c, j, 0);
        sp.feet[j].lerpVectors(a.feet0[j], _c, easeOut(clamp(u / 0.6, 0, 1)));
      }
      if (u >= 1) { a.feet0 = null; sp.plant = 0; done = true; }
    } else if (a.t === "climb") {
      u = Math.min(1, sp.actT / a.dur);
      var cu = easeInOut(u);
      sp.P.set(lerp(a.p0.x, HANG.x, cu), lerp(a.p0.y, HANG.y, cu), HANG_Z);
      sp.psi = angLerp(a.psi0, Math.PI, Math.min(1, u * 3));
      hangPose(R.clk * 3.2);
      done = u >= 1;
    } else if (a.t === "crawl") {
      var dx = a.to.x - sp.P.x, dy = a.to.y - sp.P.y, dist = Math.hypot(dx, dy);
      var stepLen = a.speed * sdt;
      if (dist <= stepLen + 0.004) { sp.P.x = a.to.x; sp.P.y = a.to.y; done = true; }
      else {
        sp.P.x += dx / dist * stepLen; sp.P.y += dy / dist * stepLen;
        sp.psi = angLerp(sp.psi, Math.atan2(-dx, dy), 0.35);
      }
      sp.P.z = lerp(sp.P.z, surfaceZ(sp.P.x, sp.P.y) + H_BODY, 0.5);
    } else if (a.t === "wait") {
      done = sp.actT >= a.dur;
    } else if (a.t === "shoot") {
      var tg = TARGETS[a.target];
      if (sp.mode === "planted") {
        var ddx = tg.p.x - sp.P.x, ddy = tg.p.y - sp.P.y;
        sp.psi = angLerp(sp.psi, Math.atan2(ddx, -ddy), 0.4);
        sp.liftTarget = tg.face ? -0.85 : -0.42;
      }
      if (!a.fired && sp.actT >= (sp.mode === "planted" ? 0.42 : 0.12)) { a.fired = true; fireStrand(tg); }
      if (a.fired && R.strand.state !== "fly") { a.after = (a.after || 0) + sdt; if (a.after > 0.22) { sp.liftTarget = 0; done = true; } }
    }

    sp.lift = lerp(sp.lift, sp.liftTarget, 0.5);
    if (a && a.t !== "shoot") sp.liftTarget = 0;

    /* velocity estimate for step lead */
    sp.vel.set((sp.P.x - sp.prevP.x) / Math.max(sdt, 1e-3), (sp.P.y - sp.prevP.y) / Math.max(sdt, 1e-3));
    if (sp.mode === "planted" && (!a || (a.t !== "land" && a.t !== "liftoff"))) gait(sdt);

    if (done) { sp.act = null; if (a.t === "shoot") a.fired = false; a.after = 0; nextAct(); }
    applySpider();
  }

  /* ---------- web shots ---------- */
  function fireStrand(tg) {
    var st = R.strand;
    st.state = "fly"; st.u = 0; st.f = 1; st.target = tg;
    st.to.copy(tg.p);
    st.mat.color.copy(st.base);
    st.mesh.visible = true;
    cylinderTo(st.mesh, R.sp.spin, R.sp.spin, 0.006);
  }
  function shootAtVisitor() {
    if (!R) return;
    if (R.reduced) { showWebStatic(2, true); return; }
    var sp = R.sp;
    for (var i = 0; i < sp.queue.length; i++) if (sp.queue[i].t === "shoot" && sp.queue[i].target === 2) return;
    sp.queue.unshift({ t: "shoot", target: 2 });
    if (sp.act && (sp.act.t === "wait" || sp.act.t === "crawl")) { sp.act = null; sp.liftTarget = 0; }
  }
  function pickWeb() {
    var best = null, i, w;
    for (i = 0; i < R.webs.length; i++) { w = R.webs[i]; if (w.state === "off") return w; }
    for (i = 0; i < R.webs.length; i++) { w = R.webs[i]; if (w.state !== "static" && (!best || w.born < best.born)) best = w; }
    return best || R.webs[0];
  }
  function placeWeb(w, tg) {
    var m = w.mesh;
    m.position.copy(tg.p);
    if (tg.face) {
      _a.subVectors(VISITOR, tg.p).normalize();
      m.quaternion.setFromUnitVectors(ZAX, _a);
    } else m.quaternion.identity();
    w.spin = (R.rng() - 0.5) * 1.2;
    _q.setFromAxisAngle(ZAX, w.spin);
    m.quaternion.multiply(_q);
    w.r = tg.r; w.hold = tg.hold; w.born = R.clk;
  }
  function spawnWeb(tg) {
    var w = pickWeb();
    placeWeb(w, tg);
    w.state = "grow"; w.t = 0;
    w.u.uReveal.value = 0; w.u.uFade.value = 1;
    w.mesh.scale.setScalar(w.r * 0.3);
    w.mesh.visible = true;
    R.flash.position.copy(tg.p);
    R.flashT = 0; R.flash.visible = true;
  }
  function showWebStatic(ti, temporary) {
    var w = temporary ? pickWeb() : R.webs[0];
    placeWeb(w, TARGETS[ti]);
    w.mesh.scale.setScalar(w.r);
    w.u.uReveal.value = 1.02;
    w.mesh.visible = true;
    if (temporary) { w.state = "fadein"; w.t = 0; w.u.uFade.value = 0; }
    else { w.state = "static"; w.u.uFade.value = 0.92; }
  }

  function smoothUpdate(dt) {
    /* strand flight */
    var st = R.strand, sp = R.sp;
    if (st.state === "fly") {
      st.u += dt / 0.26;
      var e = easeOut(Math.min(1, st.u));
      _b.lerpVectors(sp.spin, st.to, e);
      cylinderTo(st.mesh, sp.spin, _b, 0.0058);
      if (st.u >= 1) { st.state = "fade"; st.f = 1; spawnWeb(st.target); }
    } else if (st.state === "fade") {
      st.f -= dt / 0.4;
      if (st.f <= 0) { st.state = "off"; st.mesh.visible = false; }
      else { st.mat.color.copy(st.base).multiplyScalar(st.f * st.f); cylinderTo(st.mesh, sp.spin, st.to, 0.0058 * (0.4 + 0.6 * st.f)); }
    }
    /* webs */
    for (var i = 0; i < R.webs.length; i++) {
      var w = R.webs[i];
      if (w.state === "off" || w.state === "static") continue;
      w.t += dt;
      if (w.state === "grow") {
        w.u.uReveal.value = easeOut(Math.min(1, w.t / 0.8)) * 1.02;
        w.mesh.scale.setScalar(w.r * (0.3 + 0.7 * easeOutBack(Math.min(1, w.t / 0.55))));
        if (w.t >= 0.8) { w.state = "hold"; w.t = 0; }
      } else if (w.state === "fadein") {
        w.u.uFade.value = Math.min(1, w.t / 0.6);
        if (w.t >= 0.6) { w.state = "hold"; w.t = 0; }
      } else if (w.state === "hold") {
        w.u.uFade.value = R.reduced ? 0.95 : 0.93 + 0.07 * Math.cos(w.t * 1.7);
        if (w.t >= w.hold) { w.state = "fade"; w.t = 0; }
      } else if (w.state === "fade") {
        var f = 1 - w.t / 1.7;
        w.u.uFade.value = Math.max(0, f) * 0.93;
        if (f <= 0) { w.state = "off"; w.mesh.visible = false; }
      }
    }
    /* impact flash */
    if (R.flash.visible) {
      R.flashT += dt / 0.4;
      if (R.flashT >= 1) R.flash.visible = false;
      else {
        var s = Math.sin(Math.PI * R.flashT);
        R.flash.scale.setScalar(0.2 + 0.45 * s);
        R.flash.material.opacity = 0.6 * s;
      }
    }
    /* sign click feedback */
    if (R.sign && R.sign.flash > 0) {
      R.sign.flash = Math.max(0, R.sign.flash - dt * 2.5);
      var sc = 1 + 0.06 * R.sign.flash;
      R.sign.group.scale.set(sc, sc, 1);
    }
  }
})();
