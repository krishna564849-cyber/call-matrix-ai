import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });

const geminiKey = process.env.GEMINI_API_KEY || '';
const deepgramKey = process.env.DEEPGRAM_API_KEY || '';

const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  systemInstruction: 'तुम एक विनम्र और तेज AI कॉल असिस्टेंट हो। कॉलर से हिंदी या हिंग्लिश में 1 से 2 छोटे वाक्यों में सटीक बात करो।'
});

wss.on('connection', (clientWs) => {
  console.log('फोन कनेक्ट हो गया!');

  // बिना SDK के सीधे Deepgram WebSocket कनेक्शन (100% क्रैश-फ्री)
  const dgWs = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&language=hi&smart_format=true&encoding=linear16&sample_rate=16000', {
    headers: {
      Authorization: `Token ${deepgramKey}`
    }
  });

  dgWs.on('open', () => {
    console.log('Deepgram लाइव कनेक्टेड');
  });

  clientWs.on('message', (chunk) => {
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.send(chunk);
    }
  });

  dgWs.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      const transcript = parsed.channel?.alternatives[0]?.transcript;

      if (transcript && parsed.is_final && transcript.trim().length > 0) {
        console.log(`कॉलर: ${transcript}`);

        const result = await model.generateContent(transcript);
        const replyText = result.response.text();
        console.log(`AI: ${replyText}`);

        // Direct Text-to-Speech call
        const ttsRes = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=16000', {
          method: 'POST',
          headers: {
            Authorization: `Token ${deepgramKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text: replyText })
        });

        if (ttsRes.ok) {
          const arrayBuffer = await ttsRes.arrayBuffer();
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(Buffer.from(arrayBuffer));
          }
        }
      }
    } catch (err) {
      console.error('Processing error:', err);
    }
  });

  clientWs.on('close', () => {
    console.log('फोन डिस्कनेक्ट हुआ');
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.close();
    }
  });
});

console.log(`Server running on port ${port}`);
