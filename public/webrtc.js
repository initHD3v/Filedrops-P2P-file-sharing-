import { getState, setState } from './state.js';
import { sendSignalingMessage } from './websocket.js';
import { showTransferStatus, clearTransferStatus, showDownloadLink, isIOS, updateProgressBar, showAlert } from './ui.js';

const iceServers = {
  iceServers: [
    // Default Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Adding Open Relay Project TURN server for better reliability
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turns:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

function resetTransferState() {
  const { peerConnection } = getState();
  if (peerConnection) {
    peerConnection.close();
  }
  setState({
    peerConnection: null,
    dataChannel: null,
    selectedFile: null,
    currentRecipientId: null,
    receivedBuffers: [],
    receivedFileName: '',
    receivedFileSize: 0,
    currentReceivedSize: 0,
  });
  clearTransferStatus();
}

async function createPeerConnection(targetId) {
  let { peerConnection } = getState();
  if (peerConnection) {
    console.log('Closing existing peer connection.');
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(iceServers);
  setState({ peerConnection });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate:', event.candidate);
      sendSignalingMessage({
        type: 'ice-candidate',
        targetId: targetId,
        candidate: event.candidate,
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const { peerConnection } = getState();
    console.log('Connection state change:', peerConnection.connectionState);
    // Only reset on 'failed', let 'closed' be a natural transition without explicit close()
    if (peerConnection.connectionState === 'failed') {
      console.log('Peer connection failed. Cleaning up.');
      resetTransferState();
    } else if (peerConnection.connectionState === 'closed') {
        console.log('Peer connection naturally closed.');
        // We don't call resetTransferState() here to avoid explicit close()
        // The state variables will be cleared when the sender confirms and resets,
        // or when the user navigates away.
    }
  };

  peerConnection.ondatachannel = (event) => {
    const dataChannel = event.channel;
    setState({ dataChannel });
    console.log('Data channel received:', dataChannel);
    setupDataChannelListeners(dataChannel);
  };

  return peerConnection;
}

function setupDataChannelListeners(dataChannel) {
    dataChannel.onmessage = async (event) => {
        console.log('Data channel message received:', event.data);
        if (typeof event.data === 'string') {
            const message = JSON.parse(event.data);
            if (message.type === 'file-info') {
                setState({ 
                    receivedFileName: message.name, 
                    receivedFileSize: message.size, 
                    receivedBuffers: [], 
                    currentReceivedSize: 0 
                });
                console.log(`Receiving file: ${message.name} (${message.size} bytes)`);
                showTransferStatus(`Incoming file: ${message.name}. Please wait...`);
            } else if (message.type === 'file-end') {
                const { receivedBuffers, receivedFileName, incomingFileTransferRequest } = getState();
                const receivedBlob = new Blob(receivedBuffers, { type: incomingFileTransferRequest?.file.type || 'application/octet-stream' });
                if (dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({ type: 'file-received-ack' }));
                    console.log('Receiver sent file-received-ack.');
                } else {
                    console.warn('Data channel not open when trying to send file-received-ack.');
                }

                // Tampilkan progress bar 100% dan pesan sukses
                updateProgressBar(100);
                showTransferStatus(`File ${receivedFileName} berhasil diterima! Mempersiapkan unduhan...`, 'success');

                // Tunda pemanggilan showDownloadLink dan clearTransferStatus
                setTimeout(() => {
                    showDownloadLink(receivedBlob, receivedFileName);
                    console.log('File received. Blob URL created for manual opening in a new tab.');
                    // clearTransferStatus() is called inside showDownloadLink
                }, 3000); // Delay for 3 seconds
                console.log('Sender: Received file-received-ack.');
                const { selectedFile } = getState();
                if (selectedFile) {
                    showAlert(`File ${selectedFile.name} berhasil dikirim!`, 'success');
                    showTransferStatus(`File ${selectedFile.name} berhasil dikirim!`); // Update status immediately
                    console.log(`Sender: Displayed success alert for ${selectedFile.name}.`);
                } else {
                    showAlert(`File berhasil dikirim!`, 'success');
                    showTransferStatus(`File berhasil dikirim!`); // Update status immediately
                    console.warn('Sender: selectedFile was null when receiving ACK.');
                }
                // Delay clearing UI and resetting state by 5 seconds
                setTimeout(() => {
                    clearTransferStatus(); // Segera bersihkan status dan sembunyikan tombol batal
                    console.log('Sender: Cleared transfer status and hid cancel button after 5 seconds.');
                    resetTransferState(); // Segera reset status internal pengirim
                }, 500); // 500 milliseconds = 0.5 seconds
            }
        } else {
            let { receivedBuffers, currentReceivedSize, receivedFileSize, receivedFileName } = getState();
            receivedBuffers.push(event.data);
            currentReceivedSize += event.data.byteLength;
            setState({ receivedBuffers, currentReceivedSize });
            const progress = (currentReceivedSize / receivedFileSize) * 100;
            showTransferStatus(`Receiving ${receivedFileName}: ${progress.toFixed(2)}%`);
            updateProgressBar(progress);
        }
    };

    dataChannel.onopen = () => {
        console.log('Data channel opened!');
        clearTransferStatus();
    };
    dataChannel.onclose = () => {
        console.log('Data channel closed.');
        // Log the readyState of the peerConnection when dataChannel closes
        const { peerConnection } = getState();
        if (peerConnection) {
            console.log('Peer connection readyState on dataChannel close:', peerConnection.readyState);
        }
    };
    dataChannel.onerror = (event) => {
        const error = event.error; // The actual DOMException
        if (error && error.name === 'OperationError' && error.message.includes('User-Initiated Abort')) {
            // Suppress this specific log as it's an expected behavior
        } else {
            console.error('Data channel error:', error);
            showAlert('Transfer file gagal. Coba lagi.', 'danger');
            resetTransferState();
        }
    };
}

async function createOffer(targetId) {
  console.log('createOffer function is being called.');
  setState({ currentRecipientId: targetId });
  const pc = await createPeerConnection(targetId);

  const dataChannel = pc.createDataChannel('fileTransfer');
  setState({ dataChannel });
  console.log('Data channel created:', dataChannel);

  dataChannel.onopen = () => {
    console.log('Data channel opened!');
    setTimeout(() => {
      const { selectedFile } = getState();
      if (selectedFile) {
        sendFile(selectedFile);
      }
    }, 100);
  };
  dataChannel.onclose = () => console.log('Data channel closed.');
  dataChannel.onerror = (error) => console.error('Data channel error:', error);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignalingMessage({
    type: 'offer',
    targetId: targetId,
    sdp: pc.localDescription,
  });
}

async function sendFile(file) {
  const { dataChannel } = getState();
  if (!dataChannel || dataChannel.readyState !== 'open') {
    showTransferStatus('Data channel not open. Please try again.', 'danger');
    return;
  }

  showTransferStatus(`Sending ${file.name}...`);

  dataChannel.send(JSON.stringify({
    type: 'file-info',
    name: file.name,
    size: file.size,
    fileType: file.type
  }));

  const chunkSize = 16 * 1024;
  let offset = 0;

  const fileReader = new FileReader();
  fileReader.onload = (e) => {
    const { dataChannel } = getState(); // Get latest state
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(e.target.result);
      offset += e.target.result.byteLength;
      const progress = (offset / file.size) * 100;
      showTransferStatus(`Sending ${file.name}: ${progress.toFixed(2)}%`);
      updateProgressBar(progress);

      if (offset < file.size) {
        readNextChunk();
      } else {
        dataChannel.send(JSON.stringify({ type: 'file-end' }));
        showTransferStatus(`Finalizing transfer for ${file.name}...`);
        console.log('File chunks sent. Waiting for receiver acknowledgement.');
      }
    } else {
      showTransferStatus('Data channel closed unexpectedly during transfer.', 'danger');
      resetTransferState();
    }
  };

  fileReader.onerror = (error) => {
    console.error('Error reading file:', error);
    showTransferStatus('Error sending file.', 'danger');
    resetTransferState();
  };

  const readNextChunk = () => {
    const slice = file.slice(offset, offset + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };

  readNextChunk();
}

async function handleOffer(data) {
  const pc = await createPeerConnection(data.senderId);
  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  
  // Process any queued ICE candidates
  const { iceCandidateQueue } = getState();
  while(iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    await pc.addIceCandidate(candidate);
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignalingMessage({
    type: 'answer',
    targetId: data.senderId,
    sdp: pc.localDescription,
  });
}

async function handleAnswer(data) {
  const { peerConnection, iceCandidateQueue } = getState();
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    // Process any queued ICE candidates
    while(iceCandidateQueue.length > 0) {
      const candidate = iceCandidateQueue.shift();
      await peerConnection.addIceCandidate(candidate);
    }
  }
}

async function handleIceCandidate(data) {
  const { peerConnection, iceCandidateQueue } = getState();
  const candidate = new RTCIceCandidate(data.candidate);

  // Jika peerConnection belum dibuat, antrekan kandidat saja.
  // createPeerConnection (dipanggil oleh handleOffer/createOffer) akan memproses antrean ini nanti.
  if (!peerConnection) {
    iceCandidateQueue.push(candidate);
    console.log('ICE candidate queued: peerConnection not yet established.');
    return; // Keluar dari fungsi
  }

  // Jika peerConnection sudah ada, lanjutkan dengan logika yang ada
  if (peerConnection.remoteDescription) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (e) {
      console.error('Error adding received ICE candidate', e);
      // Tidak memanggil resetTransferState di sini, biarkan onconnectionstatechange yang menanganinya
    }
  } else {
    // Jika remoteDescription belum ditetapkan, antrekan kandidat
    iceCandidateQueue.push(candidate);
    console.log('ICE candidate queued: remoteDescription not yet set.');
  }
}

async function handleAcceptTransfer(data) {
    console.log(`Transfer accepted by ${data.senderId}. Creating WebRTC offer.`);
    showTransferStatus(`Recipient accepted. Establishing connection...`);
    setState({ currentRecipientId: data.senderId });
    await createOffer(data.senderId);
}

function handleRejectTransfer(data) {
    showAlert(`Penerima menolak transfer.`, 'danger');
    resetTransferState();
}

export { createOffer, handleOffer, handleAnswer, handleIceCandidate, handleAcceptTransfer, handleRejectTransfer, resetTransferState };