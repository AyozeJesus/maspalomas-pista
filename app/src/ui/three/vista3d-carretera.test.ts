// @vitest-environment jsdom
// La vista 3D con un trazado abierto (una ruta por carretera, sacada de su trazada) y la moto del repaso (luz de
// freno y caballito). El circuito de siempre no cambia: lo comprueba vista3d.test.ts contra la vista de antes.
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeRenderer, resourcesOf } from "../../../test/legacy-three";
import { routePath } from "../replay3d/route-path";
import * as V from "./vista3d";

type P = { x: number; y: number; gap: boolean };

// Recta al este, curva a derechas, recta al sur, curva a izquierdas y recta al este: un punto cada 3 m. scale alarga
// las rectas (para rutas largas).
function sRoute(scale = 1): P[] {
  const out: P[] = [];
  let x = 0;
  let y = 0;
  let h = 0;
  const go = (len: number) => {
    for (let d = 0; d < len; d += 3) {
      out.push({ x, y, gap: false });
      x += 3 * Math.cos(h);
      y += 3 * Math.sin(h);
    }
  };
  const turn = (r: number, deg: number) => {
    const steps = Math.round(((Math.abs(deg) * Math.PI) / 180) * (r / 3));
    for (let k = 0; k < steps; k++) {
      out.push({ x, y, gap: false });
      h += (deg * Math.PI) / 180 / steps;
      x += 3 * Math.cos(h);
      y += 3 * Math.sin(h);
    }
  };
  go(300 * scale);
  turn(60, 90);
  go(200 * scale);
  turn(40, -90);
  go(300 * scale);
  out.push({ x, y, gap: false });
  return out;
}

function roadTrack(scale = 1): V.Vista3DTrack {
  const r = routePath(sRoute(scale));
  if (!r) throw new Error("sin carretera");
  return r.track;
}

function make(
  track: V.Vista3DTrack,
  opts: V.Vista3DOptions,
): { view: V.Vista3D; renderer: FakeRenderer; box: HTMLDivElement } {
  const box = document.createElement("div");
  const made: FakeRenderer[] = [];
  const view = V.create(box, track, opts, (params) => {
    const r = new FakeRenderer(params);
    made.push(r);
    return r;
  });
  if (!view) throw new Error("no se ha creado la vista");
  return { view, renderer: made[0], box };
}

function sceneOf(r: FakeRenderer): THREE.Scene {
  if (!r.scene) throw new Error("sin pintar");
  return r.scene as THREE.Scene;
}

const meshes = (s: THREE.Scene, name: string): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  s.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
};

function colorOf(m: THREE.Mesh): number {
  return (m.material as THREE.MeshBasicMaterial).color.getHex();
}

// Las motos: grupos con su halo (cilindro de 6 m) dentro; la primera es la del piloto.
function bikes(s: THREE.Scene): THREE.Group[] {
  return s.children.filter(
    (o): o is THREE.Group =>
      o instanceof THREE.Group &&
      o.children.some(
        (c) =>
          c instanceof THREE.Mesh &&
          c.geometry instanceof THREE.CylinderGeometry &&
          c.geometry.parameters.radiusTop === 6,
      ),
  );
}

const finite = (a: readonly number[]) => a.every((x) => Number.isFinite(x));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vista 3D de una carretera (trazado abierto)", () => {
  it("asfalto, líneas, hitos, salida y llegada; sin pianos ni barreras", () => {
    const track = roadTrack();
    const { view, renderer } = make(track, { style: "carretera" });
    view.update({ s: 10, lean: 0, v: 20 }, 0.016);
    const s = sceneOf(renderer);
    expect(meshes(s, "asfalto").length).toBeGreaterThan(0);
    expect(meshes(s, "marcas").length).toBe(meshes(s, "asfalto").length);
    expect(meshes(s, "hitos").length).toBeGreaterThan(0);
    expect(meshes(s, "salida").length).toBe(1);
    expect(meshes(s, "llegada").length).toBe(1);
    // Nada del circuito: ni barreras (gris oscuro) ni pianos (colores por vértice).
    let barriers = 0;
    let pianos = 0;
    s.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshLambertMaterial;
      if (m.color && m.color.getHex() === 0x3a3f44) barriers++;
      if (m.vertexColors) pianos++;
    });
    expect(barriers).toBe(0);
    expect(pianos).toBe(0);
    // El asfalto mide 7 m de ancho: dos carriles.
    const geo = meshes(s, "asfalto")[0].geometry;
    const pos = geo.getAttribute("position");
    const w = Math.hypot(pos.getX(2) - pos.getX(0), pos.getZ(2) - pos.getZ(0));
    expect(w).toBeCloseTo(7, 1);
  });

  it("más allá de la salida y de la llegada sigue en línea recta: cámaras y moto sin números raros", () => {
    const track = roadTrack();
    const L = track.L;
    const { view, renderer } = make(track, { style: "carretera", extras: true });
    for (const mode of ["casco", "detras", "arriba"] as V.Vista3DMode[]) {
      view.setMode(mode);
      for (const s of [-30, 0, 1, L / 2, L - 1, L, L + 30]) {
        view.update({ s, lean: 25, v: 30, brake: s > L / 2, pitch: 0 }, 0.016);
        const d = view.debug();
        expect(finite(d.pos) && finite(d.look) && finite(d.bike), `${mode} s=${s}`).toBe(true);
      }
    }
    const main = bikes(sceneOf(renderer))[0];
    // Antes de la salida, 30 m hacia atrás por la primera recta (al oeste); la moto mira al este.
    view.update({ s: -30, lean: 0 }, 0.016);
    const before = view.debug().bike;
    view.update({ s: 0, lean: 0 }, 0.016);
    const start = view.debug().bike;
    expect(start[0] - before[0]).toBeCloseTo(30, 0);
    expect(start[2] - before[2]).toBeCloseTo(0, 0);
    expect(main.rotation.y).toBeCloseTo(0, 6);
    // En la llegada (y pasada) sigue mirando hacia donde iba (al este), no da la vuelta.
    view.update({ s: L, lean: 0 }, 0.016);
    expect(Math.cos(main.rotation.y)).toBeGreaterThan(0.99);
    view.update({ s: L + 30, lean: 0 }, 0.016);
    expect(Math.cos(main.rotation.y)).toBeGreaterThan(0.99);
  });

  it("una ruta larga va en trozos (lo que queda fuera de la vista no se dibuja)", () => {
    const track = roadTrack(12);
    expect(track.C.length).toBeGreaterThan(2500);
    const { view, renderer } = make(track, { style: "carretera" });
    view.update({ s: 100, lean: 0, v: 20 }, 0.016);
    const s = sceneOf(renderer);
    const parts = meshes(s, "asfalto");
    expect(parts.length).toBeGreaterThan(8);
    for (const m of parts) {
      expect(m.frustumCulled).toBe(true);
      m.geometry.computeBoundingSphere();
      expect(m.geometry.boundingSphere?.radius ?? Infinity).toBeLessThan(800);
    }
    // El suelo cubre toda la ruta.
    const ground = s.children.find(
      (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry,
    );
    if (!ground) throw new Error("sin suelo");
    const box = new THREE.Box3();
    for (const m of parts) box.expandByObject(m);
    const size = (ground.geometry as THREE.PlaneGeometry).parameters.width;
    expect(size / 2).toBeGreaterThan(
      Math.max(...box.min.toArray().map(Math.abs), ...box.max.toArray().map(Math.abs)),
    );
  });

  it("luz de freno y caballito (extras): se encienden y cabecea sobre la rueda de atrás", () => {
    const { view, renderer } = make(roadTrack(), { style: "carretera", extras: true });
    view.update({ s: 50, lean: 0, v: 20, brake: true }, 0.016);
    const s = sceneOf(renderer);
    const [main] = bikes(s);
    const light = meshes(s, "luz-freno").filter((m) => {
      let p: THREE.Object3D | null = m;
      while (p && p !== main) p = p.parent;
      return p === main;
    });
    expect(light.length).toBe(1);
    const on = colorOf(light[0]);
    view.update({ s: 51, lean: 0, v: 20, brake: false }, 0.016);
    const off = colorOf(light[0]);
    expect(on).not.toBe(off);
    const pitch = main.getObjectByName("cabeceo");
    if (!pitch) throw new Error("sin cabeceo");
    view.update({ s: 52, lean: 0, v: 20, pitch: 20 }, 0.016);
    expect(pitch.rotation.z).toBeCloseTo((20 * Math.PI) / 180, 9);
    // La rueda de atrás no se mete en el suelo: el giro va sobre su eje.
    expect(pitch.position.x).toBeCloseTo(-0.78, 9);
    view.update({ s: 53, lean: 0, v: 20 }, 0.016);
    expect(pitch.rotation.z).toBe(0);
  });

  it("el suelo se dibuja el primero y no apunta profundidad: no puede tapar el asfalto (ni en el circuito)", () => {
    for (const t of [roadTrack(4), { ...roadTrack(), closed: undefined }]) {
      const { view, renderer } = make(t as V.Vista3DTrack, {});
      view.update({ s: 300, lean: 0, v: 25 }, 0.016);
      const ground = sceneOf(renderer).children.find(
        (o): o is THREE.Mesh =>
          o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry,
      );
      if (!ground) throw new Error("sin suelo");
      expect((ground.material as THREE.Material).depthWrite).toBe(false);
      expect(ground.renderOrder).toBe(-1);
    }
  });

  it("sin extras, la moto es la de siempre (sin luz de freno ni cabeceo)", () => {
    const { view, renderer } = make(roadTrack(), { style: "carretera" });
    view.update({ s: 50, lean: 0, v: 20, brake: true, pitch: 15 }, 0.016);
    const s = sceneOf(renderer);
    expect(meshes(s, "luz-freno").length).toBe(0);
    expect(s.getObjectByName("cabeceo")).toBeUndefined();
  });

  it("dispose suelta todas las geometrías y materiales, el renderizador y el lienzo", () => {
    const { view, renderer, box } = make(roadTrack(3), { style: "carretera", extras: true });
    view.update({ s: 500, lean: 15, v: 40 }, 0.016);
    const spies = resourcesOf(sceneOf(renderer)).map((r) => vi.spyOn(r, "dispose"));
    expect(spies.length).toBeGreaterThan(10);
    view.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(renderer.disposed).toBe(1);
    expect(box.childNodes.length).toBe(0);
  });
});
