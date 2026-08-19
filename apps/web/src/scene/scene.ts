import * as THREE from 'three';
import type { Segment } from '@sustain/core';

/** Units of lane length per second of session time. */
const SCALE = 0.55;
const LANE_WIDTH = 2.2;

const ROLE_COLORS: Record<string, number> = {
  warmup: 0x4ecdc4,
  skill: 0xf5a643,
  endurance: 0xb58cff,
  cooldown: 0x6fce8f,
  assessment: 0xe2685c,
};

const PHASE_TINTS: Record<string, number> = {
  foundation: 0xf5a643,
  'breath-mechanics': 0x4ecdc4,
  connection: 0xb58cff,
  'endurance-voice': 0x6fce8f,
};

/**
 * The practice environment: the session is a lane of segment blocks flowing
 * toward the player (the Guitar Hero sustain-bar idea, stretched to minutes),
 * inside a particle field that breathes with the microphone.
 */
export class PracticeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private lane = new THREE.Group();
  private blocks: { mesh: THREE.Mesh; fill: THREE.Mesh; seg: Segment; startAt: number }[] = [];
  private particles!: THREE.Points;
  private particleMat!: THREE.PointsMaterial;
  private cursorRing!: THREE.Mesh;
  private glow!: THREE.PointLight;
  private smoothedRms = 0;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.Fog(0x0b0e14, 8, 34);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.camera.position.set(0, 2.6, 4.2);
    this.camera.lookAt(0, 0.4, -6);

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);
    this.glow = new THREE.PointLight(0xf5a643, 0.8, 18);
    this.glow.position.set(0, 2.2, 0.5);
    this.scene.add(this.glow);

    // Ground plane with a subtle grid feel.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 80),
      new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    this.scene.add(ground);

    // The "now" cursor: a ring at the origin the lane flows through.
    this.cursorRing = new THREE.Mesh(
      new THREE.TorusGeometry(LANE_WIDTH * 0.75, 0.05, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8ecf4, transparent: true, opacity: 0.7 }),
    );
    this.cursorRing.rotation.y = Math.PI / 2;
    this.cursorRing.rotation.z = Math.PI / 2;
    this.cursorRing.position.y = 0.25;
    this.scene.add(this.cursorRing);

    this.buildParticles();
    this.scene.add(this.lane);
    this.resize();
  }

  private buildParticles(): void {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 16;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.random() * 9 - 1;
      positions[i * 3 + 2] = Math.sin(theta) * r - 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleMat = new THREE.PointsMaterial({
      color: 0xf5a643,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geo, this.particleMat);
    this.scene.add(this.particles);
  }

  setPhase(phaseId: string): void {
    const tint = PHASE_TINTS[phaseId] ?? 0xf5a643;
    this.particleMat.color.setHex(tint);
    this.glow.color.setHex(tint);
  }

  /** Lay the session out as a lane of blocks stretching into the distance. */
  setSession(segments: Segment[]): void {
    this.lane.clear();
    this.blocks = [];
    let cursor = 0; // seconds from session start
    for (const seg of segments) {
      const len = Math.max(0.35, seg.seconds * SCALE);
      const isPlay = seg.kind === 'play' || seg.kind === 'record';
      const color = ROLE_COLORS[seg.role] ?? 0x8a94ab;
      const height = isPlay ? 0.5 : 0.14;
      const width = isPlay ? LANE_WIDTH : LANE_WIDTH * 0.5;

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, len),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          transparent: true,
          opacity: isPlay ? 0.5 : 0.22,
        }),
      );
      mesh.position.set(0, height / 2, -(cursor * SCALE + len / 2));

      // Bright fill that grows as the segment is completed.
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, 1),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.7,
          roughness: 0.3,
        }),
      );
      fill.scale.z = 0.0001;
      fill.position.set(0, height / 2, -(cursor * SCALE));
      this.lane.add(mesh, fill);
      this.blocks.push({ mesh, fill, seg, startAt: cursor });
      cursor += seg.seconds;
    }
  }

  /**
   * @param elapsed seconds into the session
   * @param currentIndex active segment index
   * @param rms 0-1 mic loudness (0 in timer mode)
   * @param playing verified/credited playing right now
   */
  update(elapsed: number, currentIndex: number, rms: number, playing: boolean): void {
    if (this.disposed) return;
    this.smoothedRms += (rms - this.smoothedRms) * 0.15;
    const t = performance.now() / 1000;

    // Lane flows toward the camera so "now" stays at the origin.
    this.lane.position.z = elapsed * SCALE;

    this.blocks.forEach(({ mesh, fill, seg, startAt }, i) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const fillMat = fill.material as THREE.MeshStandardMaterial;
      if (i < currentIndex) {
        mat.opacity = 0.12;
        fillMat.emissiveIntensity = 0.25;
        const len = Math.max(0.35, seg.seconds * SCALE);
        fill.scale.z = len;
        fill.position.z = -(startAt * SCALE + len / 2);
      } else if (i === currentIndex) {
        const frac = Math.min(1, Math.max(0, (elapsed - startAt) / seg.seconds));
        const len = Math.max(0.35, seg.seconds * SCALE);
        fill.scale.z = Math.max(0.0001, len * frac);
        fill.position.z = -(startAt * SCALE + (len * frac) / 2);
        const pulse = playing ? 0.9 + this.smoothedRms * 2.2 : 0.45;
        fillMat.emissiveIntensity = pulse + Math.sin(t * 3) * 0.08;
        mat.opacity = 0.55;
      }
    });

    // The world breathes with the sound.
    const breath = 1 + this.smoothedRms * 3.5;
    this.particles.scale.setScalar(breath);
    this.particles.rotation.y = t * 0.02;
    this.particleMat.opacity = 0.35 + this.smoothedRms * 1.6;
    this.glow.intensity = 0.6 + this.smoothedRms * 6;

    const ringMat = this.cursorRing.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(playing ? 0x6fce8f : 0xe8ecf4);
    ringMat.opacity = playing ? 0.9 : 0.5;
    this.cursorRing.scale.setScalar(1 + this.smoothedRms * 0.6 + Math.sin(t * 2) * 0.015);

    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
