/* Human Hours Museum v2 · Room 2 · "The Recording Booth"
   "Hold My Hand" by Yuleum (율음). Hero: CICADA sleeve with a vinyl half slid out.
   Right: lyric sheet that lights up line by line on enter (karaoke), EQ bar, human/machine readout.
   Atmosphere: shed cicada wings drifting through the sleeve's light beam.
   Classic script. Registers HH.registerRoom(2, ...). All copy comes from config.js. */
(function () {
  "use strict";
  if (!window.HH || !HH.registerRoom) return;

  /* ---------------- layout (anchor-local meters) ---------------- */
  var HERO = { x: -1.85, y: 2.42, z: 0.5, size: 1.7, yaw: 0.1 };
  var REC = { off: 1.1, r: 0.78, label: 0.33 };          // record center offset from sleeve center, radius, label ratio
  var LYR = { x0: 0.42, x1: 2.76, top: 3.16, bottom: 1.52, emMax: 0.118 };
  var BPM = 94, BEAT = 60 / BPM;
  var PRE_BEATS = 2, HOLD_BEATS = 5, FADE_BEATS = 2;
  var GAPS = [0.52, 0.66, 0.8];                          // track gaps (fraction of record radius)

  var S = null; // runtime state (closure, not `this`, so it works however the engine binds)

  /* ---------------- small helpers ---------------- */
  function hash(n) {
    n = (n << 13) ^ n;
    var m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
    m = (Math.imul(n, m) + 1376312589) & 0x7fffffff;
    return m / 2147483647;
  }
  function str(v) { return v == null ? "" : String(v); }

  function mergeGeos(list) {
    var pos = [], nor = [], uv = [];
    list.forEach(function (g) {
      var ng = g.index ? g.toNonIndexed() : g;
      var p = ng.attributes.position.array, n = ng.attributes.normal.array, u = ng.attributes.uv.array;
      for (var i = 0; i < p.length; i++) pos.push(p[i]);
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

  /* Canvas -> plane mesh. worldH = plane height in meters. */
  function canvasMesh(kit, wPx, hPx, worldH, draw, opts) {
    opts = opts || {};
    var tex = kit.canvasTexture(wPx, hPx, draw);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: opts.normal ? THREE.NormalBlending : THREE.AdditiveBlending
    });
    mat.toneMapped = false;
    var w = worldH * wPx / hPx;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, worldH), mat);
    mesh.userData.size = { w: w, h: worldH };
    return mesh;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }

  /* rough syllable count: one per Hangul block, vowel groups for Latin words */
  function syllables(s) {
    var n = (s.match(/[가-힣]/g) || []).length;
    (s.match(/[A-Za-z']+/g) || []).forEach(function (w) {
      n += Math.max(1, (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) || []).length);
    });
    return n;
  }

  /* ---------------- shaders ---------------- */
  var LINE_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var LINE_FS = [
    "uniform sampler2D map;uniform vec3 cBase;uniform vec3 cLit;uniform float wipe;uniform float soft;uniform float glint;uniform float alpha;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec4 tx=texture2D(map,vUv);",
    "  float core=smoothstep(0.6,0.97,tx.r);",
    "  float lit=1.0-smoothstep(wipe-soft,wipe,vUv.x);",
    "  vec3 c=mix(cBase,cLit,lit);",
    "  float m=max(max(c.r,c.g),c.b);",
    "  c=c*mix(0.5,1.0,core)+vec3(core*lit*0.28*m);",
    "  float e=exp(-pow((vUv.x-wipe)/max(soft,1e-4),2.0)*2.5)*glint;",
    "  c+=cLit*e*1.1;",
    "  gl_FragColor=vec4(c,tx.a*alpha);",
    "}"
  ].join("\n");

  var SHEEN_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var SHEEN_FS = [
    "uniform float inner;uniform float outer;uniform float k;uniform float rot;uniform vec3 col;uniform vec3 gaps;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 p=vUv*2.0-1.0;float r=length(p);",
    "  if(r>outer||r<inner)discard;",
    "  float a=atan(p.y,p.x)-rot;float ca=abs(cos(a));",
    "  float w=pow(ca,48.0)+pow(ca,8.0)*0.07;",
    "  float fade=smoothstep(inner,inner+0.05,r)*(1.0-smoothstep(outer-0.02,outer,r));",
    "  float g=1.0-0.75*(exp(-pow((r-gaps.x)/0.007,2.0))+exp(-pow((r-gaps.y)/0.007,2.0))+exp(-pow((r-gaps.z)/0.007,2.0)));",
    "  float band=0.55+0.45*smoothstep(inner,outer,r);",
    "  gl_FragColor=vec4(col*w*fade*g*band*k,1.0);",
    "}"
  ].join("\n");

  /* ---------------- textures ---------------- */
  function drawRecord(g, S2, kit, T, F) {
    var c = S2 / 2, R = S2 / 2 - 2, LR = R * REC.label;
    var rnd = kit.rand(2009);
    g.clearRect(0, 0, S2, S2);
    g.fillStyle = "#08080d";
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    // grooves
    var step = S2 >= 1024 ? 1.15 : 0.9;
    for (var r = LR * 1.12; r < R * 0.975; r += step) {
      var fr = r / R, inGap = false;
      for (var k = 0; k < GAPS.length; k++) if (Math.abs(fr - GAPS[k]) < 0.006) inGap = true;
      if (inGap) continue;
      var a = 0.035 + rnd() * 0.075;
      g.strokeStyle = "rgba(150,150,185," + a.toFixed(3) + ")";
      g.lineWidth = 0.8;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // a faint radial mottling so rotation is visible on the grooves
    for (var i = 0; i < 5; i++) {
      var ang = rnd() * Math.PI * 2;
      var gr = g.createLinearGradient(c, c, c + Math.cos(ang) * R, c + Math.sin(ang) * R);
      gr.addColorStop(0, "rgba(120,110,170,0)"); gr.addColorStop(1, "rgba(120,110,170,0.05)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(c, c); g.arc(c, c, R * 0.97, ang - 0.12, ang + 0.12); g.closePath(); g.fill();
    }
    // rim
    g.strokeStyle = "rgba(170,170,210,0.16)"; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, R - 1, 0, Math.PI * 2); g.stroke();
    // label
    var lg = g.createRadialGradient(c - LR * 0.3, c - LR * 0.35, LR * 0.1, c, c, LR);
    lg.addColorStop(0, "#f59a3c"); lg.addColorStop(1, "#d56a1e");
    g.fillStyle = lg;
    g.beginPath(); g.arc(c, c, LR, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(20,24,51,0.55)"; g.lineWidth = Math.max(1, S2 / 512);
    g.beginPath(); g.arc(c, c, LR * 0.9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#141833"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "700 " + Math.round(LR * 0.36) + "px " + F.display;
    if ("letterSpacing" in g) g.letterSpacing = Math.round(LR * 0.04) + "px";
    g.fillText("CICADA", c, c - LR * 0.4);
    g.font = "500 " + Math.round(LR * 0.13) + "px " + F.mono;
    if ("letterSpacing" in g) g.letterSpacing = Math.round(LR * 0.02) + "px";
    g.fillText("YULEUM · 2024", c, c + LR * 0.42);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.fillRect(c - LR * 0.42, c + LR * 0.24, LR * 0.84, Math.max(1, LR * 0.012));
    // spindle hole
    g.fillStyle = "#04050c";
    g.beginPath(); g.arc(c, c, S2 * 0.011, 0, Math.PI * 2); g.fill();
  }

  function drawWing(g, W, H) {
    // cicada forewing in a 512 x 192 design space: narrow base, straight costa, broad rounded tip, apical cells
    g.save(); g.scale(W / 512, H / 192);
    function outline() {
      g.beginPath();
      g.moveTo(8, 74);
      g.bezierCurveTo(90, 50, 250, 30, 420, 30);
      g.bezierCurveTo(480, 30, 508, 70, 500, 108);
      g.bezierCurveTo(492, 146, 450, 166, 400, 168);
      g.bezierCurveTo(300, 172, 190, 150, 110, 116);
      g.bezierCurveTo(70, 100, 34, 88, 8, 80);
      g.closePath();
    }
    function curve(c, w, a) {
      g.lineWidth = w; g.strokeStyle = "rgba(255,255,255," + a + ")";
      g.beginPath(); g.moveTo(c[0], c[1]);
      if (c.length === 8) g.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
      else g.quadraticCurveTo(c[2], c[3], c[4], c[5]);
      g.stroke();
    }
    outline();
    var mg = g.createLinearGradient(0, 0, 512, 0);
    mg.addColorStop(0, "rgba(236,240,255,0.26)");
    mg.addColorStop(0.3, "rgba(226,232,255,0.09)");
    mg.addColorStop(1, "rgba(226,232,255,0.06)");
    g.fillStyle = mg; g.fill();
    g.save(); outline(); g.clip();
    var ir = g.createLinearGradient(120, 180, 470, 20);
    ir.addColorStop(0, "rgba(120,255,235,0.08)");
    ir.addColorStop(0.5, "rgba(255,130,240,0.07)");
    ir.addColorStop(1, "rgba(255,214,130,0.07)");
    g.fillStyle = ir; g.fillRect(0, 0, 512, 192);
    g.lineCap = "round";
    // main veins from the base to the nodal line
    curve([10, 75, 100, 60, 220, 48, 332, 42], 2.2, 0.7);     // radius
    curve([10, 77, 110, 78, 220, 80, 338, 84], 1.8, 0.62);    // media
    curve([12, 79, 100, 96, 200, 118, 306, 146], 1.7, 0.6);   // cubitus
    curve([14, 81, 60, 94, 110, 110, 160, 130], 1.4, 0.5);    // anal
    curve([112, 79, 110, 88, 104, 98], 1.3, 0.5);             // basal cell
    curve([228, 49, 232, 66, 226, 81], 1.2, 0.45);
    curve([330, 33, 352, 92, 300, 152], 1.6, 0.6);            // nodal line
    // apical cells: veins fanning from the nodal line to the tip margin
    var from = [[333, 40], [338, 54], [341, 68], [342, 84], [340, 100], [334, 116], [325, 130], [313, 144]];
    var to = [[444, 31], [482, 44], [500, 72], [503, 100], [494, 130], [470, 152], [432, 165], [384, 170]];
    for (var i = 0; i < from.length; i++) {
      var f = from[i], t = to[i];
      curve([f[0], f[1], (f[0] + t[0]) / 2 + 4, (f[1] + t[1]) / 2, t[0], t[1]], 1.1, 0.48);
    }
    // ambient vein running just inside the tip margin
    g.save(); g.beginPath(); g.rect(360, 0, 160, 192); g.clip();
    g.translate(300, 100); g.scale(0.955, 0.9); g.translate(-300, -100);
    outline(); g.lineWidth = 1.2; g.strokeStyle = "rgba(255,255,255,0.42)"; g.stroke();
    g.restore();
    g.restore();
    // margin + thick costa + base
    outline(); g.lineWidth = 1.4; g.strokeStyle = "rgba(255,255,255,0.48)"; g.stroke();
    g.beginPath(); g.moveTo(8, 74); g.bezierCurveTo(90, 50, 250, 30, 420, 30);
    g.lineWidth = 3.4; g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath(); g.ellipse(14, 77, 9, 5, -0.2, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /* Lyric line: white core + grey halo, so the shader can tint and find the core. */
  function lineTexture(text, font, px, glow) {
    var meas = document.createElement("canvas").getContext("2d");
    meas.font = font;
    var tw = Math.max(4, meas.measureText(text).width);
    var pad = Math.ceil(glow * 2.2) + 8;
    var W = Math.ceil(tw + pad * 2), H = Math.ceil(px * 1.32 + pad * 2);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    g.font = font; g.textBaseline = "middle"; g.textAlign = "left";
    var y = H / 2 + px * 0.04;
    g.shadowColor = "#7a7a7a"; g.fillStyle = "#7a7a7a";
    g.shadowBlur = glow * 1.5; g.fillText(text, pad, y);
    g.shadowBlur = glow * 0.55; g.fillText(text, pad, y);
    g.shadowBlur = 0; g.fillStyle = "#ffffff"; g.fillText(text, pad, y);
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return { tex: tex, W: W, H: H, pad: pad, tw: tw };
  }

  /* ---------------- build ---------------- */
  function build(ctx) {
    var kit = ctx.kit || HH.kit, T = ctx.theme || HH.THEME, F = ctx.fonts || HH.FONTS;
    var ex = ctx.exhibit || {};
    var low = ctx.quality === "low";
    var reduced = !!ctx.reducedMotion;
    var root = new THREE.Group(); root.name = "room2-yuleum";
    ctx.anchor.add(root);

    S = {
      ctx: ctx, kit: kit, T: T, root: root, low: low, reduced: reduced,
      active: false, vt: 0, omega: reduced ? 0 : 0.3, boostUntil: -1, clock: 0, flash: 0,
      lines: [], tmpV: new THREE.Vector3(), tmpV2: new THREE.Vector3(), tmpV3: new THREE.Vector3(),
      cam: new THREE.Vector3(), dummy: new THREE.Object3D(), mtx: new THREE.Matrix4(), col: new THREE.Color(),
      curY: 0, st: { cur: -1, lt: 0, phase: "idle" }, eqColor: kit.color(T.violet, 0.5), eqTarget: new THREE.Color(), frameBase: kit.color(T.violet, 1.5)
    };

    var C = S.C = {
      unlit: kit.color(T.violet, 0.028),
      idle: kit.color("#c9b4ff", 0.6),
      idleHi: kit.color(T.amber, 0.72),
      prev: kit.color(T.violet, 0.24),
      prevHi: kit.color(T.amber, 0.85),
      cur: kit.color("#e6dbff", 1.55),
      curHi: kit.color(T.amber, 1.8),
      eqIdle: kit.color(T.violet, 0.55)
    };

    /* ===== wall: light pool + floating shadow ===== */
    var poolTex = kit.canvasTexture(256, 256, function (g) {
      var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    });
    var poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: kit.color("#9d86ff", 0.075), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    poolMat.toneMapped = false;
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2), poolMat);
    pool.position.set(HERO.x + 0.45, HERO.y + 0.15, 0.012);
    pool.renderOrder = -2;
    root.add(pool);

    var shTex = kit.canvasTexture(256, 256, function (g) {
      g.fillStyle = "#000"; g.shadowColor = "#000"; g.shadowBlur = 40;
      g.fillRect(66, 66, 124, 124);
    });
    var shMat = new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(HERO.size * 1.55, HERO.size * 1.55), shMat);
    shadow.position.set(HERO.x + 0.1, HERO.y - 0.14, 0.02);
    shadow.renderOrder = -1;
    root.add(shadow);

    /* ===== light cone onto the sleeve (not drawn: it places and lights the wings) ===== */
    S.beamA = new THREE.Vector3(HERO.x + 0.3, 6.4, 1.55);
    S.beamB = new THREE.Vector3(HERO.x + 0.1, HERO.y - 0.05, HERO.z);
    S.beamRTop = 0.32; S.beamRBot = 1.3;

    /* ===== hero: sleeve + record + frame ===== */
    var hero = new THREE.Group();
    hero.position.set(HERO.x, HERO.y, HERO.z);
    hero.rotation.y = HERO.yaw;
    root.add(hero);
    S.hero = hero;
    var hs = HERO.size / 2, th = 0.016;

    // photo face with a baked light falloff (vertex colors)
    var photoGeo = new THREE.PlaneGeometry(HERO.size, HERO.size, 4, 4);
    var pc = [], pp = photoGeo.attributes.position;
    for (var i = 0; i < pp.count; i++) {
      var px = pp.getX(i) / hs, py = pp.getY(i) / hs;
      var v = 1.0 - 0.13 * Math.pow(Math.max(0, (1 - py) / 2), 1.4) - 0.06 * px * px - 0.05 * Math.max(0, px);
      pc.push(v, v, v);
    }
    photoGeo.setAttribute("color", new THREE.Float32BufferAttribute(pc, 3));
    var photoMat = new THREE.MeshBasicMaterial({ color: kit.color("#c8c8d0"), vertexColors: true });
    var photo = new THREE.Mesh(photoGeo, photoMat);
    photo.position.z = th;
    hero.add(photo);
    S.photoMat = photoMat;

    // sleeve body: back + top/bottom/left edges (open on the right, where the record comes out)
    var parts = [];
    var back = new THREE.PlaneGeometry(HERO.size, HERO.size); back.rotateY(Math.PI); back.translate(0, 0, -th); parts.push(back);
    var top = new THREE.PlaneGeometry(HERO.size, th * 2); top.rotateX(-Math.PI / 2); top.translate(0, hs, 0); parts.push(top);
    var bot = new THREE.PlaneGeometry(HERO.size, th * 2); bot.rotateX(Math.PI / 2); bot.translate(0, -hs, 0); parts.push(bot);
    var lef = new THREE.PlaneGeometry(th * 2, HERO.size); lef.rotateY(-Math.PI / 2); lef.translate(-hs, 0, 0); parts.push(lef);
    var body = new THREE.Mesh(mergeGeos(parts), kit.darkMat("#1b2044", { roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }));
    hero.add(body);

    // record (sits between the sleeve faces)
    var rec = new THREE.Group();
    rec.position.set(REC.off, -0.015, 0);
    hero.add(rec);
    S.rec = rec;
    var recSize = low ? 512 : 1024;
    var recTex = kit.canvasTexture(recSize, recSize, function (g, w) { drawRecord(g, w, kit, T, F); });
    var disc = new THREE.Mesh(new THREE.CircleGeometry(REC.r, low ? 64 : 112),
      new THREE.MeshBasicMaterial({ map: recTex, color: kit.color("#d4d4dc") }));
    rec.add(disc);
    S.disc = disc;
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(REC.r * 0.997, REC.r * 0.997, 0.006, low ? 64 : 112, 1, true),
      new THREE.MeshBasicMaterial({ color: kit.color("#171722"), side: THREE.DoubleSide }));
    rim.rotation.x = Math.PI / 2;
    rec.add(rim);
    var sheenMat = new THREE.ShaderMaterial({
      uniforms: {
        inner: { value: REC.label * 1.06 }, outer: { value: 0.975 }, k: { value: 0.42 }, rot: { value: 1.2 },
        col: { value: kit.color("#d9d2ff") }, gaps: { value: new THREE.Vector3(GAPS[0], GAPS[1], GAPS[2]) }
      },
      vertexShader: SHEEN_VS, fragmentShader: SHEEN_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var sheen = new THREE.Mesh(new THREE.CircleGeometry(REC.r, low ? 48 : 96), sheenMat);
    sheen.position.z = 0.003;
    rec.add(sheen);
    S.sheenMat = sheenMat;

    // neon frame, just behind the sleeve (the record crosses in front of it)
    var fs = hs + 0.075, ft = 0.014, fz = -th - 0.03, fparts = [];
    var fb = function (w, h, x, y) { var b = new THREE.BoxGeometry(w, h, ft); b.translate(x, y, fz); fparts.push(b); };
    fb(fs * 2 + ft, ft, 0, fs); fb(fs * 2 + ft, ft, 0, -fs); fb(ft, fs * 2, -fs, 0); fb(ft, fs * 2, fs, 0);
    var frameMat = kit.neonMat(T.violet, 1.5);
    var frame = new THREE.Mesh(mergeGeos(fparts), frameMat);
    hero.add(frame);
    S.frameMat = frameMat;

    // clickables: record + sleeve spin the record up
    var spinUp = function () { S.boostUntil = S.clock + 2.8; S.flash = 1; };
    if (ctx.addClickable) {
      ctx.addClickable(disc, spinUp, "Spin the record");
      ctx.addClickable(photo, spinUp, "Spin the record");
    }

    /* ===== PLAY link (under the record) ===== */
    var link = (ex.links || [])[0];
    if (link && link.url) {
      var sub = str(link.sub).toUpperCase();
      var play = canvasMesh(kit, 560, 150, 0.19, function (g, w, h) {
        var ink = "#e3d6ff", glowC = T.violet;
        g.shadowColor = glowC; g.shadowBlur = 14;
        g.strokeStyle = ink; g.lineWidth = 5;
        roundRect(g, 12, 14, w - 24, h - 28, (h - 28) / 2); g.stroke();
        g.fillStyle = ink;
        g.beginPath(); g.moveTo(66, 48); g.lineTo(66, 102); g.lineTo(110, 75); g.closePath(); g.fill();
        g.textBaseline = "middle"; g.textAlign = "left";
        g.font = "700 60px " + HH.FONTS.display;
        if ("letterSpacing" in g) g.letterSpacing = "8px";
        g.fillText("PLAY", 136, 78);
        if (sub) {
          if ("letterSpacing" in g) g.letterSpacing = "4px";
          g.shadowBlur = 6; g.font = "500 28px " + HH.FONTS.mono; g.fillStyle = "#b9a6f0";
          g.fillText(sub, 340, 80);
        }
      });
      play.position.set(HERO.x + REC.off * Math.cos(HERO.yaw) + 0.05, HERO.y - hs - 0.36, 0.06);
      root.add(play);
      S.playMat = play.material;
      var hit = new THREE.Mesh(new THREE.PlaneGeometry(play.userData.size.w * 1.15, 0.34), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(play.position); hit.position.z += 0.01;
      root.add(hit);
      if (ctx.addClickable) ctx.addClickable(hit, function () { S.flash = 1; if (ctx.openLink) ctx.openLink(link.url); }, str(link.label) || "Play");
    }

    /* ===== facts plate (under the sleeve) ===== */
    var monoKR = '"IBM Plex Mono", "Noto Sans KR", ui-monospace, Menlo, monospace';
    var factsText = "YULEUM (율음) · BORN JULY 4, 2009\nCICADA · OCT. 17, 2024 · TRACK 2";
    var facts = kit.neonText(factsText, { font: monoKR, weight: "500", height: 0.068, color: "#b9bdf0", glow: 5, core: 0.25, align: "left", lineGap: 1.55, letterSpacing: 4 });
    facts.position.set(HERO.x - hs + 0.02, HERO.y - hs - 0.37, 0.03);
    facts.material.color.setScalar(0.85);
    root.add(facts);
    var tick = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.2), kit.neonMat(T.violet, 0.9));
    tick.position.set(HERO.x - hs - 0.06, facts.position.y, 0.03);
    root.add(tick);

    /* ===== lyric sheet ===== */
    var lyrics = (ex.lyrics || []).map(str);
    var trans = ex.translation || [];
    var hi = ex.highlight || [];
    var px = 100;
    var fontFor = function (i) {
      return hi.indexOf(i) >= 0 ? "400 " + px + "px " + F.krDisplay : "700 " + px + "px " + F.kr;
    };
    if (lyrics.length) {
      var meas = document.createElement("canvas").getContext("2d");
      var maxW = 1;
      lyrics.forEach(function (l, i) { meas.font = fontFor(i); maxW = Math.max(maxW, meas.measureText(l).width); });
      var availW = LYR.x1 - LYR.x0;
      var em = Math.min(LYR.emMax, availW / (maxW / px));
      var mPerPx = em / px;
      // vertical rhythm (translations add a sub-line)
      var hasT = lyrics.map(function (l, i) { return str(trans[i]).trim().length > 0; });
      var stepBase = em * 1.9, subH = em * 1.1;
      var total = 0;
      for (i = 0; i < lyrics.length - 1; i++) total += stepBase + (hasT[i] ? subH : 0);
      var maxSpan = LYR.top - LYR.bottom;
      var squash = total > maxSpan ? maxSpan / total : 1;
      var y = LYR.top, t0 = PRE_BEATS * BEAT;
      lyrics.forEach(function (l, i) {
        var isHi = hi.indexOf(i) >= 0;
        var tx = lineTexture(l, fontFor(i), px, 13);
        var w = tx.W * mPerPx, h = tx.H * mPerPx;
        var geo = new THREE.PlaneGeometry(w, h);
        geo.translate(w / 2 - tx.pad * mPerPx, 0, 0);
        var u0 = tx.pad / tx.W, u1 = (tx.pad + tx.tw) / tx.W;
        var mat = new THREE.ShaderMaterial({
          uniforms: {
            map: { value: tx.tex },
            cBase: { value: (isHi ? C.idleHi : C.idle).clone() },
            cLit: { value: (isHi ? C.idleHi : C.idle).clone() },
            wipe: { value: 2 }, soft: { value: (em * 0.5 / mPerPx) / tx.W }, glint: { value: 0 }, alpha: { value: 1 }
          },
          vertexShader: LINE_VS, fragmentShader: LINE_FS,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(LYR.x0, y, 0.04);
        root.add(mesh);
        var beats = kit.clamp(Math.round(Math.max(syllables(l) / 4.4, l.length / 14) * 2) / 2, 2.5, 3.5);
        var L = { mesh: mesh, u: mat.uniforms, u0: u0, u1: u1, hi: isHi, y: y, s: t0, d: beats * BEAT, beats: beats, trans: null };
        t0 += beats * BEAT;
        if (hasT[i]) {
          var tm = kit.neonText(str(trans[i]).trim(), { font: monoKR, weight: "500", height: em * 0.56, color: "#b8bcec", glow: 5, core: 0.3, align: "left" });
          tm.position.set(LYR.x0 + 0.01, y - em * 1.12 * squash, 0.04);
          root.add(tm);
          L.trans = tm.material;
        }
        S.lines.push(L);
        y -= (stepBase + (hasT[i] ? subH : 0)) * squash;
      });
      S.em = em;
      S.verseEnd = t0;
      S.holdEnd = t0 + HOLD_BEATS * BEAT;
      S.loopLen = S.holdEnd + FADE_BEATS * BEAT;
      var lastY = S.lines[S.lines.length - 1].y;

      // line numbers (one texture)
      var nPxPerM = 420, colW = 0.2;
      var spanTop = LYR.top + em, spanBot = lastY - em;
      var nH = Math.ceil((spanTop - spanBot) * nPxPerM), nW = Math.ceil(colW * nPxPerM);
      var nums = canvasMesh(kit, nW, nH, spanTop - spanBot, function (g, w) {
        g.font = "500 " + Math.round(em * 0.38 * nPxPerM) + "px " + HH.FONTS.mono;
        g.textAlign = "right"; g.textBaseline = "middle";
        g.fillStyle = "#6f75b8";
        S.lines.forEach(function (L, i) {
          g.fillText(String(i + 1).padStart(2, "0"), w - 6, (spanTop - L.y) * nPxPerM + em * 0.04 * nPxPerM);
        });
      });
      nums.position.set(LYR.x0 - 0.13 - colW / 2, (spanTop + spanBot) / 2, 0.04);
      root.add(nums);

      // "now" marker that rides down the sheet
      var nowMat = new THREE.MeshBasicMaterial({ color: C.cur.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      nowMat.toneMapped = false;
      var now = new THREE.Mesh(new THREE.PlaneGeometry(0.018, em * 1.15), nowMat);
      now.position.set(LYR.x0 - 0.075, LYR.top, 0.045);
      now.scale.y = 0.001;
      root.add(now);
      S.now = now; S.nowMat = nowMat; S.curY = LYR.top;

      // header: kicker + title + REC lamp
      var kick = kit.neonText("LYRICS · TRACK 2 · CICADA", { font: HH.FONTS.mono, weight: "500", height: 0.058, color: "#9aa0de", glow: 5, core: 0.2, align: "left", letterSpacing: 10 });
      kick.position.set(LYR.x0, LYR.top + em * 2.55 + 0.2, 0.04);
      root.add(kick);
      var title = kit.neonText(str(ex.title).toUpperCase(), { font: F.display, weight: "700", height: 0.2, color: T.violet, glow: 18, core: 0.6, align: "left", letterSpacing: 6 });
      title.position.set(LYR.x0 - 0.02, LYR.top + em * 2.55, 0.04);
      title.material.color.setScalar(1.1);
      root.add(title);
      var recLamp = canvasMesh(kit, 220, 80, 0.075, function (g) {
        g.shadowColor = "#ff3fd0"; g.shadowBlur = 12; g.fillStyle = "#ff8ae6";
        g.beginPath(); g.arc(34, 40, 15, 0, Math.PI * 2); g.fill();
        g.font = "500 44px " + HH.FONTS.mono; g.textBaseline = "middle"; g.textAlign = "left";
        if ("letterSpacing" in g) g.letterSpacing = "6px";
        g.fillText("REC", 66, 42);
      });
      recLamp.position.set(LYR.x1 - recLamp.userData.size.w / 2, kick.position.y, 0.04);
      recLamp.material.color.setScalar(0.12);
      root.add(recLamp);
      S.recMat = recLamp.material;

      // hairline rule between header and sheet
      var rule = new THREE.Mesh(new THREE.PlaneGeometry(LYR.x1 - LYR.x0 + 0.2, 0.006), kit.neonMat(T.ink, 1.6));
      rule.position.set((LYR.x0 + LYR.x1) / 2 - 0.1, LYR.top + em * 1.45, 0.035);
      root.add(rule);

      /* ===== EQ / waveform under the sheet ===== */
      var N = low ? 24 : 48;
      var eqY = lastY - em * 2.1;
      var x0 = LYR.x0, x1 = LYR.x1, pitch = (x1 - x0) / N;
      var eqMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      eqMat.toneMapped = false;
      var eq = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), eqMat, N);
      eq.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (i = 0; i < N; i++) eq.setColorAt(i, C.eqIdle);
      eq.frustumCulled = false;
      root.add(eq);
      S.eq = { mesh: eq, N: N, y: eqY, x0: x0 + pitch / 2, pitch: pitch, bw: pitch * 0.42, hMax: 0.13, h: new Float32Array(N) };
      var base = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.005), kit.neonMat(T.purple, 0.9));
      base.position.set((x0 + x1) / 2, eqY, 0.039);
      root.add(base);

      /* ===== human vs machine readout ===== */
      var hu = ex.human || {}, ma = ex.machine || {};
      var ry = eqY - 0.36;
      var addPair = function (label, value, color, x) {
        if (!value) return 0;
        var l = kit.neonText(label, { font: HH.FONTS.mono, weight: "500", height: 0.05, color: color, glow: 6, core: 0.2, align: "left", letterSpacing: 10 });
        l.position.set(x, ry + 0.115, 0.04); l.material.color.setScalar(0.75);
        root.add(l);
        var v = kit.neonText(value, { font: F.display, weight: "700", height: 0.12, color: color, glow: 14, core: 0.5, align: "left", letterSpacing: 3 });
        v.position.set(x - 0.01, ry - 0.02, 0.04); v.material.color.setScalar(1.15);
        root.add(v);
        return Math.max(l.userData.size.w, v.userData.size.w);
      };
      addPair("HUMAN TIME", str(hu.short), T.amber, x0);
      addPair("MACHINE TIME", str(ma.short), T.cyan, x0 + (x1 - x0) * 0.54);
    }

    /* ===== cicada wings ===== */
    var WN = low ? 14 : 32;
    var wingTex = kit.canvasTexture(low ? 256 : 512, low ? 96 : 192, drawWing);
    var wingMat = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    wingMat.toneMapped = false;
    var wings = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.375), wingMat, WN);
    wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wings.frustumCulled = false;
    var W = S.wings = { mesh: wings, N: WN, y0: new Float32Array(WN), spd: new Float32Array(WN), size: new Float32Array(WN),
      ph: new Float32Array(WN), ff: new Float32Array(WN), sf: new Float32Array(WN), tint: new Float32Array(WN), ymin: 1.15, ymax: 4.3 };
    var wr = kit.rand(704);
    for (i = 0; i < WN; i++) {
      W.y0[i] = wr() * 100; W.spd[i] = 0.06 + wr() * 0.07; W.size[i] = 0.16 + wr() * 0.08;
      W.ph[i] = wr() * 6.283; W.ff[i] = 1.6 + wr() * 2.2; W.sf[i] = (wr() - 0.5) * 0.9; W.tint[i] = wr();
      wings.setColorAt(i, C.unlit);
    }
    root.add(wings);
    S.wingWhite = kit.color("#fff4e8");
    S.wingViolet = kit.color("#cfe0ff");
    updateWings(0, 10, true);
    updateEQ(0, 0, false);

    /* ===== cover texture ===== */
    var coverUrl = ex.media && ex.media.cover ? (ctx.assetBase || "") + ex.media.cover : "";
    var load = coverUrl && ctx.loadTexture ? ctx.loadTexture(coverUrl) : Promise.reject(new Error("no cover"));
    return Promise.resolve(load).then(function (tex) {
      photoMat.map = tex; photoMat.needsUpdate = true;
    }).catch(function () {
      // fallback: dark printed sleeve with the album name
      photoMat.map = kit.canvasTexture(512, 512, function (g) {
        g.fillStyle = "#11163a"; g.fillRect(0, 0, 512, 512);
        g.fillStyle = "#c9cdf2"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "700 72px " + HH.FONTS.display; g.fillText("CICADA", 256, 240);
        g.font = "500 26px " + HH.FONTS.mono; g.fillText("YULEUM · 2024", 256, 310);
      });
      photoMat.needsUpdate = true;
    });
  }

  /* ---------------- per-frame pieces ---------------- */
  function updateWings(dt, t, force) {
    var W = S.wings; if (!W) return;
    var kit = S.kit, d = S.dummy, A = S.beamA, B = S.beamB;
    var n = S.tmpV, L = S.tmpV2, V = S.tmpV3, cam = S.cam;
    var range = W.ymax - W.ymin;
    var tt = S.reduced ? 18 : t;
    for (var i = 0; i < W.N; i++) {
      var fallen = W.y0[i] + W.spd[i] * tt;
      var cyc = Math.floor(fallen / range);
      var y = W.ymax - (fallen - cyc * range);
      var seed = i * 7919 + cyc * 104729;
      var ox = hash(seed) * 2 - 1, oz = hash(seed + 17) * 2 - 1;
      // beam axis at this height
      var s = (A.y - y) / (A.y - B.y);
      var ax = A.x + (B.x - A.x) * s, az = A.z + (B.z - A.z) * s;
      var r = Math.max(0.25, S.beamRTop + (S.beamRBot - S.beamRTop) * Math.min(s, 1.15));
      var ph = W.ph[i];
      var x = ax + ox * r * 1.05 + Math.sin(tt * 0.45 + ph) * 0.14;
      var z = kit.clamp(az + oz * r * 0.9 + Math.sin(tt * 0.33 + ph * 1.7) * 0.1, 0.62, 1.5);
      var below = y < HERO.y - HERO.size / 2 - 0.05 && x < HERO.x + HERO.size / 2 + 0.2;
      var dist = Math.sqrt(ox * ox + oz * oz * 0.6);
      var inBeam = kit.smoothstep(1.2, 0.45, dist) * (below ? 0.25 : 1);
      var fade = kit.smoothstep(W.ymin, W.ymin + 0.5, y) * kit.smoothstep(W.ymax, W.ymax - 0.45, y);
      d.position.set(x, y, z);
      d.rotation.set(Math.sin(tt * W.ff[i] + ph) * 0.75, Math.sin(tt * 0.6 + ph * 1.3) * 0.55, ph + tt * W.sf[i]);
      d.scale.setScalar(W.size[i]);
      d.updateMatrix();
      W.mesh.setMatrixAt(i, d.matrix);
      // glint toward viewer when the membrane faces the light
      n.set(0, 0, 1).applyQuaternion(d.quaternion);
      L.subVectors(A, d.position).normalize();
      V.subVectors(cam, d.position).normalize();
      L.add(V).normalize();
      var gl = Math.abs(n.dot(L)); gl = gl * gl; gl = gl * gl; gl = gl * gl; gl = gl * gl; // ^16
      var br = fade * (0.05 + inBeam * (0.2 + 2.8 * gl));
      S.col.copy(S.wingWhite).lerp(S.wingViolet, W.tint[i]).multiplyScalar(br);
      W.mesh.setColorAt(i, S.col);
    }
    W.mesh.instanceMatrix.needsUpdate = true;
    if (W.mesh.instanceColor) W.mesh.instanceColor.needsUpdate = true;
  }

  function updateEQ(dt, lt, playing, curColor) {
    var E = S.eq; if (!E) return;
    var kit = S.kit, m = S.mtx, h = E.h;
    var target = curColor || S.C.eqIdle;
    var k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
    S.eqColor.lerp(target, k);
    var b = lt / BEAT, ph = b - Math.floor(b);
    var kickE = Math.exp(-ph * 4.5);
    var six = Math.floor(b * 4);
    var hat = Math.exp(-(b * 4 - six) * 6) * 0.35;
    var t = S.clock;
    for (var i = 0; i < E.N; i++) {
      var u = i / (E.N - 1);
      var tgt;
      if (playing && !S.reduced) {
        var j = hash(six * 131 + i * 977);
        var wv = 0.5 + 0.5 * Math.sin(u * 9.0 + six * 1.9) * Math.sin(u * 3.1 - six * 0.7);
        var shape = 0.3 + 0.7 * Math.sin(Math.PI * (0.06 + 0.88 * u));
        var level = 0.4 + 0.6 * kickE;
        tgt = E.hMax * (shape * (0.1 + 0.9 * level * (0.6 * wv + 0.4 * j)) + hat * j * 0.25);
      } else {
        tgt = E.hMax * (0.1 + 0.07 * Math.sin(t * (S.reduced ? 0 : 0.9) + i * 0.42)) * (0.45 + 0.55 * Math.sin(Math.PI * (0.08 + 0.84 * u)));
      }
      h[i] = dt > 0 ? kit.damp(h[i], tgt, playing ? 22 : 4, dt) : tgt;
      var hh = Math.max(0.004, h[i] * 2);
      m.makeScale(E.bw, hh, 1);
      m.setPosition(E.x0 + i * E.pitch, E.y, 0.04);
      E.mesh.setMatrixAt(i, m);
      S.col.copy(S.eqColor).multiplyScalar(0.45 + 0.75 * (h[i] / E.hMax));
      E.mesh.setColorAt(i, S.col);
    }
    E.mesh.instanceMatrix.needsUpdate = true;
    if (E.mesh.instanceColor) E.mesh.instanceColor.needsUpdate = true;
  }

  function wipeAt(u, steps) {
    var x = u * steps, k = Math.floor(x), f = x - k;
    var e = f < 0.42 ? 1 - Math.pow(1 - f / 0.42, 3) : 1;
    return Math.min(1, (k + e) / steps);
  }

  function updateLyrics(dt, on) {
    var C = S.C, lines = S.lines;
    if (!lines.length) return null;
    var kb = 1 - Math.exp(-10 * dt), kl = 1 - Math.exp(-16 * dt);
    var cur = -1, lt = 0, phase = "idle";
    if (on && !S.reduced) {
      lt = S.vt % S.loopLen;
      phase = lt < S.lines[0].s ? "pre" : lt < S.verseEnd ? "verse" : lt < S.holdEnd ? "hold" : "fade";
    } else if (on) phase = "settled";
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i], u = L.u, tb, tl, wipe = 2, glint = 0, tlev = 1;
      if (phase === "idle") { tb = tl = L.hi ? C.idleHi : C.idle; tlev = 0.8; }
      else if (phase === "settled") { tb = tl = L.hi ? C.prevHi : C.idle; tlev = 0.85; }
      else if (phase === "pre" || phase === "fade" || lt < L.s) { tb = tl = C.unlit; tlev = 0.12; wipe = -1; }
      else if (lt < L.s + L.d) {
        cur = i; tb = C.unlit; tl = L.hi ? C.curHi : C.cur; tlev = 1.1;
        var p = Math.min(1, (lt - L.s) / (L.d * 0.86));
        wipe = L.u0 + (L.u1 - L.u0 + u.soft.value) * wipeAt(p, Math.round(L.beats * 4));
        glint = p < 1 ? 1 : 0;
      } else { tb = tl = L.hi ? C.prevHi : C.prev; tlev = 0.7; }
      u.cBase.value.lerp(tb, kb);
      u.cLit.value.lerp(tl, kl);
      u.wipe.value = wipe;
      u.glint.value = S.kit.damp(u.glint.value, glint, 12, dt);
      if (L.trans) { var c = L.trans.color.r; L.trans.color.setScalar(S.kit.damp(c, tlev, 8, dt)); }
    }
    // now-marker
    if (S.now) {
      var showNow = cur >= 0;
      if (showNow) S.curY = S.reduced ? lines[cur].y : S.kit.damp(S.curY, lines[cur].y, 18, dt);
      S.now.position.y = S.curY;
      S.now.scale.y = Math.max(0.001, S.kit.damp(S.now.scale.y, showNow ? 1 : 0.001, 14, dt));
      S.nowMat.color.lerp(cur >= 0 && lines[cur].hi ? C.curHi : C.cur, kl);
    }
    S.st.cur = cur; S.st.lt = lt; S.st.phase = phase;
    return S.st;
  }

  /* ---------------- room def ---------------- */
  HH.registerRoom(2, {
    build: function (ctx) { return build(ctx); },

    enter: function (ctx) {
      if (!S) return;
      S.active = true;
      S.vt = 0;
    },

    leave: function (ctx) {
      if (!S) return;
      S.active = false;
    },

    update: function (ctx, dt, t, state) {
      if (!S) return;
      dt = Math.min(dt || 0, 0.1);
      S.clock += dt;
      if (state && state.visible === false) return;
      var kit = S.kit;
      var on = S.active && (!state || state.active !== false);
      if (on) S.vt += dt;

      // viewer position in room space (for wing glints)
      if (ctx.camera) { S.cam.copy(ctx.camera.position); S.root.worldToLocal(S.cam); }

      // hero float + record spin
      if (!S.reduced) {
        S.hero.position.y = HERO.y + Math.sin(t * 0.53) * 0.012;
        S.hero.rotation.y = HERO.yaw + Math.sin(t * 0.31) * 0.018;
      }
      var boosting = S.clock < S.boostUntil;
      var target = S.reduced ? (boosting ? 0.9 : 0) : boosting ? 3.49 : on ? 0.85 : 0.28;
      S.omega = kit.damp(S.omega, target, boosting ? 2.6 : 1.1, dt);
      S.disc.rotation.z -= S.omega * dt;
      S.sheenMat.uniforms.k.value = 0.42 + Math.min(0.3, S.omega * 0.07);

      // lyrics + EQ
      var st = updateLyrics(dt, on);
      var playing = !!st && on && !S.reduced && (st.phase === "verse" || st.phase === "pre");
      var curCol = st && st.cur >= 0 ? (S.lines[st.cur].hi ? S.C.curHi : S.C.cur) : null;
      if (st && st.phase === "hold") curCol = S.C.prev;
      updateEQ(dt, st ? st.lt : 0, playing, curCol ? S.eqTarget.copy(curCol).multiplyScalar(0.5) : null);
      if (S.recMat) S.recMat.color.setScalar(kit.damp(S.recMat.color.r, on ? 1.35 : 0.12, 6, dt));

      // PLAY + frame breathing, click flash
      S.flash = Math.max(0, S.flash - dt * 1.8);
      if (S.playMat) {
        var pulse = on && !S.reduced ? 0.12 * Math.sin(t * 2.4) : 0;
        S.playMat.color.setScalar(0.95 + pulse + S.flash * 0.9);
      }
      S.frameMat.color.copy(S.frameBase).multiplyScalar(1 + S.flash * 0.5 + (on ? 0.12 : 0));

      // wings
      updateWings(dt, t, false);
    },

    panel: function (el, ctx) {
      var ex = (ctx && ctx.exhibit) || {}, T = HH.THEME, esc = HH.kit.esc;
      var lyr = ex.lyrics || [], tr = ex.translation || [], hi = ex.highlight || [];
      if (!el || !lyr.length) return;
      var h = '<div class="hh-sec"><div class="hh-h">Lyrics excerpt</div><ol class="hh-list" style="gap:9px">';
      lyr.forEach(function (line, i) {
        var isHi = hi.indexOf(i) >= 0;
        var t = str(tr[i]).trim();
        h += '<li style="display:grid;gap:4px;min-width:0;padding:1px 0 1px 11px;border-left:2px solid ' +
          (isHi ? T.amber : "rgba(184,139,255,.22)") + '">' +
          '<span class="hh-kr" style="font-size:15px;line-height:1.45;word-break:keep-all;overflow-wrap:anywhere;color:' + (isHi ? T.amber : T.white) + '">' + esc(line) + "</span>" +
          (t ? '<span class="hh-mono" style="font-size:12px;line-height:1.45;color:' + T.dim + '">' + esc(t) + "</span>"
            : ctx && ctx.draft ? '<span class="hh-note" style="justify-self:start;font-size:11px;padding:3px 8px">Your English translation of this line</span>' : "") +
          "</li>";
      });
      h += '</ol><div class="hh-mono" style="font-size:11px;letter-spacing:.06em;color:' + T.dim + '">Excerpt from the opening verse.</div></div>';
      el.innerHTML = h;
    }
  });
})();
