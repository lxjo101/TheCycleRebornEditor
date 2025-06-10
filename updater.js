// updater.js - Auto-updater module
const { dialog, shell, app } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AutoUpdater {
    constructor(options = {}) {
        this.githubOwner = options.githubOwner || 'lxjo101';
        this.githubRepo = options.githubRepo || 'TheCycleRebornEditor';
        this.currentVersion = app.getVersion();
        this.updateCheckUrl = `https://api.github.com/repos/${this.githubOwner}/${this.githubRepo}/releases/latest`;
        this.downloadDir = path.join(app.getPath('temp'), 'app-updates');
        this.isUpdating = false;
    }

    // Check for updates on startup
    async checkForUpdates(showNoUpdateDialog = false) {
        if (this.isUpdating) return;

        try {
            console.log('Checking for updates...');
            const latestRelease = await this.getLatestRelease();
            
            if (!latestRelease) {
                if (showNoUpdateDialog) {
                    this.showNoUpdateDialog();
                }
                return;
            }

            const isNewVersion = this.compareVersions(latestRelease.tag_name, this.currentVersion);
            
            if (isNewVersion) {
                await this.promptUpdate(latestRelease);
            } else if (showNoUpdateDialog) {
                this.showNoUpdateDialog();
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            if (showNoUpdateDialog) {
                this.showUpdateError(error.message);
            }
        }
    }

    // Get latest release from GitHub API
    getLatestRelease() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.githubOwner}/${this.githubRepo}/releases/latest`,
                method: 'GET',
                headers: {
                    'User-Agent': 'TheCycleRebornSaveEditor-AutoUpdater',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const release = JSON.parse(data);
                            resolve(release);
                        } else if (res.statusCode === 404) {
                            console.log('No releases found');
                            resolve(null);
                        } else {
                            reject(new Error(`GitHub API returned status ${res.statusCode}`));
                        }
                    } catch (error) {
                        reject(new Error('Failed to parse GitHub API response'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Network error: ${error.message}`));
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    // Compare version strings (returns true if newVersion is newer)
    compareVersions(newVersion, currentVersion) {
        // Remove 'v' prefix if present
        const cleanNew = newVersion.replace(/^v/, '');
        const cleanCurrent = currentVersion.replace(/^v/, '');

        const newParts = cleanNew.split('.').map(num => parseInt(num, 10));
        const currentParts = cleanCurrent.split('.').map(num => parseInt(num, 10));

        // Ensure both arrays have same length
        const maxLength = Math.max(newParts.length, currentParts.length);
        while (newParts.length < maxLength) newParts.push(0);
        while (currentParts.length < maxLength) currentParts.push(0);

        for (let i = 0; i < maxLength; i++) {
            if (newParts[i] > currentParts[i]) return true;
            if (newParts[i] < currentParts[i]) return false;
        }

        return false; // Versions are equal
    }

    // Show update prompt dialog
    async promptUpdate(release) {
        const response = await dialog.showMessageBox(null, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (${release.tag_name}) is available!`,
            detail: `Current version: ${this.currentVersion}\nNew version: ${release.tag_name}\n\n${release.body || 'Click "Update Now" to download and install the latest version.'}`,
            buttons: ['Update Now', 'Skip This Version', 'Remind Me Later'],
            defaultId: 0,
            cancelId: 2
        });

        switch (response.response) {
            case 0: // Update Now
                await this.downloadAndInstallUpdate(release);
                break;
            case 1: // Skip This Version
                this.skipVersion(release.tag_name);
                break;
            case 2: // Remind Me Later
                // Do nothing, will check again next startup
                break;
        }
    }

    // Download and install update
    async downloadAndInstallUpdate(release) {
        this.isUpdating = true;

        try {
            // Find the correct asset (portable exe for Windows)
            const asset = this.findUpdateAsset(release.assets);
            
            if (!asset) {
                throw new Error('No compatible update file found for your platform');
            }

            // Show download progress dialog
            const progressDialog = this.showDownloadDialog();

            // Create download directory
            if (!fs.existsSync(this.downloadDir)) {
                fs.mkdirSync(this.downloadDir, { recursive: true });
            }

            const downloadPath = path.join(this.downloadDir, asset.name);

            // Download the update
            await this.downloadFile(asset.browser_download_url, downloadPath, (progress) => {
                // Update progress if needed (for future enhancement)
                console.log(`Download progress: ${progress}%`);
            });

            progressDialog.close();

            // Show installation confirmation
            const installResponse = await dialog.showMessageBox(null, {
                type: 'question',
                title: 'Install Update',
                message: 'Download completed! Install update now?',
                detail: 'The application will close and the new version will start automatically.',
                buttons: ['Install Now', 'Install Later'],
                defaultId: 0
            });

            if (installResponse.response === 0) {
                await this.installUpdate(downloadPath);
            }

        } catch (error) {
            console.error('Update error:', error);
            dialog.showErrorBox('Update Failed', `Failed to update: ${error.message}`);
        } finally {
            this.isUpdating = false;
        }
    }

    // Find the appropriate asset for the current platform
    findUpdateAsset(assets) {
        if (process.platform === 'win32') {
            // Look for portable exe file
            return assets.find(asset => 
                asset.name.includes('.exe') && 
                (asset.name.includes('portable') || asset.name.includes('Portable'))
            ) || assets.find(asset => asset.name.includes('.exe'));
        } else if (process.platform === 'darwin') {
            // Look for macOS dmg or app
            return assets.find(asset => 
                asset.name.includes('.dmg') || asset.name.includes('.app')
            );
        } else if (process.platform === 'linux') {
            // Look for AppImage or deb
            return assets.find(asset => 
                asset.name.includes('.AppImage') || 
                asset.name.includes('.deb') || 
                asset.name.includes('.tar.gz')
            );
        }
        
        return null;
    }

    // Download file with progress
    downloadFile(url, outputPath, progressCallback) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(outputPath);
            let downloadedBytes = 0;
            let totalBytes = 0;

            const request = https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode === 302 || response.statusCode === 301) {
                    return this.downloadFile(response.headers.location, outputPath, progressCallback)
                        .then(resolve)
                        .catch(reject);
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }

                totalBytes = parseInt(response.headers['content-length'], 10);

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    file.write(chunk);
                    
                    if (progressCallback && totalBytes > 0) {
                        const progress = Math.round((downloadedBytes / totalBytes) * 100);
                        progressCallback(progress);
                    }
                });

                response.on('end', () => {
                    file.end();
                    resolve();
                });

                response.on('error', (error) => {
                    file.destroy();
                    fs.unlink(outputPath, () => {}); // Clean up partial file
                    reject(error);
                });
            });

            request.on('error', (error) => {
                file.destroy();
                fs.unlink(outputPath, () => {}); // Clean up partial file
                reject(error);
            });

            request.setTimeout(30000, () => {
                request.destroy();
                file.destroy();
                fs.unlink(outputPath, () => {});
                reject(new Error('Download timeout'));
            });
        });
    }

    // Install the update
    async installUpdate(updatePath) {
        try {
            const currentExePath = process.execPath;
            const backupPath = currentExePath + '.backup';
            const newExePath = currentExePath + '.new';

            // Copy new version to .new file
            fs.copyFileSync(updatePath, newExePath);

            // Create batch script for Windows to handle the replacement
            if (process.platform === 'win32') {
                const batchScript = this.createWindowsUpdateScript(currentExePath, newExePath, backupPath);
                const batchPath = path.join(this.downloadDir, 'update.bat');
                fs.writeFileSync(batchPath, batchScript);

                // Execute the batch script and quit
                spawn('cmd.exe', ['/c', batchPath], {
                    detached: true,
                    stdio: 'ignore'
                });

                app.quit();
            } else {
                // For macOS/Linux, use shell script
                const shellScript = this.createUnixUpdateScript(currentExePath, newExePath, backupPath);
                const scriptPath = path.join(this.downloadDir, 'update.sh');
                fs.writeFileSync(scriptPath, shellScript);
                fs.chmodSync(scriptPath, '755');

                spawn('sh', [scriptPath], {
                    detached: true,
                    stdio: 'ignore'
                });

                app.quit();
            }
        } catch (error) {
            throw new Error(`Failed to install update: ${error.message}`);
        }
    }

    // Create Windows batch script for update
    createWindowsUpdateScript(currentPath, newPath, backupPath) {
        return `@echo off
timeout /t 2 /nobreak > nul
move "${currentPath}" "${backupPath}"
move "${newPath}" "${currentPath}"
start "" "${currentPath}"
timeout /t 2 /nobreak > nul
del "${backupPath}"
del "%~f0"`;
    }

    // Create Unix shell script for update
    createUnixUpdateScript(currentPath, newPath, backupPath) {
        return `#!/bin/sh
sleep 2
mv "${currentPath}" "${backupPath}"
mv "${newPath}" "${currentPath}"
chmod +x "${currentPath}"
"${currentPath}" &
sleep 2
rm -f "${backupPath}"
rm -f "$0"`;
    }

    // Show download progress dialog
    showDownloadDialog() {
        const progressWindow = new (require('electron').BrowserWindow)({
            width: 400,
            height: 150,
            resizable: false,
            minimizable: false,
            maximizable: false,
            modal: true,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        progressWindow.loadURL(`data:text/html;charset=utf-8,
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        padding: 20px; 
                        text-align: center;
                        background: #2d3748;
                        color: #e0e0e0;
                        margin: 0;
                    }
                    .progress-bar {
                        width: 100%;
                        height: 20px;
                        background: #4a5568;
                        border-radius: 10px;
                        overflow: hidden;
                        margin: 20px 0;
                    }
                    .progress-fill {
                        height: 100%;
                        background: linear-gradient(135deg, #64ffda 0%, #4fd1c7 100%);
                        width: 0%;
                        transition: width 0.3s ease;
                        border-radius: 10px;
                    }
                </style>
            </head>
            <body>
                <h2>Downloading Update...</h2>
                <div class="progress-bar">
                    <div class="progress-fill" id="progress"></div>
                </div>
                <p>Please wait while the update is downloaded.</p>
            </body>
            </html>
        `);

        progressWindow.show();
        return progressWindow;
    }

    // Skip version functionality
    skipVersion(version) {
        // Could store skipped versions in app settings/config
        console.log(`Skipping version ${version}`);
    }

    // Show no update dialog
    showNoUpdateDialog() {
        dialog.showMessageBox(null, {
            type: 'info',
            title: 'No Updates Available',
            message: 'You are running the latest version!',
            detail: `Current version: ${this.currentVersion}`,
            buttons: ['OK']
        });
    }

    // Show update error dialog
    showUpdateError(message) {
        dialog.showErrorBox('Update Check Failed', `Could not check for updates: ${message}`);
    }

    // Manual update check (for menu item)
    async checkForUpdatesManually() {
        await this.checkForUpdates(true);
    }
}

module.exports = AutoUpdater;