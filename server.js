import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const SYSTEM_INSTRUCTION = `
तुम एक विनम्र, तेज और पेशेवर AI कॉल असिस्टेंट हो। 
कॉलर से हिंदी या हिंग्लिश में बात करो। 
हमेशा 1 से 2 बहुत छोटे वाक्यों में ही जवाब दो।
`;

wss.on('connection', (ws) => {
  console.log('पुराने फोन से कॉल कनेक्ट हो गई!');

  const dgConnection = deepgram.listen.live({
    model: 'nova-2',
    language: 'hi',
    smart_format: true,
    encoding: 'linear16',
    sample_rate: 16000,
  });

  dgConnection.on(LiveTranscriptionEvents.Open, () => {
    ws.on('message', (audioChunk) => {
      if (dgConnection.getReadyState() === 1) {
        dgConnection.send(audioChunk);
      }
    });
  });

  dgConnection.on(LiveTranscriptionEvents.TranscriptReceived, async (data) => {
    const transcript = data.channel.alternatives[0]?.transcript;
    if (transcript && data.is_final && transcript.trim().length > 0) {
      console.log(`कॉलर: ${transcript}`);

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: transcript }] }],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            maxOutputTokens: 100,
          }
        });

        const replyText = response.text();
        console.log(`AI: ${replyText}`);

        // Deepgram Speak API से तुरंत ऑडियो में बदलें
        const ttsResponse = await deepgram.speak.request(
          { text: replyText },
          { model: 'aura-asteria-en', encoding: 'linear16', container: 'none' }
        );
        const stream = await ttsResponse.getStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        
        // ऑडियो बाइट्स वापस पुराने फोन को भेजें
        ws.send(Buffer.concat(chunks));
      } catch (err) {
        console.error('Error in AI loop:', err);
      }
    }
  });

  ws.on('close', () => {
    console.log('कॉल खत्म हुई');
    dgConnection.finish();
  });
});

console.log(`Server listening on port ${port}`);
