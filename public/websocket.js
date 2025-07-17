import { handleOffer, handleAnswer, handleIceCandidate, handleAcceptTransfer, handleRejectTransfer } from './webrtc.js';
import { renderUserList, handleFileTransferRequest, setMyNicknameDisplay } from './ui.js';
import { getState, setState } from './state.js';

let webSocket;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const host = window.location.host;
  webSocket = new WebSocket(`${protocol}${host}`);

  webSocket.onopen = () => {
    console.log('WebSocket connection established');
    // Initial actions on connection can be dispatched from here
  };

  webSocket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    const { myId } = getState();

    switch (data.type) {
      case 'users':
        renderUserList(data.users.filter(user => user.id !== myId));
        break;
      case 'your-id':
        setState({ myId: data.id, myNickname: data.nickname });
        console.log('My ID received from server:', data.id);
        console.log('My Nickname received from server:', data.nickname);
        setMyNicknameDisplay(data.nickname); // Update UI with the new nickname
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

// function sendNicknameUpdate(nickname) { // No longer needed as manual nickname change is removed
//   if (webSocket && webSocket.readyState === WebSocket.OPEN) {
//     webSocket.send(JSON.stringify({ type: 'nickname-update', nickname: nickname }));
//   }
// }

function sendSignalingMessage(message) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(message));
    }
}


export { connectWebSocket, sendSignalingMessage };