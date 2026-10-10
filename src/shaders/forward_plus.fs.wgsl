// TODO-2: implement the Forward+ fragment shader

// See naive.fs.wgsl for basic fragment shader setup; this shader should use light clusters instead of looping over all lights

// ------------------------------------
// Shading process:
// ------------------------------------
// Determine which cluster contains the current fragment.
// Retrieve the number of lights that affect the current fragment from the cluster’s data.
// Initialize a variable to accumulate the total light contribution for the fragment.
// For each light in the cluster:
//     Access the light's properties using its index.
//     Calculate the contribution of the light based on its position, the fragment’s position, and the surface normal.
//     Add the calculated contribution to the total light accumulation.
// Multiply the fragment’s diffuse color by the accumulated light contribution.
// Return the final color, ensuring that the alpha component is set appropriately (typically to 1).
@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

const clusterCount = vec3u(${clusterCountX}, ${clusterCountY}, ${clusterCountZ});

struct FragmentInput
{
    @builtin(position) fragPos: vec4f, // x, y are in pixels; (0, 0) is the TOP-left corner
    @location(0) pos: vec3f,           // world position
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

fn getClusterIndex(fragCoord: vec2f, worldPos: vec3f) -> u32 {
    //depth slice
    let depth = -(cameraUniforms.viewMat * vec4f(worldPos, 1.0)).z;
    let nearZ = cameraUniforms.nearPlane;
    let farZ = cameraUniforms.farPlane;

    let sliceF = log(depth / nearZ) / log(farZ / nearZ) * f32(clusterCount.z);
    let cz = u32(clamp(floor(sliceF), 0.0, f32(clusterCount.z - 1u)));

    //screen title
    let cx = min(u32(fragCoord.x / cameraUniforms.screenWidth * f32(clusterCount.x)), clusterCount.x - 1u);
    // pixel y grows downward, but cluster y was defined in NDC (grows upward), so flip it
    let yUp = max(1.0 - fragCoord.y / cameraUniforms.screenHeight, 0.0);
    let cy = min(u32(yUp * f32(clusterCount.y)), clusterCount.y - 1u);

    //x fastest, then y, then z
    return cx + cy * clusterCount.x + cz * clusterCount.x * clusterCount.y;
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    let clusterIdx = getClusterIndex(in.fragPos.xy, in.pos);
    let numLightsInCluster = clusterSet.clusters[clusterIdx].numLights;

    let nor = normalize(in.nor);

    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterSet.clusters[clusterIdx].lightIndices[i];
        totalLightContrib += calculateLightContrib(lightSet.lights[lightIdx], in.pos, nor);
    }

    let finalColor = diffuseColor.rgb * totalLightContrib;
    return vec4(finalColor, 1);
}