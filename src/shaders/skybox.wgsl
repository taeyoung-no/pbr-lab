struct Uniforms {
  viewProj : mat4x4f,
}

@group(0) @binding(0) var<uniform> u       : Uniforms;
@group(1) @binding(0) var          tSkybox : texture_cube<f32>;
@group(1) @binding(1) var          sSkybox : sampler;

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0)       localPos : vec3f,
}

@vertex
fn vs_main(@location(0) position: vec3f) -> VertexOutput {
  var out: VertexOutput;
  let clip    = u.viewProj * vec4f(position, 1.0);
  out.position = vec4f(clip.xy, clip.w, clip.w); // depth = 1.0 (renders behind all geometry)
  out.localPos = position;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  return textureSample(tSkybox, sSkybox, in.localPos);
}
