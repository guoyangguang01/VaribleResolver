const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("programStudio", {
  isDesktop: true,
  selectFiles: () => ipcRenderer.invoke("client:select-files"),
  readFiles: (filePaths) =>
    ipcRenderer.invoke("client:read-files", filePaths),
  writeFiles: (files) => ipcRenderer.invoke("client:write-files", files),
  saveProject: (payload, options) =>
    ipcRenderer.invoke("client:save-project", payload, options),
  openProject: () => ipcRenderer.invoke("client:open-project"),
  openDefaultProject: () =>
    ipcRenderer.invoke("client:open-default-project"),
  createRunWorkspace: (projectPath) =>
    ipcRenderer.invoke("client:create-run-workspace", projectPath),
  runProgram: (request) =>
    ipcRenderer.invoke("client:run-program", request),
  setDirty: (dirty) => ipcRenderer.send("client:set-dirty", Boolean(dirty)),
  setTheme: (preference) =>
    ipcRenderer.send("client:set-theme", preference),
});
