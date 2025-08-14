/**
 * @jest-environment jsdom
 */

import { screen } from '@testing-library/dom';
import '@testing-library/jest-dom';
import { initializeUI } from './ui.js';
import { setMyIdentity } from './state.js';

// Mocking bootstrap modal since it's not available in JSDOM
global.bootstrap = {
  Modal: class {
    constructor(element) {
      this.element = element;
    }
    show() {
      this.element.style.display = 'block';
    }
    hide() {
      this.element.style.display = 'none';
    }
  },
};

describe('UI Initialization and Rendering', () => {
  beforeEach(() => {
    // Set up the document body with the necessary HTML structure
    document.body.innerHTML = `
      <div id="my-nickname"></div>
      <div id="user-list"></div>
      <div id="no-users-message"><p>Mencari perangkat lain...</p></div>
      <div id="transfer-progress-container"></div>
      <div id="transfer-progress-bar"></div>
      <div id="transfer-status"></div>
      <button id="cancel-transfer-button"></button>
      <input type="file" id="file-input" />
      <div id="file-notification-modal"></div>
      <div id="sender-nickname"></div>
      <div id="thumbnail-container"></div>
      <div id="incoming-file-name"></div>
      <div id="incoming-file-size"></div>
      <button id="reject-file-button"></button>
      <button id="accept-file-button"></button>
      <input type="checkbox" id="theme-toggle" />
      <div id="toast-container"></div>
      <div id="developer-info"></div>
      <div id="app-version"></div>
    `;
  });

  test('should display initial nickname from state', () => {
    initializeUI();
    // The initial state sets nickname to 'Loading...'
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('should update nickname when state changes', () => {
    initializeUI();
    // Use the mutator to change the state
    setMyIdentity('123', 'TestUser');
    // The UI should automatically re-render due to the subscription
    expect(screen.getByText('TestUser')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  test('should show no-users-message when user list is empty', () => {
    initializeUI();
    expect(screen.getByText('Mencari perangkat lain...')).toBeVisible();
  });
});
