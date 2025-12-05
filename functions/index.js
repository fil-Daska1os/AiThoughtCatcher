const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Initialize Gemini API
const GEMINI_API_KEY = "AIzaSyCi9k3KcIi7qeH6iFEZ8iJE0ei8XFA44kc";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 1. Process Thought (Firestore Trigger) - 1st Gen
exports.processThought = functions.firestore
    .document("user_thoughts/{thoughtId}")
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const rawText = data.raw_text;

        if (data.ai_status === 'processed' || !rawText) return null;

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const prompt = `
                Analyze the following raw thought and extract structured metadata.
                Return ONLY a JSON object with these fields:
                - ai_title: A concise, catchy title (max 60 chars)
                - ai_summary: A 2-3 sentence summary of the core idea
                - keywords: An array of 3-5 relevant tags/keywords

                Raw Thought: "${rawText}"
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(jsonStr);

            await snap.ref.update({
                ai_title: aiData.ai_title,
                ai_summary: aiData.ai_summary,
                keywords: aiData.keywords,
                ai_status: 'processed',
                processed_at: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Processed thought: ${context.params.thoughtId}`);
            return null;

        } catch (error) {
            console.error("Error processing thought:", error);
            await snap.ref.update({
                ai_status: 'failed',
                error_message: error.message
            });
            return null;
        }
    });

// 2. Chat Query (HTTPS Callable) - 1st Gen with explicit CORS
exports.queryThoughts = functions.https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    const userQuery = data.query;

    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');

    try {
        const thoughtsSnapshot = await db.collection('user_thoughts')
            .where('userId', '==', uid)
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();

        const thoughtsContext = thoughtsSnapshot.docs.map(doc => {
            const d = doc.data();
            return `- [${d.timestamp?.toDate?.()?.toISOString() || 'Unknown'}] ${d.ai_title || 'Untitled'}: ${d.ai_summary || d.raw_text} (Keywords: ${(d.keywords || []).join(', ')})`;
        }).join('\n');

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
            You are an AI assistant helping a user explore their captured thoughts.
            
            User Query: "${userQuery}"

            Here are the user's recent thoughts:
            ${thoughtsContext}

            Instructions:
            1. Answer the user's question based ONLY on the provided thoughts.
            2. If the answer isn't in the thoughts, say so politely.
            3. Reference specific thoughts by title if relevant.
            4. Be helpful and conversational.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;

        return { answer: response.text() };

    } catch (error) {
        console.error("Error in chat query:", error);
        throw new functions.https.HttpsError('internal', 'Failed to generate answer');
    }
});

// 3. Batch Processor - Using onRequest with manual CORS for better control
exports.batchProcessThoughts = functions.https.onRequest(async (req, res) => {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    try {
        // Verify Firebase Auth token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No auth token provided' });
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (e) {
            res.status(401).json({ error: 'Invalid auth token' });
            return;
        }

        const uid = decodedToken.uid;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Get all pending thoughts
        const pendingSnapshot = await db.collection('user_thoughts')
            .where('ai_status', '==', 'pending')
            .get();

        let processed = 0;
        let failed = 0;

        for (const doc of pendingSnapshot.docs) {
            const docData = doc.data();
            const rawText = docData.raw_text;
            if (!rawText) continue;

            try {
                const prompt = `
                    Analyze the following raw thought and extract structured metadata.
                    Return ONLY a JSON object with these fields:
                    - ai_title: A concise, catchy title (max 60 chars)
                    - ai_summary: A 2-3 sentence summary of the core idea
                    - keywords: An array of 3-5 relevant tags/keywords

                    Raw Thought: "${rawText}"
                `;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const aiData = JSON.parse(jsonStr);

                const updateData = {
                    ai_title: aiData.ai_title,
                    ai_summary: aiData.ai_summary,
                    keywords: aiData.keywords,
                    ai_status: 'processed',
                    processed_at: admin.firestore.FieldValue.serverTimestamp()
                };

                if (!docData.userId) {
                    updateData.userId = uid;
                }

                await doc.ref.update(updateData);
                processed++;
                console.log(`Processed thought ${doc.id}`);

            } catch (error) {
                console.error(`Error processing thought ${doc.id}:`, error);
                await doc.ref.update({
                    ai_status: 'failed',
                    error_message: error.message
                });
                failed++;
            }
        }

        res.json({ data: { message: `Processed ${processed} thoughts. ${failed} failed.` } });

    } catch (error) {
        console.error("Batch processing error:", error);
        res.status(500).json({ error: error.message });
    }
});
