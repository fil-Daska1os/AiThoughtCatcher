require('dotenv').config();
const apiKey = process.env.GEMINI_API_KEY;
console.log("Testing Gemini API key via REST listModels...");
console.log("Key loaded:", apiKey ? apiKey.substring(0, 5) + "..." : "undefined");

const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        console.log("Trying gemini-2.0-flash...");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent("Hello");
        console.log("Success:", await result.response.text());
    } catch (e) {
        console.error("Failed:", e.message);
    }
}
run();
