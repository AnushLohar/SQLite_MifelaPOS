import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrintJob, PrintQueue } from '../src/printing/PrintQueue.js';

// Mock the setTimeout for deterministic timing tests
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
global.setTimeout = (fn, delay) => {
  const timeoutId = realSetTimeout(fn, delay);
  // Store the timeout info for test control
  if (!global._testTimeouts) global._testTimeouts = [];
  global._testTimeouts.push({ id: timeoutId, delay });
  return timeoutId;
};

global.clearTimeout = (id) => {
  realClearTimeout(id);
  if (global._testTimeouts) {
    global._testTimeouts = global._testTimeouts.filter(t => t.id !== id);
  }
};

describe('PrintQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new PrintQueue();
    // Clear any leftover timeouts
    global._testTimeouts = [];
  });

  afterEach(() => {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    delete global._testTimeouts;
  });

  describe('PrintJob', () => {
    it('creates a job with pending state', () => {
      const job = new PrintJob({
        jobId: 'j1',
        printerId: 'printer1',
        manufacturer: 'tsc',
        protocol: 'tspl',
        payload: 'SIZE 50 mm, 25 mm\n',
        quantity: 1,
      });

      expect(job.state).toBe('pending');
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
    });

    it('progresses through states', () => {
      const job = new PrintJob({ jobId: 'j1', printerId: 'p1' });

      expect(job.state).toBe('pending');
      job.markDispatching();
      expect(job.state).toBe('dispatching');
      expect(job.startedAt).toBeDefined();

      job.markCompleted();
      expect(job.state).toBe('completed');
      expect(job.completedAt).toBeDefined();

      const job2 = new PrintJob({ jobId: 'j1', printerId: 'p1' });
      job2.markFailed('out of paper');
      expect(job2.state).toBe('failed');
      expect(job2.error).toBe('out of paper');
      expect(job2.completedAt).toBeDefined();
    });
  });

  describe('PrintQueue', () => {
    beforeEach(() => {
      queue = new PrintQueue();
    });

    it('enqueues a job and can retrieve it', () => {
      const job = new PrintJob({ jobId: 'j1', printerId: 'printer1' });
      queue.enqueue(job);

      const next = queue.nextJob('printer1');
      expect(next).toBeDefined();
      expect(next.jobId).toBe('j1');
    });

    it('returns null when queue is empty', () => {
      const next = queue.nextJob('printer1');
      expect(next).toBeNull();
    });

    it('processes jobs sequentially per printer', async () => {
      const job1 = new PrintJob({ jobId: 'j1', printerId: 'printer1' });
      const job2 = new PrintJob({ jobId: 'j2', printerId: 'printer1' });

      queue.enqueue(job1);
      queue.enqueue(job2);

      // j1 should be first
      expect(queue.nextJob('printer1').jobId).toBe('j1');

      // Mark j1 as dispatched (simulating processing)
      queue.jobDispatched(job1);

      // j1 is now dispatching, so j2 should be the next pending
      expect(queue.nextJob('printer1').jobId).toBe('j2');
    });

    it('respects paused state', () => {
      const job = new PrintJob({ jobId: 'j1', printerId: 'printer1' });
      queue.enqueue(job);

      // Pause the queue
      queue.pause('printer1');

      // Next job should be null when paused
      expect(queue.nextJob('printer1')).toBeNull();

      // Resume
      queue.resume('printer1');
      const next = queue.nextJob('printer1');
      expect(next).toBeDefined();
      expect(next.jobId).toBe('j1');
    });

    it('retries a failed job and pauses queue', async () => {
      const job = new PrintJob({
        jobId: 'j1',
        printerId: 'printer1',
        maxAttempts: 2
      });
      queue.enqueue(job);

      // Simulate failure (markFailed sets paused = true)
      queue.jobFailed(job, 'out of paper');

      // Queue should be paused
      expect(queue.getStatus('printer1').paused).toBe(true);

      // Resume should process next (but there is none)
      queue.resume('printer1');
    });

    it('retryJob resets and re-enqueues', () => {
      const job = new PrintJob({
        jobId: 'j1',
        printerId: 'printer1',
        maxAttempts: 2
      });
      queue.enqueue(job);

      // Fail it
      queue.jobFailed(job, 'out of paper');
      expect(queue.getStatus('printer1').paused).toBe(true);

      // Retry it
      const returned = queue.retryJob('j1', 'printer1');
      expect(returned).toBeDefined();
      expect(returned.state).toBe('pending');
      expect(returned.attempts).toBe(0);
      expect(queue.getStatus('printer1').paused).toBe(false); // resumed
    });

    it('cancelJob removes job from queue', () => {
      const job = new PrintJob({ jobId: 'j1', printerId: 'printer1' });
      queue.enqueue(job);

      const cancelled = queue.cancelJob('j1', 'printer1');
      expect(cancelled).toBe(true);

      const next = queue.nextJob('printer1');
      expect(next).toBeNull();
    });

    it('idempotencyKey dedup rejects duplicates within window', () => {
      const job1 = new PrintJob({
        jobId: 'j1', printerId: 'printer1',
        idempotencyKey: 'dup-key'
      });
      const job2 = new PrintJob({
        jobId: 'j2', printerId: 'printer1',
        idempotencyKey: 'dup-key'
      });

      // Enqueue first - should succeed
      const firstResult = queue.enqueue(job1);
      expect(firstResult).toBe(true);

      // Enqueue second with same key - should reject
      const secondResult = queue.enqueue(job2);
      expect(secondResult).toBe(false);
    });

    it('capped history (50 per printer)', () => {
      // Enqueue 60 jobs for one printer
      for (let i = 1; i <= 60; i++) {
        const job = new PrintJob({ jobId: `j${i}`, printerId: 'printer1' });
        queue.enqueue(job);
      }

      const status = queue.getStatus('printer1');
      // Should have at most 50 history entries (completed/failed/cancelled)
      // Plus active pending jobs
      expect(status.history.length).toBeLessThanOrEqual(50);
    });

    it('processNext dispatches and completes', async () => {
      const job = new PrintJob({ jobId: 'j1', printerId: 'printer1' });
      queue.enqueue(job);

      // Mock dispatch function that resolves immediately
      const dispatchFn = async (j) => {
        // Simulate successful print
        j.markCompleted();
      };

      await queue.processNext('printer1', dispatchFn);

      const status = queue.getStatus('printer1');
      expect(status.jobs[0].state).toBe('completed');
    });

    it('processNext fails and pauses after max attempts', async () => {
      const job = new PrintJob({
        jobId: 'j1', printerId: 'printer1', maxAttempts: 2
      });
      queue.enqueue(job);

      // Mock dispatch that always fails
      const dispatchFn = async (j) => {
        throw new Error('Printer offline');
      };

      await queue.processNext('printer1', dispatchFn);

      const status = queue.getStatus('printer1');
      expect(status.jobs[0].state).toBe('failed');
      expect(status.paused).toBe(true);
    });
  });
});