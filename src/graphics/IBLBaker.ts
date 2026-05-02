import { Texture }        from './Texture.ts';
import EQUIRECT_SHADER    from '../shaders/equirect-to-cubemap.wgsl?raw';
import CUBEMAP_MIP_SHADER from '../shaders/cubemap-mip.wgsl?raw';
import IRRADIANCE_SHADER  from '../shaders/cubemap-to-irradiance.wgsl?raw';
import PREFILTER_SHADER   from '../shaders/cubemap-to-prefilter.wgsl?raw';
import BRDF_LUT_SHADER    from '../shaders/brdf-lut.wgsl?raw';

export interface IBLResult {
  cubemapTex:     GPUTexture;
  irradianceTex:  GPUTexture;
  prefilteredTex: GPUTexture;
  brdfLut:        GPUTexture;
  cubeSampler:    GPUSampler;
}

export class IBLBaker {
  private readonly device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async bake(hdrUrl: string): Promise<IBLResult> {
    const CUBE_SIZE = 2048;
    const equirect  = await Texture.fromHDR(this.device, hdrUrl);

    const CUBE_MIP_COUNT = Math.log2(CUBE_SIZE) + 1;
    const cubemapTex = this.device.createTexture({
      size:          [CUBE_SIZE, CUBE_SIZE, 6],
      format:        'rgba16float',
      mipLevelCount: CUBE_MIP_COUNT,
      usage:         GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const equirectPipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: EQUIRECT_SHADER }), entryPoint: 'cs_main' },
    });
    const equirectBG = this.device.createBindGroup({
      layout:  equirectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: equirect.view },
        { binding: 1, resource: equirect.sampler },
        { binding: 2, resource: cubemapTex.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    });

    const equirectEncoder = this.device.createCommandEncoder();
    const equirectPass    = equirectEncoder.beginComputePass();
    equirectPass.setPipeline(equirectPipeline);
    equirectPass.setBindGroup(0, equirectBG);
    const wg = Math.ceil(CUBE_SIZE / 8);
    equirectPass.dispatchWorkgroups(wg, wg, 6);
    equirectPass.end();
    this.device.queue.submit([equirectEncoder.finish()]);

    this.generateCubemapMipmaps(cubemapTex);

    const cubeSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });

    const irradianceTex  = this.bakeIrradiance(cubemapTex, cubeSampler);
    const prefilteredTex = this.bakePrefilter(cubemapTex, cubeSampler);
    const brdfLut        = this.bakeBRDFLut();

    return { cubemapTex, irradianceTex, prefilteredTex, brdfLut, cubeSampler };
  }

  private generateCubemapMipmaps(texture: GPUTexture): void {
    const pipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: CUBEMAP_MIP_SHADER }), entryPoint: 'cs_main' },
    });
    const sampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

    for (let mip = 1; mip < texture.mipLevelCount; mip++) {
      const srcView   = texture.createView({ dimension: '2d-array', baseMipLevel: mip - 1, mipLevelCount: 1 });
      const dstView   = texture.createView({ dimension: '2d-array', baseMipLevel: mip,     mipLevelCount: 1 });
      const bindGroup = this.device.createBindGroup({
        layout:  pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: sampler },
          { binding: 2, resource: dstView },
        ],
      });

      const mipSize = Math.max(1, texture.width >> mip);
      const wg      = Math.ceil(mipSize / 8);
      const encoder = this.device.createCommandEncoder();
      const pass    = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wg, wg, 6);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
  }

  private bakeIrradiance(cubemapTex: GPUTexture, cubeSampler: GPUSampler): GPUTexture {
    const IRRADIANCE_SIZE = 32;
    const irradianceTex   = this.device.createTexture({
      size:   [IRRADIANCE_SIZE, IRRADIANCE_SIZE, 6],
      format: 'rgba16float',
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const pipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: IRRADIANCE_SHADER }), entryPoint: 'cs_main' },
    });
    const bindGroup = this.device.createBindGroup({
      layout:  pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: cubemapTex.createView({ dimension: 'cube' }) },
        { binding: 1, resource: cubeSampler },
        { binding: 2, resource: irradianceTex.createView({ dimension: '2d-array' }) },
      ],
    });

    const wg      = Math.ceil(IRRADIANCE_SIZE / 8);
    const encoder = this.device.createCommandEncoder();
    const pass    = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wg, wg, 6);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return irradianceTex;
  }

  private bakePrefilter(cubemapTex: GPUTexture, cubeSampler: GPUSampler): GPUTexture {
    const PREFILTER_SIZE      = 1024;
    const PREFILTER_MIP_COUNT = 5;

    const prefilteredTex = this.device.createTexture({
      size:          [PREFILTER_SIZE, PREFILTER_SIZE, 6],
      format:        'rgba16float',
      mipLevelCount: PREFILTER_MIP_COUNT,
      usage:         GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const pipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: PREFILTER_SHADER }), entryPoint: 'cs_main' },
    });

    const uniformBuf  = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cubemapView = cubemapTex.createView({ dimension: 'cube' });

    for (let mip = 0; mip < PREFILTER_MIP_COUNT; mip++) {
      const roughness = mip / (PREFILTER_MIP_COUNT - 1);
      const mipSize   = Math.max(1, PREFILTER_SIZE >> mip);

      this.device.queue.writeBuffer(uniformBuf, 0, new Float32Array([roughness]));

      const bindGroup = this.device.createBindGroup({
        layout:  pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: cubemapView },
          { binding: 1, resource: cubeSampler },
          { binding: 2, resource: prefilteredTex.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 }) },
          { binding: 3, resource: { buffer: uniformBuf } },
        ],
      });

      const wg      = Math.ceil(mipSize / 8);
      const encoder = this.device.createCommandEncoder();
      const pass    = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(wg, wg, 6);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    return prefilteredTex;
  }

  private bakeBRDFLut(): GPUTexture {
    const LUT_SIZE = 512;
    const brdfLut  = this.device.createTexture({
      size:   [LUT_SIZE, LUT_SIZE],
      format: 'rgba16float',
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const pipeline = this.device.createComputePipeline({
      layout:  'auto',
      compute: { module: this.device.createShaderModule({ code: BRDF_LUT_SHADER }), entryPoint: 'cs_main' },
    });
    const bindGroup = this.device.createBindGroup({
      layout:  pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: brdfLut.createView() }],
    });

    const wg      = Math.ceil(LUT_SIZE / 8);
    const encoder = this.device.createCommandEncoder();
    const pass    = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wg, wg, 1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return brdfLut;
  }
}
