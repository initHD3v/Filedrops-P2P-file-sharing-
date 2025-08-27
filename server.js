const express = require('express');
const path = require('path');
const os = require('os');
const helmet = require('helmet');
const http = require('http');
const { initializeWebSocket } = require('./websocketHandler');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket signaling server
initializeWebSocket(server);

// Basic security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        'style-src': [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
        ],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'connect-src': ["'self'", 'ws:', 'wss:'], // Allow WebSocket connections
        'img-src': ["'self'", 'data:'],
        'frame-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': null, // Important for local development
      },
    },
  })
);

app.use(express.json());

// Server Node.js ini hanya berfungsi sebagai server sinyal WebSocket dalam mode pengembangan.
// File statis dilayani oleh server pengembangan Vite.

//Melayani file statis dari folder dist
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the server only if this file is run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Signaling server running on http://localhost:${port}`);
    // Find and display the local network IP for easy access from other devices
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((devName) => {
      interfaces[devName].forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(
            `Access on your local network: http://${iface.address}:${port}`
          );
        }
      });
    });
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server has been gracefully shut down.');
    process.exit(0);
  });
});

module.exports = { app, server }; // Export for testing
