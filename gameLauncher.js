const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');

class GameLauncher {
    constructor() {
        this.configPath = path.join(__dirname, 'gameConfig.json');
        this.config = this.loadConfig();
        this.serverProcess = null;
        this.clientProcess = null;
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading game config:', error);
        }
        return {
            serverPath: null,
            clientPath: null
        };
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Error saving game config:', error);
        }
    }

    async findGameFiles() {
        const commonPaths = [
            // Steam default locations
            'C:\\Program Files (x86)\\Steam\\steamapps\\common\\The Cycle Frontier',
            'C:\\Program Files\\Steam\\steamapps\\common\\The Cycle Frontier',
            // Epic Games default location
            'C:\\Program Files\\Epic Games\\The Cycle Frontier',
            // Custom steam library locations (you might need to expand this)
            'D:\\SteamLibrary\\steamapps\\common\\The Cycle Frontier',
            'E:\\SteamLibrary\\steamapps\\common\\The Cycle Frontier'
        ];

        for (const basePath of commonPaths) {
            const serverPath = path.join(basePath, 'Prospect.Server.Api.exe');
            const clientPath = path.join(basePath, 'Prospect.Client.Loader.exe');

            if (fs.existsSync(serverPath) && fs.existsSync(clientPath)) {
                console.log(`Found game files at: ${basePath}`);
                return {
                    serverPath,
                    clientPath
                };
            }
        }

        return null;
    }

    async selectFileDialog(title, fileName) {
        const result = await dialog.showOpenDialog({
            title: title,
            defaultPath: 'C:\\',
            filters: [
                { name: 'Executable Files', extensions: ['exe'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const selectedPath = result.filePaths[0];
            
            // Verify it's the correct file
            if (path.basename(selectedPath).toLowerCase() === fileName.toLowerCase()) {
                return selectedPath;
            } else {
                throw new Error(`Please select the correct file: ${fileName}`);
            }
        }

        return null;
    }

    async setupGamePaths() {
        // First try to find automatically
        const foundPaths = await this.findGameFiles();
        
        if (foundPaths) {
            this.config.serverPath = foundPaths.serverPath;
            this.config.clientPath = foundPaths.clientPath;
            this.saveConfig();
            return true;
        }

        // If not found, ask user to select files
        try {
            console.log('Game files not found automatically, requesting user selection...');
            
            // Select server file
            const serverPath = await this.selectFileDialog(
                'Select Prospect.Server.Api.exe',
                'Prospect.Server.Api.exe'
            );
            
            if (!serverPath) {
                throw new Error('Server executable not selected');
            }

            // Select client file
            const clientPath = await this.selectFileDialog(
                'Select Prospect.Client.Loader.exe', 
                'Prospect.Client.Loader.exe'
            );

            if (!clientPath) {
                throw new Error('Client executable not selected');
            }

            // Save the paths
            this.config.serverPath = serverPath;
            this.config.clientPath = clientPath;
            this.saveConfig();

            console.log('Game paths configured successfully');
            return true;

        } catch (error) {
            console.error('Error setting up game paths:', error);
            return false;
        }
    }

    async verifyGamePaths() {
        if (!this.config.serverPath || !this.config.clientPath) {
            return false;
        }

        const serverExists = fs.existsSync(this.config.serverPath);
        const clientExists = fs.existsSync(this.config.clientPath);

        if (!serverExists || !clientExists) {
            console.log('Saved game paths no longer valid, need to reconfigure');
            this.config.serverPath = null;
            this.config.clientPath = null;
            this.saveConfig();
            return false;
        }

        return true;
    }

    async launchGame() {
        try {
            // Verify paths exist, if not try to set them up
            const pathsValid = await this.verifyGamePaths();
            
            if (!pathsValid) {
                const setupSuccess = await this.setupGamePaths();
                if (!setupSuccess) {
                    throw new Error('Failed to configure game paths');
                }
            }
        
            // Launch Steam first
            console.log('Launching Steam...');
            await this.launchSteam();
        
            // Launch server
            console.log('Starting game server...');
            this.serverProcess = spawn(this.config.serverPath, [], {
                detached: true,
                stdio: 'ignore'
            });
        
            // Launch client
            console.log('Starting game client...');
            this.clientProcess = spawn(this.config.clientPath, [], {
                detached: true,
                stdio: 'ignore'
            });
        
            // Don't keep references to prevent hanging
            this.serverProcess.unref();
            this.clientProcess.unref();
        
            return {
                success: true,
                message: 'Steam and game launched successfully!'
            };
        
        } catch (error) {
            console.error('Error launching game:', error);
            return {
                success: false,
                message: `Failed to launch game: ${error.message}`
            };
        }
    }
    
    async findSteamPath() {
    const commonPaths = [
        'C:\\Program Files (x86)\\Steam\\steam.exe',
        'C:\\Program Files\\Steam\\steam.exe',
        'D:\\Steam\\steam.exe',
        'E:\\Steam\\steam.exe',
        'F:\\Steam\\steam.exe'
    ];

    for (const steamPath of commonPaths) {
        if (fs.existsSync(steamPath)) {
            console.log(`Found Steam at: ${steamPath}`);
            return steamPath;
        }
    }

    // Try to find Steam through registry (Windows)
    try {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
            exec('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', (error, stdout) => {
                if (!error && stdout) {
                    const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
                    if (match) {
                        const steamPath = path.join(match[1].trim(), 'steam.exe');
                        if (fs.existsSync(steamPath)) {
                            console.log(`Found Steam via registry: ${steamPath}`);
                            resolve(steamPath);
                            return;
                        }
                    }
                }
                console.log('Steam not found automatically');
                resolve(null);
            });
        });
    } catch (error) {
        console.log('Registry search failed');
        return null;
    }
    }

        async launchSteam() {
            const steamPath = await this.findSteamPath();
            
            if (steamPath) {
                console.log('Starting Steam...');
                const steamProcess = spawn(steamPath, [], {
                    detached: true,
                    stdio: 'ignore'
                });
                steamProcess.unref();
                return true;
            } else {
                console.log('Steam not found, skipping...');
                return false;
            }
        }

    async checkGameRunning() {
        // This is a simple check - you might want to make it more robust
        try {
            const { exec } = require('child_process');
            
            return new Promise((resolve) => {
                exec('tasklist /FI "IMAGENAME eq Prospect.Client.Loader.exe"', (error, stdout) => {
                    if (error) {
                        resolve(false);
                        return;
                    }
                    resolve(stdout.includes('Prospect.Client.Loader.exe'));
                });
            });
        } catch (error) {
            console.error('Error checking if game is running:', error);
            return false;
        }
    }

    isConfigured() {
        return this.config.serverPath && this.config.clientPath && 
               fs.existsSync(this.config.serverPath) && fs.existsSync(this.config.clientPath);
    }
}

module.exports = GameLauncher;