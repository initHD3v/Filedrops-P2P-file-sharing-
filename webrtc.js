import { sendMessage } from './websocket.js';
import {
  getState,
  addPeerConnection,
  getPeerConnection,
  addFileChannel,
  getFileChannels, // Updated import
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
      sendMessage({
        type: 'ice-candidate',
        targetId,
        candidate: event.candidate,
      });
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
    if (
      newState === 'disconnected' ||
      newState === 'failed' ||
      newState === 'closed'
    ) {
      cleanupConnections(targetId);
    }
  };

  if (isInitiator) {
    // Create multiple data channels for parallel transfer
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
  // The receiver's message handler is the same for all channels
  channel.onmessage = (event) => handleDataChannelMessage(event, userId);
  channel.onopen = () => console.log(`Data channel '${channel.label}' with ${userId} is open`);
  channel.onclose = () => {
    console.log(`Data channel '${channel.label}' with ${userId} is closed`);
    // Don't cleanup connections here, as other channels might still be open
  };
}

// NOTE: This simplified receiver does not handle out-of-order chunks.
// It relies on the network delivering chunks from different channels in a roughly sequential manner.
// For a more robust solution, chunk reordering would be necessary.
async function handleDataChannelMessage(event, userId) {
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

async function sendFile(targetId, files) {
  const file = files[0];
  const channels = getFileChannels(targetId);

  if (!channels || channels.length < PARALLEL_CHANNELS) {
    showToast('Connection not fully established. Please wait.', 'error');
    return;
  }

  const allChannelsOpen = channels.every(ch => ch.readyState === 'open');
  if (!allChannelsOpen) {
    showToast('Some channels are not ready. Please wait.', 'error');
    return;
  }

  channels.forEach(ch => { ch.bufferedAmountLowThreshold = LOW_WATER_MARK; });

  const metadata = { name: file.name, size: file.size, type: 'file-metadata' };
  channels[0].send(JSON.stringify(metadata)); // Send metadata on the first channel

  setTransferState({
    isTransferring: true,
    transferStatus: `Sending: ${file.name}`,
    transferProgress: 0,
    transferStartTime: Date.now(),
    transferEta: '...',
    cancelTransfer: () => {
      console.log('Transfer cancelled');
      resetTransferState();
      setTransferState({ transferStatus: 'Transfer cancelled.' });
      showToast('Transfer cancelled', 'error');
    },
  });

  let offset = 0;
  let chunkCounter = 0;

  function readSlice(o) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(o, o + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(slice);
    });
  }

  while (offset < file.size) {
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

    try {
      if (!getState().isTransferring) {
        console.log('Transfer cancelled by user.');
        break;
      }

      const chunk = await readSlice(offset);
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
      console.error('Error reading or sending file chunk:', error);
      setTransferState({ transferStatus: `Error: ${error.message}`, isTransferring: false });
      break;
    }
  }

  if (offset >= file.size) {
    setTransferState({
      transferStatus: `File ${file.name} sent successfully!`,
      isTransferring: false,
    });
    showToast('File sent!', 'success');
  }
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
