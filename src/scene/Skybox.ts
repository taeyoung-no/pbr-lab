import { mat4 } from 'wgpu-matrix';
import type { Mat4 } from 'wgpu-matrix';
import SHADER from '../shaders/skybox.wgsl?raw';
import { MeshGenerator } from '../graphics/MeshGenerator.ts';
import { VERTEX_BUFFER_LAYOUT } from '../graphics/Vertex.ts';
import type { Mesh } from '../graphics/Mesh.ts';

export class Skybox {
  private readonly _device:           GPUDevice;
  private readonly _mesh:             Mesh;
  private readonly _pipeline:         GPURenderPipeline;
  private readonly _uniformBuffer:    GPUBuffer;
  private readonly _uniformBindGroup: GPUBindGroup;
  private _cubemapBindGroup:          GPUBindGroup | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount: number = 1) {
    this._device = device;
    this._mesh   = MeshGenerator.createCube(device);

    this._uniformBuffer = device.createBuffer({
      size:  64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ code: SHADER });

    this._pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [VERTEX_BUFFER_LAYOUT],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive:    { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample:  { count: sampleCount },
    });

    this._uniformBindGroup = device.createBindGroup({
      layout:  this._pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });
  }

  // view must be a cube-dimension view (createView({ dimension: 'cube' })).
  setCubemap(view: GPUTextureView, sampler: GPUSampler): void {
    this._cubemapBindGroup = this._device.createBindGroup({
      layout:  this._pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
      ],
    });
  }

  // Render the skybox. Call after all opaque geometry so depth culls unseen skybox fragments.
  // view must NOT have translation stripped — this method handles that internally.
  draw(pass: GPURenderPassEncoder, view: Mat4, proj: Mat4): void {
    if (!this._cubemapBindGroup) return;

    const viewNoTrans = mat4.copy(view);
    viewNoTrans[12] = 0;
    viewNoTrans[13] = 0;
    viewNoTrans[14] = 0;

    this._device.queue.writeBuffer(
      this._uniformBuffer, 0,
      mat4.multiply(proj, viewNoTrans) as Float32Array,
    );

    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._uniformBindGroup);
    pass.setBindGroup(1, this._cubemapBindGroup);
    this._mesh.draw(pass);
  }

  destroy(): void {
    this._mesh.destroy();
    this._uniformBuffer.destroy();
  }
}
