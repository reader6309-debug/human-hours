/* Human Hours Museum v2 · Room 4 · "The Study Hall"
   Henry's Yeolpumta (열품타) pure study time.
   Hero 1: 2,635 amber cubes (one per logged minute) stack into 7 towers, one per logged day.
   Hero 2: a 3D split-flap clock that flips from 00:00:00 to the best day, 10:56:24.
   Also: orbit ring of the 8 subjects, two holographic screenshot panels, haze, cyan "machine" cube.
   Classic script. Registers HH.registerRoom(4, ...). All copy comes from config.js. */
(function () {
  "use strict";
  if (!window.HH || !HH.registerRoom) return;

  /* ---------------- layout (anchor-local meters) ---------------- */
  var CUBE = 0.06, PITCH = 0.066, COLS = 6, PER = COLS * COLS;
  var MX = 2.55;                                            // machine cube x
  var TDX = 0.6;                                           // tower spacing
  var PL = { w: 6.6, h: 0.85, d: 0.8, z: 0.55, lab: 0.5, labY: 0.35 };             // plinth
  var STEP = 0.45, DAYDUR = 1.3, FALL = 0.6, FLASH = 0.4;   // cube animation
  var CLK = { y: 3.55, z: 0.1, dw: 0.40, dh: 0.62, gap: 0.045, colon: 0.15 };
  var RING = { y: 2.58, z: 0.7, rx: 2.25, rz: 0.6 };
  var MON = ["JAN.", "FEB.", "MAR.", "APR.", "MAY", "JUN.", "JUL.", "AUG.", "SEPT.", "OCT.", "NOV.", "DEC."];
  var CLOCK_CYC = [1, 1, 1, 1, 2, 2];                       // extra wheel cycles per digit
  var S = null;                                             // runtime state (closure)

  /* ---------------- small helpers ---------------- */
  function str(v) { return v == null ? "" : String(v); }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtHM(m) { return Math.floor(m / 60) + "h " + (m % 60) + "m"; }
  function fmtTot(m) { return Math.floor(m / 60) + " h " + (m % 60) + " m"; }
  function parseHMS(s) {
    var p = str(s).split(":").map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    return p;
  }
  function validDay(d) { return d && d.min > 0; }
  function dateWord(d) {
    var p = str(d).split("/");
    var m = parseInt(p[0], 10);
    if (!(m >= 1 && m <= 12) || !p[1]) return "";
    return MON[m - 1] + " " + p[1];
  }
  function ls(g, px) { if ("letterSpacing" in g) g.letterSpacing = px + "px"; }

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

  /* Merge {g: BufferGeometry, c: Color | cfn(x,y,z) -> Color} into one vertex-colored geometry. */
  function mergeColored(items) {
    var pos = [], col = [];
    items.forEach(function (it) {
      var g = it.g.index ? it.g.toNonIndexed() : it.g;
      var p = g.attributes.position.array;
      for (var i = 0; i < p.length; i += 3) {
        var c = it.cfn ? it.cfn(p[i], p[i + 1], p[i + 2]) : it.c;
        pos.push(p[i], p[i + 1], p[i + 2]);
        col.push(c.r, c.g, c.b);
      }
      if (g !== it.g) g.dispose();
      it.g.dispose();
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  function box(w, h, d, x, y, z, wSeg) {
    var g = new THREE.BoxGeometry(w, h, d, wSeg || 1, 1, 1);
    g.translate(x, y, z);
    return g;
  }
  function rectFrame(items, cx, cy, w, h, t, z, cfn) {
    items.push({ g: box(w, t, t, cx, cy + h / 2, z, Math.max(1, Math.round(w / 0.15))), cfn: cfn });
    items.push({ g: box(w, t, t, cx, cy - h / 2, z, Math.max(1, Math.round(w / 0.15))), cfn: cfn });
    items.push({ g: box(t, h, t, cx - w / 2, cy, z, 1), cfn: cfn });
    items.push({ g: box(t, h, t, cx + w / 2, cy, z, 1), cfn: cfn });
  }
  /* L bracket at a corner. sx/sy = +1 when the corner is the right / top one. */
  function bracket(items, x, y, sx, sy, len, th, z, color) {
    items.push({ g: box(len, th, th, x - sx * len / 2, y, z), c: color });
    items.push({ g: box(th, len, th, x, y - sy * len / 2, z), c: color });
  }
  function vcMat() {
    var m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.toneMapped = false;
    return m;
  }

  /* ---------------- shaders ---------------- */
  var FLAP_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var FLAP_FS = [
    "uniform sampler2D map;uniform float dF;uniform float dB;uniform float mode;uniform float shade;",
    "varying vec2 vUv;",
    "void main(){",
    "  float u=vUv.x,v=vUv.y,d,cv;",
    "  if(mode<0.5){d=dB;cv=0.5+0.5*v;}",                 // static top: the new digit
    "  else if(mode<1.5){d=dF;cv=0.5*v;}",                // static bottom: the old digit
    "  else if(gl_FrontFacing){d=dF;cv=0.5+0.5*v;}",      // flap front: old top half
    "  else{d=dB;cv=0.5-0.5*v;}",                         // flap back: new bottom half
    "  float hd=(mode>0.5&&mode<1.5)?1.0-v:v;",           // distance from the hinge
    "  float m=texture2D(map,vec2((d+u)/10.0,cv)).r;",
    "  float core=smoothstep(0.5,0.92,m);float halo=m*0.5;",
    "  vec3 amber=vec3(1.0,0.445,0.049);",
    "  vec3 base=mix(vec3(0.010,0.014,0.046),vec3(0.030,0.040,0.105),smoothstep(0.0,0.9,hd));",
    "  float side=smoothstep(0.0,0.035,u)*smoothstep(0.0,0.035,1.0-u);",
    "  base*=mix(0.5,1.0,side);",
    "  base*=mix(0.12,1.0,smoothstep(0.0,0.014,hd));",   // dark seam at the hinge
    "  vec3 gl=mix(amber,vec3(1.0,0.6,0.2),core*0.3);",
    "  vec3 col=base+gl*(halo*0.45+core*1.4)*mix(0.35,1.0,smoothstep(0.0,0.02,hd));",
    "  gl_FragColor=vec4(col*shade,1.0);",
    "}"
  ].join("\n");

  var PANEL_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var PANEL_FS = [
    "uniform sampler2D map;uniform float uTime;uniform float uGlitch;uniform float uAlpha;uniform float uRows;uniform float uSeed;uniform float uGain;",
    "varying vec2 vUv;",
    "float hs(float n){return fract(sin(n*127.1+uSeed*13.7)*43758.5453);}",
    "void main(){",
    "  vec2 uv=vUv;",
    "  float tq=floor(uTime*8.0);",
    "  float row=floor(uv.y*28.0);",
    "  float gate=step(0.88,hs(row*1.7+tq*3.1))*uGlitch;",
    "  uv.x+=gate*(hs(row+tq)-0.5)*0.12;",
    "  float ca=0.0028+uGlitch*0.010+0.0030*abs(vUv.x-0.5)*2.0;",
    "  float r=texture2D(map,uv+vec2(ca,0.0)).r;",
    "  float g=texture2D(map,uv).g;",
    "  float b=texture2D(map,uv-vec2(ca,0.0)).b;",
    "  vec3 c=pow(vec3(r,g,b),vec3(2.2));",
    "  float sl=0.5+0.5*sin((vUv.y*uRows-uTime*0.35)*6.2831853);",
    "  c*=0.78+0.22*sl;",
    "  float band=exp(-pow((vUv.y-fract(uTime*0.09+uSeed))*14.0,2.0));",
    "  c+=vec3(0.05,0.30,0.40)*band*0.30;",
    "  float edge=smoothstep(0.0,0.06,vUv.x)*smoothstep(0.0,0.06,1.0-vUv.x)*smoothstep(0.0,0.06,vUv.y)*smoothstep(0.0,0.06,1.0-vUv.y);",
    "  c*=mix(0.5,1.0,edge);",
    "  c+=vec3(0.045,0.0,0.03)*(1.0-vUv.x)*(1.0-vUv.y)+vec3(0.0,0.03,0.045)*vUv.x*vUv.y;",
    "  c+=vec3(0.0,0.35,0.4)*gate*0.25;",
    "  gl_FragColor=vec4(c*uGain,uAlpha);",
    "}"
  ].join("\n");

  var HAZE_VS = [
    "attribute vec4 aSeed;uniform float uTime;uniform float uPx;varying float vA;varying float vT;",
    "void main(){",
    "  vec3 p=position;float range=3.9;",
    "  float y=mod(p.y-0.5+uTime*aSeed.x,range);",
    "  p.y=0.5+y;",
    "  p.x+=sin(uTime*0.23+aSeed.z*6.283)*0.16;",
    "  p.z+=cos(uTime*0.19+aSeed.z*6.283)*0.12;",
    "  vec4 mv=modelViewMatrix*vec4(p,1.0);",
    "  gl_Position=projectionMatrix*mv;",
    "  gl_PointSize=aSeed.y*uPx*900.0/max(0.5,-mv.z);",
    "  float fade=smoothstep(0.0,0.5,y)*smoothstep(range,range-0.9,y);",
    "  vA=fade*(0.6+0.4*sin(uTime*1.3+aSeed.z*40.0));",
    "  vT=aSeed.w;",
    "}"
  ].join("\n");
  var HAZE_FS = [
    "varying float vA;varying float vT;",
    "void main(){",
    "  float d=length(gl_PointCoord-0.5)*2.0;",
    "  float a=1.0-smoothstep(0.0,1.0,d);a*=a;",
    "  vec3 c=mix(vec3(0.42,0.24,0.95),vec3(0.95,0.5,0.15),step(0.82,vT));",
    "  gl_FragColor=vec4(c,a*vA*0.5);",
    "}"
  ].join("\n");

  /* ---------------- textures ---------------- */
  function makeAtlas(kit, F) {
    var cw = 192, ch = 300, W = cw * 10;
    return kit.canvasTexture(W, ch, function (g) {
      g.fillStyle = "#000"; g.fillRect(0, 0, W, ch);
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "700 262px " + F.display;
      for (var d = 0; d < 10; d++) {
        var cx = d * cw + cw / 2, cy = ch / 2 + 8, s = String(d);
        g.shadowColor = "#808080"; g.fillStyle = "#808080";
        g.shadowBlur = 30; g.fillText(s, cx, cy);
        g.shadowBlur = 10; g.fillText(s, cx, cy);
        g.shadowBlur = 0; g.fillStyle = "#ffffff"; g.fillText(s, cx, cy);
      }
    });
  }

  /* ---------------- cubes ---------------- */
  function cubeGeo() {
    var g = new THREE.BoxGeometry(1, 1, 1);
    var shade = [0.52, 0.66, 1.0, 0.2, 0.92, 0.3];          // +x -x +y -y +z -z
    var c = [];
    for (var f = 0; f < 6; f++) for (var v = 0; v < 4; v++) c.push(shade[f], shade[f], shade[f]);
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    return g;
  }
  function writeM(a, i, s, x, y, z, cs, sn) {
    var o = i * 16;
    a[o] = cs * s; a[o + 1] = 0; a[o + 2] = -sn * s; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sn * s; a[o + 9] = 0; a[o + 10] = cs * s; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
  }

  /* t = seconds since the show began. Returns the number of landed cubes. */
  function stepCubes(t) {
    var C = S.cube; if (!C) return 0;
    var arr = C.mesh.instanceMatrix.array, col = C.mesh.instanceColor.array, base = C.base;
    var n = 0, N = C.N;
    for (var i = 0; i < N; i++) {
      var td = t - C.st[i], u = td / FALL, k = i * 3, d = C.day[i];
      if (u <= 0) {
        writeM(arr, i, 0, C.fx[i], C.fy[i], C.fz[i], C.cs[d], C.sn[d]);
        col[k] = base[k]; col[k + 1] = base[k + 1]; col[k + 2] = base[k + 2];
        continue;
      }
      var f = 1;
      if (u >= 1) {
        u = 1; n++;
        var tl = td - FALL;
        if (tl < FLASH) { var q = 1 - tl / FLASH; f = 1 + 1.9 * q * q; }
      }
      var r = 1 - u; r = r * r * r;                          // ease-out cubic landing
      var s = CUBE * (0.35 + 0.65 * Math.min(1, u * 3));
      writeM(arr, i, s, C.fx[i] + C.dx[i] * r, C.fy[i] + C.dh[i] * r, C.fz[i] + C.dz[i] * r, C.cs[d], C.sn[d]);
      col[k] = base[k] * f; col[k + 1] = base[k + 1] * f; col[k + 2] = base[k + 2] * f;
    }
    C.mesh.instanceMatrix.needsUpdate = true;
    C.mesh.instanceColor.needsUpdate = true;
    return n;
  }

  /* slow scanner band that climbs the towers while idle */
  function stepSweep(sy, on) {
    var C = S.cube; if (!C) return;
    var col = C.mesh.instanceColor.array, base = C.base, N = C.N;
    for (var i = 0; i < N; i++) {
      var k = i * 3, w = 0;
      if (on) { var dy = (C.fy[i] - sy) / 0.1; w = Math.exp(-dy * dy); }
      col[k] = base[k] * (1 + 1.1 * w) + 0.0 * w;
      col[k + 1] = base[k + 1] * (1 + 1.1 * w) + 0.16 * w;
      col[k + 2] = base[k + 2] * (1 + 1.1 * w) + 0.24 * w;
    }
    C.mesh.instanceColor.needsUpdate = true;
  }

  /* ---------------- counter + clock ---------------- */
  function drawCounter(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.textAlign = "center"; g.textBaseline = "middle";
    var done = S.shown >= S.total;
    var txt = done ? num(S.total) + " MIN" : num(S.shown) + " → " + num(S.total) + " MIN";
    g.font = "500 84px " + HH.FONTS.mono;
    g.shadowColor = HH.THEME.amber; g.fillStyle = HH.THEME.amber;
    g.shadowBlur = 26; g.fillText(txt, w / 2, h * 0.38, 980);
    g.shadowBlur = 8; g.fillText(txt, w / 2, h * 0.38, 980);
    g.shadowBlur = 0; g.globalAlpha = 0.5; g.fillStyle = "#ffffff"; g.fillText(txt, w / 2, h * 0.38, 980); g.globalAlpha = 1;
    g.font = "500 30px " + HH.FONTS.mono; ls(g, 6);
    g.fillStyle = HH.THEME.violet; g.shadowColor = HH.THEME.violet; g.shadowBlur = 8;
    g.fillText(S.sub, w / 2, h * 0.8, 980);
    g.shadowBlur = 0; ls(g, 0);
  }
  function refreshCounter(n) {
    if (n === S.shownDrawn) return;
    S.shownDrawn = n; S.shown = n;
    S.counterTex.redraw(drawCounter);
  }

  function applyDigit(dg, c, frac) {
    if (dg.c !== c) {
      dg.c = c;
      var a = c % 10, b = (c + 1) % 10;
      dg.uTop.dB.value = b;
      dg.uBot.dF.value = a;
      dg.uFlap.dF.value = a; dg.uFlap.dB.value = b;
    }
    var th = Math.PI * Math.pow(frac, 1.7);
    dg.flap.rotation.x = th;
    var k = th / Math.PI;
    dg.uTop.shade.value = 0.4 + 0.6 * k;
    dg.uBot.shade.value = 1 - 0.55 * k;
    dg.uFlap.shade.value = 1 - 0.42 * Math.sin(th);
  }
  function stepClock(t) {
    var D = S.digits;
    for (var i = 0; i < D.length; i++) {
      var dg = D[i];
      var p = Math.min(1, Math.max(0, (t - dg.start) / dg.dur));
      if (p >= 1) { applyDigit(dg, dg.F, 0); continue; }
      var e = 0.5 - 0.5 * Math.cos(Math.PI * p);
      var f = dg.F * e, c = Math.floor(f);
      applyDigit(dg, c, f - c);
    }
  }
  function clockFinal() { for (var i = 0; i < S.digits.length; i++) applyDigit(S.digits[i], S.digits[i].F, 0); }

  function settle() {
    S.anim.on = false;
    if (S.cube) { stepCubes(1e6); S.sweepOn = false; }
    refreshCounter(S.total);
    clockFinal();
  }
  function startAnim() {
    if (!S) return;
    if (S.reduced || (!S.cube && !S.digits.length)) { settle(); return; }
    S.anim.on = true; S.anim.t = 0; S.sweepOn = false;
    stepCubes(0); stepClock(0); refreshCounter(0);
  }

  /* ---------------- build ---------------- */
  function build(ctx) {
    var kit = ctx.kit || HH.kit, T = ctx.theme || HH.THEME, F = ctx.fonts || HH.FONTS;
    var ex = ctx.exhibit || {}, fx = ex.facts || {};
    var days = (fx.days || []).filter(validDay);
    var low = ctx.quality === "low";
    var reduced = !!ctx.reducedMotion;
    var monoKR = '"IBM Plex Mono", "Noto Sans KR", ui-monospace, Menlo, monospace';
    var root = new THREE.Group(); root.name = "room4-ypt";
    ctx.anchor.add(root);

    var N = 0, bestIdx = -1, bestMin = 0;
    days.forEach(function (d, i) { N += Math.round(d.min); if (d.min > bestMin) { bestMin = d.min; bestIdx = i; } });
    var hms = parseHMS(fx.bestDay);
    var cVioB = kit.color(T.violet, 1.1), cMag = kit.color(T.magenta, 1.25), cCyan = kit.color(T.cyan, 1.25), cVio = kit.color(T.violet, 0.55);
    var tmpC = new THREE.Color();

    S = {
      ctx: ctx, kit: kit, reduced: reduced, active: false, clock: 0, total: N, shown: N, shownDrawn: N,
      sub: (N ? fmtTot(N) + " · " + days.length + " LOGGED DAYS" : ""),
      anim: { on: false, t: 0 }, animEnd: 4.7, sweepOn: false, sweepT: 0, nextSweep: 6,
      cube: null, digits: [], panels: [], ring: null, flash: 0, cyanSpin: 0,
      cubeMat: null, hazeU: null
    };

    var towerX = days.map(function (d, i) { return (i - (days.length - 1) / 2) * TDX; });
    var towerYaw = days.map(function (d, i) { return 0.42 + 0.05 * Math.sin(i * 2.1); });

    /* ===== wall haze (dark, subtle) ===== */
    var g1 = kit.glowSprite("#ffb23f", 4, 0.06); g1.position.set(0, 1.7, 0.03); root.add(g1);
    var g2 = kit.glowSprite("#7b3bff", 3.6, 0.08); g2.position.set(0, 3.5, 0.03); root.add(g2);

    /* ===== plinth ===== */
    var plinth = new THREE.Mesh(new THREE.BoxGeometry(PL.w, PL.h, PL.d), kit.darkMat("#0d1238", { roughness: 0.5, metalness: 0.35 }));
    plinth.position.set(0, PL.h / 2, PL.z);
    root.add(plinth);

    // neon edge: magenta -> violet -> cyan along the front-top edge, fine verticals at the ends
    var edge = [];
    var gradX = function (x) {
      var k = (x / PL.w) + 0.5;
      if (k < 0.5) tmpC.copy(cMag).lerp(cVioB, k * 2);
      else tmpC.copy(cVioB).lerp(cCyan, (k - 0.5) * 2);
      return tmpC;
    };
    edge.push({ g: box(PL.w + 0.02, 0.014, 0.014, 0, PL.h, PL.z + PL.d / 2, 44), cfn: function (x) { return gradX(x); } });
    edge.push({ g: box(PL.w + 0.02, 0.01, 0.01, 0, PL.labY - 0.02, PL.z + PL.d / 2, 44), cfn: function (x) { return gradX(x).clone().multiplyScalar(0.55); } });
    edge.push({ g: box(0.012, PL.h, 0.012, -PL.w / 2, PL.h / 2, PL.z + PL.d / 2, 1), c: cMag });
    edge.push({ g: box(0.012, PL.h, 0.012, PL.w / 2, PL.h / 2, PL.z + PL.d / 2, 1), c: cCyan });
    root.add(new THREE.Mesh(mergeColored(edge), vcMat()));

    // top surface: fine grid + tower footprints
    var topPx = 2048, topH = Math.round(topPx * PL.d / PL.w);
    var topTex = kit.canvasTexture(topPx, topH, function (g, w, h) {
      var ppm = w / PL.w;
      g.clearRect(0, 0, w, h);
      g.lineWidth = 1.4;
      var xm, zm;
      for (xm = -PL.w / 2; xm <= PL.w / 2 + 0.001; xm += 0.15) {
        var major = Math.abs(Math.round(xm / 0.75) * 0.75 - xm) < 0.01;
        g.strokeStyle = "rgba(150,110,255," + (major ? 0.34 : 0.14) + ")";
        g.beginPath(); g.moveTo(w / 2 + xm * ppm, 0); g.lineTo(w / 2 + xm * ppm, h); g.stroke();
      }
      for (zm = -PL.d / 2; zm <= PL.d / 2 + 0.001; zm += 0.15) {
        g.strokeStyle = "rgba(150,110,255,0.2)";
        g.beginPath(); g.moveTo(0, h / 2 + zm * ppm); g.lineTo(w, h / 2 + zm * ppm); g.stroke();
      }
      g.globalCompositeOperation = "destination-in";
      var vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.55);
      vg.addColorStop(0, "rgba(0,0,0,1)"); vg.addColorStop(1, "rgba(0,0,0,0.25)");
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
      var half = COLS * PITCH / 2 * ppm + 6;
      days.forEach(function (d, i) {
        g.save(); g.translate(w / 2 + towerX[i] * ppm, h / 2); g.rotate(-towerYaw[i]);
        g.fillStyle = "rgba(255,178,63,0.10)"; g.fillRect(-half, -half, half * 2, half * 2);
        g.strokeStyle = i === bestIdx ? "rgba(255,200,110,0.95)" : "rgba(255,178,63,0.7)"; g.lineWidth = 2.5;
        g.strokeRect(-half, -half, half * 2, half * 2);
        g.restore();
      });
    });
    var topMat = new THREE.MeshBasicMaterial({ map: topTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    topMat.toneMapped = false;
    var top = new THREE.Mesh(new THREE.PlaneGeometry(PL.w, PL.d), topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, PL.h + 0.002, PL.z);
    root.add(top);

    // front face: tower labels
    var frPx = 3072, frH = Math.round(frPx * PL.lab / PL.w);
    var frontTex = kit.canvasTexture(frPx, frH, function (g, w, h) {
      var ppm = w / PL.w;
      g.clearRect(0, 0, w, h);
      g.textAlign = "center"; g.textBaseline = "middle";
      days.forEach(function (d, i) {
        var x = w / 2 + towerX[i] * ppm, best = i === bestIdx;
        if (i > 0) {
          g.fillStyle = "rgba(150,110,255,0.22)";
          g.fillRect(w / 2 + (towerX[i] - TDX / 2) * ppm, h * 0.14, 2, h * 0.72);
        }
        g.fillStyle = best ? T.amber : "#e8eaff";
        g.font = "700 " + Math.round(0.125 * ppm) + "px " + F.display; ls(g, 1);
        g.fillText(str(d.date), x, h * 0.27, 0.56 * ppm);
        g.fillStyle = best ? "#ffd18a" : "#b4baf0";
        g.font = "500 " + Math.round(0.085 * ppm) + "px " + F.mono; ls(g, 0);
        g.fillText(fmtHM(d.min), x, h * 0.55, 0.58 * ppm);
        g.fillStyle = best ? T.amber : "#7479c0";
        g.font = "500 " + Math.round(0.042 * ppm) + "px " + F.mono; ls(g, 3);
        g.fillText(best ? "BEST · " + d.min + " MIN" : d.min + " MIN", x, h * 0.8, 0.58 * ppm);
      });
      ls(g, 0);
      g.textAlign = "center"; g.fillStyle = T.cyan; g.shadowColor = T.cyan; g.shadowBlur = 8;
      g.font = "500 " + Math.round(0.04 * ppm) + "px " + F.mono; ls(g, 4);
      g.fillText("MACHINE · " + str((ex.machine || {}).short), w / 2 + MX * ppm, h * 0.5, 0.62 * ppm);
      g.shadowBlur = 0; ls(g, 0);
    });
    var frontMat = new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, depthWrite: false });
    frontMat.toneMapped = false;
    var front = new THREE.Mesh(new THREE.PlaneGeometry(PL.w, PL.lab), frontMat);
    front.position.set(0, PL.labY + PL.lab / 2, PL.z + PL.d / 2 + 0.004);
    root.add(front);

    /* ===== cube towers ===== */
    if (N > 0) {
      var C = S.cube = {
        N: N, fx: new Float32Array(N), fy: new Float32Array(N), fz: new Float32Array(N),
        st: new Float32Array(N), dh: new Float32Array(N), dx: new Float32Array(N), dz: new Float32Array(N),
        day: new Uint8Array(N), base: new Float32Array(N * 3),
        cs: new Float32Array(days.length), sn: new Float32Array(days.length)
      };
      var amber = kit.color(T.amber);
      var maxLayers = 1;
      days.forEach(function (d) { maxLayers = Math.max(maxLayers, Math.ceil(d.min / PER)); });
      var cellOrder = [];
      for (var oi = 0; oi < PER; oi++) cellOrder.push(oi);
      cellOrder.sort(function (a, b) {
        var ax = (a % COLS) - (COLS - 1) / 2, az = Math.floor(a / COLS) - (COLS - 1) / 2;
        var bx = (b % COLS) - (COLS - 1) / 2, bz = Math.floor(b / COLS) - (COLS - 1) / 2;
        var da = ax * ax + az * az, db = bx * bx + bz * bz;
        return da !== db ? da - db : Math.atan2(az, ax) - Math.atan2(bz, bx);
      });
      var rnd = kit.rand(4004), k = 0;
      days.forEach(function (d, di) {
        var n = Math.round(d.min), nl = Math.ceil(n / PER);
        var cs = Math.cos(towerYaw[di]), sn = Math.sin(towerYaw[di]);
        C.cs[di] = cs; C.sn[di] = sn;
        for (var j = 0; j < n; j++, k++) {
          var layer = Math.floor(j / PER), idx = cellOrder[j % PER];
          var lx = ((idx % COLS) - (COLS - 1) / 2) * PITCH, lz = (Math.floor(idx / COLS) - (COLS - 1) / 2) * PITCH;
          C.fx[k] = towerX[di] + lx * cs + lz * sn;
          C.fz[k] = PL.z - lx * sn + lz * cs;
          C.fy[k] = PL.h + CUBE / 2 + 0.004 + layer * PITCH;
          C.st[k] = di * STEP + (j / n) * DAYDUR;
          C.dh[k] = 0.9 + rnd() * 0.7;
          C.dx[k] = (rnd() - 0.5) * 0.18; C.dz[k] = (rnd() - 0.5) * 0.18;
          C.day[k] = di;
          var shade = layer === nl - 1 ? 1.5 : 0.5 + 0.3 * (layer / maxLayers) + (layer % 2 ? 0.05 : 0);
          shade *= 0.94 + rnd() * 0.12;
          C.base[k * 3] = amber.r * shade; C.base[k * 3 + 1] = amber.g * shade; C.base[k * 3 + 2] = amber.b * shade;
        }
      });
      var cubeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      cubeMat.toneMapped = false;
      S.cubeMat = cubeMat;
      var cubes = new THREE.InstancedMesh(cubeGeo(), cubeMat, N);
      cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      tmpC.setRGB(1, 1, 1);
      for (var ci = 0; ci < N; ci++) cubes.setColorAt(ci, tmpC);
      cubes.instanceColor.setUsage(THREE.DynamicDrawUsage);
      cubes.frustumCulled = false;
      C.mesh = cubes;
      root.add(cubes);
      S.animEnd = (days.length - 1) * STEP + DAYDUR + FALL + 0.1;
    }

    /* ===== machine cube (one cyan block for scale) ===== */
    var mx = MX, my = PL.h + CUBE / 2 + 0.06;
    var mcube = new THREE.Mesh(new THREE.BoxGeometry(CUBE, CUBE, CUBE), kit.neonMat(T.cyan, 1.8));
    mcube.position.set(mx, my, PL.z);
    mcube.rotation.y = 0.42;
    root.add(mcube);
    S.mcube = mcube; S.mcubeY = my;
    var mglow = kit.glowSprite("#3cecff", 0.34, 0.4);
    mglow.position.set(mx, my, PL.z + 0.02);
    root.add(mglow);
    S.mglow = mglow;
    var mb = [];
    var bl = 0.045, bh = 0.13;
    bracket(mb, mx - bh, my + bh, -1, 1, bl, 0.006, PL.z + 0.1, cCyan);
    bracket(mb, mx + bh, my + bh, 1, 1, bl, 0.006, PL.z + 0.1, cCyan);
    bracket(mb, mx - bh, my - bh, -1, -1, bl, 0.006, PL.z + 0.1, cCyan);
    bracket(mb, mx + bh, my - bh, 1, -1, bl, 0.006, PL.z + 0.1, cCyan);
    root.add(new THREE.Mesh(mergeColored(mb), vcMat()));

    /* ===== readouts: HUMAN TIME (amber) / MACHINE TIME (cyan) ===== */
    var hu = ex.human || {}, ma = ex.machine || {};
    var addReadout = function (label, value, color, x, y) {
      if (!value) return;
      var l = kit.neonText(label, { font: F.mono, weight: "500", height: 0.058, color: color, glow: 6, core: 0.2, align: "left", letterSpacing: 12 });
      l.position.set(x, y + 0.125, 0.04); l.material.color.setScalar(0.75);
      root.add(l);
      var v = kit.neonText(value, { font: F.display, weight: "700", height: 0.13, color: color, glow: 18, core: 0.5, align: "left", letterSpacing: 3 });
      v.position.set(x - 0.01, y, 0.04); v.material.color.setScalar(1.15);
      root.add(v);
    };
    addReadout("HUMAN TIME", str(hu.short), T.amber, -3.3, 1.3);
    addReadout("MACHINE TIME", str(ma.short), T.cyan, 2.42, 1.3);

    if (days.length) {
      var hud = kit.neonText("CH 04 \u00B7 LOG\n" + days[0].date + " \u2013 " + days[days.length - 1].date, { font: F.mono, weight: "500", height: 0.048, color: T.dim, glow: 4, core: 0.15, align: "left", letterSpacing: 8, lineGap: 1.7 });
      hud.position.set(-3.3, 1.06, 0.04);
      root.add(hud);
    }

    /* ===== split-flap clock ===== */
    var clock = new THREE.Group();
    clock.position.set(0, CLK.y, CLK.z);
    root.add(clock);
    S.clockGroup = clock;
    var kinds = ["d", "d", "c", "d", "d", "c", "d", "d"], xs = [], tot = 0;
    kinds.forEach(function (kd) { tot += (kd === "d" ? CLK.dw : CLK.colon); });
    tot += CLK.gap * (kinds.length - 1);
    var cx = -tot / 2, dIdx = 0, colonX = [], digitX = [];
    kinds.forEach(function (kd) {
      var wd = kd === "d" ? CLK.dw : CLK.colon;
      var c = cx + wd / 2;
      if (kd === "d") digitX.push(c); else colonX.push(c);
      cx += wd + CLK.gap;
    });
    var pw = tot + 0.24, ptop = CLK.dh / 2 + 0.14, pbot = -(CLK.dh / 2 + 0.06), ph = ptop - pbot, pcy = (ptop + pbot) / 2;
    var plate = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.04), kit.darkMat("#070a22", { roughness: 0.6, metalness: 0.3 }));
    plate.position.set(0, pcy, -0.035);
    clock.add(plate);

    var cf = [];
    var gradY = function (x, y) { return tmpC.copy(cCyan).lerp(cMag, kit.clamp((ptop - y) / ph, 0, 1)); };
    rectFrame(cf, 0, pcy, pw, ph, 0.012, 0.0, function (x, y) { return gradY(x, y); });
    bracket(cf, -pw / 2 - 0.06, ptop + 0.06, -1, 1, 0.2, 0.014, 0.0, kit.color(T.cyan, 1.7));
    bracket(cf, pw / 2 + 0.06, ptop + 0.06, 1, 1, 0.2, 0.014, 0.0, kit.color(T.cyan, 1.7));
    bracket(cf, -pw / 2 - 0.06, pbot - 0.06, -1, -1, 0.2, 0.014, 0.0, kit.color(T.magenta, 1.7));
    bracket(cf, pw / 2 + 0.06, pbot - 0.06, 1, -1, 0.2, 0.014, 0.0, kit.color(T.magenta, 1.7));
    var pin = kit.color(T.violet, 0.5);
    digitX.forEach(function (x) {
      cf.push({ g: box(0.02, 0.022, 0.03, x - CLK.dw / 2 - 0.012, 0, 0.0), c: pin });
      cf.push({ g: box(0.02, 0.022, 0.03, x + CLK.dw / 2 + 0.012, 0, 0.0), c: pin });
    });
    clock.add(new THREE.Mesh(mergeColored(cf), vcMat()));

    // colons
    var cl = [], colC = kit.color(T.amber, 1.5);
    colonX.forEach(function (x) {
      cl.push({ g: box(0.04, 0.04, 0.02, x, 0.09, 0.0), c: colC });
      cl.push({ g: box(0.04, 0.04, 0.02, x, -0.09, 0.0), c: colC });
    });
    var colonMesh = new THREE.Mesh(mergeColored(cl), vcMat());
    clock.add(colonMesh);
    S.colonMesh = colonMesh;

    // HR / MIN / SEC tags
    var tags = canvasMesh(kit, 1024, 64, pw * 64 / 1024, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = T.violet;
      g.font = "500 26px " + F.mono; ls(g, 7);
      var ppm = w / pw, names = ["HR", "MIN", "SEC"];
      for (var i = 0; i < 3; i++) g.fillText(names[i], w / 2 + ((digitX[i * 2] + digitX[i * 2 + 1]) / 2) * ppm, h / 2);
      ls(g, 0);
    });
    tags.material.color.setScalar(0.8);
    tags.position.set(0, ptop - 0.065, -0.012);
    clock.add(tags);

    var atlas = makeAtlas(kit, F);
    var tgt = hms ? [Math.floor(hms[0] / 10), hms[0] % 10, Math.floor(hms[1] / 10), hms[1] % 10, Math.floor(hms[2] / 10), hms[2] % 10] : [0, 0, 0, 0, 0, 0];
    var zero = !hms || (hms[0] + hms[1] + hms[2]) === 0;
    var halfGeo = new THREE.PlaneGeometry(CLK.dw, CLK.dh / 2); halfGeo.translate(0, CLK.dh / 4, 0);
    var halfGeoB = new THREE.PlaneGeometry(CLK.dw, CLK.dh / 2); halfGeoB.translate(0, -CLK.dh / 4, 0);
    var mkMat = function (mode, side) {
      var u = { map: { value: atlas }, dF: { value: 0 }, dB: { value: 0 }, mode: { value: mode }, shade: { value: 1 } };
      var m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLAP_VS, fragmentShader: FLAP_FS, side: side });
      return { m: m, u: u };
    };
    digitX.forEach(function (x, i) {
      var a = mkMat(0, THREE.FrontSide), b = mkMat(1, THREE.FrontSide), c = mkMat(2, THREE.DoubleSide);
      var topM = new THREE.Mesh(halfGeo, a.m); topM.position.set(x, 0, 0);
      var botM = new THREE.Mesh(halfGeoB, b.m); botM.position.set(x, 0, 0);
      var flap = new THREE.Mesh(halfGeo, c.m); flap.position.set(x, 0, 0.004);
      clock.add(topM); clock.add(botM); clock.add(flap);
      S.digits.push({
        flap: flap, uTop: a.u, uBot: b.u, uFlap: c.u, c: -1,
        F: tgt[i] + (zero ? 0 : 10 * CLOCK_CYC[i]), start: 0.15 + 0.05 * i, dur: 3.7 + 0.1 * i
      });
    });
    if (!zero) S.animEnd = Math.max(S.animEnd, 0.15 + 0.25 + 3.7 + 0.5 + 0.1);

    var clkHit = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ visible: false }));
    clkHit.position.set(0, pcy, 0.05);
    clock.add(clkHit);
    var replay = function () { if (S) startAnim(); };
    if (ctx.addClickable) ctx.addClickable(clkHit, replay, "Replay the clock");

    // caption, chip, HUD stack
    var bd = days[bestIdx];
    var capTxt = "PURE STUDY TIME" + (bd && dateWord(bd.date) ? " · " + dateWord(bd.date) : "");
    var cap = kit.neonText(capTxt, { font: F.mono, weight: "500", height: 0.07, color: T.violet, glow: 8, core: 0.25, letterSpacing: 14 });
    cap.position.set(0, CLK.y + pbot - 0.12, CLK.z);
    cap.material.color.setScalar(0.95);
    root.add(cap);

    if (str(fx.dDay)) {
      var chip = canvasMesh(kit, 300, 120, 0.15, function (g, w, h) {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = T.magenta; g.lineWidth = 5; g.shadowColor = T.magenta; g.shadowBlur = 16;
        g.beginPath(); g.moveTo(30, 12); g.lineTo(w - 12, 12); g.lineTo(w - 12, h - 30); g.lineTo(w - 30, h - 12);
        g.lineTo(12, h - 12); g.lineTo(12, 30); g.closePath(); g.stroke();
        g.shadowBlur = 20; g.fillStyle = "#ffd6f6"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "700 62px " + F.display; ls(g, 3);
        g.fillText(str(fx.dDay), w / 2, h / 2 + 3);
      });
      chip.position.set(1.2, CLK.y + pbot - 0.12, CLK.z);
      root.add(chip);
    }
    /* ===== counter ===== */
    var counter = canvasMesh(kit, 1024, 230, 0.5, function (g, w, h) { drawCounter(g, w, h); });
    counter.position.set(0, 2.3, 0.05);
    root.add(counter);
    S.counterTex = counter.material.map;

    /* ===== subject ring ===== */
    var subjects = fx.subjects || [];
    if (subjects.length) {
      var pts = [], seg = 128;
      for (var q = 0; q < seg; q++) {
        var a = q / seg * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * RING.rx, RING.y, RING.z + Math.sin(a) * RING.rz));
      }
      var lg = new THREE.BufferGeometry().setFromPoints(pts);
      var lmat = new THREE.LineBasicMaterial({ color: kit.color(T.violet, 0.8), transparent: true, opacity: 0.35, depthWrite: false });
      lmat.toneMapped = false;
      root.add(new THREE.LineLoop(lg, lmat));
      S.ring = { labels: [], n: subjects.length, phase: 0.8 };
      subjects.forEach(function (s, i) {
        var m = kit.neonText(str(s).toUpperCase(), { font: monoKR, weight: "500", height: 0.062, color: T.violet, glow: 7, core: 0.3, letterSpacing: 8 });
        root.add(m);
        S.ring.labels.push(m);
      });
      updateRing(0, true);
    }

    /* ===== screenshot panels ===== */
    var panelDefs = [];
    var media = ex.media || {};
    var span = days.length ? days[0].date + " – " + days[days.length - 1].date : "";
    if (media.calendar) panelDefs.push({ url: media.calendar, ar: 862 / 1600, x: -2.7, yaw: 0.45, name: "YEOLPUMTA (열품타) · CALENDAR", tag: span, seed: 0.13, period: 6.7 });
    if (media.timer) panelDefs.push({ url: media.timer, ar: 1001 / 1600, x: 2.7, yaw: -0.45, name: "YEOLPUMTA (열품타) · TIMER", tag: str(fx.bestDay) ? "BEST " + str(fx.bestDay) : "", seed: 0.61, period: 8.9 });
    var loads = [];
    var darkTex = kit.canvasTexture(2, 2, function (g) { g.fillStyle = "#05061a"; g.fillRect(0, 0, 2, 2); });
    panelDefs.forEach(function (pd, pi) {
      var w = 1.2, h = w * pd.ar;
      var grp = new THREE.Group();
      grp.position.set(pd.x, 3.5, 0.2); grp.rotation.y = pd.yaw;
      root.add(grp);
      var u = {
        map: { value: darkTex }, uTime: { value: 0 }, uGlitch: { value: 0 }, uAlpha: { value: 0.9 },
        uRows: { value: Math.round(h / 0.02) }, uSeed: { value: pd.seed }, uGain: { value: 0.85 }
      };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PANEL_VS, fragmentShader: PANEL_FS, transparent: true, depthWrite: false });
      var img = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      grp.add(img);
      // rim light frame: magenta on one side, cyan on the other, HUD corner brackets
      var fr = [], sgn = pd.x < 0 ? 1 : -1;
      var gradPX = function (x) { return tmpC.copy(cMag).lerp(cCyan, kit.clamp((x * sgn) / w + 0.5, 0, 1)); };
      rectFrame(fr, 0, 0, w + 0.05, h + 0.05, 0.008, -0.004, function (x) { return gradPX(x).clone().multiplyScalar(0.8); });
      var bw = w / 2 + 0.1, bh2 = h / 2 + 0.1, bL = 0.16;
      bracket(fr, -bw, bh2, -1, 1, bL, 0.012, 0.004, cCyan);
      bracket(fr, bw, bh2, 1, 1, bL, 0.012, 0.004, cMag);
      bracket(fr, -bw, -bh2, -1, -1, bL, 0.012, 0.004, cMag);
      bracket(fr, bw, -bh2, 1, -1, bL, 0.012, 0.004, cCyan);
      grp.add(new THREE.Mesh(mergeColored(fr), vcMat()));
      var strip = canvasMesh(kit, 1200, 70, w * 70 / 1200 * 1.0, function (g, cw, chh) {
        g.clearRect(0, 0, cw, chh);
        g.textBaseline = "middle"; g.font = "500 40px " + monoKR; ls(g, 3);
        g.fillStyle = T.violet; g.textAlign = "left"; g.fillText(pd.name, 4, chh / 2, cw * 0.72);
        g.fillStyle = T.cyan; g.textAlign = "right"; g.fillText(pd.tag, cw - 4, chh / 2, cw * 0.3);
        ls(g, 0);
      });
      strip.material.color.setScalar(0.9);
      strip.position.set(0, -h / 2 - 0.15, 0.004);
      grp.add(strip);
      var P = { grp: grp, u: u, y0: 3.5, ph: pi * 2.1, period: pd.period, kick: 0, off: pi * 3.3 };
      S.panels.push(P);
      if (ctx.addClickable) ctx.addClickable(img, function () { P.kick = 1; }, "Glitch the screen");
      if (ctx.loadTexture) {
        loads.push(Promise.resolve(ctx.loadTexture((ctx.assetBase || "") + pd.url)).then(function (tex) {
          u.map.value = tex;
        }).catch(function () {}));
      }
    });

    /* ===== Yeolpumta app-icon sign (backlit, left of the minute counter) ===== */
    (function () {
      var LH = 0.45, LWd = LH * 293 / 337, GAPX = 0.16, LY = 2.26, RIGHT = -0.9, CAPH = 0.07, CGLOW = 8;
      var grp = new THREE.Group();
      grp.position.set(0, LY, CLK.z); grp.visible = false;
      root.add(grp);
      var cap = kit.neonText("YEOLPUMTA · 열품타", { font: monoKR, weight: "500", height: CAPH, color: T.amber, glow: CGLOW, core: 0.25, align: "left", letterSpacing: 14 });
      cap.material.color.setScalar(0.9);
      var padW = (Math.ceil(CGLOW * 2.2) + 8) * CAPH / 160;
      var textW = cap.userData.size.w - 2 * padW;
      var total = LWd + GAPX + textW, x0 = RIGHT - total;
      cap.position.set(x0 + LWd + GAPX, 0, 0);
      grp.add(cap);
      var glow = kit.glowSprite("#ffb23f", 1, 0.12);
      glow.scale.set(0.95, 0.8, 1);
      glow.position.set(x0 + LWd / 2, 0, -0.03);
      grp.add(glow);
      var lmat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, color: kit.color("#d0d0d8") });
      lmat.toneMapped = false;
      var logo = new THREE.Mesh(new THREE.PlaneGeometry(LWd, LH), lmat);
      logo.position.set(x0 + LWd / 2, 0, 0);
      grp.add(logo);
      S.logo = { grp: grp, mat: lmat, glow: glow, base: kit.color("#d0d0d8") };
      if (ctx.loadTexture) {
        loads.push(Promise.resolve(ctx.loadTexture((ctx.assetBase || "") + "assets/ypt-logo.png")).then(function (tex) {
          lmat.map = tex; lmat.needsUpdate = true; grp.visible = true;
        }).catch(function () {}));
      }
    })();

    /* ===== hit box over the towers ===== */
    if (N > 0 && ctx.addClickable) {
      var th = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.5, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
      th.position.set(0, PL.h + 0.75, PL.z);
      root.add(th);
      ctx.addClickable(th, replay, "Rebuild the towers");
    }
    if (ctx.addClickable) {
      var mh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      mh.position.set(mx, my, PL.z);
      root.add(mh);
      ctx.addClickable(mh, function () { S.flash = 1; S.cyanSpin = 1; }, "Machine block");
    }

    /* ===== haze in the spotlight ===== */
    var HN = low ? 45 : 100;
    var hp = new Float32Array(HN * 3), hs = new Float32Array(HN * 4), hr = kit.rand(77);
    for (var hi = 0; hi < HN; hi++) {
      hp[hi * 3] = (hr() + hr() - 1) * 3.4;
      hp[hi * 3 + 1] = 0.5 + hr() * 3.9;
      hp[hi * 3 + 2] = 0.15 + hr() * 1.8;
      hs[hi * 4] = 0.03 + hr() * 0.05; hs[hi * 4 + 1] = 0.012 + hr() * 0.02; hs[hi * 4 + 2] = hr(); hs[hi * 4 + 3] = hr();
    }
    var hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.BufferAttribute(hp, 3));
    hg.setAttribute("aSeed", new THREE.BufferAttribute(hs, 4));
    var pr = ctx.renderer && ctx.renderer.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
    S.hazeU = { uTime: { value: 5 }, uPx: { value: pr } };
    var hm = new THREE.ShaderMaterial({ uniforms: S.hazeU, vertexShader: HAZE_VS, fragmentShader: HAZE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    var haze = new THREE.Points(hg, hm);
    haze.frustumCulled = false;
    root.add(haze);

    settle();
    return Promise.all(loads);
  }

  /* ---------------- per-frame pieces ---------------- */
  function updateRing(t, force) {
    var R = S.ring; if (!R) return;
    var kit = S.kit;
    for (var i = 0; i < R.n; i++) {
      var a = (i / R.n) * Math.PI * 2 + (S.reduced ? R.phase : t * 0.1 + R.phase);
      var s = Math.sin(a);                                   // +1 = front
      var m = R.labels[i];
      m.position.set(Math.cos(a) * RING.rx, RING.y, RING.z + s * RING.rz);
      var k = 0.5 + 0.5 * s;
      m.scale.setScalar(0.85 + 0.2 * k);
      m.material.color.setScalar(0.28 + 0.8 * k);
    }
  }

  /* ---------------- room def ---------------- */
  HH.registerRoom(4, {
    build: function (ctx) { return build(ctx); },

    enter: function (ctx) {
      if (!S) return;
      S.active = true;
      startAnim();
    },

    leave: function (ctx) {
      if (!S) return;
      S.active = false;
      settle();
    },

    update: function (ctx, dt, t, state) {
      if (!S) return;
      dt = Math.min(dt || 0, 0.5);
      S.clock += dt;
      if (state && state.visible === false) return;
      var kit = S.kit, on = S.active && (!state || state.active !== false);

      if (S.anim.on) {
        S.anim.t += dt;
        var n = stepCubes(S.anim.t);
        stepClock(S.anim.t);
        refreshCounter(n);
        if (S.anim.t >= S.animEnd) settle();
      } else if (S.cube && !S.reduced) {
        // idle: occasional scanner sweep over the towers
        if (!S.sweepOn) {
          S.nextSweep -= dt;
          if (S.nextSweep <= 0) { S.sweepOn = true; S.sweepT = 0; }
        } else {
          S.sweepT += dt;
          var sy = PL.h + (S.sweepT / 2.4) * 1.5;
          if (S.sweepT > 2.4) { S.sweepOn = false; S.nextSweep = 7 + (S.clock % 3); stepSweep(0, false); }
          else stepSweep(sy, true);
        }
      }

      if (S.reduced) return;

      // glow breathing
      S.flash = Math.max(0, S.flash - dt * 1.6);
      if (S.cubeMat) S.cubeMat.color.setScalar((on ? 1.1 : 1.0) + 0.05 * Math.sin(S.clock * 0.9));
      S.colonMesh.material.color.setScalar(0.7 + 0.3 * (0.5 + 0.5 * Math.sin(S.clock * 3.1)));

      // machine cube
      S.cyanSpin = Math.max(0, S.cyanSpin - dt * 0.6);
      S.mcube.rotation.y += dt * (0.5 + S.cyanSpin * 5);
      S.mcube.position.y = S.mcubeY + Math.sin(S.clock * 1.4) * 0.012;
      S.mglow.material.opacity = 0.34 + 0.08 * Math.sin(S.clock * 1.4) + S.flash * 0.5;

      // app-icon sign: slow soft pulse while the room is active
      if (S.logo && S.logo.grp.visible) {
        var lp = on ? 0.5 + 0.5 * Math.sin(S.clock * 1.5) : 0.5;
        S.logo.glow.material.opacity = 0.11 + 0.05 * lp;
        S.logo.mat.color.copy(S.logo.base).multiplyScalar(on ? 0.96 + 0.08 * lp : 1);
      }

      // ring + haze
      updateRing(S.clock, false);
      if (S.hazeU) S.hazeU.uTime.value = S.clock;

      // panels: float, scan time, glitch bursts
      for (var i = 0; i < S.panels.length; i++) {
        var P = S.panels[i], ph = (S.clock + P.off) % P.period;
        var env = ph < 0.4 ? Math.pow(1 - ph / 0.4, 2) : 0;
        P.kick = Math.max(0, P.kick - dt * 2.2);
        P.u.uGlitch.value = Math.max(env * 0.85, P.kick);
        P.u.uTime.value = S.clock;
        P.grp.position.y = P.y0 + Math.sin(S.clock * 0.6 + P.ph) * 0.025;
      }
    },

    panel: function (el, ctx) {
      var ex = (ctx && ctx.exhibit) || {}, fx = ex.facts || {};
      var T = HH.THEME, esc = HH.kit.esc;
      var days = (fx.days || []).filter(validDay);
      if (!el || !days.length) return;
      var total = 0, max = 0, best = 0;
      days.forEach(function (d, i) { total += d.min; if (d.min > max) { max = d.min; best = i; } });
      if (fx.totalMin) total = fx.totalMin;
      var h = '<div class="hh-sec"><div class="hh-h">Logged days · bars to scale</div>' +
        '<div class="hh-mono" style="display:grid;gap:8px">';
      days.forEach(function (d, i) {
        var pct = (d.min / max * 100).toFixed(2), isBest = i === best;
        h += '<div style="display:grid;grid-template-columns:54px minmax(0,1fr) 64px;gap:10px;align-items:center;font-size:12px;line-height:1.2">' +
          '<span style="color:' + T.dim + '">' + esc(d.date) + '</span>' +
          '<span style="display:block;height:12px;background:rgba(255,255,255,.05)"><span style="display:block;height:100%;width:' + pct + '%;background:' + T.amber +
          ';opacity:' + (isBest ? 1 : 0.72) + ';box-shadow:0 0 10px rgba(255,178,63,' + (isBest ? 0.55 : 0.3) + ')"></span></span>' +
          '<span style="text-align:right;color:' + (isBest ? T.amber : T.white) + '">' + esc(fmtHM(d.min)) + '</span></div>';
      });
      var mshort = str((ex.machine || {}).short);
      if (mshort) {
        h += '<div style="display:grid;grid-template-columns:54px minmax(0,1fr) 64px;gap:10px;align-items:center;font-size:12px;line-height:1.2">' +
          '<span style="color:' + T.cyan + ';font-size:10px;letter-spacing:.06em">MACHINE</span>' +
          '<span style="display:block;height:12px"><span style="display:block;height:100%;width:2px;background:' + T.cyan + ';box-shadow:0 0 10px rgba(60,236,255,.6)"></span></span>' +
          '<span style="text-align:right;color:' + T.cyan + ';font-size:10px;letter-spacing:.04em">' + esc(mshort) + '</span></div>';
      }
      h += '</div><div class="hh-row" style="gap:22px;align-items:flex-end;margin-top:4px">' +
        '<div><div class="hh-h" style="color:' + T.dim + '">Total</div><div class="hh-mono" style="font-size:24px;line-height:1.2;color:' + T.amber + ';font-weight:500">' + esc(fmtTot(total)) + '</div>' +
        '<div class="hh-mono" style="font-size:11px;color:' + T.dim + '">' + num(total) + ' min</div></div>';
      if (str(fx.bestDay)) {
        h += '<div><div class="hh-h" style="color:' + T.dim + '">Best day</div><div class="hh-mono" style="font-size:24px;line-height:1.2;color:' + T.white + ';font-weight:500">' + esc(fx.bestDay) + '</div>' +
          '<div class="hh-mono" style="font-size:11px;color:' + T.dim + '">' + esc(dateWord(days[best].date)) + '</div></div>';
      }
      if (str(fx.dDay)) h += '<span class="hh-chip" style="border-color:' + T.magenta + ';color:' + T.magenta + '">' + esc(fx.dDay) + '</span>';
      h += '</div>';
      var subs = fx.subjects || [];
      if (subs.length) {
        h += '<div class="hh-h" style="margin-top:6px">Subjects</div><div class="hh-row">';
        subs.forEach(function (s) { h += '<span class="hh-chip">' + esc(s) + '</span>'; });
        h += '</div>';
      }
      h += '</div>';
      el.innerHTML = h;
    }
  });
})();
