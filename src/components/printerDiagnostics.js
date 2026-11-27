// src/components/printerDiagnostics.js
import { DOM, showModal, showToast } from '../utils/dom.js';
import { ProtocolRegistry } from '../printing/adapters/ProtocolRegistry.js';
import { PrinterProfileManager, CalibrationEngine } from '../printing/CalibrationEngine.js';
import { PrintDispatcher } from '../printing/PrintDispatcher.js';
import { PrinterManager } from '../printing/PrinterEngine.js';

export async function initPrinterDiagnostics() {
  const container = document.getElementById('printer-diagnostics-container');
  if (!container) return;

  renderDiagnosticsUI(container);
  await loadAndPopulatePrinters();
  setupEventListeners(container);
  startQueueMonitor();
}

function renderDiagnosticsUI(container) {
  container.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fadeIn">
      <!-- Left: Profile & Config -->
      <div class="space-y-6">
        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-black tracking-tight text-slate-800 dark:text-white uppercase">Printer Profiles</h3>
            <button id="refresh-printers-btn" class="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors" title="Refresh OS Printers">
              <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Select Printer (OS)</label>
              <select id="diag-printer-select" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold outline-none focus:border-slate-500 transition-all">
                <option value="">Loading printers...</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Protocol / Language</label>
                <select id="diag-protocol-select" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold outline-none focus:border-slate-500 transition-all">
                  <option value="tspl">TSPL (TSC/TVS)</option>
                  <option value="zpl">ZPL II (Zebra/Honeywell)</option>
                  <option value="sbpl">SBPL (Sato)</option>
                  <option value="driver-mediated">OS Driver Only</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Resolution (DPI)</label>
                <select id="diag-dpi-select" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold outline-none focus:border-slate-500 transition-all">
                  <option value="203">203 DPI</option>
                  <option value="300">300 DPI</option>
                  <option value="600">600 DPI</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Width (mm)</label>
                <input type="number" id="diag-width-input" value="50" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold outline-none focus:border-slate-500 transition-all">
              </div>
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Height (mm)</label>
                <input type="number" id="diag-height-input" value="25" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold outline-none focus:border-slate-500 transition-all">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Horizontal Offset (mm)</label>
                <div class="flex items-center gap-2">
                  <button class="nudge-btn p-2 bg-slate-100 dark:bg-slate-700 rounded-lg" data-target="diag-offset-x" data-val="-0.5">-</button>
                  <input type="number" id="diag-offset-x" value="0" step="0.5" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 rounded-lg font-mono text-center outline-none">
                  <button class="nudge-btn p-2 bg-slate-100 dark:bg-slate-700 rounded-lg" data-target="diag-offset-x" data-val="0.5">+</button>
                </div>
              </div>
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Vertical Offset (mm)</label>
                <div class="flex items-center gap-2">
                  <button class="nudge-btn p-2 bg-slate-100 dark:bg-slate-700 rounded-lg" data-target="diag-offset-y" data-val="-0.5">-</button>
                  <input type="number" id="diag-offset-y" value="0" step="0.5" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 rounded-lg font-mono text-center outline-none">
                  <button class="nudge-btn p-2 bg-slate-100 dark:bg-slate-700 rounded-lg" data-target="diag-offset-y" data-val="0.5">+</button>
                </div>
              </div>
            </div>

            <div class="pt-4 flex gap-3">
              <button id="diag-save-btn" class="flex-1 bg-slate-700 hover:bg-slate-800 text-white font-black py-3 rounded-xl shadow-lg transition-all active:scale-95 text-sm uppercase tracking-widest">Save Profile</button>
              <button id="diag-reset-btn" class="px-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold py-3 rounded-xl transition-all active:scale-95 text-xs uppercase tracking-widest">Reset</button>
            </div>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 class="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Preview & Test</h3>
          <div id="diag-preview-container" class="aspect-video bg-slate-100 dark:bg-slate-900 rounded-xl overflow-hidden relative border border-slate-200 dark:border-slate-700 flex items-center justify-center p-4">
            <div id="wireframe-preview" class="hidden border-2 border-dashed border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 relative shadow-inner">
               <!-- SVG components injected here -->
            </div>
            <img id="labelary-preview" class="max-w-full max-h-full object-contain hidden" />
            <div id="preview-placeholder" class="text-slate-400 text-xs font-bold text-center italic">Select a printer to generate preview</div>
          </div>

          <div class="mt-4 flex gap-3">
            <button id="diag-test-print-btn" class="flex-1 bg-slate-900 hover:bg-black text-white font-black py-3 rounded-xl shadow-lg transition-all active:scale-95 text-sm uppercase tracking-widest flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
              Print Calibration Label
            </button>
            <button id="diag-raw-toggle" class="px-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold py-3 rounded-xl text-xs uppercase tracking-widest">Show Raw</button>
          </div>

          <div id="diag-raw-commands" class="hidden mt-4 p-3 bg-black rounded-xl text-emerald-400 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto max-h-40 border border-slate-800 shadow-inner"></div>
        </div>
      </div>

      <!-- Right: Live Queue & Logs -->
      <div class="space-y-6">
        <div class="bg-slate-900 p-6 rounded-2xl shadow-xl border border-slate-800">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-lg font-black tracking-tight text-white uppercase">Live Print Queue</h3>
            <div id="queue-status-badge" class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-800 text-slate-400">Disconnected</div>
          </div>

          <div id="queue-list" class="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
            <!-- Jobs injected here -->
            <div class="text-center py-12 text-slate-600 text-xs font-bold italic">Queue is empty</div>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-800 flex justify-between gap-4">
             <button id="resume-queue-btn" class="hidden bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2 rounded-lg text-xs uppercase tracking-widest transition-all">Resume Queue</button>
             <button id="clear-history-btn" class="text-slate-500 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors ml-auto">Clear History</button>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 class="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Error Log</h3>
          <div id="diag-error-log" class="space-y-2 max-h-40 overflow-y-auto custom-scrollbar text-[11px] font-medium font-mono text-red-500">
             <!-- Errors injected here -->
             <div class="text-slate-400 italic">No recent errors</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadAndPopulatePrinters() {
  const select = document.getElementById('diag-printer-select');
  if (!select) return;

  try {
    const printers = await window.electronAPI.getPrinters();
    select.innerHTML = '<option value="">-- Choose a Printer --</option>';

    printers.forEach(p => {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name + (p.isDefault ? ' (Default)' : '');
      select.appendChild(option);
    });

    // Auto-select based on existing config
    const config = JSON.parse(localStorage.getItem('mifela_printer_config') || '{}');
    if (config.printerName) {
      select.value = config.printerName;
      await handlePrinterChange(config.printerName);
    }
  } catch (e) {
    select.innerHTML = '<option value="">Error loading printers</option>';
  }
}

async function handlePrinterChange(printerName) {
  if (!printerName) return;
  const profile = await PrinterProfileManager.getProfile(printerName);

  // Populate form
  document.getElementById('diag-protocol-select').value = profile.protocol || 'tspl';
  document.getElementById('diag-dpi-select').value = profile.dpi || '203';
  document.getElementById('diag-width-input').value = profile.labelWidth || 50;
  document.getElementById('diag-height-input').value = profile.labelHeight || 25;
  document.getElementById('diag-offset-x').value = profile.offsetX || 0;
  document.getElementById('diag-offset-y').value = profile.offsetY || 0;

  updatePreview();
}

function updatePreview() {
  const mfr = 'tsc'; // dummy for preview logic
  const protocol = document.getElementById('diag-protocol-select').value;
  const dpi = parseInt(document.getElementById('diag-dpi-select').value);
  const width = parseFloat(document.getElementById('diag-width-input').value);
  const height = parseFloat(document.getElementById('diag-height-input').value);

  const placeholder = document.getElementById('preview-placeholder');
  const wireframe = document.getElementById('wireframe-preview');
  const labelary = document.getElementById('labelary-preview');
  const rawBox = document.getElementById('diag-raw-commands');

  placeholder.classList.add('hidden');

  // Generate dummy payload
  const profile = { name: 'Preview', manufacturer: 'tsc', protocol, dpi, labelWidth: width, labelHeight: height };
  const { template, data } = CalibrationEngine.generateTestLabel(profile, { colWidth: width, height });

  let payload = '';
  try {
     const result = PrinterManager.generateCustomRawPayload(profile, template, data, 1);
     payload = result.payload;
  } catch (e) {
     payload = 'Error generating preview payload: ' + e.message;
  }

  rawBox.textContent = payload;

  if (protocol === 'zpl' && navigator.onLine) {
    wireframe.classList.add('hidden');
    labelary.classList.remove('hidden');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    // Call Labelary API
    labelary.src = `http://api.labelary.com/v1/printers/${dpi === 300 ? '12dpmm' : '8dpmm'}/labels/${width / 25.4}/${height / 25.4}/0/${encodeURIComponent(payload)}`;
    labelary.onload = () => clearTimeout(timeoutId);
    labelary.onerror = () => {
      clearTimeout(timeoutId);
      showWireframeFallback(width, height, template);
    };
  } else {
    showWireframeFallback(width, height, template);
  }
}

function showWireframeFallback(width, height, template) {
  const wireframe = document.getElementById('wireframe-preview');
  const labelary = document.getElementById('labelary-preview');

  labelary.classList.add('hidden');
  wireframe.classList.remove('hidden');

  // Scale for preview container (max width 200px)
  const scale = 200 / width;
  wireframe.style.width = (width * scale) + 'px';
  wireframe.style.height = (height * scale) + 'px';

  wireframe.innerHTML = '';
  template.elements.forEach(el => {
    const div = document.createElement('div');
    div.className = 'absolute border border-slate-200 dark:border-slate-800 bg-slate-50/30 overflow-hidden text-[6px] flex items-center justify-center';
    div.style.left = (el.x * scale) + 'px';
    div.style.top = (el.y * scale) + 'px';
    div.style.width = 'auto';
    div.textContent = el.content || (el.type === 'barcode' ? '|||||' : '...');
    wireframe.appendChild(div);
  });
}

function setupEventListeners(container) {
  document.getElementById('diag-printer-select').addEventListener('change', (e) => handlePrinterChange(e.target.value));

  ['diag-protocol-select', 'diag-dpi-select', 'diag-width-input', 'diag-height-input', 'diag-offset-x', 'diag-offset-y'].forEach(id => {
    document.getElementById(id).addEventListener('change', updatePreview);
  });

  document.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById(btn.dataset.target);
      input.value = (parseFloat(input.value) + parseFloat(btn.dataset.val)).toFixed(1);
      updatePreview();
    };
  });

  document.getElementById('diag-save-btn').onclick = async () => {
    const printerName = document.getElementById('diag-printer-select').value;
    if (!printerName) return showToast('Error', 'No printer selected', 'error');

    const profile = {
      name: printerName,
      protocol: document.getElementById('diag-protocol-select').value,
      dpi: parseInt(document.getElementById('diag-dpi-select').value),
      labelWidth: parseFloat(document.getElementById('diag-width-input').value),
      labelHeight: parseFloat(document.getElementById('diag-height-input').value),
      offsetX: parseFloat(document.getElementById('diag-offset-x').value),
      offsetY: parseFloat(document.getElementById('diag-offset-y').value),
      manufacturer: 'tsc', // Simplified
    };

    await PrinterProfileManager.saveProfile(printerName, profile);
    showToast('Success', 'Profile saved successfully', 'success');
  };

  document.getElementById('diag-test-print-btn').onclick = async () => {
    const printerName = document.getElementById('diag-printer-select').value;
    if (!printerName) return showToast('Error', 'No printer selected', 'error');

    const profile = await PrinterProfileManager.getProfile(printerName);
    try {
      await CalibrationEngine.printTestLabel(profile);
      showToast('Success', 'Test label queued', 'success');
    } catch (e) {
      logError(e.message);
      showToast('Error', 'Failed to queue test print', 'error');
    }
  };

  document.getElementById('diag-raw-toggle').onclick = () => {
    const box = document.getElementById('diag-raw-commands');
    box.classList.toggle('hidden');
  };

  document.getElementById('refresh-printers-btn').onclick = loadAndPopulatePrinters;

  document.getElementById('resume-queue-btn').onclick = () => {
    const printerId = document.getElementById('diag-printer-select').value;
    if (printerId) PrintDispatcher.resumeQueue(printerId);
  };
}

function startQueueMonitor() {
  setInterval(() => {
    const printerId = document.getElementById('diag-printer-select').value;
    if (printerId) {
      updateQueueDisplay(printerId);
    }
  }, 1000);
}

function updateQueueDisplay(printerId) {
  const status = PrintDispatcher.getQueueStatus(printerId);
  const badge = document.getElementById('queue-status-badge');
  const list = document.getElementById('queue-list');
  const resumeBtn = document.getElementById('resume-queue-btn');

  if (status.paused) {
    badge.textContent = 'Paused';
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-900 text-red-200';
    resumeBtn.classList.remove('hidden');
  } else if (status.jobs.some(j => j.state === 'dispatching')) {
    badge.textContent = 'Active';
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-700 text-slate-200';
    resumeBtn.classList.add('hidden');
  } else {
    badge.textContent = 'Idle';
    badge.className = 'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-800 text-slate-400';
    resumeBtn.classList.add('hidden');
  }

  const allJobs = [...status.jobs, ...status.history].slice(0, 10);
  if (allJobs.length === 0) {
    list.innerHTML = '<div class="text-center py-12 text-slate-600 text-xs font-bold italic">Queue is empty</div>';
    return;
  }

  list.innerHTML = allJobs.map(job => `
    <div class="p-3 rounded-xl bg-slate-800 border border-slate-700 flex justify-between items-center group">
      <div>
        <div class="text-[10px] font-black text-slate-500 uppercase tracking-tighter">${job.jobId}</div>
        <div class="text-xs font-bold text-white">${job.state.toUpperCase()} ${job.attempts > 1 ? `(Attempt ${job.attempts})` : ''}</div>
        ${job.error ? `<div class="text-[9px] text-red-400 mt-1 font-mono max-w-[150px] truncate" title="${job.error}">${job.error}</div>` : ''}
      </div>
      <div class="flex gap-2">
        ${job.state === 'failed' ? `
          <button onclick="window.retryPrintJob('${job.jobId}', '${printerId}')" class="p-1.5 bg-slate-700 rounded-lg text-white hover:bg-slate-800 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          </button>
        ` : ''}
        ${job.state === 'pending' || job.state === 'failed' ? `
          <button onclick="window.cancelPrintJob('${job.jobId}', '${printerId}')" class="p-1.5 bg-slate-700 rounded-lg text-slate-400 hover:bg-red-900 hover:text-white transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function logError(msg) {
  const log = document.getElementById('diag-error-log');
  const entry = document.createElement('div');
  entry.className = 'border-l-2 border-red-500 pl-2 py-1';
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${msg}`;
  log.prepend(entry);
  if (log.children.length > 20) log.lastElementChild.remove();
}

// Global bridges for inline onclicks
window.retryPrintJob = (jobId, printerId) => PrintDispatcher.retryJob(jobId, printerId);
window.cancelPrintJob = (jobId, printerId) => PrintDispatcher.cancelJob(jobId, printerId);
