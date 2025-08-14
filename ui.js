import { getState, subscribe, setTheme, showToast } from './state.js';
import { sendFile } from './webrtc.js';
import { updateNickname } from './websocket.js';

// Cache DOM elements to avoid repeated lookups
const elements = {};

function cacheElements() {
  const allIds = [
    'my-nickname',
    'user-list',
    'no-users-message',
    'transfer-progress-container',
    'transfer-progress-bar',
    'transfer-status',
    'cancel-transfer-button',
    'file-input',
    'file-notification-modal',
    'sender-nickname',
    'thumbnail-container',
    'incoming-file-name',
    'incoming-file-size',
    'reject-file-button',
    'accept-file-button',
    'theme-toggle',
    'toast-container',
    'developer-info',
    'app-version',
  ];
  allIds.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
  elements.modalInstance = new bootstrap.Modal(
    elements['file-notification-modal']
  );
}

function render() {
  const state = getState();

  // Render Nickname
  elements['my-nickname'].textContent = state.myNickname;

  // Render Theme
  elements['theme-toggle'].checked = state.theme === 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);

  // Render User List
  elements['user-list'].innerHTML = '';
  if (state.users.length === 0) {
    elements['no-users-message'].style.display = 'block';
  } else {
    elements['no-users-message'].style.display = 'none';
    state.users.forEach((user) => {
      const connectionState = getState().peerConnectionStates[user.id] || 'new';
      let dotClass = 'grey';
      let cardClass = 'user-card text-center p-3';

      switch (connectionState) {
        case 'connected':
          dotClass = 'green';
          cardClass += ' clickable'; // Add clickable class when connected
          break;
        case 'connecting':
        case 'new':
          dotClass = 'grey'; // Keep it grey while connecting
          break;
        default: // disconnected, failed, closed
          dotClass = 'red';
          break;
      }

      const userCardElement = document.createElement('div');
      userCardElement.className = `${cardClass}`;
      userCardElement.innerHTML = `
          <span class="status-dot ${dotClass}"></span>
          <i class="material-icons user-icon">person</i>
          <p class="user-nickname mt-2">${user.nickname}</p>
      `;

      if (connectionState === 'connected') {
        userCardElement.addEventListener('click', () => {
          elements['file-input'].setAttribute('data-target-id', user.id);
          elements['file-input'].click();
        });
      }
      elements['user-list'].appendChild(userCardElement);
    });
  }

  // Render Transfer Progress
  const transferContainer = elements['transfer-progress-container'];
  if (state.isTransferring) {
    transferContainer.style.display = 'block';
    elements['transfer-progress-bar'].style.width =
      `${state.transferProgress}%`;
    elements['transfer-progress-bar'].textContent =
      `${state.transferProgress}%`;
    elements['transfer-status'].textContent = state.transferStatus;
    elements['cancel-transfer-button'].style.display = 'block';
  } else {
    transferContainer.style.display = 'none';
    elements['cancel-transfer-button'].style.display = 'none';
    // Do not clear status here, let it persist until next transfer
    elements['transfer-status'].textContent = state.transferStatus;
  }

  // Render Incoming File Modal
  const modalState = state.incomingFileModal;
  if (modalState.isOpen) {
    elements['sender-nickname'].textContent = modalState.senderNickname;
    elements['incoming-file-name'].textContent = modalState.fileName;
    elements['incoming-file-size'].textContent = modalState.fileSize;
    elements['thumbnail-container'].innerHTML =
      modalState.thumbnail ||
      '<i class="material-icons large-icon">description</i>';
    elements.modalInstance.show();
  } else {
    elements.modalInstance.hide();
  }

  // Render Toast Notifications
  if (state.toast.isShown) {
    let iconName;
    let bgColorClass;
    switch (state.toast.type) {
      case 'success':
        iconName = 'check_circle';
        bgColorClass = 'bg-success';
        break;
      case 'error':
        iconName = 'error';
        bgColorClass = 'bg-danger';
        break;
      case 'info':
      default:
        iconName = 'info';
        bgColorClass = 'bg-primary';
        break;
    }

    const toastHTML = `
      <div class="toast custom-toast align-items-center text-white ${bgColorClass} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex align-items-center">
          <i class="material-icons toast-icon">${iconName}</i>
          <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;
    elements['toast-container'].innerHTML = toastHTML;
  } else {
    elements['toast-container'].innerHTML = '';
  }

  // Render static info
  elements['developer-info'].textContent = 'Developed by Initial H';
  elements['app-version'].textContent = '2.0.0'; // Bump version
}

export function initializeUI() {
  cacheElements();
  subscribe(render);

  // --- Event Listeners ---
  // All event listeners should call functions from other modules, not manipulate state directly

  elements['theme-toggle'].addEventListener('change', (e) => {
    setTheme(e.target.checked ? 'dark' : 'light');
  });

  elements['file-input'].addEventListener('change', (e) => {
    const targetId = e.target.getAttribute('data-target-id');
    const files = e.target.files;
    if (targetId && files.length > 0) {
      sendFile(targetId, files);
    }
    e.target.value = ''; // Reset file input
  });

  elements['my-nickname'].addEventListener('click', () => {
    const currentNickname = getState().myNickname;
    const newNickname = prompt('Enter your new nickname:', currentNickname);
    if (newNickname && newNickname.trim() !== currentNickname) {
      updateNickname(newNickname.trim());
    }
  });

  elements['accept-file-button'].addEventListener('click', () => {
    const { onAccept } = getState().incomingFileModal;
    if (typeof onAccept === 'function') onAccept();
  });

  elements['reject-file-button'].addEventListener('click', () => {
    const { onReject } = getState().incomingFileModal;
    if (typeof onReject === 'function') onReject();
  });

  elements['cancel-transfer-button'].addEventListener('click', () => {
    const { cancelTransfer } = getState();
    if (typeof cancelTransfer === 'function') cancelTransfer();
  });
}
