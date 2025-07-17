import { connectWebSocket } from './websocket.js';
import { setupEventListeners, loadInitialUI, initializeUIElements } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI elements after DOM is loaded
  initializeUIElements();

  // Theme Toggle Logic
  const themeToggle = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement; // This is the <html> tag

  // Function to apply theme
  function applyTheme(theme) {
    htmlElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  // Function to toggle theme
  function toggleTheme() {
    if (themeToggle.checked) {
      applyTheme('dark');
    } else {
      applyTheme('light');
    }
  }

  // Load saved theme on startup
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    themeToggle.checked = true;
    applyTheme('dark');
  } else {
    themeToggle.checked = false;
    applyTheme('light'); // Default to light if no theme saved or saved as light
  }

  // Add event listener to the toggle button
  themeToggle.addEventListener('change', toggleTheme);

  // Connect to the WebSocket server
  connectWebSocket();

  // Set up all the UI event listeners
  setupEventListeners();

  // Load initial UI elements, like nickname and developer info
  loadInitialUI();
});