document.addEventListener('DOMContentLoaded', () => {
  const userListDiv = document.getElementById('user-list');
  const noUsersMessage = document.getElementById('no-users-message');
  const fileInput = document.getElementById('file-input');
  const transferStatusDiv = document.getElementById('transfer-status');
  const cancelTransferButton = document.getElementById('cancel-transfer-button');
  const nicknameInput = document.getElementById('nickname-input');
  const saveNicknameButton = document.getElementById('save-nickname-button');
  const myNicknameSpan = document.getElementById('my-nickname');
  const myIdSpan = document.getElementById('my-id');
  const changeNicknameButton = document.getElementById('change-nickname-button');
  const nicknameInputGroup = document.getElementById('nickname-input-group');
  const developerInfoSpan = document.getElementById('developer-info');

  // Modal elements
  const fileNotificationModal = new bootstrap.Modal(document.getElementById('file-notification-modal'));
  const senderNicknameSpan = document.getElementById('sender-nickname');
  const thumbnailContainer = document.getElementById('thumbnail-container');
  const incomingFileNameSpan = document.getElementById('incoming-file-name');
  const incomingFileSizeSpan = document.getElementById('incoming-file-size');
  const acceptFileButton = document.getElementById('accept-file-button');
  const rejectFileButton = document.getElementById('reject-file-button');
  const rejectFileButtonX = document.getElementById('reject-file-button-x');


  let webSocket;
  let myId = null;
  let myNickname = null;
  let peerConnection;
  let dataChannel;
  let selectedFile = null;
  let currentRecipientId = null;
  let usersOnNetwork = []; // To store the current list of users
  let incomingFileTransferRequest = null; // To store request data

  // For receiving files
  let receivedBuffers = [];
  let receivedFileName = '';
  let receivedFileSize = 0;
  let currentReceivedSize = 0;

  // WebRTC configuration (using public STUN servers)
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Public TURN server (may not be reliable for production)
      { urls: 'turn:numb.viagenie.ca', username: 'webrtc@live.com', credential: 'muazkh' }
    ],
  };

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.host;
    webSocket = new WebSocket(`${protocol}${host}`);

    webSocket.onopen = () => {
      console.log('WebSocket connection established');
      // Load and send nickname on connection
      loadAndSendNickname();
    };

    webSocket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'users':
          renderUserList(data.users.filter(user => user.id !== myId)); // Filter out self
          break;
        case 'your-id':
          myId = data.id;
          console.log('My ID received from server:', myId);
          break;
        case 'offer':
          console.log('Received offer:', data.sdp);
          await handleOffer(data);
          break;
        case 'answer':
          console.log('Received answer:', data.sdp);
          await handleAnswer(data);
          break;
        case 'ice-candidate':
          console.log('Received ICE candidate:', data.candidate);
          await handleIceCandidate(data);
          break;
        case 'file-transfer-request':
          await handleFileTransferRequest(data);
          break;
        case 'accept-transfer':
          await handleAcceptTransfer(data);
          break;
        case 'reject-transfer':
          handleRejectTransfer(data);
          break;
      }
    };

    webSocket.onclose = () => {
      console.log('WebSocket connection closed. Reconnecting...');
      setTimeout(connectWebSocket, 3000);
    };

    webSocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  // --- Nickname Functions ---
  function loadAndSendNickname() {
    const savedNickname = localStorage.getItem('nickname');
    if (savedNickname) {
      myNickname = savedNickname;
      nicknameInput.value = savedNickname;
      myNicknameSpan.textContent = savedNickname;
      sendNicknameUpdate(savedNickname);
      // Hide input group and show change button if nickname exists
      nicknameInputGroup.style.display = 'none';
      changeNicknameButton.style.display = 'inline';
    } else {
      // Show input group if no nickname exists
      nicknameInputGroup.style.display = 'flex';
      changeNicknameButton.style.display = 'none';
    }
  }

  function saveNickname() {
    const newNickname = nicknameInput.value.trim();
    if (newNickname) {
      myNickname = newNickname;
      localStorage.setItem('nickname', newNickname);
      myNicknameSpan.textContent = newNickname;
      sendNicknameUpdate(newNickname);
      console.log(`Nickname saved: ${newNickname}`);
      // Hide input group and show change button after saving
      nicknameInputGroup.style.display = 'none';
      changeNicknameButton.style.display = 'inline';
    } else {
      alert('Please enter a valid nickname.');
    }
  }

  function sendNicknameUpdate(nickname) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ type: 'nickname-update', nickname: nickname }));
    }
  }

  // --- Helper Functions ---
  function isIOS() {
    return [
      'iPad Simulator',
      'iPhone Simulator',
      'iPod Simulator',
      'iPad',
      'iPhone',
      'iPod'
    ].includes(navigator.platform)
    // Also, iPad on iOS 13 detection
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
  }

  // --- WebRTC Functions ---

  function resetTransferState() {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    dataChannel = null;
    selectedFile = null;
    currentRecipientId = null;
    receivedBuffers = [];
    receivedFileName = '';
    receivedFileSize = 0;
    currentReceivedSize = 0;

    fileInput.value = ''; // Clear selected file
    transferStatusDiv.innerHTML = '';
    cancelTransferButton.style.display = 'none';
  }

  async function createPeerConnection(targetId) {
    // Close existing peer connection if any
    if (peerConnection) {
      console.log('Closing existing peer connection.');
      peerConnection.close();
      peerConnection = null;
      dataChannel = null;
    }
    peerConnection = new RTCPeerConnection(iceServers);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate:', event.candidate);
        webSocket.send(JSON.stringify({
          type: 'ice-candidate',
          targetId: targetId,
          candidate: event.candidate,
        }));
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state change:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed') {
        console.log('Peer connection failed or closed. Cleaning up.');
        resetTransferState();
      }
    };

    // For receiving data channel
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      console.log('Data channel received:', dataChannel);
      dataChannel.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'file-info') {
            receivedFileName = message.name;
            receivedFileSize = message.size;
            receivedBuffers = [];
            currentReceivedSize = 0;
            console.log(`Receiving file: ${receivedFileName} (${receivedFileSize} bytes)`);
            transferStatusDiv.innerHTML = `<div class="alert alert-info">Incoming file: ${receivedFileName}. Please wait...</div>`;
          } else if (message.type === 'file-end') {
            const receivedBlob = new Blob(receivedBuffers, { type: incomingFileTransferRequest?.file.type || 'application/octet-stream' });

            // THE FINAL iOS-COMPATIBLE SOLUTION:
            // Create a blob URL and open it in a new tab. This is the most reliable way
            // to let the user save the file using the native iOS "Share" -> "Save to Files" workflow.
            const downloadUrl = URL.createObjectURL(receivedBlob);

            const downloadLink = document.createElement('a');
            downloadLink.href = downloadUrl;
            downloadLink.target = '_blank'; // CRITICAL for iOS: opens in a new tab
            downloadLink.download = receivedFileName; // Suggests a filename, though iOS may ignore it
            downloadLink.textContent = `Buka: ${receivedFileName}`;
            downloadLink.className = 'btn btn-success w-100';

            const instructions = document.createElement('p');
            instructions.className = 'text-center mt-2';
            instructions.textContent = "Setelah file terbuka, gunakan tombol Bagikan untuk 'Simpan ke File'.";

            // Display the link and instructions
            transferStatusDiv.innerHTML = '';
            transferStatusDiv.appendChild(downloadLink);
            transferStatusDiv.appendChild(instructions);

            console.log('File received. Blob URL created for manual opening in a new tab.');

            // Send acknowledgement back to the sender
            // Only send acknowledgement if not on iOS, as iOS requires manual saving
            if (dataChannel && dataChannel.readyState === 'open' && !isIOS()) {
              dataChannel.send(JSON.stringify({ type: 'file-received-ack' }));
            }

          } else if (message.type === 'file-received-ack') {
            // This is the sender receiving confirmation
            transferStatusDiv.innerHTML = `<div class="alert alert-success">Sent ${selectedFile.name} successfully!</div>`;
            console.log('Sender received file-received-ack.');
            setTimeout(() => {
                resetTransferState(); // Reset state after a short delay
            }, 2000);
          }
        } else {
          // This is a file chunk
          receivedBuffers.push(event.data);
          currentReceivedSize += event.data.byteLength;
          const progress = (currentReceivedSize / receivedFileSize) * 100;
          transferStatusDiv.innerHTML = `<div class="alert alert-info">Receiving ${receivedFileName}: ${progress.toFixed(2)}%</div>`;
        }
      };
      dataChannel.onopen = () => {
        console.log('Data channel opened!');
        transferStatusDiv.innerHTML = ''; // Clear status when connection is established
      };
      dataChannel.onclose = () => {
        console.log('Data channel closed.');
        resetTransferState();
      };
      dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
        resetTransferState();
      };
    };

    return peerConnection;
  }

  async function createOffer(targetId) {
    console.log('createOffer function is being called.');
    currentRecipientId = targetId; // Store the recipient ID
    const pc = await createPeerConnection(targetId);

    // Create data channel for sending
    dataChannel = pc.createDataChannel('fileTransfer');
    console.log('Data channel created:', dataChannel);

    dataChannel.onopen = () => {
      console.log('Data channel opened!');
      // Add a small delay to ensure data channel is fully ready
      setTimeout(() => {
        if (selectedFile) {
          sendFile(selectedFile);
        }
      }, 100); // 100ms delay
    };
    dataChannel.onclose = () => {
      console.log('Data channel closed.');
    };
    dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    webSocket.send(JSON.stringify({
      type: 'offer',
      targetId: targetId,
      sdp: pc.localDescription,
    }));
  }

  async function sendFile(file) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      transferStatusDiv.innerHTML = '<div class="alert alert-danger">Data channel not open. Please try again.</div>';
      return;
    }

    transferStatusDiv.innerHTML = `<div class="alert alert-info">Sending ${file.name}...</div>`;

    // Send file info
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({
        type: 'file-info',
        name: file.name,
        size: file.size,
        fileType: file.type
      }));
    } else {
      transferStatusDiv.innerHTML = '<div class="alert alert-danger">Data channel not open. Cannot send file info.</div>';
      resetTransferState();
      return;
    }

    const chunkSize = 16 * 1024; // 16KB chunks
    let offset = 0;

    const fileReader = new FileReader();
    fileReader.onload = (e) => {
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        const progress = (offset / file.size) * 100;
        transferStatusDiv.innerHTML = `<div class="alert alert-info">Sending ${file.name}: ${progress.toFixed(2)}%</div>`;

        if (offset < file.size) {
          readNextChunk();
        } else {
          dataChannel.send(JSON.stringify({ type: 'file-end' }));
          // Wait for acknowledgement from the receiver
          transferStatusDiv.innerHTML = `<div class="alert alert-info">Finalizing transfer for ${file.name}...</div>`;
          console.log('File chunks sent. Waiting for receiver acknowledgement.');

          // Set a timeout for acknowledgement, especially for iOS
          setTimeout(() => {
              if (transferStatusDiv.innerHTML.includes("Finalizing transfer")) { // Check if still waiting
                  transferStatusDiv.innerHTML = `<div class="alert alert-success">Sent ${file.name} successfully! (Manual save required on recipient)</div>`;
                  console.log('Assuming file sent successfully after timeout (iOS).');
                  setTimeout(() => {
                      resetTransferState();
                  }, 2000);
              }
          }, 10000); // 10 seconds timeout
        }
      } else {
        transferStatusDiv.innerHTML = '<div class="alert alert-danger">Data channel closed unexpectedly during transfer.</div>';
        resetTransferState();
      }
    };

    fileReader.onerror = (error) => {
      console.error('Error reading file:', error);
      transferStatusDiv.innerHTML = '<div class="alert alert-danger">Error sending file.</div>';
      resetTransferState(); // Reset state on file read error
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
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    webSocket.send(JSON.stringify({
      type: 'answer',
      targetId: data.senderId,
      sdp: pc.localDescription,
    }));
  }

  async function handleAnswer(data) {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
  }

  async function handleIceCandidate(data) {
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('Error adding received ICE candidate', e);
        resetTransferState(); // Reset state on ICE candidate error
      }
    }
  }

  // --- UI Functions ---

  function renderUserList(users) {
    usersOnNetwork = users; // Update the global user list
    userListDiv.innerHTML = ''; // Clear existing list

    if (users.length > 0) {
      noUsersMessage.style.display = 'none';
      users.forEach(user => {
        const userCard = document.createElement('div');
        // The card no longer needs Bootstrap column classes.
        // Its layout is now controlled by Flexbox in the CSS.
        userCard.className = 'user-card'; 
        const displayName = user.nickname || 'Device'; // Use nickname if available
        userCard.innerHTML = `
          <div class="user-icon-wrapper">
            <span class="material-icons user-icon">devices</span>
          </div>
          <div class="user-info">
            <p class="user-name">${displayName}</p>
          </div>
        `;
        userCard.addEventListener('click', () => {
          console.log('User card clicked:', user.id);
          currentRecipientId = user.id;
          // Automatically trigger file input click
          fileInput.click();
        });
        userListDiv.appendChild(userCard);
      });
    } else {
      noUsersMessage.style.display = 'block';
    }
  }

  // Event listener for file input change (for both click and drag-drop)
  fileInput.addEventListener('change', (event) => {
    selectedFile = event.target.files[0];
    if (selectedFile && currentRecipientId) {
      requestFileTransfer(currentRecipientId, selectedFile);
    } else if (selectedFile) {
      // If a file is selected but no recipient, do nothing for now
      // The user needs to select a recipient first
    }
  });

  // Event listener for save nickname button
  saveNicknameButton.addEventListener('click', saveNickname);

  // Event listener for change nickname button
  changeNicknameButton.addEventListener('click', () => {
    nicknameInputGroup.style.display = 'flex';
    changeNicknameButton.style.display = 'none';
    nicknameInput.focus(); // Focus on the input field
  });

  

  function requestFileTransfer(targetId, file) {
    generateThumbnail(file, (thumbnail) => {
      const request = {
        type: 'file-transfer-request',
        targetId: targetId,
        file: {
          name: file.name,
          size: file.size,
          type: file.type
        },
        thumbnail: thumbnail // This will be null if not an image
      };
      webSocket.send(JSON.stringify(request));
      transferStatusDiv.innerHTML = `<div class="alert alert-info">Requesting to send ${file.name}...</div>`;
      cancelTransferButton.style.display = 'block';
    });
  }

  // Event listener for cancel transfer button click
  cancelTransferButton.addEventListener('click', () => {
    console.log('Transfer cancelled by user.');
    resetTransferState();
    transferStatusDiv.innerHTML = '<div class="alert alert-warning">Transfer cancelled.</div>';
  });

  // --- New File Transfer Request Logic ---

  async function handleFileTransferRequest(data) {
    incomingFileTransferRequest = data; // Save the request data
    const sender = usersOnNetwork.find(u => u.id === data.senderId);
    senderNicknameSpan.textContent = sender ? (sender.nickname || 'A user') : 'A user';
    incomingFileNameSpan.textContent = data.file.name;
    incomingFileSizeSpan.textContent = formatFileSize(data.file.size);

    // Create thumbnail
    thumbnailContainer.innerHTML = ''; // Clear previous thumbnail
    if (data.thumbnail) {
      const img = document.createElement('img');
      img.src = data.thumbnail;
      img.className = 'img-thumbnail';
      thumbnailContainer.appendChild(img);
    } else {
      // Show a generic file icon if no thumbnail
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.textContent = 'insert_drive_file';
      icon.style.fontSize = '100px';
      thumbnailContainer.appendChild(icon);
    }

    fileNotificationModal.show();
  }

  acceptFileButton.addEventListener('click', () => {
    if (incomingFileTransferRequest) {
      webSocket.send(JSON.stringify({
        type: 'accept-transfer',
        targetId: incomingFileTransferRequest.senderId
      }));
      fileNotificationModal.hide();
      // The offer will be created by the original sender now
      transferStatusDiv.innerHTML = `<div class="alert alert-info">Accepted file transfer. Waiting for connection...</div>`;
    }
  });

  const rejectAction = () => {
      if (incomingFileTransferRequest) {
        webSocket.send(JSON.stringify({
          type: 'reject-transfer',
          targetId: incomingFileTransferRequest.senderId
        }));
        fileNotificationModal.hide();
        incomingFileTransferRequest = null;
      }
  };

  rejectFileButton.addEventListener('click', rejectAction);
  rejectFileButtonX.addEventListener('click', rejectAction);


  async function handleAcceptTransfer(data) {
    // The original sender receives the acceptance and starts the WebRTC offer
    console.log(`Transfer accepted by ${data.senderId}. Creating WebRTC offer.`);
    transferStatusDiv.innerHTML = `<div class="alert alert-info">Recipient accepted. Establishing connection...</div>`;
    // Ensure currentRecipientId is set to the actual recipient's ID
    currentRecipientId = data.senderId; 
    await createOffer(currentRecipientId);
  }

  function handleRejectTransfer(data) {
    // The original sender is notified of rejection
    transferStatusDiv.innerHTML = `<div class="alert alert-danger">Recipient rejected the file transfer.</div>`;
    resetTransferState();
  }

  function generateThumbnail(file, callback) {
    if (!file.type.startsWith('image/')) {
      callback(null); // Not an image, no thumbnail
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg'));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function formatFileSize(bytes, decimals = 2) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }


  // Initial connection
  connectWebSocket();

  // Typing effect for developer info
  const developerText = "Developed by initialH";
  const socialMediaLink = "https://www.instagram.com/suduttech?igsh=MTZnOTh4bHBsOHNkOQ%3D%3D&utm_source=qr";
  let i = 0;

  function typeWriter() {
    if (i < developerText.length) {
      developerInfoSpan.innerHTML += developerText.charAt(i);
      i++;
      setTimeout(typeWriter, 70); // Typing speed
    } else {
      // Once typing is complete, make it clickable
      developerInfoSpan.style.cursor = 'pointer';
      developerInfoSpan.addEventListener('click', () => {
        window.open(socialMediaLink, '_blank');
      });
    }
  }

  typeWriter();
});
