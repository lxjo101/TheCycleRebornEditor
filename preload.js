const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  // Window control methods
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Game launcher methods
  launchGame: () => ipcRenderer.invoke('launch-game'),
  
  configureGamePaths: () => ipcRenderer.invoke('configure-game-paths'),
  
  checkGameConfigured: () => ipcRenderer.invoke('check-game-configured'),
  
  // Auto-updater methods
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  
  getCurrentVersion: () => ipcRenderer.invoke('get-current-version'),
  
  // Listen for update events (optional for future use)
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, data) => callback(data));
  },
  
  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (event, error) => callback(error));
  },
  
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, progress) => callback(progress));
  },
  
  // Remove update listeners
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('update-error');
    ipcRenderer.removeAllListeners('update-progress');
  },
  
  // Platform information
  platform: process.platform,
  
  // App information
  isElectron: true,
  isPackaged: process.env.NODE_ENV === 'production'
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
  
  // Add packaged app class for CSS targeting
  if (process.env.NODE_ENV === 'production') {
    document.body.classList.add('packaged-app');
  }
  
  // Disable drag and drop of files that might navigate away
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  
  // Handle keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Disable F12 in production
    if (e.key === 'F12' && process.env.NODE_ENV === 'production') {
      e.preventDefault();
    }
    
    // Disable refresh in production
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && process.env.NODE_ENV === 'production') {
      e.preventDefault();
    }
    
    // Add Ctrl+U shortcut for update check
    if ((e.ctrlKey || e.metaKey) && e.key === 'u' && !e.shiftKey) {
      e.preventDefault();
      // Trigger update check if available
      if (window.electronAPI && window.electronAPI.checkForUpdates) {
        window.electronAPI.checkForUpdates();
      }
    }
  });
  
  // Add update status indicator to the page
  const updateIndicator = document.createElement('div');
  updateIndicator.id = 'update-indicator';
  updateIndicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    z-index: 10000;
    display: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  `;
  updateIndicator.textContent = 'Update Available!';
  updateIndicator.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      window.electronAPI.checkForUpdates();
    }
  });
  document.body.appendChild(updateIndicator);
  
  // Listen for update events and show indicator
  if (window.electronAPI) {
    window.electronAPI.onUpdateAvailable((data) => {
      updateIndicator.style.display = 'block';
      setTimeout(() => {
        updateIndicator.style.opacity = '1';
      }, 100);
      
      // Auto-hide after 10 seconds
      setTimeout(() => {
        updateIndicator.style.opacity = '0';
        setTimeout(() => {
          updateIndicator.style.display = 'none';
        }, 300);
      }, 10000);
    });
    
    window.electronAPI.onUpdateError((error) => {
      console.error('Update error:', error);
    });
  }
  
  // Add version info to page if available
  if (window.electronAPI && window.electronAPI.getCurrentVersion) {
    window.electronAPI.getCurrentVersion().then(version => {
      // Create version display
      const versionEl = document.createElement('div');
      versionEl.style.cssText = `
        position: fixed;
        bottom: 50px;
        right: 20px;
        color: rgba(160, 174, 192, 0.6);
        font-size: 11px;
        z-index: 800;
        pointer-events: none;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      `;
      versionEl.textContent = `v${version}`;
      document.body.appendChild(versionEl);
    });
  }
  
  // Console message for developers
  console.log(`
🔧 The Cycle: Reborn Save Editor
📦 Electron App with Auto-Updater
🔄 Updates: Automatic checks enabled
🎮 Game launcher integrated
📡 MongoDB connection ready

Development Commands:
- Ctrl+U: Check for updates
- F12: Developer tools (dev only)
- Ctrl+R: Reload (dev only)

GitHub: https://github.com/lxjo101/TheCycleRebornSaveEditor
  `);
});