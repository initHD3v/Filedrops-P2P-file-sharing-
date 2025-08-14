const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const clients = {};

// Daftar nama hewan dan buah untuk penamaan unik
const animals = [
  'singa',
  'gajah',
  'kucing',
  'anjing',
  'zebra',
  'monyet',
  'harimau',
  'kelinci',
  'serigala',
  'beruang',
];

const fruits = [
  'pisang',
  'mangga',
  'jeruk',
  'nanas',
  'anggur',
  'alpukat',
  'rambutan',
  'durian',
  'salak',
  'apel',
];

// Fungsi untuk menghasilkan nama perangkat unik (hewan + buah, 10-12 karakter)
function generateUniqueDeviceName() {
  let newName;
  let isUnique = false;
  const minLength = 10;
  const maxLength = 12;

  while (!isUnique) {
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    const randomFruit = fruits[Math.floor(Math.random() * fruits.length)];
    newName = randomAnimal + randomFruit;

    // Periksa panjang nama
    if (newName.length >= minLength && newName.length <= maxLength) {
      // Periksa keunikan di antara klien yang sudah ada
      isUnique = !Object.values(clients).some(
        (client) => client.nickname === newName
      );
    }
  }
  return newName;
}

const broadcastUsers = (wss) => {
  const users = Object.values(clients).map((client) => ({
    id: client.id,
    nickname: client.nickname,
  }));
  const message = JSON.stringify({ type: 'users', users });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error(`Error broadcasting users to client:`, error);
      }
    }
  });
};

function initializeWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const randomNickname = generateUniqueDeviceName();
    clients[clientId] = { id: clientId, ws: ws, nickname: randomNickname };

    console.log(
      `Client ${clientId} connected with nickname ${randomNickname}. Total clients: ${Object.keys(clients).length}`
    );

    try {
      ws.send(
        JSON.stringify({
          type: 'your-id',
          id: clientId,
          nickname: randomNickname,
        })
      );
    } catch (error) {
      console.error(`Error sending your-id to client ${clientId}:`, error);
    }
    broadcastUsers(wss);

    ws.on('close', () => {
      console.log(`Client ${clientId} disconnected`);
      delete clients[clientId];
      broadcastUsers(wss);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
    });

    ws.on('message', (message) => {
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.type === 'nickname-update') {
        if (clients[clientId]) {
          clients[clientId].nickname = parsedMessage.nickname;
          console.log(
            `Client ${clientId} updated nickname to ${parsedMessage.nickname}`
          );
          broadcastUsers(wss);
        }
      } else if (parsedMessage.targetId) {
        const targetClient = clients[parsedMessage.targetId];
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          parsedMessage.senderId = clientId;
          targetClient.ws.send(JSON.stringify(parsedMessage));
        } else {
          console.warn(
            `Target client ${parsedMessage.targetId} not found or not open.`
          );
        }
      }
    });
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down WebSocket server...');
    wss.clients.forEach((client) => client.close());
  });
}

module.exports = { initializeWebSocket };
