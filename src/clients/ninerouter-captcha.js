/**
 * 9Router Captcha Solver — uses vision model to read captcha images
 * Much more accurate than CapMonster/2captcha for alphanumeric captchas
 */

export class NineRouterCaptchaSolver {
  constructor(config = {}) {
    this.baseUrl = config.url || config.NINEROUTER_URL || process.env.NINEROUTER_URL || 'http://localhost:20128';
    this.apiKey = config.key || config.NINEROUTER_KEY || process.env.NINEROUTER_KEY || '';
    this.model = config.model || 'mimo/mimo-v2-flash';
  }

  async solveImageCaptcha(base64Image) {
    // Detect image type
    let mime = 'image/jpeg';
    if (base64Image.startsWith('data:')) {
      mime = base64Image.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
    } else if (base64Image.startsWith('/9j/')) {
      mime = 'image/jpeg';
    } else if (base64Image.startsWith('iVBOR')) {
      mime = 'image/png';
    }
    const clean = base64Image.startsWith('data:') ? base64Image : `data:${mime};base64,${base64Image}`;

    console.log(`[9Router] Solving captcha with ${this.model}...`);

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 512,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Read ALL the text in this captcha image. Output the exact characters you see, including Chinese characters (汉字). Output ONLY the characters, nothing else. No explanation.',
              },
              {
                type: 'image_url',
                image_url: { url: clean },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`9Router captcha error ${res.status}: ${err.substring(0, 200)}`);
    }

    let raw = await res.text();
    console.log(`[9Router] Raw response (first 500): ${raw.substring(0, 500)}`);

    let answer = '';

    // Handle SSE stream format: "data: {...}\n\ndata: [DONE]"
    if (raw.trimStart().startsWith('data:')) {
      const chunks = raw.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]'));
      let fullContent = '';
      let fullReasoning = '';
      for (const chunk of chunks) {
        try {
          const d = JSON.parse(chunk.replace(/^data:\s*/, ''));
          const delta = d.choices?.[0]?.delta || {};
          fullContent += delta.content || '';
          fullReasoning += delta.reasoning_content || '';
        } catch {}
      }
      answer = fullContent || fullReasoning;
    } else if (raw.trimStart().startsWith('{')) {
      // Regular JSON response
      try {
        const data = JSON.parse(raw);
        const msg = data.choices?.[0]?.message || {};
        // Try content first, then reasoning_content
        answer = msg.content || '';
        if (!answer && msg.reasoning_content) {
          // Extract captcha text from reasoning — look for the final answer pattern
          const reasoning = msg.reasoning_content;
          // Try to find a quoted answer or last alphanumeric sequence
const quotedMatch = reasoning.match(/['"`]([a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf]{2,8})['"`]/);
          if (quotedMatch) {
            answer = quotedMatch[1];
          } else {
            // Look for patterns like "the text is XXXX" or "characters: XXXX"
            const textMatch = reasoning.match(/(?:text|characters?|captcha|reads?|says?|answer)[:\s]+['"]?([a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf]{2,8})['"]?/i);
            if (textMatch) {
              answer = textMatch[1];
            } else {
              // Last resort: find the last standalone 3-6 char alphanumeric word
              const words = reasoning.match(/[a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf]{2,8}/g);
              if (words) answer = words[words.length - 1];
            }
          }
        }
      } catch {
        answer = raw.trim();
      }
    } else {
      answer = raw.trim();
    }

    // Clean: keep alphanumeric and Chinese characters (CJK Unified Ideographs)
    answer = answer.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf]/g, '');
    if (!answer) throw new Error('9Router returned empty answer');
    console.log(`[9Router] ✓ Captcha answer: ${answer}`);
    return answer;
  }
}

export default NineRouterCaptchaSolver;
