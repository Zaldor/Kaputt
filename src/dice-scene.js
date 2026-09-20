// Self-hosted, real WebGL dice. Only publicly revealed values enter the renderer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import boldFont from './fonts/question.typeface.json';
import { SoftwareDiceRenderer } from './software-dice-renderer.js';

const faces = [
  { value: 1, normal: [0, 0, 1] }, { value: 6, normal: [0, 0, -1] },
  { value: 3, normal: [1, 0, 0] }, { value: 4, normal: [-1, 0, 0] },
  { value: 2, normal: [0, 1, 0] }, { value: 5, normal: [0, -1, 0] },
];
const positions = {
  1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
const front = new THREE.Vector3(0, 0, 1);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DiceScene {
  constructor(container) {
    this.container = container;
    this.animation = null;
    this.frame = 0;
    this.values = [null, null];
    const canvas = document.createElement('canvas');
    let context;
    try { context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' }); } catch {}
    this.renderer = context
      ? new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true })
      : new SoftwareDiceRenderer();
    this.renderer.domElement.dataset.renderer ||= 'webgl';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'dice-canvas';
    container.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-2.15, 2.15, 1.22, -1.22, .1, 40);
    this.camera.position.set(0, 0, 10);
    if (context) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environment = pmrem.fromScene(room, .04);
      this.scene.environment = this.environment.texture;
      room.dispose(); pmrem.dispose();
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc6862f, 1.6));
    const light = new THREE.DirectionalLight(0xfff7e5, 3.8);
    light.position.set(0, 12, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -4, right: 4, top: 3, bottom: -3 });
    light.shadow.normalBias = .025; light.shadow.radius = 5;
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(4, 2, 5); this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .26 }));
    floor.position.z = -1.03; floor.receiveShadow = true; this.scene.add(floor);
    this.bodyGeometry = new RoundedBoxGeometry(1.5, 1.5, 1.5, 5, .23);
    this.ivory = new THREE.MeshPhysicalMaterial({ color: 0xfff4d5, roughness: .55, clearcoat: .3, clearcoatRoughness: .5 });
    this.orange = new THREE.MeshPhysicalMaterial({ color: 0xff8008, roughness: .55, clearcoat: .3, clearcoatRoughness: .5 });
    this.ink = new THREE.MeshPhysicalMaterial({ color: 0x10214c, roughness: .3, clearcoat: .5 });
    this.rim = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: .35 });
    this.pipGeometry = new THREE.CircleGeometry(.112, 28);
    this.rimGeometry = new THREE.TorusGeometry(.116, .005, 8, 28);
    this.questionGeometry = new TextGeometry('?', { font: new FontLoader().parse(boldFont), size: .81, depth: .018, curveSegments: 10, bevelEnabled: true, bevelThickness: .013, bevelSize: .008, bevelSegments: 3 });
    this.questionGeometry.computeBoundingBox();
    const box = this.questionGeometry.boundingBox;
    this.questionGeometry.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, 0);
    this.dice = [this.makeDie(0), this.makeDie(1)];
    this.dice.forEach(die => this.scene.add(die.group));
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.visibilityHandler = () => { if (document.hidden) this.finish(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.contextHandler = event => { event.preventDefault(); this.cancel(); this.container.dispatchEvent(new CustomEvent('dice-renderer-lost')); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextHandler);
    this.resize(); this.setValues([null, null]);
  }
  makeDie(index) {
    const group = new THREE.Group(); group.position.set(index ? 1.02 : -1.02, 0, 0); group.userData.isDie = true;
    const body = new THREE.Mesh(this.bodyGeometry, this.orange);
    body.castShadow = true; body.receiveShadow = true; group.add(body);
    const pips = new THREE.Group(), questions = new THREE.Group();
    for (const face of faces) {
      const orientation = new THREE.Quaternion().setFromUnitVectors(front, new THREE.Vector3(...face.normal));
      const side = new THREE.Group(); side.quaternion.copy(orientation);
      for (const [x, y] of positions[face.value]) {
        const dot = new THREE.Mesh(this.pipGeometry, this.ink); dot.position.set(x * .31, y * .31, .751); dot.renderOrder = 1;
        const rim = new THREE.Mesh(this.rimGeometry, this.rim); rim.position.set(x * .31, y * .31, .754); rim.renderOrder = 1;
        side.add(dot, rim);
      }
      pips.add(side);
      if (face.value === 1) {
        const question = new THREE.Mesh(this.questionGeometry, this.ivory); question.renderOrder = 1;
        question.position.copy(new THREE.Vector3(...face.normal).multiplyScalar(.752));
        question.quaternion.copy(orientation); questions.add(question);
      }
    }
    group.add(pips, questions); return { group, body, pips, questions, index };
  }
  pose(index, value) {
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.27, index ? -.19 : .18, index ? -.11 : .13));
    const normal = new THREE.Vector3(...faces.find(face => face.value === (value || 1)).normal);
    return tilt.multiply(new THREE.Quaternion().setFromUnitVectors(normal, front));
  }
  setValues(values) {
    this.values = [...values];
    this.dice.forEach((die, index) => {
      const revealed = Number.isInteger(values[index]) && values[index] >= 1 && values[index] <= 6;
      die.body.material = revealed ? this.ivory : this.orange;
      die.pips.visible = revealed; die.questions.visible = !revealed;
      die.group.quaternion.copy(this.pose(index, values[index]));
      die.group.position.y = 0; die.group.scale.setScalar(1);
    }); this.draw();
  }
  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    // Keep the complete dice visible when compact phones shorten the canvas.
    const halfWidth = Math.max(2.3, 1.04 * width / height);
    this.camera.left = -halfWidth; this.camera.right = halfWidth;
    this.camera.top = halfWidth * height / width; this.camera.bottom = -this.camera.top;
    this.camera.updateProjectionMatrix(); this.draw();
  }
  draw() { this.renderer.render(this.scene, this.camera); }
  animate(duration, update, done) {
    this.cancel();
    if (reduced() || document.hidden) { update(1); done?.(); return Promise.resolve(); }
    return new Promise(resolve => {
      const start = performance.now(); this.animation = { resolve, update, done };
      const frame = now => {
        const t = Math.min((now - start) / duration, 1); update(t); this.draw();
        if (t < 1) this.frame = requestAnimationFrame(frame);
        else { this.animation = null; done?.(); resolve(); }
      }; this.frame = requestAnimationFrame(frame);
    });
  }
  roll() {
    this.setValues([null, null]);
    return this.animate(1150, t => {
      const eased = 1 - Math.pow(1 - t, 3);
      this.dice.forEach((die, i) => {
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler((1 - eased) * Math.PI * (4 + i * 2), (1 - eased) * Math.PI * (6 - i * 2), (1 - eased) * Math.PI * (i ? -2 : 2)));
        die.group.quaternion.copy(this.pose(i, null)).multiply(spin);
        die.group.position.y = Math.sin(t * Math.PI) * .35 + Math.abs(Math.sin(t * Math.PI * 3)) * .10 * (1 - t);
        die.group.scale.setScalar(1 - .08 * Math.sin(t * Math.PI));
      });
    }, () => this.setValues([null, null]));
  }
  reveal(index, value) {
    const values = [...this.values]; values[index] = value;
    const die = this.dice[index]; let switched = false;
    return this.animate(400, t => {
      if (t >= .45 && !switched) { this.setValues(values); switched = true; }
      const lift = Math.sin(t * Math.PI);
      die.group.position.y = lift * .45;
      die.group.scale.setScalar(1 + lift * .12);
    }, () => this.setValues(values));
  }
  finish() {
    const animation = this.animation; if (!animation) return;
    cancelAnimationFrame(this.frame); this.animation = null;
    animation.update(1); animation.done?.(); this.draw(); animation.resolve();
  }
  cancel() { cancelAnimationFrame(this.frame); const animation = this.animation; this.animation = null; animation?.resolve(); }
  dispose() {
    this.cancel(); this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextHandler);
    this.scene.traverse(object => { object.geometry?.dispose(); if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); });
    this.environment?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
