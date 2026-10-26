//electron/UniversalPrintEngine.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import net from 'net';

export class UniversalPrintEngine {
    
    /**
     * Route the raw ZPL/ESC-POS data to the correct hardware transport.
     * @param {Object} connection - { type: 'os'|'network'|'serial'|'usb', address: '...', port: ... }
     * @param {String|Buffer} data - ZPL or ESC/POS raw payload
     */
    static async sendToPrinter(connection, data) {
        switch(connection.type) {
            case 'os':
                return await this._printViaOsSpooler(connection.address, data);
            case 'network':
                return await this._printViaTcp(connection.address, connection.port || 9100, data);
            case 'serial':
                return await this._printViaSerial(connection.address, connection.baudRate || 9600, data);
            case 'usb':
                return await this._printViaDirectUSB(connection.vendorId, connection.productId, data);
            default:
                throw new Error("Unknown hardware connection type");
        }
    }

    // ------------------------------------------------------------------------
    // 1. OS SPOOLER (For printers installed in Windows/Mac settings)
    // ------------------------------------------------------------------------
    static _printViaOsSpooler(printerName, dataString) {
        return new Promise((resolve, reject) => {
            const tempFile = path.join(os.tmpdir(), `mifela_raw_${Date.now()}.bin`);
            fs.writeFileSync(tempFile, dataString, 'utf8');

            const isWin = process.platform === 'win32';
            const cmd = isWin
                ? `print /D:"\\\\localhost\\${printerName}" "${tempFile}"`
                : `lp -d "${printerName}" -o raw "${tempFile}"`;

            exec(cmd, (err, stdout, stderr) => {
                fs.unlink(tempFile, () => {});
                if (err) return reject(new Error(stderr || err.message));
                resolve(stdout);
            });
        });
    }

    // ------------------------------------------------------------------------
    // 2. DIRECT ETHERNET / WIFI (Bypasses OS Drivers entirely - 100% reliable)
    // ------------------------------------------------------------------------
    static _printViaTcp(ipAddress, port, data) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            client.setTimeout(5000); // 5 second timeout

            client.on('error', (err) => {
                client.destroy();
                reject(new Error(`Network Printer Error: ${err.message}`));
            });

            client.on('timeout', () => {
                client.destroy();
                reject(new Error("Printer connection timed out. IP unreachable."));
            });

            // Open socket, dump the ZPL bytes, close socket. Instantaneous.
            client.connect(port, ipAddress, () => {
                client.write(data, () => {
                    client.destroy();
                    resolve(true);
                });
            });
        });
    }

    // ------------------------------------------------------------------------
    // 3. DIRECT SERIAL / COM PORT (For legacy POS hardware)
    // ------------------------------------------------------------------------
    static async _printViaSerial(comPort, baudRate, data) {
        try {
            const { SerialPort } = await import('serialport');
            return new Promise((resolve, reject) => {
                const port = new SerialPort({ path: comPort, baudRate: baudRate }, (err) => {
                    if (err) return reject(new Error(`COM Port Error: ${err.message}`));
                });

                port.write(data, (err) => {
                    if (err) return reject(err);
                    port.close();
                    resolve(true);
                });
            });
        } catch (e) {
            throw new Error("SerialPort module not loaded. Run 'npm install serialport'");
        }
    }

    // ------------------------------------------------------------------------
    // 4. DIRECT USB (Driverless - Bypasses Windows Spooler Hell)
    // ------------------------------------------------------------------------
    static async _printViaDirectUSB(vendorId, productId, data) {
        try {
            const { usb } = await import('usb');
            return new Promise((resolve, reject) => {
                // Find device by VID and PID (e.g., vendorId: 0x04b8 for Epson, 0x1203 for Zebra)
                const device = usb.findByIds(vendorId, productId);
                if (!device) return reject(new Error('USB Printer not found. Check cables and VID/PID.'));

                device.open();
                const iface = device.interfaces[0];
                
                // Mac/Linux: Detach the OS driver if it's currently hijacking the port
                if (iface.isKernelDriverActive()) {
                    iface.detachKernelDriver();
                }

                iface.claim();
                
                // Find the Bulk OUT endpoint to stream data
                const outEndpoint = iface.endpoints.find(e => e.direction === 'out');
                if (!outEndpoint) return reject(new Error("No OUT endpoint found on USB device."));

                // Push the raw ZPL string directly into the USB metal
                outEndpoint.transfer(Buffer.from(data), (err) => {
                    iface.release(() => {
                        device.close();
                    });
                    if (err) reject(err);
                    else resolve(true);
                });
            });
        } catch (e) {
            throw new Error("USB module not loaded. Run 'npm install usb'");
        }
    }
}