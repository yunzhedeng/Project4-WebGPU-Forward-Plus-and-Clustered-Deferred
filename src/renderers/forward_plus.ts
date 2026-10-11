import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    pipeline: GPURenderPipeline;

    depthPrepassPipeline: GPURenderPipeline;
    shadingAfterPrepassPipeline: GPURenderPipeline;

    sceneBundle: GPURenderBundle; 
    depthPrepassBundle: GPURenderBundle;
    shadingAfterPrepassBundle: GPURenderBundle;

    overdrawPipeline: GPURenderPipeline;             
    overdrawAfterPrepassPipeline: GPURenderPipeline;  

    clusterMarkBindGroupLayout: GPUBindGroupLayout;
    clusterMarkBindGroup: GPUBindGroup;
    clusterMarkPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "forward+ scene uniforms bind group layout",
            entries: [
                {binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" }},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" }},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" }}
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "forward+ scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } }
            ]
        });

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        const pipelineLayout = renderer.device.createPipelineLayout({
            label: "forward+ pipeline layout",
            bindGroupLayouts: [
                this.sceneUniformsBindGroupLayout,
                renderer.modelBindGroupLayout,
                renderer.materialBindGroupLayout
            ]
        });

        const vertModule = renderer.device.createShaderModule({
            label: "forward+ vert shader",
            code: shaders.naiveVertSrc
        });

        const fragModule = renderer.device.createShaderModule({
            label: "forward+ frag shader",
            code: shaders.forwardPlusFragSrc
        });

        const makeShadingPipeline = (label: string, depthCompare: GPUCompareFunction, depthWriteEnabled: boolean) =>
            renderer.device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                depthStencil: { depthWriteEnabled, depthCompare, format: "depth24plus" },
                vertex: { module: vertModule, buffers: [renderer.vertexBufferLayout] },
                fragment: { module: fragModule, targets: [{ format: renderer.canvasFormat }] }
            });

        // Without prepass
        this.pipeline = makeShadingPipeline("forward+ pipeline", "less", true);
        // After prepass
        this.shadingAfterPrepassPipeline = makeShadingPipeline("forward+ shading after prepass pipeline", "less-equal", false);

        this.depthPrepassPipeline = renderer.device.createRenderPipeline({
            label: "forward+ depth prepass pipeline",
            layout: pipelineLayout,
            depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
            vertex: { module: vertModule, buffers: [renderer.vertexBufferLayout] },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ depth prepass frag shader",
                    code: shaders.depthPrepassFragSrc
                }),
                targets: []   // depth only, no color output
            }
        });

        const overdrawFragModule = renderer.device.createShaderModule({
            label: "overdraw debug frag shader",
            code: shaders.overdrawFragSrc
        });
        const additiveBlend: GPUBlendState = {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
        };
        const makeOverdrawPipeline = (label: string, depthCompare: GPUCompareFunction, depthWriteEnabled: boolean) =>
            renderer.device.createRenderPipeline({
                label,
                layout: pipelineLayout,
                depthStencil: { depthWriteEnabled, depthCompare, format: "depth24plus" },
                vertex: { module: vertModule, buffers: [renderer.vertexBufferLayout] },
                fragment: { module: overdrawFragModule, targets: [{ format: renderer.canvasFormat, blend: additiveBlend }] }
            });
        this.overdrawPipeline = makeOverdrawPipeline("overdraw debug pipeline", "less", true);
        this.overdrawAfterPrepassPipeline = makeOverdrawPipeline("overdraw debug after prepass pipeline", "less-equal", false);

        this.clusterMarkBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "cluster mark bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "storage" } }
            ]
        });
        this.clusterMarkBindGroup = renderer.device.createBindGroup({
            label: "cluster mark bind group",
            layout: this.clusterMarkBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: this.depthTextureView },
                { binding: 2, resource: { buffer: this.lights.activeClustersBuffer } }
            ]
        });
        this.clusterMarkPipeline = renderer.device.createRenderPipeline({
            label: "cluster mark pipeline",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [this.clusterMarkBindGroupLayout]
            }),
            vertex: {
                module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFullscreenVertSrc })   // reuse the fullscreen triangle
            },
            fragment: {
                module: renderer.device.createShaderModule({ label: "cluster mark frag shader", code: shaders.clusterMarkFragSrc }),
                targets: []   // no color output: the shader only writes to the active-cluster buffer
            },
            // The depth buffer is attached read-only so it can also be read as a texture in the same pass.
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" }
        });

        const makeBundle = (label: string, pipeline: GPURenderPipeline, colorFormats: GPUTextureFormat[]) => {
            const bundleEncoder = renderer.device.createRenderBundleEncoder({
                label,
                colorFormats,
                depthStencilFormat: "depth24plus"
            });
            bundleEncoder.setPipeline(pipeline);
            bundleEncoder.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            this.recordSceneDraws(bundleEncoder);
            return bundleEncoder.finish();
        };
        this.sceneBundle = makeBundle("forward+ render bundle", this.pipeline, [renderer.canvasFormat]);
        this.shadingAfterPrepassBundle = makeBundle("forward+ shading after prepass bundle", this.shadingAfterPrepassPipeline, [renderer.canvasFormat]);
        this.depthPrepassBundle = makeBundle("forward+ depth prepass bundle", this.depthPrepassPipeline, []);
    }

    override draw() {
        // TODO-2: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the main rendering pass, using the computed clusters for efficient lighting
        const encoder = renderer.device.createCommandEncoder();

        //shade every fragment using only the lights in its cluster
        const canvasTextureView = renderer.context.getCurrentTexture().createView();
        const usePrepass = renderer.settings.useDepthPrepass;
        const useBundles = renderer.settings.useRenderBundles;
        const useCulling = usePrepass && renderer.settings.useClusterCulling;

        if (usePrepass) {
            const prepass = encoder.beginRenderPass({
                label: "forward+ depth prepass",
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store"
                }
            });
            if (useBundles) {
                prepass.executeBundles([this.depthPrepassBundle]);
            } else {
                prepass.setPipeline(this.depthPrepassPipeline);
                prepass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
                this.recordSceneDraws(prepass);
            }
            prepass.end();
        }

        if (useCulling) {
            encoder.clearBuffer(this.lights.activeClustersBuffer);   // reset all flags to 0
            const markPass = encoder.beginRenderPass({
                label: "forward+ cluster marking pass",
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.depthTextureView,
                    depthReadOnly: true
                }
            });
            markPass.setPipeline(this.clusterMarkPipeline);
            markPass.setBindGroup(0, this.clusterMarkBindGroup);
            markPass.draw(3);
            markPass.end();
        }

        this.lights.doLightClustering(encoder, useCulling); 
        
        const renderPass = encoder.beginRenderPass({
            label: "forward+ render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: usePrepass ? "load" : "clear",
                depthStoreOp: "store"
            }
        });

        const shadingPipeline = usePrepass ? this.shadingAfterPrepassPipeline : this.pipeline;
        const shadingBundle = usePrepass ? this.shadingAfterPrepassBundle : this.sceneBundle;
        if (renderer.settings.showOverdraw) {                         
            renderPass.setPipeline(usePrepass ? this.overdrawAfterPrepassPipeline : this.overdrawPipeline);
            renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            this.recordSceneDraws(renderPass);
        }
        else if (useBundles) {
            renderPass.executeBundles([shadingBundle]);
        } else {
            renderPass.setPipeline(shadingPipeline);
            renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            this.recordSceneDraws(renderPass);
        }

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
