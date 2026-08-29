const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("readerApi", {
  chooseBook: () => ipcRenderer.invoke("reader:choose-book"),
  openDroppedBook: (file) => ipcRenderer.invoke("reader:open-dropped-book", webUtils.getPathForFile(file)),
  readTextBook: (resourceId) => ipcRenderer.invoke("reader:read-text-book", resourceId),
  closeBook: (resourceId) => ipcRenderer.invoke("reader:close-book", resourceId),
  startupBook: () => ipcRenderer.invoke("reader:startup-book"),
  onOpenBook: (callback) => {
    const listener = (_event, manifest) => callback(manifest);
    ipcRenderer.on("reader:open-book", listener);
    return () => ipcRenderer.removeListener("reader:open-book", listener);
  },
  toggleFullscreen: () => ipcRenderer.invoke("reader:toggle-fullscreen"),
  reportRefreshRate: (rate) => ipcRenderer.send("reader:refresh-rate", rate),
  reportBookOpened: (kind, title) => ipcRenderer.send("reader:book-opened", kind, title),
  reportError: (detail) => ipcRenderer.send("reader:renderer-error", detail),
});
