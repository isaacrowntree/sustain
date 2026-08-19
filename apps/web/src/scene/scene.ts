import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Segment } from '@sustain/core';

/** Units of lane length per second of session time. */
const SCALE = 0.55;
const LANE_WIDTH = 2.2;
const NIGHT = 0x0f0c08;

// Slightly desaturated so the ember stays the one saturated light source.
const ROLE_COLORS: Record<string, number> = {
  warmup: 0x4aa39b,
  skill: 0xcf7f45,
  endurance: 0x9a86d8,
  cooldown: 0x7aa570,
  assessment: 0xe0685f,
};
const ASH = new THREE.Color(0x453b2e);

const PHASE_TINTS: Record<string, number> = {
  foundation: 0xe8833a,
  'breath-mechanics': 0x3fb8af,
  connection: 0xa78bfa,
  'endurance-voice': 0x7fb069,
};

interface Ripple {
  mesh: THREE.Mesh;
  age: number;
}

/**
 * Ember and smoke over deep night. The session is a lane of rounded blocks
 * flowing toward the player; the point where sound enters the world is an
 * ember, and while you play, resonance rings — the standing wave made
 * visible — ripple out across the floor.
 */
export class PracticeScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private lane = new THREE.Group();
  private blocks: { mesh: THREE.Mesh; fill: THREE.Mesh; seg: Segment; startAt: number; baseOpacity: number }[] = [];
  private strikeLine!: THREE.Mesh;
  private strikeMat!: THREE.MeshBasicMaterial;
  private halo!: THREE.Mesh;
  private haloMat!: THREE.MeshBasicMaterial;
  private trail!: THREE.Line;
  private trailGeo!: THREE.BufferGeometry;
  private trailHistory: { h: number; on: boolean }[] = [];
  private lastTrailSample = 0;
  /** Fast-attack, slow-release envelope for tiered world reactivity. */
  private envSlow = 0;
  /** Boundary "consume" flash, decays after each segment crosses the ember. */
  private flash = 0;
  private motes!: THREE.Points;
  private moteMat!: THREE.PointsMaterial;
  private stars!: THREE.Points;
  private ember!: THREE.Mesh;
  private emberMat!: THREE.MeshBasicMaterial;
  private glow!: THREE.PointLight;
  private ripples: Ripple[] = [];
  private rippleTimer = 0;
  private lastT = 0;
  private tint = new THREE.Color(0xe8833a);
  private smoothedRms = 0;
  private disposed = false;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(NIGHT);
    this.scene.fog = new THREE.Fog(NIGHT, 9, 36);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 100);
    this.camera.position.set(0, 3.1, 4.4);
    this.camera.lookAt(0, 0.35, -8);

    this.scene.add(new THREE.AmbientLight(0xffe9cf, 0.4));
    this.glow = new THREE.PointLight(0xe8833a, 0.8, 20);
    this.glow.position.set(0, 2.4, 0.5);
    this.scene.add(this.glow);

    // Warm dark floor with faint static resonance guides.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: 0x141009, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    for (let i = 1; i <= 3; i++) {
      const guide = new THREE.Mesh(
        new THREE.RingGeometry(i * 2.2 - 0.02, i * 2.2, 64),
        new THREE.MeshBasicMaterial({ color: 0xf2e8d9, transparent: true, opacity: 0.05 }),
      );
      guide.rotation.x = -Math.PI / 2;
      guide.position.y = 0.005;
      this.scene.add(guide);
    }

    // The ember: where sound enters the world.
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0xffb25e });
    this.ember = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 24), this.emberMat);
    this.ember.position.set(0, 0.42, 0);
    this.scene.add(this.ember);

    // The strike line: rhythm games make the "now" point a physical object
    // everything converges into — the sharpest thing on screen.
    this.strikeMat = new THREE.MeshBasicMaterial({ color: 0xf2e8d9, transparent: true, opacity: 0.85 });
    this.strikeLine = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 1.5, 0.035, 0.05), this.strikeMat);
    this.strikeLine.position.set(0, 0.05, 0);
    this.scene.add(this.strikeLine);

    // Breathing halo for rest segments: Apple-Breathe pacing, ~8s per cycle.
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0xf2e8d9,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 64), this.haloMat);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.02;
    this.scene.add(this.halo);

    this.buildTrail();

    this.buildParticles();
    this.scene.add(this.lane);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.85, 0.6);
    this.composer.addPass(this.bloom);
    this.resize();
  }

  private buildParticles(): void {
    // Far stars: cool bone-white dust, static.
    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 14 + Math.random() * 26;
      const theta = Math.random() * Math.PI * 2;
      starPos[i * 3] = Math.cos(theta) * r;
      starPos[i * 3 + 1] = Math.random() * 16 - 2;
      starPos[i * 3 + 2] = Math.sin(theta) * r - 10;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xd8cbb8, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.scene.add(this.stars);

    // Near motes: phase-tinted sparks that breathe with the sound.
    const moteCount = 260;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const r = 4 + Math.random() * 10;
      const theta = Math.random() * Math.PI * 2;
      motePos[i * 3] = Math.cos(theta) * r;
      motePos[i * 3 + 1] = Math.random() * 6;
      motePos[i * 3 + 2] = Math.sin(theta) * r - 6;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    this.moteMat = new THREE.PointsMaterial({
      color: 0xe8833a,
      size: 0.07,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.motes = new THREE.Points(moteGeo, this.moteMat);
    this.scene.add(this.motes);
  }

  /**
   * The played-sound trail: an edge-on seismograph behind the strike line.
   * What the mic heard leaves visible sediment — warm where sound lived,
   * ash where it dropped (the Rocksmith actual-vs-target idea, and Guitar
   * Hero's rule that a hold is never static).
   */
  private static readonly TRAIL_POINTS = 72;
  private static readonly TRAIL_SPACING = 0.11;

  private buildTrail(): void {
    const n = PracticeScene.TRAIL_POINTS;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0.25;
      positions[i * 3 + 2] = 0.2 + i * PracticeScene.TRAIL_SPACING;
    }
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trail = new THREE.Line(
      this.trailGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(this.trail);
  }

  private updateTrail(t: number, playing: boolean): void {
    if (t - this.lastTrailSample < 0.12) return;
    this.lastTrailSample = t;
    this.trailHistory.unshift({ h: this.envSlow, on: playing });
    if (this.trailHistory.length > PracticeScene.TRAIL_POINTS) this.trailHistory.pop();

    const pos = this.trailGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.trailGeo.getAttribute('color') as THREE.BufferAttribute;
    const warm = new THREE.Color();
    for (let i = 0; i < PracticeScene.TRAIL_POINTS; i++) {
      const s = this.trailHistory[i];
      // Any audible sound leaves a mark; verified playing marks it warm.
      const h = s ? Math.min(1, s.h * 1.15) : 0;
      pos.setY(i, 0.12 + h * 1.5);
      const fade = 1 - i / PracticeScene.TRAIL_POINTS;
      if (s?.on) {
        warm.copy(this.tint).multiplyScalar((0.35 + h * 0.65) * fade);
      } else {
        warm.copy(ASH).multiplyScalar(fade * 0.6);
      }
      col.setXYZ(i, warm.r, warm.g, warm.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Call when a segment boundary crosses the ember — the "consume" event. */
  pulseBoundary(): void {
    this.flash = 1;
    if (!this.reduceMotion) this.spawnRipple();
  }

  setPhase(phaseId: string): void {
    this.tint.setHex(PHASE_TINTS[phaseId] ?? 0xe8833a);
    this.moteMat.color.copy(this.tint);
    this.glow.color.copy(this.tint);
  }

  /** Lay the session out as a lane of rounded blocks reaching into the dark. */
  setSession(segments: Segment[]): void {
    this.lane.clear();
    this.blocks = [];
    let cursor = 0;
    for (const seg of segments) {
      const len = Math.max(0.4, seg.seconds * SCALE);
      const isPlay = seg.kind === 'play' || seg.kind === 'record';
      const color = ROLE_COLORS[seg.role] ?? 0xa5947c;
      const height = isPlay ? 0.42 : 0.1;
      const width = isPlay ? LANE_WIDTH : LANE_WIDTH * 0.45;

      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(width, height, len, 3, Math.min(0.09, height / 2)),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          transparent: true,
          opacity: isPlay ? 0.4 : 0.16,
        }),
      );
      mesh.position.set(0, height / 2 + 0.01, -(cursor * SCALE + len / 2));

      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.94, height * 0.9, 1),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.3,
          transparent: true,
        }),
      );
      fill.scale.z = 0.0001;
      fill.position.set(0, height / 2 + 0.01, -(cursor * SCALE));
      this.lane.add(mesh, fill);
      this.blocks.push({ mesh, fill, seg, startAt: cursor, baseOpacity: isPlay ? 0.4 : 0.16 });
      cursor += seg.seconds;
    }
  }

  private spawnRipple(): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.992, 1.0, 96),
      new THREE.MeshBasicMaterial({
        color: this.tint,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.015;
    mesh.scale.setScalar(0.3);
    this.scene.add(mesh);
    this.ripples.push({ mesh, age: 0 });
  }

  /**
   * @param level 0-1 normalised input level (not raw RMS — raw RMS barely
   *   leaves the bottom of its range and makes the world look dead).
   */
  update(elapsed: number, currentIndex: number, level: number, playing: boolean, runMs = 0): void {
    if (this.disposed) return;
    const t = performance.now() / 1000;
    const dt = this.lastT === 0 ? 0.016 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    this.smoothedRms += (level - this.smoothedRms) * 0.25;
    // Envelope follower: fast attack, ~2s release — sustained-drone practice
    // wants slow following, never raw amplitude.
    this.envSlow += (level - this.envSlow) * (level > this.envSlow ? 0.3 : dt / 2);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    this.lane.position.z = elapsed * SCALE;

    const current = this.blocks[currentIndex];
    const remaining = current ? current.startAt + current.seg.seconds - elapsed : Infinity;

    this.blocks.forEach(({ mesh, fill, seg, startAt, baseOpacity }, i) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const fillMat = fill.material as THREE.MeshStandardMaterial;
      if (i < currentIndex) {
        // What's played stays visible but recedes, so the road ahead reads.
        mat.opacity = 0.08;
        fillMat.emissiveIntensity = 0.2;
        fillMat.opacity = 0.5;
        const len = Math.max(0.4, seg.seconds * SCALE);
        fill.scale.z = len;
        fill.position.z = -(startAt * SCALE + len / 2);
      } else if (i === currentIndex) {
        const frac = Math.min(1, Math.max(0, (elapsed - startAt) / seg.seconds));
        const len = Math.max(0.4, seg.seconds * SCALE);
        fill.scale.z = Math.max(0.0001, len * frac);
        fill.position.z = -(startAt * SCALE + (len * frac) / 2);
        fillMat.emissiveIntensity = playing ? 1.1 + this.smoothedRms * 2.4 : 0.4;
        fillMat.opacity = 1;
        mat.opacity = 0.5;
      } else if (i === currentIndex + 1 && remaining < 4) {
        // Telegraph the next segment one breath before it arrives.
        mat.opacity = baseOpacity + (0.35 * (4 - remaining)) / 4;
      } else {
        mat.opacity = baseOpacity;
      }
    });

    // Breathing halo during rest segments: swell in, sink out, ~8s cycle.
    const resting = current?.seg.kind === 'rest';
    if (resting) {
      const breath = this.reduceMotion
        ? 1
        : 0.5 - 0.5 * Math.cos((t % 8) * ((Math.PI * 2) / 8));
      this.halo.scale.setScalar(0.7 + breath * 1.1);
      this.haloMat.opacity = this.reduceMotion ? 0.12 + 0.1 * Math.sin(t) : 0.08 + breath * 0.22;
    } else {
      this.haloMat.opacity = Math.max(0, this.haloMat.opacity - dt * 0.5);
    }

    // Unbroken-run escalation: the world itself is the success meter.
    const energy = Math.min(1, runMs / 90_000);
    (this.stars.material as THREE.PointsMaterial).opacity = 0.4 + energy * 0.3;
    this.moteMat.size = 0.07 + energy * 0.04;

    // Resonance rings: the standing wave, visible only while sound lives.
    this.rippleTimer -= dt;
    if (playing && !this.reduceMotion && this.rippleTimer <= 0 && this.ripples.length < 6) {
      this.spawnRipple();
      this.rippleTimer = 1.1 - Math.min(0.5, this.smoothedRms * 2);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!;
      r.age += dt;
      const life = r.age / 3.2;
      r.mesh.scale.setScalar(0.3 + life * 9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.32 * (1 - life));
      if (life >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.ripples.splice(i, 1);
      }
    }

    // The ember swells with breath pressure; boundary crossings flare it.
    // Size answers "can it hear me" and responds to any sound; colour
    // answers "does it count" and waits for the detector to agree.
    const swell =
      1 + this.smoothedRms * 1.9 + (playing ? 0.2 : 0) + this.flash * 0.6 + Math.sin(t * 2.2) * 0.03;
    this.ember.scale.setScalar(swell);
    this.emberMat.color.setHex(playing ? 0xffb25e : 0xc98b4a);
    this.glow.intensity = 0.5 + this.smoothedRms * 5 + (playing ? 0.4 : 0) + this.flash * 3;

    // Strike line: brightest while sound feeds it, flaring on boundaries.
    this.strikeMat.opacity = 0.5 + (playing ? 0.35 : 0) + this.flash * 0.4;
    this.strikeMat.color.copy(playing ? this.tint : new THREE.Color(0xf2e8d9));
    this.strikeLine.scale.x = 1 + this.flash * 0.25;

    this.updateTrail(t, playing);

    // The world breathes; the camera sways like a player settling in.
    this.motes.scale.setScalar(1 + this.smoothedRms * 0.9);
    this.motes.rotation.y = t * 0.018;
    this.moteMat.opacity = 0.28 + this.smoothedRms * 0.5;
    this.stars.rotation.y = t * 0.004;
    if (!this.reduceMotion) {
      this.camera.position.x = Math.sin(t * 0.13) * 0.18;
      this.camera.position.y = 3.1 + Math.sin(t * 0.21) * 0.05;
      this.camera.lookAt(0, 0.35, -8);
    }

    this.bloom.strength = 0.6 + this.envSlow * 0.5 + energy * 0.15 + this.flash * 0.2;
    this.composer.render();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}
