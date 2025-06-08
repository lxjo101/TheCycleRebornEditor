const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  // Game launcher methods
  launchGame: () => ipcRenderer.invoke('launch-game'),
  
  configureGamePaths: () => ipcRenderer.invoke('configure-game-paths'),
  
  checkGameConfigured: () => ipcRenderer.invoke('check-game-configured'),
  
  // Platform information
  platform: process.platform,
  
  // App information
  isElectron: true
});

// Expose some Node.js APIs that might be useful
contextBridge.exposeInMainWorld('nodeAPI', {
  // For reading files
  fs: {
    readFile: require('fs').promises.readFile,
    writeFile: require('fs').promises.writeFile,
    existsSync: require('fs').existsSync
  },
  
  // For file paths
  path: {
    join: require('path').join,
    dirname: require('path').dirname,
    basename: require('path').basename
  }
});

// Add some Electron-specific enhancements to the window object
window.addEventListener('DOMContentLoaded', () => {
  // Add Electron class to body for CSS targeting
  document.body.classList.add('electron-app');
  
  // Disable drag and drop of files that might navigate away
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  
  // Handle keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Disable F12 in production
    if (e.key === 'F12' && !process.env.NODE_ENV === 'development') {
      e.preventDefault();
    }
    
    // Disable refresh in production
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !process.env.NODE_ENV === 'development') {
      e.preventDefault();
    }
  });
});