# 🧠 Thought Catcher

An AI-powered voice thought capture and organization app. Speak your ideas, and AI automatically tags, summarizes, and organizes them for you.

## ✨ Features

- **Voice Capture**: Click the mic and speak your thoughts
- **AI Processing**: Automatic title, summary, and keyword generation using Gemini 2.0
- **Real-time Sync**: Thoughts sync instantly via Firebase
- **Chat Interface**: Query your captured thoughts using natural language

## 🚀 Live Demo

[https://thoughtcatcher-42925.web.app](https://thoughtcatcher-42925.web.app)

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Firebase Cloud Functions (Node.js 20)
- **Database**: Firebase Firestore
- **Auth**: Firebase Anonymous Authentication
- **AI**: Google Gemini 2.0 Flash

## 📁 Project Structure

```
Thoughtcatcher/
├── index.html          # Main app HTML
├── app.js              # Frontend logic & Firebase integration
├── chat.js             # Chat interface logic  
├── styles.css          # App styling
├── firebase.json       # Firebase configuration
├── firestore.rules     # Firestore security rules
└── functions/          # Cloud Functions
    ├── index.js        # Function implementations
    └── package.json    # Function dependencies
```

## 🔧 Setup

1. Clone the repo
2. Update Firebase config in `app.js`
3. Add your Gemini API key in `functions/index.js`
4. Deploy: `npx firebase-tools deploy`

## 📝 Version History

- **v0.1** - Initial working release
  - Voice capture with Web Speech API
  - AI processing via Firestore trigger
  - Real-time thought feed
  - Chat interface (WIP)

## 📄 License

MIT
