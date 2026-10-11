/* Human Hours Museum v2 · Room 6 · "The Dojang"
   Henry's Taekwondo 4th Poom certificate (Kukkiwon, issued Jan. 28, 2026).
   Hero: the certificate on a thick glass slab with a holographic sweep. Beside it: a neon light-sculpture
   fighter on a mat (keyframed front kick + roundhouse, hip turn, pivoting support foot, amber trail),
   a black belt with four gold bars on a rack, and a 14-tick timeline 2013 to 2026.
   Immersive: "13 Years, One Kick", one slow-motion roundhouse scrubbed by scroll while the camera orbits.
   Classic script. Registers HH.registerRoom(6, ...). All copy is museum copy from config.js. */
(function () {
  "use strict";
  if (!window.HH || !HH.registerRoom) return;

  var PI = Math.PI;
  var AMBER = "#ffb23f", AMBER_DIM = "#e09a35", CYAN_DIM = "#35b9c9", LABEL_VIO = "#9aa0de";
  var HIP_Y = 0.97, FSCALE = 0.92, MAT_TOP = 0.04;

  /* ---------------- tiny helpers ---------------- */
  function str(v) { return v == null ? "" : String(v); }
  function num(v, d) { v = +v; return isFinite(v) && v === v ? v : d; }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  var MON = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  function fmtDate(iso) { var p = dateParts(iso); return p ? MON[p.mo - 1] + " " + p.d + ", " + p.y : ""; }

  function radialTex(kit, hex) {
    return kit.canvasTexture(128, 128, function (g) {
      var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, hex); gr.addColorStop(0.35, hex + "66"); gr.addColorStop(1, hex + "00");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
  }
  function addMat(map, opacity, side) {
    var m = new THREE.MeshBasicMaterial({ map: map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: opacity == null ? 1 : opacity, side: side || THREE.FrontSide });
    m.toneMapped = false;
    return m;
  }
  function flatGlow(kit, hex, size, op) {
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), addMat(radialTex(kit, hex), op));
    mesh.rotation.x = -PI / 2;
    return mesh;
  }
  function roundedRect(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /* chamfered rectangle as Vector3[] (for neon tubes) */
  function chamferPts(hw, hh, c, y, z, plane) {
    var P = [[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]];
    return P.map(function (p) { return plane === "xz" ? new THREE.Vector3(p[0], y, p[1]) : new THREE.Vector3(p[0], p[1], z); });
  }
  /* corner-bracket HUD frame drawn to a canvas, as an additive plane. wm, hm in meters. */
  function bracketMesh(kit, wm, hm, arm, color, corners, glow) {
    var ppm = 420, W = Math.round(wm * ppm), H = Math.round(hm * ppm);
    var tex = kit.canvasTexture(W, H, function (g) {
      g.clearRect(0, 0, W, H);
      g.strokeStyle = color; g.lineWidth = 4; g.lineCap = "square";
      g.shadowColor = color; g.shadowBlur = glow == null ? 10 : glow;
      var m = 10, a = arm * ppm;
      function br(x, y, sx, sy) { g.beginPath(); g.moveTo(x + sx * a, y); g.lineTo(x, y); g.lineTo(x, y + sy * a); g.stroke(); }
      br(m, m, 1, 1); br(W - m, m, -1, 1); br(m, H - m, 1, -1); br(W - m, H - m, -1, -1);
      if (corners) corners(g, W, H, ppm);
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), addMat(tex, 0.9));
    mesh.userData.size = { w: wm, h: hm };
    return mesh;
  }

  /* =====================================================================
     POSES + CLIPS
     A pose is a Float32Array of joint parameters (angles in radians, offsets in meters).
     ===================================================================== */
  var NAMES = ["dy", "dx", "dz", "hyaw", "hpit", "hrol", "sx", "sy", "sz", "nx", "ny",
    "rsx", "rsz", "rew", "lsx", "lsz", "lew",
    "raz", "rel", "rro", "rkn", "ran", "laz", "lel", "lro", "lkn", "lan"];
  var I = {}; NAMES.forEach(function (n, i) { I[n] = i; });
  var NP = NAMES.length;
  /* r* = right side (kicking leg, -x), l* = left side (support leg, +x).
     hyaw/hpit/hrol hips rotation; sx/sy/sz spine flex/twist/lean; nx/ny head;
     *sx/*sz shoulder flex/abduct, *ew elbow flex;
     *az leg swing about vertical, *el thigh raise, *ro thigh roll, *kn knee flex, *an ankle. */
  function mkPose(base, o) {
    var a = new Float32Array(NP);
    if (base) a.set(base);
    for (var k in o) if (I[k] != null) a[I[k]] = o[k];
    return a;
  }
  var READY = mkPose(null, {
    hyaw: -0.45, hpit: 0.05, sx: 0.08, sy: 0.35, nx: 0.05, ny: 0.1,
    rsx: -0.7, rsz: -0.18, rew: 2.0, lsx: -0.55, lsz: 0.2, lew: 1.9,
    raz: 0.12, rel: -0.5, rkn: 0.1, ran: -0.6, laz: 0.05, lel: 0.7, lkn: 1.0, lan: -0.3
  });
  /* front kick (rear leg) */
  var FK_LOAD = mkPose(READY, { hyaw: -0.58, sx: 0.16, sy: 0.42, lel: 0.8, lkn: 1.12, lan: -0.32, rel: -0.58, rkn: 0.28, ran: -0.46,
    rsx: -0.8, rew: 2.1, lsx: -0.62, lew: 2.0 });
  var FK_CHAM = mkPose(READY, { hyaw: -0.22, hpit: 0.0, sx: -0.02, sy: 0.15, ny: 0.0, raz: 0.22, rel: 1.38, rkn: 2.1, ran: 0.2,
    lel: 0.32, lkn: 0.36, lan: -0.02, laz: 0.14, rsx: -0.95, rew: 1.9, lsx: -0.5, lew: 1.7 });
  var FK_EXT = mkPose(FK_CHAM, { hpit: -0.04, sx: -0.2, rel: 1.62, rkn: 0.05, ran: 0.05, lel: 0.2, lkn: 0.2, lan: 0.2, laz: 0.26,
    rsx: -0.75, rew: 1.6, lsx: 0.15, lsz: 0.75, lew: 0.6 });
  /* roundhouse (rear leg, hips turn, support foot pivots) */
  var RH_LOAD = mkPose(READY, { hyaw: -0.78, sx: 0.18, sy: 0.6, ny: 0.2, lel: 0.82, lkn: 1.18, lan: -0.3, laz: 0.0,
    rel: -0.6, rkn: 0.3, ran: -0.42, raz: 0.14, rsx: -0.85, rew: 2.1, lsx: -0.6, lew: 2.0 });
  var RH_PIVOT = mkPose(READY, { hyaw: 0.3, hpit: 0.02, sx: 0.04, sy: 0.0, sz: -0.06, nx: 0.0, ny: -0.3,
    raz: 0.0, rel: 0.95, rro: 0.75, rkn: 1.7, ran: 0.1,
    lel: 0.5, lkn: 0.6, lan: -0.02, laz: 0.1, rsx: -0.9, rsz: -0.18, rew: 1.8, lsx: -0.4, lsz: 0.35, lew: 1.6 });
  var RH_CHAM = mkPose(READY, { hyaw: 0.88, hpit: 0.0, sx: 0.0, sy: -0.3, sz: -0.14, nx: 0.0, ny: -0.55,
    raz: -0.58, rel: 1.22, rro: 1.45, rkn: 2.1, ran: 0.0,
    lel: 0.3, lkn: 0.3, lan: 0.16, laz: 0.18, rsx: -0.95, rsz: -0.2, rew: 1.5, lsx: -0.2, lsz: 0.6, lew: 1.3 });
  var RH_EXT = mkPose(RH_CHAM, { hyaw: 1.52, hpit: 0.04, sy: -0.35, sz: -0.45, ny: -0.78,
    raz: -1.42, rel: 1.88, rro: 1.25, rkn: 0.05, ran: 0.0,
    lel: 0.14, lkn: 0.14, lan: 0.3, laz: 0.32, rsx: -1.0, rsz: -0.3, rew: 1.7, lsx: 0.4, lsz: 0.98, lew: 0.4 });
  var RH_LAND = mkPose(READY, { hyaw: 0.15, sx: 0.06, sy: 0.1, ny: -0.1, raz: 0.0, rel: 0.45, rro: 0.3, rkn: 1.1, ran: 0.0,
    lel: 0.6, lkn: 0.8, lan: -0.2, laz: 0.1 });

  var EASE = {
    s: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    x: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    l: function (t) { return t; }
  };
  EASE.h = EASE.s;
  /* keys: [time, pose, kind]  kind: "s" stop (ease in/out), "h" pass through (smooth tangent), "x" stop with snap, "l" linear */
  function mkClip(list) {
    var ks = list.map(function (k) { return { t: k[0], p: k[1], h: k[2] === "h", e: EASE[k[2] || "s"] || EASE.s }; });
    return { keys: ks, dur: ks[ks.length - 1].t };
  }
  function evalClip(clip, time, out) {
    var ks = clip.keys, n = ks.length, i = 1, j;
    if (time <= ks[0].t) { out.set(ks[0].p); return; }
    if (time >= ks[n - 1].t) { out.set(ks[n - 1].p); return; }
    while (i < n - 1 && time > ks[i].t) i++;
    var a = ks[i - 1], b = ks[i], dt = b.t - a.t, u = (time - a.t) / dt, pa = a.p, pb = b.p;
    if (a.h || b.h) {
      var a0 = i >= 2 ? ks[i - 2] : null, b1 = i + 1 < n ? ks[i + 1] : null;
      var u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      for (j = 0; j < NP; j++) {
        var m0 = 0, m1 = 0;
        if (a.h) m0 = a0 ? (pb[j] - a0.p[j]) / (b.t - a0.t) : (pb[j] - pa[j]) / dt;
        if (b.h) m1 = b1 ? (b1.p[j] - pa[j]) / (b1.t - a.t) : (pb[j] - pa[j]) / dt;
        out[j] = h00 * pa[j] + h10 * dt * m0 + h01 * pb[j] + h11 * dt * m1;
      }
    } else {
      var e = b.e(u);
      for (j = 0; j < NP; j++) out[j] = pa[j] + (pb[j] - pa[j]) * e;
    }
  }
  function breathe(P, t, k) {
    var b = Math.sin(t * 1.9) * k;
    P[I.dy] += b * 0.006; P[I.sx] += b * 0.016; P[I.rsx] -= b * 0.03; P[I.lsx] -= b * 0.03; P[I.nx] -= b * 0.012;
    P[I.hrol] += Math.sin(t * 0.9) * k * 0.01;
  }

  var FULL = mkClip([
    [0, READY], [0.7, READY, "l"],
    [1.1, FK_LOAD, "h"], [1.45, FK_CHAM, "h"], [1.68, FK_EXT, "s"], [2.0, FK_EXT, "l"],
    [2.4, FK_CHAM, "h"], [2.95, READY, "s"], [3.9, READY, "l"],
    [4.35, RH_LOAD, "h"], [4.8, RH_PIVOT, "h"], [5.2, RH_CHAM, "h"], [5.45, RH_EXT, "s"], [5.85, RH_EXT, "l"],
    [6.3, RH_CHAM, "h"], [6.9, RH_LAND, "h"], [7.6, READY, "s"], [9.2, READY, "l"]
  ]);
  FULL.wins = [[1.0, 3.3], [4.3, 7.6]];
  var RH_CLICK = mkClip([
    [0, READY], [0.4, RH_LOAD, "h"], [0.85, RH_PIVOT, "h"], [1.25, RH_CHAM, "h"], [1.5, RH_EXT, "s"], [1.9, RH_EXT, "l"],
    [2.35, RH_CHAM, "h"], [2.95, RH_LAND, "h"], [3.6, READY, "s"]
  ]);
  RH_CLICK.wins = [[0.3, 3.5]];
  /* slow-motion scrub clip for the immersive story: ready -> full extension */
  var IM = mkClip([[0, READY], [0.6, RH_LOAD, "h"], [1.2, RH_PIVOT, "h"], [1.9, RH_CHAM, "h"], [2.6, RH_EXT, "s"]]);
  var IM_EXT = 2.6, IM_T0 = 0.7;

  /* =====================================================================
     SHADERS
     ===================================================================== */
  var FIGHT_VS = [
    "varying vec3 vN;varying vec3 vV;varying float vWY;",
    "void main(){",
    "  vec4 wp=modelMatrix*vec4(position,1.0);",
    "  vWY=wp.y;",
    "  vec4 mv=viewMatrix*wp;",
    "  vN=normalize(normalMatrix*normal);",
    "  vV=normalize(-mv.xyz);",
    "  gl_Position=projectionMatrix*mv;",
    "}"
  ].join("\n");
  var FIGHT_FS = [
    "uniform vec3 core;uniform vec3 mid;uniform vec3 rim;uniform vec3 hot;",
    "uniform float uT;uniform float uBoost;uniform float uBase;",
    "varying vec3 vN;varying vec3 vV;varying float vWY;",
    "void main(){",
    "  vec3 n=normalize(vN);vec3 v=normalize(vV);",
    "  float f=1.0-clamp(dot(n,v),0.0,1.0);",
    "  float r1=pow(f,2.3);float r2=pow(f,1.15);",
    "  float yy=vWY-uBase;",
    "  float ring=pow(0.5+0.5*sin(yy*62.0-uT*1.4),16.0);",
    "  float q=fract(yy*0.5-uT*0.11)-0.5;",
    "  float sweep=exp(-q*q/0.0009);",
    "  vec3 c=core*(0.55+0.45*smoothstep(0.0,1.8,yy));",
    "  c+=mid*r2*0.45;",
    "  c+=rim*r1*(1.0+uBoost);",
    "  c+=rim*ring*(0.07+0.5*f);",
    "  c+=hot*sweep*(0.1+0.3*f);",
    "  gl_FragColor=vec4(c,1.0);",
    "}"
  ].join("\n");

  var RIBBON_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var RIBBON_FS = [
    "uniform float uOp;uniform vec3 uCol;uniform vec3 uHot;varying vec2 vUv;",
    "void main(){",
    "  float along=vUv.x;float ac=vUv.y;",
    "  float edge=1.0-ac*ac;",
    "  float core=exp(-ac*ac*7.0);",
    "  float a=pow(along,1.5)*edge;",
    "  vec3 c=uCol*(0.8+0.8*along)+uHot*core*along*along*1.2;",
    "  gl_FragColor=vec4(c,a*uOp);",
    "}"
  ].join("\n");

  var GLASS_VS = [
    "varying vec3 vN;varying vec3 vP;varying vec3 vNv;varying vec3 vV;",
    "void main(){",
    "  vN=normal;vP=position;",
    "  vec4 mv=modelViewMatrix*vec4(position,1.0);",
    "  vNv=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);",
    "  gl_Position=projectionMatrix*mv;",
    "}"
  ].join("\n");
  var GLASS_FS = [
    "uniform float uT;uniform float uA;uniform vec3 uEdge;uniform vec3 uTint;",
    "varying vec3 vN;varying vec3 vP;varying vec3 vNv;varying vec3 vV;",
    "void main(){",
    "  float edge=smoothstep(0.12,0.8,1.0-abs(vN.z));",
    "  float ang=atan(vP.y,vP.x);",
    "  float sheen=0.5+0.5*sin(ang*2.0+uT*0.7);",
    "  float s=vP.x*0.9+vP.y*0.5+vV.x*1.1;",
    "  float d1=(s-0.10)/0.05;float d2=(s+0.48)/0.14;",
    "  float streak=0.6*exp(-d1*d1)+0.25*exp(-d2*d2);",
    "  float fres=pow(1.0-clamp(abs(dot(vNv,vV)),0.0,1.0),3.0);",
    "  vec3 faceC=uTint+uEdge*(streak*0.9+fres*0.5);",
    "  float faceA=0.07+streak*0.22+fres*0.3;",
    "  vec3 edgeC=uEdge*(0.9+0.8*sheen)+vec3(0.25,0.2,0.1);",
    "  float edgeA=0.8+0.2*sheen;",
    "  gl_FragColor=vec4(mix(faceC,edgeC,edge),mix(faceA,edgeA,edge)*uA);",
    "}"
  ].join("\n");

  var HOLO_VS = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  var HOLO_FS = [
    "uniform float uT;uniform float uPos;uniform float uGl;uniform float uA;uniform vec3 uCol;uniform vec3 uHot;uniform vec3 uVio;",
    "varying vec2 vUv;",
    "float hs(float n){return fract(sin(n*91.345)*47453.5453);}",
    "void main(){",
    "  float row=floor(vUv.y*46.0);",
    "  float jit=(hs(row+floor(uT*14.0))-0.5)*0.11*uGl;",
    "  float d=vUv.x*0.62+vUv.y*0.78+jit;",
    "  float q0=(d-uPos)/0.045;float q1=(d-uPos)/0.17;float q2=(d-(uPos-0.15))/0.1;",
    "  float core=exp(-q0*q0);float body=exp(-q1*q1);float trail=exp(-q2*q2);",
    "  float sc=0.5+0.5*sin(vUv.y*640.0+uT*3.0);sc=sc*sc*sc;",
    "  float bar=step(0.93,hs(row*1.7+floor(uT*9.0)))*uGl;",
    "  vec3 c=uHot*core*0.42+uCol*(body*0.45+sc*(0.03+body*0.22))+uVio*trail*0.35+uCol*bar*0.45;",
    "  float a=core*0.45+body*0.24+trail*0.2+sc*(0.03+body*0.12)+bar*0.16;",
    "  gl_FragColor=vec4(c,clamp(a,0.0,1.0)*uA);",
    "}"
  ].join("\n");

  var SHAFT_VS = [
    "varying vec2 vUv;varying vec3 vNv;varying vec3 vV;",
    "void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vNv=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}"
  ].join("\n");
  var SHAFT_FS = [
    "uniform float uT;uniform float uK;uniform vec3 uCol;varying vec2 vUv;varying vec3 vNv;varying vec3 vV;",
    "void main(){",
    "  float h=clamp(vUv.y,0.0,1.0);",
    "  float fr=clamp(abs(dot(normalize(vNv),normalize(vV))),0.0,1.0);",
    "  float a=pow(h,1.3)*smoothstep(1.0,0.72,h)*pow(fr,1.2)*uK*(0.9+0.1*sin(uT*0.8+vUv.x*12.0));",
    "  gl_FragColor=vec4(uCol,a);",
    "}"
  ].join("\n");

  /* =====================================================================
     NEON FIGHTER  (light sculpture, shared by the room and the immersive)
     ===================================================================== */
  function limbGeo(r0, r1, len, seg) {
    var pts = [], n = Math.max(3, Math.round(seg / 3)), i, a;
    for (i = 0; i <= n; i++) { a = i / n * PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r1, -len - Math.cos(a) * r1)); }
    for (i = 0; i <= n; i++) { a = i / n * PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
    return new THREE.LatheGeometry(pts, seg);
  }
  function limbUp(r0, r1, len, seg) { return limbGeo(r0, r1, len, seg).rotateX(PI); }

  function buildFighter(kit, low) {
    var T = HH.THEME, seg = low ? 10 : 20, rseg = Math.max(6, seg >> 1), i;
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        core: { value: kit.color("#150c40") }, mid: { value: kit.color(T.purple, 0.6) },
        rim: { value: kit.color(T.amber, 1.75) }, hot: { value: kit.color("#ffd9a0", 1.1) },
        uT: { value: 0 }, uBoost: { value: 0 }, uBase: { value: MAT_TOP }
      },
      vertexShader: FIGHT_VS, fragmentShader: FIGHT_FS
    });
    var neon = kit.neonMat(T.amber, 1.9);
    var root = new THREE.Group(); root.scale.setScalar(FSCALE);
    var hips = new THREE.Group(); hips.rotation.order = "YXZ"; root.add(hips);
    function part(geo, parent, x, y, z, m) {
      var mesh = new THREE.Mesh(geo, m || mat);
      mesh.position.set(x || 0, y || 0, z || 0); parent.add(mesh); return mesh;
    }
    /* torso */
    var pel = part(new THREE.SphereGeometry(0.14, seg, rseg), hips, 0, 0, 0); pel.scale.set(1.25, 0.78, 0.95);
    var spine = new THREE.Group(); spine.rotation.order = "YXZ"; spine.position.set(0, 0.03, 0); hips.add(spine);
    part(limbUp(0.118, 0.122, 0.17, seg), spine);
    var belt = part(new THREE.TorusGeometry(0.128, 0.01, 6, seg + 8).rotateX(PI / 2), spine, 0, 0.07, 0, neon); belt.scale.set(1, 1, 0.9);
    var chest = new THREE.Group(); chest.rotation.order = "YXZ"; chest.position.set(0, 0.19, 0); spine.add(chest);
    var cm = part(limbUp(0.138, 0.178, 0.21, seg), chest); cm.scale.z = 0.76;
    var sbar = part(limbGeo(0.05, 0.05, 0.36, seg), chest, -0.18, 0.325, 0); sbar.rotation.z = PI / 2; sbar.scale.z = 0.8;
    var neck = new THREE.Group(); neck.position.set(0, 0.37, 0); chest.add(neck);
    part(limbUp(0.046, 0.04, 0.07, seg), neck);
    var head = part(new THREE.SphereGeometry(0.1, seg, rseg), neck, 0, 0.175, 0.012); head.scale.set(0.95, 1.12, 1.02);
    var band = part(new THREE.TorusGeometry(0.104, 0.007, 6, seg + 4).rotateX(PI / 2), neck, 0, 0.222, 0.012, neon); band.rotation.x = -0.12;
    /* arms */
    var handGeo = new THREE.SphereGeometry(0.047, Math.max(8, seg >> 1), Math.max(6, seg >> 2));
    function makeArm(s) {
      var sh = new THREE.Group(); sh.rotation.order = "ZXY"; sh.position.set(s * 0.228, 0.325, 0); chest.add(sh);
      part(limbGeo(0.058, 0.045, 0.25, seg), sh);
      var el = new THREE.Group(); el.position.y = -0.275; sh.add(el);
      part(limbGeo(0.045, 0.033, 0.22, seg), el);
      part(handGeo, el, 0, -0.26, 0, neon);
      return { sh: sh, el: el };
    }
    var RA = makeArm(-1), LA = makeArm(1);
    /* legs */
    var footGeo = limbGeo(0.045, 0.034, 0.13, seg).rotateX(-PI / 2);
    function makeLeg(s) {
      var hj = new THREE.Group(); hj.position.set(s * 0.1, -0.02, 0); hips.add(hj);
      var az = new THREE.Group(); hj.add(az);
      var ev = new THREE.Group(); az.add(ev);
      var ro = new THREE.Group(); ev.add(ro);
      part(limbGeo(0.094, 0.06, 0.42, seg), ro);
      var kn = new THREE.Group(); kn.position.y = -0.45; ro.add(kn);
      part(limbGeo(0.06, 0.04, 0.38, seg), kn);
      var an = new THREE.Group(); an.position.y = -0.42; kn.add(an);
      part(footGeo, an, 0, -0.04, -0.03);
      var heel = new THREE.Object3D(); heel.position.set(0, -0.085, -0.05); an.add(heel);
      var ball = new THREE.Object3D(); ball.position.set(0, -0.085, 0.1); an.add(ball);
      var tip = new THREE.Object3D(); tip.position.set(0, -0.045, 0.15); an.add(tip);
      return { az: az, ev: ev, ro: ro, kn: kn, an: an, heel: heel, ball: ball, tip: tip };
    }
    var RL = makeLeg(-1), LL = makeLeg(1);
    var glow = kit.glowSprite(T.amber, 0.34, 0); RL.tip.add(glow);
    var hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.95, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, 0.97, 0); root.add(hit);

    /* ---- ribbon trail (pooled geometry) ---- */
    var N = low ? 20 : 38;
    var tGeo = new THREE.BufferGeometry();
    var tPos = new Float32Array(N * 6), tUv = new Float32Array(N * 4), tIdx = [];
    for (i = 0; i < N; i++) {
      tUv[i * 4] = i / (N - 1); tUv[i * 4 + 1] = -1; tUv[i * 4 + 2] = i / (N - 1); tUv[i * 4 + 3] = 1;
      if (i < N - 1) { var a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    var posAttr = new THREE.BufferAttribute(tPos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    tGeo.setAttribute("position", posAttr);
    tGeo.setAttribute("uv", new THREE.BufferAttribute(tUv, 2));
    tGeo.setIndex(tIdx);
    var trailMat = new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 1 }, uCol: { value: kit.color(T.amber, 1.7) }, uHot: { value: kit.color("#fff0d0", 1.3) } },
      vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    var trail = new THREE.Mesh(tGeo, trailMat); trail.frustumCulled = false; trail.visible = false; root.add(trail);
    var pts = []; for (i = 0; i < N; i++) pts.push(new THREE.Vector3());

    /* ---- kinematics ---- */
    var inv = new THREE.Matrix4(), shift = new THREE.Vector3(), plant = new THREE.Vector3(), plantSet = false;
    var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3();
    var tgv = new THREE.Vector3(), vv = new THREE.Vector3(), wv = new THREE.Vector3(), camL = new THREE.Vector3();
    var tmpP = new Float32Array(NP);
    function mk(obj, out) { out.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(inv); }

    function apply(P) {
      hips.position.set(P[I.dx], HIP_Y + P[I.dy], P[I.dz]);
      hips.rotation.set(P[I.hpit], P[I.hyaw], P[I.hrol]);
      spine.rotation.set(P[I.sx] * 0.55, P[I.sy] * 0.55, P[I.sz] * 0.55);
      chest.rotation.set(P[I.sx] * 0.45, P[I.sy] * 0.45, P[I.sz] * 0.45);
      neck.rotation.set(P[I.nx], P[I.ny], 0);
      RA.sh.rotation.set(P[I.rsx], 0, P[I.rsz]); RA.el.rotation.x = -P[I.rew];
      LA.sh.rotation.set(P[I.lsx], 0, P[I.lsz]); LA.el.rotation.x = -P[I.lew];
      RL.az.rotation.y = P[I.raz]; RL.ev.rotation.x = -P[I.rel]; RL.ro.rotation.y = P[I.rro]; RL.kn.rotation.x = P[I.rkn]; RL.an.rotation.x = P[I.ran];
      LL.az.rotation.y = P[I.laz]; LL.ev.rotation.x = -P[I.lel]; LL.ro.rotation.y = P[I.lro]; LL.kn.rotation.x = P[I.lkn]; LL.an.rotation.x = P[I.lan];
      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      mk(LL.ball, vA); mk(LL.heel, vB); mk(RL.ball, vC); mk(RL.heel, vD);
      var lo = Math.min(vA.y, vB.y, vC.y, vD.y);
      if (!plantSet) {
        plantSet = true;
        plant.set((vA.x - vC.x) * 0.5, 0, (vA.z - vC.z) * 0.5);
      }
      shift.set(plant.x - vA.x, -lo, plant.z - vA.z);
      hips.position.add(shift);
    }
    function tipLocal(out) { out.setFromMatrixPosition(RL.tip.matrixWorld).applyMatrix4(inv).add(shift); }

    function ribbon() {
      var k, len = 0, a, b, f, wd, o, wl;
      for (k = 0; k < N; k++) {
        a = pts[k > 0 ? k - 1 : 0]; b = pts[k < N - 1 ? k + 1 : N - 1];
        tgv.subVectors(b, a);
        vv.subVectors(camL, pts[k]);
        wv.crossVectors(tgv, vv);
        wl = wv.length();
        if (wl < 1e-7) wv.set(0, 1, 0); else wv.multiplyScalar(1 / wl);
        f = k / (N - 1); wd = 0.06 * Math.pow(f, 0.7);
        o = k * 6;
        tPos[o] = pts[k].x + wv.x * wd; tPos[o + 1] = pts[k].y + wv.y * wd; tPos[o + 2] = pts[k].z + wv.z * wd;
        tPos[o + 3] = pts[k].x - wv.x * wd; tPos[o + 4] = pts[k].y - wv.y * wd; tPos[o + 5] = pts[k].z - wv.z * wd;
        if (k > 0) len += pts[k].distanceTo(pts[k - 1]);
      }
      posAttr.needsUpdate = true;
      return len;
    }
    var rig = {
      root: root, mat: mat, hit: hit, trail: trail, trailMul: 1, glow: glow, N: N, apply: apply, tipLocal: tipLocal,
      /* resample: re-run the clip over [t0,t1] to find the foot path; false = reuse the last path */
      updateTrail: function (camera, clip, t0, t1, cur, resample) {
        var k;
        if (resample !== false) {
          for (k = 0; k < N; k++) {
            evalClip(clip, t0 + (t1 - t0) * k / (N - 1), tmpP);
            apply(tmpP); tipLocal(pts[k]);
          }
          apply(cur);
        }
        camL.copy(camera.position).applyMatrix4(inv);
        var len = ribbon();
        var op = clamp(len * 2.4, 0, 1) * rig.trailMul;
        trail.visible = op > 0.02;
        trailMat.uniforms.uOp.value = op;
        glow.material.opacity = op * 0.8;
      },
      hideTrail: function () { trail.visible = false; glow.material.opacity = 0; }
    };
    apply(READY);
    return rig;
  }

  /* =====================================================================
     CERTIFICATE ON A THICK GLASS SLAB  (room hero, also reused in the immersive)
     ===================================================================== */
  function buildSlab(kit, fallbackTex) {
    var T = HH.THEME, W = 1.25, H = 1.85, GW = W + 0.09, GH = H + 0.09;
    var g = new THREE.Group();
    var photoMat = new THREE.MeshBasicMaterial({ map: fallbackTex || null, color: kit.color("#c8c8d0"), transparent: true });
    var photo = new THREE.Mesh(new THREE.PlaneGeometry(W, H), photoMat); photo.renderOrder = 1; g.add(photo);

    var geo = new THREE.ExtrudeGeometry(roundedRect(GW - 0.024, GH - 0.024, 0.07), {
      depth: 0.06, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelOffset: 0, bevelSegments: 2, curveSegments: 5
    });
    geo.translate(0, 0, -0.03);
    var glassMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 1 }, uEdge: { value: kit.color(T.amber, 1.5) }, uTint: { value: kit.color("#4a38b8", 0.55) } },
      vertexShader: GLASS_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false
    });
    var glass = new THREE.Mesh(geo, glassMat); glass.renderOrder = 2; g.add(glass);
    var edgeMat = new THREE.LineBasicMaterial({ color: kit.color(T.violet, 1.1), transparent: true, opacity: 0.85 });
    var edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat); edges.renderOrder = 2; g.add(edges);

    var holoMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uPos: { value: 0.6 }, uGl: { value: 0 }, uA: { value: 1 },
        uCol: { value: kit.color(T.amber, 1.3) }, uHot: { value: kit.color("#ffe6bd", 1.1) }, uVio: { value: kit.color(T.purple, 1.2) } },
      vertexShader: HOLO_VS, fragmentShader: HOLO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var holo = new THREE.Mesh(new THREE.PlaneGeometry(GW - 0.03, GH - 0.03), holoMat); holo.position.z = 0.05; holo.renderOrder = 3; g.add(holo);

    var frameMat = kit.neonMat(T.amber, 1.7, { transparent: true });
    var fp = chamferPts(GW / 2 - 0.02, GH / 2 - 0.02, 0.05, 0, 0.05, "xy"), path = new THREE.CurvePath(), k;
    for (k = 0; k < fp.length; k++) path.add(new THREE.LineCurve3(fp[k], fp[(k + 1) % fp.length]));
    var frame = new THREE.Mesh(new THREE.TubeGeometry(path, 64, 0.0075, 6, false), frameMat);
    frame.renderOrder = 2; g.add(frame);

    /* HUD brackets + tiny mono readouts just outside the glass */
    var hud = bracketMesh(kit, GW + 0.42, GH + 0.42, 0.2, T.amber, function (c, w, h, ppm) {
      c.shadowBlur = 6; c.fillStyle = AMBER_DIM; c.strokeStyle = AMBER_DIM; c.lineWidth = 2;
      c.font = "500 17px " + HH.FONTS.mono; c.textBaseline = "top";
      if ("letterSpacing" in c) c.letterSpacing = "4px";
      c.textAlign = "left"; c.fillText("CH 06", 34, 24);
      c.textAlign = "right"; c.fillText("SYS", w - 34, 24);
      c.textBaseline = "bottom"; c.textAlign = "left"; c.fillText("KUKKIWON", 34, h - 22);
      c.textAlign = "right"; c.font = "500 17px " + HH.FONTS.kr; c.fillText("4품", w - 34, h - 22);
      c.beginPath();
      for (var y = 60; y < h - 60; y += 26) { var len = (y % 130 === 60) ? 14 : 7; c.moveTo(12, y); c.lineTo(12 + len, y); c.moveTo(w - 12, y); c.lineTo(w - 12 - len, y); }
      c.stroke();
    }, 0);
    hud.position.z = 0.075; hud.renderOrder = 4; g.add(hud);

    return {
      group: g, glassMesh: glass, photoMat: photoMat, glass: glassMat, holo: holoMat, hud: hud, frame: frameMat, edges: edgeMat, size: { w: GW, h: GH },
      setPhoto: function (tex) { photoMat.map = tex; photoMat.needsUpdate = true; },
      setAlpha: function (a) {
        glassMat.uniforms.uA.value = a; holoMat.uniforms.uA.value = a; photoMat.opacity = a;
        hud.material.opacity = 0.9 * a; frameMat.opacity = a; edgeMat.opacity = 0.85 * a;
        g.visible = a > 0.01;
      }
    };
  }

  /* =====================================================================
     MAT, LIGHT SHAFT, DUST
     ===================================================================== */
  function buildMat(kit, size) {
    var T = HH.THEME, g = new THREE.Group();
    var base = new THREE.Mesh(new THREE.BoxGeometry(size, MAT_TOP, size), kit.darkMat("#0a0820", { roughness: 0.55, metalness: 0.3 }));
    base.position.y = MAT_TOP / 2; g.add(base);
    var S = 1024;
    var tex = kit.canvasTexture(S, S, function (c) {
      var cells = Math.round(size / 0.2), st = S / cells, i, a, r, ang, len;
      c.clearRect(0, 0, S, S);
      for (i = 0; i <= cells; i++) {
        c.lineWidth = (i % 4 === 0) ? 2 : 1.2;
        c.strokeStyle = (i % 4 === 0) ? "rgba(255,178,63,0.5)" : "rgba(255,178,63,0.2)";
        c.beginPath(); c.moveTo(i * st, 0); c.lineTo(i * st, S); c.stroke();
        c.beginPath(); c.moveTo(0, i * st); c.lineTo(S, i * st); c.stroke();
      }
      var m = S / 2; r = S * 0.3;
      c.shadowColor = AMBER; c.shadowBlur = 8;
      c.strokeStyle = "rgba(255,178,63,0.85)"; c.lineWidth = 3; c.beginPath(); c.arc(m, m, r, 0, PI * 2); c.stroke();
      c.strokeStyle = "rgba(184,139,255,0.7)"; c.lineWidth = 1.6; c.beginPath(); c.arc(m, m, r * 1.16, 0, PI * 2); c.stroke();
      c.strokeStyle = "rgba(255,178,63,0.7)"; c.lineWidth = 1.5;
      for (a = 0; a < 72; a++) {
        ang = a * PI / 36; len = a % 6 === 0 ? 20 : 8;
        c.beginPath(); c.moveTo(m + Math.cos(ang) * r * 1.16, m + Math.sin(ang) * r * 1.16);
        c.lineTo(m + Math.cos(ang) * (r * 1.16 + len), m + Math.sin(ang) * (r * 1.16 + len)); c.stroke();
      }
      c.beginPath(); c.moveTo(m - 16, m); c.lineTo(m + 16, m); c.moveTo(m, m - 16); c.lineTo(m, m + 16); c.stroke();
      c.lineWidth = 5; c.strokeStyle = "rgba(255,178,63,0.95)"; c.lineCap = "square";
      var k = 16, ar = 80;
      [[k, k, 1, 1], [S - k, k, -1, 1], [k, S - k, 1, -1], [S - k, S - k, -1, -1]].forEach(function (q) {
        c.beginPath(); c.moveTo(q[0] + q[2] * ar, q[1]); c.lineTo(q[0], q[1]); c.lineTo(q[0], q[1] + q[3] * ar); c.stroke();
      });
    });
    var grid = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.985, size * 0.985), addMat(tex, 0.9));
    grid.rotation.x = -PI / 2; grid.position.y = MAT_TOP + 0.002; g.add(grid);
    var hs = size / 2 - 0.035;
    var border = kit.neonTube([new THREE.Vector3(-hs, MAT_TOP + 0.01, -hs), new THREE.Vector3(hs, MAT_TOP + 0.01, -hs),
      new THREE.Vector3(hs, MAT_TOP + 0.01, hs), new THREE.Vector3(-hs, MAT_TOP + 0.01, hs)], { closed: true, radius: 0.013, color: T.amber, intensity: 1.7 });
    g.add(border);
    var inner = kit.neonTube([new THREE.Vector3(-hs + 0.1, MAT_TOP + 0.008, -hs + 0.1), new THREE.Vector3(hs - 0.1, MAT_TOP + 0.008, -hs + 0.1),
      new THREE.Vector3(hs - 0.1, MAT_TOP + 0.008, hs - 0.1), new THREE.Vector3(-hs + 0.1, MAT_TOP + 0.008, hs - 0.1)], { closed: true, radius: 0.005, color: T.purple, intensity: 1.2 });
    g.add(inner);
    return { group: g, grid: grid };
  }

  function buildShaft(kit, rTop, rBot, h, k) {
    var mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: k }, uCol: { value: kit.color(HH.THEME.amber, 1.0) } },
      vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 28, 1, true), mat);
    m.position.y = h / 2; m.renderOrder = 5;
    return m;
  }

  /* haze particles drifting up through the spotlight columns. cols: [{x,z,r}] */
  function buildDust(kit, count, cols, y0, y1) {
    var pos = new Float32Array(count * 3), seed = new Float32Array(count * 2), rnd = kit.rand(61), i, c, a, rr;
    for (i = 0; i < count; i++) {
      c = cols[i % cols.length]; a = rnd() * PI * 2; rr = Math.sqrt(rnd()) * c.r;
      pos[i * 3] = c.x + Math.cos(a) * rr; pos[i * 3 + 1] = y0 + rnd() * (y1 - y0); pos[i * 3 + 2] = c.z + Math.sin(a) * rr;
      seed[i * 2] = rnd() * 6.283; seed[i * 2 + 1] = 0.025 + rnd() * 0.06;
    }
    var geo = new THREE.BufferGeometry();
    var attr = new THREE.BufferAttribute(pos, 3); attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    var mat = new THREE.PointsMaterial({ size: 0.05, map: radialTex(kit, "#ffffff"), color: kit.color(AMBER, 1.2), transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending });
    var pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    return {
      points: pts, mat: mat,
      update: function (dt, t) {
        for (var k = 0; k < count; k++) {
          var o = k * 3;
          pos[o + 1] += seed[k * 2 + 1] * dt;
          if (pos[o + 1] > y1) pos[o + 1] = y0;
          pos[o] += Math.sin(t * 0.45 + seed[k * 2]) * 0.0014;
          pos[o + 2] += Math.cos(t * 0.38 + seed[k * 2]) * 0.0014;
        }
        attr.needsUpdate = true;
      }
    };
  }

  /* =====================================================================
     BLACK BELT: ribbon geometry with twist, edge ripple and four gold bars
     ===================================================================== */
  function buildBelt(kit, low) {
    var ctrl = [[-0.96, -0.034], [-0.5, -0.034], [-0.1, -0.032], [-0.02, -0.027], [0.018, -0.015], [0.03, 0.0], [0.018, 0.015],
      [-0.02, 0.027], [-0.1, 0.031], [-0.55, 0.036], [-1.12, 0.044]].map(function (p) { return new THREE.Vector3(0, p[0], p[1]); });
    var curve = new THREE.CatmullRomCurve3(ctrl, false, "catmullrom", 0.5);
    var S = low ? 70 : 130, cols = 3, hw = 0.05, i, j;
    var pos = new Float32Array((S + 1) * cols * 3), idx = [];
    var cen = [], tan = [], wid = [];
    var c = new THREE.Vector3(), t = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3(), xh = new THREE.Vector3(1, 0, 0);
    for (i = 0; i <= S; i++) {
      var u = i / S;
      curve.getPointAt(u, c); curve.getTangentAt(u, t);
      c.x = 0.012 * Math.sin(u * 7.0 + 0.6) * (0.3 + u) + 0.01 * Math.sin(u * 15.0);
      var th = 0.35 * ss(0.62, 1.0, u) * Math.sin(u * 5.0) + 0.18 * Math.sin(u * 3.0);
      n.crossVectors(t, xh).normalize();
      w.copy(xh).multiplyScalar(Math.cos(th)).addScaledVector(n, Math.sin(th));
      n.crossVectors(t, w).normalize();
      cen.push(c.clone()); tan.push(t.clone()); wid.push(w.clone());
      for (j = 0; j < cols; j++) {
        var side = j - 1, o = (i * cols + j) * 3;
        var rip = (side === 0 ? 0.0025 : 0.0035 * Math.sin(u * 40 + side * 1.9));
        pos[o] = c.x + w.x * hw * side + n.x * rip; pos[o + 1] = c.y + w.y * hw * side + n.y * rip; pos[o + 2] = c.z + w.z * hw * side + n.z * rip;
      }
      if (i < S) for (j = 0; j < cols - 1; j++) {
        var a = i * cols + j, b = a + 1, cc = a + cols, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({ color: kit.color("#09090f"), roughness: 0.7, metalness: 0.08, side: THREE.DoubleSide, emissive: kit.color("#1a0f3a", 0.18) });
    var mesh = new THREE.Mesh(geo, mat);
    /* four gold bars near the end of the long strand */
    var gold = new THREE.MeshStandardMaterial({ color: kit.color("#d9a02b"), metalness: 0.85, roughness: 0.3, emissive: kit.color("#ff9a1f", 0.3) });
    var bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.114, 0.015, 0.008), gold, 4);
    var mtx = new THREE.Matrix4(), up = new THREE.Vector3(), nn = new THREE.Vector3();
    for (i = 0; i < 4; i++) {
      var k = Math.floor(S * (0.835 + i * 0.037));
      up.copy(tan[k]).multiplyScalar(-1);
      nn.crossVectors(wid[k], up).normalize();
      mtx.makeBasis(wid[k], up, nn);
      mtx.setPosition(cen[k].x + nn.x * 0.007, cen[k].y + nn.y * 0.007, cen[k].z + nn.z * 0.007);
      bars.setMatrixAt(i, mtx);
    }
    bars.instanceMatrix.needsUpdate = true;
    return { mesh: mesh, bars: bars };
  }

  /* =====================================================================
     ROOM
     ===================================================================== */
  var R = null;
  var CX = -0.35, CY = 2.62, CZ = 0.8;       // certificate center (anchor-local)
  var FX = 1.75, FZ = 1.05, FYAW = -1.05, DAIS = 0.5;      // fighter + mat center
  var BX = -2.85, BY = 3.85;                  // belt rack

  function build(ctx) {
    var kit = ctx.kit || HH.kit, T = HH.THEME, F = HH.FONTS;
    var ex = ctx.exhibit || {}, facts = ex.facts || {}, media = ex.media || {};
    var low = ctx.quality === "low", reduced = !!ctx.reducedMotion, base = ctx.assetBase || "";
    var root = new THREE.Group(); root.name = "room6-taekwondo"; ctx.anchor.add(root);
    var hu = ex.human || {}, ma = ex.machine || {};
    var issued = fmtDate(facts.issued), ip = dateParts(facts.issued);
    var y0 = num(facts.since, 2013), y1 = ip ? ip.y : y0 + num(facts.years, 13);
    var count = clamp(y1 - y0 + 1, 2, 40);
    var i;

    R = {
      ctx: ctx, kit: kit, root: root, low: low, reduced: reduced, active: false, clock: 0, t: 0,
      clip: null, clipT: 0, pose: new Float32Array(NP), flash: 0, glitch: 0, holoT0: -10, tlP: reduced ? 1 : 0, tlGo: false, tlLit: -1,
      phase: -1, staticDone: false, video: null
    };

    /* ----- warm key light (the only light this room adds) ----- */
    var light = new THREE.PointLight(kit.color(AMBER), 1.7, 10, 1.4);
    light.position.set(-0.8, 3.3, 2.7); root.add(light);

    /* ----- certificate slab ----- */
    var fb = kit.canvasTexture(512, 760, function (g, w, h) {
      g.fillStyle = "#e9e3d0"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#8a7a55"; g.lineWidth = 6; g.strokeRect(24, 24, w - 48, h - 48);
      g.fillStyle = "#2a2a35"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "700 56px " + F.display; g.fillText("KUKKIWON", w / 2, 150);
      g.font = "700 150px " + F.kr; g.fillText("4품", w / 2, 360);
      g.font = "500 36px " + F.mono; g.fillText("4TH POOM", w / 2, 520);
    });
    var slab = buildSlab(kit, fb);
    slab.group.position.set(CX, CY, CZ);
    root.add(slab.group);
    R.slab = slab; R.certBase = CY;
    var url = media.certificate ? base + media.certificate : "";
    var load = url && ctx.loadTexture ? ctx.loadTexture(url) : Promise.reject(new Error("no certificate"));
    var halo = kit.glowSprite(AMBER, 2.4, 0.12); halo.position.set(CX, CY, CZ - 0.5); root.add(halo);
    var pedestal = flatGlow(kit, AMBER, 2.0, 0.32); pedestal.position.set(CX, 0.012, CZ); root.add(pedestal);
    var ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.64, 64), addMat(null, 0.9));
    ringMesh.material.color = kit.color(AMBER, 1.5);
    ringMesh.rotation.x = -PI / 2; ringMesh.position.set(CX, 0.014, CZ); root.add(ringMesh);

    /* plate under the slab */
    var plateText = ["KUKKIWON", "4TH POOM", issued.toUpperCase()].filter(Boolean).join(" · ");
    var plate = kit.neonText(plateText, { font: F.mono, weight: "500", height: 0.068, color: "#ffd9a0", glow: 6, core: 0.25, letterSpacing: 6 });
    var pw = Math.max(1.5, plate.userData.size.w + 0.2);
    var plateBox = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.135, 0.025), kit.darkMat("#10143a", { roughness: 0.5, metalness: 0.5 }));
    plateBox.position.set(CX, 1.4, CZ); root.add(plateBox);
    var plateEdge = new THREE.LineSegments(new THREE.EdgesGeometry(plateBox.geometry), new THREE.LineBasicMaterial({ color: kit.color(AMBER, 1.3) }));
    plateEdge.position.copy(plateBox.position); root.add(plateEdge);
    plate.position.set(CX, 1.4, CZ + 0.016); root.add(plate);

    /* STEP INSIDE sign */
    var sign = kit.neonText("▶ STEP INSIDE", { font: F.display, weight: "600", height: 0.1, color: T.amber, glow: 18, core: 0.45, letterSpacing: 12 });
    sign.position.set(CX, 1.06, CZ); root.add(sign);
    R.sign = sign;
    var signHit = new THREE.Mesh(new THREE.PlaneGeometry(sign.userData.size.w * 1.15, 0.34), new THREE.MeshBasicMaterial({ visible: false }));
    signHit.position.copy(sign.position); signHit.position.z += 0.01; root.add(signHit);
    if (ctx.addClickable) ctx.addClickable(signHit, function () { R.flash = 1; if (ctx.openImmersive) ctx.openImmersive(); }, "Step inside");

    if (ctx.addClickable) ctx.addClickable(slab.glassMesh, function () { R.holoT0 = R.clock; R.glitch = 1; }, "Scan the certificate");

    /* ----- black belt on a rack ----- */
    var rodMat = kit.darkMat("#2a2d5a", { roughness: 0.4, metalness: 0.7 });
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 12).rotateZ(PI / 2), rodMat);
    rod.position.set(BX, BY, 0.14); root.add(rod);
    var br = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 8).rotateX(PI / 2), rodMat, 2);
    var bm = new THREE.Matrix4();
    bm.makeTranslation(BX - 0.2, BY, 0.07); br.setMatrixAt(0, bm); bm.makeTranslation(BX + 0.2, BY, 0.07); br.setMatrixAt(1, bm);
    root.add(br);
    var belt = buildBelt(kit, low);
    belt.mesh.position.set(BX, BY, 0.14); belt.bars.position.set(BX, BY, 0.14);
    root.add(belt.mesh); root.add(belt.bars);
    R.belt = belt.mesh;
    var beltHalo = kit.glowSprite(AMBER, 2.0, 0.2); beltHalo.position.set(BX, BY - 0.5, 0.04); root.add(beltHalo);
    var beltLabel = kit.neonText("BLACK BELT", { font: F.mono, weight: "500", height: 0.055, color: AMBER_DIM, glow: 6, core: 0.2, letterSpacing: 12 });
    beltLabel.position.set(BX, BY - 1.36, 0.04); beltLabel.material.color.setScalar(0.8); root.add(beltLabel);

    /* ----- human vs machine readout ----- */
    var rx = -3.45;
    function readPair(label, value, color, dim, y) {
      if (!value) return;
      var l = kit.neonText(label.toUpperCase(), { font: F.mono, weight: "500", height: 0.05, color: color, glow: 6, core: 0.2, align: "left", letterSpacing: 10 });
      l.position.set(rx, y + 0.125, 0.04); l.material.color.setScalar(0.75); root.add(l);
      var v = kit.neonText(value, { font: F.display, weight: "700", height: 0.12, color: color, glow: 14, core: 0.5, align: "left", letterSpacing: 3 });
      v.position.set(rx - 0.01, y - 0.02, 0.04); v.material.color.setScalar(1.15); root.add(v);
    }
    readPair(str(hu.label) || "Human time", str(hu.short), T.amber, AMBER_DIM, 2.0);
    readPair(str(ma.label) || "Machine time", str(ma.short), T.cyan, CYAN_DIM, 1.5);

    /* ----- mat + fighter ----- */
    /* low dais so the fighter stays inside the view from the visitor's spot */
    var dais = new THREE.Mesh(new THREE.BoxGeometry(1.9, DAIS, 1.9), kit.darkMat("#10143a", { roughness: 0.45, metalness: 0.5 }));
    dais.position.set(FX, DAIS / 2, FZ); root.add(dais);
    var daisLine = kit.neonTube([new THREE.Vector3(FX - 0.955, 0.07, FZ + 0.955), new THREE.Vector3(FX + 0.955, 0.07, FZ + 0.955),
      new THREE.Vector3(FX + 0.955, 0.07, FZ - 0.955), new THREE.Vector3(FX - 0.955, 0.07, FZ - 0.955)], { closed: true, radius: 0.008, color: T.purple, intensity: 1.4 });
    root.add(daisLine);
    var mat = buildMat(kit, 1.8);
    mat.group.position.set(FX, DAIS, FZ); root.add(mat.group);
    var matGlow = flatGlow(kit, AMBER, 2.6, 0.28); matGlow.position.set(FX, DAIS + 0.012, FZ); root.add(matGlow);
    var rig = buildFighter(kit, low);
    rig.root.position.set(FX, DAIS + MAT_TOP, FZ); rig.root.rotation.y = FYAW; root.add(rig.root);
    rig.mat.uniforms.uBase.value = DAIS + MAT_TOP;
    R.rig = rig;
    if (ctx.addClickable) ctx.addClickable(rig.hit, function () { playRound(); }, "Roundhouse kick");

    /* motion-capture wall HUD above the fighter */
    var hudBr = bracketMesh(kit, 2.1, 0.62, 0.14, T.violet, null, 8);
    hudBr.position.set(FX, 3.2, 0.04); root.add(hudBr);
    var hudA = kit.neonText("MOTION CAPTURE", { font: F.mono, weight: "500", height: 0.05, color: LABEL_VIO, glow: 5, core: 0.2, align: "left", letterSpacing: 10 });
    hudA.position.set(FX - 0.95, 3.37, 0.05); root.add(hudA);
    var names = ["READY", "FRONT KICK", "ROUNDHOUSE KICK"];
    R.names = names.map(function (n) {
      var m = kit.neonText(n, { font: F.display, weight: "600", height: 0.1, color: T.amber, glow: 16, core: 0.45, align: "left", letterSpacing: 8 });
      m.position.set(FX - 0.95, 3.15, 0.05); m.visible = false; root.add(m); return m;
    });
    R.names[0].visible = true;
    var rec = kit.neonText("● REC", { font: F.mono, weight: "500", height: 0.05, color: AMBER, glow: 8, core: 0.3, align: "right", letterSpacing: 8 });
    rec.position.set(FX + 0.95, 3.37, 0.05); root.add(rec); R.rec = rec;
    var tagSys = kit.neonText("SYS · CH 06", { font: F.mono, weight: "500", height: 0.045, color: LABEL_VIO, glow: 4, core: 0.15, align: "right", letterSpacing: 10 });
    tagSys.position.set(FX + 0.95, 2.98, 0.05); root.add(tagSys);

    /* ----- timeline on the wall, 2013 ... 2026 ----- */
    var tl0 = -3.3, tl1 = 3.3, ty = 0.78, tlen = tl1 - tl0;
    var baseLine = new THREE.Mesh(new THREE.BoxGeometry(tlen, 0.012, 0.012), kit.neonMat(T.purple, 1.3));
    baseLine.position.set(0, ty, 0.03); root.add(baseLine);
    var progGeo = new THREE.BoxGeometry(tlen, 0.017, 0.017); progGeo.translate(tlen / 2, 0, 0);
    var prog = new THREE.Mesh(progGeo, kit.neonMat(T.amber, 1.8)); prog.position.set(tl0, ty, 0.034); prog.scale.x = 0.0001; root.add(prog);
    R.prog = prog;
    var ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.15, 0.014), kit.neonMat("#ffffff", 1.0), count - 1);
    var tm = new THREE.Matrix4(), cUnlit = kit.color(T.violet, 0.9), cLit = kit.color(T.amber, 1.5);
    for (i = 0; i < count - 1; i++) {
      tm.makeTranslation(tl0 + tlen * i / (count - 1), ty + 0.075, 0.03); ticks.setMatrixAt(i, tm); ticks.setColorAt(i, cUnlit);
    }
    ticks.instanceMatrix.needsUpdate = true; root.add(ticks);
    R.ticks = ticks; R.count = count; R.cUnlit = cUnlit; R.cLit = cLit;
    var lastTick = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.3, 0.024), kit.neonMat(T.amber, 1.9));
    lastTick.position.set(tl1, ty + 0.14, 0.03); root.add(lastTick);
    var endGlow = kit.glowSprite(AMBER, 0.7, 0.55); endGlow.position.set(tl1, ty + 0.14, 0.06); root.add(endGlow);
    function tlLabel(txt, x, y, color, dim) {
      var m = kit.neonText(txt, { font: F.mono, weight: "500", height: 0.075, color: color, glow: 8, core: 0.3, letterSpacing: 8 });
      m.position.set(x, y, 0.04); root.add(m); return m;
    }
    tlLabel(String(y0), tl0 + 0.1, ty + 0.38, AMBER_DIM);
    tlLabel(String(y1), tl1 - 0.1, ty + 0.5, AMBER);
    var pm = kit.neonText("4TH POOM", { font: F.display, weight: "700", height: 0.115, color: T.amber, glow: 18, core: 0.5, align: "right", letterSpacing: 8 });
    pm.position.set(tl1 + 0.12, ty + 0.72, 0.04); root.add(pm);
    var spark = kit.glowSprite(AMBER, 0.55, 0.9); spark.position.set(tl0, ty, 0.06); spark.visible = false; root.add(spark);
    R.spark = spark; R.tl0 = tl0; R.tlen = tlen;

    /* ----- light shafts + haze ----- */
    var shaftA = buildShaft(kit, 0.3, 1.1, 6.3, low ? 0.07 : 0.09); shaftA.position.set(CX, 0, CZ); root.add(shaftA);
    var shaftB = buildShaft(kit, 0.3, 1.2, 5.8, low ? 0.06 : 0.08); shaftB.position.set(FX, DAIS, FZ); root.add(shaftB);
    R.shafts = [shaftA, shaftB];
    var dust = buildDust(kit, low ? 36 : 90, [{ x: CX, z: CZ, r: 0.8 }, { x: FX, z: FZ, r: 0.9 }], 0.1, 4.4);
    root.add(dust.points); R.dust = dust;

    /* ----- optional kick video ----- */
    if (media.kickVideo) {
      try {
        var v = document.createElement("video");
        v.src = base + media.kickVideo; v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute("playsinline", "");
        var vt = new THREE.VideoTexture(v); vt.encoding = THREE.sRGBEncoding;
        var vm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: vt, color: kit.color("#c8c8d0") }));
        vm.position.set(FX, 4.15, 0.05); root.add(vm);
        var vf = kit.neonTube(chamferPts(0.82, 0.47, 0.05, 0, 0.055, "xy").map(function (p) { p.x += FX; p.y += 4.15; return p; }), { closed: true, radius: 0.008, color: T.amber, intensity: 1.6 });
        root.add(vf);
        R.video = v;
      } catch (e) { R.video = null; }
    }

    /* ----- initial pose ----- */
    R.pose.set(READY); rig.apply(R.pose);
    if (reduced) { R.pose.set(RH_EXT); rig.apply(R.pose); }
    updateTicks(true);

    return Promise.resolve(load).then(function (tex) { slab.setPhoto(tex); }).catch(function () { /* keep the printed fallback */ });
  }

  function updateTicks(force) {
    var s = R, lit = Math.floor(s.tlP * (s.count - 1) + 0.0001);
    if (!force && lit === s.tlLit) return;
    s.tlLit = lit;
    for (var k = 0; k < s.count - 1; k++) s.ticks.setColorAt(k, k < lit ? s.cLit : s.cUnlit);
    if (s.ticks.instanceColor) s.ticks.instanceColor.needsUpdate = true;
  }

  function playRound() {
    var s = R; if (!s) return;
    s.flash = 1; s.glitch = 1;
    if (s.reduced) return;
    s.clip = RH_CLICK; s.clipT = 0;
  }

  function phaseOf(clip, time) {
    if (clip === RH_CLICK) return time > 0.3 && time < 3.0 ? 2 : 0;
    if (clip === FULL) return time > 1.0 && time < 3.1 ? 1 : (time > 4.3 && time < 7.4 ? 2 : 0);
    return 0;
  }

  function driveFighter(dt, t, active, camera) {
    var s = R, rig = s.rig, P = s.pose, i;
    rig.mat.uniforms.uT.value = t;
    rig.mat.uniforms.uBoost.value = Math.max(0, s.flash) * 0.7;
    if (s.reduced) {
      if (!s.staticDone) {
        P.set(RH_EXT); rig.apply(P);
        rig.updateTrail(camera, IM, IM_T0, IM_EXT, P, true);
        s.staticDone = true;
      } else rig.updateTrail(camera, IM, IM_T0, IM_EXT, P, false);
      return;
    }
    if (s.clip) {
      s.clipT += dt;
      if (s.clipT >= s.clip.dur) {
        if (s.clip === FULL && active) s.clipT -= FULL.dur;
        else if (s.clip === RH_CLICK && active) { s.clip = FULL; s.clipT = 0; }
        else { s.clip = null; s.clipT = 0; }
      }
    }
    if (!s.clip && active) { s.clip = FULL; s.clipT = 0; }
    if (s.clip) {
      evalClip(s.clip, s.clipT, P);
      breathe(P, t, 0.6);
      var inWin = false, w = s.clip.wins;
      for (i = 0; i < w.length; i++) if (s.clipT >= w[i][0] && s.clipT <= w[i][1]) inWin = true;
      if (inWin) rig.updateTrail(camera, s.clip, Math.max(0, s.clipT - 0.5), s.clipT, P, true);
      else { rig.apply(P); rig.hideTrail(); }
      var ph = phaseOf(s.clip, s.clipT);
      if (ph !== s.phase) { s.phase = ph; for (i = 0; i < s.names.length; i++) s.names[i].visible = i === ph; }
    } else {
      P.set(READY); breathe(P, t, 1);
      rig.apply(P); rig.hideTrail();
      if (s.phase !== 0) { s.phase = 0; for (i = 0; i < s.names.length; i++) s.names[i].visible = i === 0; }
    }
  }

  /* =====================================================================
     IMMERSIVE: "13 Years, One Kick"
     ===================================================================== */
  function mountImmersive(scroller, ctx) {
    var kit = ctx.kit || HH.kit, T = HH.THEME, F = HH.FONTS;
    var low = ctx.quality === "low";
    var ex = ctx.exhibit || {}, facts = ex.facts || {}, media = ex.media || {};
    kit.injectUICSS();
    var ip = dateParts(facts.issued), issued = fmtDate(facts.issued);
    var y0 = num(facts.since, 2013), y1 = ip ? ip.y : y0 + num(facts.years, 13);
    var years = num(facts.years, y1 - y0);
    var br = (facts.birthRate || []).filter(function (r) { return r && isFinite(+r.tfr); });
    var tfrTitle = br.length ? br.map(function (r) { return (+r.tfr).toFixed(2) + " (" + r.year + ")"; }).join(" · ") : "0.72 (2023) · 0.75 (2024)";
    var tfr1 = br[0] ? (+br[0].tfr).toFixed(2) : "0.72", tfr2 = br[1] ? (+br[1].tfr).toFixed(2) : "0.75";
    var tfrY1 = br[0] ? String(br[0].year) : "2023", tfrY2 = br[1] ? String(br[1].year) : "2024";
    var genZ = str((ctx.site || HH.SITE || {}).genZ) || "Generation Z · born 1997–2012";
    var EXT_P = 0.42;

    var rig = null, mat = null, shaft = null, dust = null, ringMesh = null, ringMat = null, slab = null, bb = {}, zeroRing = null;
    var litRing = -1, dead = false, lastYr = -1, lastFrame = -1;
    var look = new THREE.Vector3(), pose = new Float32Array(NP), RN = 14;
    var dummy = new THREE.Object3D(); dummy.rotation.order = "YXZ";
    var yrEl = null, frEl = null;

    function win(p, a, b, c, d) { return ss(a, b, p) * (1 - ss(c, d, p)); }
    function setOp(m, a) { m.material.opacity = a; m.visible = a > 0.01; }
    function facing(m, cam) { m.rotation.y = Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z); }
    var cOff = kit.color(T.violet, 0.45), cOn = kit.color(T.amber, 1.2), cEnd = kit.color(T.amber, 2.0);

    var chapters = [
      { at: 0.0, side: "left", kicker: String(y0), title: "First class" },
      { at: 0.2, side: "left", kicker: y0 + " → " + y1, title: years + " years", html: '<div class="hh-r6-yr">' + y0 + "</div>" },
      { at: 0.4, side: "left", kicker: "KUKKIWON", title: "4th Poom", body: issued ? "Certificate issued " + issued + "." : "" },
      { at: 0.6, side: "left", kicker: "KOREA · TOTAL FERTILITY RATE", title: tfrTitle, body: "Source: Statistics Korea." },
      { at: 0.8, side: "left", kicker: "MACHINE TIME", title: "0 seconds" },
      { at: 1.0, side: "left", kicker: "END OF THE MUSEUM", title: genZ,
        html: '<div style="margin-top:16px"><button type="button" class="hh-btn amber" data-r6-back style="pointer-events:auto">Back to the museum</button></div>' }
    ];

    var stage = kit.immersiveStage(scroller, {
      length: 6, chapters: chapters,
      setup: function (s) {
        var scene = s.scene;
        scene.fog = new THREE.FogExp2(kit.color(T.void), 0.05);
        s.camera.fov = 42; s.camera.updateProjectionMatrix();
        rig = buildFighter(kit, low); rig.root.position.y = MAT_TOP; scene.add(rig.root);
        mat = buildMat(kit, 3.6); scene.add(mat.group);
        var g1 = flatGlow(kit, AMBER, 6.0, 0.2); g1.position.y = 0.012; scene.add(g1);
        shaft = buildShaft(kit, 0.25, 1.9, 5.8, 0.075); scene.add(shaft);
        dust = buildDust(kit, low ? 40 : 110, [{ x: 0, z: 0, r: 1.5 }], 0.1, 5.2); scene.add(dust.points);

        /* 14-tick year ring on the floor */
        var geo = new THREE.PlaneGeometry(0.05, 0.3);
        ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        ringMat.toneMapped = false;
        ringMesh = new THREE.InstancedMesh(geo, ringMat, RN);
        for (var i = 0; i < RN; i++) {
          var a = i / RN * PI * 2 - PI / 2, r = 2.55;
          dummy.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
          dummy.rotation.set(-PI / 2, Math.atan2(-Math.cos(a), -Math.sin(a)), 0);
          dummy.scale.set(1, i === RN - 1 ? 1.5 : 1, 1);
          dummy.updateMatrix(); ringMesh.setMatrixAt(i, dummy.matrix); ringMesh.setColorAt(i, kit.color(T.violet, 0.5));
        }
        ringMesh.instanceMatrix.needsUpdate = true; scene.add(ringMesh);

        /* billboards */
        function mkBB(text, o, x, y, z) { var m = kit.neonText(text, o); m.position.set(x, y, z); m.material.opacity = 0; m.visible = false; scene.add(m); return m; }
        bb.y13 = mkBB(String(y0), { font: F.neon, height: 1.1, color: T.amber, glow: 34, core: 0.5, letterSpacing: 8 }, 1.9, 1.5, -2.9);
        bb.t1 = mkBB(tfr1, { font: F.neon, height: 0.55, color: T.amber, glow: 24, core: 0.5, letterSpacing: 4 }, -0.8, 2.85, -1.3);
        bb.t2 = mkBB(tfr2, { font: F.neon, height: 0.55, color: T.amber, glow: 24, core: 0.5, letterSpacing: 4 }, -0.8, 2.1, -1.3);
        bb.l1 = mkBB(tfrY1, { font: F.mono, weight: "500", height: 0.1, color: AMBER_DIM, glow: 6, core: 0.2, letterSpacing: 12 }, -0.8, 2.5, -1.3);
        bb.l2 = mkBB(tfrY2, { font: F.mono, weight: "500", height: 0.1, color: AMBER_DIM, glow: 6, core: 0.2, letterSpacing: 12 }, -0.8, 1.75, -1.3);
        bb.zero = mkBB("0", { font: F.neon, height: 1.0, color: T.cyan, glow: 30, core: 0.5 }, -1.0, 0.62, -2.2);
        bb.zl = mkBB("SECONDS", { font: F.mono, weight: "500", height: 0.14, color: CYAN_DIM, glow: 8, core: 0.2, letterSpacing: 18 }, -1.0, 0.1, -2.2);
        var zm = new THREE.MeshBasicMaterial({ color: kit.color(T.cyan, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide });
        zm.toneMapped = false;
        zeroRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 96).rotateX(-PI / 2), zm); zeroRing.position.y = 0.06; zeroRing.visible = false; scene.add(zeroRing);

        /* the certificate returns as a hologram at the full extension */
        slab = buildSlab(kit, null);
        slab.group.position.set(-2.3, 1.5, -1.4); slab.group.scale.setScalar(0.85); slab.setAlpha(0); scene.add(slab.group);
        var url = media.certificate ? (ctx.assetBase || "") + media.certificate : "";
        if (url && ctx.loadTexture) ctx.loadTexture(url).then(function (tex) { if (!dead && slab) slab.setPhoto(tex); }).catch(function () {});

        s.camera.position.set(1.2, 1.1, 4.8);
      },
      frame: function (p, dt, t, s) {
        if (!rig) return;
        /* ---- slow-motion roundhouse ---- */
        var pk = ss(0.18, EXT_P, p) * (1 - ss(0.5, 0.66, p));
        var pkMax = ss(0.18, EXT_P, p);
        evalClip(IM, pk * IM_EXT, pose);
        breathe(pose, t, 1 - pk);
        rig.mat.uniforms.uT.value = t;
        rig.mat.uniforms.uBoost.value = 0.5 * Math.max(0, 1 - Math.abs(p - 0.45) * 8);
        rig.trailMul = 1 - ss(0.62, 0.8, p);
        var tMax = pkMax * IM_EXT;
        if (tMax > IM_T0 + 0.2 && rig.trailMul > 0.01) rig.updateTrail(s.camera, IM, IM_T0, tMax, pose, true);
        else { rig.apply(pose); rig.hideTrail(); }

        /* ---- camera: bullet-time orbit ---- */
        var aspect = s.camera.aspect || 1.6;
        var phi = 0.25 + 1.35 * ss(0.12, 0.4, p) + 0.25 * ss(0.4, 0.52, p) - 1.1 * ss(0.55, 0.8, p) - 0.15 * ss(0.85, 1.0, p);
        var Rr = 5.0 - 0.7 * ss(0.2, 0.42, p) + 0.5 * ss(0.5, 0.62, p) - 1.3 * ss(0.66, 0.78, p) + 3.2 * ss(0.86, 1.0, p);
        var hh = 1.1 + 0.3 * ss(0.2, 0.42, p) - 0.15 * ss(0.5, 0.6, p) + 2.1 * ss(0.66, 0.78, p) - 1.7 * ss(0.84, 1.0, p);
        var narrow = 1 + clamp((1 - aspect) / 0.55, 0, 1) * 1.2;
        Rr *= narrow;
        var ly = 0.92 - 0.45 * ss(0.66, 0.78, p) + 0.35 * ss(0.86, 1.0, p);
        var shiftX = (aspect > 1.3 ? 0.8 : 0) * (Rr / 5);
        s.camera.position.set(Math.sin(phi) * Rr, hh, Math.cos(phi) * Rr);
        look.set(Math.cos(phi) * shiftX, ly, -Math.sin(phi) * shiftX + 0.1);
        s.camera.lookAt(look);
        var fov = 44 - 8 * win(p, 0.3, 0.42, 0.5, 0.62);
        if (Math.abs(s.camera.fov - fov) > 0.02) { s.camera.fov = fov; s.camera.updateProjectionMatrix(); }
        if (s.pipeline && s.pipeline.bloom) s.pipeline.bloom.strength = 0.9 + 0.45 * win(p, 0.34, 0.42, 0.5, 0.62) - 0.2 * win(p, 0.7, 0.78, 0.9, 0.96);

        /* ---- beats ---- */
        var a13 = win(p, -0.1, 0.0, 0.08, 0.22);
        setOp(bb.y13, a13); if (bb.y13.visible) facing(bb.y13, s.camera);
        var aT = win(p, 0.5, 0.58, 0.68, 0.76);
        setOp(bb.t1, aT); setOp(bb.t2, aT); setOp(bb.l1, aT); setOp(bb.l2, aT);
        if (aT > 0.01) { facing(bb.t1, s.camera); facing(bb.t2, s.camera); facing(bb.l1, s.camera); facing(bb.l2, s.camera); }
        var aZ = win(p, 0.68, 0.76, 0.85, 0.9);
        setOp(bb.zero, aZ); setOp(bb.zl, aZ);
        if (aZ > 0.01) { facing(bb.zero, s.camera); facing(bb.zl, s.camera); }
        zeroRing.visible = aZ > 0.01; zeroRing.material.opacity = aZ;
        var zs = 2.2 * (1 - ss(0.72, 0.86, p)); zeroRing.scale.set(zs + 0.001, 1, zs + 0.001);
        var aC = win(p, 0.28, 0.4, 0.5, 0.62);
        slab.setAlpha(aC);
        if (aC > 0.01) {
          slab.group.rotation.y = Math.atan2(s.camera.position.x - slab.group.position.x, s.camera.position.z - slab.group.position.z) * 0.6 + 0.25;
          slab.group.position.y = 1.5 + 0.04 * Math.sin(t * 0.7);
          slab.glass.uniforms.uT.value = t; slab.holo.uniforms.uT.value = t;
          slab.holo.uniforms.uPos.value = -0.25 + 1.9 * ss(0.3, 0.52, p);
          slab.holo.uniforms.uGl.value = Math.max(0, 1 - Math.abs(p - 0.34) * 30);
        }
        /* year ring lights up with the counter */
        var yrP = ss(0.1, 0.32, p), lit = Math.floor(yrP * RN + 0.0001);
        if (lit !== litRing) {
          litRing = lit;
          for (var k = 0; k < RN; k++) ringMesh.setColorAt(k, k < lit ? (k === RN - 1 ? cEnd : cOn) : cOff);
          ringMesh.instanceColor.needsUpdate = true;
        }
        ringMat.opacity = ss(0.06, 0.16, p) * (1 - 0.6 * win(p, 0.45, 0.6, 0.7, 0.8));
        var yv = y0 + Math.round((y1 - y0) * yrP);
        if (yrEl && yv !== lastYr) { lastYr = yv; yrEl.textContent = yv; }
        var fr = Math.round(p * 999);
        if (frEl && fr !== lastFrame) { lastFrame = fr; frEl.textContent = "FRAME " + ("000" + fr).slice(-4); }
        /* cyan beat: the amber light steps back, the only cyan appears */
        shaft.material.uniforms.uK.value = 0.075 * (1 - 0.7 * win(p, 0.7, 0.78, 0.86, 0.92)) + 0.04 * ss(0.9, 1.0, p);
        shaft.material.uniforms.uT.value = t;
        dust.update(dt, t);
      }
    });
    yrEl = scroller.querySelector(".hh-r6-yr");

    kit.injectCSS("hh-r6-css", [
      ".hh-stage .hh-ch-k{color:" + T.amber + "}",
      ".hh-stage .hh-stage-bar{background:linear-gradient(90deg," + T.amber + ",#ff7a3f)}",
      ".hh-stage .hh-r6-yr{margin-top:8px;font:500 clamp(56px,12vw,128px)/1 " + F.mono + ";color:" + T.amber + ";text-shadow:0 0 28px rgba(255,178,63,.55);letter-spacing:.02em;font-variant-numeric:tabular-nums}",
      ".hh-r6-hud{position:absolute;inset:0;pointer-events:none;font:500 11px/1.4 " + F.mono + ";letter-spacing:.2em;color:#e09a35;text-transform:uppercase}",
      ".hh-r6-hud i{position:absolute;width:24px;height:24px;border:2px solid rgba(255,178,63,.8)}",
      ".hh-r6-hud i.tl{left:max(14px,2vw);top:max(14px,2vh);border-right:0;border-bottom:0}",
      ".hh-r6-hud i.tr{right:max(14px,2vw);top:max(14px,2vh);border-left:0;border-bottom:0}",
      ".hh-r6-hud i.bl{left:max(14px,2vw);bottom:max(14px,2vh);border-right:0;border-top:0}",
      ".hh-r6-hud i.br{right:max(14px,2vw);bottom:max(14px,2vh);border-left:0;border-top:0}",
      ".hh-r6-hud b{position:absolute;font-weight:500}",
      ".hh-r6-hud .a{left:calc(max(14px,2vw) + 34px);top:calc(var(--top, 0px) + 66px)}",
      ".hh-r6-hud .b{right:calc(max(14px,2vw) + 34px);top:calc(var(--top, 0px) + 66px)}",
      ".hh-r6-hud .c{left:calc(max(14px,2vw) + 34px);bottom:calc(max(14px,2vh) + 22px);color:#9aa0de}",
      ".hh-r6-hud .d{left:calc(max(14px,2vw) + 34px);bottom:calc(max(14px,2vh) + 4px)}",
      "@media (max-width:560px){.hh-r6-hud{font-size:9px;letter-spacing:.14em}}"
    ].join("\n"));
    var pin = stage.stage && stage.stage.root ? stage.stage.root.querySelector(".hh-stage-pin") : null;
    if (pin) {
      var hud = document.createElement("div"); hud.className = "hh-r6-hud";
      hud.innerHTML = '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>' +
        '<b class="a">MOTION CAPTURE</b><b class="b">SYS · CH 06</b><b class="c">ROUNDHOUSE KICK · SLOW MOTION</b><b class="d" data-fr>FRAME 0000</b>';
      pin.appendChild(hud);
      frEl = hud.querySelector("[data-fr]");
    }
    /* recolor the machine chapter kicker (the only cyan) */
    var kick = stage.stage && stage.stage.root ? stage.stage.root.querySelectorAll(".hh-ch-k") : [];
    if (kick[4]) kick[4].style.color = T.cyan;
    function onClick(e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-r6-back]") : null;
      if (el) window.dispatchEvent(new CustomEvent("hh:close-immersive"));
    }
    scroller.addEventListener("click", onClick);

    return {
      destroy: function () {
        dead = true;
        scroller.removeEventListener("click", onClick);
        stage.destroy();
      }
    };
  }

  /* =====================================================================
     ROOM DEFINITION
     ===================================================================== */
  HH.registerRoom(6, {
    build: function (ctx) { return build(ctx); },

    enter: function (ctx) {
      var s = R; if (!s) return;
      s.active = true;
      s.holoT0 = s.clock; s.glitch = 1; s.flash = 0.6;
      if (!s.reduced) { s.clip = FULL; s.clipT = 0; s.tlP = 0; s.tlGo = true; updateTicks(true); }
      if (s.video) { try { var pr = s.video.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
    },

    leave: function (ctx) {
      var s = R; if (!s) return;
      s.active = false; s.clip = null; s.clipT = 0;
      if (s.video) { try { s.video.pause(); } catch (e) {} }
    },

    update: function (ctx, dt, t, state) {
      var s = R; if (!s) return;
      dt = Math.min(dt || 0, 0.1);
      if (state && state.visible === false) return;
      s.clock += dt; s.t = t;
      var active = s.active && (!state || state.active !== false);
      var cam = ctx.camera;

      /* certificate: slow turn, float, holo sweep with a glitch burst at the start */
      var slab = s.slab, ct = s.clock - s.holoT0, cyc, pos, gl;
      if (s.reduced) {
        slab.group.rotation.y = 0.05; slab.group.position.y = s.certBase; pos = 1.22; gl = 0;
      } else {
        slab.group.rotation.y = 0.06 + Math.sin(s.clock * 0.35) * 0.07;
        slab.group.position.y = s.certBase + Math.sin(s.clock * 0.6) * 0.02;
        cyc = (s.clock % 7.0);
        pos = -0.3 + 2.0 * Math.min(1, cyc / 4.6);
        gl = Math.max(Math.exp(-Math.pow((cyc - 0.15) / 0.12, 2)), Math.exp(-Math.pow((cyc - 2.3) / 0.07, 2)) * 0.8);
        if (ct >= 0 && ct < 1.6) { pos = -0.3 + 2.0 * Math.min(1, ct / 1.4); gl = Math.max(gl, Math.exp(-Math.pow(ct / 0.2, 2))); }
        s.glitch = Math.max(0, s.glitch - dt * 2.5);
        gl = Math.max(gl, s.glitch * 0.8);
      }
      slab.holo.uniforms.uT.value = s.clock; slab.holo.uniforms.uPos.value = pos; slab.holo.uniforms.uGl.value = gl;
      slab.glass.uniforms.uT.value = s.clock;

      /* fighter */
      driveFighter(dt, s.clock, active, cam);

      /* timeline paint on enter */
      if (s.tlGo && !s.reduced) {
        s.tlP = Math.min(1, s.tlP + dt / 2.6);
        if (s.tlP >= 1) s.tlGo = false;
        updateTicks(false);
      }
      var shown = s.tlP > 0.001;
      s.prog.visible = shown; s.prog.scale.x = Math.max(0.0001, s.tlP);
      s.spark.visible = s.tlGo && shown; s.spark.position.x = s.tl0 + s.tlen * s.tlP;

      /* small life: REC blink, sign pulse, shafts, haze */
      s.flash = Math.max(0, s.flash - dt * 1.6);
      s.rec.material.opacity = s.reduced ? 1 : (Math.sin(s.clock * 3.2) > -0.2 ? 1 : 0.25);
      s.sign.material.opacity = s.reduced ? 1 : 0.88 + 0.12 * Math.sin(s.clock * 2.2) + s.flash * 0.3;
      s.shafts[0].material.uniforms.uT.value = s.clock; s.shafts[1].material.uniforms.uT.value = s.clock;
      if (!s.reduced) s.dust.update(dt, s.clock);
    },

    panel: function (el, ctx) {
      var ex = (ctx && ctx.exhibit) || {}, f = ex.facts || {}, esc = HH.kit.esc, T = HH.THEME;
      if (!el) return;
      var rows = [];
      if (f.since) rows.push(["Since", String(f.since)]);
      var d = fmtDate(f.issued); if (d) rows.push(["Issued", d]);
      if (!rows.length) return;
      el.innerHTML = '<div class="hh-sec"><div class="hh-h">Timeline</div><div class="hh-list">' + rows.map(function (r) {
        return '<div class="hh-row hh-mono" style="justify-content:space-between;border-left:2px solid ' + T.amber + ';padding:1px 0 1px 11px;font-size:13px">' +
          '<span style="color:' + T.dim + '">' + esc(r[0]) + '</span><span style="color:' + T.amber + '">' + esc(r[1]) + "</span></div>";
      }).join("") + "</div></div>";
    },

    immersive: {
      title: "13 Years, One Kick",
      cta: "Step inside: one kick",
      mount: function (scroller, ctx) { return mountImmersive(scroller, ctx); }
    }
  });
})();
