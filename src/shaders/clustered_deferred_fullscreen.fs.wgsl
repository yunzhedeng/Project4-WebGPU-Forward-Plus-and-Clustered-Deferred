// TODO-3: implement the Clustered Deferred fullscreen fragment shader

// Similar to the Forward+ fragment shader, but with vertex information coming from the G-buffer instead.
// Clustered Deferred: fullscreen fragment shader.
// Like the Forward+ fragment shader, but surface data comes from the G-buffer instead of from the vertex shader.

@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;
@group(${bindGroup_scene}) @binding(3) var gAlbedo: texture_2d<f32>;
@group(${bindGroup_scene}) @binding(4) var gNormal: texture_2d<f32>;
@group(${bindGroup_scene}) @binding(5) var gPosition: texture_2d<f32>;

const clusterCount = vec3u(${clusterCountX}, ${clusterCountY}, ${clusterCountZ});

fn getClusterIndex(fragCoord: vec2f, worldPos: vec3f) -> u32 {
    let depth = -(cameraUniforms.viewMat * vec4f(worldPos, 1.0)).z;
    let nearZ = cameraUniforms.nearPlane;
    let farZ = cameraUniforms.farPlane;
    let sliceF = log(depth / nearZ) / log(farZ / nearZ) * f32(clusterCount.z);
    let cz = u32(clamp(floor(sliceF), 0.0, f32(clusterCount.z - 1u)));

    let cx = min(u32(fragCoord.x / cameraUniforms.screenWidth * f32(clusterCount.x)), clusterCount.x - 1u);
    let yUp = max(1.0 - fragCoord.y / cameraUniforms.screenHeight, 0.0);
    let cy = min(u32(yUp * f32(clusterCount.y)), clusterCount.y - 1u);

    return cx + cy * clusterCount.x + cz * clusterCount.x * clusterCount.y;
}

@fragment
fn main(@builtin(position) fragPos: vec4f) -> @location(0) vec4f
{

    let pixel = vec2i(fragPos.xy);
    let albedo = textureLoad(gAlbedo, pixel, 0);

    
    if (albedo.a == 0.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let nor = normalize(textureLoad(gNormal, pixel, 0).xyz);
    let worldPos = textureLoad(gPosition, pixel, 0).xyz;

    let clusterIdx = getClusterIndex(fragPos.xy, worldPos);
    let numLightsInCluster = clusterSet.clusters[clusterIdx].numLights;

    var totalLightContrib = vec3f(0, 0, 0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterSet.clusters[clusterIdx].lightIndices[i];
        totalLightContrib += calculateLightContrib(lightSet.lights[lightIdx], worldPos, nor);
    }

    let finalColor = albedo.rgb * totalLightContrib;
    return vec4f(finalColor, 1.0);
}