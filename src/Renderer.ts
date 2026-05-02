import { mat4 } from 'wgpu-matrix';
import type { Mat4 } from 'wgpu-matrix';
import PBR_SHADER    from './shaders/pbr.wgsl?raw';
import SHADOW_SHADER from './shaders/shadow.wgsl?raw';
import POST_SHADER   from './shaders/post.wgsl?raw';
import BLIT_SHADER   from './shaders/blit.wgsl?raw';
import { MeshGenerator }        from './graphics/MeshGenerator.ts';
import { VERTEX_BUFFER_LAYOUT } from './graphics/Vertex.ts';
import { Texture }              from './graphics/Texture.ts';
import { Material }             from './graphics/Material.ts';
import { IBLBaker }             from './graphics/IBLBaker.ts';
import { Object as SceneObject } from './scene/Object.ts';
import { Camera }               from './scene/Camera.ts';
import { Skybox }               from './scene/Skybox.ts';

const BASE_URL = import.meta.env.BASE_URL;

export class Renderer {
  private readonly canvas:          HTMLCanvasElement;
  private readonly SAMPLE_COUNT   = 4;
  private readonly SHADOW_MAP_SIZE = 2048;

  private device!:  GPUDevice;
  private context!: GPUCanvasContext;
  private format!:  GPUTextureFormat;

  private camera!:  Camera;
  private sphere!:  SceneObject;
  private skybox!:  Skybox;

  private frameUniformBuffer!: GPUBuffer;
  private iblBindGroup!:       GPUBindGroup;
  private postPipeline!:       GPUComputePipeline;
  private blitPipeline!:       GPURenderPipeline;
  private blitSampler!:        GPUSampler;

  private floor!: SceneObject;

  // Recreated on resize
  private depthTexture!:   GPUTexture;
  private msaaTexture!:    GPUTexture;
  private resolveTexture!: GPUTexture;
  private postTexture!:    GPUTexture;
  private postBindGroup!:  GPUBindGroup;
  private blitBindGroup!:  GPUBindGroup;

  private _cubemapTex!:     GPUTexture;
  private _irradianceTex!:  GPUTexture;
  private _prefilteredTex!: GPUTexture;
  private _brdfLut!:        GPUTexture;

  // Shadow pass
  private _shadowDepthTex!:   GPUTexture;
  private _shadowPipeline!:   GPURenderPipeline;
  private _shadowUniformBuf!: GPUBuffer;
  private _sphereShadowBG!:   GPUBindGroup;
  private _floorShadowBG!:    GPUBindGroup;
  private _sceneShadowBG!:    GPUBindGroup;

  // Shared between update() and render()
  private _view!: Mat4;
  private _proj!: Mat4;

  readonly params = {
    lightDirX:     0.0,
    lightDirY:    -1.0,
    lightDirZ:    -1.0,
    lightIntensity: 5.0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found');

    this.device  = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu')!;
    this.format  = navigator.gpu.getPreferredCanvasFormat();
    this.camera  = new Camera(this.canvas);

    await this._bakeIBL();
    await this._buildScene();
    this._buildShadow();
    this._buildPipelines();

    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  // ── IBL bake ──────────────────────────────────────────────────────────────

  private async _bakeIBL(): Promise<void> {
    const baker = new IBLBaker(this.device);
    const ibl   = await baker.bake(`${BASE_URL}assets/sky/env.hdr`);

    this._cubemapTex     = ibl.cubemapTex;
    this._irradianceTex  = ibl.irradianceTex;
    this._prefilteredTex = ibl.prefilteredTex;
    this._brdfLut        = ibl.brdfLut;

    this.skybox = new Skybox(this.device, 'rgba16float', this.SAMPLE_COUNT);
    this.skybox.setCubemap(this._cubemapTex.createView({ dimension: 'cube' }), ibl.cubeSampler);
  }

  // ── Scene setup ───────────────────────────────────────────────────────────

  private async _buildScene(): Promise<void> {
    // FrameUniforms: viewProj(64) + camPos+pad(16) + lightDir+lightIntensity(16) + lightViewProj(64) = 160 bytes
    this.frameUniformBuffer = this.device.createBuffer({
      size:  160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const scenePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module:     this.device.createShaderModule({ code: PBR_SHADER }),
        entryPoint: 'vs_main',
        buffers:    [VERTEX_BUFFER_LAYOUT],
      },
      fragment: {
        module:     this.device.createShaderModule({ code: PBR_SHADER }),
        entryPoint: 'fs_main',
        targets:    [{ format: 'rgba16float' }],
      },
      primitive:    { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample:  { count: this.SAMPLE_COUNT },
    });

    const iblSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    const lutSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.iblBindGroup = this.device.createBindGroup({
      layout:  scenePipeline.getBindGroupLayout(2),
      entries: [
        { binding: 0, resource: this._irradianceTex.createView({ dimension: 'cube' }) },
        { binding: 1, resource: iblSampler },
        { binding: 2, resource: this._prefilteredTex.createView({ dimension: 'cube' }) },
        { binding: 3, resource: iblSampler },
        { binding: 4, resource: this._brdfLut.createView() },
        { binding: 5, resource: lutSampler },
      ],
    });

    // Sphere
    const sphereMat = new Material(this.device, scenePipeline);
    sphereMat.setAlbedo(   await Texture.from(this.device, `${BASE_URL}assets/model/color.png`));
    sphereMat.setNormal(   await Texture.from(this.device, `${BASE_URL}assets/model/normal.png`,    false));
    sphereMat.setMetallic( await Texture.from(this.device, `${BASE_URL}assets/model/metallic.png`,  false));
    sphereMat.setRoughness(await Texture.from(this.device, `${BASE_URL}assets/model/roughness.png`, false));
    sphereMat.setHeight(   await Texture.from(this.device, `${BASE_URL}assets/model/height.png`,    false));
    sphereMat.setHeightScale(0.02);
    this.sphere = new SceneObject(MeshGenerator.createSphere(this.device), sphereMat, this.device, this.frameUniformBuffer);

    // Floor
    const floorMat = new Material(this.device, scenePipeline);
    floorMat.setAlbedo(   Texture.fromCheckerboard(this.device, 8, 512));
    floorMat.setRoughness(Texture.fromColor(this.device, 128, 128, 128, false));
    this.floor = new SceneObject(MeshGenerator.createPlane(this.device), floorMat, this.device, this.frameUniformBuffer);
    this.floor.setPosition(0, -1, 0);
    this.floor.setScaleUniform(20);
  }

  // ── Shadow pass setup ────────────────────────────────────────────────────

  private _buildShadow(): void {
    this._shadowDepthTex = this.device.createTexture({
      size:   [this.SHADOW_MAP_SIZE, this.SHADOW_MAP_SIZE],
      format: 'depth32float',
      usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Only position attribute needed; stride matches full vertex layout (44 bytes)
    const shadowVertexLayout: GPUVertexBufferLayout = {
      arrayStride: 44,
      attributes:  [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
    };

    this._shadowPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module:     this.device.createShaderModule({ code: SHADOW_SHADER }),
        entryPoint: 'vs_main',
        buffers:    [shadowVertexLayout],
      },
      primitive:    { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // lightViewProj uniform buffer (64 bytes)
    this._shadowUniformBuf = this.device.createBuffer({
      size:  64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowBGLayout = this._shadowPipeline.getBindGroupLayout(0);
    this._sphereShadowBG = this.device.createBindGroup({
      layout:  shadowBGLayout,
      entries: [
        { binding: 0, resource: { buffer: this._shadowUniformBuf } },
        { binding: 1, resource: { buffer: this.sphere.objectBuffer } },
      ],
    });
    this._floorShadowBG = this.device.createBindGroup({
      layout:  shadowBGLayout,
      entries: [
        { binding: 0, resource: { buffer: this._shadowUniformBuf } },
        { binding: 1, resource: { buffer: this.floor.objectBuffer } },
      ],
    });

    // Bind group for the PBR scene pass (group 3): shadow depth texture + comparison sampler
    const shadowCompareSampler = this.device.createSampler({
      compare:      'less-equal',
      magFilter:    'linear',
      minFilter:    'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this._sceneShadowBG = this.device.createBindGroup({
      layout:  this.sphere.material.pipeline.getBindGroupLayout(3),
      entries: [
        { binding: 0, resource: this._shadowDepthTex.createView() },
        { binding: 1, resource: shadowCompareSampler },
      ],
    });
  }

  // ── Post / blit pipelines ─────────────────────────────────────────────────

  private _buildPipelines(): void {
    this.postPipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: POST_SHADER }), entryPoint: 'cs_main' },
    });

    const blitModule = this.device.createShaderModule({ code: BLIT_SHADER });
    this.blitPipeline = this.device.createRenderPipeline({
      layout:   'auto',
      vertex:   { module: blitModule, entryPoint: 'vs_main' },
      fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.blitSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  private _resize(): void {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.resolveTexture?.destroy();
    this.postTexture?.destroy();

    this.depthTexture = this.device.createTexture({
      size:        [this.canvas.width, this.canvas.height],
      format:      'depth24plus',
      sampleCount: this.SAMPLE_COUNT,
      usage:       GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaTexture = this.device.createTexture({
      size:        [this.canvas.width, this.canvas.height],
      format:      'rgba16float',
      sampleCount: this.SAMPLE_COUNT,
      usage:       GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.resolveTexture = this.device.createTexture({
      size:   [this.canvas.width, this.canvas.height],
      format: 'rgba16float',
      usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.postTexture = this.device.createTexture({
      size:   [this.canvas.width, this.canvas.height],
      format: 'rgba16float',
      usage:  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.postBindGroup = this.device.createBindGroup({
      layout:  this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.resolveTexture.createView() },
        { binding: 1, resource: this.postTexture.createView() },
      ],
    });
    this.blitBindGroup = this.device.createBindGroup({
      layout:  this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.postTexture.createView() },
        { binding: 1, resource: this.blitSampler },
      ],
    });

    this.camera.setSize(this.canvas.width, this.canvas.height);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────

  update(): void {
    const camPos = this.camera.getPosition();
    this._view   = this.camera.getView();
    this._proj   = mat4.perspective(Math.PI / 4, this.canvas.width / this.canvas.height, 0.1, 100);
    const viewProj = mat4.multiply(this._proj, this._view);

    // Frame uniforms uploaded once per frame (shared by all objects)
    this.device.queue.writeBuffer(this.frameUniformBuffer,  0, viewProj as Float32Array);
    this.device.queue.writeBuffer(this.frameUniformBuffer, 64, new Float32Array([camPos[0], camPos[1], camPos[2], 0]));
    // lightDir (normalized, points away from source) + lightIntensity
    const { lightDirX: x, lightDirY: y, lightDirZ: z, lightIntensity } = this.params;
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const lx = x / len, ly = y / len, lz = z / len;
    this.device.queue.writeBuffer(this.frameUniformBuffer, 80, new Float32Array([lx, ly, lz, lightIntensity]));

    // Light view-projection for shadow mapping (orthographic, from light's position)
    const lightPos  = [-lx * 20, -ly * 20, -lz * 20];
    const lightTarget = [lightPos[0] + lx, lightPos[1] + ly, lightPos[2] + lz];
    const up = Math.abs(ly) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const lightView     = mat4.lookAt(lightPos, lightTarget, up);
    const lightProj     = mat4.ortho(-15, 15, -15, 15, 0.1, 50);
    const lightViewProj = mat4.multiply(lightProj, lightView);
    this.device.queue.writeBuffer(this._shadowUniformBuf,   0,  lightViewProj as Float32Array);
    this.device.queue.writeBuffer(this.frameUniformBuffer,  96, lightViewProj as Float32Array);
  }

  render(): void {
    const encoder = this.device.createCommandEncoder();

    // 0. Shadow depth pass — render from light's perspective
    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view:            this._shadowDepthTex.createView(),
        depthClearValue: 1.0,
        depthLoadOp:     'clear',
        depthStoreOp:    'store',
      },
    });
    shadowPass.setPipeline(this._shadowPipeline);
    shadowPass.setBindGroup(0, this._sphereShadowBG);
    this.sphere.drawMesh(shadowPass);
    shadowPass.setBindGroup(0, this._floorShadowBG);
    this.floor.drawMesh(shadowPass);
    shadowPass.end();

    // 1. Scene → MSAA rgba16float, resolve to resolveTexture
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [{
        view:          this.msaaTexture.createView(),
        resolveTarget: this.resolveTexture.createView(),
        clearValue:    { r: 0.05, g: 0.05, b: 0.05, a: 1 },
        loadOp:        'clear',
        storeOp:       'discard',
      }],
      depthStencilAttachment: {
        view:            this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp:     'clear',
        depthStoreOp:    'store',
      },
    });
    scenePass.setBindGroup(2, this.iblBindGroup);
    scenePass.setBindGroup(3, this._sceneShadowBG);
    this.sphere.draw(scenePass);
    this.floor.draw(scenePass);

    this.skybox.draw(scenePass, this._view, this._proj);
    scenePass.end();

    // 2. Post compute: resolveTexture → postTexture
    const postPass = encoder.beginComputePass();
    postPass.setPipeline(this.postPipeline);
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.dispatchWorkgroups(
      Math.ceil(this.canvas.width  / 8),
      Math.ceil(this.canvas.height / 8),
    );
    postPass.end();

    // 3. Blit: postTexture → canvas
    const blitPass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
    });
    blitPass.setPipeline(this.blitPipeline);
    blitPass.setBindGroup(0, this.blitBindGroup);
    blitPass.draw(3);
    blitPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  private _frame(): void {
    this.update();
    this.render();
    requestAnimationFrame(() => this._frame());
  }

  start(): void {
    requestAnimationFrame(() => this._frame());
  }
}
