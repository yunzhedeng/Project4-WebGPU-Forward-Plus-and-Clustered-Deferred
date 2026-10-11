@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

fn octEncode(n: vec3f) -> vec2f {
    let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    if (n.z >= 0.0) {
        return p;
    }
    return (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0));
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec2u
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    let packedAlbedo = pack4x8unorm(vec4f(diffuseColor.rgb, 1.0));
    let packedNormal = pack2x16snorm(octEncode(normalize(in.nor)));
    return vec2u(packedAlbedo, packedNormal);
}