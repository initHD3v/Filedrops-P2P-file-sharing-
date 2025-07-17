
let state = {
  myId: null,
  myNickname: null,
  peerConnection: null,
  dataChannel: null,
  selectedFile: null,
  currentRecipientId: null,
  usersOnNetwork: [],
  incomingFileTransferRequest: null,
  receivedBuffers: [],
  receivedFileName: '',
  receivedFileSize: 0,
  currentReceivedSize: 0,
  iceCandidateQueue: [],
};

export function getState() {
  return state;
}

export function setState(newState) {
  state = { ...state, ...newState };
}
