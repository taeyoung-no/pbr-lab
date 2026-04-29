import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4, Vec3 } from 'wgpu-matrix';
import type { Mesh }     from '../graphics/Mesh.ts';
import type { Material } from '../graphics/Material.ts';

// ObjectUniforms layout (96 bytes):
//   model(64) + hasNormal/hasRoughness/hasMetallic/hasAO(16)
//             + hasHeight(4) + heightScale(4) + _pad1/_pad2(8)
const OBJECT_BUFFER_SIZE = 96;

export class Object {
  private readonly _mesh:           Mesh;
  readonly          material:       Material;
  private readonly _device:         GPUDevice;
  private readonly _objectBuffer:   GPUBuffer;
  private readonly _objectBindGroup: GPUBindGroup;

  private _position: Vec3 = vec3.create();
  private _rotation: Vec3 = vec3.create();  // Euler angles in degrees, XYZ order
  private _scale:    Vec3 = vec3.fromValues(1, 1, 1);

  constructor(mesh: Mesh, material: Material, device: GPUDevice, frameUniformBuffer: GPUBuffer) {
    this._mesh   = mesh;
    this.material = material;
    this._device  = device;

    this._objectBuffer = device.createBuffer({
      size:  OBJECT_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._objectBindGroup = device.createBindGroup({
      layout:  material.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: frameUniformBuffer } },
        { binding: 1, resource: { buffer: this._objectBuffer } },
      ],
    });

    device.queue.writeBuffer(this._objectBuffer, 64, new Uint32Array([
      material.hasNormal    ? 1 : 0,
      material.hasRoughness ? 1 : 0,
      material.hasMetallic  ? 1 : 0,
      material.hasAO        ? 1 : 0,
    ]));
    device.queue.writeBuffer(this._objectBuffer, 80, new Uint32Array([material.hasHeight ? 1 : 0]));
    device.queue.writeBuffer(this._objectBuffer, 84, new Float32Array([material.heightScale]));
  }

  setPosition(x: number, y: number, z: number): void { vec3.set(x, y, z, this._position); }
  setRotation(x: number, y: number, z: number): void { vec3.set(x, y, z, this._rotation); }
  setScale(x: number, y: number, z: number): void    { vec3.set(x, y, z, this._scale); }
  setScaleUniform(s: number): void                   { vec3.set(s, s, s, this._scale); }

  get position(): Vec3 { return this._position; }
  get rotation(): Vec3 { return this._rotation; }
  get scale():    Vec3 { return this._scale; }

  modelMatrix(): Mat4 {
    const RAD = Math.PI / 180;
    const m = mat4.identity();
    mat4.translate(m, this._position, m);
    mat4.rotateX(m, this._rotation[0] * RAD, m);
    mat4.rotateY(m, this._rotation[1] * RAD, m);
    mat4.rotateZ(m, this._rotation[2] * RAD, m);
    mat4.scale(m, this._scale, m);
    return m;
  }

  get objectBuffer(): GPUBuffer { return this._objectBuffer; }

  drawMesh(pass: GPURenderPassEncoder): void {
    this._device.queue.writeBuffer(this._objectBuffer, 0, this.modelMatrix() as Float32Array);
    this._mesh.draw(pass);
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setBindGroup(0, this._objectBindGroup);
    this.material.bind(pass);
    this.drawMesh(pass);
  }

  destroy(): void {
    this._mesh.destroy();
    this.material.destroy();
    this._objectBuffer.destroy();
  }
}
