# PBR Lab

WebGPU renderer exploring physically-based rendering techniques. **[Live demo](https://taeyoung-no.github.io/pbr-lab/)**

**Features**
- PBR shading with Cook-Torrance BRDF (GGX NDF, Smith geometry, Fresnel-Schlick)
- Image-Based Lighting (IBL) — irradiance convolution, pre-filtered environment map, BRDF LUT
- Directional shadow mapping with PCF (3×3, NdotL-based adaptive bias)
- Post-processing via compute shader — ACES tone mapping, gamma correction
- MSAA with HDR resolve pipeline (rgba16float)

---

## Dependencies

**System**
- Node.js 20+
- A browser with WebGPU support (Chrome 113+, Edge 113+)

**npm (auto-installed)**
- vite ^8.0
- typescript ~6.0
- @webgpu/types ^0.1
- wgpu-matrix ^3.4
- lil-gui ^0.21

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

Output: `dist/`

## Credits

- `public/assets/sky/` — [Poly Haven](https://polyhaven.com/)
- `public/assets/model/` — [AmbientCG](https://ambientcg.com/)
- `public/assets/f-texture.png` — [WebGL Fundamentals](https://webglfundamentals.org/) (F texture)
