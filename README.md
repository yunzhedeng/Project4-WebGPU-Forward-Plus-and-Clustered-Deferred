WebGL Forward+ and Clustered Deferred Shading
=============================================

**University of Pennsylvania, CIS 565: GPU Programming and Architecture, Project 4**

* Yunzhe Deng
  * [LinkedIn](https://www.linkedin.com/in/yunzhedeng), [personal website](https://yunzhedeng.com)
* Tested on: Windows 11, Intel Core i7-10750H @ 2.60GHz, 16 GB RAM, NVIDIA GeForce RTX 2060 (Personal Computer)

### Live Demo

[![](img/thumb.png)](http://TODO.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred)

### Demo Video/GIF

[![](img/video.mp4)](TODO)

## Overview

This project is a real-time WebGPU renderer that draws the Sponza scene lit by hundreds to thousands of dynamic point lights. The core question it explores is how to shade a scene with many lights efficiently, so it implements three rendering pipelines that can be switched at runtime from the GUI, then adds a set of optimizations and effects on top of them and measures each one.

### Features

- Naive renderer
- Forward+ renderer
- Clustered Deferred renderer
- Post-processing (bloom or toon shading)
- G-buffer optimization
- Visibility buffer
- Render bundles
- Depth prepass for Forward+
- In-app benchmark tool

### Benchmarking

The built-in FPS counter is driven by `requestAnimationFrame`, which is locked to the display's refresh rate (100 Hz on the test machine), so every renderer faster than 10 ms per frame reads exactly 100 FPS and cannot be compared. To get real
frame times, I added a `benchmark` button to the GUI: it pauses the normal render loop, renders 20 warm-up frames and then 200 frames back-to-back, waits for the GPU to finish, and prints the average **milliseconds per frame** to the browser console. To use it, pick a `mode` and `numLights` in the GUI, click `benchmark`, and read the result in the console. All timings in this README were measured this way.

## Naive Renderer

The baseline renderer. The scene is rasterized once, and the fragment shader loops over every light in the scene, summing each light's contribution. There is no culling of any kind, so every fragment pays for every light, whether or not the light can reach it. Its cost is O(fragments × lights).

The only host-side work this feature needed was a camera uniform buffer holding the view-projection matrix, uploaded every frame and bound to the vertex shader.

### Performance

| numLights | Frame time (ms) | ms per light |
| --------: | --------------: | -----------: |
|       100 |           13.04 |        0.130 |
|       500 |           64.83 |        0.130 |
|      1000 |          154.31 |        0.154 |
|      2000 |          304.90 |        0.152 |
|      5000 |          780.31 |        0.156 |

![Naive frame time](img/graph_naive.png)

### Analysis

#### How parameters affect performance

- **Number of lights**: frame time is almost perfectly linear in the number of lights. Going from 100 to 5000 lights (50×) increases frame time 60× (13.0 → 780.3 ms), at a near-constant cost of about 0.13–0.16 ms per light per frame. This is the expected O(lights) behavior: every added light adds one more iteration to every fragment's loop.
- **Light radius**: does not change the cost. Naive evaluates every light at every fragment regardless of distance, so a smaller radius saves nothing.
- **Resolution / overdraw**: The cost is proportional to the number of shaded fragments. Fragments which are hidden by nearby geometry are lit completely, thus increasing the penalty for scenes which are complex in terms of depth (as seen in Sponza).

#### Acceleration

None. This renderer is intentionally the unoptimized reference.

#### How it could be optimized

- **Light culling**: as each light has an effective radius of 2, almost all of the per-fragment processing done is waste. Spatial organization of lights such that a fragment only processes nearby lights is precisely what Forward+ achieves (refer to next section), resulting in a 6-17x speed up.
- **Avoid shading hidden fragments**: a depth prepass or deferred shading would light each visible pixel only once instead of once per overlapping fragment.

---

## 2. Forward+ Renderer(with light clustering)

### Overview

Forward+ eliminates much of the wasted effort on lighting calculation that occurred due to Naive by doing a pre-calculation step where they determine what lights can possibly have an effect on which portion of the screen. They subdivide the view frustum into 3456 clusters of size 16 x 9 x 24, using exponential depth slices (`z_k = near · (far/near)^(k/24)`), so that the clusters will remain cubical under perspective projection. Each frame, a compute shader is executed, one thread per cluster, which constructs the axis-aligned bounding box for the cluster from its 8 corners in view space, performs a collision test between the light sphere (radius 2) and the bounding box, and stores up to 256 overlapping light indices in a storage buffer. During rendering, each fragment determines the cluster it belongs to using its screen coordinates and view space depth, and iterates over that cluster's lights only.

### Performance

| numLights | Forward+ frame time (ms) |
| --------: | -----------------------: |
|       100 |                     2.08 |
|       500 |                     6.21 |
|      1000 |                    12.82 |
|      2000 |                    25.27 |
|      5000 |                    46.86 |

![Naive vs Forward+](img/graph_naive_vs_forward_plus.png)

### Analysis

#### Performance improvement

Forward+ performs 6.3× faster than Naive at 100 lights (13.0 → 2.1 ms), 10.4× faster at 500 lights (64.8 → 6.2 ms), and 16.7× faster at 5000 lights (780.3 → 46.9 ms). The increase in performance scales up with the number of lights, because in Naive we pay for all lights per each fragment, whereas in Forward+ we pay for lights that are close to each fragment. However, Forward+ still increases linearly (2.1 → 46.9 ms), since there is a constant scene volume, so more lights mean more lights in one cluster, which makes the loop of each fragment longer.

#### Best and worst case

- **Best case**: many small, evenly spread lights, so each cluster overlaps only a few of them. Each fragment then loops over a handful of lights instead of thousands, and the speedup over Naive is largest.
- **Worst case**: lights that are large or bunched together, so that many clusters overlap a large fraction of all lights. The per-fragment loop then approaches Naive's, while still paying the extra clustering pass. Once a cluster reaches the 256-light cap, extra lights are dropped from that cluster, which keeps the cost bounded but makes lighting there incorrect.

#### Tradeoffs

Forward+ adds a light-clustering compute pass every frame that tests every light against every cluster (3456 × N sphere–box tests), so its cost grows linearly with the number of lights, and it needs about 3.5 MB of extra GPU memory for the cluster light lists (3456 × (1 + 256) × 4 bytes). The 256-light-per-cluster cap keeps that memory fixed but drops any extra lights in very crowded clusters. Finally, lighting is still evaluated per fragment, so hidden fragments that are later overwritten by closer geometry (overdraw) are still fully lit, a cost that Clustered Deferred removes (see the next section).

#### How parameters affect performance

- **Number of lights**: increases both the clustering pass (linearly) and the per-fragment loop (more lights per cluster).
- **Light radius**: If there is a bigger radius for each light, there will be an increase in the number of clusters that each light overlaps.
- **Cluster grid size**: More clusters lead to denser cluster lists but require more expense for the clustering step and memory use. Fewer clusters do the reverse.

#### Debug view: lights per cluster

![Lights per cluster](img/debug_cluster_lights.png)

Brightness shows the number of lights in each pixel's cluster. Brighter regions
mean longer per-fragment light loops, so the debug view maps directly to where
the fragment shader spends its time: frames where much of the screen is bright
are the slow ones.

---

## 3. Clustered Deferred

### Overview

Pass 1 rasterizes the scene into a G-buffer (albedo, normal, world position) and
a depth buffer without doing any lighting. Pass 2 draws one fullscreen triangle;
for each pixel it reads the G-buffer, finds the cluster (reusing the Forward+
clustering), and loops over that cluster's lights **once**. The clustering
compute pass runs first, before the G-buffer pass.

### Screenshot and G-buffer debug views

| Albedo                 | Normal                 | Position                 | Final                         |
| ---------------------- | ---------------------- | ------------------------ | ----------------------------- |
| ![](img/gbuf_albedo.png) | ![](img/gbuf_normal.png) | ![](img/gbuf_position.png) | ![](img/clustered_deferred.png) |

__These debug views are optional: output a G-buffer texture as the final color
temporarily to capture them.__

### Performance

- At 500 lights: Forward+ __ ms vs. Clustered Deferred __ ms.
- At 5000 lights: Forward+ __ ms vs. Clustered Deferred __ ms.
- Breakdown (if timestamp queries are used): clustering __ ms, G-buffer __ ms,
  fullscreen lighting __ ms.

![Forward+ vs Clustered Deferred](img/graph_deferred.png)

### Analysis

- **Is one faster?** 【根据上表填写】
- **Better at which workloads?** 【Clustered Deferred is better with many lights
  and high overdraw, because lighting is evaluated once per visible pixel.
  Forward+ is better with few lights or low overdraw, because it avoids the
  G-buffer bandwidth.】
- **Benefits of Deferred**: lighting cost is independent of scene geometry
  complexity; no wasted lighting on hidden fragments.
- **Tradeoffs of Deferred**: G-buffer traffic of 8 + 8 + 16 = 32 bytes per pixel
  written and read back each frame; transparency and MSAA are hard to support.
- **Why the difference**: 【explain what your data shows: Forward+ pays the
  lighting cost per rasterized fragment (including hidden ones); Deferred pays
  bandwidth for the G-buffer instead.】
- **Effect of parameters**: G-buffer cost depends only on resolution; lighting
  cost grows with numLights and light radius.
- **Further optimization**: compress the G-buffer (see G-buffer optimization),
  or reconstruct position from depth.

### Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)
