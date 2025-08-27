import { sendMessage } from './websocket.js';
import {
  getState,
  addPeerConnection,
  getPeerConnection,
  addFileChannel,
  getFileChannels,
  cleanupConnections,
  setTransferState,
  resetTransferState,
  showToast,
  setPeerConnectionState,
} from './state.js';

const PARALLEL_CHANNELS = 4;
const CHUNK_SIZE = 256 * 1024; // 256KB
const HIGH_WATER_MARK = 16 * 1024 * 1024; // 16MB
const LOW_WATER_MARK = 8 * 1024 * 1024; // 8MB
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let fileDownloads = {};
let fileSenderWorker = null;

function formatEta(seconds) {
  if (seconds === Infinity || isNaN(seconds) || seconds < 0) {
    return '...';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  if (s > 0) return `${s}s left`;
  return '...';
}

async function createPeerConnection(targetId, isInitiator) {
  const peerConnection = new RTCPeerConnection(ICE_SERVERS);
  addPeerConnection(targetId, peerConnection);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage({ type: 'ice-candidate', targetId, candidate: event.candidate });
    }
  };

  peerConnection.ondatachannel = (event) => {
    console.log(`Data channel '${event.channel.label}' received`);
    const channel = event.channel;
    addFileChannel(targetId, channel);
    setupDataChannel(channel, targetId);
  };

  peerConnection.onconnectionstatechange = () => {
    const newState = peerConnection.connectionState;
    console.log(`Peer connection with ${targetId} changed to ${newState}`);
    setPeerConnectionState(targetId, newState);
    if (newState === 'disconnected' || newState === 'failed' || newState === 'closed') {
      cleanupConnections(targetId);
    }
  };

  if (isInitiator) {
    for (let i = 0; i < PARALLEL_CHANNELS; i++) {
      const label = `file-transfer-${i}`;
      const channel = peerConnection.createDataChannel(label, { ordered: true });
      console.log(`Creating data channel: ${label}`);
      addFileChannel(targetId, channel);
      setupDataChannel(channel, targetId);
    }

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sendMessage({ type: 'offer', targetId, offer });
    } catch (e) {
      console.error('Error creating offer:', e);
    }
  }
}

function setupDataChannel(channel, userId) {
  channel.binaryType = 'arraybuffer';
  channel.onmessage = (event) => handleDataChannelMessage(event, userId);
  channel.onopen = () => console.log(`Data channel '${channel.label}' with ${userId} is open`);
  channel.onclose = () => console.log(`Data channel '${channel.label}' with ${userId} is closed`);
}

async function handleDataChannelMessage(event, userId) {
  // ... (Receiver logic remains unchanged)
  const data = event.data;

  if (data instanceof ArrayBuffer) {
    const download = fileDownloads[userId];
    if (!download) {
      console.error('Received file chunk before metadata.');
      return;
    }

    if (download.writable) {
      try {
        await download.writable.write(data);
      } catch (err) {
        console.error('Error writing file chunk:', err);
        setTransferState({ transferStatus: `Error: ${err.message}`, isTransferring: false });
        delete fileDownloads[userId];
        return;
      }
    } else {
      download.bufferedChunks.push(data);
    }

    download.receivedSize += data.byteLength;
    const progress = Math.round((download.receivedSize / download.metadata.size) * 100);
    const timeElapsed = (Date.now() - getState().transferStartTime) / 1000;
    const speedBps = download.receivedSize / timeElapsed;
    const bytesRemaining = download.metadata.size - download.receivedSize;
    const etaSeconds = bytesRemaining / speedBps;

    setTransferState({
      transferProgress: progress,
      transferStatus: `Downloading... ${progress}%`,
      transferEta: formatEta(etaSeconds),
    });

    if (download.receivedSize === download.metadata.size) {
      if (download.writable) {
        await download.writable.close();
      }
      setTransferState({
        transferStatus: `File ${download.metadata.name} received successfully!`,
        isTransferring: false,
      });
      showToast('File received and saved!', 'success');
      delete fileDownloads[userId];
    }
    return;
  }

  try {
    const metadata = JSON.parse(data);
    if (metadata.type === 'file-metadata') {
      console.log(`Receiving file: ${metadata.name} (${metadata.size} bytes)`);

      fileDownloads[userId] = { metadata, receivedSize: 0, writable: null, bufferedChunks: [] };

      setTransferState({
        isTransferring: true,
        transferStatus: `Incoming file: ${metadata.name}`,
        transferProgress: 0,
        transferStartTime: Date.now(),
        transferEta: '...',
      });

      if (!window.showSaveFilePicker) {
        showToast('Browser not supported for large file saves.', 'error');
        return;
      }

      try {
        const handle = await window.showSaveFilePicker({ suggestedName: metadata.name });
        const writable = await handle.createWritable();
        const download = fileDownloads[userId];
        download.writable = writable;

        for (const chunk of download.bufferedChunks) {
          await writable.write(chunk);
        }
        download.bufferedChunks = [];

        if (download.receivedSize === download.metadata.size) {
          await writable.close();
          setTransferState({
            transferStatus: `File ${download.metadata.name} received successfully!`,
            isTransferring: false,
          });
          showToast('File received and saved!', 'success');
          delete fileDownloads[userId];
        }
      } catch (err) {
        console.log('File save cancelled by user.', err);
        resetTransferState();
        setTransferState({ transferStatus: 'File save cancelled.' });
        delete fileDownloads[userId];
      }
    }
  } catch (e) {
    console.error('Failed to parse message or handle chunk.', e);
  }
}

// --- New sendFile implementation using Web Worker ---
async function sendFile(targetId, files) {
  const file = files[0];
  const channels = getFileChannels(targetId);

  if (!channels || channels.length < PARALLEL_CHANNELS || !channels.every(ch => ch.readyState === 'open')) {
    showToast('Connection not fully established. Please wait.', 'error');
    return;
  }

  if (fileSenderWorker) {
    console.log('A transfer is already in progress. Terminating previous worker.');
    fileSenderWorker.terminate();
  }

  fileSenderWorker = new Worker('./file.worker.js', { type: 'module' });
  console.log('File sender worker created.');

  let offset = 0;
  let chunkCounter = 0;

  fileSenderWorker.onmessage = async (e) => {
    const { type, chunk } = e.data;

    if (type === 'chunk') {
      const channelIndex = chunkCounter % PARALLEL_CHANNELS;
      const channel = channels[channelIndex];

      if (channel.bufferedAmount > HIGH_WATER_MARK) {
        await new Promise(resolve => {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      if (!getState().isTransferring) {
        return; // Transfer was cancelled
      }
      
      if (channel.readyState !== 'open') {
        console.error(`Data channel '${channel.label}' is not open. Aborting.`);
        showToast('Connection unstable, transfer aborted.', 'error');
        resetTransferState();
        if (fileSenderWorker) fileSenderWorker.terminate();
        fileSenderWorker = null;
        return;
      }

      try {
        channel.send(chunk);
        offset += chunk.byteLength;
        chunkCounter++;

        const progress = Math.round((offset / file.size) * 100);
        const timeElapsed = (Date.now() - getState().transferStartTime) / 1000;
        const speedBps = offset / timeElapsed;
        const bytesRemaining = file.size - offset;
        const etaSeconds = bytesRemaining / speedBps;

        setTransferState({
          transferProgress: progress,
          transferStatus: `Sending... ${progress}%`,
          transferEta: formatEta(etaSeconds),
        });
      } catch (error) {
        console.error('Error sending file chunk:', error);
        setTransferState({ transferStatus: `Error: ${error.message}`, isTransferring: false });
        if (fileSenderWorker) fileSenderWorker.terminate();
        fileSenderWorker = null;
      }

    } else if (type === 'done') {
      console.log('Worker finished processing file.');
      setTransferState({
        transferStatus: `File ${file.name} sent successfully!`,
        isTransferring: false,
      });
      showToast('File sent!', 'success');
      if (fileSenderWorker) fileSenderWorker.terminate();
      fileSenderWorker = null;

    } else if (type === 'error') {
      console.error('Received error from worker:', e.data.message);
      showToast(`Error during file processing: ${e.data.message}`, 'error');
      resetTransferState();
      if (fileSenderWorker) fileSenderWorker.terminate();
      fileSenderWorker = null;
    }
  };

  fileSenderWorker.onerror = (err) => {
    console.error('Unhandled error in file sender worker:', err);
    showToast(`A critical worker error occurred: ${err.message}`, 'error');
    resetTransferState();
    if (fileSenderWorker) fileSenderWorker.terminate();
    fileSenderWorker = null;
  };

  // Setup state and send initial metadata
  channels.forEach(ch => { ch.bufferedAmountLowThreshold = LOW_WATER_MARK; });
  const metadata = { name: file.name, size: file.size, type: 'file-metadata' };
  channels[0].send(JSON.stringify(metadata));

  setTransferState({
    isTransferring: true,
    transferStatus: `Sending: ${file.name}`,
    transferProgress: 0,
    transferStartTime: Date.now(),
    transferEta: '...',
    cancelTransfer: () => {
      console.log('Transfer cancelled by user.');
      if (fileSenderWorker) {
        fileSenderWorker.terminate();
        fileSenderWorker = null;
      }
      resetTransferState();
      setTransferState({ transferStatus: 'Transfer cancelled.' });
      showToast('Transfer cancelled', 'error');
    },
  });

  // Kick off the worker
  fileSenderWorker.postMessage({ type: 'start', file });
}

async function handleOffer(senderId, offer) {
  try {
    await createPeerConnection(senderId, false);
    const pc = getPeerConnection(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendMessage({ type: 'answer', targetId: senderId, answer });
  } catch (e) {
    console.error('Error handling offer:', e);
  }
}

async function handleAnswer(senderId, answer) {
  try {
    const pc = getPeerConnection(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (e) {
    console.error('Error handling answer:', e);
  }
}

async function handleIceCandidate(senderId, candidate) {
  try {
    const pc = getPeerConnection(senderId);
    if (pc && candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (e) {
    console.error('Error handling ICE candidate:', e);
  }
}

export {
  createPeerConnection,
  sendFile,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
};