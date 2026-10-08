// Vista 3D del circuito de Maspalomas para la vuelta de ejemplo: casco, detrás o desde arriba.
// Coordenadas del trazado en metros (x hacia el este, y hacia el sur) → mundo 3D (x, altura, z = y).
(function (root) {
  "use strict";
  const WIDTH = 12;
  // Ángulo vertical mínimo y ángulo horizontal deseado por cámara: con el móvil de pie
  // el vertical crece (hasta 95°) para no ver la pista por una rendija.
  const FOV = { casco: 74, detras: 58, arriba: 45 };
  const HFOV = { casco: 105, detras: 85, arriba: 70 };
  const fovFor = (mode, aspect) => {
    const t = Math.tan((HFOV[mode] * Math.PI) / 360) / (aspect || 1);
    const v = (Math.atan(t) * 360) / Math.PI;
    return Math.round(Math.max(FOV[mode], Math.min(95, v)));
  };

  function create(container, track, opts) {
    const THREE = root.THREE;
    if (!THREE || !container) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
    } catch (e) {
      return null;
    }
    if (!renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.domElement.className = "v3d-canvas";
    container.prepend(renderer.domElement);

    const C = track.C;
    const n = C.length;
    // Centro del circuito como origen (números pequeños para la GPU).
    let cx = 0;
    let cy = 0;
    for (const p of C) {
      cx += p[0] / n;
      cy += p[1] / n;
    }
    const W = (x, y) => [x - cx, y - cy];

    const scene = new THREE.Scene();
    const sky = new THREE.Color(0xbcd7ea);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 900, 2600);
    const camera = new THREE.PerspectiveCamera(FOV.casco, 16 / 9, 0.2, 5000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f7a, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.5);
    sun.position.set(-300, 600, 250);
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshLambertMaterial({ color: 0xd9cba8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);

    const N = track.N;
    // Cinta entre dos desplazamientos laterales para los índices dados (con color por tramo opcional).
    function ribbon(P, NN, idx, d0, d1, y, colorAt) {
      const pos = [];
      const col = [];
      for (let k = 0; k < idx.length - 1; k++) {
        const i = idx[k];
        const j = idx[k + 1];
        const a0 = W(P[i][0] + NN[i][0] * d0, P[i][1] + NN[i][1] * d0);
        const a1 = W(P[i][0] + NN[i][0] * d1, P[i][1] + NN[i][1] * d1);
        const b0 = W(P[j][0] + NN[j][0] * d0, P[j][1] + NN[j][1] * d0);
        const b1 = W(P[j][0] + NN[j][0] * d1, P[j][1] + NN[j][1] * d1);
        pos.push(a0[0], y, a0[1], b0[0], y, b0[1], a1[0], y, a1[1]);
        pos.push(a1[0], y, a1[1], b0[0], y, b0[1], b1[0], y, b1[1]);
        if (colorAt) {
          const c = colorAt(k);
          for (let r = 0; r < 6; r++) col.push(c.r, c.g, c.b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (colorAt)
        geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      return geo;
    }
    const loop = [];
    for (let i = 0; i <= n; i++) loop.push(i % n);
    const half = WIDTH / 2;
    const flat = (color, extra) =>
      new THREE.MeshBasicMaterial(
        Object.assign({ color, side: THREE.DoubleSide }, extra || {}),
      );
    scene.add(
      new THREE.Mesh(
        ribbon(C, N, loop, -half, half, 0, null),
        new THREE.MeshLambertMaterial({
          color: 0x353c42,
          side: THREE.DoubleSide,
        }),
      ),
    );
    for (const d of [-half + 0.25, half - 0.55])
      scene.add(
        new THREE.Mesh(
          ribbon(C, N, loop, d, d + 0.3, 0.02, null),
          flat(0xf4f6f7),
        ),
      );
    // Pianos en las curvas: por dentro y por fuera, rojo y blanco.
    const red = new THREE.Color(0xd2382d);
    const white = new THREE.Color(0xffffff);
    const A = root.MaspaAnalysis;
    for (const c of opts.corners || []) {
      const ci = Math.round(c.i !== undefined ? c.i : 0);
      const turn = A ? A.frame(C, ci).turn : 1;
      for (const [span, side] of [
        [10, -1],
        [5, 1],
      ]) {
        const idx = [];
        for (let j = ci - span; j <= ci + span; j++)
          idx.push(((j % n) + n) % n);
        const s = side * turn;
        const d0 = s > 0 ? half : -half - 1.4;
        const d1 = s > 0 ? half + 1.4 : -half;
        scene.add(
          new THREE.Mesh(
            ribbon(C, N, idx, d0, d1, 0.03, (k) => (k % 2 ? white : red)),
            flat(0xffffff, { vertexColors: true }),
          ),
        );
      }
    }
    // Barreras de neumáticos a los lados (dan referencia de profundidad desde el casco).
    for (const d of [-half - 3.5, half + 3.5]) {
      const pos = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = W(C[i][0] + N[i][0] * d, C[i][1] + N[i][1] * d);
        const b = W(C[j][0] + N[j][0] * d, C[j][1] + N[j][1] * d);
        pos.push(a[0], 0, a[1], b[0], 0, b[1], a[0], 0.9, a[1]);
        pos.push(a[0], 0.9, a[1], b[0], 0, b[1], b[0], 0.9, b[1]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      scene.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshLambertMaterial({
            color: 0x3a3f44,
            side: THREE.DoubleSide,
          }),
        ),
      );
    }

    // Puntos sobre el trazado por distancia s (eje o trazada ideal).
    function pointAt(P, s) {
      const L = track.L;
      const ss = ((s % L) + L) % L;
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (track.cs[mid] <= ss) lo = mid;
        else hi = mid;
      }
      const a = P[lo];
      const b = P[(lo + 1) % n];
      const f = (ss - track.cs[lo]) / (track.cs[lo + 1] - track.cs[lo] || 1);
      return {
        x: a[0] + (b[0] - a[0]) * f,
        y: a[1] + (b[1] - a[1]) * f,
        i: lo,
      };
    }
    // Línea de meta y de sectores (franjas a lo ancho).
    function gate(s, color, w) {
      const p = pointAt(C, s);
      const i = p.i;
      const j = (i + 1) % n;
      const g = new THREE.Mesh(
        ribbon(C, N, [i, j], -half, half, 0.04, null),
        flat(color),
      );
      if (w) g.scale.set(1, 1, 1);
      scene.add(g);
    }
    gate(0, 0xffffff);
    for (const b of opts.bounds || []) gate(b, 0xf2c230);
    // Carteles de frenada (de la mejor vuelta): tablero rojo a la derecha de la pista.
    const boards = new THREE.Group();
    scene.add(boards);
    function setBrakes(list) {
      while (boards.children.length) {
        const o = boards.children.pop();
        o.geometry.dispose();
        o.material.dispose();
      }
      for (const s of list || []) {
        if (s === null || s === undefined) continue;
        const p = pointAt(C, s);
        const nn = N[p.i];
        const w = W(p.x + nn[0] * (half + 2.2), p.y + nn[1] * (half + 2.2));
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 1.6, 1.6),
          new THREE.MeshBasicMaterial({ color: 0xd2382d }),
        );
        m.position.set(w[0], 1.6, w[1]);
        const a = Math.atan2(nn[1], nn[0]);
        m.rotation.y = -a;
        boards.add(m);
      }
    }

    // Moto (para las cámaras de detrás y de arriba).
    const bike = new THREE.Group();
    const lean = new THREE.Group();
    bike.add(lean);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.75, 0.62),
      new THREE.MeshLambertMaterial({ color: 0x2b80dd }),
    );
    body.position.set(0, 0.85, 0);
    lean.add(body);
    const rider = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.6, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf4f6f7 }),
    );
    rider.position.set(-0.25, 1.45, 0);
    lean.add(rider);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0x2b80dd }),
    );
    head.position.set(0.25, 1.85, 0);
    lean.add(head);
    const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1d20 });
    for (const x of [-0.78, 0.78]) {
      const w = new THREE.Mesh(wheel, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.33, 0);
      lean.add(w);
    }
    const halo = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.1, 28),
      new THREE.MeshBasicMaterial({
        color: 0x2b80dd,
        transparent: true,
        opacity: 0.55,
      }),
    );
    halo.position.y = 0.06;
    bike.add(halo);
    scene.add(bike);

    const view = {
      mode: "casco",
      init: false,
      pos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      roll: 0,
    };

    // pose: { s (m desde meta), lean (grados, + derecha) }. Se va por la trazada ideal.
    function update(pose, dt) {
      const P = track.full || C;
      const p = pointAt(P, pose.s);
      const q = pointAt(P, pose.s + 4);
      const heading = Math.atan2(q.y - p.y, q.x - p.x);
      const w = W(p.x, p.y);
      const leanRad =
        ((pose.lean === pose.lean ? pose.lean : 0) * Math.PI) / 180;
      bike.position.set(w[0], 0, w[1]);
      bike.rotation.y = -heading;
      lean.rotation.x = leanRad;
      halo.visible = view.mode === "arriba";
      bike.visible = view.mode !== "casco";
      const fx = Math.cos(heading);
      const fz = Math.sin(heading);
      // Las cámaras van atadas a puntos del trazado (no persiguen a la moto con retraso):
      // a ×4 un seguimiento suavizado se quedaba 40 m atrás y cruzaba las barreras.
      const along = (ds, y) => {
        const q2 = pointAt(P, pose.s + ds);
        const a = W(q2.x, q2.y);
        return new THREE.Vector3(a[0], y, a[1]);
      };
      let pos;
      let look;
      let roll = 0;
      if (view.mode === "arriba") {
        pos = along(-90, 230);
        look = along(45, 0);
      } else if (view.mode === "detras") {
        pos = along(-13, 5);
        look = along(24, 1);
      } else {
        // Casco: la cabeza se desplaza hacia dentro de la curva y mira hacia donde va la moto.
        const rx = -fz;
        const rz = fx;
        const side = Math.sin(leanRad) * 1.05;
        const up = 0.45 + Math.cos(leanRad) * 1.05;
        pos = new THREE.Vector3(
          w[0] + fx * 0.25 + rx * side,
          up,
          w[1] + fz * 0.25 + rz * side,
        );
        look = along(Math.max(18, (pose.v || 20) * 0.9), 0.9);
        // El piloto endereza algo la cabeza: el horizonte gira menos que la moto.
        roll = -leanRad * 0.55;
      }
      // Solo se suaviza el giro del horizonte; posición y mirada siguen exactas a la moto.
      const k = 1 - Math.exp(-(dt || 0.016) / 0.12);
      view.pos.copy(pos);
      view.look.copy(look);
      view.roll = view.init ? view.roll + (roll - view.roll) * k : roll;
      view.init = true;
      camera.position.copy(view.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(view.look);
      if (view.mode === "casco") camera.rotateZ(view.roll);
      renderer.render(scene, camera);
    }

    function resize() {
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = fovFor(view.mode, camera.aspect);
      camera.updateProjectionMatrix();
    }
    function setMode(m) {
      view.mode = FOV[m] ? m : "casco";
      view.init = false;
      camera.fov = fovFor(view.mode, camera.aspect);
      camera.updateProjectionMatrix();
    }
    function dispose() {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    }
    let ro = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(resize);
      ro.observe(container);
    }
    resize();
    return {
      update,
      resize,
      setMode,
      setBrakes,
      dispose: () => {
        if (ro) ro.disconnect();
        dispose();
      },
      get mode() {
        return view.mode;
      },
      // Para pruebas: dónde está la cámara y hacia dónde mira.
      debug: () => ({
        pos: camera.position.toArray().map((x) => Math.round(x * 10) / 10),
        look: view.look.toArray().map((x) => Math.round(x * 10) / 10),
        bike: bike.position.toArray().map((x) => Math.round(x * 10) / 10),
        fov: camera.fov,
      }),
    };
  }

  root.MaspaVista3D = { create };
})(typeof window !== "undefined" ? window : globalThis);
