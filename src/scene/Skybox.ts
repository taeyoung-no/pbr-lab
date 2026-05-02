import { mat4 } from 'wgpu-matrix';
import type { Mat4 } from 'wgpu-matrix';
import SHADER from '../shaders/skybox.wgsl?raw';
import { MeshGenerator } from '../graphics/MeshGenerator.ts';
import { VERTEX_BUFFER_LAYOUT } from '../graphics/Vertex.ts';
import type { Mesh } from '../graphics/Mesh.ts';

export class Skybox {
  private readonly device:           GPUDevice;
  private readonly mesh:             Mesh;
  private readonly pipeline:         GPURenderPipeline;
  private readonly uniformBuffer:    GPUBuffer;
  private readonly uniformBindGroup: GPUBindGroup;
  private cubemapBindGroup:          GPUBindGroup | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount: number = 1) {
    this.device = device;
    this.mesh   = MeshGenerator.createCube(device);

    this.uniformBuffer = device.createBuffer({
      size:  64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ code: SHADER });

    this.pipeline = device.createRenderPipeline({
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

    this.uniformBindGroup = device.createBindGroup({
      layout:  this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  // view must be a cube-dimension view (createView({ dimension: 'cube' })).
  setCubemap(view: GPUTextureView, sampler: GPUSampler): void {
    this.cubemapBindGroup = this.device.createBindGroup({
      layout:  this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
      ],
    });
  }

  // Render the skybox. Call after all opaque geometry so depth culls unseen skybox fragments.
  // view must NOT have translation stripped — this method handles that internally.
  draw(pass: GPURenderPassEncoder, view: Mat4, proj: Mat4): void {
    if (!this.cubemapBindGroup) return;

    const viewNoTrans = mat4.copy(view);
    viewNoTrans[12] = 0;
    viewNoTrans[13] = 0;
    viewNoTrans[14] = 0;

    this.device.queue.writeBuffer(
      this.uniformBuffer, 0,
      mat4.multiply(proj, viewNoTrans) as Float32Array,
    );

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.uniformBindGroup);
    pass.setBindGroup(1, this.cubemapBindGroup);
    this.mesh.draw(pass);
  }

  destroy(): void {
    this.mesh.destroy();
    this.uniformBuffer.destroy();
  }
}
