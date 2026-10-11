/* Human Hours Museum v2 · Room 5 · "The Algorithm Room"
   Henry's Spotify. Hero: MY CHART, five favorite artists as a rack of vinyl records with big neon ranks.
   Middle: dot-matrix LED chart board (recent plays, now playing, equalizer) and a floating hologram of the screenshot.
   Right: the algorithm (library + mixes wired to a central node, packets with trails) and the glitch record
   of The Velvet Sundown (click to reveal).
   Classic script. Registers HH.registerRoom(5, ...). All copy comes from config.js. */
(function () {
  "use strict";
  if (!window.HH || !HH.registerRoom) return;

  /* ---------------- layout (anchor-local meters) ---------------- */
  var SEARCH = "https://open.spotify.com/search/";
  var RACK = { x: -0.18, px: 0, pw: 2.16, y0: 3.85, step: 0.74, r: 0.35, z: 0.11 };
  var BOARD = { x: -2.5, y: 2.35, w: 1.7, h: 2.2, dw: 170, dh: 220 };
  var GRAPH = { x: 2.6, y: 3.5, z: 0.05, ring: 0.58 };
  var VEL = { x: 2.6, y: 1.4, r: 0.38 };
  var SHOT = { x: -2.5, y: 3.86, w: 1.1, z: 0.3 };
  var GAPS = [0.55, 0.7, 0.85];
  var EQ_PITCH = 0.02, EQ_ROWS = 16;

  var S = null; // runtime state (closure)

  /* ---------------- helpers ---------------- */
  function str(v) { return v == null ? "" : String(v); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hash(n) {
    n = (n << 13) ^ n;
    var m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
    m = (Math.imul(n, m) + 1376312589) & 0x7fffffff;
    return m / 2147483647;
  }
  function searchUrl(q) { return SEARCH + encodeURIComponent(q); }

  function mergeGeos(list) {
    var pos = [], nor = [], uv = [];
    list.forEach(function (g) {
      var ng = g.index ? g.toNonIndexed() : g;
      var p = ng.attributes.position.array, n = ng.attributes.normal.array, u = ng.attributes.uv.array;
      var i;
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
  /* list of { g: geometry, c: THREE.Color (linear), cf: optional fn(x, y) -> Color } -> one vertex-colored geometry */
  function mergeColored(list) {
    var pos = [], col = [];
    list.forEach(function (it) {
      var ng = it.g.index ? it.g.toNonIndexed() : it.g;
      var p = ng.attributes.position.array;
      for (var i = 0; i < p.length; i += 3) {
        pos.push(p[i], p[i + 1], p[i + 2]);
        var c = it.cf ? it.cf(p[i], p[i + 1]) : it.c;
        col.push(c.r, c.g, c.b);
      }
      if (ng !== it.g) ng.dispose();
      it.g.dispose();
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  function boxAt(w, h, d, x, y, z) {
    var g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  /* HUD corner brackets around a rectangle */
  function addBrackets(list, cx, cy, w, h, len, t, z, cA, cB) {
    var hw = w / 2, hh = h / 2, d = 0.01;
    [[-1, 1, cA], [1, 1, cB], [-1, -1, cB], [1, -1, cA]].forEach(function (k) {
      var x = cx + k[0] * hw, y = cy + k[1] * hh;
      list.push({ g: boxAt(len, t, d, x - k[0] * len / 2, y, z), c: k[2] });
      list.push({ g: boxAt(t, len, d, x, y - k[1] * len / 2, z), c: k[2] });
    });
  }
  function colorMesh(geo) {
    var m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.toneMapped = false;
    return new THREE.Mesh(geo, m);
  }
  function addMat(map, color, opacity) {
    var m = new THREE.MeshBasicMaterial({ map: map || null, color: color || 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: opacity == null ? 1 : opacity });
    m.toneMapped = false;
    return m;
  }
  /* Canvas -> additive plane. worldH = plane height in meters. */
  function canvasPlane(kit, wPx, hPx, worldH, draw) {
    var tex = kit.canvasTexture(wPx, hPx, draw);
    var w = worldH * wPx / hPx;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, worldH), addMat(tex));
    mesh.userData.size = { w: w, h: worldH };
    return mesh;
  }
  function neon(g, text, x, y, o) {
    var blur = o.blur == null ? 12 : o.blur;
    g.save();
    g.font = o.font; g.textAlign = o.align || "left"; g.textBaseline = "middle";
    if ("letterSpacing" in g) g.letterSpacing = (o.ls || 0) + "px";
    g.shadowColor = o.color; g.fillStyle = o.color;
    g.shadowBlur = blur * 1.5; g.fillText(text, x, y);
    g.shadowBlur = blur * 0.5; g.fillText(text, x, y);
    g.shadowBlur = 0;
    g.globalAlpha = o.core == null ? 0.45 : o.core; g.fillStyle = "#ffffff"; g.fillText(text, x, y);
    g.restore();
  }
  function fitFont(g, text, make, maxW, start, min) {
    for (var s = start; s >= min; s--) { g.font = make(s); if (g.measureText(text).width <= maxW) return s; }
    g.font = make(min);
    return min;
  }
  function ellipsize(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    while (text.length > 1 && g.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }
  /* quadratic bezier component */
  function qb(a, c, b, t) { var u = 1 - t; return u * u * a + 2 * u * t * c + t * t * b; }

  /* ---------------- shaders ---------------- */
  var NOISE = "float h1(float n){return fract(sin(n*91.345+17.17)*43758.5453);}";
  var PT_VS = [
    "attribute float size;attribute vec3 color;attribute float phase;",
    "uniform float uScale;uniform float uTime;uniform float uBoost;",
    "varying vec3 vC;",
    "void main(){",
    "  vec4 mv=modelViewMatrix*vec4(position,1.0);",
    "  gl_Position=projectionMatrix*mv;",
    "  float tw=0.86+0.14*sin(uTime*1.7+phase*6.2831);",
    "  vC=color*uBoost*tw;",
    "  gl_PointSize=clamp(size*uScale/max(0.1,-mv.z),1.0,120.0);",
    "}"
  ].join("\n");
  var PT_FS = [
    "varying vec3 vC;",
    "void main(){",
    "  vec2 q=gl_PointCoord-0.5;float d=length(q)*2.0;",
    "  if(d>1.0)discard;",
    "  float a=(1.0-d)*(1.0-d);",
    "  float core=pow(1.0-d,6.0);",
    "  float m=max(vC.r,max(vC.g,vC.b));",
    "  gl_FragColor=vec4(vC*a+vec3(core*0.35*m),1.0);",
    "}"
  ].join("\n");

  var UV_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var SHEEN_FS = [
    "uniform float inner;uniform float outer;uniform float k;uniform float rot;uniform vec3 col;uniform vec3 gaps;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 p=vUv*2.0-1.0;float r=length(p);",
    "  if(r>outer||r<inner)discard;",
    "  float a=atan(p.y,p.x)-rot;float ca=abs(cos(a));",
    "  float w=pow(ca,40.0)+pow(ca,7.0)*0.08;",
    "  float fade=smoothstep(inner,inner+0.05,r)*(1.0-smoothstep(outer-0.02,outer,r));",
    "  float g=1.0",
    "    -0.7*(exp(-pow((r-gaps.x)/0.007,2.0))+exp(-pow((r-gaps.y)/0.007,2.0))+exp(-pow((r-gaps.z)/0.007,2.0)));",
    "  float band=0.5+0.5*smoothstep(inner,outer,r);",
    "  gl_FragColor=vec4(col*w*fade*g*band*k,1.0);",
    "}"
  ].join("\n");

  var PULSE_FS = [
    "uniform float uTime;uniform vec3 uColor;uniform float uBoost;uniform float uSpeed;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 p=vUv*2.0-1.0;float r=length(p);",
    "  if(r>1.0)discard;",
    "  float core=exp(-r*r*20.0);",
    "  float halo=exp(-r*r*4.5)*0.3;",
    "  float p1=fract(uTime*uSpeed),p2=fract(uTime*uSpeed+0.5);",
    "  float d1=(r-p1)/0.035,d2=(r-p2)/0.035;",
    "  float rings=exp(-d1*d1)*(1.0-p1)+exp(-d2*d2)*(1.0-p2);",
    "  float edge=1.0-smoothstep(0.85,1.0,r);",
    "  gl_FragColor=vec4(uColor*(core*1.5+halo+rings*0.85*edge)*uBoost,1.0);",
    "}"
  ].join("\n");

  var VWIRE_VS = [
    NOISE,
    "uniform float uTime;uniform float uGlitch;uniform float uOffX;uniform float uRot;uniform float uR;",
    "void main(){",
    "  vec3 p=position;",
    "  float cs=cos(uRot),sn=sin(uRot);",
    "  p.xy=vec2(p.x*cs-p.y*sn,p.x*sn+p.y*cs);",
    "  float st=floor(uTime*9.0);",
    "  float band=floor((p.y/uR+1.0)*9.0);",
    "  float hh=h1(band*1.7+st);",
    "  float on=step(1.0-0.2*uGlitch,hh);",
    "  p.x+=on*(h1(band+st*3.1)-0.5)*0.7*uR*uGlitch;",
    "  p.x+=uOffX;",
    "  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);",
    "}"
  ].join("\n");
  var VWIRE_FS = "uniform vec3 uColor;void main(){gl_FragColor=vec4(uColor,1.0);}";

  var VFX_FS = [
    NOISE,
    "uniform float uTime;uniform float uGlitch;uniform float uReveal;uniform vec3 uCyan;uniform vec3 uMag;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 p=vUv*2.0-1.0;float r=length(p);",
    "  float ang=atan(p.y,p.x);",
    "  vec3 col=vec3(0.0);",
    "  float rimR=0.87;",
    "  float dr=(r-rimR)/0.014;",
    "  float rim=exp(-dr*dr);",
    "  float mv=0.5+0.5*sin(ang+uTime*0.35);",
    "  vec3 rc=mix(uMag,uCyan,mv);",
    "  float dh=(r-rimR)/0.08;",
    "  col+=rc*(rim*(0.85+0.6*uReveal)+exp(-dh*dh)*0.1);",
    "  float st=floor(uTime*9.0);",
    "  float band=floor((p.y*0.5+0.5)*28.0);",
    "  float hh=h1(band*1.3+st);",
    "  float on=step(1.0-0.13*uGlitch,hh);",
    "  float cx=(h1(band*2.7+st)-0.5)*0.9;",
    "  float wd=0.1+0.35*h1(band*5.1+st);",
    "  float bar=on*step(abs(p.x-cx),wd)*step(r,rimR+0.02)*step(0.18,r);",
    "  col+=mix(uCyan,uMag,step(0.5,h1(band+3.0+st)))*bar*0.5;",
    "  float scan=0.5+0.5*sin(p.y*70.0+uTime*1.5);",
    "  col+=uCyan*0.03*scan*step(r,rimR);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  var SHOT_FS = [
    NOISE,
    "uniform sampler2D map;uniform float uTime;uniform float uOpacity;uniform float uGlitch;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 uv=vUv;",
    "  float st=floor(uTime*6.0);",
    "  float band=floor(uv.y*26.0);",
    "  float tear=step(0.975,h1(band+st))*uGlitch;",
    "  uv.x+=tear*(h1(band*3.0+st)-0.5)*0.05;",
    "  float ab=0.0045+0.002*sin(uTime*1.1)+tear*0.01;",
    "  vec3 c;",
    "  c.r=texture2D(map,uv+vec2(ab,0.0)).r;",
    "  c.g=texture2D(map,uv).g;",
    "  c.b=texture2D(map,uv-vec2(ab,0.0)).b;",
    "  c=pow(c,vec3(2.2));",
    "  float sl=0.8+0.2*sin(uv.y*230.0);",
    "  float d=(fract(uTime*0.09)-uv.y)/0.05;",
    "  float sweep=exp(-d*d);",
    "  c=c*sl*0.85+vec3(0.1,0.55,0.7)*sweep*0.45;",
    "  c*=vec3(0.85,1.0,1.12);",
    "  float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));",
    "  gl_FragColor=vec4(c,uOpacity*smoothstep(0.0,0.05,edge));",
    "}"
  ].join("\n");

  var EQ_VS = [
    "varying vec2 vL;",
    "void main(){",
    "  vec4 lp=vec4(position,1.0);",
    "  #ifdef USE_INSTANCING",
    "    lp=instanceMatrix*lp;",
    "  #endif",
    "  vL=lp.xy;",
    "  gl_Position=projectionMatrix*modelViewMatrix*lp;",
    "}"
  ].join("\n");
  var EQ_FS = [
    "uniform float uPitch;uniform vec2 uOrigin;uniform vec3 uColor;uniform vec3 uHot;uniform float uBoost;",
    "varying vec2 vL;",
    "void main(){",
    "  vec2 g=(vL-uOrigin)/uPitch;",
    "  vec2 f=fract(g)-0.5;",
    "  float a=smoothstep(0.47,0.3,length(f));",
    "  float k=clamp(floor(g.y)/16.0,0.0,1.0);",
    "  vec3 c=mix(uColor,uHot,k*k);",
    "  gl_FragColor=vec4(c*a*uBoost,1.0);",
    "}"
  ].join("\n");

  function pointMat(kit) {
    return new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 700 }, uTime: { value: 0 }, uBoost: { value: 1 } },
      vertexShader: PT_VS, fragmentShader: PT_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
  }
  function pointsOf(n, kit, mat) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(n), 1));
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /* ---------------- textures ---------------- */
  function ringText(g, text, cx, cy, rad, size, color, font) {
    g.save();
    g.translate(cx, cy);
    g.font = "500 " + size + "px " + font;
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    var n = text.length, stp = Math.PI * 2 / n;
    for (var i = 0; i < n; i++) {
      g.save();
      g.rotate(i * stp);
      g.translate(0, -rad);
      g.fillText(text.charAt(i), 0, 0);
      g.restore();
    }
    g.restore();
  }

  function drawRecord(g, S2, rank, total, name, kit, T, F) {
    var c = S2 / 2, R = c - 2, LR = R * 0.42, i;
    var rnd = kit.rand(500 + rank * 37);
    var first = rank === 1;
    g.clearRect(0, 0, S2, S2);
    var bg = g.createRadialGradient(c, c, LR, c, c, R);
    bg.addColorStop(0, "#0c0d1a"); bg.addColorStop(1, "#05060d");
    g.fillStyle = bg;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    // grooves
    var step = S2 >= 1024 ? 1.25 : 0.9;
    for (var r = LR * 1.14; r < R * 0.975; r += step) {
      var fr = r / R, inGap = false;
      for (i = 0; i < GAPS.length; i++) if (Math.abs(fr - GAPS[i]) < 0.006) inGap = true;
      if (inGap) continue;
      g.strokeStyle = "rgba(150,150,190," + (0.03 + rnd() * 0.08).toFixed(3) + ")";
      g.lineWidth = 0.8;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // track gaps catch the light
    for (i = 0; i < GAPS.length; i++) {
      g.strokeStyle = "rgba(190,180,255,0.22)"; g.lineWidth = Math.max(1, S2 / 700);
      g.beginPath(); g.arc(c, c, GAPS[i] * R, 0, Math.PI * 2); g.stroke();
    }
    // faint radial mottling
    for (i = 0; i < 7; i++) {
      var ang = rnd() * Math.PI * 2;
      var gr = g.createLinearGradient(c, c, c + Math.cos(ang) * R, c + Math.sin(ang) * R);
      gr.addColorStop(0, "rgba(120,110,190,0)"); gr.addColorStop(1, "rgba(120,110,190,0.055)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(c, c); g.arc(c, c, R * 0.97, ang - 0.1, ang + 0.1); g.closePath(); g.fill();
    }
    // rim bevel + dead wax
    g.strokeStyle = "rgba(190,190,235,0.24)"; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, R - 1, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, R - 4, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "rgba(150,150,200,0.16)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(c, c, LR * 1.08, 0, Math.PI * 2); g.stroke();
    // label
    var lg = g.createRadialGradient(c - LR * 0.3, c - LR * 0.35, LR * 0.1, c, c, LR);
    if (first) { lg.addColorStop(0, "#ffc968"); lg.addColorStop(1, "#d9791a"); }
    else { lg.addColorStop(0, "#2d3290"); lg.addColorStop(1, "#151a55"); }
    g.fillStyle = lg;
    g.beginPath(); g.arc(c, c, LR, 0, Math.PI * 2); g.fill();
    var ink = first ? "#141833" : "#eef0ff", soft = first ? "rgba(20,24,51,0.7)" : T.violet;
    g.strokeStyle = soft; g.lineWidth = Math.max(1, S2 / 600);
    g.beginPath(); g.arc(c, c, LR * 0.93, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(c, c, LR * 0.72, 0, Math.PI * 2); g.stroke();
    ringText(g, "HUMAN HOURS · THE ALGORITHM ROOM · FAVORITE ARTIST · ", c, c, LR * 0.825, Math.round(LR * 0.1), soft, F.mono);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = first ? "#141833" : T.violet;
    g.font = "700 " + Math.round(LR * 0.46) + "px " + F.display;
    g.fillText(pad2(rank), c, c - LR * 0.3);
    g.fillStyle = ink;
    var fsz = LR * 0.24;
    for (; fsz > LR * 0.1; fsz -= 1) { g.font = "700 " + Math.round(fsz) + "px " + F.display; if (g.measureText(name).width < LR * 1.12) break; }
    g.fillText(name, c, c + LR * 0.2);
    g.fillStyle = soft;
    g.font = "500 " + Math.round(LR * 0.085) + "px " + F.mono;
    g.fillText("0" + rank + " / 0" + total, c, c + LR * 0.45);
    // spindle
    g.fillStyle = "#04050c";
    g.beginPath(); g.arc(c, c, S2 * 0.011, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(200,200,230,0.6)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(c, c, S2 * 0.011, 0, Math.PI * 2); g.stroke();
  }

  /* ---------------- build ---------------- */
  function build(ctx) {
    var kit = ctx.kit || HH.kit, T = ctx.theme || HH.THEME, F = ctx.fonts || HH.FONTS;
    var ex = ctx.exhibit || (HH.EXHIBITS && HH.EXHIBITS[4]) || {};
    var f = ex.facts || {};
    var low = ctx.quality === "low";
    var reduced = !!ctx.reducedMotion;
    var monoKR = '"IBM Plex Mono", "Noto Sans KR", ui-monospace, Menlo, monospace';
    var favs = (f.favorites || []).map(str).filter(Boolean).slice(0, 5);
    var recents = (f.recents || []).filter(function (r) { return r && str(r.song); }).slice(0, 4);
    var np = f.nowPlaying && str(f.nowPlaying.song) ? f.nowPlaying : null;
    var libs = (f.library || []).map(str).filter(Boolean);
    var mixes = (f.mixes || []).map(str).filter(Boolean);
    var vel = f.velvet || {};
    var chTag = "CH " + pad2(ex.n || 5);
    var root = new THREE.Group(); root.name = "room5-spotify";
    ctx.anchor.add(root);
    var i, k;

    var cCyan = kit.color(T.cyan, 1), cMag = kit.color(T.magenta, 1), cViolet = kit.color(T.violet, 1), cAmber = kit.color(T.amber, 1);

    S = {
      ctx: ctx, kit: kit, T: T, root: root, low: low, reduced: reduced,
      active: false, glow: 0, clock: 0, pxScale: 700, mtx: new THREE.Matrix4(),
      discs: [], omega: [], boost: [], sheenMats: [], sheenBase: [],
      velP: 0, velOn: false, velFlash: 0, favs: favs
    };
    S.updateEQ = updateEQ; S.updatePackets = updatePackets; S.updateHaze = updateHaze;
    S.revealVelvet = function () { S.velOn = true; S.velFlash = 1; };

    /* ===== wall deco: faint grid + rack ruler ===== */
    (function () {
      var dp = [], dc = [];
      var seg = function (x0, y0, x1, y1, r, g, b) { dp.push(x0, y0, 0, x1, y1, 0); dc.push(r, g, b, r, g, b); };
      var gc = kit.color(T.ink, 0.7), xi, yj;
      var fall = function (x, y) { return 0.1 + 0.55 * Math.exp(-((x * x) / 9 + ((y - 2.4) * (y - 2.4)) / 5)); };
      for (xi = 0; xi <= 24; xi++) for (yj = 0; yj < 12; yj++) {
        var gx = -4.8 + xi * 0.4, gy = yj * 0.4, fv;
        fv = fall(gx, gy + 0.2);
        seg(gx, gy, gx, gy + 0.4, gc.r * fv, gc.g * fv, gc.b * fv);
        if (xi < 24) { fv = fall(gx + 0.2, gy); seg(gx, gy, gx + 0.4, gy, gc.r * fv, gc.g * fv, gc.b * fv); }
      }
      var tc = kit.color(T.violet, 0.5);
      for (var ty = 0.42, ti = 0; ty < 4.29; ty += 0.036, ti++) {
        var tl = ti % 5 === 0 ? 0.05 : 0.025;
        seg(RACK.px - RACK.pw / 2 - 0.05 - tl, ty, RACK.px - RACK.pw / 2 - 0.05, ty, tc.r, tc.g, tc.b);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(dp, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(dc, 3));
      var lm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      lm.toneMapped = false;
      var deco = new THREE.LineSegments(geo, lm);
      deco.position.z = 0.005;
      root.add(deco);
    })();

    /* ===== light pool behind the rack ===== */
    var poolTex = kit.canvasTexture(256, 256, function (g) {
      var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    });
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.8), addMat(poolTex, kit.color("#9d86ff", 0.045)));
    pool.position.set(RACK.px, 2.4, 0.012);
    pool.renderOrder = -2;
    root.add(pool);

    /* ===== rack: plate + neon rails ===== */
    var nRec = favs.length;
    var plateTop = 4.3, plateBot = 0.4, plateH = plateTop - plateBot, plateCY = (plateTop + plateBot) / 2;
    if (nRec) {
      var plate = new THREE.Mesh(new THREE.BoxGeometry(RACK.pw, plateH, 0.04), kit.darkMat("#05081e", { roughness: 0.9, metalness: 0.1 }));
      plate.position.set(RACK.px, plateCY, 0.03);
      root.add(plate);
      var rl = [];
      rl.push({ g: boxAt(0.012, plateH, 0.014, RACK.px - RACK.pw / 2, plateCY, 0.058), c: kit.color(T.magenta, 1.5) });
      rl.push({ g: boxAt(0.012, plateH, 0.014, RACK.px + RACK.pw / 2, plateCY, 0.058), c: kit.color(T.cyan, 1.5) });
      rl.push({ g: boxAt(RACK.pw, 0.012, 0.014, RACK.px, plateTop, 0.058), c: kit.color(T.violet, 1.2) });
      rl.push({ g: boxAt(RACK.pw, 0.012, 0.014, RACK.px, plateBot, 0.058), c: kit.color(T.violet, 1.2) });
      for (i = 0; i < nRec; i++) {
        var yy = RACK.y0 - i * RACK.step;
        rl.push({ g: boxAt(0.56, 0.006, 0.01, RACK.x, yy - RACK.r - 0.04, 0.062), c: kit.color(T.violet, 0.9) });
        if (i < nRec - 1) rl.push({ g: boxAt(RACK.pw - 0.2, 0.004, 0.01, RACK.px, yy - RACK.step / 2, 0.06), c: kit.color(T.violet, 0.45) });
      }
      addBrackets(rl, RACK.px, plateCY, RACK.pw + 0.12, plateH + 0.12, 0.16, 0.012, 0.062, cCyan.clone().multiplyScalar(1.6), cMag.clone().multiplyScalar(1.6));
      root.add(colorMesh(mergeColored(rl)));

      // soft shadows behind each record (one merged mesh)
      var shTex = kit.canvasTexture(128, 128, function (g) {
        var gr = g.createRadialGradient(64, 64, 20, 64, 64, 62);
        gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.6, "rgba(0,0,0,0.7)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      });
      var shParts = [];
      for (i = 0; i < nRec; i++) {
        var sp = new THREE.PlaneGeometry(RACK.r * 2.7, RACK.r * 2.7);
        sp.translate(RACK.x + 0.03, RACK.y0 - i * RACK.step - 0.04, 0.074);
        shParts.push(sp);
      }
      var shMat = new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
      root.add(new THREE.Mesh(mergeGeos(shParts), shMat));

      /* ===== records ===== */
      var texSize = low ? 512 : 1024;
      var discGeo = new THREE.CircleGeometry(RACK.r, low ? 56 : 96);
      var rimList = [];
      for (i = 0; i < nRec; i++) {
        (function (idx) {
          var rank = idx + 1, name = favs[idx], cy = RACK.y0 - idx * RACK.step;
          var tex = kit.canvasTexture(texSize, texSize, function (g, w) { drawRecord(g, w, rank, nRec, name, kit, T, F); });
          var disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ map: tex, color: kit.color("#d4d4dc") }));
          disc.position.set(RACK.x, cy, RACK.z);
          root.add(disc);
          S.discs.push(disc); S.omega.push(0); S.boost.push(0);
          var sm = new THREE.ShaderMaterial({
            uniforms: {
              inner: { value: 0.46 }, outer: { value: 0.975 }, k: { value: 0.5 }, rot: { value: 1.0 + idx * 0.37 },
              col: { value: kit.color("#d9d2ff") }, gaps: { value: new THREE.Vector3(GAPS[0], GAPS[1], GAPS[2]) }
            },
            vertexShader: UV_VS, fragmentShader: SHEEN_FS,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
          });
          var sheen = new THREE.Mesh(discGeo, sm);
          sheen.position.set(RACK.x, cy, RACK.z + 0.003);
          root.add(sheen);
          S.sheenMats.push(sm); S.sheenBase.push(1.0 + idx * 0.37);
          // neon rim, magenta to cyan across the disc
          var rg = new THREE.RingGeometry(RACK.r * 0.972, RACK.r * 1.004, low ? 56 : 96, 1);
          rg.translate(RACK.x, cy, RACK.z + 0.006);
          var cx0 = RACK.x, rr = RACK.r;
          var tmpC = new THREE.Color();
          rimList.push({ g: rg, cf: function (x) {
            var u = kit.clamp((x - cx0) / rr * 0.5 + 0.5, 0, 1);
            return tmpC.copy(cMag).lerp(cCyan, u).multiplyScalar(1.25);
          } });
          var hitUrl = searchUrl(name);
          var open = function () { S.boost[idx] = 1.6; if (ctx.openLink) ctx.openLink(hitUrl); };
          if (ctx.addClickable) ctx.addClickable(disc, open, "OPEN IN SPOTIFY");
          // name area is clickable too
          var hit = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
          hit.position.set(RACK.x + 0.95, cy, 0.12);
          root.add(hit);
          if (ctx.addClickable) ctx.addClickable(hit, open, "OPEN IN SPOTIFY");
        })(i);
      }
      root.add(colorMesh(mergeColored(rimList)));
    }

    /* ===== rack labels: title, ranks, names ===== */
    (function () {
      var LX0 = -1.4, LX1 = 1.4, LY0 = 0.4, LY1 = 4.7, ppm = low ? 200 : 270;
      var W = Math.round((LX1 - LX0) * ppm), H = Math.round((LY1 - LY0) * ppm);
      var X = function (m) { return (m - LX0) * ppm; }, Y = function (m) { return (LY1 - m) * ppm; };
      var lab = canvasPlane(kit, W, H, LY1 - LY0, function (g) {
        neon(g, "MY CHART", X(RACK.px - RACK.pw / 2), Y(4.51), { font: "700 " + Math.round(0.17 * ppm) + "px " + F.display, color: T.violet, blur: 14, core: 0.5, ls: 4 });
        neon(g, "FAVORITE ARTISTS", X(RACK.px - RACK.pw / 2), Y(4.4), { font: "500 " + Math.round(0.045 * ppm) + "px " + F.mono, color: T.dim, blur: 4, core: 0.15, ls: 5 });
        neon(g, chTag, X(-0.12), Y(4.4), { font: "500 " + Math.round(0.045 * ppm) + "px " + F.mono, color: T.violet, blur: 6, core: 0.2, ls: 4 });
        for (var q = 0; q < nRec; q++) {
          var cy = RACK.y0 - q * RACK.step, first = q === 0;
          neon(g, pad2(q + 1), X(RACK.px - 0.8), Y(cy), { font: "700 " + Math.round(0.36 * ppm) + "px " + F.display, color: first ? T.amber : T.violet, blur: 22, core: 0.55, align: "center", ls: 2 });
          neon(g, favs[q], X(RACK.x + 0.46), Y(cy + 0.06), { font: "700 " + Math.round(0.125 * ppm) + "px " + F.display, color: "#e6dbff", blur: 8, core: 0.35 });
          neon(g, "RANK " + pad2(q + 1) + " / " + pad2(nRec), X(RACK.x + 0.46), Y(cy - 0.11), { font: "500 " + Math.round(0.042 * ppm) + "px " + F.mono, color: first ? T.amber : T.dim, blur: 3, core: 0.1, ls: 4 });
        }
      });
      lab.position.set((LX0 + LX1) / 2, (LY0 + LY1) / 2, 0.075);
      root.add(lab);
    })();

    // clickable link sign for the rack
    if (nRec) {
      var sign = kit.neonText("▶ OPEN IN SPOTIFY", { font: F.display, weight: "700", height: 0.1, color: T.magenta, glow: 18, core: 0.5, letterSpacing: 6 });
      sign.position.set(RACK.px, 0.22, 0.07);
      root.add(sign);
    }

    /* ===== playlist link sign (hidden until facts.playlist is non-empty) ===== */
    (function () {
      var grp = new THREE.Group();
      grp.position.set(BOARD.x - BOARD.w / 2, 0.3, 0.07); grp.visible = false;
      root.add(grp);
      var ps = kit.neonText("▶ PLAYLIST", { font: F.display, weight: "700", height: 0.1, color: T.magenta, glow: 18, core: 0.5, letterSpacing: 6, align: "left" });
      grp.add(ps);
      var hit = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(0.27, 0, 0.03);
      grp.add(hit);
      var P = S.pl = { grp: grp, hit: hit, reg: false };
      var readUrl = function () { return str((((ctx.exhibit || ex) || {}).facts || {}).playlist); };
      S.syncPlaylist = function () {
        if (P.reg || !readUrl()) return;
        P.reg = true; grp.visible = true;
        if (ctx.addClickable) ctx.addClickable(hit, function () {
          var u = readUrl();
          if (u && ctx.openLink) ctx.openLink(u);
        }, "OPEN PLAYLIST");
      };
      S.syncPlaylist();
    })();

    /* ===== Spotify logo sign (backlit, right of the MY CHART heading) ===== */
    var logoLoad = (function () {
      var LG = { x: 0.63, y: 4.48, w: 0.72, z: 0.1 }, lh = LG.w * 120 / 368;
      var grp = new THREE.Group();
      grp.position.set(LG.x, LG.y, LG.z); grp.visible = false;
      root.add(grp);
      var glow = kit.glowSprite("#1ed760", 1, 0.12);
      glow.scale.set(LG.w * 1.9, lh * 2.6, 1);
      glow.position.z = -0.03;
      grp.add(glow);
      var lmat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, color: kit.color("#d0d0d8") });
      lmat.toneMapped = false;
      grp.add(new THREE.Mesh(new THREE.PlaneGeometry(LG.w, lh), lmat));
      S.logo = { grp: grp, mat: lmat, glow: glow, base: kit.color("#d0d0d8") };
      if (!ctx.loadTexture) return Promise.resolve();
      return Promise.resolve(ctx.loadTexture((ctx.assetBase || "") + "assets/spotify-logo.png")).then(function (tex) {
        lmat.map = tex; lmat.needsUpdate = true; grp.visible = true;
      }).catch(function () {});
    })();

    /* ===== LED dot-matrix chart board ===== */
    (function () {
      var DW = BOARD.dw, DH = BOARD.dh, cell = low ? 4 : 5;
      var sc = document.createElement("canvas"); sc.width = DW; sc.height = DH;
      var sg = sc.getContext("2d", { willReadFrequently: true });
      var body = F.body;
      sg.textBaseline = "middle";
      // header
      sg.font = "500 8px " + monoKR; sg.textAlign = "left"; sg.fillStyle = T.violet;
      sg.fillText("RECENT PLAYS", 8, 13);
      sg.textAlign = "right"; sg.fillStyle = T.dim; sg.fillText(chTag, DW - 8, 13);
      sg.globalAlpha = 0.7; sg.fillStyle = T.violet; sg.fillRect(5, 22, DW - 10, 1); sg.globalAlpha = 1;
      // rows
      recents.forEach(function (r, q) {
        var y = 38 + q * 24, song = str(r.song).toUpperCase(), artist = str(r.artist).toUpperCase();
        sg.textAlign = "left"; sg.font = "500 8px " + monoKR; sg.fillStyle = "#6f75b8";
        sg.fillText(pad2(q + 1), 8, y);
        var maxW = DW - 26 - 6, size = 12, w1 = 0, w2 = 0, sep = artist ? " — " : "";
        for (; size >= 8; size--) {
          sg.font = "600 " + size + "px " + body; w1 = sg.measureText(song).width;
          sg.font = "400 " + size + "px " + body; w2 = artist ? sg.measureText(sep + artist).width : 0;
          if (w1 + w2 <= maxW) break;
        }
        sg.font = "600 " + size + "px " + body; sg.fillStyle = "#eef0ff";
        sg.fillText(ellipsize(sg, song, maxW), 26, y);
        if (artist && w1 < maxW - 6) {
          sg.font = "400 " + size + "px " + body; sg.fillStyle = T.violet;
          sg.fillText(ellipsize(sg, sep + artist, maxW - w1), 26 + w1, y);
        }
      });
      sg.globalAlpha = 0.7; sg.fillStyle = T.violet; sg.fillRect(5, 125, DW - 10, 1); sg.globalAlpha = 1;
      // now playing
      if (np) {
        sg.fillStyle = T.amber; sg.fillRect(8, 134, 3, 3);
        sg.textAlign = "left"; sg.font = "500 8px " + monoKR; sg.fillText("NOW PLAYING", 15, 137);
        sg.textAlign = "right"; sg.fillStyle = T.dim; sg.fillText("STREAM", DW - 8, 137);
        sg.textAlign = "left";
        var sw = DW - 16;
        fitFont(sg, str(np.song), function (s) { return "700 " + s + "px " + body; }, sw, 15, 9);
        sg.fillStyle = "#ffffff"; sg.fillText(ellipsize(sg, str(np.song), sw), 8, 154);
        if (str(np.artist)) {
          fitFont(sg, str(np.artist), function (s) { return "500 " + s + "px " + body; }, sw, 11, 8);
          sg.fillStyle = T.violet; sg.fillText(ellipsize(sg, str(np.artist), sw), 8, 169);
        }
      }
      sg.fillStyle = T.amber; sg.globalAlpha = 0.6; sg.fillRect(5, 177, DW - 10, 1); sg.globalAlpha = 1;

      var tex = kit.canvasTexture(DW * cell, DH * cell, function (g, w, h) {
        var data = sg.getImageData(0, 0, DW, DH).data, x, y, idx;
        g.fillStyle = "#04061a"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#0e1440";
        g.beginPath();
        for (y = 0; y < DH; y++) for (x = 0; x < DW; x++) {
          var ux = (x + 0.5) * cell, uy = (y + 0.5) * cell;
          g.moveTo(ux + cell * 0.3, uy); g.arc(ux, uy, cell * 0.3, 0, 6.2832);
        }
        g.fill();
        for (y = 0; y < DH; y++) for (x = 0; x < DW; x++) {
          idx = (y * DW + x) * 4;
          var a = data[idx + 3];
          if (a < 30) continue;
          var lv = Math.min(1, a / 255 * 1.35), R = data[idx], G = data[idx + 1], B = data[idx + 2];
          var cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
          g.fillStyle = "rgba(" + R + "," + G + "," + B + "," + (0.22 * lv).toFixed(2) + ")";
          g.beginPath(); g.arc(cx, cy, cell * 0.62, 0, 6.2832); g.fill();
          g.fillStyle = "rgb(" + Math.round(R + (255 - R) * 0.25 * lv) + "," + Math.round(G + (255 - G) * 0.25 * lv) + "," + Math.round(B + (255 - B) * 0.25 * lv) + ")";
          g.globalAlpha = 0.35 + 0.65 * lv;
          g.beginPath(); g.arc(cx, cy, cell * 0.4, 0, 6.2832); g.fill();
          g.globalAlpha = 1;
        }
      });
      var bmat = new THREE.MeshBasicMaterial({ map: tex });
      bmat.toneMapped = false;
      var board = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), bmat);
      board.position.set(BOARD.x, BOARD.y, 0.06);
      root.add(board);
      var bezel = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w + 0.1, BOARD.h + 0.1, 0.04), kit.darkMat("#070a24", { roughness: 0.8, metalness: 0.2 }));
      bezel.position.set(BOARD.x, BOARD.y, 0.03);
      root.add(bezel);
      var bl = [];
      bl.push({ g: boxAt(BOARD.w + 0.1, 0.01, 0.012, BOARD.x, BOARD.y + BOARD.h / 2 + 0.05, 0.05), c: kit.color(T.cyan, 1.4) });
      bl.push({ g: boxAt(BOARD.w + 0.1, 0.01, 0.012, BOARD.x, BOARD.y - BOARD.h / 2 - 0.05, 0.05), c: kit.color(T.magenta, 1.4) });
      addBrackets(bl, BOARD.x, BOARD.y, BOARD.w + 0.2, BOARD.h + 0.2, 0.14, 0.01, 0.07, cCyan.clone().multiplyScalar(1.6), cMag.clone().multiplyScalar(1.6));
      root.add(colorMesh(mergeColored(bl)));

      // scan sweep
      var swTex = kit.canvasTexture(8, 64, function (g, w, h) {
        var gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      var scan = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, 0.14), addMat(swTex, kit.color(T.cyan, 0.1)));
      scan.position.set(BOARD.x, BOARD.y, 0.072);
      root.add(scan);
      S.scan = scan; scan.visible = !reduced;

      // equalizer (dot-matrix, instanced)
      var N = low ? 9 : 13, stride = 6 * EQ_PITCH;
      var left = BOARD.x - BOARD.w / 2, topY = BOARD.y + BOARD.h / 2;
      var x0 = left - 0.005 + 0.01 * Math.round((BOARD.x - N * stride / 2 - left) / 0.01);
      var baseY = topY - 0.005 - 0.01 * 211 - 0.01;
      var geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0.5, 0);
      var emat = new THREE.ShaderMaterial({
        uniforms: {
          uPitch: { value: EQ_PITCH }, uOrigin: { value: new THREE.Vector2(x0, baseY) },
          uColor: { value: kit.color(T.amber, 1.2) }, uHot: { value: kit.color("#ffe9c4", 1.4) }, uBoost: { value: 1 }
        },
        vertexShader: EQ_VS, fragmentShader: EQ_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      var eq = new THREE.InstancedMesh(geo, emat, N);
      eq.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      eq.frustumCulled = false;
      eq.renderOrder = 2;
      root.add(eq);
      S.eq = { mesh: eq, mat: emat, N: N, x0: x0, base: baseY, stride: stride, h: new Float32Array(N) };
      for (var e = 0; e < N; e++) S.eq.h[e] = 0.2;
      S.updateEQ(0, 0, false);
    })();

    /* ===== human vs machine readout ===== */
    (function () {
      var hu = ex.human || {}, ma = ex.machine || {};
      var rx = BOARD.x - BOARD.w / 2;
      var pair = function (label, value, color, y) {
        if (!value) return;
        var l = kit.neonText(str(label).toUpperCase(), { font: F.mono, weight: "500", height: 0.055, color: color, glow: 6, core: 0.2, align: "left", letterSpacing: 12 });
        l.position.set(rx, y + 0.115, 0.08); l.material.color.setScalar(0.8);
        root.add(l);
        var v = kit.neonText(str(value), { font: F.display, weight: "700", height: 0.125, color: color, glow: 16, core: 0.5, align: "left", letterSpacing: 3 });
        v.position.set(rx - 0.01, y - 0.02, 0.08); v.material.color.setScalar(1.1);
        root.add(v);
      };
      pair(hu.label || "Human time", hu.short, T.amber, 1.02);
      pair(ma.label || "Machine time", ma.short, T.cyan, 0.62);
    })();

    /* ===== the algorithm: curved wires, nodes, pulses, packets ===== */
    (function () {
      var G = new THREE.Group(); G.position.set(GRAPH.x, GRAPH.y, GRAPH.z); root.add(G);
      var R = GRAPH.ring;
      var HP = { x: 0, y: -0.95 };
      var OUTS = [{ x: -0.4, y: -1.3 }, { x: 0, y: -1.42 }, { x: 0.4, y: -1.3 }];
      var order = [], split = Math.max(0, libs.length - 1);
      libs.slice(0, split).forEach(function (nm) { order.push({ label: nm, mix: false }); });
      mixes.forEach(function (nm) { order.push({ label: nm, mix: true }); });
      libs.slice(split).forEach(function (nm) { order.push({ label: nm, mix: false }); });
      var n = order.length;
      var a0 = 290 * Math.PI / 180, a1 = 610 * Math.PI / 180;
      var SEG = low ? 8 : 14;

      // nodes
      var NN = 2 + OUTS.length + n;
      var nodes = pointsOf(NN, kit, null);
      var nodeMat = pointMat(kit); nodes.material = nodeMat;
      var np3 = nodes.geometry.attributes.position.array, nc = nodes.geometry.attributes.color.array;
      var ns = nodes.geometry.attributes.size.array, nph = nodes.geometry.attributes.phase.array;
      var setNode = function (idx, x, y, col, size, ph) {
        np3[idx * 3] = x; np3[idx * 3 + 1] = y; np3[idx * 3 + 2] = 0.01;
        nc[idx * 3] = col.r; nc[idx * 3 + 1] = col.g; nc[idx * 3 + 2] = col.b;
        ns[idx] = size; nph[idx] = ph;
      };
      var cLib = kit.color("#b9bdf0", 1.0), cMix = kit.color(T.violet, 1.5);
      setNode(0, 0, 0, kit.color(T.cyan, 2.2), 0.1, 0.1);
      setNode(1, HP.x, HP.y, kit.color(T.amber, 2.2), 0.085, 0.4);
      OUTS.forEach(function (o, q) { setNode(2 + q, o.x, o.y, kit.color(T.amber, 0.7), 0.035, 0.2 * q); });

      // wires
      var wp = [], wc = [];
      var wseg = function (x0, y0, x1, y1, c0, m0, m1) {
        wp.push(x0, y0, 0, x1, y1, 0);
        wc.push(c0.r * m0, c0.g * m0, c0.b * m0, c0.r * m1, c0.g * m1, c0.b * m1);
      };
      var curve = function (ax, ay, cx, cy, bx, by, c, lo, hi, segs) {
        var px = ax, py = ay;
        for (var s = 1; s <= segs; s++) {
          var t = s / segs, x = qb(ax, cx, bx, t), y = qb(ay, cy, by, t);
          var m0 = lo + (hi - lo) * Math.pow((s - 1) / segs, 1.5), m1 = lo + (hi - lo) * Math.pow(t, 1.5);
          wseg(px, py, x, y, c, m0, m1);
          px = x; py = y;
        }
      };
      var wireLib = kit.color("#8d93c8", 0.55), wireMix = kit.color(T.violet, 0.75);
      var ringPaths = [];
      order.forEach(function (nd, q) {
        var a = a0 + (a1 - a0) * (n > 1 ? q / (n - 1) : 0.5);
        nd.ca = Math.cos(a); nd.sa = Math.sin(a);
        nd.x = R * nd.ca; nd.y = R * nd.sa;
        var cx = nd.x * 0.5 - nd.y * 0.2, cy = nd.y * 0.5 + nd.x * 0.2;
        ringPaths.push({ ax: nd.x, ay: nd.y, cx: cx, cy: cy, bx: 0, by: 0 });
        curve(nd.x, nd.y, cx, cy, 0, 0, nd.mix ? wireMix : wireLib, 0.25, 1, SEG);
        setNode(5 + q, nd.x, nd.y, nd.mix ? cMix : cLib, nd.mix ? 0.052 : 0.04, hash(q * 13 + 3));
      });
      var pathAH = { ax: 0, ay: 0, cx: 0.12, cy: HP.y / 2, bx: HP.x, by: HP.y };
      curve(pathAH.ax, pathAH.ay, pathAH.cx, pathAH.cy, pathAH.bx, pathAH.by, kit.color(T.cyan, 1.0), 0.6, 1.3, 16);
      var outPaths = OUTS.map(function (o, q) {
        var p = { ax: HP.x, ay: HP.y, cx: (HP.x + o.x) / 2 + (q === 1 ? 0.05 : 0), cy: (HP.y + o.y) / 2 + 0.03, bx: o.x, by: o.y };
        curve(p.ax, p.ay, p.cx, p.cy, p.bx, p.by, kit.color(T.amber, 0.7), 0.9, 0.35, 8);
        return p;
      });
      // radar rings + ticks
      var rc = kit.color(T.ink, 1.6), rr2 = R * 1.2, q2;
      for (q2 = 0; q2 < 72; q2++) {
        var aa = q2 * Math.PI / 36, ab = (q2 + 1) * Math.PI / 36;
        if (q2 % 3 !== 2) wseg(rr2 * Math.cos(aa), rr2 * Math.sin(aa), rr2 * Math.cos(ab), rr2 * Math.sin(ab), rc, 1, 1);
        var tl = q2 % 6 === 0 ? 0.06 : 0.025;
        wseg(rr2 * Math.cos(aa), rr2 * Math.sin(aa), (rr2 + tl) * Math.cos(aa), (rr2 + tl) * Math.sin(aa), rc, 0.9, 0.9);
      }
      var r3 = R * 0.52;
      for (q2 = 0; q2 < 48; q2++) {
        if (q2 % 4 === 3) continue;
        var ac = q2 * Math.PI / 24, ad = (q2 + 1) * Math.PI / 24;
        wseg(r3 * Math.cos(ac), r3 * Math.sin(ac), r3 * Math.cos(ad), r3 * Math.sin(ad), rc, 0.7, 0.7);
      }
      var wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
      wgeo.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
      var lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      lineMat.toneMapped = false;
      G.add(new THREE.LineSegments(wgeo, lineMat));
      S.lineMat = lineMat;

      // pulses
      var mkPulse = function (size, col, speed, x, y) {
        var pm = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uColor: { value: col }, uBoost: { value: 1 }, uSpeed: { value: speed } },
          vertexShader: UV_VS, fragmentShader: PULSE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var pl = new THREE.Mesh(new THREE.PlaneGeometry(size, size), pm);
        pl.position.set(x, y, 0.004);
        G.add(pl);
        return pm;
      };
      S.pulseA = mkPulse(0.95, kit.color(T.cyan, 0.9), 0.32, 0, 0);
      S.pulseH = mkPulse(0.5, kit.color(T.amber, 0.8), 0.22, HP.x, HP.y);
      G.add(nodes);
      S.nodeMat = nodeMat; S.nodeSize = nodes.geometry.attributes.size; S.nodeSizeBase = ns[0];

      // packets with trails
      var cN = low ? 3 : 5, aN = low ? 2 : 4, vN = low ? 3 : 6;
      var TLc = low ? 3 : 5, TLa = 3, TLv = 2;
      var pk = [], total = 0, pr = kit.rand(55);
      var addPk = function (kind, path, spd, TL, size, col) {
        pk.push({ kind: kind, path: path, t: pr(), spd: spd * (0.85 + pr() * 0.3), TL: TL, size: size, col: col, off: total });
        total += 1 + TL;
      };
      for (i = 0; i < cN; i++) { addPk(0, pathAH, 0.36, TLc, 0.075, kit.color(T.cyan, 2.0)); pk[pk.length - 1].t = i / cN; }
      for (i = 0; i < aN; i++) { addPk(1, outPaths[i % 3], 0.2, TLa, 0.05, kit.color(T.amber, 1.0)); pk[pk.length - 1].t = (i / aN + 0.3) % 1; }
      var vStep = Math.max(1, Math.floor(n / Math.max(1, vN)));
      for (i = 0; i < vN && ringPaths.length; i++) addPk(2, ringPaths[(i * vStep + 1) % ringPaths.length], 0.24, TLv, 0.04, kit.color(T.violet, 0.9));
      var packMat = pointMat(kit);
      var packs = pointsOf(Math.max(1, total), kit, packMat);
      G.add(packs);
      S.pk = { list: pk, pts: packs, mat: packMat, total: total, pos: packs.geometry.attributes.position, col: packs.geometry.attributes.color, size: packs.geometry.attributes.size };
      for (i = 0; i < total; i++) packs.geometry.attributes.phase.array[i] = hash(i * 7 + 1);
      S.updatePackets(0, 1);

      // labels
      var GX0 = -1.5, GX1 = 1.5, GY0 = -1.5, GY1 = 1.15, ppm = low ? 220 : 300;
      var LW = Math.round((GX1 - GX0) * ppm), LH = Math.round((GY1 - GY0) * ppm);
      var GXf = function (m) { return (m - GX0) * ppm; }, GYf = function (m) { return (GY1 - m) * ppm; };
      var lab = canvasPlane(kit, LW, LH, GY1 - GY0, function (g) {
        neon(g, "LIBRARY + " + mixes.length + " MIXES", GXf(-1.4), GYf(1.03), { font: "500 " + Math.round(0.052 * ppm) + "px " + F.mono, color: T.violet, blur: 5, core: 0.2, ls: 4 });
        neon(g, "ALGORITHM", GXf(0), GYf(-0.17), { font: "700 " + Math.round(0.07 * ppm) + "px " + F.display, color: T.cyan, blur: 10, core: 0.5, ls: 5, align: "center" });
        neon(g, "H", GXf(HP.x + 0.12), GYf(HP.y + 0.03), { font: "700 " + Math.round(0.13 * ppm) + "px " + F.display, color: T.amber, blur: 12, core: 0.5, align: "left" });
        neon(g, "LISTENER", GXf(HP.x + 0.12), GYf(HP.y - 0.1), { font: "500 " + Math.round(0.043 * ppm) + "px " + F.mono, color: T.amber, blur: 4, core: 0.1, ls: 4, align: "left" });
        order.forEach(function (nd) {
          var ca = nd.ca, sa = nd.sa;
          var al = ca > 0.3 ? "left" : ca < -0.3 ? "right" : "center";
          var lx = nd.x + ca * 0.07, ly = nd.y + sa * (al === "center" ? 0.09 : 0.05);
          neon(g, nd.label.toUpperCase(), GXf(lx), GYf(ly), {
            font: "600 " + Math.round(0.055 * ppm) + "px " + F.display, color: nd.mix ? T.violet : "#b9bdf0",
            blur: 3, core: 0.12, ls: 1, align: al
          });
        });
      });
      lab.position.set((GX0 + GX1) / 2, (GY0 + GY1) / 2, 0.006);
      G.add(lab);
      var gl = [];
      addBrackets(gl, 0, -0.18, 2.4, 2.4, 0.14, 0.008, 0.002, cCyan.clone().multiplyScalar(1.4), cMag.clone().multiplyScalar(1.4));
      G.add(colorMesh(mergeColored(gl)));
    })();

    /* ===== The Velvet Sundown: glitch wireframe record ===== */
    (function () {
      var V = new THREE.Group(); V.position.set(VEL.x, VEL.y, 0.1); root.add(V);
      var R = VEL.r, rnd = kit.rand(1107);
      var circ = low ? 48 : 96;
      var wp = [];
      var addSeg = function (x0, y0, x1, y1) { wp.push(x0, y0, 0, x1, y1, 0); };
      var arc = function (rad, aS, aE) {
        var steps = Math.max(2, Math.ceil((aE - aS) / (Math.PI * 2) * circ));
        for (var s = 0; s < steps; s++) {
          var u0 = aS + (aE - aS) * s / steps, u1 = aS + (aE - aS) * (s + 1) / steps;
          addSeg(rad * Math.cos(u0), rad * Math.sin(u0), rad * Math.cos(u1), rad * Math.sin(u1));
        }
      };
      arc(R, 0, Math.PI * 2);
      var rings = [0.9, 0.82, 0.74, 0.67, 0.6, 0.53, 0.46, 0.4];
      rings.forEach(function (fr) {
        var a = rnd() * 6.28, end = a + Math.PI * 2;
        while (a < end - 0.1) {
          var len = 0.5 + rnd() * 1.7, gap = rnd() < 0.5 ? 0 : 0.08 + rnd() * 0.3;
          arc(R * fr, a, Math.min(end, a + len));
          a += len + gap;
        }
      });
      arc(R * 0.32, 0, Math.PI * 2); arc(R * 0.27, 0, Math.PI * 2); arc(R * 0.045, 0, Math.PI * 2);
      for (i = 0; i < 8; i++) {
        var sa = i * Math.PI / 4 + (rnd() - 0.5) * 0.12;
        addSeg(R * 0.32 * Math.cos(sa), R * 0.32 * Math.sin(sa), R * 0.58 * Math.cos(sa), R * 0.58 * Math.sin(sa));
        addSeg(R * 0.66 * Math.cos(sa), R * 0.66 * Math.sin(sa), R * Math.cos(sa), R * Math.sin(sa));
      }
      // facets: diagonals between two rings
      for (i = 0; i < 28; i++) {
        var fa = i * Math.PI * 2 / 28;
        addSeg(R * 0.9 * Math.cos(fa), R * 0.9 * Math.sin(fa), R * 0.46 * Math.cos(fa + 0.3), R * 0.46 * Math.sin(fa + 0.3));
      }
      // stray glitch segments
      for (i = 0; i < 26; i++) {
        var gx = (rnd() - 0.5) * 1.5 * R, gy = (rnd() - 0.5) * 1.7 * R, gl = (0.1 + rnd() * 0.35) * R;
        addSeg(gx, gy, gx + gl, gy);
      }
      var wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
      var mkWire = function (col, mulr) {
        var m = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uGlitch: { value: 0 }, uOffX: { value: 0 }, uRot: { value: 0 }, uR: { value: R }, uColor: { value: col } },
          vertexShader: VWIRE_VS, fragmentShader: VWIRE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var ls = new THREE.LineSegments(wgeo, m);
        ls.position.z = mulr;
        V.add(ls);
        return m;
      };
      S.vwMain = mkWire(kit.color("#d9ccff", 0.95), 0.003);
      S.vwCyan = mkWire(kit.color(T.cyan, 0.8), 0.001);
      S.vwMag = mkWire(kit.color(T.magenta, 0.8), 0.002);
      S.vw = [S.vwMain, S.vwCyan, S.vwMag];

      S.vfx = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uGlitch: { value: 0 }, uReveal: { value: 0 }, uCyan: { value: kit.color(T.cyan, 1.3) }, uMag: { value: kit.color(T.magenta, 1.3) } },
        vertexShader: UV_VS, fragmentShader: VFX_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      var fx = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.3, R * 2.3), S.vfx);
      fx.position.z = -0.002;
      V.add(fx);

      // text
      var title = kit.neonText("THE VELVET SUNDOWN", { font: F.mono, weight: "500", height: 0.07, color: "#d9ccff", glow: 10, core: 0.35, letterSpacing: 10 });
      title.position.set(0, -R - 0.15, 0.01); V.add(title);
      var listeners = str(vel.listeners).replace(/\s*million\b/i, "M").toUpperCase();
      var subTxt = (listeners + (listeners && vel.when ? " · " : "") + str(vel.when).toUpperCase()).trim();
      if (subTxt) {
        var sub = kit.neonText(subTxt, { font: F.mono, weight: "500", height: 0.05, color: T.cyan, glow: 6, core: 0.2, letterSpacing: 6 });
        sub.material.color.setScalar(0.85);
        sub.position.set(0, -R - 0.26, 0.01); V.add(sub);
      }
      var vs = kit.neonText("▶ REVEAL", { font: F.display, weight: "700", height: 0.1, color: T.magenta, glow: 18, core: 0.5, letterSpacing: 6 });
      vs.position.set(0, -R - 0.4, 0.01); V.add(vs);

      // brackets
      var bl = [];
      addBrackets(bl, 0, -0.2, R * 2 + 0.5, R * 2 + 0.98, 0.1, 0.008, 0.0, cMag.clone().multiplyScalar(1.4), cCyan.clone().multiplyScalar(1.4));
      V.add(colorMesh(mergeColored(bl)));

      // stamp
      var stamp = new THREE.Group(); stamp.visible = false; stamp.position.z = 0.03; stamp.rotation.z = 0.2;
      var st = kit.neonText("AI", { font: F.display, weight: "700", height: 0.44, color: T.cyan, glow: 28, core: 0.6, letterSpacing: 8 });
      stamp.add(st);
      var sfLs = [
        { g: boxAt(0.78, 0.014, 0.012, 0, 0.27, 0), c: kit.color(T.cyan, 1.8) },
        { g: boxAt(0.78, 0.014, 0.012, 0, -0.27, 0), c: kit.color(T.cyan, 1.8) },
        { g: boxAt(0.014, 0.54, 0.012, -0.39, 0, 0), c: kit.color(T.cyan, 1.8) },
        { g: boxAt(0.014, 0.54, 0.012, 0.39, 0, 0), c: kit.color(T.cyan, 1.8) }
      ];
      var sf = colorMesh(mergeColored(sfLs));
      sf.material.transparent = true;
      stamp.add(sf);
      V.add(stamp);
      S.stamp = stamp; S.stampText = st.material; S.stampFrame = sf.material;
      var quoteTxt = str(vel.quote);
      if (quoteTxt) {
        var qm = kit.neonText("“" + quoteTxt + "”", { font: F.mono, weight: "400", height: 0.055, color: T.cyan, glow: 6, core: 0.25, align: "center", letterSpacing: 4, maxWidthPx: Math.round(1.0 / 0.055 * 160) });
        qm.position.set(0, -R - 0.62, 0.02);
        qm.visible = false;
        V.add(qm);
        S.quote = qm;
      }
      // hit disc
      var hit = new THREE.Mesh(new THREE.CircleGeometry(R * 1.1, 20), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.z = 0.04; V.add(hit);
      var hit2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
      hit2.position.set(0, -R - 0.4, 0.04); V.add(hit2);
      var reveal = function () { S.revealVelvet(); };
      if (ctx.addClickable) { ctx.addClickable(hit, reveal, "THE VELVET SUNDOWN"); ctx.addClickable(hit2, reveal, "THE VELVET SUNDOWN"); }
    })();

    /* ===== haze in the spotlight ===== */
    (function () {
      var N = low ? 24 : 48, hz = kit.rand(909);
      var mat = pointMat(kit);
      var pts = pointsOf(N, kit, mat);
      var geo = pts.geometry;
      var H = { n: N, x0: new Float32Array(N), z0: new Float32Array(N), y0: new Float32Array(N), v: new Float32Array(N), ph: new Float32Array(N),
        base: new Float32Array(N * 3), ymin: 0.5, range: 4.1, pts: pts, mat: mat };
      var hc = kit.color(T.violet, 0.8), hc2 = kit.color("#c9d6ff", 0.6);
      for (i = 0; i < N; i++) {
        H.x0[i] = -3.6 + hz() * 7.0; H.z0[i] = 0.35 + hz() * 1.2; H.y0[i] = hz() * 4.1; H.v[i] = 0.03 + hz() * 0.05; H.ph[i] = hz();
        var cc = hz() < 0.5 ? hc : hc2;
        H.base[i * 3] = cc.r; H.base[i * 3 + 1] = cc.g; H.base[i * 3 + 2] = cc.b;
        geo.attributes.size.array[i] = 0.025 + hz() * 0.04;
        geo.attributes.phase.array[i] = hz();
      }
      root.add(pts);
      S.haze = H;
      S.updateHaze(0);
    })();

    /* ===== screenshot hologram ===== */
    var shotGroup = new THREE.Group();
    shotGroup.position.set(SHOT.x, SHOT.y, SHOT.z); shotGroup.rotation.y = 0.14; shotGroup.visible = false;
    root.add(shotGroup);
    var shotH = SHOT.w * 1293 / 2000;
    S.shotMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uTime: { value: 0 }, uOpacity: { value: 0.66 }, uGlitch: { value: reduced ? 0 : 1 } },
      vertexShader: UV_VS, fragmentShader: SHOT_FS, transparent: true, depthWrite: false
    });
    shotGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(SHOT.w, shotH), S.shotMat));
    (function () {
      var sl = [];
      sl.push({ g: boxAt(SHOT.w + 0.04, 0.006, 0.006, 0, shotH / 2 + 0.02, 0.002), c: kit.color(T.violet, 0.7) });
      sl.push({ g: boxAt(SHOT.w + 0.04, 0.006, 0.006, 0, -shotH / 2 - 0.02, 0.002), c: kit.color(T.violet, 0.7) });
      addBrackets(sl, 0, 0, SHOT.w + 0.1, shotH + 0.1, 0.12, 0.01, 0.004, cCyan.clone().multiplyScalar(1.6), cMag.clone().multiplyScalar(1.6));
      shotGroup.add(colorMesh(mergeColored(sl)));
      var ppm = 380, LW = Math.round((SHOT.w + 0.3) * ppm), LH = Math.round((shotH + 0.3) * ppm);
      var lab = canvasPlane(kit, LW, LH, shotH + 0.3, function (g) {
        var fnt = "500 " + Math.round(0.042 * ppm) + "px " + F.mono;
        neon(g, "SYS", 0.08 * ppm, 0.04 * ppm, { font: fnt, color: T.cyan, blur: 4, core: 0.15, ls: 4 });
        neon(g, "OCT. 2026", LW - 0.08 * ppm, 0.04 * ppm, { font: fnt, color: T.magenta, blur: 4, core: 0.15, ls: 4, align: "right" });
      });
      lab.position.z = 0.006;
      shotGroup.add(lab);
    })();
    S.shotGroup = shotGroup;
    var shotUrl = ex.media && ex.media.screenshot ? (ctx.assetBase || "") + ex.media.screenshot : "";
    var load = shotUrl && ctx.loadTexture ? ctx.loadTexture(shotUrl) : Promise.reject(new Error("no screenshot"));
    var shotLoad = Promise.resolve(load).then(function (tex) {
      S.shotMat.uniforms.map.value = tex;
      shotGroup.visible = true;
    }).catch(function () { shotGroup.visible = false; });
    return Promise.all([shotLoad, logoLoad]);
  }

  /* ---------------- per-frame pieces ---------------- */
  function updateEQ(dt, tt, on) {
    var E = S.eq; if (!E) return;
    var m = S.mtx, amp = on ? 1 : 0.5;
    for (var i = 0; i < E.N; i++) {
      var tgt;
      if (S.reduced) tgt = 0.2 + 0.5 * Math.abs(Math.sin(i * 1.37));
      else {
        var a = Math.abs(Math.sin(tt * (1.9 + 0.31 * i) + i * 1.7)), b = 0.55 + 0.45 * Math.sin(tt * 0.8 + i * 0.9);
        tgt = (0.12 + 0.88 * a * b) * amp;
      }
      E.h[i] = dt > 0 ? S.kit.damp(E.h[i], tgt, 14, dt) : tgt;
      var rows = Math.max(1, Math.round(E.h[i] * EQ_ROWS));
      m.makeScale(5 * EQ_PITCH, rows * EQ_PITCH, 1);
      m.setPosition(E.x0 + i * E.stride, E.base, 0.075);
      E.mesh.setMatrixAt(i, m);
    }
    E.mesh.instanceMatrix.needsUpdate = true;
  }

  function updatePackets(dt, mul) {
    var P = S.pk; if (!P) return;
    var list = P.list, pos = P.pos.array, col = P.col.array, siz = P.size.array;
    var TS = 0.04;
    for (var j = 0; j < list.length; j++) {
      var p = list[j], path = p.path;
      p.t += dt * p.spd * mul;
      if (p.t >= 1) p.t -= 1;
      for (var k = 0; k <= p.TL; k++) {
        var idx = p.off + k, tk = p.t - k * TS, ok = tk >= 0;
        var tc = ok ? tk : 0;
        var env = ok ? Math.sin(Math.PI * tc) : 0;
        var fade = Math.pow(1 - k / (p.TL + 1), 1.6) * env;
        pos[idx * 3] = qb(path.ax, path.cx, path.bx, tc);
        pos[idx * 3 + 1] = qb(path.ay, path.cy, path.by, tc);
        pos[idx * 3 + 2] = 0.012;
        col[idx * 3] = p.col.r * fade; col[idx * 3 + 1] = p.col.g * fade; col[idx * 3 + 2] = p.col.b * fade;
        siz[idx] = p.size * (1 - k * 0.1);
      }
    }
    P.pos.needsUpdate = true; P.col.needsUpdate = true; P.size.needsUpdate = true;
  }

  function updateHaze(tt) {
    var H = S.haze; if (!H) return;
    var pos = H.pts.geometry.attributes.position.array, col = H.pts.geometry.attributes.color.array;
    for (var i = 0; i < H.n; i++) {
      var y = H.y0[i] + tt * H.v[i];
      y = (y % H.range + H.range) % H.range;
      var e = Math.sin(Math.PI * y / H.range);
      pos[i * 3] = H.x0[i] + Math.sin(tt * 0.3 + H.ph[i] * 6.283) * 0.15;
      pos[i * 3 + 1] = H.ymin + y;
      pos[i * 3 + 2] = H.z0[i];
      col[i * 3] = H.base[i * 3] * e; col[i * 3 + 1] = H.base[i * 3 + 1] * e; col[i * 3 + 2] = H.base[i * 3 + 2] * e;
    }
    H.pts.geometry.attributes.position.needsUpdate = true;
    H.pts.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- room def ---------------- */
  HH.registerRoom(5, {
    build: function (ctx) {
      var res = build(ctx);
      return res;
    },

    enter: function (ctx) {
      if (!S) return;
      S.active = true;
      S.velFlash = Math.max(S.velFlash, 0.4);
    },

    leave: function (ctx) {
      if (!S) return;
      S.active = false;
    },

    update: function (ctx, dt, t, state) {
      if (!S) return;
      dt = Math.min(dt || 0, 0.1);
      if (state && state.visible === false) return;
      var kit = S.kit, i;
      var on = S.active && (!state || state.active !== false);
      S.clock += dt;
      var tt = S.reduced ? 0 : S.clock;
      S.glow = kit.damp(S.glow, on ? 1 : 0, 2.2, dt);
      var glow = S.glow;
      var cam = ctx.camera, el = ctx.renderer && ctx.renderer.domElement;
      if (cam && el && el.height) S.pxScale = el.height / (2 * Math.tan(cam.fov * 0.00872665));

      // records
      for (i = 0; i < S.discs.length; i++) {
        var tgt = S.reduced ? 0 : (on ? 0.9 : 0.3) * (0.85 + 0.06 * i);
        var bt = S.boost[i];
        if (bt > 0) { S.boost[i] = Math.max(0, bt - dt); tgt = S.reduced ? 0.9 : 3.2; }
        S.omega[i] = kit.damp(S.omega[i], tgt, bt > 0 ? 5 : 1.4, dt);
        S.discs[i].rotation.z -= S.omega[i] * dt;
        S.sheenMats[i].uniforms.rot.value = S.sheenBase[i] + (S.reduced ? 0 : Math.sin(tt * 0.35 + i) * 0.12);
        S.sheenMats[i].uniforms.k.value = 0.5 + Math.min(0.3, S.omega[i] * 0.08);
      }

      // board: sweep + equalizer
      if (S.scan && !S.reduced) S.scan.position.y = BOARD.y + BOARD.h / 2 - ((tt * 0.2) % 1) * BOARD.h;
      updateEQ(dt, tt, on);
      if (S.eq) S.eq.mat.uniforms.uBoost.value = 0.9 + 0.3 * glow;

      // algorithm graph
      var boost = 0.8 + 0.6 * glow;
      var gt = S.reduced ? 3.3 : tt;
      S.nodeMat.uniforms.uTime.value = gt; S.nodeMat.uniforms.uBoost.value = boost; S.nodeMat.uniforms.uScale.value = S.pxScale;
      if (S.pk) {
        S.pk.mat.uniforms.uTime.value = gt; S.pk.mat.uniforms.uBoost.value = boost; S.pk.mat.uniforms.uScale.value = S.pxScale;
        if (!S.reduced) updatePackets(dt, 1 + 1.4 * glow);
      }
      S.lineMat.color.setScalar(0.7 + 0.7 * glow);
      S.pulseA.uniforms.uTime.value = gt; S.pulseA.uniforms.uBoost.value = 0.75 + 0.6 * glow;
      S.pulseH.uniforms.uTime.value = gt; S.pulseH.uniforms.uBoost.value = 0.7 + 0.5 * glow;
      if (!S.reduced) {
        S.nodeSize.array[0] = S.nodeSizeBase * (1 + 0.1 * Math.sin(tt * 2.4) + 0.12 * glow);
        S.nodeSize.needsUpdate = true;
      }

      // haze
      if (S.haze) {
        S.haze.mat.uniforms.uTime.value = gt; S.haze.mat.uniforms.uBoost.value = 0.7 + 0.5 * glow; S.haze.mat.uniforms.uScale.value = S.pxScale;
        if (!S.reduced) updateHaze(tt);
      }

      // velvet record
      S.velFlash = Math.max(0, S.velFlash - dt * 1.6);
      var gl = 0;
      if (!S.reduced) {
        var cyc = tt % 3.1;
        gl = cyc < 0.3 ? 1 : cyc < 0.45 ? 0.55 : 0.18;
        gl = Math.max(gl, S.velFlash);
      }
      var burst = gl > 0.5 ? 0.012 + 0.03 * hash(Math.floor(tt * 14)) : 0.012;
      for (i = 0; i < 3; i++) {
        var u = S.vw[i].uniforms;
        u.uTime.value = gt; u.uGlitch.value = gl; u.uRot.value = S.reduced ? 0 : tt * 0.1;
        u.uOffX.value = i === 1 ? -burst : i === 2 ? burst : 0;
      }
      S.vfx.uniforms.uTime.value = gt; S.vfx.uniforms.uGlitch.value = gl;
      if (S.velOn) S.velP = S.reduced ? 1 : Math.min(1, S.velP + dt * 3);
      var p = S.velP, ease = kit.easeOutCubic(p);
      S.vfx.uniforms.uReveal.value = p;
      if (p > 0) {
        S.stamp.visible = true;
        var sc = 1 + 0.7 * (1 - ease);
        S.stamp.scale.set(sc, sc, 1);
        S.stampText.opacity = p; S.stampFrame.opacity = p;
        if (S.quote) S.quote.visible = p > 0.25;
      }

      // playlist sign appears once the link exists
      if (S.syncPlaylist) S.syncPlaylist();

      // Spotify logo sign: soft backlight, slight breathing while active
      if (S.logo && S.logo.grp.visible) {
        var lb = S.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(tt * 1.4);
        S.logo.glow.material.opacity = 0.11 + 0.04 * glow + 0.03 * glow * lb;
        S.logo.mat.color.copy(S.logo.base).multiplyScalar(1 + 0.05 * glow * (lb - 0.5));
      }

      // screenshot hologram
      if (S.shotGroup.visible) {
        S.shotMat.uniforms.uTime.value = gt;
        if (!S.reduced) S.shotGroup.position.y = SHOT.y + Math.sin(tt * 0.6) * 0.015;
      }
    },

    panel: function (el, ctx) {
      if (!el) return;
      var ex = (ctx && ctx.exhibit) || (HH.EXHIBITS && HH.EXHIBITS[4]) || {};
      var f = ex.facts || {}, T = HH.THEME, F = HH.FONTS, esc = HH.kit.esc;
      var ff = function (s) { return String(s).replace(/"/g, "'"); };
      var favs = (f.favorites || []).map(str).filter(Boolean);
      var rec = (f.recents || []).filter(function (r) { return r && str(r.song); });
      var np = f.nowPlaying && str(f.nowPlaying.song) ? f.nowPlaying : null;
      var vel = f.velvet || {};
      var LINK = "font:500 11px/1.2 " + ff(F.mono) + ";letter-spacing:.06em;color:" + T.cyan + ";text-decoration:none;border-bottom:1px solid currentColor;white-space:nowrap;padding:3px 0";
      var link = function (url, label) {
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="' + LINK + '">' + esc(label) + "</a>";
      };
      var ROW = "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0;padding:7px 0 7px 11px;border-left:2px solid rgba(184,139,255,.25)";
      var h = "";

      // 1) My chart
      if (favs.length || rec.length || np) {
        h += '<div class="hh-sec"><div class="hh-h">My chart</div>';
        if (favs.length) {
          h += '<ol class="hh-list" style="gap:2px">';
          favs.slice(0, 5).forEach(function (a, i) {
            h += '<li style="' + ROW + (i === 0 ? ";border-left-color:" + T.amber : "") + '">' +
              '<span style="display:flex;gap:10px;align-items:baseline;min-width:0"><span class="hh-mono" style="font-size:12px;color:' + (i === 0 ? T.amber : T.dim) + '">' + pad2(i + 1) + "</span>" +
              '<span style="font-size:15px;color:' + T.white + ';overflow-wrap:anywhere">' + esc(a) + "</span></span>" +
              link(searchUrl(a), "Open in Spotify") + "</li>";
          });
          h += "</ol>";
        }
        if (rec.length) {
          h += '<div class="hh-h" style="margin-top:6px">Recent plays</div><ul class="hh-list" style="gap:2px">';
          rec.slice(0, 4).forEach(function (r) {
            var song = str(r.song), artist = str(r.artist);
            h += '<li style="' + ROW + '"><span style="font-size:14px;color:' + T.white + ';min-width:0;overflow-wrap:anywhere">' + esc(song) +
              (artist ? ' <span style="color:' + T.dim + '">— ' + esc(artist) + "</span>" : "") + "</span>" +
              link(searchUrl(song + (artist ? " " + artist : "")), "Open in Spotify") + "</li>";
          });
          h += "</ul>";
        }
        if (np) {
          var nsong = str(np.song), nart = str(np.artist);
          h += '<div class="hh-h" style="margin-top:6px">Now playing</div>' +
            '<div style="' + ROW + ';border-left-color:' + T.amber + '"><span style="font-size:14px;color:' + T.white + ';min-width:0;overflow-wrap:anywhere">' + esc(nsong) +
            (nart ? ' <span class="hh-kr" style="color:' + T.dim + '">— ' + esc(nart) + "</span>" : "") + "</span>" +
            link(searchUrl(nsong + (nart ? " " + nart : "")), "Open in Spotify") + "</div>";
        }
        h += "</div>";
      }


      // 3) Human or AI?
      var opts = [];
      if (favs[0]) opts.push({ k: "h", name: favs[0] });
      opts.push({ k: "ai", name: "The Velvet Sundown" });
      if (favs[1]) opts.push({ k: "h", name: favs[1] });
      if (favs[2]) opts.push({ k: "h", name: favs[2] });
      var listeners = str(vel.listeners) || "1.07 million monthly listeners", when = str(vel.when) || "July 2025";
      var quote = str(vel.quote);
      var srcRow = (ex.sources || []).filter(function (s) { return s && /Digital Music News/.test(str(s[0])); })[0];
      h += '<div class="hh-sec"><div class="hh-h">Human or AI?</div>' +
        '<div class="hh-mono" style="font-size:12px;color:' + T.dim + '">Tap an artist.</div><div class="hh-row">';
      opts.forEach(function (o) {
        h += '<button type="button" class="hh-btn" data-hoa="' + o.k + '" style="font-family:inherit">' + esc(o.name) + "</button>";
      });
      h += '</div><div data-hoa-res hidden style="display:none;gap:6px;border-left:2px solid ' + T.cyan + ';padding:6px 0 6px 12px">' +
        '<div class="hh-mono" style="font-size:13px;color:' + T.white + '"><b style="color:' + T.cyan + '">AI.</b> ' + esc(listeners) + " in " + esc(when) + ".</div>" +
        (quote ? '<div style="font-size:14px;line-height:1.5;color:' + T.white + '">“' + esc(quote) + "”</div>" : "") +
        '<div class="hh-mono" style="font-size:11px;color:' + T.dim + '">Digital Music News, July 7, 2025' +
        (srcRow && srcRow[1] ? ' · <a href="' + esc(srcRow[1]) + '" target="_blank" rel="noopener" style="color:' + T.cyan + '">Source</a>' : "") + "</div></div></div>";

      el.innerHTML = h;

      var res = el.querySelector("[data-hoa-res]");
      var btns = el.querySelectorAll("[data-hoa]");
      var pick = function (e) {
        var b = e.currentTarget, k = b.getAttribute("data-hoa");
        if (b.getAttribute("data-done")) return;
        b.setAttribute("data-done", "1");
        if (k === "ai") {
          b.insertAdjacentHTML("beforeend", "<small>AI</small>");
          if (res) { res.hidden = false; res.style.display = "grid"; }
          if (S && S.revealVelvet) S.revealVelvet();
        } else {
          b.classList.add("amber");
          b.insertAdjacentHTML("beforeend", "<small>Human</small>");
        }
      };
      for (var q = 0; q < btns.length; q++) if (btns[q].tagName === "BUTTON") btns[q].addEventListener("click", pick);
    }
  });

})();
