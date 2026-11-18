// electron/printPreload.js
// Secure preload for the print worker window.
// Runs in an isolated context with nodeIntegration: false and contextIsolation: true.
// Only exposes a minimal, safe print bridge to the renderer page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printBridge', {
    // Page → Main: request actual printing via main process IPC handler
    print: async (html, options) => {
        return ipcRenderer.invoke('print:render', html, options);
    },
    // Page → Main: send the print result back to the main process
    sendResult: (result) => {
        ipcRenderer.send('print:render-result', result);
    },
    // Main → Page: register a callback to receive HTML to render
    onRenderHtml: (callback) => {
        const subscription = (_event, html, options) => callback(html, options);
        ipcRenderer.on('print:render-html', subscription);
        return () => ipcRenderer.removeListener('print:render-html', subscription);
    }
});
