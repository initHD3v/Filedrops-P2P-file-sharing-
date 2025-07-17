const WebSocket = require('ws');
const { server } = require('./server');

const TEST_PORT = 3006; // A clean port

describe('WebSocket Server Logic', () => {
  let testServer;

  beforeAll((done) => {
    testServer = server.listen(TEST_PORT, done);
  });

  afterAll((done) => {
    testServer.close(done);
  });

  test('should connect and receive a unique ID', (done) => {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
    client.on('message', (message) => {
      const data = JSON.parse(message);
      // We only care about the 'your-id' message for this test
      if (data.type === 'your-id') {
        expect(data.id).toBeDefined();
        client.close();
        done();
      }
    });
  });

  test('should receive a user list after connecting', (done) => {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
    let messageCount = 0;
    client.on('message', (message) => {
      messageCount++;
      if (messageCount === 2) { // The first message is the ID, the second is the user list
        const data = JSON.parse(message);
        expect(data.type).toBe('users');
        expect(data.users).toHaveLength(1);
        client.close();
        done();
      }
    });
  });

  test('should broadcast user list update to existing client', (done) => {
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    client1.on('message', (msg) => {
      const data = JSON.parse(msg);
      // Wait for the user list that includes the second user
      if (data.type === 'users' && data.users.length === 2) {
        client1.close();
        done();
      }
    });

    // After client1 is listening, connect client2
    client1.on('open', () => {
      const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      // Close client2 after a short delay to ensure the test completes
      setTimeout(() => client2.close(), 500);
    });
  });

  test('should handle nickname updates and broadcast them', (done) => {
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    let client1Id = null;

    // First, get the ID for client1
    client1.once('message', (msg) => {
      client1Id = JSON.parse(msg).id;

      // After getting the ID, connect client2
      const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      client2.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.type === 'users') {
          const user1 = data.users.find(u => u.id === client1Id);
          if (user1 && user1.nickname === 'Tester') {
            expect(user1.nickname).toBe('Tester');
            client1.close();
            client2.close();
            done();
          }
        }
      });

      // After client2 is connected, client1 sends its nickname update
      client2.on('open', () => {
        client1.send(JSON.stringify({ type: 'nickname-update', nickname: 'Tester' }));
      });
    });
  });

  test('should forward WebRTC signaling messages correctly', (done) => {
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    let client1Id = null;
    let client2;

    // Get client1's ID
    client1.once('message', (msg) => {
      client1Id = JSON.parse(msg).id;

      // Connect client2
      client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      let client2Id = null;

      client2.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.type === 'your-id') {
          client2Id = data.id;
          // Once client2 has its ID, client1 can send the offer
          const offerPayload = { type: 'offer', targetId: client2Id, sdp: 'test-sdp' };
          client1.send(JSON.stringify(offerPayload));
        } else if (data.type === 'offer') {
          // Client2 receives the forwarded offer
          expect(data.sdp).toBe('test-sdp');
          expect(data.senderId).toBe(client1Id);
          client1.close();
          client2.close();
          done();
        }
      });
    });
  });
});