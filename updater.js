const { autoUpdater } = require("electron-updater");
const { dialog } = require("electron");
const log = require("electron-log");

// Configure logging
log.transports.file.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

class UpdateHandler {
  constructor(window) {
    this.mainWindow = window;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.setupAutoUpdater();
  }

  setupAutoUpdater() {
    // Check for updates
    autoUpdater.on("checking-for-update", () => {
      this.sendStatusToWindow("Checking for updates...");
    });

    // Update available
    autoUpdater.on("update-available", (info) => {
      this.updateAvailable = true;
      dialog
        .showMessageBox(this.mainWindow, {
          type: "info",
          title: "Update Available",
          message: `Version ${info.version} is available. Would you like to download it?`,
          buttons: ["Yes", "No"],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.downloadUpdate();
          }
        });
    });

    // Update not available
    autoUpdater.on("update-not-available", () => {
      this.sendStatusToWindow("Application is up to date.");
    });

    // Download progress
    autoUpdater.on("download-progress", (progressObj) => {
      this.sendStatusToWindow(
        `Downloading update... ${Math.round(progressObj.percent)}%`
      );
    });

    // Update downloaded
    autoUpdater.on("update-downloaded", () => {
      this.updateDownloaded = true;
      dialog
        .showMessageBox(this.mainWindow, {
          type: "info",
          title: "Update Ready",
          message: "Update downloaded. Would you like to install it now?",
          buttons: ["Install and Restart", "Later"],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.quitAndInstall(false, true);
          }
        });
    });

    // Error handling
    autoUpdater.on("error", (err) => {
      log.error("Update error:", err);
      this.handleUpdateError(err);
    });
  }

  handleUpdateError(error) {
    let message = "An error occurred while updating the application.";
    let buttons = ["OK"];
    let showRetry = false;

    if (error.code === "ENOENT") {
      message =
        "Update server is unreachable. Please check your internet connection.";
      showRetry = true;
    } else if (error.code === "ERR_UPDATER_INVALID_SIGNATURE") {
      message =
        "Update has invalid signature. Please download the application again.";
    } else if (error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND") {
      message = "No update found. You might be offline.";
      showRetry = true;
    }

    if (showRetry) {
      buttons = ["Retry", "Cancel"];
    }

    dialog
      .showMessageBox(this.mainWindow, {
        type: "error",
        title: "Update Error",
        message,
        buttons,
        defaultId: 0,
      })
      .then(({ response }) => {
        if (showRetry && response === 0) {
          this.checkForUpdates();
        }
      });
  }

  sendStatusToWindow(message) {
    this.mainWindow.webContents.send("update-status", message);
  }

  checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error("Error checking for updates:", err);
      this.handleUpdateError(err);
    });
  }

  downloadUpdate() {
    if (this.updateAvailable && !this.updateDownloaded) {
      autoUpdater.downloadUpdate().catch((err) => {
        log.error("Error downloading update:", err);
        this.handleUpdateError(err);
      });
    }
  }

  quitAndInstall() {
    if (this.updateDownloaded) {
      autoUpdater.quitAndInstall(false, true);
    }
  }
}

module.exports = UpdateHandler;
