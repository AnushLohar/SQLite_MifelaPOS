import { execSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';

export function getHardwareFingerprint() {
    let rawIdentifier = '';
    const platform = process.platform;

    try {
        if (platform === 'win32') {
            const mb = execSync('wmic csproduct get uuid', { encoding: 'utf8' }).split('\n')[1]?.trim() || '';
            const cpu = execSync('wmic cpu get processorid', { encoding: 'utf8' }).split('\n')[1]?.trim() || '';
            const disk = execSync('wmic diskdrive get serialnumber', { encoding: 'utf8' }).split('\n')[1]?.trim() || '';
            rawIdentifier = `${mb}-${cpu}-${disk}`;
        } else if (platform === 'darwin') {
            rawIdentifier = execSync('ioreg -d2 -c IOPlatformExpertDevice | awk -F\\" \'/IOPlatformUUID/{print $(NF-1)}\'', { encoding: 'utf8' }).trim();
        } else {
            rawIdentifier = execSync('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id', { encoding: 'utf8' }).trim();
        }
    } catch {
        const interfaces = os.networkInterfaces();
        for (const ifaceName in interfaces) {
            const iface = interfaces[ifaceName]?.find(d => !d.internal && d.mac !== '00:00:00:00:00:00');
            if (iface) {
                rawIdentifier += iface.mac;
                break;
            }
        }
    }

    if (!rawIdentifier) rawIdentifier = `${os.hostname()}-${os.totalmem()}-${os.cpus()[0]?.model}`;
    return crypto.createHash('sha256').update(rawIdentifier).digest('hex').toUpperCase();
}