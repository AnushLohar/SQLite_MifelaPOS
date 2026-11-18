// generate-keys.js
import crypto from 'crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

console.log("=== PUBLIC KEY (Embed in Electron App) ===");
console.log(publicKey);

console.log("=== PRIVATE KEY (Keep Secret on Backend) ===");
console.log(privateKey);