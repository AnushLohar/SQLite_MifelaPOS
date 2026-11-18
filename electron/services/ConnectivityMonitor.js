import dns from 'dns';
import { EventEmitter } from 'events';

export default class ConnectivityMonitor extends EventEmitter {
    constructor(intervalMs = 30000) { // Check every 30 seconds
        super();
        this.intervalMs = intervalMs;
        this.isOnline = false;
    }

    start() {
        this.checkConnection();
        setInterval(() => this.checkConnection(), this.intervalMs);
    }

    checkConnection() {
        // Resolve Cloudflare DNS to ensure actual WAN connection
        dns.resolve('1.1.1.1', (err) => {
            const currentlyOnline = !err;
            if (this.isOnline !== currentlyOnline) {
                this.isOnline = currentlyOnline;
                this.emit(this.isOnline ? 'online' : 'offline');
            }
        });
    }
}