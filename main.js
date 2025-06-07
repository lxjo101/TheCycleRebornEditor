const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow;
let serverProcess;
const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Enable live reload for development
if (process.env.NODE_ENV === 'development') {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit'
    });
  } catch (e) {
    // electron-reload not available, continue without it
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getIconPath(),
    title: 'The Cycle: Reborn Save Editor',
    show: false, // Don't show until ready
    titleBarStyle: 'default'
  });

  // Create application menu
  createMenu();

  // Start the Express server
  startServer()
    .then(() => {
      console.log('Server started, loading application...');
      // Load the app
      mainWindow.loadURL(SERVER_URL);
      
      // Show window when ready
      mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Focus on window
        if (process.platform === 'darwin') {
          app.dock.show();
        }
        mainWindow.focus();
      });
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      showErrorDialog('Server Error', `Failed to start the internal server: ${error.message}`);
    });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    // Allow navigation to our server
    if (parsedUrl.origin !== SERVER_URL) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
}

function getIconPath() {
  // Try to find icon in different locations
  const iconPaths = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, 'icon.ico')
  ];
  
  for (const iconPath of iconPaths) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }
  
  return undefined; // Use default Electron icon
}

function getNodeExecutable() {
  // In packaged app, use the bundled Node.js
  if (app.isPackaged) {
    if (process.platform === 'win32') {
      return process.execPath; // Use Electron's node
    } else {
      return process.execPath; // Use Electron's node on other platforms too
    }
  } else {
    // In development, use system node
    return 'node';
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    // Check if server is already running
    const http = require('http');
    const request = http.request({
      hostname: 'localhost',
      port: SERVER_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      console.log('Server already running');
      resolve();
    });

    request.on('error', () => {
      // Server not running, start it
      console.log('Starting Express server...');
      
      const serverScript = path.join(__dirname, 'server.js');
      
      // Check if server.js exists
      if (!fs.existsSync(serverScript)) {
        reject(new Error('server.js not found'));
        return;
      }

      const nodeExecutable = getNodeExecutable();
      console.log('Using Node executable:', nodeExecutable);
      console.log('Server script path:', serverScript);

      // For packaged apps, we need to use Electron's node and set up the environment
      const spawnOptions = {
        cwd: __dirname,
        env: { 
          ...process.env, 
          PORT: SERVER_PORT,
          NODE_ENV: app.isPackaged ? 'production' : process.env.NODE_ENV 
        },
        stdio: process.env.NODE_ENV === 'development' ? 'inherit' : 'pipe'
      };

      // In packaged app, we run the server script directly with Electron's node
      if (app.isPackaged) {
        // Try to run server in the same process first
        try {
          console.log('Starting server in same process...');
          require(serverScript);
          
          // Wait a moment for server to start
          setTimeout(() => {
            checkServerHealth()
              .then(resolve)
              .catch(reject);
          }, 2000);
          
          return;
        } catch (error) {
          console.log('Failed to start server in same process, trying spawn...');
        }
      }

      // Fallback: spawn new process
      serverProcess = spawn(nodeExecutable, [serverScript], spawnOptions);

      serverProcess.on('error', (error) => {
        console.error('Server process error:', error);
        reject(error);
      });

      serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code ${code}`);
        if (code !== 0 && mainWindow) {
          showErrorDialog('Server Crashed', `The internal server stopped unexpectedly (code: ${code})`);
        }
      });

      // Wait for server to be ready
      setTimeout(() => {
        checkServerHealth()
          .then(resolve)
          .catch(reject);
      }, 3000);
    });

    request.end();
  });
}

function checkServerHealth() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds
    
    const checkServer = () => {
      attempts++;
      
      const http = require('http');
      const request = http.request({
        hostname: 'localhost',
        port: SERVER_PORT,
        path: '/api/health',
        method: 'GET',
        timeout: 500
      }, (res) => {
        console.log('Server is ready');
        resolve();
      });

      request.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(checkServer, 500);
        } else {
          reject(new Error('Server failed to start within timeout period'));
        }
      });

      request.end();
    };

    checkServer();
  });
}

function createMenu() {
  // Hide the menu bar completely
  Menu.setApplicationMenu(null);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About The Cycle: Reborn Save Editor',
    message: 'The Cycle: Reborn Save Editor',
    detail: `Version: ${app.getVersion()}\n\nA desktop application for editing The Cycle: Reborn save files through MongoDB.\n\nCreated by the community for the community.`,
    buttons: ['OK']
  });
}

function showErrorDialog(title, message) {
  dialog.showErrorBox(title, message);
}

// App event handlers
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill server process
  if (serverProcess) {
    serverProcess.kill();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Kill server process
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Handle protocol for deep linking (optional)
app.setAsDefaultProtocolClient('cycle-frontier-editor');

// IPC handlers (if needed for future features)
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Export for testing
module.exports = { app, createWindow };