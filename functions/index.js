const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const cors = require("cors")({ origin: true }); 

admin.initializeApp();
const db = admin.firestore();

const validateRequest = (req, res, next) => {
    if (req.method !== 'POST') {
        return res.status(405).send({ error: "Method not allowed. Use POST." });
    }
    if (!req.body || !req.body.email) {
        return res.status(400).send({ error: "Malformed payload. Email is required." });
    }
    next();
};

exports.requestChallenge = onRequest({ region: "asia-south1", maxInstances: 100 }, (req, res) => {
    cors(req, res, () => {
        validateRequest(req, res, () => {
            try {
                const timestamp = Date.now();
                const randomPayload = crypto.randomBytes(16).toString('hex');
                const challengeHex = Buffer.from(`${req.body.email}-${timestamp}-${randomPayload}`).toString('hex');
                
                res.status(200).send({ challengeHex });
            } catch (error) {
                console.error("Challenge Gen Error:", error);
                res.status(500).send({ error: "Internal server error during challenge generation." });
            }
        });
    });
});

exports.verifyChallenge = onRequest({ region: "asia-south1", maxInstances: 100 }, (req, res) => {
    cors(req, res, () => {
        validateRequest(req, res, async () => {
            const { email, signature, challenge } = req.body;
            
            if (!signature || !challenge) {
                return res.status(400).send({ error: "Missing cryptographic payload (signature/challenge)." });
            }

            try {
                // 1. Look up the hardware profile registered during the startup modal
                const nodesRef = db.collection('provisioned_nodes');
                const snapshot = await nodesRef.where('email', '==', email).limit(1).get();
                
                if (snapshot.empty) {
                    return res.status(403).send({ error: "Node not registered or revoked." });
                }
                
                const nodeData = snapshot.docs[0].data();
                
                // 2. Enforce Payment/Active Status
                if (nodeData.status !== 'ACTIVE') {
                    return res.status(403).send({ error: "Node license is suspended or unpaid." });
                }

                // 3. Cryptographically verify the hardware signature
                const publicKey = nodeData.publicKey;
                const verifier = crypto.createVerify('SHA256');
                verifier.update(challenge);
                verifier.end();

                const isVerified = verifier.verify(publicKey, signature, 'base64');
                
                if (!isVerified) {
                    return res.status(403).send({ error: "Invalid hardware signature. Node locked." });
                }

                // 4. Success: Instruct the frontend to clear the quarantine flag
                res.status(200).send({ 
                    success: true, 
                    message: "Node identity verified.",
                    timestamp: Date.now() 
                });
                
            } catch (error) {
                console.error("Verification Error:", error);
                res.status(500).send({ error: "Internal server error during verification." });
            }
        });
    });
});