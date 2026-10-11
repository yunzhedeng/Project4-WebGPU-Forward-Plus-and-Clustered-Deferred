@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;
@group(${bindGroup_scene}) @binding(3) var gBuffer: texture_2d<u32>;
@group(${bindGroup_scene}) @binding(4) var depthTex: texture_depth_2d;

const clusterCount = vec3u(${clusterCountX}, ${clusterCountY}, ${clusterCountZ});

fn octDecode(e: vec2f) -> vec3f {
    var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) {
        let xy = (1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
        n = vec3f(xy, n.z);
    }
    return normalize(n);
}

@fragment
fn main(@builtin(position) fragPos: vec4f) -> @location(0) vec4f
{
    let pixel = vec2i(fragPos.xy);

    let depth = textureLoad(depthTex, pixel, 0);
    if (depth >= 1.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0); // background
    }

    // Unpack albedo and normal.
    let g = textureLoad(gBuffer, pixel, 0).xy;
    let albedo = unpack4x8unorm(g.x).rgb;
    let nor = octDecode(unpack2x16snorm(g.y));

    // Reconstruct 
    let ndc = vec3f(
        fragPos.x / cameraUniforms.screenWidth * 2.0 - 1.0,
        1.0 - fragPos.y / cameraUniforms.screenHeight * 2.0,
        depth
    );
    let viewH = cameraUniforms.invProjMat * vec4f(ndc, 1.0);
    let viewPos = viewH.xyz / viewH.w;

    // View space -> world space
    let R = mat3x3f(cameraUniforms.viewMat[0].xyz, cameraUniforms.viewMat[1].xyz, cameraUniforms.viewMat[2].xyz);
    let worldPos = transpose(R) * (viewPos - cameraUniforms.viewMat[3].xyz);

    // Cluster lookup 
    let viewDepth = -viewPos.z;
    let sliceF = log(viewDepth / cameraUniforms.nearPlane) / log(cameraUniforms.farPlane / cameraUniforms.nearPlane) * f32(clusterCount.z);
    let cz = u32(clamp(floor(sliceF), 0.0, f32(clusterCount.z - 1u)));
    let cx = min(u32(fragPos.x / cameraUniforms.screenWidth * f32(clusterCount.x)), clusterCount.x - 1u);
    let yUp = max(1.0 - fragPos.y / cameraUniforms.screenHeight, 0.0);
    let cy = min(u32(yUp * f32(clusterCount.y)), clusterCount.y - 1u);
    let clusterIdx = cx + cy * clusterCount.x + cz * clusterCount.x * clusterCount.y;

    let numLightsInCluster = clusterSet.clusters[clusterIdx].numLights;
    var totalLightContrib = vec3f(0.0);
    for (var i = 0u; i < numLightsInCluster; i++) {
        let lightIdx = clusterSet.clusters[clusterIdx].lightIndices[i];
        totalLightContrib += calculateLightContrib(lightSet.lights[lightIdx], worldPos, nor);
    }

    return vec4f(albedo * totalLightContrib, 1.0);
}