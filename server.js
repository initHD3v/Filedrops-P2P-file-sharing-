const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const https = require('https'); // Use https for a secure context
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
// Create an HTTPS server using the generated SSL certificate files
const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, app);
const wss = new WebSocket.Server({ server });

const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Serve static files
app.use(express.static(path.join(__dirname, '.')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// --- WebSocket Logic for User Discovery ---

const clients = {};

const broadcastUsers = () => {
  // IP address is removed. The server's only job is to broadcast IDs and nicknames.
  // WebRTC's ICE mechanism will handle the actual IP discovery between peers.
  const users = Object.values(clients).map(client => ({
    id: client.id,
    nickname: client.nickname
  }));
  const message = JSON.stringify({ type: 'users', users });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  // We no longer store the IP address. It's unreliable and not needed for WebRTC.
  clients[clientId] = { id: clientId, ws: ws, nickname: null };

  console.log(`Client ${clientId} connected. Total clients: ${Object.keys(clients).length}`);
  // Send the client its own ID
  ws.send(JSON.stringify({ type: 'your-id', id: clientId }));
  broadcastUsers();

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    delete clients[clientId];
    broadcastUsers();
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
  });

  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(message);
    // Forward WebRTC signaling messages or handle nickname updates
    if (parsedMessage.type === 'nickname-update') {
      if (clients[clientId]) {
        clients[clientId].nickname = parsedMessage.nickname;
        console.log(`Client ${clientId} updated nickname to ${parsedMessage.nickname}`);
        broadcastUsers(); // Broadcast updated user list to everyone
      }
    } else if (parsedMessage.type === 'offer' || parsedMessage.type === 'answer' || parsedMessage.type === 'ice-candidate' || parsedMessage.type === 'file-transfer-request' || parsedMessage.type === 'accept-transfer' || parsedMessage.type === 'reject-transfer') {
      const targetClient = clients[parsedMessage.targetId];
      if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
        // Add senderId to the message so the recipient knows who sent it
        parsedMessage.senderId = clientId;
        targetClient.ws.send(JSON.stringify(parsedMessage));
      } else {
        console.warn(`Target client ${parsedMessage.targetId} not found or not open.`);
      }
    }
  });
});


// --- REST API Routes ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 1 * 1024 * 1024 * 1024 } });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', upload.array('files', 10), (req, res) => {
  if (req.files && req.files.length > 0) {
    const filenames = req.files.map(file => file.filename);
    res.json({ message: 'Files uploaded successfully!', filenames });
  } else {
    res.status(400).json({ message: 'No files uploaded.' });
  }
});

app.get('/files', (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ message: 'Unable to retrieve files.' });
    }
    const fileDetails = files.map(file => {
      try {
        const stats = fs.statSync(path.join(UPLOADS_DIR, file));
        return stats.isFile() ? { name: file, size: stats.size } : null;
      } catch { return null; }
    }).filter(Boolean);
    res.json({ files: fileDetails });
  });
});

app.delete('/files/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.resolve(UPLOADS_DIR, filename);

  if (!filePath.startsWith(UPLOADS_DIR)) {
    return res.status(400).json({ message: 'Invalid filename.' });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(err.code === 'ENOENT' ? 404 : 500).json({ message: 'Error deleting file' });
    }
    res.json({ message: `File ${filename} deleted successfully.` });
  });
});

app.post('/download-selected', (req, res) => {
  const { files } = req.body;
  if (!files || files.length === 0) {
    return res.status(400).json({ message: 'No files selected.' });
  }

  const archive = archiver('zip');
  res.attachment('selected_files.zip');
  archive.pipe(res);

  files.forEach(file => {
    const filePath = path.resolve(UPLOADS_DIR, file);
    if (fs.existsSync(filePath) && filePath.startsWith(UPLOADS_DIR)) {
      archive.file(filePath, { name: file });
    }
  });

  archive.finalize();
});

// Start the server
const port = 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on https://localhost:${port}`);
  // Find and display the local network IP for easy access from mobile devices
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(devName => {
    interfaces[devName].forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Access on your local network: https://${iface.address}:${port}`);
      }
    });
  });
});

module.exports = { app, server }; // Export for testing