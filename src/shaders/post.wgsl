@group(0) @binding(0) var tHDR : texture_2d<f32>;
@group(0) @binding(1) var tOut : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(tOut);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  textureStore(tOut, gid.xy, textureLoad(tHDR, gid.xy, 0));
}
