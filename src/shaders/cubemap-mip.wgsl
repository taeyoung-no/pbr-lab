@group(0) @binding(0) var src:      texture_2d_array<f32>;
@group(0) @binding(1) var src_samp: sampler;
@group(0) @binding(2) var dst:      texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let uv    = (vec2f(gid.xy) + 0.5) / vec2f(size);
  let color = textureSampleLevel(src, src_samp, uv, i32(gid.z), 0.0);
  textureStore(dst, vec2i(gid.xy), i32(gid.z), color);
}
