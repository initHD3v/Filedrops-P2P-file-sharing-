const request = require('supertest');
const { app, server } = require('./server'); // Import app and server
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Helper function to clean up the uploads directory
const cleanupUploads = () => {
  if (fs.existsSync(UPLOADS_DIR)) {
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(UPLOADS_DIR, file));
    }
  }
};

beforeAll((done) => {
  // Start the server before any tests run
  server.listen(3002, done); // Use a different port for testing
  cleanupUploads();
});

afterAll((done) => {
  // Close the server after all tests are done
  server.close(done);
});

afterEach(() => {
  // Clean up after each test
  cleanupUploads();
});

describe('File Upload and Management API', () => {
  it('should upload a single file', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('test file content'), 'test-file-for-upload.txt');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Files uploaded successfully!');
    expect(response.body.filenames).toHaveLength(1);
    // The filename is now the original name, not a timestamped one
    expect(fs.existsSync(path.join(UPLOADS_DIR, 'test-file-for-upload.txt'))).toBe(true);
  });

  it('should list uploaded files', async () => {
    // First, upload a file to ensure there's something to list
    await request(app)
      .post('/upload')
      .attach('files', Buffer.from('another test file'), 'test2.txt');

    const response = await request(app).get('/files');
    expect(response.status).toBe(200);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0].name).toBe('test2.txt');
  });

  it('should delete an uploaded file', async () => {
    // Upload a file to delete
    await request(app)
      .post('/upload')
      .attach('files', Buffer.from('file to be deleted'), 'deleteme.txt');

    const deleteResponse = await request(app).delete('/files/deleteme.txt');
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.message).toBe('File deleteme.txt deleted successfully.');
    expect(fs.existsSync(path.join(UPLOADS_DIR, 'deleteme.txt'))).toBe(false);
  });

  it('should return 404 when trying to delete a non-existent file', async () => {
    const response = await request(app).delete('/files/nonexistentfile.txt');
    expect(response.status).toBe(404);
  });

  it('should prevent path traversal when deleting files', async () => {
    const response = await request(app).delete('/files/..%2f..%2fpackage.json');
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid filename.');
  });
});
