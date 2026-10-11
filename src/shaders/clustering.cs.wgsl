// TODO-2: implement the light clustering compute shader
// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.
@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterSet: ClusterSet;
@group(${bindGroup_scene}) @binding(3) var<storage, read> activeClusters: array<u32>;

const clusterCount = vec3u(${clusterCountX}, ${clusterCountY}, ${clusterCountZ});

fn ndcToView(ndc: vec2f, zView: f32) -> vec3f {
    let h = cameraUniforms.invProjMat * vec4f(ndc, 1.0, 1.0);
    let p = h.xyz / h.w;
    return p * (zView / p.z);
}

@compute
@workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let clusterIdx = globalIdx.x;
    let numClusters = clusterCount.x * clusterCount.y * clusterCount.z;
    if (clusterIdx >= numClusters) {
        return;
    }

    if (activeClusters[clusterIdx] == 0u) {
        clusterSet.clusters[clusterIdx].numLights = 0u;
        return;
    }

    // 1D index to 3D cluster
    let cx = clusterIdx % clusterCount.x;
    let cy = (clusterIdx / clusterCount.x) % clusterCount.y;
    let cz = clusterIdx / (clusterCount.x * clusterCount.y);

    //screen space of the cluster
    let tileCount = vec2f(clusterCount.xy);
    let ndcMin = vec2f(f32(cx), f32(cy)) / tileCount * 2.0 - 1.0;
    let ndcMax = vec2f(f32(cx + 1u), f32(cy + 1u)) / tileCount * 2.0 - 1.0;

    // ---------- depth extent: exponential slicing, then negate (view space looks down -z) ----------
    let nearZ = cameraUniforms.nearPlane;
    let farZ = cameraUniforms.farPlane;
    let ratio = farZ / nearZ;
    let zNearView = -nearZ * pow(ratio, f32(cz) / f32(clusterCount.z));
    let zFarView = -nearZ * pow(ratio, f32(cz + 1u) / f32(clusterCount.z));

    // view-space AABB from the 8 corners of the cluster frustum 
    var minPos = vec3f(1e30);
    var maxPos = vec3f(-1e30);
    for (var i = 0u; i < 8u; i++) {
        let ndc = vec2f(
            select(ndcMin.x, ndcMax.x, (i & 1u) != 0u),
            select(ndcMin.y, ndcMax.y, (i & 2u) != 0u)
        );
        let zView = select(zNearView, zFarView, (i & 4u) != 0u);
        let corner = ndcToView(ndc, zView);
        minPos = min(minPos, corner);
        maxPos = max(maxPos, corner);
    }

    //assign lights
    let radius = f32(${lightRadius});
    let radiusSq = radius * radius;

    var count = 0u;
    for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
        let lightViewPos = (cameraUniforms.viewMat * vec4f(lightSet.lights[lightIdx].pos, 1.0)).xyz;

        // sphere vs AABB: distance from the sphere center to the closest point on the box
        let closest = clamp(lightViewPos, minPos, maxPos);
        let diff = lightViewPos - closest;

        if (dot(diff, diff) <= radiusSq) {
            clusterSet.clusters[clusterIdx].lightIndices[count] = lightIdx;
            count++;
            if (count >= ${maxLightsPerCluster}u) {
                break;
            }
        }
    }

    clusterSet.clusters[clusterIdx].numLights = count;
}