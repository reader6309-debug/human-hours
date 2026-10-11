/* Human Hours · engine
   Corridor, walking camera, rooms, wall label, audio guide, overlays, flat page fallback. */
(function () {
  "use strict";
  var HH = window.HH, kit = HH.kit, T = HH.THEME, L = HH.LAYOUT, EX = HH.EXHIBITS, SITE = HH.SITE;
  var $ = function (id) { return document.getElementById(id); };
  var esc = kit.esc;

  var dbg = window.__hh = { ready: false, errors: [], stop: 0, walking: false, quality: "", fps: 0 };
  window.addEventListener("error", function (e) { dbg.errors.push(String(e.message || e)); });
  window.addEventListener("unhandledrejection", function (e) { dbg.errors.push("promise: " + (e.reason && e.reason.message || e.reason)); });

  /* ---------- environment ---------- */
  var coarse = matchMedia("(pointer: coarse)").matches;
  var quality = (coarse || Math.min(innerWidth, innerHeight) < 600) ? "low" : "high";
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var draft = !!HH.DRAFT_MODE;
  if (!draft) document.body.classList.add("hh-final");
  dbg.quality = quality;
  var store = {
    get: function (k) { try { return localStorage.getItem("hh2." + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("hh2." + k, v); } catch (e) {} }
  };

  /* ---------- stops ---------- */
  var END_Z = L.firstZ - (EX.length - 1) * L.spacing - 12;   // end wall
  var START_Z = 9;                                            // lobby back wall
  var STOPS = [{ kind: "lobby", key: "L", name: "Lobby" }];
  EX.forEach(function (ex) { STOPS.push({ kind: "room", n: ex.n, ex: ex, key: pad(ex.n), name: ex.room }); });
  STOPS.push({ kind: "exit", key: "E", name: "Exit" });
  var ROOM_STOP = function (n) { return n; };   // stop index of room n
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function roomZ(n) { return L.firstZ - (n - 1) * L.spacing; }

  /* Step back far enough that the room (about 9.4 m wide) fits the part of the screen the label leaves free. */
  function viewDist() {
    var W = innerWidth, H = innerHeight, wide = W > 760;
    var perM = 2 * Math.tan(THREE.MathUtils.degToRad(fovFor()) / 2) * (W / H);
    var panel = Math.min(450, Math.max(340, 0.31 * W)) + 36;
    var free = wide ? Math.max(0.42, (W - panel) / W) : 1;
    return kit.clamp((wide ? 9.4 : 7.4) / (perM * free), L.viewDist, wide ? 9.8 : 11);
  }
  function stopView(i) {
    var s = STOPS[i];
    if (s.kind === "lobby") return { pos: new THREE.Vector3(0, L.eye, 8.4), look: new THREE.Vector3(0, 3.2, -8) };
    if (s.kind === "exit") return { pos: new THREE.Vector3(0, L.eye, END_Z + 9), look: new THREE.Vector3(0, 2.6, END_Z) };
    var side = s.ex.side, z = roomZ(s.n), d = viewDist();
    return { pos: new THREE.Vector3(side * (L.wallX - d), L.eye, z), look: new THREE.Vector3(side * L.wallX, 2.15, z) };
  }

  /* ---------- boot UI ---------- */
  function boot(p, msg) { $("bootBar").style.width = Math.round(p * 100) + "%"; if (msg) $("bootStep").textContent = msg; }

  /* ---------- three ---------- */
  var renderer, scene, camera, pipe, reflector = null, floorTop = null;
  var clock = { t: 0, last: performance.now() };
  var raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll();
  var rooms = [];          // { n, ex, def, anchor, ctx, clickables, bay, sign, active, built, near }
  var bayPlanes = [];
  var signs = [];
  var guideMat = null, dustMat = null;
  var paused = false;

  function initRenderer() {
    var canvas = $("scene");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 1.5 : 1.25));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.setClearColor(kit.color(T.void), 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(kit.color(T.void), 0.028);
    camera = new THREE.PerspectiveCamera(fovFor(), innerWidth / innerHeight, 0.05, 140);
    camera.layers.enable(1);
    pipe = kit.createPipeline(renderer, scene, camera, quality === "low" ? { bloomStrength: 0.8, bloomRadius: 0.4 } : {});
    addFilmPass();
    renderer.info.autoReset = false;
  }
  /* Film finish: fine grain (heavier in the shadows), a hair of lens fringing at the edges,
     soft vignette. Keeps the neon from looking like clean CG. */
  var film = null;
  function addFilmPass() {
    if (!THREE.ShaderPass) return;
    film = new THREE.ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
        uGrain: { value: quality === "low" ? 0.035 : 0.05 }, uCA: { value: quality === "low" ? 0.0 : 0.0028 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uGrain; uniform float uCA; varying vec2 vUv;",
        "float h(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }",
        "void main(){",
        "  vec2 d = vUv - 0.5; float r2 = dot(d, d);",
        "  vec2 off = d * uCA * r2 * 4.0;",
        "  vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);",
        "  float l = dot(c, vec3(0.299, 0.587, 0.114));",
        "  float n = h(floor(vUv * uRes) + floor(uTime * 24.0) * 17.0) - 0.5;",
        "  c += n * uGrain * (1.0 - 0.7 * l);",
        "  c *= 1.0 - 0.32 * smoothstep(0.18, 0.62, r2 * 1.35);",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n")
    });
    pipe.composer.addPass(film);
  }
  function fovFor() { var a = innerWidth / innerHeight; return a < 0.8 ? 62 : a < 1.25 ? 58 : 54; }

  /* ---------- corridor ---------- */
  function buildCorridor() {
    var len = START_Z - END_Z, zc = (START_Z + END_Z) / 2, W = L.wallX * 2, H = L.ceiling;

    // floor
    var floorTex = kit.canvasTexture(512, 512, function (g, w, h) {
      g.fillStyle = "#06081a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,110,255,0.10)"; g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.strokeStyle = "rgba(120,110,255,0.05)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(W / 3, len / 3);
    if (quality === "high" && THREE.Reflector) {
      var pr = renderer.getPixelRatio();
      reflector = new THREE.Reflector(new THREE.PlaneGeometry(W, len), {
        clipBias: 0.003, color: 0x7a7a8c,
        textureWidth: Math.round(innerWidth * pr * 0.5), textureHeight: Math.round(innerHeight * pr * 0.5)
      });
      reflector.rotation.x = -Math.PI / 2; reflector.position.set(0, 0, zc);
      scene.add(reflector);
      floorTop = new THREE.Mesh(new THREE.PlaneGeometry(W, len), new THREE.MeshStandardMaterial({
        map: floorTex, color: kit.color("#9aa0c8"), roughness: 0.45, metalness: 0.25, transparent: true, opacity: 0.8
      }));
      floorTop.position.y = 0.004;
    } else {
      floorTop = new THREE.Mesh(new THREE.PlaneGeometry(W, len), new THREE.MeshStandardMaterial({
        map: floorTex, color: kit.color("#9aa0c8"), roughness: 0.3, metalness: 0.65
      }));
    }
    floorTop.rotation.x = -Math.PI / 2; floorTop.position.z = zc;
    scene.add(floorTop);

    // walls: dark navy panels with seams
    var wallTex = kit.canvasTexture(1024, 512, function (g, w, h) {
      var gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#080b24"); gr.addColorStop(0.55, "#0b1030"); gr.addColorStop(1, "#070a1f");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.025)";
      for (var i = 0; i < 4; i++) g.fillRect(i * w / 4, 0, 2, h);
      g.fillStyle = "rgba(160,140,255,0.05)";
      g.fillRect(0, h * 0.11, w, 1); g.fillRect(0, h * 0.9, w, 1);
      g.font = "500 11px " + HH.FONTS.mono; g.fillStyle = "rgba(160,150,255,0.18)";
      for (var j = 0; j < 4; j++) g.fillText("HH-" + (2050 + j) + " · PANEL " + pad(j + 1), j * w / 4 + 14, h * 0.88);
    });
    wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(len / 12, 1);
    var wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.15 });
    [-1, 1].forEach(function (s) {
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
      wall.position.set(s * L.wallX, H / 2, zc);
      wall.rotation.y = -s * Math.PI / 2;
      scene.add(wall);
    });
    var endMat = new THREE.MeshStandardMaterial({ color: kit.color("#090c26"), roughness: 0.75, metalness: 0.1 });
    var back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), endMat);
    back.position.set(0, H / 2, START_Z); back.rotation.y = Math.PI; scene.add(back);
    var end = new THREE.Mesh(new THREE.PlaneGeometry(W, H), endMat);
    end.position.set(0, H / 2, END_Z); scene.add(end);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, len), new THREE.MeshStandardMaterial({ color: kit.color("#04050f"), roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, zc); scene.add(ceil);

    scene.add(new THREE.HemisphereLight(kit.color("#3a2c8f"), kit.color("#04050c"), 0.32));

    buildNeonLines(len, zc);
    buildGuideLine(len, zc);
    buildDust(len, zc);
    buildLobby();
    buildExitWall();
  }

  /* All straight neon structure lines in one instanced draw call. */
  function buildNeonLines(len, zc) {
    var bars = [];
    function bar(x, y, z, sx, sy, sz, hex, k) { bars.push({ p: [x, y, z], s: [sx, sy, sz], c: kit.color(hex, k) }); }
    var X = L.wallX - 0.02;
    [-1, 1].forEach(function (s) {
      bar(s * X, 0.09, zc, 0.025, 0.025, len, T.purple, 1.15);           // baseboard
      bar(s * X, L.ceiling - 0.16, zc, 0.025, 0.025, len, T.purple, 0.9);  // cornice
    });
    // vertical seams between rooms (both walls), plus lobby/exit ends
    var zs = [];
    for (var n = 0; n <= EX.length; n++) zs.push(roomZ(1) + L.spacing / 2 - n * L.spacing);
    zs.forEach(function (z) {
      [-1, 1].forEach(function (s) { bar(s * X, L.ceiling / 2, z, 0.025, L.ceiling - 0.3, 0.025, T.purple, 1.0); });
    });
    // ceiling light bars
    for (var z = START_Z - 2; z > END_Z + 2; z -= 6) {
      [-1.7, 1.7].forEach(function (x) { bar(x, L.ceiling - 0.04, z - 2, 0.06, 0.02, 3.6, T.violet, 0.95); });
    }
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.toneMapped = false;
    var mesh = new THREE.InstancedMesh(geo, mat, bars.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    bars.forEach(function (b, i) {
      m4.compose(new THREE.Vector3().fromArray(b.p), q, new THREE.Vector3().fromArray(b.s));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, b.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  /* Floor time-line: amber (human) at the lobby, cold cyan deep inside, amber again at the last room. */
  function buildGuideLine(len, zc) {
    var c = function (h) { return kit.color(h); };
    guideMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uWalk: { value: 0 }, uZ0: { value: START_Z }, uZ1: { value: END_Z },
        cA: { value: c(T.amber) }, cV: { value: c(T.violet) }, cC: { value: c(T.cyan) }
      },
      vertexShader: "varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: [
        "uniform float uTime; uniform float uWalk; uniform float uZ0; uniform float uZ1;",
        "uniform vec3 cA; uniform vec3 cV; uniform vec3 cC; varying vec3 vW; varying vec2 vUv;",
        "void main(){",
        "  float t = clamp((vW.z - uZ0) / (uZ1 - uZ0), 0.0, 1.0);",
        "  vec3 col = mix(cA, cV, smoothstep(0.05, 0.36, t));",
        "  col = mix(col, cC, smoothstep(0.4, 0.62, t));",
        "  col = mix(col, cA, smoothstep(0.78, 0.86, t));",
        "  float dash = smoothstep(0.82, 1.0, fract(vW.z * 0.22 + uTime * (0.25 + 1.4 * uWalk)));",
        "  float edge = smoothstep(0.0, 0.7, 1.0 - abs(vUv.x * 2.0 - 1.0));",
        "  float fade = smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.985, 1.0, t));",
        "  gl_FragColor = vec4(col * (0.5 + 0.7 * dash) * edge * fade * 1.25, 1.0);",
        "}"
      ].join("\n")
    });
    guideMat.toneMapped = false;
    var line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, len), guideMat);
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.008, zc);
    scene.add(line);
  }

  function buildDust(len, zc) {
    var count = quality === "high" ? 900 : 320;
    var r = kit.rand(7), pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      pos[i * 3] = (r() * 2 - 1) * (L.wallX - 0.4);
      pos[i * 3 + 1] = 0.2 + r() * (L.ceiling - 0.4);
      pos[i * 3 + 2] = END_Z + r() * len;
      seed[i] = r() * 100;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: kit.color("#b9b0ff") }, uScale: { value: renderer.getPixelRatio() * innerHeight * 0.5 } },
      vertexShader: [
        "attribute float seed; uniform float uTime; uniform float uScale; varying float vA;",
        "void main(){",
        "  vec3 p = position + vec3(sin(uTime*0.11+seed)*0.35, sin(uTime*0.07+seed*1.7)*0.45, cos(uTime*0.05+seed*0.6)*0.35);",
        "  vec4 mv = modelViewMatrix * vec4(p,1.0);",
        "  gl_PointSize = clamp(0.022 * uScale / -mv.z, 1.0, 6.0);",
        "  vA = 0.25 + 0.25 * sin(uTime*0.6 + seed*3.0);",
        "  vA *= 1.0 - smoothstep(18.0, 34.0, -mv.z);",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: "uniform vec3 uColor; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(uColor * a * vA, 1.0); }"
    });
    var pts = new THREE.Points(g, dustMat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  function addOnWall(mesh, side, z, y) {
    // places a plane mesh flat on a side wall, facing into the corridor
    mesh.position.set(side * (L.wallX - 0.03), y, z);
    mesh.rotation.y = -side * Math.PI / 2;
    scene.add(mesh);
    return mesh;
  }

  function buildLobby() {
    var archZ = 1.2, w = 9.2, h = 3.95;
    var pts = [new THREE.Vector3(-w / 2, 0.02, archZ), new THREE.Vector3(-w / 2, h, archZ), new THREE.Vector3(w / 2, h, archZ), new THREE.Vector3(w / 2, 0.02, archZ)];
    scene.add(kit.neonTube(pts, { color: T.purple, radius: 0.035, intensity: 1.5 }));
    var inner = pts.map(function (p) { return new THREE.Vector3(p.x * 0.97, Math.min(p.y, h - 0.14), archZ - 0.02); });
    scene.add(kit.neonTube(inner, { color: T.violet, radius: 0.012, intensity: 1.1 }));
    var human = kit.neonText("HUMAN", { height: 0.78, color: T.amber, font: HH.FONTS.display, weight: "700", glow: 30, letterSpacing: 10 });
    var hours = kit.neonText("HOURS", { height: 0.78, color: T.cyan, font: HH.FONTS.display, weight: "700", glow: 30, letterSpacing: 10 });
    var gap = 0.35;
    human.position.set(-(human.userData.size.w * 0.42 + gap / 2), 4.75, archZ);
    hours.position.set(hours.userData.size.w * 0.42 + gap / 2, 4.75, archZ);
    scene.add(human); scene.add(hours);
    signs.push({ meshes: [human, hours], z: archZ, powered: false, t: 0 });
    var wing = kit.neonText("GEN Z WING  ·  BORN 1997–2012", { height: 0.17, color: T.violet, font: HH.FONTS.mono, glow: 12, letterSpacing: 6 });
    wing.position.set(0, h - 0.36, archZ - 0.03); scene.add(wing);
    // lobby side walls: Stein quote + the question
    var q = kit.neonText(SITE.stein, { height: 0.32, color: T.violet, font: HH.FONTS.neon, glow: 22, maxWidthPx: 1500 });
    addOnWall(q, -1, -3.4, 3.3);
    var by = kit.neonText(SITE.steinBy.toUpperCase(), { height: 0.1, color: T.dim, font: HH.FONTS.mono, glow: 0, letterSpacing: 4 });
    addOnWall(by, -1, -3.4, 2.72);
    var qq = kit.neonText(SITE.question, { height: 0.34, color: T.amber, font: HH.FONTS.display, weight: "600", glow: 22 });
    addOnWall(qq, 1, -3.4, 3.3);
    var kr = kit.neonText("인간의 시간", { height: 0.3, color: T.violet, font: HH.FONTS.krDisplay, glow: 18 });
    addOnWall(kr, 1, -3.4, 2.7);
    var lp = new THREE.PointLight(kit.color("#7b3bff"), 1.2, 14, 1.6); lp.position.set(0, 4.2, archZ + 1.5); scene.add(lp);
  }

  function buildExitWall() {
    var z = END_Z + 0.03;
    var door = [new THREE.Vector3(-1.1, 0.02, z), new THREE.Vector3(-1.1, 2.7, z), new THREE.Vector3(1.1, 2.7, z), new THREE.Vector3(1.1, 0.02, z)];
    scene.add(kit.neonTube(door, { color: T.amber, radius: 0.03, intensity: 1.4 }));
    // through the exit door: dawn over Seoul (the one full-color photo in the museum)
    if (SITE.exitWindow) {
      kit.loadTexture(SITE.exitWindow).then(function (tex) {
        var a = tex.image && tex.image.width ? tex.image.width / tex.image.height : 16 / 9, w = 2.14, h = 2.64;
        tex.repeat.set((w / h) / a, 1); tex.offset.set((1 - tex.repeat.x) / 2 + 0.06, 0);
        var win = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: kit.color("#b8b4c4") }));
        win.position.set(0, 1.36, z - 0.01); scene.add(win);
      }).catch(function () {});
    }
    var exitT = kit.neonText("EXIT  출구", { height: 0.42, color: T.amber, font: HH.FONTS.display, weight: "700", glow: 24, letterSpacing: 6 });
    exitT.position.set(0, 3.15, z); scene.add(exitT);
    signs.push({ meshes: [exitT], z: END_Z, powered: false, t: 0 });
    var endT;
    if (SITE.ENDING) {
      endT = kit.neonText(SITE.ENDING, { height: 0.24, color: T.white, font: HH.FONTS.neon, glow: 16, maxWidthPx: 2400 });
    } else if (draft) {
      endT = kit.neonText("[ ENDING · HENRY WRITES THIS ]", { height: 0.2, color: T.dim, font: HH.FONTS.mono, glow: 0, letterSpacing: 6 });
    }
    if (endT) { endT.position.set(0, 4.35, z); scene.add(endT); }
    var wingEnd = kit.neonText("END OF THE GEN Z WING", { height: 0.13, color: T.violet, font: HH.FONTS.mono, glow: 10, letterSpacing: 8 });
    wingEnd.position.set(0, endT ? 5.4 : 4.1, z); scene.add(wingEnd);
    var lp = new THREE.PointLight(kit.color("#ffb23f"), 0.9, 12, 1.6); lp.position.set(0, 3.5, END_Z + 3); scene.add(lp);
  }

  /* Soft visible light cone (fake volumetric). */
  var coneMat = null;
  function lightCone(from, to, radius) {
    if (!coneMat) {
      coneMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: kit.color("#b9a8ff") }, uOpacity: { value: quality === "high" ? 0.055 : 0.04 } },
        vertexShader: "varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "uniform vec3 uColor; uniform float uOpacity; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 3.0); float fall = pow(vY, 2.2); gl_FragColor = vec4(uColor * edge * fall * uOpacity, 1.0); }"
      });
    }
    var dir = new THREE.Vector3().subVectors(from, to);
    var h = dir.length();
    var mat = coneMat.clone();
    mat.uniforms.uOpacity = { value: coneMat.uniforms.uOpacity.value };
    mat.userData.base = coneMat.uniforms.uOpacity.value;
    var cone = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 32, 1, true), mat);
    cone.position.copy(from).add(to).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return cone;
  }

  /* ---------- rooms ---------- */
  var _unitBox = null;
  function unitBox() { return _unitBox || (_unitBox = new THREE.BoxGeometry(1, 1, 1)); }
  function buildBay(r) {
    var a = r.anchor, ex = r.ex;
    var recess = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 4.95), new THREE.MeshStandardMaterial({ color: kit.color("#060820"), roughness: 0.85, metalness: 0.1 }));
    recess.position.set(0, 2.5, 0.004); a.add(recess);
    // optional photographic backdrop (ex.media.backdrop): printed like a dim duotone wall graphic
    if (ex.media && ex.media.backdrop) {
      kit.loadTexture(ex.media.backdrop).then(function (tex) {
        var bm = new THREE.ShaderMaterial({
          uniforms: { map: { value: tex }, uLo: { value: kit.color(T.void) }, uHi: { value: kit.color(ex.side > 0 ? "#3b2a6e" : "#2a2f6e") },
            uAspect: { value: (tex.image && tex.image.width ? tex.image.width / tex.image.height : 16 / 9) / (10.6 / 4.95) } },
          vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader: "uniform sampler2D map; uniform vec3 uLo, uHi; uniform float uAspect; varying vec2 vUv;" +
            "void main(){ vec2 uv = vUv; if (uAspect > 1.0) uv.x = (uv.x - 0.5) / uAspect + 0.5; else uv.y = (uv.y - 0.5) * uAspect + 0.5;" +
            " float l = dot(texture2D(map, uv).rgb, vec3(0.299, 0.587, 0.114)); l = smoothstep(0.04, 0.9, l);" +
            " float e = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x) * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.9, vUv.y);" +
            " float sl = 0.86 + 0.14 * step(0.5, fract(vUv.y * 240.0));" +
            " gl_FragColor = vec4(mix(uLo, uHi, l) * sl, 0.6 * e); }",
          transparent: true, depthWrite: false
        });
        var bd = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 4.95), bm);
        bd.position.set(0, 2.5, 0.006); bd.layers.set(1); a.add(bd);
      }).catch(function () {});
    }
    // corner brackets
    var br = new THREE.InstancedMesh(unitBox(), kit.neonMat(T.purple, 1.25), 8), m4 = new THREE.Matrix4(), qi = new THREE.Quaternion(), k = 0;
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (c) {
      var x = c[0] * 5.3, y = c[1] > 0 ? 4.97 : 0.04;
      m4.compose(new THREE.Vector3(x - c[0] * 0.35, y, 0.02), qi, new THREE.Vector3(0.7, 0.022, 0.022)); br.setMatrixAt(k++, m4);
      m4.compose(new THREE.Vector3(x, y - c[1] * 0.35, 0.02), qi, new THREE.Vector3(0.022, 0.7, 0.022)); br.setMatrixAt(k++, m4);
    });
    br.instanceMatrix.needsUpdate = true; a.add(br);
    // sign
    var num = kit.neonText(pad(ex.n), { height: 0.62, color: T.violet, font: HH.FONTS.display, weight: "700", glow: 24, align: "left" });
    var name = kit.neonText(ex.room.toUpperCase(), { height: 0.3, color: T.white, font: HH.FONTS.neon, glow: 22, align: "left", letterSpacing: 3 });
    var tag = kit.neonText(ex.required.toUpperCase(), { height: 0.1, color: /^Required/.test(ex.required) ? T.amber : T.dim, font: HH.FONTS.mono, glow: 0, align: "left", letterSpacing: 4 });
    var nw = num.userData.size.w * 0.74, total = nw + Math.max(name.userData.size.w, tag.userData.size.w) * 0.9;
    var x0 = -total / 2;
    num.position.set(x0, 5.42, 0.03); a.add(num);
    name.position.set(x0 + nw, 5.5, 0.03); a.add(name);
    tag.position.set(x0 + nw, 5.18, 0.03); a.add(tag);
    signs.push({ meshes: [num, name, tag], z: roomZ(ex.n), powered: false, t: 0 });
    // floor number
    var fnum = kit.neonText(pad(ex.n), { height: 1.0, color: T.violet, font: HH.FONTS.display, weight: "700", glow: 8, core: 0.15 });
    fnum.material.opacity = 0.32;
    fnum.rotation.x = -Math.PI / 2; fnum.position.set(0, 0.012, 3.2); a.add(fnum);
    // spotlight + cone
    var spot = new THREE.SpotLight(kit.color("#e2d9ff"), quality === "high" ? 2.4 : 2.0, 16, 0.62, 0.75, 1.4);
    spot.position.set(0, L.ceiling - 0.25, 3.3);
    spot.target.position.set(0, 2.0, 0.2);
    a.add(spot); a.add(spot.target);
    var cone = lightCone(new THREE.Vector3(0, L.ceiling - 0.25, 3.3), new THREE.Vector3(0, 0.6, 1.2), 1.7);
    a.add(cone); r.cone = cone;
    var fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.18, 20), kit.neonMat("#d9d0ff", 1.3));
    fixture.position.set(0, L.ceiling - 0.12, 3.3); a.add(fixture);
    // invisible click area: walk here
    var hit = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 4.8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, 2.4, 1.0);
    hit.userData.walkTo = ex.n; hit.userData.hint = "Walk to room " + pad(ex.n);
    a.add(hit); bayPlanes.push(hit);
  }

  function makeCtx(r) {
    return {
      THREE: THREE, kit: kit, theme: T, fonts: HH.FONTS, layout: L,
      scene: scene, camera: camera, renderer: renderer, anchor: r.anchor,
      exhibit: r.ex, site: SITE, draft: draft, assetBase: "", quality: quality, reducedMotion: reduced,
      loadTexture: kit.loadTexture,
      addClickable: function (mesh, fn, hint) { mesh.userData.onClick = fn; mesh.userData.hint = hint || ""; mesh.userData.room = r.n; r.clickables.push(mesh); },
      openImmersive: function () { openImmersive(r.n); },
      openLink: openLink,
      isActive: function () { return r.active; }
    };
  }

  function call(r, fn) {
    if (!r.def || typeof r.def[fn] !== "function") return;
    try { return r.def[fn].apply(r.def, Array.prototype.slice.call(arguments, 2)); }
    catch (e) { dbg.errors.push("room " + r.n + " " + fn + ": " + (e && e.message || e)); if (fn === "update") r.broken = true; }
  }

  function withTimeout(p, ms) {
    return Promise.race([Promise.resolve(p), new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
  }

  function placeholder(r) {
    var t = kit.neonText(r.ex.title, { height: 0.36, color: T.violet, font: HH.FONTS.display, weight: "600", glow: 18, maxWidthPx: 2200 });
    t.position.set(0, 2.4, 0.1); r.anchor.add(t);
  }

  function buildRooms() {
    var chain = Promise.resolve();
    EX.forEach(function (ex, i) {
      var anchor = new THREE.Group();
      anchor.position.set(ex.side * L.wallX, 0, roomZ(ex.n));
      anchor.rotation.y = ex.side * -Math.PI / 2;   // local +z points into the corridor
      scene.add(anchor);
      var r = { n: ex.n, ex: ex, def: HH.rooms[ex.n], anchor: anchor, clickables: [], active: false, built: false, broken: false, near: 0 };
      var content = new THREE.Group(); anchor.add(content);
      r.content = content;
      rooms.push(r);
      buildBay(r);
      chain = chain.then(function () {
        boot(0.3 + 0.1 * i, "Restoring room " + pad(ex.n) + " · " + ex.room);
        if (!r.def) { placeholder(r); return; }
        // rooms add to ctx.anchor; give them the content group so the engine can cull it
        var c = makeCtx(r); c.anchor = content; r.ctx = c;
        return withTimeout(r.def.build(c), 12000).then(function () {
          r.built = true;
          content.traverse(function (o) { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) o.layers.set(1); });
        }).catch(function (e) {
          dbg.errors.push("room " + r.n + " build: " + (e && e.message || e));
          r.broken = true; placeholder(r);
        });
      });
    });
    return chain;
  }

  /* ---------- camera + walking ---------- */
  var cur = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  var walk = null, queued = null;
  var par = { x: 0, y: 0, tx: 0, ty: 0 };
  var view = { sx: 0, sy: 0 };
  var tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3() };
  var stepCount = 0;

  function snapTo(i) {
    var v = stopView(i);
    cur.pos.copy(v.pos); cur.look.copy(v.look);
  }

  function goTo(j, opts) {
    j = Math.max(0, Math.min(STOPS.length - 1, j));
    if (walk) { queued = j; return; }
    if (j === dbg.stop && !(opts && opts.force)) { arrive(j, true); return; }
    leave(dbg.stop);
    var from = dbg.stop;
    var v = stopView(j);
    if (reduced) {
      $("fade").classList.add("on");
      setTimeout(function () { cur.pos.copy(v.pos); cur.look.copy(v.look); arrive(j); $("fade").classList.remove("on"); }, 230);
      return;
    }
    var p0 = cur.pos.clone(), p1 = v.pos.clone();
    var dir = Math.sign(p1.z - p0.z) || -1;
    var dz = Math.abs(p1.z - p0.z);
    var k = Math.min(2.6, dz * 0.25);
    var a = new THREE.Vector3(p0.x * 0.25, L.eye, p0.z + dir * k);
    var b = new THREE.Vector3(p1.x * 0.25, L.eye, p1.z - dir * k);
    var curve = new THREE.CatmullRomCurve3([p0, a, b, p1], false, "centripetal");
    var len = curve.getLength();
    var hops = Math.abs(j - from);
    var dur = hops > 1 ? kit.clamp(1.4 + len / 9, 2.2, 6.2) : kit.clamp(0.9 + len / 5.2, 1.6, 4.6);
    walk = {
      to: j, curve: curve, len: len, dur: dur, t: 0,
      startDir: new THREE.Vector3().subVectors(cur.look, p0).normalize(),
      endLook: v.look.clone(), lastStep: 0
    };
    stepCount = 0;
    dbg.walking = true;
    showWalkTag(j);
    setRail(j, true);
  }

  function updateWalk(dt) {
    var w = walk;
    w.t += dt;
    var u = Math.min(1, w.t / w.dur);
    var s = kit.easeInOutSine(u);
    var p = w.curve.getPointAt(s, tmp.a);
    var dist = s * w.len;
    var phase = dist / 0.74 * Math.PI;
    var env = Math.pow(Math.sin(Math.PI * u), 0.6);
    var st = Math.floor(phase / Math.PI);
    if (st > w.lastStep) { w.lastStep = st; footstep(stepCount++); }
    // look direction blend: start -> path ahead -> exhibit
    var ahead = w.curve.getPointAt(Math.min(1, s + 0.09), tmp.b).sub(p);
    ahead.y = 0;
    if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
    ahead.normalize();
    var toEnd = tmp.c.subVectors(w.endLook, p).normalize();
    var wS = 1 - kit.smoothstep(0, 0.3, u), wE = kit.smoothstep(0.5, 1, u), wA = Math.max(0, 1 - wS - wE);
    var d = tmp.d.copy(w.startDir).multiplyScalar(wS).addScaledVector(ahead, wA).addScaledVector(toEnd, wE).normalize();
    cur.pos.copy(p);
    cur.look.copy(p).addScaledVector(d, 5);
    // bob, sway, roll
    var bob = 0.03 * (Math.abs(Math.sin(phase)) - 0.55) * env;
    var sway = 0.017 * Math.sin(phase) * env;
    camera.position.copy(cur.pos);
    tmp.right.crossVectors(d, tmp.up).normalize();
    camera.position.addScaledVector(tmp.right, sway);
    camera.position.y += bob;
    camera.lookAt(cur.look);
    camera.rotateZ(0.006 * Math.sin(phase) * env);
    if (guideMat) guideMat.uniforms.uWalk.value = env;
    if (u >= 1) {
      walk = null; dbg.walking = false;
      if (guideMat) guideMat.uniforms.uWalk.value = 0;
      var to = w.to;
      arrive(to);
      if (queued != null && queued !== to) { var q = queued; queued = null; setTimeout(function () { goTo(q); }, 60); }
      queued = null;
    }
  }

  function updateRest(dt, t) {
    par.x = kit.damp(par.x, par.tx, 3, dt);
    par.y = kit.damp(par.y, par.ty, 3, dt);
    camera.position.copy(cur.pos);
    if (!reduced) camera.position.y += Math.sin(t * 1.1) * 0.006;
    var look = tmp.a.copy(cur.look);
    var fwd = tmp.b.subVectors(cur.look, cur.pos).normalize();
    tmp.right.crossVectors(fwd, tmp.up).normalize();
    look.addScaledVector(tmp.right, par.x * 0.45).addScaledVector(tmp.up, -par.y * 0.25);
    camera.lookAt(look);
  }

  function updateViewOffset(dt) {
    var lb = $("label");
    var open = !lb.classList.contains("away") && STOPS[dbg.stop].kind === "room" && !walk;
    var tx = 0, ty = 0;
    if (open) {
      if (innerWidth > 760) tx = (lb.offsetWidth + 24) / 2;
      else ty = lb.offsetHeight * 0.42;
    }
    view.sx = kit.damp(view.sx, tx, 5, dt);
    view.sy = kit.damp(view.sy, ty, 5, dt);
    if (Math.abs(view.sx) < 0.5 && Math.abs(view.sy) < 0.5) { if (camera.view && camera.view.enabled) camera.clearViewOffset(); }
    else camera.setViewOffset(innerWidth, innerHeight, view.sx, view.sy, innerWidth, innerHeight);
  }

  function arrive(j, again) {
    dbg.stop = j;
    setRail(j, false);
    hideWalkTag();
    var s = STOPS[j];
    try { history.replaceState(null, "", s.kind === "room" ? "#room" + s.n : s.kind === "exit" ? "#exit" : "#lobby"); } catch (e) {}
    visited[j] = true;
    if (s.kind === "room") {
      var r = rooms[s.n - 1];
      if (!r.active) { r.active = true; call(r, "enter", r.ctx); }
      showLabel(s.n);
      startSong(s.n);
      autoGuide(s.n);
    } else if (s.kind === "exit") {
      openOverlay("exit");
    } else if (s.kind === "lobby" && !again) {
      showLobby(true);
    }
  }

  function leave(j) {
    var s = STOPS[j];
    if (s && s.kind === "lobby") showLobby(false);
    if (s && s.kind === "exit") closeOverlay("exit");
    hideLabel();
    cancelAutoGuide();
    stopGuides();
    stopSong();
    if (s && s.kind === "room") {
      var r = rooms[s.n - 1];
      if (r.active) { r.active = false; call(r, "leave", r.ctx); }
    }
  }

  /* ---------- rail ---------- */
  var visited = {};
  function buildRail() {
    var box = $("stops");
    box.innerHTML = STOPS.map(function (s, i) {
      var label = s.kind === "room" ? "Room " + s.key + ": " + s.ex.title : s.name;
      return '<button class="stop" type="button" data-i="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + s.key + "</button>";
    }).join("");
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".stop"); if (!b) return;
      closeOverlays(); goTo(+b.dataset.i);
    });
    $("prevBtn").onclick = function () { closeOverlays(); goTo((walk ? walk.to : dbg.stop) - 1); };
    $("nextBtn").onclick = function () { closeOverlays(); goTo((walk ? walk.to : dbg.stop) + 1); };
  }
  function setRail(j, moving) {
    Array.prototype.forEach.call($("stops").children, function (b, i) {
      b.classList.toggle("is-here", i === j);
      b.classList.toggle("is-visited", !!visited[i]);
      if (i === j) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    $("prevBtn").disabled = j <= 0;
    $("nextBtn").disabled = j >= STOPS.length - 1;
  }
  function showWalkTag(j) {
    var s = STOPS[j];
    $("walkTag").innerHTML = "Walking to<b>" + (s.kind === "room" ? s.key + " · " + esc(s.name) : esc(s.name)) + "</b>";
    $("walkTag").classList.add("on");
  }
  function hideWalkTag() { $("walkTag").classList.remove("on"); }

  /* ---------- label ---------- */
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';

  function reqClass(ex) { return /^required/i.test(ex.required) ? "is-required" : "is-free"; }

  function linksHTML(ex, def) {
    var out = "";
    (ex.links || []).forEach(function (l) {
      var url = l.url || (l.key && ex.facts && ex.facts[l.key]) || "";
      if (!url) return;
      var cls = l.kind === "video" ? "hh-btn magenta" : l.kind === "audio" ? "hh-btn amber" : "hh-btn";
      out += '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(l.label) + " <small>" + esc(l.sub || "") + " ↗</small></a>";
    });
    if (def && def.immersive) out += '<button class="hh-btn" type="button" data-imm="' + ex.n + '">' + esc(def.immersive.cta || "Step inside") + " <small>3D story</small></button>";
    return out ? '<div class="lb-links">' + out + "</div>" : "";
  }

  function ledgerHTML(ex) {
    function row(cls, k, o) {
      if (!o) return "";
      return '<div class="ledger-row ' + cls + '"><div class="ledger-k">' + esc(o.label || k) + '</div><div class="ledger-v">' + esc(o.value) +
        (o.note ? "<small>" + esc(o.note) + "</small>" : "") + "</div></div>";
    }
    return '<div class="ledger" role="group" aria-label="Human time and machine time">' + row("h", "Human time", ex.human) + row("m", "Machine time", ex.machine) + "</div>";
  }

  function slotsHTML(ex) {
    return HH.SLOTS.map(function (sl) {
      var s = (ex.slots && ex.slots[sl.key]) || {};
      var fin = !!(s.text && s.text.trim());
      var body = fin ? s.text : (s.draft || "");
      var has = !!body.trim();
      if (!has && !draft) return "";
      return '<section class="slot"><h3>' + esc(sl.label) +
        (has && !fin && draft ? '<span class="draft-tag hh-draft-only">Draft · from proposal</span>' : "") + "</h3>" +
        (has ? "<p>" + esc(body) + "</p>" : '<p class="empty hh-draft-only">Henry writes this part.</p>') +
        (draft && !fin && s.ask ? '<div class="hh-note">' + esc(s.ask) + "</div>" : "") + "</section>";
    }).join("");
  }

  function sourcesHTML(ex) {
    if (!ex.sources || !ex.sources.length) return "";
    return '<section class="lb-src"><div class="hh-h">Sources</div><ol>' + ex.sources.map(function (s) {
      return "<li>" + esc(s[0]) + (s[1] ? ' <a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(host(s[1])) + " ↗</a>" : "") + "</li>";
    }).join("") + "</ol></section>";
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "link"; } }

  function guideHTML(ex) {
    return '<div class="guide" data-guide="' + ex.n + '">' +
      '<button class="guide-btn" type="button" aria-label="Play the audio guide for room ' + pad(ex.n) + '">' + PLAY + "</button>" +
      '<div class="guide-top"><span>Audio guide · Henry’s voice</span><span class="t mono">0:00</span></div>' +
      '<div class="guide-bar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><i></i></div>' +
      "</div>";
  }

  function songHTML(ex, where) {
    if (!ex.media || !ex.media.song) return "";
    return '<div class="lb-song" data-song="' + ex.n + '"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="lb-song-t">' + (where === "flat" ? "Room song · “" : "Now playing in this room · “") + esc((ex.media.songTitle || ex.title).replace(/[“”"]/g, "")) + '”</span>' +
      '<button type="button" class="lb-song-b">' + (song.on && song.n === ex.n ? "Mute" : "Play") + "</button></div>";
  }

  function labelBodyHTML(ex, def, where) {
    return '<div class="lb-titles">' +
      '<span class="req ' + reqClass(ex) + '">' + esc(ex.required) + "</span>" +
      '<h2 class="lb-title">' + esc(ex.title) + "</h2>" +
      '<p class="lb-kind">' + esc(ex.kind) + "</p>" +
      '<ul class="lb-meta">' + (ex.meta || []).map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul></div>" +
      guideHTML(ex) +
      songHTML(ex, where) +
      linksHTML(ex, def) +
      ledgerHTML(ex) +
      '<div class="lb-extra" data-extra="' + ex.n + '"></div>' +
      slotsHTML(ex) +
      sourcesHTML(ex);
  }

  function fillExtra(container, r) {
    var el = container.querySelector('[data-extra="' + r.n + '"]');
    if (!el || !r.def || typeof r.def.panel !== "function") return;
    try { r.def.panel(el, r.ctx || makeCtx(r)); } catch (e) { dbg.errors.push("room " + r.n + " panel: " + e.message); el.innerHTML = ""; }
  }

  function showLabel(n) {
    var r = rooms[n - 1], ex = r.ex, lb = $("label");
    var prev = n > 1 ? "‹ Room " + pad(n - 1) : "‹ Lobby";
    var next = n < EX.length ? "Room " + pad(n + 1) + " ›" : "Exit ›";
    lb.innerHTML = '<div class="lb-head"><span class="lb-room">Room ' + pad(n) + " · " + esc(ex.room) + "</span>" +
      '<button class="icon-btn lb-tog" type="button" aria-expanded="false">More</button></div>' +
      '<div class="lb-body">' + labelBodyHTML(ex, r.def, "label") +
      '<div class="lb-nav"><button type="button" data-go="' + (n - 1) + '">' + prev + '</button><button type="button" data-go="' + (n + 1) + '">' + next + "</button></div></div>";
    fillExtra(lb, r);
    bindGuides(lb);
    lb.querySelector(".lb-body").scrollTop = 0;
    lb.classList.remove("away", "expanded");
    lb.querySelector(".lb-tog").onclick = function () {
      var x = lb.classList.toggle("expanded");
      this.textContent = x ? "Less" : "More"; this.setAttribute("aria-expanded", String(x));
    };
  }
  function hideLabel() { $("label").classList.add("away"); }

  document.addEventListener("click", function (e) {
    var go = e.target.closest("[data-go]");
    if (go) { closeOverlays(); if (!entered) enterMuseum(+go.dataset.go); else goTo(+go.dataset.go); return; }
    var im = e.target.closest("[data-imm]");
    if (im) { openImmersive(+im.dataset.imm); return; }
    var cl = e.target.closest("[data-close]");
    if (cl) { closeOverlay(cl.dataset.close); return; }
    var room = e.target.closest("[data-room]");
    if (room) { closeOverlays(); if (!entered) enterMuseum(+room.dataset.room); else goTo(+room.dataset.room); }
  });

  /* ---------- audio guide ---------- */
  var guides = {};
  function guideFor(n) {
    if (guides[n]) return guides[n];
    var ex = EX[n - 1], a = new Audio();
    var g = guides[n] = { a: a, status: "checking", uis: [] };
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", function () { g.status = "ok"; paintGuide(n); });
    a.addEventListener("error", function () { g.status = "missing"; paintGuide(n); });
    a.addEventListener("timeupdate", function () { paintGuide(n); });
    a.addEventListener("play", function () { duck(true); paintGuide(n); });
    a.addEventListener("pause", function () { duck(false); paintGuide(n); });
    a.addEventListener("ended", function () { a.currentTime = 0; paintGuide(n); });
    a.src = ex.audio;
    return g;
  }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function paintGuide(n) {
    var g = guides[n]; if (!g) return;
    g.uis = g.uis.filter(function (el) { return document.body.contains(el); });
    g.uis.forEach(function (el) {
      var btn = el.querySelector(".guide-btn"), t = el.querySelector(".t"), bar = el.querySelector(".guide-bar i");
      var miss = g.status === "missing";
      el.classList.toggle("missing", miss);
      btn.disabled = miss;
      btn.innerHTML = g.a.paused ? PLAY : PAUSE;
      btn.setAttribute("aria-label", (g.a.paused ? "Play" : "Pause") + " the audio guide");
      var msg = el.querySelector(".guide-msg");
      if (miss && !msg) {
        msg = document.createElement("div"); msg.className = "guide-msg";
        msg.innerHTML = "Recording coming soon." + (draft ? ' <span class="hh-draft-only mono">(' + esc(EX[n - 1].audio) + ")</span>" : "");
        el.appendChild(msg);
      }
      var d = g.a.duration || 0, c = g.a.currentTime || 0;
      t.textContent = miss ? "—" : fmt(c) + (d ? " / " + fmt(d) : "");
      bar.style.width = (d ? (c / d) * 100 : 0) + "%";
      el.querySelector(".guide-bar").setAttribute("aria-valuenow", String(Math.round(d ? (c / d) * 100 : 0)));
    });
  }
  function bindGuides(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-guide]"), function (el) {
      var n = +el.dataset.guide, g = guideFor(n);
      g.uis.push(el);
      el.querySelector(".guide-btn").onclick = function () {
        if (g.status === "missing") return;
        if (g.a.paused) { stopGuides(n); g.a.play().catch(function () {}); } else g.a.pause();
      };
      var bar = el.querySelector(".guide-bar");
      bar.onclick = function (e) {
        var rc = bar.getBoundingClientRect(), d = g.a.duration;
        if (d) g.a.currentTime = kit.clamp((e.clientX - rc.left) / rc.width, 0, 1) * d;
      };
      bar.onkeydown = function (e) {
        if (!g.a.duration) return;
        if (e.key === "ArrowRight") { g.a.currentTime = Math.min(g.a.duration, g.a.currentTime + 5); e.preventDefault(); }
        if (e.key === "ArrowLeft") { g.a.currentTime = Math.max(0, g.a.currentTime - 5); e.preventDefault(); }
      };
      paintGuide(n);
    });
  }
  function stopGuides(except) {
    Object.keys(guides).forEach(function (k) { if (+k !== except && !guides[k].a.paused) guides[k].a.pause(); });
  }

  /* Henry's narration starts by itself in every room. In a room with a song (media.song + media.voiceAt),
     the song plays from the top first and the voice comes in on the beat at voiceAt seconds. */
  var auto = { n: 0, timer: 0, poll: 0 };
  var VOICE_LEAD = 0.3; // the recordings open with about 0.3 s of room tone
  function cancelAutoGuide() {
    if (auto.timer) clearTimeout(auto.timer);
    if (auto.poll) clearInterval(auto.poll);
    auto.timer = auto.poll = 0; auto.n = 0;
  }
  function playGuideNow(n) {
    var g = guideFor(n);
    if (!snd.on || g.status === "missing" || dbg.stop == null || STOPS[dbg.stop].n !== n) return;
    stopGuides(n);
    try { g.a.currentTime = 0; } catch (e) {}
    var pr = g.a.play(); if (pr && pr.catch) pr.catch(function () {});
    dbg.autoPlayed = (dbg.autoPlayed || []).concat([{ n: n, songAt: song.a && song.n === n ? +song.a.currentTime.toFixed(2) : null }]);
  }
  function autoGuide(n) {
    cancelAutoGuide();
    var ex = EX[n - 1], m = ex.media || {};
    if (!snd.on || !ex.audio) return;
    var g = guideFor(n); g.a.preload = "auto";
    auto.n = n;
    var cue = +m.voiceAt;
    if (m.song && cue > 0 && song.a && song.src === m.song && song.on) {
      try { song.a.currentTime = 0; } catch (e) {}
      auto.poll = setInterval(function () {
        if (auto.n !== n || !snd.on) { cancelAutoGuide(); return; }
        if (!song.on || song.n !== n) { cancelAutoGuide(); auto.n = n; auto.timer = setTimeout(function () { auto.timer = 0; playGuideNow(n); }, 400); return; }
        if (song.a.currentTime >= cue - VOICE_LEAD) { clearInterval(auto.poll); auto.poll = 0; playGuideNow(n); }
      }, 25);
    } else {
      auto.timer = setTimeout(function () { auto.timer = 0; if (auto.n === n) playGuideNow(n); }, 900);
    }
  }

  /* ---------- ambient sound + footsteps (WebAudio, quiet) ---------- */
  var snd = { ctx: null, master: null, amb: null, on: store.get("sound") !== "off", noise: null };
  function ensureAudio() {
    if (snd.ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { snd.ctx = new AC(); } catch (e) { return false; }
    var c = snd.ctx;
    snd.master = c.createGain(); snd.master.gain.value = 0; snd.master.connect(c.destination);
    snd.amb = c.createGain(); snd.amb.gain.value = 1; snd.amb.connect(snd.master);
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240; lp.connect(snd.amb);
    [55, 82.4, 110.3].forEach(function (f, i) {
      var o = c.createOscillator(); o.type = i === 0 ? "sawtooth" : "sine"; o.frequency.value = f;
      var gg = c.createGain(); gg.gain.value = i === 0 ? 0.018 : 0.012;
      var lfo = c.createOscillator(); lfo.frequency.value = 0.07 + i * 0.03;
      var lg = c.createGain(); lg.gain.value = 0.006; lfo.connect(lg); lg.connect(gg.gain); lfo.start();
      o.connect(gg); gg.connect(lp); o.start();
    });
    var buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    snd.noise = buf;
    var hiss = c.createBufferSource(); hiss.buffer = buf; hiss.loop = true;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.6;
    var hg = c.createGain(); hg.gain.value = 0.006;
    hiss.connect(bp); bp.connect(hg); hg.connect(snd.amb); hiss.start();
    return true;
  }
  function setSound(on) {
    snd.on = on; store.set("sound", on ? "on" : "off");
    $("soundBtn").setAttribute("aria-pressed", String(on));
    $("soundBtn").textContent = on ? "Sound on" : "Sound off";
    if (on && ensureAudio()) { snd.ctx.resume(); }
    if (snd.ctx) snd.master.gain.setTargetAtTime(on ? 0.9 : 0, snd.ctx.currentTime, 0.25);
    var st = STOPS[dbg.stop];
    if (on && st && st.kind === "room" && entered) startSong(st.n); else if (!on) stopSong();
    paintSong();
  }
  function duck(on) { if (snd.ctx) snd.amb.gain.setTargetAtTime(on ? 0.15 : 1, snd.ctx.currentTime, 0.3); song.duck = on; songFade(); }

  /* ---------- room song: loops while the visitor stands in that room ---------- */
  var SONG_VOL = 0.6, SONG_BED = 0.12;
  var song = { a: null, src: "", n: 0, on: false, duck: false, v: 0, timer: 0 };
  function songFade() {
    if (song.timer || !song.a) return;
    song.timer = setInterval(function () {
      var a = song.a;
      var tgt = song.on ? (song.duck ? SONG_BED : SONG_VOL) : 0;
      song.v += (tgt - song.v) * 0.16;
      if (Math.abs(tgt - song.v) < 0.01) song.v = tgt;
      try { a.volume = Math.max(0, Math.min(1, song.v)); } catch (e) {}
      if (!song.on && song.v === 0 && !a.paused) a.pause();
      if (song.v === tgt) { clearInterval(song.timer); song.timer = 0; }
    }, 50);
  }
  function startSong(n) {
    var ex = EX[n - 1], src = ex && ex.media && ex.media.song;
    if (!src || !snd.on) return;
    if (!song.a || song.src !== src) {
      if (song.a) song.a.pause();
      song.a = new Audio(src); song.src = src; song.a.loop = true; song.a.preload = "auto"; song.v = 0;
      try { song.a.volume = 0; } catch (e) {}
      song.a.addEventListener("error", function () { song.on = false; paintSong(); });
    }
    song.on = true; song.n = n;
    var pr = song.a.play();
    if (pr && pr.catch) pr.catch(function () { song.on = false; paintSong(); });
    songFade(); paintSong();
  }
  function stopSong() {
    if (!song.a) return;
    song.on = false; song.n = 0;
    if (reduced) { song.a.pause(); song.v = 0; }
    songFade(); paintSong();
  }
  function paintSong() {
    var els = document.querySelectorAll(".lb-song");
    for (var i = 0; i < els.length; i++) {
      var playing = song.on && song.n === +els[i].dataset.song;
      els[i].classList.toggle("on", playing);
      var b = els[i].querySelector(".lb-song-b"); if (b) b.textContent = playing ? "Mute" : "Play";
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".lb-song-b"); if (!b) return;
    var n = +b.closest(".lb-song").dataset.song;
    if (song.on && song.n === n) { setSound(false); } else { if (!snd.on) setSound(true); else startSong(n); }
  });
  document.addEventListener("visibilitychange", function () {
    if (!song.a) return;
    if (document.hidden) song.a.pause(); else if (song.on) { var pr = song.a.play(); if (pr && pr.catch) pr.catch(function () {}); }
  });
  function footstep(i) {
    if (!snd.on || !snd.ctx || !snd.noise) return;
    var c = snd.ctx, t0 = c.currentTime;
    var src = c.createBufferSource(); src.buffer = snd.noise;
    var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = i % 2 ? 700 : 560;
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    src.connect(f); f.connect(g); g.connect(snd.master);
    src.start(t0, Math.random() * 1.5, 0.14);
    var o = c.createOscillator(); o.frequency.setValueAtTime(80, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.08);
    var og = c.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    o.connect(og); og.connect(snd.master); o.start(t0); o.stop(t0 + 0.12);
  }

  /* ---------- links ---------- */
  function openLink(url) {
    if (!url) return;
    var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- overlays ---------- */
  var overlayOpen = null;
  function openOverlay(id) {
    closeOverlays();
    var el = $(id); el.hidden = false; el.scrollTop = 0;
    overlayOpen = id;
    if (id === "map") paintMap();
    if (id === "exit") paintExit();
    if (id === "flat") { paintFlat(); paused = true; }
    var f = el.querySelector("[data-close], button, a"); if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 30);
  }
  function closeOverlay(id) {
    var el = $(id); if (!el || el.hidden) return;
    el.hidden = true;
    if (id === "flat") { paused = false; stopGuides(); }
    if (overlayOpen === id) overlayOpen = null;
  }
  function closeOverlays() { ["map", "exit", "flat"].forEach(closeOverlay); }

  function paintMap() {
    var W = 1000, x0 = 40, x1 = 960, y0 = 84, y1 = 136;
    var span = (x1 - 150) - (x0 + 110);
    var svg = '<svg viewBox="0 0 1000 220" role="img" aria-label="Floor plan of the corridor with six rooms">' +
      '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" fill="rgba(19,26,72,.6)" stroke="rgba(184,139,255,.5)"/>' +
      '<line x1="' + (x0 + 10) + '" y1="110" x2="' + (x1 - 10) + '" y2="110" stroke="url(#tl)" stroke-width="3"/>' +
      '<defs><linearGradient id="tl" gradientUnits="userSpaceOnUse" x1="' + x0 + '" x2="' + x1 + '" y1="0" y2="0"><stop offset="0" stop-color="' + T.amber + '"/><stop offset=".38" stop-color="' + T.violet + '"/><stop offset=".64" stop-color="' + T.cyan + '"/><stop offset=".8" stop-color="' + T.cyan + '"/><stop offset=".88" stop-color="' + T.amber + '"/></linearGradient></defs>' +
      '<g data-room="0" style="cursor:pointer"><rect x="' + (x0 + 4) + '" y="' + (y0 + 4) + '" width="90" height="' + (y1 - y0 - 8) + '" fill="rgba(255,178,63,.08)"/><text x="' + (x0 + 49) + '" y="104" text-anchor="middle" fill="' + T.amber + '" font-family="IBM Plex Mono, monospace" font-size="13" letter-spacing="2">LOBBY</text></g>' +
      '<g data-room="' + (STOPS.length - 1) + '" style="cursor:pointer"><rect x="' + (x1 - 94) + '" y="' + (y0 + 4) + '" width="90" height="' + (y1 - y0 - 8) + '" fill="rgba(255,178,63,.08)"/><text x="' + (x1 - 49) + '" y="104" text-anchor="middle" fill="' + T.amber + '" font-family="IBM Plex Mono, monospace" font-size="13" letter-spacing="2">EXIT</text></g>';
    EX.forEach(function (ex, i) {
      var cx = x0 + 150 + (i / (EX.length - 1)) * span;
      var up = ex.side < 0;
      var ry = up ? 18 : y1 + 6, rh = 58;
      var here = dbg.stop === ex.n;
      svg += '<g data-room="' + ex.n + '" style="cursor:pointer" tabindex="0" role="button" aria-label="Walk to room ' + pad(ex.n) + '">' +
        '<rect x="' + (cx - 58) + '" y="' + ry + '" width="116" height="' + rh + '" fill="' + (here ? "rgba(255,178,63,.16)" : "rgba(10,15,46,.9)") + '" stroke="' + (here ? T.amber : "rgba(184,139,255,.55)") + '"/>' +
        '<text x="' + cx + '" y="' + (ry + 26) + '" text-anchor="middle" fill="' + (here ? T.amber : T.violet) + '" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="20">' + pad(ex.n) + "</text>" +
        '<text x="' + cx + '" y="' + (ry + 46) + '" text-anchor="middle" fill="' + T.white + '" font-family="IBM Plex Mono, monospace" font-size="10.5" letter-spacing="1">' + esc(ex.room.replace(/^The /, "").toUpperCase()) + "</text></g>";
    });
    var hereX = dbg.stop === 0 ? x0 + 49 : dbg.stop === STOPS.length - 1 ? x1 - 49 : x0 + 150 + ((dbg.stop - 1) / (EX.length - 1)) * span;
    var hereY = (dbg.stop === 0 || dbg.stop === STOPS.length - 1) ? 122 : 110;
    svg += '<circle cx="' + hereX + '" cy="' + hereY + '" r="7" fill="' + T.amber + '"><title>You are here</title></circle></svg>';
    $("mapPlan").innerHTML = svg;
    $("mapGrid").innerHTML = EX.map(function (ex) {
      return '<button class="map-card" type="button" data-room="' + ex.n + '"><span class="n">' + pad(ex.n) + '</span><span class="t">' + esc(ex.title) + '</span><span class="r">' + esc(ex.room) + '</span><span class="req ' + reqClass(ex) + '">' + esc(ex.required) + "</span></button>";
    }).join("");
  }

  function thesisHTML() {
    if (SITE.THESIS) return '<p class="eyebrow">Thesis</p><p class="thesis-text">' + esc(SITE.THESIS) + "</p>";
    if (!draft) return "";
    return '<p class="eyebrow">Thesis</p><p class="thesis-text thesis-empty">Henry writes this sentence.</p><div class="hh-note">' + esc(SITE.THESIS_ASK) + "</div>";
  }

  function shownUrl(u) { try { u = decodeURI(u); } catch (e) {} return u.replace(/^https?:\/\//, ""); }
  function citedHTML() {
    var seen = {}, items = [];
    EX.forEach(function (ex) {
      (ex.sources || []).forEach(function (s) {
        var k = s[0] + "|" + s[1]; if (seen[k]) return; seen[k] = 1;
        items.push("<li><span class=\"room\">Room " + pad(ex.n) + " · " + esc(ex.room) + "</span>" + esc(s[0]) +
          (s[1] ? ' <a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(shownUrl(s[1])) + "</a>" : "") + "</li>");
      });
    });
    return '<ol class="cited">' + items.join("") + "</ol>";
  }

  function paintExit() {
    var ending = SITE.ENDING ? '<p class="exit-ending">' + esc(SITE.ENDING) + "</p>" :
      (draft ? '<p class="exit-ending thesis-empty">Henry writes the closing thought.</p><div class="hh-note">' + esc(SITE.ENDING_ASK) + "</div>" : "");
    $("exitLeft").innerHTML = (ending ? '<div class="hh-h">Closing</div>' : "") + ending +
      (SITE.THESIS || draft ? '<div class="thesis">' + thesisHTML() + "</div>" : "") +
      '<div class="hh-h">How this museum was made</div><dl class="made">' + SITE.madeBy.map(function (m) {
        return "<div><dt>" + esc(m[0]) + "</dt><dd>" + esc(m[1]) + "</dd></div>";
      }).join("") + "</dl>" +
      '<div class="hh-row"><button class="btn primary" type="button" data-go="0">Back to the lobby</button><button class="btn ghost" type="button" id="exitMap">Floor map</button><button class="btn ghost" type="button" id="exitFlat">Read as a page</button></div>';
    $("exitRight").innerHTML = '<div class="hh-h">Works cited</div>' + citedHTML();
    $("exitMap").onclick = function () { openOverlay("map"); };
    $("exitFlat").onclick = function () { openOverlay("flat"); };
  }

  /* Flat page: the whole museum as one readable page (also the no-WebGL fallback). */
  var flatPainted = false;
  function mediaFor(ex) {
    var m = ex.media || {};
    var src = m.photo || m.cover || m.certificate || m.calendar || m.screenshot || m.timer;
    var extra = ex.n === 4 && m.timer ? m.timer : null;
    if (!src) return '<div class="flat-ph" aria-hidden="true">' + pad(ex.n) + "</div>";
    return '<img src="' + esc(src) + '" alt="' + esc(ex.title) + '" loading="lazy">' + (extra ? '<img src="' + esc(extra) + '" alt="Study timer screenshot" loading="lazy">' : "");
  }
  function paintFlat(msg) {
    var el = $("flatIn");
    el.innerHTML = '<div class="ov-head"><div><p class="eyebrow">Year ' + SITE.year + " · " + esc(SITE.genZ) + '</p><h2 class="ov-title" id="flatTitle">Human Hours</h2></div>' +
      (renderer ? '<button class="icon-btn" type="button" data-close="flat">Back to 3D</button>' : "") + "</div>" +
      (msg ? '<p class="mono" style="border:1px solid var(--line);padding:10px 12px;margin:0">' + esc(msg) + "</p>" : "") +
      '<blockquote class="stein">' + esc(SITE.stein) + "<cite>" + esc(SITE.steinBy) + "</cite></blockquote>" +
      '<p class="question">' + esc(SITE.question) + "</p>" +
      ((SITE.THESIS || draft) ? '<div class="thesis">' + thesisHTML() + "</div>" : "") +
      EX.map(function (ex) {
        var r = rooms[ex.n - 1];
        return '<article class="flat-ex" id="flat-' + ex.n + '"><div class="flat-media"><p class="eyebrow">Room ' + pad(ex.n) + " · " + esc(ex.room) + "</p>" + mediaFor(ex) +
          (renderer ? '<button class="btn ghost" type="button" data-room="' + ex.n + '">See it in 3D</button>' : "") +
          '</div><div class="flat-body">' + labelBodyHTML(ex, r && r.def, "flat") + "</div></article>";
      }).join("") +
      '<section class="flat-ex"><div class="flat-media"><p class="eyebrow">Exit</p></div><div class="flat-body">' +
      (SITE.ENDING ? '<p class="exit-ending">' + esc(SITE.ENDING) + "</p>" : (draft ? '<div class="hh-note">' + esc(SITE.ENDING_ASK) + "</div>" : "")) +
      '<div class="hh-h">Works cited</div>' + citedHTML() + "</div></section>";
    EX.forEach(function (ex) { var r = rooms[ex.n - 1] || { n: ex.n, ex: ex, def: HH.rooms[ex.n], anchor: new THREE.Group(), clickables: [] }; fillExtra(el, r); });
    bindGuides(el);
    flatPainted = true;
  }

  /* ---------- immersive ---------- */
  var imm = null;
  function openImmersive(n) {
    var r = rooms[n - 1];
    if (!r || !r.def || !r.def.immersive || imm) return;
    stopGuides();
    var box = $("imm"), sc = $("immScroll");
    box.hidden = false; sc.innerHTML = ""; sc.scrollTop = 0;
    $("immTitle").textContent = "Room " + pad(n) + " · " + (r.def.immersive.title || r.ex.room);
    $("immCue").style.opacity = 1;
    paused = true;
    try { imm = { n: n, h: r.def.immersive.mount(sc, r.ctx) }; }
    catch (e) { dbg.errors.push("room " + n + " immersive: " + e.message); imm = { n: n, h: null }; }
    sc.focus({ preventScroll: true });
    setTimeout(function () { $("immClose").focus({ preventScroll: true }); }, 40);
  }
  function closeImmersive() {
    if (!imm) return;
    try { if (imm.h && imm.h.destroy) imm.h.destroy(); } catch (e) { dbg.errors.push("immersive destroy: " + e.message); }
    imm = null;
    $("immScroll").innerHTML = ""; $("imm").hidden = true;
    paused = !!(overlayOpen === "flat");
    clock.last = performance.now();
  }
  $("immClose").onclick = closeImmersive;
  window.addEventListener("hh:close-immersive", closeImmersive);
  $("immScroll").addEventListener("scroll", function () { if (this.scrollTop > 30) $("immCue").style.opacity = 0; }, { passive: true });

  /* ---------- lobby ---------- */
  var entered = false;
  function paintLobby() {
    $("lobbyEyebrow").textContent = "Year " + SITE.year + " · " + SITE.genZ;
    $("steinQ").textContent = SITE.stein;
    $("steinBy").textContent = SITE.steinBy;
    $("question").textContent = SITE.question;
    var th = thesisHTML();
    $("thesis").innerHTML = th; $("thesis").hidden = !th;
    var req = EX.filter(function (e) { return /^required/i.test(e.required); }).length;
    $("ticket").innerHTML = "<span>Admit one</span><b>Gen Z wing</b>" +
      "<span>Project</span><span>English 11 · Q1\u00a0Summative\u00a02</span>" +
      "<span>Rooms</span><span>" + EX.length + " · " + req + " required · " + (EX.length - req) + " free choice</span>" +
      "<span>To walk</span><span>" + (coarse ? "Swipe or tap the numbers" : "Arrow keys · scroll · click") + "</span>";
    $("lobbyFoot").textContent = "Curated by " + SITE.curator + " · " + SITE.course;
  }
  function showLobby(on) {
    var el = $("lobby");
    $("enterBtn").textContent = entered ? "Continue the tour" : "Enter the museum";
    if (on) { el.hidden = false; el.classList.remove("leaving"); return; }
    if (el.hidden) return;
    if (reduced) { el.hidden = true; return; }
    el.classList.add("leaving");
    setTimeout(function () { el.hidden = true; el.classList.remove("leaving"); }, 480);
  }
  function enterMuseum(stop) {
    var first = !entered;
    entered = true;
    showLobby(false);
    $("hud").hidden = false; $("rail").hidden = false;
    $("draftBadge").hidden = !draft;
    if (first) setSound(snd.on);
    goTo(stop, { force: true });
  }
  $("enterBtn").onclick = function () {
    var m = /^#room([1-9])$/.exec(location.hash);
    var target = m && +m[1] <= EX.length ? +m[1] : 1;
    enterMuseum(dbg.stop === 0 ? ROOM_STOP(target) : dbg.stop + 1);
  };
  $("lobbyMap").onclick = function () { openOverlay("map"); };
  $("lobbyFlat").onclick = function () { openOverlay("flat"); };
  $("mapBtn").onclick = function () { overlayOpen === "map" ? closeOverlay("map") : openOverlay("map"); };
  $("flatBtn").onclick = function () { openOverlay("flat"); };
  $("soundBtn").onclick = function () { setSound(!snd.on); };

  /* ---------- input ---------- */
  var canvas = $("scene");
  var ptr = { down: false, x: 0, y: 0, t: 0, id: null };
  var ndc = new THREE.Vector2();
  function pickAt(cx, cy) {
    ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var list = bayPlanes.slice();
    rooms.forEach(function (r) { if (r.content.visible) list = list.concat(r.clickables); });
    var hits = raycaster.intersectObjects(list, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && !o.userData.onClick && o.userData.walkTo == null && o.parent) o = o.parent;
      if (!o) continue;
      if (o.userData.onClick) {
        var rr = rooms[o.userData.room - 1];
        if (rr && (rr.active || hits[i].distance < 9)) return { kind: "room", o: o, hit: hits[i] };
        return { kind: "walk", n: o.userData.room, o: o };
      }
      if (o.userData.walkTo != null) {
        if (STOPS[dbg.stop].kind === "room" && STOPS[dbg.stop].n === o.userData.walkTo) continue;
        return { kind: "walk", n: o.userData.walkTo, o: o };
      }
    }
    return null;
  }
  canvas.addEventListener("pointerdown", function (e) { ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = performance.now(); ptr.id = e.pointerId; });
  canvas.addEventListener("pointerup", function (e) {
    if (!ptr.down) return; ptr.down = false;
    var dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, ad = Math.max(Math.abs(dx), Math.abs(dy));
    if (!entered) return;
    if (ad > 55 && e.pointerType !== "mouse") {
      var next = Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
      goTo((walk ? walk.to : dbg.stop) + (next ? 1 : -1));
      return;
    }
    if (ad > 8) return;
    var p = pickAt(e.clientX, e.clientY);
    if (!p) return;
    if (p.kind === "room") { try { p.o.userData.onClick(p.hit); } catch (er) { dbg.errors.push("click: " + er.message); } }
    else goTo(ROOM_STOP(p.n));
  });
  var hoverT = 0;
  canvas.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse") {
      par.tx = (e.clientX / innerWidth - 0.5) * 2;
      par.ty = (e.clientY / innerHeight - 0.5) * 2;
    }
    var now = performance.now();
    if (!entered || now - hoverT < 90 || e.pointerType !== "mouse") return;
    hoverT = now;
    var p = pickAt(e.clientX, e.clientY), hint = $("hint");
    var text = p ? (p.o.userData.hint || (p.kind === "walk" ? "Walk to room " + pad(p.n) : "")) : "";
    canvas.classList.toggle("can-click", !!p);
    if (text) { hint.hidden = false; hint.textContent = text; hint.style.left = e.clientX + "px"; hint.style.top = e.clientY + "px"; }
    else hint.hidden = true;
  });
  canvas.addEventListener("pointerleave", function () { $("hint").hidden = true; par.tx = par.ty = 0; });

  var wheelAcc = 0, wheelLock = 0;
  window.addEventListener("wheel", function (e) {
    if (!entered || imm || overlayOpen) return;
    if (e.target !== canvas && !e.target.closest("#vignette")) return;
    var now = performance.now();
    if (now < wheelLock) return;
    wheelAcc += e.deltaY + e.deltaX;
    if (Math.abs(wheelAcc) > 60) {
      goTo((walk ? walk.to : dbg.stop) + (wheelAcc > 0 ? 1 : -1));
      wheelAcc = 0; wheelLock = now + 650;
    }
  }, { passive: true });

  window.addEventListener("keydown", function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "Escape") {
      if (imm) { closeImmersive(); return; }
      if (overlayOpen) { closeOverlay(overlayOpen); return; }
    }
    if (!entered || imm || overlayOpen === "flat") return;
    var at = walk ? walk.to : dbg.stop;
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === "d" || k === "D") { e.preventDefault(); closeOverlays(); goTo(at + 1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "a" || k === "A") { e.preventDefault(); closeOverlays(); goTo(at - 1); }
    else if (k === "Home") goTo(0);
    else if (k === "End") goTo(STOPS.length - 1);
    else if (k === "m" || k === "M") overlayOpen === "map" ? closeOverlay("map") : openOverlay("map");
    else if (k === "p" || k === "P") { var s = STOPS[dbg.stop]; if (s.kind === "room") { var g = guideFor(s.n); if (g.status !== "missing") { if (g.a.paused) g.a.play().catch(function () {}); else g.a.pause(); } } }
    else if (/^[1-9]$/.test(k) && +k <= EX.length) { closeOverlays(); goTo(+k); }
  });

  window.addEventListener("resize", function () {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    pipe.setSize(innerWidth, innerHeight);
    camera.fov = fovFor(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    if (reflector) { var pr = renderer.getPixelRatio(); reflector.getRenderTarget().setSize(Math.round(innerWidth * pr * 0.5), Math.round(innerHeight * pr * 0.5)); }
    if (dustMat) dustMat.uniforms.uScale.value = renderer.getPixelRatio() * innerHeight * 0.5;
    if (!walk) snapTo(dbg.stop);
  });
  document.addEventListener("visibilitychange", function () { clock.last = performance.now(); });

  /* ---------- per-frame ---------- */
  var roomPos = new THREE.Vector3();
  var perf = { acc: 0, n: 0, checkAt: 4, stage: 0 };
  var noDegrade = /nodegrade|fasttest/.test(location.search);
  var dtCap = /fasttest/.test(location.search) ? 0.6 : 0.05;
  function updateSigns(dt, t) {
    signs.forEach(function (s) {
      var d = Math.abs(camera.position.z - s.z);
      if (!s.powered && d < 26) { s.powered = true; s.t = 0; }
      var o;
      if (!s.powered) o = 0.08;
      else if (reduced) o = 1;
      else {
        s.t += dt;
        if (s.t < 0.9) { var k = s.t / 0.9; o = (Math.sin(s.t * 47) > 0.2 - k ? 1 : 0.15) * (0.4 + 0.6 * k); }
        else o = Math.sin(t * 13 + s.z) > 0.996 ? 0.55 : 1;
      }
      s.meshes.forEach(function (m) { m.material.opacity = o * (m.userData.baseOpacity || 1); });
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(dtCap, (now - clock.last) / 1000);
    clock.last = now;
    if (paused || document.hidden || !renderer) return;
    clock.t += dt;
    var t = clock.t;
    if (walk) updateWalk(dt); else updateRest(dt, t);
    updateViewOffset(dt);
    if (guideMat) guideMat.uniforms.uTime.value = t;
    if (dustMat) dustMat.uniforms.uTime.value = t;
    updateSigns(dt, t);
    rooms.forEach(function (r) {
      r.anchor.getWorldPosition(roomPos);
      var d = Math.abs(camera.position.z - roomPos.z);
      var vis = d < 44;
      r.content.visible = vis;
      r.near = 1 - kit.clamp(d / 30, 0, 1);
      if (r.cone) r.cone.material.uniforms.uOpacity.value = r.cone.material.userData.base * (0.3 + 0.7 * kit.smoothstep(6, 16, d));
      if (vis && d < 32 && r.built && !r.broken) call(r, "update", r.ctx, dt, t, { active: r.active, near: r.near, visible: true });
    });
    renderer.info.reset();
    if (film) { if (!reduced) film.uniforms.uTime.value = t; film.uniforms.uRes.value.set(innerWidth, innerHeight); }
    pipe.render(dt);
    dbg.frameCalls = renderer.info.render.calls; dbg.frameTris = renderer.info.render.triangles;
    // adaptive quality
    perf.acc += dt; perf.n++;
    if (t > perf.checkAt) {
      var avg = perf.acc / perf.n; dbg.fps = Math.round(1 / avg);
      perf.acc = 0; perf.n = 0; perf.checkAt = t + 3;
      if (avg > 1 / 38 && !walk && !noDegrade) degrade();
    }
  }
  function degrade() {
    var pr = renderer.getPixelRatio();
    if (pr > 1.01) { renderer.setPixelRatio(Math.max(1, pr - 0.25)); renderer.setSize(innerWidth, innerHeight, false); pipe.setSize(innerWidth, innerHeight); return; }
    if (reflector) {
      scene.remove(reflector); reflector.getRenderTarget().dispose(); reflector = null;
      floorTop.material.transparent = false; floorTop.material.opacity = 1; floorTop.material.roughness = 0.3; floorTop.material.metalness = 0.65; floorTop.material.needsUpdate = true;
      return;
    }
    if (pipe.bloom && pipe.bloom.enabled && perf.stage++ > 1) { /* keep bloom; it is the look */ }
  }

  /* ---------- boot ---------- */
  function fallbackFlat(msg) {
    $("boot").classList.add("done");
    renderer = null;
    $("hud").hidden = true; $("rail").hidden = true;
    var el = $("flat"); el.hidden = false; overlayOpen = "flat";
    paintFlat(msg);
  }

  kit.injectUICSS();
  paintLobby();
  buildRail();
  boot(0.05, "Loading fonts");
  kit.loadFonts().then(function () {
    boot(0.15, "Building the corridor");
    try { initRenderer(); }
    catch (e) { fallbackFlat("3D is not available on this device, so the museum opens as a page."); throw e; }
    buildCorridor();
    return buildRooms();
  }).then(function () {
    boot(0.95, "Lighting the rooms");
    snapTo(0);
    camera.position.copy(cur.pos); camera.lookAt(cur.look);
    try { renderer.compile(scene, camera); } catch (e) {}
    requestAnimationFrame(frame);
    setTimeout(function () {
      boot(1, "Ready");
      $("boot").classList.add("done");
      showLobby(true);
      $("enterBtn").focus({ preventScroll: true });
      dbg.ready = true;
      if (location.hash === "#map") openOverlay("map");
      if (location.hash === "#page") openOverlay("flat");
    }, 250);
  }).catch(function (e) {
    dbg.errors.push("boot: " + (e && e.message || e));
    if (!$("flat").hidden) return;
    fallbackFlat("The 3D museum could not start here, so it opens as a page.");
  });

  dbg.snap = function (i, label) { snapTo(i); dbg.stop = i; if (label && STOPS[i].kind === "room") showLabel(STOPS[i].n); };
  dbg.look = function (px, py, pz, lx, ly, lz) { cur.pos.set(px, py, pz); cur.look.set(lx, ly, lz); };
  dbg.go = function (i) { closeOverlays(); goTo(i, { force: true }); };
  dbg.enter = function () { $("enterBtn").click(); };
  dbg.openImmersive = openImmersive;
  dbg.closeImmersive = closeImmersive;
  dbg.rooms = rooms;
  dbg.info = function () { return renderer ? { calls: dbg.frameCalls, tris: dbg.frameTris, geo: renderer.info.memory.geometries, tex: renderer.info.memory.textures, pr: renderer.getPixelRatio(), reflector: !!reflector } : null; };
})();
