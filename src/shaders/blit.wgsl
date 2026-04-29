@group(0) @binding(0) var tPost : texture_2d<f32>;
@group(0) @binding(1) var sPost : sampler;

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var uv  = array<vec2f, 3>(vec2f(0, 1),  vec2f(2, 1),  vec2f(0, -1));
  var out: VertexOutput;
  out.pos = vec4f(pos[vi], 0.0, 1.0);
  out.uv  = uv[vi];
  return out;
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let hdr    = textureSample(tPost, sPost, in.uv).rgb;
  let mapped = aces(hdr);
  let gamma  = pow(mapped, vec3f(1.0 / 2.2));
  return vec4f(gamma, 1.0);
}
