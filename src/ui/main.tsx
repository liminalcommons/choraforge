/**
 * ABOUTME: Entry point for the ChoraForge web UI React application.
 * Mounts the App component to the DOM root element.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
