/* Bấm chuột vào mặt đất → nguyên tử rơi xuống đó → pháo hoa bắn ra mọi phía + một gợn sóng.
 * Yêu cầu: three.js r128 (đã nạp ở index.html) */
(function () {
  'use strict';

  /* ---------------- Cấu hình ---------------- */
  const CFG = {
    maxRipples: 32,         // số gợn sóng hiển thị cùng lúc (sóng cũ đã tắt nên không ảnh hưởng)
    gravityAtom: 24,
    startHeight: 58,
    waveSpeed: 30,          // tốc độ lan của sóng
    groundSize: 420,
    groundSeg: 380,
    maxParticles: 800000,
    sparksPerBurst: 50000,   // số hạt pháo hoa mỗi nguyên tử
    blackHoleAfter: 18,      // thả quá số nguyên tử này (tức cái thứ 17) thì xuất hiện hố đen
    blackHoleLife: 64,       // hố đen tồn tại bao lâu (giây)
    blackHoleRadius: 36,   // bán kính chân trời sự kiện
    blackHoleGap: 6,         // khoảng hở giữa đáy hố đen và mặt đất (càng nhỏ càng sát đất)
    blackHoleHeight: 0, // độ cao tâm hố đen = bán kính + khoảng hở (tự tính, không cần sửa tay)
    blackHolePull: 40000,    // sức hút lên các hạt (càng lớn càng hút mạnh)
    blackHoleFarPull: 0.014,  // tăng lực hút ở vùng xa / rìa ngoài (0 = như cũ, càng lớn rìa ngoài càng bị hút mạnh)
    diskOuter: 3.8,          // mép ngoài vành đai (bội số bán kính hố đen, khớp RingGeometry của đĩa); hạt ngoài mép này bị kéo dần vào
    diskFlat: 3.0,           // độ ép hạt về đúng mặt phẳng vành đai (càng lớn vành đai càng mỏng)
    blackHoleSpin: 1.0       // GIỮ = 1 (quỹ đạo tròn ổn định). >1 sẽ bơm thêm năng lượng khiến hạt trôi dần ra xa vành đai. Muốn quay nhanh hơn thì tăng blackHolePull
  };

  CFG.blackHoleHeight = CFG.blackHoleRadius + CFG.blackHoleGap;   // tâm hố đen = bán kính + khoảng hở → đáy hố đen cách đất đúng 'gap'

  /* ---------------- Renderer / Scene / Camera ---------------- */
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 8000);

  // Điều khiển xoay camera đơn giản (kéo chuột / chạm, lăn để zoom)
  const view = { theta: 0.0, phi: 1.30, radius: 78, target: new THREE.Vector3(0, 10, 0), drag: false, lx: 0, ly: 0 };
  // Con trỏ đang chạm (chuột / ngón tay) — hỗ trợ kéo xoay 1 ngón, chụm 2 ngón để zoom
  const pointers = new Map();
  let pinchDist = 0;
  const pinchDistance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { view.drag = true; view.lx = e.clientX; view.ly = e.clientY; }
    else { view.drag = false; pinchDist = pinchDistance(); }
    canvas.setPointerCapture(e.pointerId);
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) view.drag = false;
    else if (pointers.size === 1) {            // còn 1 ngón → tiếp tục xoay, không bị giật
      const p = [...pointers.values()][0];
      view.drag = true; view.lx = p.x; view.ly = p.y;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {                  // chụm / mở 2 ngón → zoom
      const d = pinchDistance();
      if (pinchDist > 0 && d > 0) view.radius = Math.min(450, Math.max(20, view.radius * (pinchDist / d)));
      pinchDist = d;
      return;
    }
    if (!view.drag) return;
    view.theta -= (e.clientX - view.lx) * 0.005;
    view.phi = Math.min(1.52, Math.max(0.25, view.phi - (e.clientY - view.ly) * 0.005));
    view.lx = e.clientX; view.ly = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    view.radius = Math.min(450, Math.max(20, view.radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pointUniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
  }

  /* ---------------- Ánh sáng ---------------- */
  scene.add(new THREE.AmbientLight(0x6688aa, 0.8));
  const sun = new THREE.DirectionalLight(0xaaccff, 0.7);
  sun.position.set(-30, 60, 40);
  scene.add(sun);

  /* ---------------- Sao nền ---------------- */
  (function makeStars() {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.45 + 0.05;
      const r = 3000;
      pos[i * 3] = Math.cos(u) * Math.cos(v) * r;
      pos[i * 3 + 1] = Math.sin(v) * r;
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  })();

  /* ---------------- Mặt đất: mỗi điểm rơi tạo ĐÚNG MỘT gợn sóng ---------------- */
  const NRIP = CFG.maxRipples;
  let ripCursor = 0;
  const rips = [];
  for (let i = 0; i < NRIP; i++) rips.push(new THREE.Vector3(0, 0, -1e4)); // x, z, thời điểm rơi
  const groundUniforms = {
    uTime: { value: 0 },
    uRip: { value: rips },
    uSpeed: { value: CFG.waveSpeed },
    uAmp: { value: 6.0 },
    uFade: { value: 1 }     // hệ số mở rộng mặt đất theo độ zoom
  };

  const groundMat = new THREE.ShaderMaterial({
    uniforms: groundUniforms,
    transparent: true,
    defines: { NRIP: NRIP },
    vertexShader: /* glsl */`
      uniform float uTime, uSpeed, uAmp;
      uniform vec3 uRip[NRIP];
      varying vec3 vWorld;
      varying float vH;
      varying float vFront;

      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;   // toạ độ thế giới (mặt đất có thể bị scale)
        float h = 0.0, front = 0.0;
        for (int i = 0; i < NRIP; i++) {
          float age = uTime - uRip[i].z;
          if (age > 0.0 && age < 30.0) {
            float d = length(p.xz - uRip[i].xy);
            float x = d - age * uSpeed;          // khoảng cách tới mặt sóng
            float w = 3.0 + age * 0.5;
            float g = exp(-(x * x) / (w * w));   // một gờ sóng duy nhất
            float amp = uAmp * exp(-age * 0.22) / (1.0 + d * 0.025);
            h += g * amp;
            front += g * exp(-age * 0.22);
          }
        }
        p.y += h;
        vH = h; vFront = front;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uFade;
      varying vec3 vWorld;
      varying float vH;
      varying float vFront;

      void main() {
        vec2 g = abs(fract(vWorld.xz / 3.0 - 0.5) - 0.5) / 0.035;
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 g2 = abs(fract(vWorld.xz / 15.0 - 0.5) - 0.5) / 0.012;
        float line2 = 1.0 - min(min(g2.x, g2.y), 1.0);

        vec3 col = vec3(0.025, 0.04, 0.08)
                 + vec3(0.10, 0.35, 0.65) * line * 0.45
                 + vec3(0.2, 0.55, 0.95) * line2 * 0.6;

        float f = clamp(vFront, 0.0, 1.0);
        col += vec3(0.3, 0.75, 1.0) * f * (0.35 + line * 1.6);   // gờ sóng sáng lên
        col += vec3(0.4, 0.8, 1.0) * clamp(vH * 0.25, 0.0, 1.0) * 0.5;

        float dist = length(vWorld.xz);
        gl_FragColor = vec4(col, 1.0 - smoothstep(110.0 * uFade, 205.0 * uFade, dist));
      }`
  });

  const groundGeo = new THREE.PlaneGeometry(CFG.groundSize, CFG.groundSize, CFG.groundSeg, CFG.groundSeg);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.frustumCulled = false;
  scene.add(ground);

  /* ---------------- Hệ hạt (GPU render, CPU cập nhật) ---------------- */
  const MAXP = CFG.maxParticles;
  const pPos = new Float32Array(MAXP * 3);
  const pCol = new Float32Array(MAXP * 3);
  const pSize = new Float32Array(MAXP);
  const pAlpha = new Float32Array(MAXP);
  const pVel = new Float32Array(MAXP * 3);
  const pLife = new Float32Array(MAXP);
  const pMax = new Float32Array(MAXP);
  const pBase = new Float32Array(MAXP);   // kích thước gốc
  const pBC = new Float32Array(MAXP * 3);  // màu gốc của hạt
  const pKind = new Uint8Array(MAXP);     // 0 tia lửa, 1 lửa, 2 bụi, 3 vệt đuôi
  let cursor = 0;

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));

  const pointUniforms = { uScale: { value: 500 } };
  const points = new THREE.Points(pGeo, new THREE.ShaderMaterial({
    uniforms: pointUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uScale; varying vec3 vC; varying float vA;
      void main(){
        vC = aColor; vA = aAlpha;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_PointSize = clamp(aSize*uScale/max(-mv.z,0.1), 1.5, 160.0);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        float a = (core * 0.9 + pow(core, 3.0) * 1.5) * vA;
        gl_FragColor = vec4(vC * a * 1.6 + vec3(pow(core, 4.0) * vA * 0.6), a);
      }`
  }));
  points.frustumCulled = false;
  scene.add(points);

  function spawn(kind, x, y, z, vx, vy, vz, life, size, r, g, b) {
    const i = cursor; cursor = (cursor + 1) % MAXP;
    const i3 = i * 3;
    pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
    pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;
    pLife[i] = life; pMax[i] = life; pBase[i] = size; pKind[i] = kind;
    pBC[i3] = r; pBC[i3 + 1] = g; pBC[i3 + 2] = b;
    pCol[i3] = r; pCol[i3 + 1] = g; pCol[i3 + 2] = b;
    pSize[i] = size; pAlpha[i] = 1;
  }

  const holeData = [];   // dữ liệu hố đen đang hoạt động (cập nhật mỗi khung hình bởi updateHoles)

  function updateParticles(dt) {
    const drag = Math.exp((holeData.length ? -0.003 : -0.12) * dt);   // có hố đen: ma sát yếu để hạt giữ được quỹ đạo
    const dragTrail = Math.exp(-2.0 * dt);
    for (let i = 0; i < MAXP; i++) {
      if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
      pLife[i] -= dt;
      const i3 = i * 3;
      const t = Math.max(pLife[i] / pMax[i], 0);       // 1 → 0
      const k = pKind[i];
      let vx = pVel[i3], vy = pVel[i3 + 1], vz = pVel[i3 + 2];

      if (holeData.length) {          // hố đen hút hạt vào quỹ đạo quay quanh mặt phẳng đĩa
        let swallowed = false;
        for (let h = 0; h < holeData.length; h++) {
          const H = holeData[h];
          const dx = H.x - pPos[i3], dy = H.y - pPos[i3 + 1], dz = H.z - pPos[i3 + 2];   // từ hạt tới tâm
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < H.kill2) { swallowed = true; break; }       // chạm chân trời sự kiện → bị nuốt
          const d = Math.sqrt(d2);
          const ux = dx / d, uy = dy / d, uz = dz / d;          // hướng về tâm
          const acc = H.pull / (d2 + H.soft) * (1 + d * CFG.blackHoleFarPull);   // gia tốc hướng tâm (ở xa suy giảm chậm hơn → hút cả rìa ngoài)
          vx += ux * acc * dt; vy += uy * acc * dt; vz += uz * acc * dt;

          // ép hạt về đúng mặt phẳng vành đai: lò xo kéo về mặt phẳng + triệt vận tốc theo pháp tuyến đĩa
          const hp = -(dx * H.nx + dy * H.ny + dz * H.nz);      // độ cao của hạt so với mặt phẳng đĩa
          const ks = CFG.diskFlat * H.s * dt;
          vx -= H.nx * hp * ks; vy -= H.ny * hp * ks; vz -= H.nz * hp * ks;
          const vn = vx * H.nx + vy * H.ny + vz * H.nz, fl = Math.min(1.2 * CFG.diskFlat * H.s * dt, 0.5);
          vx -= H.nx * vn * fl; vy -= H.ny * vn * fl; vz -= H.nz * vn * fl;

          // lực xoáy: cùng chiều quay với đĩa, đẩy vận tốc tiếp tuyến lên đến vận tốc quỹ đạo tròn
          let tx = dy * H.nz - dz * H.ny, ty = dz * H.nx - dx * H.nz, tz = dx * H.ny - dy * H.nx;
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
          const vc = Math.sqrt(acc * d) * CFG.blackHoleSpin;    // vận tốc quỹ đạo tại khoảng cách này (nhân hệ số quay)
          if (tl > 1e-3 && vc > 1e-3) {
            tx /= tl; ty /= tl; tz /= tl;
            const vt = vx * tx + vy * ty + vz * tz;
            let vcT = vc, fMin = 0;
            const outer = H.R * CFG.diskOuter;                  // mép ngoài vành đai
            if (d > outer) {                                    // hạt ngoài vành đai: quay chậm hơn quỹ đạo tròn → rơi dần vào vành đai
              const kk = Math.min((d - outer) / (outer * 0.35), 1);
              vcT = vc * (1 - 0.45 * kk); fMin = -1;
            }
            const f = Math.min(Math.max((vcT - vt) / vc, fMin), 1);
            const at = 2.2 * acc * f * dt;
            vx += tx * at; vy += ty * at; vz += tz * at;
          }

          // tròn hóa quỹ đạo: giảm dần thành phần vận tốc hướng tâm / ly tâm
          const vr = vx * ux + vy * uy + vz * uz, cr = 0.25 * dt;
          vx -= ux * vr * cr; vy -= uy * vr * cr; vz -= uz * vr * cr;
        }
        if (swallowed) { pLife[i] = 0; pAlpha[i] = 0; continue; }
      }

      if (k === 0) {                  // hạt pháo hoa: nở ra rồi rơi xuống
        
        vx *= drag; vy *= drag; vz *= drag;
      } else {                        // đuôi nguyên tử
        vx *= dragTrail; vy *= dragTrail; vz *= dragTrail;
      }

      let x = pPos[i3] + vx * dt, y = pPos[i3 + 1] + vy * dt, z = pPos[i3 + 2] + vz * dt;
      if (y < 0.1 && k !== 0) { y = 0.1; vy = -vy * 0.3; vx *= 0.7; vz *= 0.7; }
      pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
      pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;

      if (k === 0) {
        // lúc đầu trắng rực, rồi về màu của chùm pháo hoa, nhấp nháy khi tàn
        const w = Math.max(0, 1 - (1 - t) * 7);
        pCol[i3]     = pBC[i3]     + (1 - pBC[i3])     * w;
        pCol[i3 + 1] = pBC[i3 + 1] + (1 - pBC[i3 + 1]) * w;
        pCol[i3 + 2] = pBC[i3 + 2] + (1 - pBC[i3 + 2]) * w;
        const tw = t < 0.35 ? 0.55 + 0.45 * Math.sin(pLife[i] * 40 + i) : 1;
        pSize[i] = pBase[i] * (0.5 + 0.5 * t + w);
        pAlpha[i] = Math.pow(t, 0.6) * tw;
      } else {
        pSize[i] = pBase[i] * t; pAlpha[i] = t * 0.9;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ---------------- Nguyên tử ---------------- */
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(160,210,255,0.55)'); g.addColorStop(1, 'rgba(60,120,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = glowTexture();

  // tài nguyên dùng chung cho mọi nguyên tử (để thả bao nhiêu cũng nhẹ)
  const SH = {
    nuc: new THREE.SphereGeometry(0.55, 16, 12),
    torus: new THREE.TorusGeometry(4.2, 0.04, 8, 96),
    elec: new THREE.SphereGeometry(0.32, 12, 10),
    pm: new THREE.MeshPhongMaterial({ color: 0xff4a3a, emissive: 0x551008, shininess: 80 }),
    nm: new THREE.MeshPhongMaterial({ color: 0x4aa8ff, emissive: 0x0a2a55, shininess: 80 }),
    ring: new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    glow: new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
  };
  const nucleusOffsets = [];
  for (let i = 0; i < 12; i++) nucleusOffsets.push(new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(Math.random() * 0.8));

  function createAtom() {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const electrons = [];
    nucleusOffsets.forEach((v, i) => {
      const m = new THREE.Mesh(SH.nuc, i % 2 ? SH.pm : SH.nm);
      m.position.copy(v); inner.add(m);
    });
    const glow = new THREE.Sprite(SH.glow);
    glow.scale.set(9, 9, 1); inner.add(glow);

    const tilts = [[Math.PI / 2, 0], [Math.PI / 3, Math.PI / 3], [-Math.PI / 3, 2 * Math.PI / 3]];
    tilts.forEach((t, idx) => {
      const orbit = new THREE.Group();
      orbit.rotation.set(t[0], t[1], 0);
      orbit.add(new THREE.Mesh(SH.torus, SH.ring));
      const e = new THREE.Group();
      e.add(new THREE.Mesh(SH.elec, SH.white));
      const eg = new THREE.Sprite(SH.glow);
      eg.scale.set(3, 3, 1); e.add(eg);
      orbit.add(e);
      electrons.push({ obj: e, R: 4.2, phase: idx * 2.1 + Math.random() * 6, speed: 5 + idx });
      inner.add(orbit);
    });
    scene.add(group);
    return { group, inner, electrons, vy: 0 };
  }

  /* ---------------- Hố đen vũ trụ ---------------- */
  const BH = {
    sphere: new THREE.SphereGeometry(1, 48, 32),
    disk: new THREE.RingGeometry(1.6, 4, 130, 1),
    photon: new THREE.RingGeometry(1.03, 1.14, 96),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    diskMat: new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vP; uniform float uTime;
        void main(){
          float r = length(vP);
          float t = clamp((r - 1.3) / 2.3, 0.0, 1.0);
          float a = atan(vP.y, vP.x);
          float spin = a * 5.0 - uTime * (6.0 / (0.6 + r)) + r * 7.0;   // phía trong quay nhanh hơn
          float arms = 0.55 + 0.45 * sin(spin) * sin(spin * 0.5 + r * 3.0);
          float fine = 0.75 + 0.25 * sin(a * 23.0 + r * 40.0 - uTime * 4.0);
          float body = pow(1.0 - t, 1.6) * smoothstep(0.0, 0.06, t) ;
          vec3 hot = vec3(1.0, 0.95, 0.85), mid = vec3(1.0, 0.5, 0.15), cold = vec3(0.45, 0.15, 0.7);
          vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, t));
          col = mix(col, cold, smoothstep(0.45, 1.0, t));
          float al = body * arms * fine * 1.5;
          gl_FragColor = vec4(col, al);
        }`
    }),
    photonMat: new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    glow: new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a50, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })
  };
  const holes = [];

  function spawnBlackHole(x, z) {
    if (holes.length >= 4) holes[0].age = Math.max(holes[0].age, CFG.blackHoleLife - 4);   // quá nhiều → cái cũ nhất tan dần
    const group = new THREE.Group();
    group.position.set(x, CFG.blackHoleHeight, z);
    group.add(new THREE.Mesh(BH.sphere, BH.black));
    const glow = new THREE.Sprite(BH.glow); glow.scale.set(8, 8, 1); group.add(glow);
   const tilt = new THREE.Group();
tilt.rotation.set(
    THREE.MathUtils.degToRad(0),  // X: 55 độ
    THREE.MathUtils.degToRad(0),  // Y: 25 độ
    THREE.MathUtils.degToRad(0)   // Z: 35 độ
);
    const disk = new THREE.Mesh(BH.disk, BH.diskMat); disk.rotation.x = -Math.PI / 2; tilt.add(disk);
    group.add(tilt);
    const photon = new THREE.Mesh(BH.photon, BH.photonMat); group.add(photon);
    group.scale.setScalar(0.001);
    scene.add(group);
    const nrm = new THREE.Vector3(0, 1, 0).applyEuler(tilt.rotation);   // pháp tuyến mặt phẳng đĩa
    holes.push({ group, photon, x, y: CFG.blackHoleHeight, z, age: 0, nx: nrm.x, ny: nrm.y, nz: nrm.z });
  }

  function updateHoles(dt) {
    BH.diskMat.uniforms.uTime.value = state.simT;
    holeData.length = 0;
    for (let n = holes.length - 1; n >= 0; n--) {
      const H = holes[n];
      H.age += dt;
      if (H.age >= CFG.blackHoleLife) { scene.remove(H.group); holes.splice(n, 1); continue; }
      const grow = Math.min(H.age / 4, 1), fade = Math.min((CFG.blackHoleLife - H.age) / 4, 1);
      const s = (grow * grow * (3 - 2 * grow)) * (fade * fade * (3 - 2 * fade));   // lớn dần rồi nhỏ dần
      const R = CFG.blackHoleRadius * Math.max(s, 0.001);
      H.group.scale.setScalar(R);
      H.photon.quaternion.copy(camera.quaternion);                 // vòng sáng luôn hướng về camera
      H.photon.quaternion.premultiply(H.group.quaternion.clone().invert());
      holeData.push({ x: H.x, y: H.y, z: H.z, nx: H.nx, ny: H.ny, nz: H.nz, pull: CFG.blackHolePull * s, soft: 40 + 0.5 * R * R, R: R, s: s, kill2: (R * 1.05) * (R * 1.05) });
    }
  }

  /* ---------------- Trạng thái ---------------- */
  const state = { simT: 0, dropCount: 0 };
  const atoms = [];       // các nguyên tử đang rơi (không giới hạn số lượng)
  const pool = [];        // nguyên tử đã dùng xong, tái sử dụng

  function hsl(h, s, l) { const c = new THREE.Color(); c.setHSL(h, s, l); return c; }

  // thả một nguyên tử xuống vị trí (x, z) trên mặt đất
  function dropAt(x, z) {
    const a = pool.pop() || createAtom();
    a.vy = 0;
    a.makeHole = false;
    if (++state.dropCount > CFG.blackHoleAfter) { a.makeHole = true; state.dropCount = 0; }   // nguyên tử thứ 13 → sẽ sinh hố đen
    a.group.visible = true;
    a.group.position.set(x, CFG.startHeight, z);
    atoms.push(a);
  }

  // pháo hoa: các hạt bắn ra mọi phía theo hình cầu
  function firework(P) {
    const c1 = hsl(0.60, 1, 0.58), c2 = hsl(0.56, 1, 0.62);   // toàn bộ màu xanh dương
    const base = 36 + Math.random() * 10;   // tốc độ nổ lớn hơn → hạt lan xa hơn
    const cy = 12;
    for (let i = 0; i < CFG.sparksPerBurst; i++) {
      // hướng ngẫu nhiên đều trên mặt cầu
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      let dx = Math.cos(a) * r, dy = u, dz = Math.sin(a) * r;
      if (dy < 0) dy *= 0.7;
      const sp = base * (0.85 + Math.random() * 0.3) * (Math.random() < 0.15 ? 0.45 : 1);
      const c = Math.random() < 0.7 ? c1 : c2;
      spawn(0, P.x, cy, P.z, dx * sp, dy * sp, dz * sp,
        50 + Math.random() * 20, 1.7 + Math.random() * 0.9, c.r, c.g, c.b);
    }
  }

  function stepSim(dt) {
    state.simT += dt;

    for (let n = atoms.length - 1; n >= 0; n--) {
      const a = atoms[n], P = a.group.position;
      a.vy += CFG.gravityAtom * dt;
      P.y -= a.vy * dt;
      a.inner.rotation.y += dt * 2.0;
      a.inner.rotation.x += dt * 1.2;
      a.electrons.forEach(e => {
        const ang = state.simT * e.speed + e.phase;
        e.obj.position.set(Math.cos(ang) * e.R, Math.sin(ang) * e.R, 0);
      });
      for (let i = 0; i < 8; i++) {                  // đuôi sáng phía trên
        const ang = Math.random() * 6.283, r = Math.random() * 1.6;
        spawn(3, P.x + Math.cos(ang) * r, P.y + 1 + Math.random() * 3, P.z + Math.sin(ang) * r,
          (Math.random() - .5) * 3, 8 + Math.random() * 6, (Math.random() - .5) * 3,
          0.5 + Math.random() * 0.5, 1.2 + Math.random() * 1.2, 0.6, 0.85, 1);
      }
      if (P.y <= 0.8) {                              // chạm đất
        rips[ripCursor].set(P.x, P.z, state.simT);   // 1 gợn sóng (vòng tròn slot)
        ripCursor = (ripCursor + 1) % NRIP;
        firework(P);                                 // pháo hoa
        if (a.makeHole) spawnBlackHole(P.x, P.z);    // đủ số nguyên tử → hố đen xuất hiện
        a.group.visible = false;
        pool.push(a);
        atoms[n] = atoms[atoms.length - 1]; atoms.pop();
      }
    }
    updateHoles(dt);
    updateParticles(dt);
    groundUniforms.uTime.value = state.simT;
  }

  /* ---------------- Vòng lặp ---------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    stepSim(dt);

    // mặt đất mở rộng theo độ zoom → zoom xa vẫn thấy đất trải dài tới chân trời
    const gk = Math.max(1, view.radius / 90);
    ground.scale.set(gk, 1, gk);
    groundUniforms.uFade.value = gk;

    const sinP = Math.sin(view.phi);
    camera.position.set(
      view.target.x + view.radius * sinP * Math.sin(view.theta),
      view.target.y + view.radius * Math.cos(view.phi),
      view.target.z + view.radius * sinP * Math.cos(view.theta));
    camera.lookAt(view.target);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  /* ---------------- Điều khiển ---------------- */
  // bấm chuột (không kéo) vào mặt đất → nguyên tử rơi xuống đúng chỗ đó
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = pointers.size > 1 ? null : { x: e.clientX, y: e.clientY }; });   // chụm 2 ngón thì không tính là chạm
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }   // là kéo xoay, bỏ qua
    down = null;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit) && Math.hypot(hit.x, hit.z) < 190) dropAt(hit.x, hit.z);
  });
  window.addEventListener('resize', resize);

  resize();
  requestAnimationFrame(frame);
})();
