const state = {
  myId: null,
  myNickname: 'Loading...',
  users: [],
  theme: localStorage.getItem('theme') || 'light',

  // WebRTC connection state
  peerConnections: {},
  fileChannels: {},
  peerConnectionStates: {},

  // File transfer progress state
  transferStatus: '',
  transferProgress: 0,
  isTransferring: false,
  cancelTransfer: () => {},
  transferEta: '', // Estimated time of arrival
  transferStartTime: null,

  // UI component state
  incomingFileModal: {
    isOpen: false,
    senderNickname: '',
    fileName: '',
    fileSize: '',
    thumbnail: null,
    onAccept: () => {},
    onReject: () => {},
  },
  toast: {
    isShown: false,
    message: '',
    type: 'info', // 'info', 'success', 'error'
  },
};

const subscribers = new Set();

const notify = () => {
  for (const callback of subscribers) {
    callback();
  }
};

export function subscribe(callback) {
  subscribers.add(callback);
  callback(); // Immediately call back to render initial state
  return () => subscribers.delete(callback); // Return an unsubscribe function
}

// --- MUTATORS ---
// Functions that are allowed to change the state

export function setMyIdentity(id, nickname) {
  state.myId = id;
  state.myNickname = nickname;
  notify();
}

export function setUsers(users) {
  // Always filter out the current user from the list
  state.users = users.filter(user => user.id !== state.myId);
  notify();
}

export function setPeerConnectionState(userId, connectionState) {
  state.peerConnectionStates[userId] = connectionState;
  notify();
}

export function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  notify();
}

export function setTransferState(updates) {
  Object.assign(state, updates);
  notify();
}

export function resetTransferState() {
  state.isTransferring = false;
  state.transferProgress = 0;
  state.transferEta = '';
  state.transferStartTime = null;
  // We keep the status message until the next transfer
  notify();
}

export function showIncomingFileModal({
  senderNickname,
  fileName,
  fileSize,
  thumbnail,
  onAccept,
  onReject,
}) {
  state.incomingFileModal = {
    isOpen: true,
    senderNickname,
    fileName,
    fileSize,
    thumbnail,
    onAccept,
    onReject,
  };
  notify();
}

export function closeIncomingFileModal() {
  state.incomingFileModal.isOpen = false;
  notify();
}

export function showToast(message, type = 'info') {
  state.toast = { isShown: true, message, type };
  notify();
  setTimeout(() => {
    state.toast.isShown = false;
    notify();
  }, 3000); // Hide after 3 seconds
}

// --- SELECTORS ---
// Functions to get data from the state

export const getState = () => state;

// --- WebRTC State Management ---

export function addPeerConnection(userId, peerConnection) {
  state.peerConnections[userId] = peerConnection;
}

export function getPeerConnection(userId) {
  return state.peerConnections[userId];
}

export function removePeerConnection(userId) {
  if (state.peerConnections[userId]) {
    try {
      state.peerConnections[userId].close();
    } catch (e) {
      console.error('Error closing peer connection:', e);
    }
    delete state.peerConnections[userId];
  }
}

export function addFileChannel(userId, channel) {
  if (!state.fileChannels[userId]) {
    state.fileChannels[userId] = [];
  }
  state.fileChannels[userId].push(channel);
}

export function getFileChannels(userId) {
  return state.fileChannels[userId] || [];
}

export function cleanupFileChannels(userId) {
  const channels = state.fileChannels[userId];
  if (channels && channels.length) {
    channels.forEach(channel => {
      try {
        channel.close();
      } catch (e) {
        console.error('Error closing file channel:', e);
      }
    });
    delete state.fileChannels[userId];
  }
}

export function cleanupConnections(userId) {
  removePeerConnection(userId);
  cleanupFileChannels(userId);
}
