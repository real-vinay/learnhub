const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const Store = require("electron-store");
const store = new Store();
const UpdateHandler = require("./updater");
const log = require("electron-log");
let updateHandler;

log.info("App starting...");

let mainWindow;

function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false, // Allow loading local files
      },
      backgroundColor: "#121212",
      show: false,
    });

    mainWindow.loadFile("index.html");

    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    // Open DevTools in development
    if (process.argv.includes("--dev")) {
      mainWindow.webContents.openDevTools();
    }

    // Initialize updater after window creation
    updateHandler = new UpdateHandler(mainWindow);

    // Check for updates if online
    require("dns").lookup("github.com", (err) => {
      if (!err) {
        log.info("Online, checking for updates...");
        updateHandler.checkForUpdates();
      } else {
        log.warn("Offline, skipping update check");
      }
    });

    // Check for updates every 6 hours
    setInterval(() => {
      require("dns").lookup("github.com", (err) => {
        if (!err) {
          updateHandler.checkForUpdates();
        }
      });
    }, 6 * 60 * 60 * 1000);
  } catch (error) {
    log.error("Error creating window:", error);
    console.error("Error creating window:", error);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle folder selection
ipcMain.handle("select-folder", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Video Folder",
    });

    if (!result.canceled) {
      store.set("lastFolder", result.filePaths[0]);
      return result.filePaths[0];
    }
    return null;
  } catch (error) {
    console.error("Folder selection error:", error);
    throw error;
  }
});

// Handle video listing
ipcMain.handle("get-videos", async (event, folderPath) => {
  try {
    const files = await require("fs").promises.readdir(folderPath);
    const videos = files.filter((file) =>
      [".mp4", ".mkv", ".avi", ".webm"].includes(
        path.extname(file).toLowerCase()
      )
    );
    return videos;
  } catch (error) {
    console.error("Error reading folder:", error);
    throw error;
  }
});

// Add this after other ipcMain handlers
ipcMain.handle("handle-folder-drop", async (event, folderPath) => {
  try {
    // Verify if it's a valid directory
    const stats = await require("fs").promises.stat(folderPath);
    if (!stats.isDirectory()) {
      throw new Error("Not a valid folder");
    }

    store.set("lastFolder", folderPath);
    return folderPath;
  } catch (error) {
    console.error("Folder drop error:", error);
    throw error;
  }
});

// Add IPC handlers for updates
ipcMain.handle("check-for-updates", () => {
  updateHandler.checkForUpdates();
});

ipcMain.handle("download-update", () => {
  updateHandler.downloadUpdate();
});

ipcMain.handle("quit-and-install", () => {
  updateHandler.quitAndInstall();
});

// Handle any uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
