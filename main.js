const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const AutoUpdater = require('./updater'); // Add auto-updater

// Keep a global reference of the window object
let mainWindow;
let serverProcess;
let autoUpdater; // Auto-updater instance
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
    titleBarStyle: 'hidden', // Hide the default title bar
    frame: false // Remove the window frame completely
  });

  // Initialize auto-updater
  autoUpdater = new AutoUpdater({
    githubOwner: 'lxjo101', // Replace with your GitHub username
    githubRepo: 'TheCycleRebornEditor' // Fixed repo name
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

        // Check for updates after window is shown (only in production)
        if (app.isPackaged) {
          setTimeout(() => {
            autoUpdater.checkForUpdates();
          }, 3000); // Wait 3 seconds after startup
        }
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
    detail: `Version: ${app.getVersion()}\n\nA desktop application for editing The Cycle: Reborn save files through MongoDB.\n\nCreated by the community for the community.\n\nFeatures automatic updates from GitHub releases.`,
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

// IPC handlers
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

// Window control IPC handlers
ipcMain.handle('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async () => {
  try {
    if (autoUpdater) {
      await autoUpdater.checkForUpdatesManually();
      return { success: true };
    } else {
      return { success: false, message: 'Auto-updater not initialized' };
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-current-version', () => {
  return app.getVersion();
});

// Game launcher configuration storage
const gameConfigPath = path.join(__dirname, 'gameConfig.json');

function loadGameConfig() {
  try {
    if (fs.existsSync(gameConfigPath)) {
      const data = fs.readFileSync(gameConfigPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading game config:', error);
  }
  return { gamePath: null, serverPath: null };
}

function saveGameConfig(config) {
  try {
    fs.writeFileSync(gameConfigPath, JSON.stringify(config, null, 2));
    console.log('Game config saved:', config);
  } catch (error) {
    console.error('Error saving game config:', error);
  }
}

// Simplified game launcher IPC handlers
ipcMain.handle('launch-game', async () => {
  try {
    console.log('=== STARTING GAME LAUNCH ===');
    
    // Load saved configuration
    let gameConfig = loadGameConfig();
    console.log('Loaded config:', gameConfig);
    
    let gamePath = gameConfig.gamePath;
    let serverPath = gameConfig.serverPath;
    
    console.log('Initial paths:');
    console.log('  gamePath:', gamePath);
    console.log('  serverPath:', serverPath);
    
    // If no saved paths, try to get them from user
    if (!gamePath || !serverPath) {
      console.log('No saved paths, asking user...');
      
      // First, select the server API executable
      const serverResult = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Prospect.Server.Api.exe',
        defaultPath: 'C:\\',
        filters: [{ name: 'Executable Files', extensions: ['exe'] }],
        properties: ['openFile']
      });

      if (serverResult.canceled || !serverResult.filePaths.length) {
        console.log('User cancelled server selection');
        return { success: false, message: 'Server executable not selected' };
      }

      serverPath = serverResult.filePaths[0];
      console.log('User selected server:', serverPath);

      // Then, select the game folder
      const folderResult = await dialog.showOpenDialog(mainWindow, {
        title: 'Select The Cycle Frontier game folder (contains Prospect folder)',
        defaultPath: 'C:\\',
        properties: ['openDirectory']
      });

      if (folderResult.canceled || !folderResult.filePaths.length) {
        console.log('User cancelled game folder selection');
        return { success: false, message: 'Game folder not selected' };
      }

      gamePath = folderResult.filePaths[0];
      console.log('User selected game folder:', gamePath);

      // Save both paths
      saveGameConfig({ 
        gamePath: gamePath,
        serverPath: serverPath 
      });
    }

    // Build client path
    const clientPath = path.join(gamePath, 'Prospect', 'Binaries', 'Win64', 'Prospect.Client.Loader.exe');

    console.log('Final paths:');
    console.log('  serverPath:', serverPath);
    console.log('  clientPath:', clientPath);
    console.log('  gamePath:', gamePath);

    // Check that all files exist
    if (!fs.existsSync(serverPath)) {
      console.log('ERROR: Server not found at:', serverPath);
      return { success: false, message: `Server not found at: ${serverPath}` };
    }
    console.log('✓ Server exists');

    if (!fs.existsSync(clientPath)) {
      console.log('ERROR: Client not found at:', clientPath);
      return { success: false, message: `Client not found at: ${clientPath}` };
    }
    console.log('✓ Client exists');

    // Test simple command first
    console.log('Testing simple spawn...');
    try {
      const testProcess = spawn('cmd', ['/c', 'echo', 'test'], {
        detached: false,
        stdio: 'pipe'
      });
      
      testProcess.stdout.on('data', (data) => {
        console.log('Test output:', data.toString());
      });
      
      testProcess.on('close', (code) => {
        console.log('Test process closed with code:', code);
      });
      
      console.log('✓ Basic spawn works');
    } catch (error) {
      console.log('ERROR: Basic spawn failed:', error);
      return { success: false, message: `Basic spawn test failed: ${error.message}` };
    }

    // Try launching just the server first
    console.log('Attempting to launch server...');
    const serverDir = path.dirname(serverPath);
    console.log('Server directory:', serverDir);
    
    try {
      const serverProcess = spawn(serverPath, [], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        shell: false,
        cwd: serverDir
      });
      
      console.log('Server spawn successful, PID:', serverProcess.pid);
      serverProcess.unref();
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if process is still running
      try {
        process.kill(serverProcess.pid, 0); // Test if process exists
        console.log('✓ Server process is running');
      } catch (e) {
        console.log('WARNING: Server process may have exited');
      }
      
    } catch (error) {
      console.log('ERROR launching server:', error);
      return { success: false, message: `Failed to start server: ${error.message}` };
    }

    // Try launching client
    console.log('Attempting to launch client...');
    
    try {
      const clientProcess = spawn(clientPath, [], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        shell: false
      });
      
      console.log('Client spawn successful, PID:', clientProcess.pid);
      clientProcess.unref();
      
      // Check if process is still running
      setTimeout(() => {
        try {
          process.kill(clientProcess.pid, 0);
          console.log('✓ Client process is running');
        } catch (e) {
          console.log('WARNING: Client process may have exited');
        }
      }, 1000);
      
    } catch (error) {
      console.log('ERROR launching client:', error);
      return { success: false, message: `Failed to start client: ${error.message}` };
    }

    console.log('=== LAUNCH COMPLETE ===');
    return {
      success: true,
      message: 'Game launched successfully!'
    };

  } catch (error) {
    console.error('FATAL ERROR in launch-game:', error);
    return {
      success: false,
      message: `Fatal error: ${error.message}`
    };
  }
});

ipcMain.handle('configure-game-paths', async () => {
  try {
    // Delete saved config to force re-selection
    if (fs.existsSync(gameConfigPath)) {
      fs.unlinkSync(gameConfigPath);
    }
    
    // The next launch will prompt for folder selection
    return true;
  } catch (error) {
    console.error('Error clearing game config:', error);
    return false;
  }
});

ipcMain.handle('check-game-configured', async () => {
  try {
    const config = loadGameConfig();
    if (!config.gamePath || !config.serverPath) return false;
    
    // Verify the paths still exist and have the required files
    const clientPath = path.join(config.gamePath, 'Prospect', 'Binaries', 'Win64', 'Prospect.Client.Loader.exe');
    
    return fs.existsSync(config.serverPath) && fs.existsSync(clientPath);
  } catch (error) {
    console.error('Error checking game configuration:', error);
    return false;
  }
});

// Export for testing
module.exports = { app, createWindow };