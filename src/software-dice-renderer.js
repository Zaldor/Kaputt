// Canvas2D projection of the same real rounded meshes used by WebGL.
// This keeps 3D tumbling available when a browser disables GPU contexts.
import { Vector3, Matrix3, Matrix4, Color } from 'three';
const light = new Vector3(-.35, .65, 1).normalize();
const view = new Vector3(0, 0, 1);
const half = light.clone().add(view).normalize();
const fill = new Vector3(.6, -.2, .8).normalize();
export class SoftwareDiceRenderer {
  constructor() {
    this.domElement = document.createElement('canvas');
    this.ctx = this.domElement.getContext('2d');
    if (!this.ctx) throw new Error('Canvas rendering unavailable');
    this.shadowMap = {};
    this.ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = 1; this.height = 1;
    this.normalMatrix = new Matrix3();
    this.projection = new Matrix4();
    this.color = new Color();
    this.domElement.dataset.renderer = 'software-3d';
  }
  setPixelRatio(ratio) { this.ratio = Math.min(ratio, 2); }
  setClearColor() {}
  setSize(width, height) {
    this.width = width; this.height = height;
    this.domElement.width = Math.round(width * this.ratio);
    this.domElement.height = Math.round(height * this.ratio);
  }
  render(scene, camera) {
    const ctx = this.ctx, w = this.width, h = this.height;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); ctx.clearRect(0, 0, w, h);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // Contact shadows are placed behind the meshes; the meshes themselves are
    // depth-sorted triangles, not prerendered images or rotating flat sprites.
    for (const die of scene.children.filter(o => o.userData.isDie)) {
      const center = die.position.clone().applyMatrix4(this.projection);
      const x = (center.x * .5 + .5) * w, y = (-center.y * .5 + .5) * h;
      ctx.save(); ctx.filter = 'blur(9px)'; ctx.fillStyle = '#8b632a55';
      ctx.beginPath(); ctx.ellipse(x + 6, y + w * .16, w * .165, w * .041, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    const triangles = [];
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    const na = new Vector3(), nb = new Vector3(), nc = new Vector3();
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh || mesh.material.type === 'ShadowMaterial') return;
      const geometry = mesh.geometry, pos = geometry.attributes.position, normals = geometry.attributes.normal;
      // Surface decals on the far side must be culled as a complete face,
      // including their beveled edges, before the painter's overlay pass.
      if (mesh.renderOrder === 1 && new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld).z <= .001) return;
      const index = geometry.index, count = index ? index.count : pos.count;
      this.normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const material = mesh.material;
      for (let i = 0; i < count; i += 3) {
        const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
        a.fromBufferAttribute(pos, ids[0]).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, ids[1]).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, ids[2]).applyMatrix4(mesh.matrixWorld);
        na.fromBufferAttribute(normals, ids[0]); nb.fromBufferAttribute(normals, ids[1]); nc.fromBufferAttribute(normals, ids[2]);
        na.add(nb).add(nc).applyMatrix3(this.normalMatrix).normalize();
        if (na.z <= 0) continue;
        const depth = (a.z + b.z + c.z) / 3;
        const diffuse = .65 + Math.max(0, na.dot(light)) * .37 + Math.max(0, na.dot(fill)) * .06;
        const specular = Math.pow(Math.max(0, na.dot(half)), 34) * .10;
        this.color.copy(material.color).convertLinearToSRGB();
        const rgb = ['r', 'g', 'b'].map(key => Math.min(255, Math.round((this.color[key] * diffuse + specular) * 255)));
        a.applyMatrix4(this.projection); b.applyMatrix4(this.projection); c.applyMatrix4(this.projection);
        triangles.push({ depth, layer: mesh.renderOrder, fill: `rgb(${rgb.join(',')})`, points: [a.x, a.y, b.x, b.y, c.x, c.y] });
      }
    });
    triangles.sort((a, b) => a.layer - b.layer || a.depth - b.depth);
    ctx.lineWidth = .55; ctx.lineJoin = 'round';
    for (const tri of triangles) {
      ctx.fillStyle = ctx.strokeStyle = tri.fill;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 2) {
        const x = (tri.points[i] * .5 + .5) * w, y = (-tri.points[i + 1] * .5 + .5) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  dispose() {}
}
