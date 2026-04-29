// Shadow depth pass — writes depth from directional light's perspective

struct ShadowUniforms {
  lightViewProj: mat4x4f,
}

struct ObjectUniforms {
  model: mat4x4f,
}

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;
@group(0) @binding(1) var<uniform> object: ObjectUniforms;

@vertex
fn vs_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return shadow.lightViewProj * object.model * vec4f(position, 1.0);
}
