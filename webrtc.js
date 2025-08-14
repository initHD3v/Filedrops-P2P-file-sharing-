import { sendMessage } from './websocket.js';
import {
  getState,
  addPeerConnection,
  getPeerConnection,
  addFileChannel,
  getFileChannel,
  cleanupConnections,
  setTransferState,
  resetTransferState,
  showToast,
  setPeerConnectionState,
} from './state.js';

const CHUNK_SIZE = 64 * 1024; // 64KB
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let receivedBuffers = {};
let receivedMetadata = {};
let fileDownloads = {};

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
    console.log('Data channel received');
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
    const channel = peerConnection.createDataChannel('file-transfer');
    addFileChannel(targetId, channel);
    setupDataChannel(channel, targetId);

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
  channel.onopen = () => console.log(`Data channel with ${userId} is open`);
  channel.onclose = () => {
    console.log(`Data channel with ${userId} is closed`);
    cleanupConnections(userId);
  };
}

function handleDataChannelMessage(event, userId) {
  const data = event.data;
  try {
    // Assuming metadata is sent as a JSON string
    const metadata = JSON.parse(data);
    if (metadata.type === 'file-metadata') {
      receivedMetadata[userId] = metadata;
      receivedBuffers[userId] = [];
      fileDownloads[userId] = { receivedSize: 0 };
      console.log(`Receiving file: ${metadata.name} (${metadata.size} bytes)`);
      setTransferState({
        isTransferring: true,
        transferStatus: `Incoming file: ${metadata.name}`,
        transferProgress: 0,
      });
      return;
    }
  } catch (e) {
    // It's not metadata, so it must be a file chunk
    const metadata = receivedMetadata[userId];
    if (!metadata) {
      console.error('Received file chunk without metadata.');
      return;
    }

    receivedBuffers[userId].push(data);
    fileDownloads[userId].receivedSize += data.byteLength;

    const progress = Math.round(
      (fileDownloads[userId].receivedSize / metadata.size) * 100
    );
    setTransferState({
      transferProgress: progress,
      transferStatus: `Downloading... ${progress}%`,
    });

    if (fileDownloads[userId].receivedSize === metadata.size) {
      const receivedBlob = new Blob(receivedBuffers[userId]);
      const downloadUrl = URL.createObjectURL(receivedBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = metadata.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      setTransferState({
        transferStatus: `File ${metadata.name} received successfully!`,
        isTransferring: false,
      });
      showToast('File received!', 'success');
      delete receivedMetadata[userId];
      delete receivedBuffers[userId];
      delete fileDownloads[userId];
    }
  }
}

async function sendFile(targetId, files) {
  const file = files[0]; // For now, send one file at a time
  const channel = getFileChannel(targetId);

  if (!channel || channel.readyState !== 'open') {
    showToast('Connection not ready. Please wait.', 'error');
    return;
  }

  const metadata = { name: file.name, size: file.size, type: 'file-metadata' };
  channel.send(JSON.stringify(metadata));

  setTransferState({
    isTransferring: true,
    transferStatus: `Sending: ${file.name}`,
    transferProgress: 0,
    cancelTransfer: () => {
      // This is a simplified cancel. A real implementation would need a signal.
      console.log('Transfer cancelled');
      resetTransferState();
      setTransferState({ transferStatus: 'Transfer cancelled.' });
      showToast('Transfer cancelled', 'error');
      // We can't easily stop the stream, but we can stop sending more chunks.
      // For a real implementation, a 'cancel' message should be sent.
    },
  });

  let offset = 0;
  const fileReader = new FileReader();

  fileReader.onload = (e) => {
    if (!getState().isTransferring) return; // Check if transfer was cancelled
    try {
      channel.send(e.target.result);
      offset += e.target.result.byteLength;
      const progress = Math.round((offset / file.size) * 100);
      setTransferState({
        transferProgress: progress,
        transferStatus: `Sending... ${progress}%`,
      });

      if (offset < file.size) {
        readSlice(offset);
      } else {
        setTransferState({
          transferStatus: `File ${file.name} sent successfully!`,
          isTransferring: false,
        });
        showToast('File sent!', 'success');
      }
    } catch (error) {
      console.error('Error sending file chunk:', error);
      setTransferState({
        transferStatus: `Error: ${error.message}`,
        isTransferring: false,
      });
    }
  };

  const readSlice = (o) => {
    const slice = file.slice(o, o + CHUNK_SIZE);
    fileReader.readAsArrayBuffer(slice);
  };

  readSlice(0);
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
