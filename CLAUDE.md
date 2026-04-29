# PBR Lab

A WebGPU-based Physically-Based Rendering playground.

## Tech Stack

| Package | Version / Notes |
|---------|----------------|
| Vite | ^8.0 — bundler & dev server |
| TypeScript | ~6.0 — `noEmit`, bundler moduleResolution |
| WebGPU | browser-native API (`@webgpu/types` ^0.1) |
| wgpu-matrix | ^3.4 — GPU-friendly math (`mat4`, `vec3`, …) |
| lil-gui | ^0.21 — debug GUI panel |

Do not add new libraries unless the user explicitly requests them.

## Commands

```bash
npm run dev      # start Vite dev server
npm run build    # tsc + Vite production build
npm run preview  # serve production build locally
```

## Project Structure

```
pbr-lab/
├── index.html              # fullscreen <canvas id="canvas">, inline reset CSS
├── src/
│   ├── main.ts             # entry point; creates Renderer, init() → lil-gui setup → start()
│   ├── Renderer.ts         # all WebGPU logic: IBL bake passes, scene setup, render loop; exposes `params` for GUI
│   ├── graphics/
│   │   ├── Vertex.ts       # Vertex interface, VERTEX_BUFFER_LAYOUT, packVertices
│   │   ├── Mesh.ts         # GPUBuffer wrapper (vertex + index), draw, destroy
│   │   ├── MeshGenerator.ts# createSphere / createCube / createPlane
│   │   └── Texture.ts      # GPUTexture wrapper; from / fromColor / fromCheckerboard / fromHDR
│   ├── scene/
│   │   ├── Object.ts       # transform + PBR texture slots (albedo/normal/metallic/roughness/ao/height)
│   │   ├── Camera.ts       # orbital camera, pointer/wheel events, getView/getPosition
│   │   └── Skybox.ts       # cubemap skybox render (cube mesh, no depth write)
│   └── shaders/            # .wgsl files, imported via ?raw
│       ├── pbr.wgsl                    # IBL PBR scene shader (Cook-Torrance, split-sum IBL, shadow)
│       ├── shadow.wgsl                 # depth-only vertex shader for shadow pass
│       ├── skybox.wgsl                 # skybox vertex/fragment
│       ├── equirect-to-cubemap.wgsl    # compute: HDR equirect → rgba16float cubemap
│       ├── cubemap-to-irradiance.wgsl  # compute: irradiance convolution
│       ├── cubemap-to-prefilter.wgsl   # compute: pre-filtered env map (5 roughness mips)
│       ├── brdf-lut.wgsl               # compute: BRDF integration LUT (512×512, rgba16float)
│       ├── post.wgsl                   # compute: ACES tone mapping + gamma correction
│       └── blit.wgsl                   # fullscreen triangle blit to swap-chain
└── public/                 # static assets
    └── assets/
        ├── sky/env.hdr     # HDR environment map
        └── model/          # PBR textures (AmbientCG): color, normal, metallic, roughness
```

## Code Conventions

### WGSL Shaders
- All shaders live in `src/shaders/` as `.wgsl` files.
- Imported via Vite's built-in `?raw` suffix: `import SHADER from './shaders/foo.wgsl?raw'`

### Vertex Layout (`graphics/Vertex.ts`)
- Interleaved `Float32Array`: `[x, y, z, nx, ny, nz, u, v, tx, ty, tz]` — 11 floats / 44 bytes per vertex
- `VERTEX_BUFFER_LAYOUT` — use directly as the `buffers` entry in any render pipeline

| location | attribute | format |
|----------|-----------|--------|
| 0 | position | float32x3 |
| 1 | normal   | float32x3 |
| 2 | texCoord | float32x2 |
| 3 | tangent  | float32x3 |

### Texture (`graphics/Texture.ts`)
- Four factory methods — all bundle a `GPUSampler` with the texture:
  - `from(device, url, sRGB=true)` — async; `fetch` → `createImageBitmap` → `copyExternalImageToTexture`. Needs `RENDER_ATTACHMENT` usage for sRGB color-space conversion.
  - `fromColor(device, r, g, b, sRGB=true)` — 1×1 solid color; `writeTexture`, nearest sampler.
  - `fromCheckerboard(device, tileCount=8, size=64)` — CPU-generated pixels; `writeTexture`, linear sampler.
  - `fromHDR(device, url)` — async; decodes Radiance RGBE (.hdr) in-browser, uploads as `rgba16float`. Clamp-to-edge sampler. Used for equirectangular HDR environment maps.
- Format: `rgba8unorm-srgb` when `sRGB=true` (albedo/diffuse); `rgba8unorm` when `sRGB=false` (normal/roughness/metallic/AO/height); `rgba16float` for HDR.
- Access via `texture.view` (`GPUTextureView`) and `texture.sampler` (`GPUSampler`).
- Image assets imported via Vite URL import: `import url from './assets/foo.png'` — pass the resolved URL string to `Texture.from()`.

### Texture Coordinates
- **WebGPU convention**: (0, 0) = top-left; U increases right, V increases downward.
- **OpenGL convention**: (0, 0) = bottom-left; V increases upward.
- Converting OpenGL → WebGPU: flip V → `v_webgpu = 1 − v_opengl`.
- All `MeshGenerator` functions use the WebGPU convention.

### WebGPU Conventions
- Init order: `requestAdapter → requestDevice → context.configure()`
- `canvas.width/height` = `window.innerWidth/innerHeight`; reconfigure context + recreate depth texture on every `resize`.
- Depth format: `depth24plus`, compare: `less`, cull: `back`.
- On fatal error, render `<pre style="color:red">` to the page.

### Bind Group Layout (`pbr.wgsl`)

**Group 0 — Uniforms** (binding 0 = `FrameUniforms` 160 B, binding 1 = `ObjectUniforms` 96 B):

`FrameUniforms` (binding 0, shared per frame):

| offset | field | type |
|--------|-------|------|
| 0 | viewProj | mat4x4f |
| 64 | camPos | vec3f |
| 76 | _pad | f32 |
| 80 | lightDir | vec3f (direction light points toward) |
| 92 | lightIntensity | f32 |
| 96 | lightViewProj | mat4x4f |

`ObjectUniforms` (binding 1, per draw call):

| offset | field | type |
|--------|-------|------|
| 0 | model | mat4x4f |
| 64 | hasNormal | u32 |
| 68 | hasRoughness | u32 |
| 72 | hasMetallic | u32 |
| 76 | hasAO | u32 |
| 80 | hasHeight | u32 |
| 84 | heightScale | f32 |
| 88 | _pad1, _pad2 | f32 × 2 |

**Group 1 — Material textures** (bindings 0–11):

| binding | resource |
|---------|----------|
| 0 / 1 | tAlbedo / sAlbedo |
| 2 / 3 | tNormal / sNormal |
| 4 / 5 | tRoughness / sRoughness |
| 6 / 7 | tMetallic / sMetallic |
| 8 / 9 | tAO / sAO |
| 10 / 11 | tHeight / sHeight |

Missing textures use 1×1 fallbacks (`fromColor`): AO → white, height → black.

**Group 2 — IBL** (bindings 0–5):

| binding | resource |
|---------|----------|
| 0 / 1 | tIrradiance (texture_cube) / sIrradiance |
| 2 / 3 | tPrefilter (texture_cube) / sPrefilter |
| 4 / 5 | tBrdfLut (texture_2d) / sBrdfLut |

**Group 3 — Shadow** (bindings 0–1):

| binding | resource |
|---------|----------|
| 0 | tShadow (`texture_depth_2d`, 2048×2048 `depth32float`) |
| 1 | sShadow (`sampler_comparison`, `compare: 'less-equal'`) |

### PBR Shader (`pbr.wgsl`)
- **Vertex**: TBN matrix constructed from normal + tangent (Gram-Schmidt); height map displacement via `textureSampleLevel` (explicit LOD required in vertex stage).
- **Fragment**: four helper functions called from `fs_main`:
  - `iblDiffuse(N, F0, metallic, albedo, NdotV, roughness)` — `kD * albedo * irradiance`
  - `iblSpecular(R, F0, NdotV, roughness)` — split-sum: `prefilteredColor * (F * brdf.r + brdf.g)`
  - `directLighting(N, V, F0, albedo, metallic, roughness, NdotV)` — Cook-Torrance with directional light
  - `calcShadow(worldPos, N)` — 3×3 PCF shadow lookup, returns shadow factor `[0, 1]`
- Final output: `vec4f(ambient + directLo * shadowFactor, 1.0)` — linear HDR, tone-mapped downstream.
- Fresnel: `fresnelSchlickRoughness` for IBL energy split; `fresnelSchlick` for direct lighting.

### Shadow Pass (`shadow.wgsl`)
- Depth-only vertex shader; no fragment stage.
- Bind group 0: `ShadowUniforms { lightViewProj }` (binding 0) + `ObjectUniforms { model }` (binding 1).
- Pipeline uses position-only vertex attribute (location 0, `float32x3`) with the same 44-byte stride as the full vertex layout — other attributes are simply ignored.
- Shadow map: 2048×2048 `depth32float` texture, `TEXTURE_BINDING | RENDER_ATTACHMENT` usage.
- Light transform: orthographic projection (`ortho(-15, 15, -15, 15, 0.1, 50)`) × `lookAt(lightPos, lightTarget, up)`, recomputed each frame in `update()`.
  - `lightPos = -normalize(lightDir) * 20`, `lightTarget = lightPos + normalize(lightDir)`
  - Degenerate up-vector: use `[0, 0, 1]` when `|ly| > 0.99`, else `[0, 1, 0]`.
- `lightViewProj` written to both `_shadowUniformBuf` (offset 0) and `frameUniformBuffer` (offset 96).

### Shadow Sampling (`calcShadow` in `pbr.wgsl`)
- NDC → UV: `shadowUV = vec2f(x * 0.5 + 0.5, y * -0.5 + 0.5)` (WebGPU Z ∈ [0,1], Y flipped).
- Frustum guard: `inFrustum = z ∈ [0,1] && uv ∈ [0,1]²`; outside → shadow factor = 1.0 (lit).
- NdotL-based adaptive bias: `bias = max(0.005 * (1.0 - NdotL), 0.0005)`.
- 3×3 PCF: always execute 9 `textureSampleCompare` calls unconditionally (WGSL uniform control flow requirement), then `select(1.0, shadow / 9.0, inFrustum)`.
  - `textureSampleCompare` must not appear inside non-uniform `if` branches — use `select()` instead.

### HDR Render Pipeline
Scene is rendered through a 4-pass pipeline per frame:
1. **Shadow pass** — depth-only render from the directional light's perspective into `_shadowDepthTex` (2048×2048 `depth32float`). No color attachments.
2. **Scene pass** — MSAA (`sampleCount: 4`) render to `rgba16float` MSAA target; resolves to a single-sample `rgba16float` texture.
3. **Post compute pass** — compute shader reads `resolveTexture`, applies tone mapping + gamma correction, writes to `postTexture` (both `rgba16float`).
4. **Blit pass** — fullscreen triangle renders `postTexture` to the swap-chain canvas surface.

Per-size textures (`depthTexture`, `msaaTexture`, `resolveTexture`, `postTexture`) and their bind groups are recreated on every `resize`.

### Cubemap / IBL Pipeline
One-time compute passes run at startup (`Renderer._bakeIBL`) before the render loop:
1. **Equirect → Cubemap** — `equirect-to-cubemap.wgsl` bakes an HDR equirectangular texture into a `rgba16float` cubemap (`CUBE_SIZE = 2048`, 6 layers).
2. **Cubemap mipmap generation** — inline WGSL compute shader box-filters each mip level from the previous one (`mip = 1 … mipLevelCount-1`).
3. **Irradiance map** — `cubemap-to-irradiance.wgsl` integrates irradiance convolution (Riemann sum over hemisphere), writes `rgba16float` cubemap (`IRRADIANCE_SIZE = 32`).
4. **Pre-filtered env map** — `cubemap-to-prefilter.wgsl` bakes GGX importance-sampled env map into 5 roughness mip levels (`PREFILTER_SIZE = 1024`). Roughness uniform passed per-mip.
5. **BRDF LUT** — `brdf-lut.wgsl` integrates the split-sum BRDF into a 512×512 `rgba16float` texture (NdotV × roughness → scale/bias).

### Skybox (`scene/Skybox.ts`)
- Renders a cube mesh with `cullMode: 'none'`, `depthWriteEnabled: false`, `depthCompare: 'less-equal'` so it renders behind all scene geometry.
- Bind group layout: group 0 = uniform buffer (`viewProj` with translation zeroed out, 64 B); group 1 = cubemap view + sampler.
- `setCubemap(view, sampler)` — call after construction to attach a `texture_cube` view.
- `draw(pass, view, proj)` — strips translation from `view` internally before uploading.

### Object (`scene/Object.ts`)
- `draw(pass)` — sets bind group 0 (uniforms), calls `material.bind()` (pipeline + group 1), then `drawMesh()`.
- `drawMesh(pass)` — uploads model matrix and draws geometry only; used by the shadow pass to reuse object buffers without re-binding the full PBR pipeline.
- `objectBuffer` getter — exposes `_objectBuffer` so `Renderer._buildShadow()` can reference it in per-object shadow bind groups.

### Camera (`scene/Camera.ts`)
- Orbital (spherical coords): `radius`, `azimuth`, `elevation`.
- Attaches its own `pointerdown/move/up` + `wheel` listeners on the canvas; call `destroy()` to remove them.
- `setPointerCapture` keeps drag alive outside the canvas.
- `getPosition()` returns world-space camera position (used for camPos uniform).
- Call `camera.setSize(w, h)` on every resize to keep rotation speed correct.

### Debug GUI (`lil-gui`)
- Initialized in `main.ts` after `renderer.init()` resolves, before `renderer.start()`.
- `Renderer.params` — plain object (`readonly params = { ... }`) that holds all GUI-controllable values. `update()` reads from it every frame.
- Theme: white via CSS custom property overrides on `gui.domElement.style` (`--background-color`, `--widget-color`, etc.). No external CSS file needed.
- Adding a new control: add the field to `Renderer.params`, read it in `update()`, then call `gui.add(renderer.params, 'fieldName', ...)` in `main.ts`.

### TypeScript Strictness
- `noUnusedLocals` / `noUnusedParameters` — no dead variables.
- `erasableSyntaxOnly` — no `enum`, `namespace`, or constructor parameter properties; declare fields explicitly.
- `verbatimModuleSyntax` — type-only imports must use `import type`.

## Implementation Progress

- [x] WebGPU device init + render loop
- [x] Hello Triangle (vertex buffer, render pipeline, WGSL shaders)
- [x] Vertex / Mesh / MeshGenerator / Object (graphics + scene layer)
- [x] Orbital Camera (pointer drag + scroll zoom)
- [x] Sphere with normal-visualization shader (depth buffer, uniform buffer, back-face cull)
- [x] Texture (from URL / fromColor / fromCheckerboard); PBR texture slots on Object
- [x] Albedo texture sampling (group 0 = uniforms, group 1 = material textures)
- [x] HDR render pipeline (MSAA rgba16float → tone map compute → blit)
- [x] HDR equirectangular loading (`Texture.fromHDR`, RGBE decoder, rgba16float upload)
- [x] Equirect → cubemap bake (compute, `equirect-to-cubemap.wgsl`)
- [x] Cubemap mipmap generation (compute, inline shader in `Renderer.ts`)
- [x] Irradiance map bake (compute, `cubemap-to-irradiance.wgsl`)
- [x] Pre-filtered environment map (compute, `cubemap-to-prefilter.wgsl`, 5 roughness mips)
- [x] BRDF integration LUT (compute, `brdf-lut.wgsl`, 512×512 rgba16float)
- [x] Skybox rendering (`Skybox` class, `skybox.wgsl`)
- [x] Full PBR + IBL shader (`pbr.wgsl`): Cook-Torrance BRDF, split-sum specular, TBN normal mapping, height map displacement
- [x] Direct lighting: single directional light (Cook-Torrance, `lightDir` + `lightIntensity` in `FrameUniforms`)
- [x] Debug GUI (`lil-gui`): Inspector panel with light direction / intensity controls; white theme via CSS variable overrides
- [x] Shadow mapping: directional light orthographic shadow map (2048×2048 `depth32float`), 3×3 PCF with NdotL-based adaptive bias, `shadow.wgsl` depth-only pass
