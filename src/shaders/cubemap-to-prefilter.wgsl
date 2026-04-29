@group(0) @binding(0) var environmentMap : texture_cube<f32>;
@group(0) @binding(1) var envSampler     : sampler;
@group(0) @binding(2) var prefilterOut   : texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform>        roughness : f32;

const PI           = 3.14159265359;
const SAMPLE_COUNT = 1024u;

// Same face-direction convention as the other cubemap shaders.
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

fn radical_inverse_vdc(bits_in: u32) -> f32 {
    var bits = bits_in;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, N: u32) -> vec2f {
    return vec2f(f32(i) / f32(N), radical_inverse_vdc(i));
}

// GGX importance sampling in tangent space, returned in world space.
fn importance_sample_ggx(xi: vec2f, N: vec3f, a: f32) -> vec3f {
    let phi      = 2.0 * PI * xi.x;
    let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

    let H = vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

    // Build TBN; avoid near-parallel degenerate cross product.
    let up        = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(N.z) < 0.999);
    let tangent   = normalize(cross(up, N));
    let bitangent = cross(N, tangent);

    return normalize(tangent * H.x + bitangent * H.y + N * H.z);
}

// Dispatch: one call per mip level — (ceil(mipSize/8), ceil(mipSize/8), 6)
@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
    let face     = gid.z;
    let faceSize = textureDimensions(prefilterOut);
    if gid.x >= faceSize.x || gid.y >= faceSize.y { return; }

    let uv = (vec2f(gid.xy) + 0.5) / vec2f(faceSize);
    let N  = face_direction(face, uv);
    let V  = N; // V = R = N (isotropic approximation)

    let a       = roughness * roughness;
    let envSize = textureDimensions(environmentMap, 0);
    // Solid angle of one env texel at the base mip level.
    let saTexel = 4.0 * PI / (6.0 * f32(envSize.x) * f32(envSize.x));

    var color       = vec3f(0.0);
    var totalWeight = 0.0;

    for (var i = 0u; i < SAMPLE_COUNT; i++) {
        let xi    = hammersley(i, SAMPLE_COUNT);
        let H     = importance_sample_ggx(xi, N, a);
        let L     = normalize(2.0 * dot(V, H) * H - V);
        let NdotL = max(dot(N, L), 0.0);

        if NdotL > 0.0 {
            // Choose mip level from the PDF so that the sampled solid angle
            // matches one texel, reducing bright-dot aliasing.
            let NdotH = max(dot(N, H), 0.0);
            let HdotV = max(dot(H, V), 0.0);
            let a2    = a * a;
            let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
            let D     = a2 / (PI * denom * denom);
            let pdf   = D * NdotH / (4.0 * HdotV) + 0.0001;

            let saSample = 1.0 / (f32(SAMPLE_COUNT) * pdf + 0.0001);
            // roughness == 0 → mirror reflection, always sample mip 0.
            let mipLevel = select(0.5 * log2(saSample / saTexel) + 1.0, 0.0, roughness == 0.0);

            color       += textureSampleLevel(environmentMap, envSampler, L, mipLevel).rgb * NdotL;
            totalWeight += NdotL;
        }
    }

    let result = color / max(totalWeight, 0.0001);
    textureStore(prefilterOut, vec2i(gid.xy), i32(face), vec4f(result, 1.0));
}
