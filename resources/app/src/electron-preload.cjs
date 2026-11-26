const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("mtopb", {
    onBuildEvent(callback) {
        ipcRenderer.on("build-event", (_event, payload) => callback(payload));
    },
    onFileDrop(callback) {
        window.addEventListener("drop", event => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files ?? []);
            const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean);
            const target = event.target.closest?.("[data-drop-target]")?.dataset.dropTarget;
            if (target) callback({ paths, target });
        });
    },
    selectMarkdown() {
        return ipcRenderer.invoke("select-markdown");
    },
    addMarkdown(files) {
        return ipcRenderer.invoke("add-markdown", files);
    },
    removeMarkdown(file) {
        return ipcRenderer.invoke("remove-markdown", file);
    },
    clearMarkdown() {
        return ipcRenderer.invoke("clear-markdown");
    },
    openLog() {
        return ipcRenderer.invoke("open-log");
    },
    openPdf() {
        return ipcRenderer.invoke("open-pdf");
    },
    openExternalLink(url) {
        return ipcRenderer.invoke("open-external-link", url);
    },
    checkUpdates() {
        return ipcRenderer.invoke("check-updates");
    },

    getConfig() {
        return ipcRenderer.invoke("get-config");
    },
    saveConfig(config) {
        return ipcRenderer.invoke("save-config", config);
    },
    selectCoverImage() {
        return ipcRenderer.invoke("select-cover-image");
    },
    getCoverImage(value) {
        return ipcRenderer.invoke("get-cover-image", value);
    },
    selectCoverPdf() {
        return ipcRenderer.invoke("select-cover-pdf");
    },
    validateCoverPdf(value) {
        return ipcRenderer.invoke("validate-cover-pdf", value);
    },
    getCoverPdfPreview(value) {
        return ipcRenderer.invoke("get-cover-pdf-preview", value);
    },
    startBuild(config) {
        return ipcRenderer.invoke("start-build", config);
    }
});
