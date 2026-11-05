const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("programStudio", {
  isDesktop: true,
  selectFiles: () => ipcRenderer.invoke("client:select-files"),
  readFiles: (filePaths) =>
    ipcRenderer.invoke("client:read-files", filePaths),
  writeFiles: (files) => ipcRenderer.invoke("client:write-files", files),
  saveProject: (payload) =>
    ipcRenderer.invoke("client:save-project", payload),
  openProject: () => ipcRenderer.invoke("client:open-project"),
  runProgram: (request) =>
    ipcRenderer.invoke("client:run-program", request),
});
