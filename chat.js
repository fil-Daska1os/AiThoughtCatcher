// Chat Logic
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

// TODO: Initialize functions if not already done in app.js or export/import it
// For now, we'll assume this module is loaded after app.js and shares the global scope or we re-init
// Ideally, we should modularize this better, but for MVP/single-file simplicity:

sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // Add User Message
    addMessage(text, 'user');
    chatInput.value = '';

    // Show loading state
    const loadingId = addMessage('Thinking...', 'system');

    try {
        // TODO: Call Cloud Function
        // const queryThoughts = httpsCallable(functions, 'queryThoughts');
        // const result = await queryThoughts({ query: text });

        // Mock response for now
        setTimeout(() => {
            const loadingEl = document.querySelector(`[data-id="${loadingId}"]`);
            if (loadingEl) loadingEl.remove();

            addMessage("I'm ready to answer questions about your thoughts once the backend is connected! For now, I'm just a placeholder.", 'system');
        }, 1000);

    } catch (error) {
        console.error("Chat error:", error);
        addMessage("Sorry, I encountered an error.", 'system');
    }
}

function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    const id = Date.now().toString();
    div.setAttribute('data-id', id);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}
