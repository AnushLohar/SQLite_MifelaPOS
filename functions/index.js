// SQLite_MifelaPOS/functions/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const cors = require("cors")({ origin: true }); 

setGlobalOptions({ region: "asia-south1", maxInstances: 100 });

if (!admin.apps.length) {
    admin.initializeApp();
}
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

// 🚀 NEW: The polling endpoint the Desktop App uses to check if the Gateway received payment
exports.verifyNodeActivation = onRequest((req, res) => {
    cors(req, res, () => {
        validateRequest(req, res, async () => {
            const { email, node } = req.body;
            
            if (!node) {
                return res.status(400).send({ error: "Hardware Node ID is required." });
            }

            try {
                const nodeDoc = await db.collection('provisioned_nodes').doc(node).get();
                
                if (!nodeDoc.exists) {
                    return res.status(404).send({ error: "Payment not detected yet. Please complete checkout." });
                }
                
                const nodeData = nodeDoc.data();
                
                // Ensure the email matches the node to prevent cross-account tampering
                if (nodeData.email !== email) {
                    return res.status(403).send({ error: "Node is registered to a different email." });
                }

                res.status(200).send({ 
                    data: {
                        status: nodeData.status,
                        paymentToken: nodeData.verificationToken || 'AUTO_PROVISIONED',
                        timestamp: Date.now() 
                    }
                });
                
            } catch (error) {
                console.error("Node Verification Error:", error);
                res.status(500).send({ error: "Internal server error during payment verification." });
            }
        });
    });
});

// Used during the 30-day silent background audit
exports.requestChallenge = onRequest((req, res) => {
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

// Used during the 30-day silent background audit
exports.verifyChallenge = onRequest((req, res) => {
    cors(req, res, () => {
        validateRequest(req, res, async () => {
            const { email, signature, challenge } = req.body;
            
            if (!signature || !challenge) {
                return res.status(400).send({ error: "Missing cryptographic payload (signature/challenge)." });
            }

            try {
                const nodesRef = db.collection('provisioned_nodes');
                const snapshot = await nodesRef.where('email', '==', email).limit(1).get();
                
                if (snapshot.empty) {
                    return res.status(403).send({ error: "Node not registered or revoked." });
                }
                
                const nodeData = snapshot.docs[0].data();
                
                if (nodeData.status !== 'ACTIVE' && nodeData.status !== 'PAID') {
                    return res.status(403).send({ error: "Node license is suspended or unpaid." });
                }

                const publicKey = nodeData.publicKey;
                const verifier = crypto.createVerify('SHA256');
                verifier.update(challenge);
                verifier.end();

                const isVerified = verifier.verify(publicKey, signature, 'base64');
                
                if (!isVerified) {
                    return res.status(403).send({ error: "Invalid hardware signature. Node locked." });
                }

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