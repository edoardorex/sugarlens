import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { load } from '@tensorflow-models/coco-ssd';

const MODEL_ROOT = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
let model;
let cacheWarning = false;
let cache;
const platform = tf.env().platform;
const originalFetch = platform.fetch.bind(platform);
platform.fetch = async (input, options) => {
  const url = String(input);
  if (!url.startsWith(MODEL_ROOT)) throw new Error('Unexpected model download address.');
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch { cacheWarning = true; }
  }
  const response = await originalFetch(url, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
  if (cache) {
    try { await cache.put(url, response.clone()); }
    catch { cacheWarning = true; }
  }
  return response;
};

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ type: 'status', message: 'Preparing local recognition. The first download may take a moment.' });
    if (!model) {
      try { cache = await caches.open('sugarlens.vision.v1'); }
      catch { cacheWarning = true; }
      await tf.setBackend('cpu');
      await tf.ready();
      model = await load({ base: 'lite_mobilenet_v2', modelUrl: `${MODEL_ROOT}model.json` });
    }
    self.postMessage({ type: 'status', message: 'Reading the photo on this device...' });
    const rgba = new Uint8Array(data.pixels);
    const rgb = new Uint8Array(data.width * data.height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target++] = rgba[source];
      rgb[target++] = rgba[source + 1];
      rgb[target++] = rgba[source + 2];
    }
    const tensor = tf.tensor3d(rgb, [data.height, data.width, 3], 'int32');
    try {
      const detections = await model.detect(tensor, 20, 0.55);
      self.postMessage({ type: 'result', detections, cacheWarning });
    } finally { tensor.dispose(); }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
