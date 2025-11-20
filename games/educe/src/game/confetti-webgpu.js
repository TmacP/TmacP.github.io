// confetti-webgpu.js
// Integrated WebGPU confetti system

const NUM_CONFETTI = 400;

let pipeline = null;
let quadVertexBuffer = null;
let instanceBuffer = null;
let uniformBuffer = null;
let bindGroup = null;
let startTime = 0;
let running = false;

export function initConfetti(device, format) {
    // --- WGSL shader ---
    const shaderCode = /* wgsl */ `
struct ConfettiUniforms {
  time : f32,
  _pad : vec3<f32>,
};

@group(0) @binding(0)
var<uniform> u : ConfettiUniforms;

struct VertexInput {
  @location(0) localPos   : vec2<f32>,
  @location(1) baseX      : f32,
  @location(2) fallSpeed  : f32,
  @location(3) seed       : f32,
  @location(4) color      : vec3<f32>,
};

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var out : VertexOutput;

  let t = u.time + input.seed * 10.0;
  let fall = fract(t * input.fallSpeed + input.seed);
  let y = 1.2 - fall * 2.4;
  let wiggle = sin(t * 8.0 + input.seed * 50.0) * 0.15;
  let worldPos = vec2<f32>(input.baseX + wiggle, y) + input.localPos;

  out.position = vec4<f32>(worldPos, 0.0, 1.0);
  out.color = input.color;

  return out;
}

@fragment
fn fs_main(@location(0) color : vec3<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(color, 1.0);
}
  `;

    const shaderModule = device.createShaderModule({ code: shaderCode });

    // --- Geometry ---
    const halfWidth = 0.01;
    const halfHeight = 0.04;
    const quadVertices = new Float32Array([
        -halfWidth, -halfHeight,
        halfWidth, -halfHeight,
        -halfWidth, halfHeight,
        -halfWidth, halfHeight,
        halfWidth, -halfHeight,
        halfWidth, halfHeight,
    ]);

    quadVertexBuffer = device.createBuffer({
        size: quadVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(quadVertexBuffer, 0, quadVertices);

    // --- Instance data ---
    const floatsPerInstance = 6;
    const instanceData = new Float32Array(NUM_CONFETTI * floatsPerInstance);
    const palette = [
        [1.0, 0.3, 0.3],
        [0.3, 1.0, 0.5],
        [0.3, 0.6, 1.0],
        [1.0, 0.9, 0.4],
        [0.9, 0.4, 1.0],
    ];

    for (let i = 0; i < NUM_CONFETTI; i++) {
        const offset = i * floatsPerInstance;
        const x = (Math.random() * 2 - 1) * 1.1;
        const speed = 0.3 + Math.random() * 0.5;
        const seed = Math.random() * 1000.0;
        const color = palette[Math.floor(Math.random() * palette.length)];

        instanceData[offset + 0] = x;
        instanceData[offset + 1] = speed;
        instanceData[offset + 2] = seed;
        instanceData[offset + 3] = color[0];
        instanceData[offset + 4] = color[1];
        instanceData[offset + 5] = color[2];
    }

    instanceBuffer = device.createBuffer({
        size: instanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(instanceBuffer, 0, instanceData);

    // --- Uniforms ---
    uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "uniform" },
        }],
    });

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });

    bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer },
        }],
    });

    // --- Pipeline ---
    pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            buffers: [
                {
                    arrayStride: 2 * 4,
                    stepMode: "vertex",
                    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
                },
                {
                    arrayStride: floatsPerInstance * 4,
                    stepMode: "instance",
                    attributes: [
                        { shaderLocation: 1, offset: 0, format: "float32" },
                        { shaderLocation: 2, offset: 4, format: "float32" },
                        { shaderLocation: 3, offset: 8, format: "float32" },
                        { shaderLocation: 4, offset: 12, format: "float32x3" },
                    ],
                },
            ],
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{
                format,
                blend: {
                    color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },
                    alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },
                },
            }],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "none",
        },
    });
}

export function startConfetti() {
    running = true;
    startTime = performance.now() / 1000;
}

export function stopConfetti() {
    running = false;
}

export function updateConfetti(device) {
    if (!running || !uniformBuffer) return;

    const now = performance.now() / 1000;
    const t = now - startTime;

    const uniformData = new Float32Array([t, 0, 0, 0]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
}

export function drawConfetti(pass) {
    if (!running || !pipeline) return;

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, quadVertexBuffer);
    pass.setVertexBuffer(1, instanceBuffer);
    pass.draw(6, NUM_CONFETTI, 0, 0);
}
