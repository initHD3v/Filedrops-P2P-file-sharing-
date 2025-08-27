const CHUNK_SIZE = 256 * 1024; // 256KB. Must be the same as in webrtc.js

self.onmessage = (e) => {
  const { type, file } = e.data;

  if (type === 'start') {
    console.log('[Worker] Received start signal');
    startFileProcessing(file);
  }
};

function startFileProcessing(file) {
  let offset = 0;

  function readSlice(o) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(slice);
    });
  }

  async function processNextChunk() {
    if (offset >= file.size) {
      self.postMessage({ type: 'done' });
      console.log('[Worker] Processing complete');
      return;
    }

    try {
      const chunk = await readSlice(offset);
      // Transfer the ArrayBuffer to the main thread with zero-copy
      self.postMessage({ type: 'chunk', chunk }, [chunk]);
      offset += chunk.byteLength;
      // Immediately queue the next chunk processing
      processNextChunk();
    } catch (error) {
      console.error('[Worker] Error reading file slice:', error);
      self.postMessage({ type: 'error', message: error.message });
    }
  }

  processNextChunk();
}
