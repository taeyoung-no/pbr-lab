// Output: R = scale (A), G = bias (B) of the split-sum BRDF integral.
// X axis = NdotV, Y axis = roughness (both 0 → 1).
@group(0) @binding(0) var brdfLut : texture_storage_2d<rgba16float, write>;

const PI           = 3.14159265359;
const SAMPLE_COUNT = 1024u;

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

// GGX importance sampling in tangent space (N = (0,0,1)), result in world space.
fn importance_sample_ggx(xi: vec2f, a: f32) -> vec3f {
    let phi      = 2.0 * PI * xi.x;
    let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    // N is always (0,0,1) here, so tangent space = world space.
    return vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

fn geometry_schlick_ggx_ibl(NdotX: f32, roughness: f32) -> f32 {
    // IBL remapping: k = a^2 / 2
    let k = (roughness * roughness) / 2.0;
    return NdotX / (NdotX * (1.0 - k) + k);
}

fn geometry_smith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    return geometry_schlick_ggx_ibl(NdotV, roughness)
         * geometry_schlick_ggx_ibl(NdotL, roughness);
}

fn integrate_brdf(NdotV: f32, roughness: f32) -> vec2f {
    // Reconstruct V in tangent space where N = (0,0,1).
    let V = vec3f(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
    let a = roughness * roughness;

    var A = 0.0;
    var B = 0.0;

    for (var i = 0u; i < SAMPLE_COUNT; i++) {
        let xi    = hammersley(i, SAMPLE_COUNT);
        let H     = importance_sample_ggx(xi, a);
        let L     = normalize(2.0 * dot(V, H) * H - V);
        let NdotL = max(L.z, 0.0);

        if NdotL > 0.0 {
            let NdotH = max(H.z, 0.0);
            let VdotH = max(dot(V, H), 0.0);

            let G     = geometry_smith(NdotV, NdotL, roughness);
            let G_Vis = (G * VdotH) / (NdotH * NdotV);
            let Fc    = pow(1.0 - VdotH, 5.0);

            A += (1.0 - Fc) * G_Vis;
            B += Fc          * G_Vis;
        }
    }

    return vec2f(A, B) / f32(SAMPLE_COUNT);
}

// Dispatch: (ceil(LUT_SIZE/8), ceil(LUT_SIZE/8), 1)
@compute @workgroup_size(8, 8, 1)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
    let size = textureDimensions(brdfLut);
    if gid.x >= size.x || gid.y >= size.y { return; }

    let NdotV     = (f32(gid.x) + 0.5) / f32(size.x);
    let roughness = (f32(gid.y) + 0.5) / f32(size.y);

    let result = integrate_brdf(NdotV, roughness);
    textureStore(brdfLut, vec2i(gid.xy), vec4f(result, 0.0, 1.0));
}
