@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var depthTex: texture_depth_2d;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> activeClusters: array<u32>;

const clusterCount = vec3u(${clusterCountX}, ${clusterCountY}, ${clusterCountZ});

fn markCluster(cx: u32, cy: u32, cz: u32) {
    activeClusters[cx + cy * clusterCount.x + cz * clusterCount.x * clusterCount.y] = 1u;
}

@fragment
fn main(@builtin(position) fragPos: vec4f)
{
    let depth = textureLoad(depthTex, vec2i(fragPos.xy), 0);
    if (depth >= 1.0) {
        return; // background: no geometry at this pixel
    }

    let ndc = vec3f(
        fragPos.x / cameraUniforms.screenWidth * 2.0 - 1.0,
        1.0 - fragPos.y / cameraUniforms.screenHeight * 2.0,
        depth
    );
    let viewPos = cameraUniforms.invProjMat * vec4f(ndc, 1.0);
    let viewDepth = -viewPos.z / viewPos.w;

    let nearZ = cameraUniforms.nearPlane;
    let farZ = cameraUniforms.farPlane;
    let sliceF = log(viewDepth / nearZ) / log(farZ / nearZ) * f32(clusterCount.z);
    let cz = u32(clamp(floor(sliceF), 0.0, f32(clusterCount.z - 1u)));

    let cx = min(u32(fragPos.x / cameraUniforms.screenWidth * f32(clusterCount.x)), clusterCount.x - 1u);
    let yUp = max(1.0 - fragPos.y / cameraUniforms.screenHeight, 0.0);
    let cy = min(u32(yUp * f32(clusterCount.y)), clusterCount.y - 1u);

    markCluster(cx, cy, cz);

    // mark the neighboring slice so the shading pass never looks up an unmarked cluster
    let frac = sliceF - floor(sliceF);
    if (frac < 0.05 && cz > 0u) {
        markCluster(cx, cy, cz - 1u);
    }
    if (frac > 0.95 && cz + 1u < clusterCount.z) {
        markCluster(cx, cy, cz + 1u);
    }
}