import { connectWebSocket } from './websocket.js';
import { initializeUI } from './ui.js';
import { setTheme, getState } from './state.js';

document.addEventListener('DOMContentLoaded', () => {
  // Set initial theme from localStorage
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  // Initialize UI event listeners and render loop
  initializeUI();

  // Connect to the WebSocket server
  connectWebSocket();
});
