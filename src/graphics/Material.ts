import { Texture } from './Texture.ts';

export class Material {
  private readonly device:           GPUDevice;
  readonly          pipeline:        GPURenderPipeline;
  private          textureBindGroup: GPUBindGroup;
  private readonly fallback:         Texture;

  private albedo?:    Texture;
  private normal?:    Texture;
  private roughness?: Texture;
  private metallic?:  Texture;
  private ao?:        Texture;
  private height?:    Texture;
  private _heightScale = 0;

  constructor(device: GPUDevice, pipeline: GPURenderPipeline) {
    this.device   = device;
    this.pipeline = pipeline;
    this.fallback = Texture.fromColor(device, 0, 0, 0, false);

    this.textureBindGroup = this.buildTextureBindGroup();
  }

  setAlbedo(t: Texture):     void { this.albedo    = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setNormal(t: Texture):     void { this.normal    = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setRoughness(t: Texture):  void { this.roughness = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setMetallic(t: Texture):   void { this.metallic  = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setAo(t: Texture):         void { this.ao        = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setHeight(t: Texture):     void { this.height    = t; this.textureBindGroup = this.buildTextureBindGroup(); }
  setHeightScale(s: number): void { this._heightScale = s; }

  get hasNormal():    boolean { return !!this.normal; }
  get hasRoughness(): boolean { return !!this.roughness; }
  get hasMetallic():  boolean { return !!this.metallic; }
  get hasAO():        boolean { return !!this.ao; }
  get hasHeight():    boolean { return !!this.height; }
  get heightScale():  number  { return this._heightScale; }

  bind(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(1, this.textureBindGroup);
  }

  private buildTextureBindGroup(): GPUBindGroup {
    const fb  = this.fallback;
    const tex = (t: Texture | undefined) => t ?? fb;
    return this.device.createBindGroup({
      layout:  this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0,  resource: tex(this.albedo).view },
        { binding: 1,  resource: tex(this.albedo).sampler },
        { binding: 2,  resource: tex(this.normal).view },
        { binding: 3,  resource: tex(this.normal).sampler },
        { binding: 4,  resource: tex(this.roughness).view },
        { binding: 5,  resource: tex(this.roughness).sampler },
        { binding: 6,  resource: tex(this.metallic).view },
        { binding: 7,  resource: tex(this.metallic).sampler },
        { binding: 8,  resource: tex(this.ao).view },
        { binding: 9,  resource: tex(this.ao).sampler },
        { binding: 10, resource: tex(this.height).view },
        { binding: 11, resource: tex(this.height).sampler },
      ],
    });
  }

  destroy(): void {
    this.fallback.destroy();
  }
}
