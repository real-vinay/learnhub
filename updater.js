const { autoUpdater } = require("electron-updater");
const { dialog, app } = require("electron"); // Add app import here
const log = require("electron-log");

// Configure logging with more details
log.transports.file.level = "debug";
log.transports.console.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = true; // Allow installing older versions if needed

class UpdateHandler {
  constructor(window) {
    this.mainWindow = window;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.progressDialog = null;
    this.setupAutoUpdater();
    log.info("Current app version:", app.getVersion());
  }

  setupAutoUpdater() {
    // Log important auto-updater events
    autoUpdater.on("checking-for-update", () => {
      log.info("Checking for updates...");
      this.sendStatusToWindow({
        message: "Checking for updates...",
        type: "status",
      });
    });

    autoUpdater.on("update-available", (info) => {
      log.info("Update available:", info);
      this.updateAvailable = true;
      dialog
        .showMessageBox(this.mainWindow, {
          type: "info",
          title: "Update Available",
          message: `Version ${
            info.version
          } is available. Current version: ${app.getVersion()}`,
          detail: "Would you like to download and install it now?",
          buttons: ["Yes", "No"],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) {
            this.sendStatusToWindow("Starting download...");
            autoUpdater.downloadUpdate();
          }
        });
    });

    autoUpdater.on("update-not-available", () => {
      log.info("No updates available");
      this.sendStatusToWindow({
        message: "You are using the latest version.",
        type: "status",
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      const percent = Math.round(progressObj.percent);
      log.info(`Download progress: ${percent}%`);

      if (!this.progressDialog) {
        this.progressDialog = dialog.showMessageBox(this.mainWindow, {
          type: "info",
          title: "Downloading Update",
          message: "Downloading update...",
          detail: `Downloaded ${percent}% (${Math.round(
            progressObj.transferred / 1024 / 1024
          )}MB of ${Math.round(progressObj.total / 1024 / 1024)}MB)`,
          buttons: ["Hide"],
          noLink: true,
          cancelId: 0,
        });
      } else {
        // Update existing dialog
        dialog.showMessageBox(this.mainWindow, {
          type: "info",
          title: "Downloading Update",
          message: "Downloading update...",
          detail: `Downloaded ${percent}% (${Math.round(
            progressObj.transferred / 1024 / 1024
          )}MB of ${Math.round(progressObj.total / 1024 / 1024)}MB)`,
          buttons: ["Hide"],
          noLink: true,
          cancelId: 0,
        });
      }

      // Update taskbar progress
      this.mainWindow.setProgressBar(progressObj.percent / 100);
    });

    autoUpdater.on("update-downloaded", () => {
      log.info("Update downloaded");
      this.updateDownloaded = true;
      this.mainWindow.setProgressBar(-1); // Remove progress bar
      this.sendStatusToWindow({
        message: "Update ready to install",
        progress: 100,
        type: "complete",
      });

      if (this.progressDialog) {
        this.progressDialog = null;
      }

      dialog
        .showMessageBox(this.mainWindow, {
          type: "info",
          title: "Update Ready",
          message:
            "Update downloaded. The application will restart to install.",
          detail: "Click OK to restart and install the update.",
          buttons: ["Install Now", "Later"],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) {
            log.info("Quitting and installing...");
            setImmediate(() => {
              app.removeAllListeners("window-all-closed");
              autoUpdater.quitAndInstall(false, true);
            });
          }
        });
    });

    autoUpdater.on("error", (err) => {
      log.error("Update error:", err);
      this.handleUpdateError(err);
    });
  }

  handleUpdateError(error) {
    log.error("Update error details:", error);
    let message = "An error occurred while updating the application.";
    let detail = error.message || "Unknown error";
    let buttons = ["OK"];
    let showRetry = false;

    if (error.code === "ENOENT") {
      message = "Update server is unreachable.";
      detail = "Please check your internet connection.";
      showRetry = true;
    } else if (error.code === "ERR_UPDATER_INVALID_SIGNATURE") {
      message = "Update has invalid signature.";
      detail = "Please download the application again from official source.";
    } else if (error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND") {
      message = "No update found.";
      detail = "You might be offline or the update was removed.";
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
        detail,
        buttons,
        defaultId: 0,
      })
      .then(({ response }) => {
        if (showRetry && response === 0) {
          this.checkForUpdates();
        }
      });
  }

  sendStatusToWindow(data) {
    log.info("Status:", data);
    this.mainWindow.webContents.send("update-status", data);
  }

  checkForUpdates() {
    try {
      log.info("Manually checking for updates...");
      autoUpdater.checkForUpdates();
    } catch (err) {
      log.error("Error initiating update check:", err);
      this.handleUpdateError(err);
    }
  }

  downloadUpdate() {
    if (this.updateAvailable && !this.updateDownloaded) {
      log.info("Starting update download...");
      autoUpdater.downloadUpdate().catch((err) => {
        log.error("Error downloading update:", err);
        this.handleUpdateError(err);
      });
    }
  }

  quitAndInstall() {
    if (this.updateDownloaded) {
      log.info("Quitting and installing update...");
      autoUpdater.quitAndInstall(false, true);
    }
  }
}

module.exports = UpdateHandler;
