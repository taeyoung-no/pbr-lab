export class Texture {
  private readonly _texture: GPUTexture;
  private readonly _view:    GPUTextureView;
  private readonly _sampler: GPUSampler;

  private constructor(texture: GPUTexture, view: GPUTextureView, sampler: GPUSampler) {
    this._texture = texture;
    this._view    = view;
    this._sampler = sampler;
  }

  // Load from URL (PNG/JPG/…). sRGB=true for albedo; sRGB=false for normal/roughness/metallic/AO.
  static async from(device: GPUDevice, url: string, sRGB = true): Promise<Texture> {
    const res    = await fetch(url);
    const blob   = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const format: GPUTextureFormat = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const texture = device.createTexture({
      size:  [bitmap.width, bitmap.height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING
           | GPUTextureUsage.COPY_DST
           | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    bitmap.close();

    const view    = texture.createView();
    const sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter:    'linear',
      minFilter:    'linear',
    });

    return new Texture(texture, view, sampler);
  }

  // 1×1 solid-color texture. r/g/b are 0–255. sRGB=true for albedo fallbacks.
  static fromColor(device: GPUDevice, r: number, g: number, b: number, sRGB = true): Texture {
    const format: GPUTextureFormat = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const texture = device.createTexture({
      size:  [1, 1],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture },
      new Uint8Array([r, g, b, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    const view    = texture.createView();
    const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

    return new Texture(texture, view, sampler);
  }

  // tileCount×tileCount checkerboard, size×size pixels total.
  static fromCheckerboard(device: GPUDevice, tileCount = 8, size = 64): Texture {
    const pixels   = new Uint8Array(size * size * 4);
    const tileSize = size / tileCount;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const white = (Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0;
        const v     = white ? 255 : 0;
        const i     = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
        pixels[i + 3] = 255;
      }
    }

    const texture = device.createTexture({
      size:   [size, size],
      format: 'rgba8unorm-srgb',
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture },
      pixels,
      { bytesPerRow: size * 4 },
      [size, size],
    );

    const view    = texture.createView();
    const sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter:    'linear',
      minFilter:    'linear',
    });

    return new Texture(texture, view, sampler);
  }

  // Load an HDR (RGBE) equirectangular image. Uploads as rgba16float for universal linear filtering.
  static async fromHDR(device: GPUDevice, url: string): Promise<Texture> {
    const res   = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { width, height, data } = decodeRGBE(bytes);

    const texture = device.createTexture({
      size:   [width, height],
      format: 'rgba16float',
      usage:  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture },
      packFloat16(data),
      { bytesPerRow: width * 8 }, // 4 channels × 2 bytes
      [width, height],
    );

    const view    = texture.createView();
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter:    'linear',
      minFilter:    'linear',
    });

    return new Texture(texture, view, sampler);
  }

  get view():    GPUTextureView { return this._view; }
  get sampler(): GPUSampler     { return this._sampler; }

  destroy(): void {
    this._texture.destroy();
  }
}

// Decode a Radiance RGBE (.hdr) file into linear RGBA float data.
// Only supports new-style RLE (the format written by every modern tool).
function decodeRGBE(bytes: Uint8Array): { width: number; height: number; data: Float32Array } {
  const dec = new TextDecoder('ascii');

  // Skip info header lines; header ends at blank line (\n\n).
  let i = 0;
  while (i < bytes.length - 1 && !(bytes[i] === 0x0A && bytes[i + 1] === 0x0A)) i++;
  i += 2;

  // Next line is the resolution string, e.g. "-Y 512 +X 1024".
  let j = i;
  while (j < bytes.length && bytes[j] !== 0x0A) j++;
  const dim = dec.decode(bytes.slice(i, j)).match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!dim) throw new Error('HDR: no resolution string');
  const height = parseInt(dim[1]);
  const width  = parseInt(dim[2]);
  i = j + 1;

  const out = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    // New-RLE scanline header: [2, 2, widthHigh, widthLow]
    if (bytes[i] !== 2 || bytes[i + 1] !== 2 || bytes[i + 2] & 0x80)
      throw new Error('HDR: unsupported format (expected new-RLE)');
    i += 4;

    // Four channels (R, G, B, E) stored independently, each RLE-compressed.
    const rgbe = new Uint8Array(width * 4);
    for (let ch = 0; ch < 4; ch++) {
      let px = 0;
      while (px < width) {
        const code = bytes[i++];
        if (code > 128) {
          const run = code - 128;
          const val = bytes[i++];
          for (let k = 0; k < run; k++) rgbe[px++ * 4 + ch] = val;
        } else {
          for (let k = 0; k < code; k++) rgbe[px++ * 4 + ch] = bytes[i++];
        }
      }
    }

    // RGBE → linear float (Ward 1991): value = mantissa * 2^(exponent − 128 − 8)
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const e = rgbe[x * 4 + 3];
      const s = e ? Math.pow(2, e - 136) : 0;
      out[row + x * 4]     = rgbe[x * 4]     * s;
      out[row + x * 4 + 1] = rgbe[x * 4 + 1] * s;
      out[row + x * 4 + 2] = rgbe[x * 4 + 2] * s;
      out[row + x * 4 + 3] = 1;
    }
  }

  return { width, height, data: out };
}

function packFloat16(src: Float32Array): Uint16Array {
  const dst  = new Uint16Array(src.length);
  const fbuf = new Float32Array(1);
  const ibuf = new Uint32Array(fbuf.buffer);
  for (let i = 0; i < src.length; i++) {
    fbuf[0] = src[i];
    dst[i]  = f32ToF16(ibuf[0]);
  }
  return dst;
}

function f32ToF16(bits: number): number {
  const sign = bits & 0x80000000;
  const exp  = bits & 0x7f800000;
  const mant = bits & 0x007fffff;
  if (exp === 0x7f800000) return (sign >>> 16) | 0x7c00 | (mant ? 0x0200 : 0); // Inf/NaN
  const h = (exp >>> 23) - 127 + 15;
  if (h >= 31) return (sign >>> 16) | 0x7c00;                                  // overflow → Inf
  if (h <= 0)  return h < -10 ? sign >>> 16 : (sign >>> 16) | ((mant | 0x800000) >>> (14 - h)); // subnormal/zero
  return (sign >>> 16) | (h << 10) | (mant >>> 13);
}
