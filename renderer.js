const { ipcRenderer } = require("electron");
const Store = require("electron-store");
const store = new Store();
const metadata = store.get("metadata") || {};
const history = store.get("history") || [];
const MAX_HISTORY_ITEMS = 50;

let player;
let currentFolder;
let currentVideo;
let currentVideoIndex = -1;

class SubtitleCache {
  constructor() {
    this.cache = new Map();
  }

  async get(videoName, srtPath) {
    const cacheKey = `${videoName}_srt`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const vttContent = await convertSrtToVtt(srtPath);
    if (vttContent) {
      const blob = new Blob([vttContent], { type: "text/vtt" });
      const vttUrl = URL.createObjectURL(blob);
      this.cache.set(cacheKey, vttUrl);
      return vttUrl;
    }
    return null;
  }

  clear(videoName) {
    const cacheKey = `${videoName}_srt`;
    if (this.cache.has(cacheKey)) {
      URL.revokeObjectURL(this.cache.get(cacheKey));
      this.cache.delete(cacheKey);
    }
  }
}

const subtitleCache = new SubtitleCache();

function initializePlayer() {
  // Check if videojs is available
  if (typeof videojs === "undefined") {
    throw new Error("Video.js is not loaded");
  }

  player = videojs("videoPlayer", {
    controls: true,
    fluid: true,
    playbackRates: [0.5, 1, 1.25, 1.5, 2],
    userActions: {
      hotkeys: true,
    },
  });

  player.on("timeupdate", () => {
    if (currentVideo) {
      const currentTime = player.currentTime();
      store.set(`progress.${currentVideo}`, currentTime);

      // Update progress in history
      const historyIndex = history.findIndex((h) => h.name === currentVideo);
      if (historyIndex !== -1) {
        history[historyIndex].progress = currentTime;
        store.set("history", history);
      }
    }
  });
}

function setupEventListeners() {
  const selectFolderBtn = document.getElementById("selectFolder");
  if (!selectFolderBtn) {
    console.error("Select folder button not found!");
    return;
  }

  selectFolderBtn.addEventListener("click", async () => {
    try {
      cleanupSubtitleCache();
      const folderPath = await ipcRenderer.invoke("select-folder");
      if (folderPath) {
        currentFolder = folderPath;
        await loadVideoList(folderPath);
        // Save the last selected folder
        store.set("lastFolder", folderPath);
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      // Show error to user
      const videoList = document.getElementById("videoList");
      videoList.innerHTML = `<div class="alert alert-danger">Error loading folder: ${error.message}</div>`;
    }
  });

  // Search functionality
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", handleSearch);

  // Remove watch later event listener and add clear history handler
  document.getElementById("clearHistory").addEventListener("click", () => {
    if (confirm("Are you sure you want to clear your viewing history?")) {
      store.set("history", []);
      updateHistoryList();
    }
  });

  // Mini player toggle
  document
    .getElementById("toggleMiniPlayer")
    .addEventListener("click", toggleMiniPlayer);

  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyboardShortcuts);

  // Initialize autoplay from stored preference
  const autoplayToggle = document.getElementById("autoplayToggle");
  autoplayToggle.checked = store.get("autoplay", true);

  // Save autoplay preference
  autoplayToggle.addEventListener("change", (e) => {
    store.set("autoplay", e.target.checked);
  });

  // Listen for video end
  player.on("ended", handleVideoEnd);

  // Add drag and drop handlers
  setupDragAndDrop();

  // Update status handler
  ipcRenderer.on("update-status", (_, message) => {
    const updateStatus = document.getElementById("updateStatus");
    if (updateStatus) {
      updateStatus.textContent = message;
    }
  });

  // Update status handler with progress
  ipcRenderer.on("update-status", (_, data) => {
    const updateStatus = document.getElementById("updateStatus");
    const progressBar = document.getElementById("updateProgressBar");
    const progressContainer = progressBar.parentElement;

    if (updateStatus) {
      updateStatus.textContent = data.message;

      if (data.type === "progress") {
        progressContainer.classList.remove("d-none");
        progressBar.style.width = `${data.progress}%`;
      } else if (data.type === "complete") {
        progressBar.style.width = "100%";
        setTimeout(() => {
          progressContainer.classList.add("d-none");
        }, 3000);
      } else {
        progressContainer.classList.add("d-none");
      }
    }
  });
}

function setupDragAndDrop() {
  const dragOverlay = document.getElementById("dragOverlay");

  // Prevent default drag behaviors
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.add("active");
  });

  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.target === document.documentElement) {
      dragOverlay.classList.remove("active");
    }
  });

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.remove("active");

    const items = e.dataTransfer.items;
    for (let item of items) {
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry();
        if (entry.isDirectory) {
          try {
            const folderPath = item.getAsFile().path;
            const validatedPath = await ipcRenderer.invoke(
              "handle-folder-drop",
              folderPath
            );
            if (validatedPath) {
              currentFolder = validatedPath;
              await loadVideoList(validatedPath);
              store.set("lastFolder", validatedPath);
            }
          } catch (error) {
            console.error("Error handling dropped folder:", error);
          }
          break; // Only process the first folder
        }
      }
    }
  });
}

function handleSearch(e) {
  const searchTerm = e.target.value.toLowerCase();
  const videos = document.querySelectorAll(".video-item");

  videos.forEach((video) => {
    const title = video.querySelector(".video-title").textContent.toLowerCase();
    video.style.display = title.includes(searchTerm) ? "flex" : "none";
  });
}

function toggleMiniPlayer() {
  const playerContainer = document.getElementById("playerContainer");
  playerContainer.classList.toggle("mini-player");
  player.handleTechClick(); // Maintains playback
}

function handleKeyboardShortcuts(e) {
  if (document.activeElement.tagName === "INPUT") return;

  switch (e.key.toLowerCase()) {
    case " ":
      e.preventDefault();
      player.paused() ? player.play() : player.pause();
      break;
    case "m":
      player.muted(!player.muted());
      break;
    case "f":
      player.isFullscreen()
        ? player.exitFullscreen()
        : player.requestFullscreen();
      break;
    case "arrowleft":
      player.currentTime(player.currentTime() - 10);
      break;
    case "arrowright":
      player.currentTime(player.currentTime() + 10);
      break;
    case "p":
      toggleMiniPlayer();
      break;
  }
}

function updateHistoryList() {
  const historyList = document.getElementById("historyList");
  historyList.innerHTML = "";

  if (history.length === 0) {
    historyList.innerHTML =
      '<div class="text-muted text-center p-3">No viewing history</div>';
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "video-item";

    const info = document.createElement("div");
    info.className = "video-info";

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = entry.name;

    const meta = document.createElement("div");
    meta.className = "video-meta";
    meta.innerHTML = `
      <span>Last watched: ${new Date(
        entry.timestamp
      ).toLocaleDateString()}</span>
      <span class="mx-2">•</span>
      <span>Stopped at: ${formatDuration(entry.progress)}</span>
    `;

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    item.addEventListener("click", () => {
      if (entry.folder === currentFolder) {
        loadVideo(entry.name);
      } else {
        // If video is from a different folder, try to load it
        currentFolder = entry.folder;
        store.set("lastFolder", entry.folder);
        loadVideoList(entry.folder).then(() => loadVideo(entry.name));
      }
    });

    historyList.appendChild(item);
  });
}

async function generateThumbnail(videoPath) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = videoPath;
    video.crossOrigin = "anonymous";
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      // Try to seek to 25% of the video
      video.currentTime = video.duration * 0.25;
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
      video.remove();
    };

    video.onerror = () => {
      resolve(null);
      video.remove();
    };
  });
}

async function convertSrtToVtt(srtPath) {
  try {
    const srtContent = await ipcRenderer.invoke("read-subtitle-file", srtPath);
    if (!srtContent) return null;

    // Add WebVTT header
    let vttContent = "WEBVTT\n\n";

    // Convert SRT content to VTT format
    vttContent += srtContent
      .replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, "$1:$2:$3.$4")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    return vttContent;
  } catch (error) {
    console.error("Error converting SRT to VTT:", error);
    return null;
  }
}

async function loadVideoList(folderPath) {
  try {
    const videos = await ipcRenderer.invoke("get-videos", folderPath);
    const videoList = document.getElementById("videoList");
    videoList.innerHTML = "";

    if (videos.length === 0) {
      videoList.innerHTML =
        '<div class="alert alert-info">No video files found in this folder</div>';
      return;
    }

    // Preload subtitles for all videos
    videos.forEach(async (video) => {
      const baseFilename = video.replace(/\.[^/.]+$/, "");
      const srtPath = `${folderPath}/${baseFilename}.srt`;

      // Check if SRT exists and preload it
      const srtExists = await ipcRenderer.invoke("check-file-exists", srtPath);
      if (srtExists) {
        subtitleCache.get(video, srtPath); // Start conversion in background
      }
    });

    // Create and append video items
    for (const video of videos) {
      const item = document.createElement("div");
      item.className = "video-item";

      const thumbnail = document.createElement("div");
      thumbnail.className = "video-thumbnail";

      // Add loading animation
      const loading = document.createElement("div");
      loading.className = "thumbnail-loading";
      thumbnail.appendChild(loading);

      const info = document.createElement("div");
      info.className = "video-info";

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = video;

      const meta = document.createElement("div");
      meta.className = "video-meta";
      const videoMeta = metadata[video] || {};
      meta.textContent = videoMeta.lastPlayed
        ? `Last played: ${new Date(videoMeta.lastPlayed).toLocaleDateString()}`
        : "Never played";

      info.appendChild(title);
      info.appendChild(meta);
      item.appendChild(thumbnail);
      item.appendChild(info);
      item.addEventListener("click", () => loadVideo(video));
      videoList.appendChild(item);

      // Generate and set thumbnail
      const videoPath = `file://${folderPath}/${video}`;
      const thumbnailUrl = await generateThumbnail(videoPath);
      if (thumbnailUrl) {
        const img = document.createElement("img");
        img.src = thumbnailUrl;
        img.onload = () => {
          thumbnail.innerHTML = "";
          thumbnail.appendChild(img);
        };
      }
    }
  } catch (error) {
    console.error("Error loading video list:", error);
    throw error;
  }
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function updateVideoInfo(videoName) {
  try {
    const progress = store.get(`progress.${videoName}`) || 0;
    const videoMeta = metadata[videoName] || {};
    const info = document.getElementById("videoInfo");
    document.getElementById("currentVideoTitle").textContent = videoName;

    const duration = player.duration() || 0;
    const formattedDuration = formatDuration(duration);
    const formattedProgress = formatDuration(progress);

    info.innerHTML = `
      <span>${formattedProgress} watched</span>
      <span class="mx-2">&bull;</span>
      <span>Duration: ${formattedDuration}</span>
      <span class="mx-2">&bull;</span>
      <span>${
        videoMeta.subtitlesAvailable ? "Subtitles available" : "No subtitles"
      }</span>
    `;
  } catch (error) {
    console.error("Error updating video info:", error);
  }
}

async function loadLastSession() {
  try {
    const lastFolder = store.get("lastFolder");
    if (lastFolder) {
      currentFolder = lastFolder;
      await loadVideoList(lastFolder);
      updateHistoryList(); // Add this line
    }
  } catch (error) {
    console.error("Error loading last session:", error);
  }
}

function handleVideoEnd() {
  if (!store.get("autoplay", true)) return;
  playNextVideo();
}

function playNextVideo() {
  const videos = Array.from(
    document.querySelectorAll("#videoList .video-item")
  );
  if (currentVideoIndex === -1) {
    currentVideoIndex = videos.findIndex(
      (item) => item.querySelector(".video-title").textContent === currentVideo
    );
  }

  const nextIndex = currentVideoIndex + 1;
  if (nextIndex < videos.length) {
    currentVideoIndex = nextIndex;
    const nextVideo =
      videos[nextIndex].querySelector(".video-title").textContent;
    loadVideo(nextVideo);
  } else {
    // Reset to first video if at the end
    currentVideoIndex = 0;
    const firstVideo = videos[0].querySelector(".video-title").textContent;
    loadVideo(firstVideo);
  }
}

async function loadVideo(videoName) {
  try {
    currentVideo = videoName;
    const videoPath = `file://${currentFolder}/${videoName}`;

    // Update current video index
    const videos = Array.from(
      document.querySelectorAll("#videoList .video-item")
    );
    currentVideoIndex = videos.findIndex(
      (item) => item.querySelector(".video-title").textContent === videoName
    );

    // Update metadata
    if (!metadata[videoName]) {
      metadata[videoName] = {
        lastPlayed: Date.now(),
        progress: 0,
        subtitlesAvailable: false,
      };
      store.set("metadata", metadata);
    }

    // Configure video source with error handling
    player.src({
      type: getVideoType(videoName),
      src: videoPath,
    });

    // Handle subtitles
    const baseFilename = videoName.replace(/\.[^/.]+$/, "");
    const vttPath = `${currentFolder}/${baseFilename}.vtt`;
    const srtPath = `${currentFolder}/${baseFilename}.srt`;

    // Remove existing tracks
    while (player.remoteTextTracks().length > 0) {
      player.removeRemoteTextTrack(player.remoteTextTracks()[0]);
    }

    // Use Promise.race to get the fastest available subtitle source
    const [vttResponse, srtExists] = await Promise.all([
      fetch(vttPath.replace("file://", "")).catch(() => null),
      ipcRenderer.invoke("check-file-exists", srtPath),
    ]);

    if (vttResponse && vttResponse.ok) {
      // VTT file exists, use it directly
      player.addRemoteTextTrack(
        {
          kind: "subtitles",
          src: `file://${vttPath}`,
          srclang: "en",
          label: "English",
          default: true,
        },
        false
      );
      metadata[videoName].subtitlesAvailable = true;
    } else if (srtExists) {
      // Try to get cached VTT first
      const cachedVttUrl = await subtitleCache.get(videoName, srtPath);
      if (cachedVttUrl) {
        player.addRemoteTextTrack(
          {
            kind: "subtitles",
            src: cachedVttUrl,
            srclang: "en",
            label: "English",
            default: true,
          },
          false
        );
        metadata[videoName].subtitlesAvailable = true;
      }
    } else {
      metadata[videoName].subtitlesAvailable = false;
    }

    store.set("metadata", metadata);
    updateVideoInfo(videoName);

    // Add error handling for video loading
    player.on("error", function (e) {
      console.error("Video loading error:", player.error());
      const videoList = document.getElementById("videoList");
      videoList.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">Error loading video: ${videoName}</div>`
      );
    });

    // Restore progress if exists
    const savedProgress = store.get(`progress.${videoName}`);
    if (savedProgress) {
      player.currentTime(savedProgress);
    }

    // Update metadata
    metadata[videoName].lastPlayed = Date.now();
    store.set("metadata", metadata);

    // Add to history
    const historyEntry = {
      name: videoName,
      folder: currentFolder,
      timestamp: Date.now(),
      progress: store.get(`progress.${videoName}`) || 0,
    };

    const index = history.findIndex(
      (h) => h.name === videoName && h.folder === currentFolder
    );
    if (index !== -1) {
      history.splice(index, 1);
    }
    history.unshift(historyEntry);

    // Keep only last MAX_HISTORY_ITEMS items
    if (history.length > MAX_HISTORY_ITEMS) {
      history.pop();
    }

    store.set("history", history);
    updateHistoryList();

    // Update the info display after the video has loaded metadata
    player.one("loadedmetadata", () => {
      updateVideoInfo(videoName);
    });

    // Start playing
    player.play().catch((error) => {
      console.log("Autoplay prevented:", error);
    });
  } catch (error) {
    console.error("Error in loadVideo:", error);
  }
}

// Add helper function to determine video type
function getVideoType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const types = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
  };
  return types[ext] || "video/mp4";
}

function cleanupSubtitleCache() {
  const videos = Array.from(
    document.querySelectorAll("#videoList .video-item")
  ).map((item) => item.querySelector(".video-title").textContent);

  videos.forEach((video) => subtitleCache.clear(video));
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    initializePlayer();
    setupEventListeners();
    loadLastSession();
  } catch (error) {
    console.error("Initialization error:", error);
  }
});
