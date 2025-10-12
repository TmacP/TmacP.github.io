// SPRITE SHADER
struct Uniforms {
  frameRect: vec4f,      // x, y, width, height of current frame
  atlasSize: vec2f,      // width, height of the full sprite atlas
  spritePos: vec2f,      // sprite position in game world
  gameResolution: vec2f, // game viewport resolution
  facing: f32,           // sprite facing direction
  padding: f32,          // padding for alignment
};

struct OurVertexShaderOutput {
  @builtin(position) position: vec4f,
  @location(0) texcoord: vec2f,
};

@group(0) @binding(0) var ourSampler: sampler;
@group(0) @binding(1) var ourTexture: texture_2d<f32>; 
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@vertex fn vs(
  @builtin(vertex_index) vertexIndex : u32
) -> OurVertexShaderOutput {
  let pos = array(
    // 1st triangle
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    // 2nd triangle
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );

  let texcoord = array(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );

  var vsOutput: OurVertexShaderOutput;
  
  // Check if this is a tile (negative facing value)
  if (uniforms.facing < 0.0) {
    // Simple tile rendering - no rotation, top-left positioned
    let tilePos = pos[vertexIndex];
    let gamePixelPos = uniforms.spritePos + tilePos * uniforms.frameRect.zw;
    let clipPos = (gamePixelPos / uniforms.gameResolution) * 2.0 - 1.0;
    vsOutput.position = vec4f(clipPos.x, -clipPos.y, 0.0, 1.0);
    vsOutput.texcoord = texcoord[vertexIndex];
  } else {
    // Player sprite rendering - top-left positioned (like tiles)
    let localPos = pos[vertexIndex];
    let spriteSize = uniforms.frameRect.zw; // Use frame width/height as sprite size

    // Calculate sprite position in game coordinates (top-left based)
    let gamePixelPos = uniforms.spritePos + localPos * spriteSize;
    // Convert directly to clip space using game resolution
    let clipPos = (gamePixelPos / uniforms.gameResolution) * 2.0 - 1.0;
    vsOutput.position = vec4f(clipPos.x, -clipPos.y, 0.0, 1.0);
    
    // Flip texture coordinates horizontally when facing right (facing = 0)
    var finalTexcoord = texcoord[vertexIndex];
    if (uniforms.facing < 0.5) {
      finalTexcoord.x = 1.0 - finalTexcoord.x;
    }
    vsOutput.texcoord = finalTexcoord;
  }
  return vsOutput;
}

@fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
  // Calculate UV coordinates for the current frame within the atlas
  let framePos = uniforms.frameRect.xy;   // frame x, y in atlas
  let frameSize = uniforms.frameRect.zw;  // frame width, height
  
  // Transform texcoord (0-1 range) to the specific frame in the atlas
  let atlasUV = (framePos + fsInput.texcoord * frameSize) / uniforms.atlasSize;
  
  return textureSample(ourTexture, ourSampler, atlasUV);
}

// TILE SHADER
struct TileGlobals {
  atlasSize: vec2f,      // width, height of the full sprite atlas
  gameResolution: vec2f, // game viewport resolution
};

struct TileVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texcoord: vec2f,
  @location(1) framePos: vec2f,
  @location(2) frameSize: vec2f,
};

@group(0) @binding(0) var tileSampler: sampler;
@group(0) @binding(1) var tileTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> tileGlobals: TileGlobals;

@vertex fn tile_vs(
  @builtin(vertex_index) vertexIndex : u32,
  @location(0) tilePos : vec2f,
  @location(1) frameRect : vec4f,
) -> TileVertexOutput {
  let pos = array(
    // 1st triangle
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    // 2nd triangle
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );

  let texcoord = array(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
  );

  var output: TileVertexOutput;
  
  // Simple tile positioning - top-left anchored, no rotation
  let tileSize = frameRect.zw; // width, height from atlas
  let gamePixelPos = tilePos + pos[vertexIndex] * tileSize;
  let clipPos = (gamePixelPos / tileGlobals.gameResolution) * 2.0 - 1.0;
  output.position = vec4f(clipPos.x, -clipPos.y, 0.0, 1.0);
  output.texcoord = texcoord[vertexIndex];
  output.framePos = frameRect.xy;
  output.frameSize = frameRect.zw;

  return output;
}

@fragment fn tile_fs(input: TileVertexOutput) -> @location(0) vec4f {
  // Calculate UV coordinates for the tile within the atlas
  let atlasUV = (input.framePos + input.texcoord * input.frameSize) / tileGlobals.atlasSize;
  return textureSample(tileTexture, tileSampler, atlasUV);
}

// POST-PROCESSING LIGHTING SHADER
struct LightingUniforms {
  playerPos: vec2f,       // player position in world space
  gameResolution: vec2f,  // game resolution
  lightRadius: f32,       // radius of the light effect
  lightIntensity: f32,    // intensity of the light (0-1)
  playerFacing: vec2f,    // normalized direction vector the player is facing
  coneAngle: f32,         // cone angle in radians (half-angle)
  lightingEnabled: f32,   // whether lighting is enabled (1.0 = on, 0.0 = off)
};

struct PostProcessVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texcoord: vec2f,
  @location(1) worldPos: vec2f,  // world position for lighting calculation
};

@group(0) @binding(0) var screenSampler: sampler;
@group(0) @binding(1) var screenTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> lightingUniforms: LightingUniforms;

@vertex fn lighting_vs(
  @builtin(vertex_index) vertexIndex : u32
) -> PostProcessVertexOutput {
  let pos = array(
    // Full screen quad
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
  );

  let texcoord = array(
    vec2f(0.0, 1.0),  // bottom-left in texture space
    vec2f(1.0, 1.0),  // bottom-right
    vec2f(0.0, 0.0),  // top-left
    vec2f(0.0, 0.0),  // top-left
    vec2f(1.0, 1.0),  // bottom-right
    vec2f(1.0, 0.0),  // top-right
  );

  var output: PostProcessVertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.texcoord = texcoord[vertexIndex];
  
  // Calculate world position from clip space position
  // Need to match the coordinate system used in tile rendering where Y is flipped
  let normalizedPos = (pos[vertexIndex] + 1.0) * 0.5;  // Convert from [-1,1] to [0,1]
  output.worldPos = vec2f(normalizedPos.x, 1.0 - normalizedPos.y) * lightingUniforms.gameResolution;
  
  return output;
}

@fragment fn lighting_fs(input: PostProcessVertexOutput) -> @location(0) vec4f {
  // Sample the original rendered scene
  let sceneColor = textureSample(screenTexture, screenSampler, input.texcoord);
  
  // If lighting is disabled, return full brightness scene
  if (lightingUniforms.lightingEnabled < 0.5) {
    return sceneColor; // No lighting effect, full brightness
  }
  
  // Offset the flashlight origin slightly in the facing direction
  let flashlightOffset = 14.0; // Offset the light source forward by about half a sprite width
  let facingDir = normalize(lightingUniforms.playerFacing);
  let flashlightOrigin = lightingUniforms.playerPos + facingDir * flashlightOffset;
  
  // Calculate direction from flashlight origin to this pixel
  let toPixel = input.worldPos - flashlightOrigin;
  let distanceToLight = length(toPixel);
  let distanceToPlayer = length(input.worldPos - lightingUniforms.playerPos);
  
  // Set minimum ambient lighting for areas outside the flashlight
  let minAmbient = 0.05;
  
  // FIRST: Calculate flashlight lighting
  var finalLightFactor = minAmbient; // Default to ambient
  var isInFlashlight = false;
  
  if (distanceToLight <= lightingUniforms.lightRadius && distanceToLight >= 1.0) {
    // Normalize direction to pixel from flashlight origin
    let dirToPixel = normalize(toPixel);
    
    // Calculate dot product between player facing direction and direction to pixel
    let dotProduct = dot(facingDir, dirToPixel);
    
    // For a cone, we want pixels that are in the same direction as the player is facing
    let coneThreshold = cos(lightingUniforms.coneAngle * 0.5);
    
    // Check if pixel is within the flashlight cone
    if (dotProduct >= coneThreshold) {
      isInFlashlight = true;
      
      // Calculate cone intensity based on how close to center the pixel is
      let coneIntensity = smoothstep(coneThreshold, 1.0, dotProduct);
      
      // Distance-based falloff - brighter closer to flashlight origin
      let normalizedDistance = distanceToLight / lightingUniforms.lightRadius;
      let distanceFalloff = 1.0 - smoothstep(0.0, 1.0, normalizedDistance);
      
      // Combine cone and distance effects
      let lightFactor = coneIntensity * distanceFalloff;
      
      // Apply the flashlight lighting
      finalLightFactor = mix(minAmbient, 1.0, lightFactor * lightingUniforms.lightIntensity);
    }
  }
  
  // SECOND: Add player sprite self-illumination ONLY if not well-lit by flashlight
  let playerIlluminationRadius = 20.0;
  let playerSelfLight = 0.5;
  
  if (distanceToPlayer <= playerIlluminationRadius && finalLightFactor < 0.3) {
    // Only apply player lighting if this pixel has sprite content AND is still dark
    let pixelBrightness = (sceneColor.r + sceneColor.g + sceneColor.b) / 3.0;
    
    if (pixelBrightness > 0.1 || sceneColor.a > 0.5) {
      let playerLightFalloff = 1.0 - smoothstep(0.0, playerIlluminationRadius, distanceToPlayer);
      let playerLightFactor = mix(minAmbient, playerSelfLight, playerLightFalloff);
      // Take the maximum of flashlight and player lighting
      finalLightFactor = max(finalLightFactor, playerLightFactor);
    }
  }
  
  // Apply the final lighting to the scene
  return vec4f(sceneColor.rgb * finalLightFactor, sceneColor.a);
}
