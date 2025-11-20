// confetti-webgpu.js
// Premium WebGPU confetti particle system with enhanced visuals

const NUM_CONFETTI = 600;

let pipeline = null;
let quadVertexBuffer = null;
let instanceBuffer = null;
let uniformBuffer = null;
let bindGroup = null;
let startTime = 0;
let running = false;

/**
 * Initialize the confetti rendering system
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUTextureFormat} format - Target texture format
 */
export function initConfetti(device, format) {
    // --- Enhanced WGSL shader with rotation and size variation ---
    const shaderCode = /* wgsl */ `
struct ConfettiUniforms {
  time : f32,
  pad1 : f32,
  pad2 : f32,
  pad3 : f32,
};

@group(0) @binding(0)
var<uniform> u : ConfettiUniforms;

struct VertexInput {
  @location(0) localPos   : vec2<f32>,
  @location(1) baseX      : f32,
  @location(2) baseY      : f32,
  @location(3) fallSpeed  : f32,
  @location(4) driftSpeed : f32,
  @location(5) rotSpeed   : f32,
  @location(6) seed       : f32,
  @location(7) size       : f32,
  @location(8) color      : vec3<f32>,
};

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
  @location(1) brightness : f32,
};

// 2D rotation matrix
fn rotate2D(angle: f32) -> mat2x2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return mat2x2<f32>(c, -s, s, c);
}

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var out : VertexOutput;

  let t = u.time + input.seed * 5.0;
  
  // Vertical fall with looping
  let fall = fract(t * input.fallSpeed + input.seed);
  let y = input.baseY - fall * 2.8;
  
  // Horizontal drift with sine wave
  let driftPhase = t * input.driftSpeed + input.seed * 6.28318;
  let drift = sin(driftPhase) * 0.25;
  let x = input.baseX + drift;
  
  // Additional wiggle for natural motion
  let wiggle = sin(t * 12.0 + input.seed * 100.0) * 0.08;
  
  // Tumbling rotation
  let rotation = t * input.rotSpeed + input.seed * 6.28318;
  let rotatedPos = rotate2D(rotation) * (input.localPos * input.size);
  
  // Final world position
  let worldPos = vec2<f32>(x + wiggle, y) + rotatedPos;
  
  out.position = vec4<f32>(worldPos, 0.0, 1.0);
  
  // Fade out as it gets closer to bottom (y < -0.5)
  // Map y from [-1.2, -0.2] to opacity [0.0, 1.0]
  let fade = smoothstep(-1.2, -0.2, y);
  
  out.color = input.color;
  
  // Vary brightness based on rotation for shimmer effect
  // And apply fade to alpha (stored in brightness for now or multiply color)
  out.brightness = (0.7 + 0.3 * abs(sin(rotation * 2.0))) * fade;

  return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Apply shimmer brightness to color
  let finalColor = input.color * input.brightness;
  // Use the brightness value as a proxy for alpha fade as well, 
  // or we can just let it fade to black/transparent.
  // Since we are using additive blending or similar, fading color to 0 works.
  return vec4<f32>(finalColor, input.brightness); 
}
  `;

    const shaderModule = device.createShaderModule({ code: shaderCode });

    // --- Enhanced geometry with varied shapes ---
    // Create rectangles with varying aspect ratios
    const baseWidth = 0.012;
    const baseHeight = 0.025;
    const quadVertices = new Float32Array([
        -baseWidth, -baseHeight,
        baseWidth, -baseHeight,
        -baseWidth, baseHeight,
        -baseWidth, baseHeight,
        baseWidth, -baseHeight,
        baseWidth, baseHeight,
    ]);

    quadVertexBuffer = device.createBuffer({
        size: quadVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(quadVertexBuffer, 0, quadVertices);

    // --- Premium color palette ---
    const palette = [
        // Vibrant magenta/pink
        [1.0, 0.2, 0.6],
        // Electric cyan
        [0.0, 0.9, 1.0],
        // Bright golden yellow
        [1.0, 0.85, 0.0],
        // Hot pink
        [1.0, 0.4, 0.7],
        // Lime green
        [0.5, 1.0, 0.2],
        // Royal purple
        [0.7, 0.3, 1.0],
        // Orange
        [1.0, 0.5, 0.0],
        // Bright coral
        [1.0, 0.45, 0.4],
    ];

    // --- Enhanced instance data with more parameters ---
    // 7 single floats + vec3 color (3 floats) = 10 floats total
    const floatsPerInstance = 10; // baseX, baseY, fallSpeed, driftSpeed, rotSpeed, seed, size, color(3)
    const instanceData = new Float32Array(NUM_CONFETTI * floatsPerInstance);

    for (let i = 0; i < NUM_CONFETTI; i++) {
        const offset = i * floatsPerInstance;

        // Random starting X position across screen
        const baseX = (Math.random() * 2 - 1) * 1.2;

        // Random starting Y position (some start higher)
        const baseY = 1.4 + Math.random() * 0.3;

        // Varied fall speeds for depth effect - SLOWED DOWN
        const fallSpeed = 0.1 + Math.random() * 0.25;

        // Horizontal drift speed
        const driftSpeed = 0.8 + Math.random() * 1.2;

        // Rotation speed (both directions)
        const rotSpeed = (Math.random() - 0.5) * 8.0;

        // Unique seed for each particle
        const seed = Math.random() * 1000.0;

        // Size variation
        const size = 0.7 + Math.random() * 0.6;

        // Random color from palette
        const color = palette[Math.floor(Math.random() * palette.length)];

        instanceData[offset + 0] = baseX;
        instanceData[offset + 1] = baseY;
        instanceData[offset + 2] = fallSpeed;
        instanceData[offset + 3] = driftSpeed;
        instanceData[offset + 4] = rotSpeed;
        instanceData[offset + 5] = seed;
        instanceData[offset + 6] = size;
        instanceData[offset + 7] = color[0];
        instanceData[offset + 8] = color[1];
        instanceData[offset + 9] = color[2];
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

    // --- Render pipeline ---
    pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            buffers: [
                // Quad vertices
                {
                    arrayStride: 2 * 4,
                    stepMode: "vertex",
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: "float32x2" }
                    ],
                },
                // Instance data
                {
                    arrayStride: floatsPerInstance * 4,
                    stepMode: "instance",
                    attributes: [
                        { shaderLocation: 1, offset: 0, format: "float32" },    // baseX
                        { shaderLocation: 2, offset: 4, format: "float32" },    // baseY
                        { shaderLocation: 3, offset: 8, format: "float32" },    // fallSpeed
                        { shaderLocation: 4, offset: 12, format: "float32" },   // driftSpeed
                        { shaderLocation: 5, offset: 16, format: "float32" },   // rotSpeed
                        { shaderLocation: 6, offset: 20, format: "float32" },   // seed
                        { shaderLocation: 7, offset: 24, format: "float32" },   // size
                        { shaderLocation: 8, offset: 28, format: "float32x3" }, // color
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

    console.log("✨ Premium confetti system initialized with", NUM_CONFETTI, "particles");
}

export function isInitialized() {
    return !!pipeline;
}

export function startConfetti() {
    console.log("🎉 Starting confetti celebration!");
    running = true;
    startTime = performance.now() / 1000;
}

export function stopConfetti() {
    console.log("Stopping confetti");
    running = false;
}

export function updateConfetti(device) {
    if (!running || !uniformBuffer) return;

    const now = performance.now() / 1000;
    const elapsed = now - startTime;

    const uniformData = new Float32Array([elapsed, 0, 0, 0]);
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
