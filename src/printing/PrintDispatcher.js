// src/printing/PrintDispatcher.js
// Dispatches print jobs to the appropriate transport via Electron's printRaw IPC.
// Integrates with PrintQueue state machine and PrinterManager.
// Fast bounded retries: max 2 retries at 500ms and 1500ms.

import { printQueue, PrintJob } from './PrintQueue.js';
import { PrinterManager } from './PrinterEngine.js';

const RETRY_DELAYS = [500, 1500]; // 500ms then 1500ms
const MAX_RETRIES = 2;

export class PrintDispatcher {
  static async enqueueJob(jobData) {
    const job = new PrintJob({
      ...jobData,
      maxAttempts: jobData.maxAttempts || (MAX_RETRIES + 1)
    });

    const success = printQueue.enqueue(job);
    if (!success) return { success: false, error: 'Duplicate job rejected (idempotency)' };

    // Auto-start processing if not already running
    this.processQueue(job.printerId);

    return { success: true, jobId: job.jobId };
  }

  static async processQueue(printerId) {
    const status = printQueue.getStatus(printerId);
    if (status.paused) return;

    const job = printQueue.nextJob(printerId);
    if (!job) return;

    await this.dispatch(job);

    // Recurse to process next job if still not paused
    this.processQueue(printerId);
  }

  static async dispatch(job) {
    printQueue.jobDispatched(job);

    const { printerId, printerName, manufacturer, protocol, payload, quantity } = job;
    let attempts = 0;

    while (attempts <= MAX_RETRIES) {
      attempts += 1;
      job.attempts = attempts;

      try {
        // We use PrinterManager.printLabel for the actual hardware call
        // but we pass the already generated payload if available
        let result;
        if (payload) {
          result = await window.electronAPI.printRaw({
            printerName: printerName || printerId,
            data: payload
          });
        } else {
          // Legacy path if payload not pre-generated
          throw new Error('Job payload missing');
        }

        if (result && result.success) {
          printQueue.jobCompleted(job);
          return { success: true, attempts };
        } else {
          throw new Error(result?.error || 'Print failed');
        }

      } catch (error) {
        if (attempts <= MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempts - 1] || 1500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        printQueue.jobFailed(job, error.message || String(error));
        return { success: false, error: error.message, attempts };
      }
    }

    return { success: false, error: 'Max retries exhausted', attempts: 0 };
  }

  static cancelJob(jobId, printerId) {
    return printQueue.cancelJob(jobId, printerId);
  }

  static async retryJob(jobId, printerId) {
    const job = printQueue.retryJob(jobId, printerId);
    if (!job) return { success: false, error: 'Job not found or not in failed state' };

    this.processQueue(printerId);
    return { success: true };
  }

  static resumeQueue(printerId) {
    printQueue.resume(printerId);
    this.processQueue(printerId);
  }

  static getQueueStatus(printerId) {
    return printQueue.getStatus(printerId);
  }
}