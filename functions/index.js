const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// Initialize Gemini API
// Initialize Gemini API
// Initialize Gemini API
const GEMINI_API_KEY = "AIzaSyAkNl3LcYuieSsOToPFXlAjmLxcPJztBVI"; // Valid User Key
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
            // Get all pending or failed thoughts (not filtered by userId to catch legacy ones)
            const pendingSnapshot = await db.collection('user_thoughts')
                .where('ai_status', 'in', ['pending', 'failed'])
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

// 4. Process Audio Thought (Storage Trigger)
exports.processAudioThought = functions.storage.bucket("thoughtcatcher-42925.firebasestorage.app").object().onFinalize(async (object) => {
    const filePath = object.name; // e.g., user_audio/{userId}/{timestamp}.webm
    const contentType = object.contentType;

    // Only process audio files in the user_audio folder
    if (!contentType.startsWith('audio/') || !filePath.startsWith('user_audio/')) {
        return console.log('This is not an audio file or not in user_audio folder.');
    }

    const bucket = admin.storage().bucket(object.bucket);
    const fileName = filePath.split('/').pop();
    const userId = filePath.split('/')[1]; // Extract userId from path

    console.log(`Processing audio file: ${filePath} for user: ${userId}`);

    try {
        // 1. Download file to memory (buffer)
        const [buffer] = await bucket.file(filePath).download();

        // 2. Prepare for Gemini
        const audioBase64 = buffer.toString('base64');
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
            You are an expert transcriber and assistant.
            1. Transcribe the AUDIO strictly verbatim (capture every word).
            2. Then, analyze the thought and provide a title, summary, and keywords.
            
            Return ONLY a JSON object with this exact structure:
            {
              "raw_text": "The full verbatim transcription of the audio...",
              "ai_title": "A concise catchy title",
              "ai_summary": "A 2-3 sentence summary",
              "keywords": ["tag1", "tag2", "tag3"]
            }
        `;

        const part = {
            inlineData: {
                mimeType: contentType,
                data: audioBase64
            }
        };

        const result = await model.generateContent([prompt, part]);
        const response = await result.response;
        const text = response.text();

        // Parse JSON
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiData = JSON.parse(jsonStr);

        // 3. Save to Firestore
        await db.collection('user_thoughts').add({
            userId: userId,
            raw_text: aiData.raw_text,
            ai_title: aiData.ai_title,
            ai_summary: aiData.ai_summary,
            keywords: aiData.keywords,
            ai_status: 'processed',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            audio_url: `gs://${object.bucket}/${filePath}`, // Reference to audio
            type: 'audio_note'
        });

        console.log(`Successfully processed audio thought for user ${userId}`);
        return null;

    } catch (error) {
        console.error("Error processing audio thought:", error);
        // We could create a "failed" doc if we want, but for now just logging.
        // Creating a failed doc is better for UX.
        await db.collection('user_thoughts').add({
            userId: userId,
            raw_text: "Audio processing failed. Please try again.",
            ai_title: "Error Processing Audio",
            ai_summary: error.message,
            ai_status: 'failed',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            audio_url: `gs://${object.bucket}/${filePath}`,
            type: 'audio_note'
        });
        return null;
    }
});
