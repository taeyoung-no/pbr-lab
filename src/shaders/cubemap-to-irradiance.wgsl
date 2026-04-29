@group(0) @binding(0) var environmentMap : texture_cube<f32>;
@group(0) @binding(1) var envSampler     : sampler;
@group(0) @binding(2) var irradianceOut  : texture_storage_2d_array<rgba16float, write>;

const PI = 3.14159265359;

// Same face-direction convention as equirect-to-cubemap.wgsl
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

// Riemann-sum integration of L_i(ω) cos(θ) dω over the hemisphere above normal.
// Dispatch: (ceil(faceSize/8), ceil(faceSize/8), 6)
@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
    let face     = gid.z;
    let faceSize = textureDimensions(irradianceOut);
    if gid.x >= faceSize.x || gid.y >= faceSize.y { return; }

    let uv     = (vec2f(gid.xy) + 0.5) / vec2f(faceSize);
    let normal = face_direction(face, uv);

    let envSize  = textureDimensions(environmentMap, 0);
    let mipLevel = log2(f32(envSize.x) / f32(faceSize.x));

    var up    = vec3f(0.0, 1.0, 0.0);
    let right = normalize(cross(up, normal));
    up        = normalize(cross(normal, right));

    var irradiance = vec3f(0.0);
    var nrSamples  = 0.0;

    let sampleDelta = 0.025;

    for (var phi = 0.0; phi < 2.0 * PI; phi += sampleDelta) {
        for (var theta = 0.0; theta < 0.5 * PI; theta += sampleDelta) {
            let tangentSample = vec3f(sin(theta) * cos(phi),
                                      sin(theta) * sin(phi),
                                      cos(theta));
            let sampleVec = tangentSample.x * right
                          + tangentSample.y * up
                          + tangentSample.z * normal;

            irradiance += textureSampleLevel(environmentMap, envSampler, sampleVec, mipLevel).rgb
                          * cos(theta) * sin(theta);
            nrSamples += 1.0;
        }
    }

    irradiance = PI * irradiance / nrSamples;
    textureStore(irradianceOut, vec2i(gid.xy), i32(face), vec4f(irradiance, 1.0));
}
