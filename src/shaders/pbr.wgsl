const PI             = 3.14159265359f;
const PREFILTER_MIPS = 5u;

struct FrameUniforms {
  viewProj      : mat4x4f,  // offset   0
  camPos        : vec3f,    // offset  64
  _pad          : f32,      // offset  76
  lightDir      : vec3f,    // offset  80  (direction the light points toward)
  lightIntensity: f32,      // offset  92
  lightViewProj : mat4x4f,  // offset  96
}

struct ObjectUniforms {
  model        : mat4x4f,  // offset  0
  hasNormal    : u32,      // offset 64
  hasRoughness : u32,      // offset 68
  hasMetallic  : u32,      // offset 72
  hasAO        : u32,      // offset 76
  hasHeight    : u32,      // offset 80
  heightScale  : f32,      // offset 84
  _pad1        : f32,      // offset 88
  _pad2        : f32,      // offset 92
}

@group(0) @binding(0) var<uniform> frame  : FrameUniforms;
@group(0) @binding(1) var<uniform> object : ObjectUniforms;

@group(1) @binding(0) var tAlbedo    : texture_2d<f32>;
@group(1) @binding(1) var sAlbedo    : sampler;
@group(1) @binding(2) var tNormal    : texture_2d<f32>;
@group(1) @binding(3) var sNormal    : sampler;
@group(1) @binding(4) var tRoughness : texture_2d<f32>;
@group(1) @binding(5) var sRoughness : sampler;
@group(1) @binding(6) var tMetallic  : texture_2d<f32>;
@group(1) @binding(7) var sMetallic  : sampler;
@group(1) @binding(8)  var tAO     : texture_2d<f32>;
@group(1) @binding(9)  var sAO     : sampler;
@group(1) @binding(10) var tHeight  : texture_2d<f32>;
@group(1) @binding(11) var sHeight  : sampler;

@group(2) @binding(0) var tIrradiance : texture_cube<f32>;
@group(2) @binding(1) var sIrradiance : sampler;
@group(2) @binding(2) var tPrefilter  : texture_cube<f32>;
@group(2) @binding(3) var sPrefilter  : sampler;
@group(2) @binding(4) var tBrdfLut    : texture_2d<f32>;
@group(2) @binding(5) var sBrdfLut    : sampler;

@group(3) @binding(0) var tShadow: texture_depth_2d;
@group(3) @binding(1) var sShadow: sampler_comparison;

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) normal   : vec3f,
  @location(2) texCoord : vec2f,
  @location(3) tangent  : vec3f,
}

struct VertexOutput {
  @builtin(position) clipPos  : vec4f,
  @location(0)       worldPos : vec3f,
  @location(1)       texCoord : vec2f,
  @location(2)       T        : vec3f,
  @location(3)       B        : vec3f,
  @location(4)       N        : vec3f,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  var localPos = in.position;
  if object.hasHeight != 0u {
    // textureSampleLevel required in vertex shader (no implicit derivatives)
    let h = textureSampleLevel(tHeight, sHeight, in.texCoord, 0.0).r;
    localPos += in.normal * h * object.heightScale;
  }
  let worldPos  = object.model * vec4f(localPos, 1.0);
  out.clipPos   = frame.viewProj * worldPos;
  out.worldPos  = worldPos.xyz;
  out.texCoord  = in.texCoord;

  // Upper-left 3x3 of model matrix (valid for uniform scale)
  let m3 = mat3x3f(object.model[0].xyz, object.model[1].xyz, object.model[2].xyz);
  let N  = normalize(m3 * in.normal);
  var T  = normalize(m3 * in.tangent);
  T = normalize(T - dot(T, N) * N);  // Gram-Schmidt re-orthogonalize

  out.T = T;
  out.B = cross(N, T);
  out.N = N;
  return out;
}

// ── BRDF helpers ─────────────────────────────────────────────────────────────

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn fresnelSchlickRoughness(cosTheta: f32, F0: vec3f, roughness: f32) -> vec3f {
  return F0 + (max(vec3f(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
  let a  = roughness * roughness;
  let a2 = a * a;
  let d  = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

fn geometrySchlickGGX(NdotX: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return NdotX / (NdotX * (1.0 - k) + k);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

// ── Lighting ─────────────────────────────────────────────────────────────────

fn iblDiffuse(N: vec3f, F0: vec3f, metallic: f32, albedo: vec3f, NdotV: f32, roughness: f32) -> vec3f {
  let F  = fresnelSchlickRoughness(NdotV, F0, roughness);
  let kD = (1.0 - F) * (1.0 - metallic);
  return kD * albedo * textureSample(tIrradiance, sIrradiance, N).rgb;
}

fn iblSpecular(R: vec3f, F0: vec3f, NdotV: f32, roughness: f32) -> vec3f {
  let F                = fresnelSchlickRoughness(NdotV, F0, roughness);
  let mip              = roughness * f32(PREFILTER_MIPS - 1u);
  let prefilteredColor = textureSampleLevel(tPrefilter, sPrefilter, R, mip).rgb;
  let brdf             = textureSample(tBrdfLut, sBrdfLut, vec2f(NdotV, roughness)).rg;
  return prefilteredColor * (F * brdf.x + brdf.y);
}

fn directLighting(N: vec3f, V: vec3f, F0: vec3f, albedo: vec3f, metallic: f32, roughness: f32, NdotV: f32) -> vec3f {
  let L     = normalize(-frame.lightDir);
  let H     = normalize(V + L);
  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let HdotV = max(dot(H, V), 0.0);

  let D      = distributionGGX(NdotH, roughness);
  let G      = geometrySmith(NdotV, NdotL, roughness);
  let Fdir   = fresnelSchlick(HdotV, F0);
  let spec   = (D * G * Fdir) / max(4.0 * NdotV * NdotL, 0.001);
  let kD_dir = (1.0 - Fdir) * (1.0 - metallic);
  return (kD_dir * albedo / PI + spec) * vec3f(frame.lightIntensity) * NdotL;
}

fn calcShadow(worldPos: vec3f, N: vec3f) -> f32 {
  let L          = normalize(-frame.lightDir);
  let NdotL      = max(dot(N, L), 0.0);
  let lightClip  = frame.lightViewProj * vec4f(worldPos, 1.0);
  let projCoords = lightClip.xyz;
  let shadowUV   = vec2f(projCoords.x * 0.5 + 0.5, projCoords.y * -0.5 + 0.5);
  let inFrustum  = projCoords.z >= 0.0 && projCoords.z <= 1.0
                && shadowUV.x  >= 0.0 && shadowUV.x  <= 1.0
                && shadowUV.y  >= 0.0 && shadowUV.y  <= 1.0;

  // textureSampleCompare requires uniform control flow — always sample, then select result
  let bias      = max(0.005 * (1.0 - NdotL), 0.0005);
  let texelSize = 1.0 / 2048.0;
  var shadow    = 0.0;
  for (var dx: i32 = -1; dx <= 1; dx++) {
    for (var dy: i32 = -1; dy <= 1; dy++) {
      let offset = vec2f(f32(dx), f32(dy)) * texelSize;
      shadow += textureSampleCompare(tShadow, sShadow, shadowUV + offset, projCoords.z - bias);
    }
  }
  return select(1.0, shadow / 9.0, inFrustum);
}

// ── Fragment ──────────────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let albedo    = textureSample(tAlbedo,    sAlbedo,    in.texCoord).rgb;
  let roughness = select(0.0, textureSample(tRoughness, sRoughness, in.texCoord).r, object.hasRoughness != 0u);
  let metallic  = select(0.0, textureSample(tMetallic,  sMetallic,  in.texCoord).r, object.hasMetallic  != 0u);
  let ao        = select(1.0, textureSample(tAO,        sAO,        in.texCoord).r, object.hasAO        != 0u);

  var N: vec3f;
  if object.hasNormal != 0u {
    let n   = textureSample(tNormal, sNormal, in.texCoord).rgb * 2.0 - 1.0;
    let TBN = mat3x3f(in.T, in.B, in.N);
    N = normalize(TBN * n);
  } else {
    N = normalize(in.N);
  }

  let V     = normalize(frame.camPos - in.worldPos);
  let R     = reflect(-V, N);
  let NdotV = max(dot(N, V), 0.0);
  let F0    = mix(vec3f(0.04), albedo, metallic);

  let ambient = (iblDiffuse(N, F0, metallic, albedo, NdotV, roughness)
               + iblSpecular(R, F0, NdotV, roughness)) * ao;
  let Lo      = directLighting(N, V, F0, albedo, metallic, roughness, NdotV);
  let sf      = calcShadow(in.worldPos, N);

  return vec4f(ambient + Lo * sf, 1.0);
}
