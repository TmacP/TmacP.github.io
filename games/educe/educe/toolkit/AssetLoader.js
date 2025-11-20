export const AssetLoader = {
  async loadJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    return res.json();
  },

  async loadImageBitmap(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load image ${url}`);
    const blob = await res.blob();
    return createImageBitmap(blob);
  },

  async loadAudioBuffer(url, audioContext) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load audio ${url}`);
    const arrayBuffer = await res.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer);
  },
};
