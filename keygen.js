// keygen.js
import crypto from 'crypto';

// The secret key used to sign the tokens (Keep this safe in production!)
const SECRET_KEY = 'mifela-super-secret-offline-key-2026';

function generateLicense(hardwareFingerprint) {
    if (!hardwareFingerprint || hardwareFingerprint === "PASTE_YOUR_HARDWARE_ID_HERE") {
        console.error("❌ Please paste your exact Hardware ID into the targetHardwareId variable at the bottom.");
        return;
    }

    // 1. Create JWT Header
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');

    // 2. Create JWT Payload (Matching the exact fields your auth.js expects)
    const payload = {
        accountId: "MIFELA_TEST_01",
        email: "YOUR_EXACT_SETUP_EMAIL@HERE.COM", // <--- Change this to match the UI
        storeName: "Mifela HQ",
        tier: "enterprise", 
        fingerprint: hardwareFingerprint, 
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        gracePeriodDays: 7
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // 3. Create Cryptographic Signature
    const signature = crypto
        .createHmac('sha256', SECRET_KEY)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url');

    // 4. Assemble the Token
    const licenseKey = `${encodedHeader}.${encodedPayload}.${signature}`;

    console.log("\n=========================================");
    console.log("✅ LICENSE KEY GENERATED SUCCESSFULLY");
    console.log("=========================================\n");
    console.log(licenseKey);
    console.log("\n=========================================\n");
}


// ⚠️ REPLACE THIS STRING WITH THE FINGERPRINT FROM YOUR UI
const targetHardwareId = "db125630e3389284b8838abcf11b132a7651b762c2c418d829b25d9c9572746c"; 

generateLicense(targetHardwareId);