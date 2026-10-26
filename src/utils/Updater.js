// src/utils/updater.js
import { DOM } from './dom.js';

export function initAutoUpdater() {
    const u = DOM.updater;
    if (!u.toast) return;

    // 1. Check if we are running inside Electron
    const isDesktop = window.electronAPI && typeof window.electronAPI.onUpdateEvent === 'function';

    if (!isDesktop) {
        console.log("Running in Web Mode. Native auto-updater disabled.");
        // *Optional: You could put PWA Service Worker update logic here for Web users!*
        return;
    }

    // 2. Helper to show the Toast
    const showToast = () => {
        u.toast.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
    };

    const hideToast = () => {
        u.toast.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none');
    };

    // 3. Listen for events from the Electron Main Process
    window.electronAPI.onUpdateEvent((event, data) => {
        switch (event) {
            case 'update-available':
                u.title.textContent = 'Update Found! 🎉';
                u.message.textContent = 'Downloading the latest version in the background...';
                u.actionBtn.classList.add('hidden');
                u.container.classList.remove('hidden');
                showToast();
                break;

            case 'download-progress':
                // data contains { percent, bytesPerSecond, transferred, total }
                if (data && data.percent) {
                    const percent = Math.round(data.percent);
                    u.progress.style.width = `${percent}%`;
                    document.getElementById('update-progress-text').textContent = `${percent}%`;
                }
                break;

            case 'update-downloaded':
                u.title.textContent = 'Ready to Install';
                u.message.textContent = 'Version ' + (data?.version || '') + ' has been downloaded. Restart the application to apply the update.';
                u.container.classList.add('hidden'); // Hide progress bar
                u.actionBtn.classList.remove('hidden'); // Show Restart button
                u.actionBtn.textContent = 'Restart & Install';
                
                // Wire up the install button to tell Electron to quit and install
                u.actionBtn.onclick = () => {
                    u.actionBtn.textContent = 'Restarting...';
                    u.actionBtn.disabled = true;
                    window.electronAPI.installUpdate();
                };
                
                showToast();
                break;

            case 'error':
                console.error('Updater Error:', data);
                u.title.textContent = 'Update Failed';
                u.message.textContent = 'Something went wrong while downloading the update.';
                u.container.classList.add('hidden');
                u.actionBtn.classList.add('hidden');
                setTimeout(hideToast, 5000);
                break;
        }
    });

    // 4. Wire up the Dismiss button
    u.dismissBtn.onclick = hideToast;
}