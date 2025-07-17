import { connectWebSocket } from './websocket.js';
import { setupEventListeners, loadInitialUI, initializeUIElements } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI elements after DOM is loaded
  initializeUIElements();

  // Connect to the WebSocket server
  connectWebSocket();

  // Set up all the UI event listeners
  setupEventListeners();

  // Load initial UI elements, like nickname and developer info
  loadInitialUI();
});