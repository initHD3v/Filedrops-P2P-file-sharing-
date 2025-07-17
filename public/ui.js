import { getState, setState } from './state.js';
import { sendSignalingMessage } from './websocket.js';
import { resetTransferState } from './webrtc.js';

// --- DOM Elements ---
let userListDiv = null;
let noUsersMessage = null;
let fileInput = null;
let transferStatusDiv = null;
let transferProgressBar = null;
let transferProgressContainer = null;
let toastContainer = null;
let cancelTransferButton = null;
let myNicknameSpan = null;
let developerInfoSpan = null;

// --- Modal Elements ---
let fileNotificationModal = null;
let senderNicknameSpan = null;
let thumbnailContainer = null;
let incomingFileNameSpan = null;
let incomingFileSizeSpan = null;
let acceptFileButton = null;
let rejectFileButton = null;
let rejectFileButtonX = null;

function initializeUIElements() {
    userListDiv = document.getElementById('user-list');
    noUsersMessage = document.getElementById('no-users-message');
    fileInput = document.getElementById('file-input');
    transferStatusDiv = document.getElementById('transfer-status');
    transferProgressBar = document.getElementById('transfer-progress-bar');
    transferProgressContainer = document.getElementById('transfer-progress-container');
    toastContainer = document.getElementById('toast-container');
    cancelTransferButton = document.getElementById('cancel-transfer-button');
    myNicknameSpan = document.getElementById('my-nickname');
    developerInfoSpan = document.getElementById('developer-info');

    // Modal elements
    fileNotificationModal = new bootstrap.Modal(document.getElementById('file-notification-modal'));
    senderNicknameSpan = document.getElementById('sender-nickname');
    thumbnailContainer = document.getElementById('thumbnail-container');
    incomingFileNameSpan = document.getElementById('incoming-file-name');
    incomingFileSizeSpan = document.getElementById('incoming-file-size');
    acceptFileButton = document.getElementById('accept-file-button');
    rejectFileButton = document.getElementById('reject-file-button');
    rejectFileButtonX = document.getElementById('reject-file-button-x');
}

// --- UI Functions ---

function renderUserList(users) {
  setState({ usersOnNetwork: users });
  userListDiv.innerHTML = '';

  if (users.length > 0) {
    noUsersMessage.style.display = 'none';
    users.forEach(user => {
      const userCard = document.createElement('div');
      userCard.className = 'user-card';
      const displayName = user.nickname || 'Device';
      userCard.innerHTML = `
        <div class="user-icon-wrapper">
          <span class="material-icons user-icon">devices</span>
        </div>
        <div class="user-info">
          <p class="user-name">${displayName}</p>
        </div>
      `;
      userCard.addEventListener('click', () => {
        setState({ currentRecipientId: user.id });
        fileInput.click();
      });
      userListDiv.appendChild(userCard);
    });
  } else {
    noUsersMessage.style.display = 'block';
  }
}

function showTransferStatus(message, type = 'info') {
    transferStatusDiv.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function clearTransferStatus() {
    console.log('clearTransferStatus called.');
    transferStatusDiv.innerHTML = '';
    fileInput.value = ''; // Clear selected file from input
    cancelTransferButton.style.display = 'none';
    updateProgressBar(0); // Reset progress bar
    console.log('transferStatusDiv innerHTML after clear:', transferStatusDiv.innerHTML);
    console.log('cancelTransferButton display after clear:', cancelTransferButton.style.display);
}

function updateProgressBar(progress) {
    if (progress > 0 && progress < 100) {
        transferProgressContainer.style.display = 'block';
        transferProgressBar.style.width = `${progress}%`;
        transferProgressBar.setAttribute('aria-valuenow', progress);
        transferProgressBar.textContent = `${Math.round(progress)}%`;
    } else if (progress === 100) {
        transferProgressBar.style.width = '100%';
        transferProgressBar.setAttribute('aria-valuenow', 100);
        transferProgressBar.textContent = '100%';
    } else { // progress === 0 or initial state
        transferProgressContainer.style.display = 'none';
        transferProgressBar.style.width = '0%';
        transferProgressBar.setAttribute('aria-valuenow', 0);
        transferProgressBar.textContent = '0%';
    }
}

function showAlert(message, type = 'info', duration = 5000) {
    const toastId = `toast-${Date.now()}`;
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastEl = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastEl, { delay: duration });
    toast.show();
}

function showDownloadLink(blob, fileName) {
    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;

    // --- Automatic Download & Enhanced UI ---

    // 1. Hide the link visually
    downloadLink.style.display = 'none'; 
    document.body.appendChild(downloadLink);

    // 2. Trigger the download automatically
    downloadLink.click();

    // 3. Clean up the link and URL object
    document.body.removeChild(downloadLink);

    // 4. Display a clear, persistent message to the user
    const downloadLocation = isIOS() ? "aplikasi 'File' atau 'Foto' Anda" : "folder 'Downloads' Anda";
    showAlert(`File berhasil diunduh!`, 'success', 3000);

    // Clear transfer status after successful download
    clearTransferStatus();
}

async function handleFileTransferRequest(data) {
  setState({ incomingFileTransferRequest: data });
  const { usersOnNetwork } = getState();
  const sender = usersOnNetwork.find(u => u.id === data.senderId);
  senderNicknameSpan.textContent = sender ? (sender.nickname || 'A user') : 'A user';
  incomingFileNameSpan.textContent = data.file.name;
  incomingFileSizeSpan.textContent = formatFileSize(data.file.size);

  thumbnailContainer.innerHTML = '';
  if (data.thumbnail) {
    const img = document.createElement('img');
    img.src = data.thumbnail;
    img.className = 'img-thumbnail';
    thumbnailContainer.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = 'insert_drive_file';
    icon.style.fontSize = '100px';
    thumbnailContainer.appendChild(icon);
  }

  fileNotificationModal.show();
}

function formatFileSize(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function isIOS() {
    return [
      'iPad Simulator',
      'iPhone Simulator',
      'iPod Simulator',
      'iPad',
      'iPhone',
      'iPod'
    ].includes(navigator.platform)
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
}

function generateThumbnail(file, callback) {
    if (!file.type.startsWith('image/')) {
      callback(null);
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
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
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

// --- Event Listeners ---
function setupEventListeners() {
    fileInput.addEventListener('change', (event) => {
        const selectedFile = event.target.files[0];
        const { currentRecipientId } = getState();
        if (selectedFile && currentRecipientId) {
            setState({ selectedFile });
            requestFileTransfer(currentRecipientId, selectedFile);
        }
    });

    cancelTransferButton.addEventListener('click', () => {
        console.log('Transfer cancelled by user.');
        resetTransferState();
        showAlert('Transfer dibatalkan.', 'warning');
    });

    acceptFileButton.addEventListener('click', () => {
        const { incomingFileTransferRequest } = getState();
        if (incomingFileTransferRequest) {
            sendSignalingMessage({
                type: 'accept-transfer',
                targetId: incomingFileTransferRequest.senderId
            });
            fileNotificationModal.hide();
            showTransferStatus(`Accepted file transfer. Waiting for connection...`);
        }
    });

    const rejectAction = () => {
        const { incomingFileTransferRequest } = getState();
        if (incomingFileTransferRequest) {
            sendSignalingMessage({
                type: 'reject-transfer',
                targetId: incomingFileTransferRequest.senderId
            });
            fileNotificationModal.hide();
            setState({ incomingFileTransferRequest: null });
        }
    };

    rejectFileButton.addEventListener('click', rejectAction);
    rejectFileButtonX.addEventListener('click', rejectAction);
}

function requestFileTransfer(targetId, file) {
    generateThumbnail(file, (thumbnail) => {
      const request = {
        type: 'file-transfer-request',
        targetId: targetId,
        file: { name: file.name, size: file.size, type: file.type },
        thumbnail: thumbnail
      };
      sendSignalingMessage(request);
      showTransferStatus(`Requesting to send ${file.name}...`);
      cancelTransferButton.style.display = 'block';
    });
}

function loadInitialUI() {
    myNicknameSpan.textContent = 'Loading...'; // Set initial state to loading

    // Typing effect for developer info
    const developerText = "Developed by initialH";
    const socialMediaLink = "https://www.instagram.com/suduttech?igsh=MTZnOTh4bHBsOHNkOQ%3D%3D&utm_source=qr";
    let i = 0;
    function typeWriter() {
        if (i < developerText.length) {
            developerInfoSpan.innerHTML += developerText.charAt(i);
            i++;
            setTimeout(typeWriter, 70);
        } else {
            developerInfoSpan.style.cursor = 'pointer';
            developerInfoSpan.addEventListener('click', () => {
                window.open(socialMediaLink, '_blank');
            });
        }
    }
    typeWriter();
}

function setMyNicknameDisplay(nickname) {
    myNicknameSpan.textContent = nickname;
}

export { renderUserList, handleFileTransferRequest, setupEventListeners, loadInitialUI, showTransferStatus, clearTransferStatus, showDownloadLink, isIOS, updateProgressBar, showAlert, initializeUIElements, setMyNicknameDisplay };