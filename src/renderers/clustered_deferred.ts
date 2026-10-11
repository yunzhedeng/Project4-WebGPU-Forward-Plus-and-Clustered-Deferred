import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    // TODO-3: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    albedoTexture: GPUTexture;
    albedoTextureView: GPUTextureView;
    normalTexture: GPUTexture;
    normalTextureView: GPUTextureView;
    positionTexture: GPUTexture;
    positionTextureView: GPUTextureView;
    
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;
    
    gBufferSceneBindGroupLayout: GPUBindGroupLayout;
    gBufferSceneBindGroup: GPUBindGroup;
    gBufferPipeline: GPURenderPipeline;
    gBufferBundle: GPURenderBundle;

    fullscreenBindGroupLayout: GPUBindGroupLayout;
    fullscreenBindGroup: GPUBindGroup;
    fullscreenPipeline: GPURenderPipeline;

    compactGBufferTexture: GPUTexture;
    compactGBufferTextureView: GPUTextureView;
    compactGBufferPipeline: GPURenderPipeline;
    compactGBufferBundle: GPURenderBundle;
    compactFullscreenBindGroupLayout: GPUBindGroupLayout;
    compactFullscreenBindGroup: GPUBindGroup;
    compactFullscreenPipeline: GPURenderPipeline;
    
    constructor(stage: Stage) {
        super(stage);

        const size = [renderer.canvas.width, renderer.canvas.height];

        // TODO-3: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        // you'll need two pipelines: one for the G-buffer pass and one for the fullscreen pass
        this.albedoTexture = renderer.device.createTexture({
            label: "gbuffer albedo",
            size: size,
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.albedoTextureView = this.albedoTexture.createView();

        this.normalTexture = renderer.device.createTexture({
            label: "gbuffer normal",
            size: size,
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.normalTextureView = this.normalTexture.createView();

        this.positionTexture = renderer.device.createTexture({
            label: "gbuffer position",
            size: size,
            format: "rgba32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.positionTextureView = this.positionTexture.createView();

        this.depthTexture = renderer.device.createTexture({
            label: "gbuffer depth",
            size: size,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING   
        });
        this.depthTextureView = this.depthTexture.createView();

        //G-buffer pipeline 
        this.gBufferSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "g-buffer scene bind group layout",
            entries: [
                { // camera
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.gBufferSceneBindGroup = renderer.device.createBindGroup({
            label: "g-buffer scene bind group",
            layout: this.gBufferSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } }
            ]
        });

        this.gBufferPipeline = renderer.device.createRenderPipeline({
            label: "g-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "g-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gBufferSceneBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "g-buffer vert shader",
                    code: shaders.naiveVertSrc 
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "g-buffer frag shader",
                    code: shaders.clusteredDeferredFragSrc
                }),
                targets: [
                    { format: "rgba8unorm" },  
                    { format: "rgba16float" },  
                    { format: "rgba32float" }   
                ]
            }
        });

        //fullscreen lighting pipeline
        this.fullscreenBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "clustered deferred fullscreen bind group layout",
            entries: [
                { // camera
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterSet
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // albedo
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // normal
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // position
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                }
            ]
        });

        this.fullscreenBindGroup = renderer.device.createBindGroup({
            label: "clustered deferred fullscreen bind group",
            layout: this.fullscreenBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } },
                { binding: 3, resource: this.albedoTextureView },
                { binding: 4, resource: this.normalTextureView },
                { binding: 5, resource: this.positionTextureView }
            ]
        });

        this.fullscreenPipeline = renderer.device.createRenderPipeline({
            label: "clustered deferred fullscreen pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "clustered deferred fullscreen pipeline layout",
                bindGroupLayouts: [ this.fullscreenBindGroupLayout ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred fullscreen vert shader",
                    code: shaders.clusteredDeferredFullscreenVertSrc
                })
               
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "clustered deferred fullscreen frag shader",
                    code: shaders.clusteredDeferredFullscreenFragSrc
                }),
                targets: [
                    { format: renderer.canvasFormat }
                ]
            }
        });

        this.compactGBufferTexture = renderer.device.createTexture({
            label: "compact gbuffer (albedo + normal)",
            size: size,
            format: "rg32uint",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.compactGBufferTextureView = this.compactGBufferTexture.createView();

        this.compactGBufferPipeline = renderer.device.createRenderPipeline({
            label: "compact g-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "compact g-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gBufferSceneBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "compact g-buffer vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "compact g-buffer frag shader",
                    code: shaders.clusteredDeferredCompactFragSrc
                }),
                targets: [ { format: "rg32uint" } ]
            }
        });

        this.compactFullscreenBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "compact fullscreen bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },           // camera
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },  // lightSet
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },  // clusterSet
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "uint" } },        // compact g-buffer
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }        // depth
            ]
        });

        this.compactFullscreenBindGroup = renderer.device.createBindGroup({
            label: "compact fullscreen bind group",
            layout: this.compactFullscreenBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } },
                { binding: 3, resource: this.compactGBufferTextureView },
                { binding: 4, resource: this.depthTextureView }
            ]
        });
        this.compactFullscreenPipeline = renderer.device.createRenderPipeline({
            label: "compact fullscreen pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "compact fullscreen pipeline layout",
                bindGroupLayouts: [ this.compactFullscreenBindGroupLayout ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "compact fullscreen vert shader",
                    code: shaders.clusteredDeferredFullscreenVertSrc
                })
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "compact fullscreen frag shader",
                    code: shaders.clusteredDeferredCompactFullscreenFragSrc
                }),
                targets: [ { format: renderer.canvasFormat } ]
            }
        });

        // C4. render bundle for the compact G-buffer pass
        const compactBundleEncoder = renderer.device.createRenderBundleEncoder({
            label: "compact G-buffer render bundle",
            colorFormats: ["rg32uint"],
            depthStencilFormat: "depth24plus"
        });
        compactBundleEncoder.setPipeline(this.compactGBufferPipeline);
        compactBundleEncoder.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferSceneBindGroup);
        this.recordSceneDraws(compactBundleEncoder);
        this.compactGBufferBundle = compactBundleEncoder.finish();

        // Pre-record the G-buffer pass draw calls
        const gBufferBundleEncoder = renderer.device.createRenderBundleEncoder({
            label: "G-buffer render bundle",
            colorFormats: ["rgba8unorm", "rgba16float", "rgba32float"],
            depthStencilFormat: "depth24plus"
        });
        gBufferBundleEncoder.setPipeline(this.gBufferPipeline);
        gBufferBundleEncoder.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferSceneBindGroup);
        this.recordSceneDraws(gBufferBundleEncoder);
        this.gBufferBundle = gBufferBundleEncoder.finish();
    
    }

    override draw() {
        // TODO-3: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the G-buffer pass, outputting position, albedo, and normals
        // - run the fullscreen pass, which reads from the G-buffer and performs lighting calculations
        const encoder = renderer.device.createCommandEncoder();

        //compute pass
        this.lights.doLightClustering(encoder);

        const useCompact = renderer.settings.useCompactGBuffer;
        const useBundles = renderer.settings.useRenderBundles;
        const depthAttachment: GPURenderPassDepthStencilAttachment = {
            view: this.depthTextureView,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store"
        };
        
        //G-buffer pass
        const gBufferPass = encoder.beginRenderPass({
            label: "g-buffer pass",
            colorAttachments: [
                {
                    view: this.albedoTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.normalTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.positionTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });

        //Code without render bundle
        // gBufferPass.setPipeline(this.gBufferPipeline);
        // gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferSceneBindGroup);

        // this.scene.iterate(node => {
        //     gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        // }, material => {
        //     gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        // }, primitive => {
        //     gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
        //     gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
        //     gBufferPass.drawIndexed(primitive.numIndices);
        // });

        if (renderer.settings.useRenderBundles) {
            gBufferPass.executeBundles([this.gBufferBundle]);
        } else {
            gBufferPass.setPipeline(this.gBufferPipeline);
            gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferSceneBindGroup);
            this.recordSceneDraws(gBufferPass);
        }

        gBufferPass.end();

        //fullscreen pass
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        const fullscreenPass = encoder.beginRenderPass({
            label: "clustered deferred fullscreen pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });
        fullscreenPass.setPipeline(this.fullscreenPipeline);
        fullscreenPass.setBindGroup(shaders.constants.bindGroup_scene, this.fullscreenBindGroup);
        fullscreenPass.draw(3);
        fullscreenPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
