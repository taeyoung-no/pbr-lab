import { Texture } from './Texture.ts';

export class Material {
  private readonly _device:           GPUDevice;
  readonly          pipeline:         GPURenderPipeline;
  private          _textureBindGroup: GPUBindGroup;
  private readonly _fallback:         Texture;

  private _albedo?:    Texture;
  private _normal?:    Texture;
  private _roughness?: Texture;
  private _metallic?:  Texture;
  private _ao?:        Texture;
  private _height?:    Texture;
  private _heightScale = 0;

  constructor(device: GPUDevice, pipeline: GPURenderPipeline) {
    this._device   = device;
    this.pipeline  = pipeline;
    this._fallback = Texture.fromColor(device, 0, 0, 0, false);

    this._textureBindGroup = this._buildTextureBindGroup();
  }

  setAlbedo(t: Texture):    void { this._albedo    = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setNormal(t: Texture):    void { this._normal    = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setRoughness(t: Texture): void { this._roughness = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setMetallic(t: Texture):  void { this._metallic  = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setAo(t: Texture):        void { this._ao        = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setHeight(t: Texture):    void { this._height    = t; this._textureBindGroup = this._buildTextureBindGroup(); }
  setHeightScale(s: number): void { this._heightScale = s; }

  get hasNormal():    boolean { return !!this._normal; }
  get hasRoughness(): boolean { return !!this._roughness; }
  get hasMetallic():  boolean { return !!this._metallic; }
  get hasAO():        boolean { return !!this._ao; }
  get hasHeight():    boolean { return !!this._height; }
  get heightScale():  number  { return this._heightScale; }

  bind(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(1, this._textureBindGroup);
  }

  private _buildTextureBindGroup(): GPUBindGroup {
    const fb  = this._fallback;
    const tex = (t: Texture | undefined) => t ?? fb;
    return this._device.createBindGroup({
      layout:  this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0,  resource: tex(this._albedo).view },
        { binding: 1,  resource: tex(this._albedo).sampler },
        { binding: 2,  resource: tex(this._normal).view },
        { binding: 3,  resource: tex(this._normal).sampler },
        { binding: 4,  resource: tex(this._roughness).view },
        { binding: 5,  resource: tex(this._roughness).sampler },
        { binding: 6,  resource: tex(this._metallic).view },
        { binding: 7,  resource: tex(this._metallic).sampler },
        { binding: 8,  resource: tex(this._ao).view },
        { binding: 9,  resource: tex(this._ao).sampler },
        { binding: 10, resource: tex(this._height).view },
        { binding: 11, resource: tex(this._height).sampler },
      ],
    });
  }

  destroy(): void {
    this._fallback.destroy();
  }
}
