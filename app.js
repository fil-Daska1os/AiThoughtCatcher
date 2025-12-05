// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
    batchProcessBtn.disabled = true;
    batchProcessBtn.innerHTML = '<span class="material-icons-round">hourglass_empty</span>';

    try {
        // Get the current user's ID token for authentication
        const idToken = await currentUser.getIdToken();

        const response = await fetch('https://us-central1-thoughtcatcher-42925.cloudfunctions.net/batchProcessThoughts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        alert(result.data.message);
    } catch (error) {
        console.error("Batch processing error:", error);
        alert("Error processing thoughts: " + error.message);
    } finally {
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

        snapshot.forEach((doc) => {
            const data = doc.data();
            const el = createThoughtElement(data);
            thoughtFeed.appendChild(el);
        });
    });
}

function createThoughtElement(data) {
    const div = document.createElement('div');
    div.className = 'thought-card';

    const date = data.timestamp ? data.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

    div.innerHTML = `
        <div class="thought-header">
            <div class="thought-title">${data.ai_title || 'Untitled Thought'}</div>
            <div class="thought-time">${date}</div>
        </div>
        <div class="thought-summary">${data.ai_summary || data.raw_text}</div>
        <div class="thought-tags">
            ${(data.keywords || []).map(k => `<span class="tag">#${k}</span>`).join('')}
            ${data.ai_status === 'pending' ? '<span class="tag" style="background:rgba(255,255,255,0.1);color:#aaa">Processing...</span>' : ''}
        </div>
    `;
    return div;
}
