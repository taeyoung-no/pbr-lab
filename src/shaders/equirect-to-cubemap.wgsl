@group(0) @binding(0) var equirectMap     : texture_2d<f32>;
@group(0) @binding(1) var equirectSampler : sampler;
@group(0) @binding(2) var cubemapOut      : texture_storage_2d_array<rgba16float, write>;

const INV_ATAN = vec2f(0.15915494, 0.31830989); // 1/(2*PI), 1/PI

fn equirect_uv(dir: vec3f) -> vec2f {
    var uv = vec2f(atan2(dir.z, dir.x), -asin(dir.y));
    uv *= INV_ATAN;
    uv += 0.5;
    return uv;
}

// Maps a texel (face, u, v) to a unit direction vector.
// u, v in [0, 1]; face order: +X=0, -X=1, +Y=2, -Y=3, +Z=4, -Z=5
fn face_direction(face: u32, uv: vec2f) -> vec3f {
    let u = uv.x * 2.0 - 1.0;
    let v = uv.y * 2.0 - 1.0;
    switch face {
        case 0u: { return normalize(vec3f( 1.0,  -v,  -u)); } // +X
        case 1u: { return normalize(vec3f(-1.0,  -v,   u)); } // -X
        case 2u: { return normalize(vec3f(  u,  1.0,   v)); } // +Y
        case 3u: { return normalize(vec3f(  u, -1.0,  -v)); } // -Y
        case 4u: { return normalize(vec3f(  u,   -v, 1.0)); } // +Z
        case 5u: { return normalize(vec3f( -u,   -v,-1.0)); } // -Z
        default: { return vec3f(0.0); }
    }
}

// Dispatch: (ceil(faceSize/8), ceil(faceSize/8), 6)
@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
    let face     = gid.z;
    let faceSize = textureDimensions(cubemapOut);

    if gid.x >= faceSize.x || gid.y >= faceSize.y { return; }

    let uv    = (vec2f(gid.xy) + 0.5) / vec2f(faceSize);
    let dir   = face_direction(face, uv);
    let eqUv  = equirect_uv(dir);
    let color = textureSampleLevel(equirectMap, equirectSampler, eqUv, 0.0);

    textureStore(cubemapOut, vec2i(gid.xy), i32(face), color);
}
