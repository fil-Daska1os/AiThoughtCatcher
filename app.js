// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Firebase Configuration (Placeholder - User needs to fill this)
const firebaseConfig = {
    apiKey: "AIzaSyAAK7wmyYei7_SKMzWFV5zMuHpfti_kksE",
    authDomain: "thoughtcatcher-42925.firebaseapp.com",
    projectId: "thoughtcatcher-42925",
    storageBucket: "thoughtcatcher-42925.firebasestorage.app",
    messagingSenderId: "533901139016",
    appId: "1:533901139016:web:2f0cb99c78593c46618c7d",
    measurementId: "G-QRD99J5H01"
};

// Initialize Firebase
let app, db, auth, functions;
let currentUser = null;

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    functions = getFunctions(app, 'us-central1');
} catch (e) {
    console.error("Firebase initialization failed. Make sure to update config.", e);
}

// DOM Elements
const micButton = document.getElementById('mic-button');
const recordingStatus = document.getElementById('recording-status');
const statusText = document.getElementById('status-text');
const thoughtFeed = document.getElementById('thought-feed');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatDrawer = document.getElementById('chat-drawer');
const closeChatBtn = document.getElementById('close-chat-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const batchProcessBtn = document.getElementById('batch-process-btn');

// State
let isRecording = false;
let recognition = null;

// Initialize Speech Recognition
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecording = true;
        updateRecordingUI(true);
    };

    recognition.onend = () => {
        isRecording = false;
        updateRecordingUI(false);
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');

        statusText.textContent = transcript || "Listening...";

        if (event.results[0].isFinal) {
            saveThought(transcript);
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        isRecording = false;
        updateRecordingUI(false);
        statusText.textContent = "Error: " + event.error;
    };
} else {
    alert("Voice capture is not supported in this browser. Please use Chrome or Safari.");
    micButton.disabled = true;
}

// UI Event Listeners
micButton.addEventListener('click', () => {
    if (!recognition) return;
    if (isRecording) {
        recognition.stop();
    } else {
        recognition.start();
    }
});

chatToggleBtn.addEventListener('click', () => {
    chatDrawer.classList.add('open');
});

closeChatBtn.addEventListener('click', () => {
    chatDrawer.classList.remove('open');
});

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

batchProcessBtn.addEventListener('click', async () => {
    if (!currentUser) return;

    batchProcessBtn.disabled = true;
    batchProcessBtn.innerHTML = '<span class="material-icons-round">hourglass_empty</span>';

    try {
        // Create a batch request in Firestore - the Cloud Function will process it
        const requestRef = await addDoc(collection(db, 'batch_requests'), {
            userId: currentUser.uid,
            status: 'pending',
            created_at: serverTimestamp()
        });

        // Listen for the response
        const unsubscribe = onSnapshot(doc(db, 'batch_requests', requestRef.id), (docSnap) => {
            const data = docSnap.data();
            if (data.status === 'completed') {
                unsubscribe();
                alert(data.message || `Processed ${data.processed} thoughts. ${data.failed} failed.`);
                batchProcessBtn.disabled = false;
                batchProcessBtn.innerHTML = '<span class="material-icons-round">auto_awesome</span>';
            } else if (data.status === 'failed') {
                unsubscribe();
                alert('Error processing thoughts: ' + (data.error || 'Unknown error'));
                batchProcessBtn.disabled = false;
                batchProcessBtn.innerHTML = '<span class="material-icons-round">auto_awesome</span>';
            }
        });

        // Timeout after 60 seconds
        setTimeout(() => {
            unsubscribe();
            if (batchProcessBtn.disabled) {
                alert('Batch processing is taking longer than expected. Check back later.');
                batchProcessBtn.disabled = false;
                batchProcessBtn.innerHTML = '<span class="material-icons-round">auto_awesome</span>';
            }
        }, 60000);

    } catch (error) {
        console.error("Batch processing error:", error);
        alert("Error starting batch process: " + error.message);
        batchProcessBtn.disabled = false;
        batchProcessBtn.innerHTML = '<span class="material-icons-round">auto_awesome</span>';
    }
});

// Helper Functions
function updateRecordingUI(recording) {
    if (recording) {
        micButton.classList.add('recording');
        recordingStatus.classList.remove('hidden');
        statusText.textContent = "Listening...";
    } else {
        micButton.classList.remove('recording');
        recordingStatus.classList.add('hidden');
    }
}

async function saveThought(text) {
    if (!currentUser || !text.trim()) return;

    try {
        await addDoc(collection(db, 'user_thoughts'), {
            userId: currentUser.uid,
            raw_text: text,
            timestamp: serverTimestamp(),
            ai_status: 'pending',
            ai_title: 'Processing...',
            ai_summary: 'Waiting for AI...',
            keywords: []
        });
        console.log("Thought saved!");
    } catch (e) {
        console.error("Error saving thought: ", e);
    }
}

// Auth & Real-time Listener
if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            subscribeToThoughts(user.uid);
        } else {
            signInAnonymously(auth).catch(console.error);
        }
    });
}

function subscribeToThoughts(userId) {
    const q = query(
        collection(db, 'user_thoughts'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc')
    );

    onSnapshot(q, (snapshot) => {
        thoughtFeed.innerHTML = '';
        if (snapshot.empty) {
            thoughtFeed.innerHTML = `
                <div class="empty-state">
                    <p>No thoughts captured yet.</p>
                    <p>Tap the mic to start thinking.</p>
                </div>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const el = createThoughtElement(data, docSnap.id);
            thoughtFeed.appendChild(el);
        });
    });
}

function createThoughtElement(data, docId) {
    const div = document.createElement('div');
    div.className = 'thought-card';
    div.setAttribute('data-id', docId);

    const date = data.timestamp ? data.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

    div.innerHTML = `
        <div class="thought-header">
            <div class="thought-title">${data.ai_title || 'Untitled Thought'}</div>
            <div class="thought-actions">
                <span class="thought-time">${date}</span>
                <button class="delete-btn" title="Delete thought">
                    <span class="material-icons-round">delete</span>
                </button>
            </div>
        </div>
        <div class="thought-summary">${data.ai_summary || data.raw_text}</div>
        <div class="thought-tags">
            ${(data.keywords || []).map(k => `<span class="tag">#${k}</span>`).join('')}
            ${data.ai_status === 'pending' ? '<span class="tag" style="background:rgba(255,255,255,0.1);color:#aaa">Processing...</span>' : ''}
        </div>
    `;

    // Add delete handler
    const deleteBtn = div.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showDeleteModal(docId);
    });

    return div;
}

// Delete Modal Logic
const deleteModal = document.getElementById('delete-modal');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
let pendingDeleteId = null;

function showDeleteModal(docId) {
    pendingDeleteId = docId;
    deleteModal.classList.remove('hidden');
}

function hideDeleteModal() {
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
}

cancelDeleteBtn.addEventListener('click', hideDeleteModal);

confirmDeleteBtn.addEventListener('click', async () => {
    if (pendingDeleteId) {
        try {
            await deleteDoc(doc(db, 'user_thoughts', pendingDeleteId));
        } catch (error) {
            console.error('Error deleting thought:', error);
            alert('Failed to delete thought');
        }
    }
    hideDeleteModal();
});

// Close modal when clicking outside
deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
        hideDeleteModal();
    }
});

// ===== CHAT FUNCTIONALITY =====
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentUser) return;

    // Add user message
    addChatMessage(text, 'user');
    chatInput.value = '';

    // Show loading
    const loadingEl = addChatMessage('Thinking...', 'system loading');

    try {
        // Create a chat query in Firestore - the Cloud Function will process it
        const queryRef = await addDoc(collection(db, 'chat_queries'), {
            userId: currentUser.uid,
            query: text,
            status: 'pending',
            created_at: serverTimestamp()
        });

        // Listen for the response
        const unsubscribe = onSnapshot(doc(db, 'chat_queries', queryRef.id), (docSnap) => {
            const data = docSnap.data();
            if (data.status === 'completed') {
                unsubscribe();
                loadingEl.remove();
                addChatMessage(data.answer, 'system');
            } else if (data.status === 'failed') {
                unsubscribe();
                loadingEl.remove();
                addChatMessage('Sorry, I encountered an error: ' + (data.error || 'Unknown error'), 'system error');
            }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
            unsubscribe();
            if (loadingEl.parentNode) {
                loadingEl.remove();
                addChatMessage('Response is taking too long. Please try again.', 'system error');
            }
        }, 30000);

    } catch (error) {
        console.error('Chat error:', error);
        loadingEl.remove();
        addChatMessage('Sorry, I encountered an error. Please try again.', 'system error');
    }
}

function addChatMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `<p>${text}</p>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}
