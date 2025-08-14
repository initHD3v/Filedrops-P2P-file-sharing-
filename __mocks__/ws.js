// __mocks__/ws.js

const EventEmitter = require('events');

// Mock a single WebSocket client connection
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }, 10);
  }

  send(data) {
    // You can add logic here to simulate server responses if needed
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

// Mock the WebSocket server
class MockWebSocketServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.clients = new Set();
  }

  // Helper to simulate a client connecting
  simulateConnection() {
    const client = new MockWebSocket('ws://localhost:1234/test');
    this.clients.add(client);
    this.emit('connection', client, { /* mock request */ });
    return client;
  }

  close(callback) {
    if (callback) callback();
  }
}

module.exports = MockWebSocket;
module.exports.Server = MockWebSocketServer;
