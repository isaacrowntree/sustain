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

const ROLE_COLORS: Record<string, number> = {
  warmup: 0x3fb8af,
  skill: 0xe8833a,
  endurance: 0xa78bfa,
  cooldown: 0x7fb069,
  assessment: 0xff6b5e,
};

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
  private blocks: { mesh: THREE.Mesh; fill: THREE.Mesh; seg: Segment; startAt: number }[] = [];
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
    this.camera.position.set(0, 2.4, 4.6);
    this.camera.lookAt(0, 0.5, -7);

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
        }),
      );
      fill.scale.z = 0.0001;
      fill.position.set(0, height / 2 + 0.01, -(cursor * SCALE));
      this.lane.add(mesh, fill);
      this.blocks.push({ mesh, fill, seg, startAt: cursor });
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

  update(elapsed: number, currentIndex: number, rms: number, playing: boolean): void {
    if (this.disposed) return;
    const t = performance.now() / 1000;
    const dt = this.lastT === 0 ? 0.016 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    this.smoothedRms += (rms - this.smoothedRms) * 0.15;

    this.lane.position.z = elapsed * SCALE;

    this.blocks.forEach(({ mesh, fill, seg, startAt }, i) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const fillMat = fill.material as THREE.MeshStandardMaterial;
      if (i < currentIndex) {
        mat.opacity = 0.08;
        fillMat.emissiveIntensity = 0.18;
        const len = Math.max(0.4, seg.seconds * SCALE);
        fill.scale.z = len;
        fill.position.z = -(startAt * SCALE + len / 2);
      } else if (i === currentIndex) {
        const frac = Math.min(1, Math.max(0, (elapsed - startAt) / seg.seconds));
        const len = Math.max(0.4, seg.seconds * SCALE);
        fill.scale.z = Math.max(0.0001, len * frac);
        fill.position.z = -(startAt * SCALE + (len * frac) / 2);
        fillMat.emissiveIntensity = playing ? 1.1 + this.smoothedRms * 2.4 : 0.4;
        mat.opacity = 0.5;
      }
    });

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

    // The ember swells with breath pressure.
    const swell = 1 + this.smoothedRms * 2.6 + (playing ? 0.12 : 0) + Math.sin(t * 2.2) * 0.03;
    this.ember.scale.setScalar(swell);
    this.emberMat.color.setHex(playing ? 0xffb25e : 0x6b5238);
    this.glow.intensity = 0.5 + this.smoothedRms * 7 + (playing ? 0.4 : 0);

    // The world breathes; the camera sways like a player settling in.
    this.motes.scale.setScalar(1 + this.smoothedRms * 2.2);
    this.motes.rotation.y = t * 0.018;
    this.moteMat.opacity = 0.28 + this.smoothedRms * 1.4;
    this.stars.rotation.y = t * 0.004;
    if (!this.reduceMotion) {
      this.camera.position.x = Math.sin(t * 0.13) * 0.18;
      this.camera.position.y = 2.4 + Math.sin(t * 0.21) * 0.05;
      this.camera.lookAt(0, 0.5, -7);
    }

    this.bloom.strength = 0.65 + this.smoothedRms * 0.9;
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
