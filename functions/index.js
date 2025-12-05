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

// 1. Process Thought (Firestore Trigger)
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

// 2. Chat Query (Firestore Trigger) - Processes chat requests written to Firestore
exports.processChatQuery = functions.firestore
    .document("chat_queries/{queryId}")
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const userQuery = data.query;
        const userId = data.userId;

        if (!userQuery || !userId) {
            await snap.ref.update({ status: 'failed', error: 'Missing query or userId' });
            return null;
        }

        try {
            // Get user's processed thoughts
            const thoughtsSnapshot = await db.collection('user_thoughts')
                .where('userId', '==', userId)
                .where('ai_status', '==', 'processed')
                .orderBy('timestamp', 'desc')
                .limit(20)
                .get();

            const thoughtsContext = thoughtsSnapshot.docs.map(doc => {
                const d = doc.data();
                return `- [${d.timestamp?.toDate?.()?.toISOString() || 'Unknown'}] ${d.ai_title || 'Untitled'}: ${d.ai_summary || d.raw_text} (Keywords: ${(d.keywords || []).join(', ')})`;
            }).join('\n');

            if (!thoughtsContext) {
                await snap.ref.update({
                    status: 'completed',
                    answer: "You don't have any processed thoughts yet. Try recording some thoughts first!"
                });
                return null;
            }

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
                5. Keep your response concise but informative.
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;

            await snap.ref.update({
                status: 'completed',
                answer: response.text(),
                completed_at: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Processed chat query: ${context.params.queryId}`);
            return null;

        } catch (error) {
            console.error("Error processing chat query:", error);
            await snap.ref.update({
                status: 'failed',
                error: error.message
            });
            return null;
        }
    });

// 3. Batch Process (Firestore Trigger) - Processes batch requests written to Firestore
exports.processBatchRequest = functions.firestore
    .document("batch_requests/{requestId}")
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const userId = data.userId;

        if (!userId) {
            await snap.ref.update({ status: 'failed', error: 'Missing userId' });
            return null;
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        try {
            // Get all pending thoughts (not filtered by userId to catch legacy ones)
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

                    // Assign userId to legacy docs
                    if (!docData.userId) {
                        updateData.userId = userId;
                    }

                    await doc.ref.update(updateData);
                    processed++;
                    console.log(`Batch processed thought ${doc.id}`);

                } catch (error) {
                    console.error(`Error batch processing thought ${doc.id}:`, error);
                    await doc.ref.update({
                        ai_status: 'failed',
                        error_message: error.message
                    });
                    failed++;
                }
            }

            await snap.ref.update({
                status: 'completed',
                processed: processed,
                failed: failed,
                message: `Processed ${processed} thoughts. ${failed} failed.`,
                completed_at: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Batch request completed: ${processed} processed, ${failed} failed`);
            return null;

        } catch (error) {
            console.error("Error in batch processing:", error);
            await snap.ref.update({
                status: 'failed',
                error: error.message
            });
            return null;
        }
    });
