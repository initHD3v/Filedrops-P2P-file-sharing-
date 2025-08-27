import {
  setMyIdentity,
  setUsers,
  showIncomingFileModal,
  closeIncomingFileModal,
  getState,
  showToast,
  cleanupConnections,
} from './state.js';
import {
  createPeerConnection,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
} from './webrtc.js';

let ws;

export function connectWebSocket() {
  const protocol = window.location.protocol === 'https' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to signaling server');
    showToast('Connected to server', 'success');
  };

  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    const { myId } = getState();

    // Make sure we don't process messages intended for others, except for broadcasts
    if (data.targetId && data.targetId !== myId) return;

    switch (data.type) {
      case 'your-id':
        setMyIdentity(data.id, data.nickname);
        break;
      case 'users':
        const { users } = data;
        const oldUsers = new Set(getState().users.map((u) => u.id));
        const newUsers = new Set(users.map((u) => u.id));

        // Create connections for new users, but only if this client has a "smaller" ID
        // This prevents a race condition where both clients try to initiate
        users.forEach((user) => {
          if (myId < user.id) {
            console.log(
              `My ID is smaller, initiating connection to ${user.nickname}`
            );
            createPeerConnection(user.id, true); // `isInitiator` is true
          }
        });

        // Clean up connections for disconnected users
        oldUsers.forEach((userId) => {
          if (!newUsers.has(userId)) {
            console.log(
              `User ${userId} disconnected, cleaning up connections.`
            );
            cleanupConnections(userId);
          }
        });

        setUsers(users);
        break;

      case 'offer':
        handleOffer(data.senderId, data.offer);
        break;

      case 'answer':
        handleAnswer(data.senderId, data.answer);
        break;

      case 'ice-candidate':
        handleIceCandidate(data.senderId, data.candidate);
        break;

      case 'file-transfer-request':
        const onAccept = () => {
          sendMessage({ type: 'accept-transfer', targetId: data.senderId });
          closeIncomingFileModal();
        };
        const onReject = () => {
          sendMessage({ type: 'reject-transfer', targetId: data.senderId });
          closeIncomingFileModal();
        };
        showIncomingFileModal({ ...data, onAccept, onReject });
        break;
    }
  };

  ws.onclose = () => {
    console.log('Disconnected from signaling server');
    showToast('Disconnected from server. Trying to reconnect...', 'error');
    // Clean up all connections
    getState().users.forEach((user) => cleanupConnections(user.id));
    setUsers([]); // Clear user list
    setTimeout(connectWebSocket, 3000); // Attempt to reconnect after 3 seconds
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showToast('WebSocket connection error', 'error');
  };
}

export function sendMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function updateNickname(newNickname) {
  setMyIdentity(getState().myId, newNickname);
  sendMessage({ type: 'nickname-update', nickname: newNickname });
  showToast('Nickname updated!', 'success');
}
