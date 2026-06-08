# 🚀 Streaming Chat Architecture

## Overview

**Problem:** Current chat endpoint returns only after complete processing → long wait times, no user feedback during task execution.

**Solution:** Two-phase streaming architecture:
1. **Phase 1: Setup Stream** (`/api/chat-stream`) — Progressive task feedback via Server-Sent Events (SSE)
2. **Phase 2: Message Stream** (`/api/chat-stream-messages`) — Token-by-token chat response streaming

**Benefits:**
- ✅ Real-time feedback during task execution (routing, duplicate checking, prompt building, etc.)
- ✅ Token-streaming from OpenAI → messages appear as LLM generates them
- ✅ Can combine both for full progressive experience
- ✅ Backward compatible (old `/api/chat` endpoint unchanged)
- ✅ Cancellable streams (user can abort mid-execution)

---

## Architecture Diagram

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       ├─→ GET /api/chat-stream (SSE)
       │   ├─ progress: routing
       │   ├─ progress: checking_duplicates
       │   ├─ progress: building_prompt
       │   ├─ progress: loading_history
       │   └─ complete: ready_for_chat
       │
       └─→ POST /api/chat-stream-messages (Streaming Response)
           ├─ token: "Hei"
           ├─ token: " "
           ├─ token: "verden"
           └─ complete: fullMessage + metadata
```

---

## File Structure

```
src/
  routes/
    api/
      chat-stream/           # Phase 1: Setup & Progress
        +server.ts           # GET endpoint
      chat-stream-messages/  # Phase 2: Message Streaming
        +server.ts           # POST endpoint
    demo-streaming/
      +page.svelte          # Full demo (test page)
  lib/
    client/
      streaming-chat.ts     # Client hooks
```

---

## Implementation Details

### Phase 1: `/api/chat-stream` (Setup & Progress)

**Protocol:** Server-Sent Events (SSE)

**Entry Point:**
```typescript
// Frontend
new EventSource('/api/chat-stream?conversationId=xxx&message=yyy')
  .addEventListener('progress', (e) => { ... })
  .addEventListener('complete', (e) => { ... })
```

**Stages (in order):**
1. `initialize` — Starting conversation
2. `conversation_ready` — Conversation loaded/created
3. `routing` — Analyzing message for domains/skills
4. `routing_complete` → domains, skills, focusModules detected
5. `checking_duplicates` — If widget_creation skill active
6. `duplicates_checked` → duplicate count
7. `building_prompt` — Assembling system prompt
8. `prompt_ready` → prompt length, domain count
9. `loading_history` — Fetching conversation history
10. `history_loaded` → message count in history
11. `saving_message` — Storing user message
12. `message_saved` → message length
13. `ready_for_completion` → **full context for Phase 2**
14. `complete` → nextEndpoint: `/api/chat-stream-messages`

**Example Event:**
```json
{
  "type": "progress",
  "stage": "routing_complete",
  "data": {
    "domains": ["health", "economics"],
    "skills": ["widget_creation"],
    "focusModules": ["health"]
  },
  "timestamp": 1712146800000
}
```

**Benefits:**
- User sees "Analyzing..." → "Checking duplicates..." → "Building prompt..." 
- Can show detailed progress UI in real-time
- Discover if API calls are slow before message streaming starts
- Can cancel/retry early if something fails

---

### Phase 2: `/api/chat-stream-messages` (Token Streaming)

**Protocol:** Streaming Response (multipart/event-stream with SSE-like format)

**Entry Point:**
```typescript
// Frontend
const response = await fetch('/api/chat-stream-messages', {
  method: 'POST',
  body: JSON.stringify({
    conversationId,
    routing,
    systemPrompt,
    messages
  })
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
// Handle streaming...
```

**Event Types:**
- `stream_start` — Starting OpenAI request
- `token` → `{ token: "Hei" }` — Individual text token
- `complete` → `{ fullMessage, metadata }` — Entire message saved
- `error` → `{ message, type }` — Stream error

**Example Events:**
```
data: {"type":"stream_start","data":{"message":"Starter chat streaming..."},"timestamp":1712...}\n\n
data: {"type":"token","data":{"token":"Hei"},"timestamp":1712...}\n\n
data: {"type":"token","data":{"token":" "},"timestamp":1712...}\n\n
data: {"type":"token","data":{"token":"verden"},"timestamp":1712...}\n\n
data: {"type":"complete","data":{"fullMessage":"Hei verden","metadata":{...}},"timestamp":1712...}\n\n
```

**Benefits:**
- User sees message building token-by-token
- Feels responsive even if API takes 10s total
- Message appears immediately (no "waiting for response" state)
- Saved to database after complete

---

## Usage Patterns

### Pattern 1: Full Streaming (Setup + Messages)

```typescript
import { streamingChat } from '$lib/client/streaming-chat';

await streamingChat({
  message: 'Opprett widget for dagligvareforbruk',
  conversationId: null,
  
  // Progress callbacks
  onProgress: (stage, data) => {
    console.log(`[${stage}]`, data);
    updateProgressUI(stage); // Show "Analyzing...", etc
  },
  
  // Token streaming
  onToken: (token) => {
    chatDisplay.textContent += token; // Build message live
  },
  
  // When complete
  onComplete: (result) => {
    console.log('Chat saved:', result.metadata);
    saveConversationId(result.metadata.conversationId);
  },
  
  onError: (error) => {
    showError(error);
  }
});
```

### Pattern 2: Manual Two-Phase (More Control)

```typescript
// Phase 1: Setup
const setupEvent = new EventSource(setupUrl);
setupEvent.addEventListener('complete', async (e) => {
  const { conversationId, routing, systemPrompt } = JSON.parse(e.data);
  
  // Phase 2: Stream messages
  await streamChatMessages(conversationId, routing, systemPrompt, messages, {
    onToken: (token) => { ... },
    onComplete: (result) => { ... }
  });
});
```

### Pattern 3: Just Message Streaming (existing setup)

```typescript
import { streamChatMessages } from '$lib/client/streaming-chat';

// Already have conversationId, routing, systemPrompt from elsewhere
await streamChatMessages(conversationId, routing, systemPrompt, messages, {
  onToken: (token) => {
    chatMessage += token;
  },
  onComplete: (result) => {
    console.log('Done!');
  }
});
```

---

## Integration with Existing Code

### How to migrate from `/api/chat` approach:

**Before (sync):**
```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: 'Hello' })
});
const { message, widgetProposal } = await response.json();
displayMessage(message);
```

**After (streaming):**
```typescript
import { streamingChat } from '$lib/client/streaming-chat';

await streamingChat({
  message: 'Hello',
  onProgress: (stage, data) => {
    if (stage === 'routing_complete') {
      showProgressBar('30% - Analyzing...');
    }
  },
  onToken: (token) => {
    displayMessageCharacter(token);
  },
  onComplete: (result) => {
    console.log('Widget proposal:', result.widgetProposal);
  }
});
```

---

## Testing

### Local Testing

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Navigate to demo:**
   ```
   http://localhost:5173/demo-streaming
   ```

3. **Send test messages:**
   - "Opprett widget for søvn siste 7 dager"
   - "Hva er min gjennomsnittlige dagligvareforbruk?"
   - etc.

4. **Observe:**
   - Progress timeline shows each stage
   - Status updates in real-time
   - Chat message streams token-by-token
   - Conversation ID persists

### Browser DevTools Testing

```javascript
// Open console, paste:
const eventSource = new EventSource('/api/chat-stream?conversationId=&message=test');

eventSource.addEventListener('progress', (e) => {
  const event = JSON.parse(e.data);
  console.log(`✓ ${event.stage}`, event.data.message || event.data);
});

eventSource.addEventListener('complete', () => {
  console.log('✅ Setup complete');
  eventSource.close();
});

eventSource.addEventListener('error', () => {
  console.error('❌ Stream error');
  eventSource.close();
});
```

---

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Phase 1 (setup) | 500ms - 2s | Depends on DB queries, OpenAI API for optional calls |
| Phase 2 (streaming) | Variable | OpenAI token generation → ~100ms per token |
| Time to first token | 2-3s | After Phase 1 complete |
| Memory (client) | ~1MB | For full conversation context |
| Network latency | SSE: <10ms/event | Streaming: <50ms per token batch |

---

## Error Handling

### Server Errors
- Bad userId → 401
- Malformed request → 400
- DB error mid-stream → `error` event
- OpenAI error → `error` event

### Network Errors
```typescript
onError: (error) => {
  if (error.includes('Unauthorized')) {
    redirectToLogin();
  } else if (error.includes('Failed to stream')) {
    showRetryButton();
  } else {
    showFallback('Prøv igjen senere');
  }
}
```

### Retry Logic
```typescript
const MAX_RETRIES = 3;
for (let i = 0; i < MAX_RETRIES; i++) {
  try {
    await streamingChat({ message, ... });
    break;
  } catch (error) {
    if (i < MAX_RETRIES - 1) {
      console.log(`Retry ${i + 1}/${MAX_RETRIES}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } else {
      throw error;
    }
  }
}
```

---

## Future Enhancements

### 1. Abort Controller Support
```typescript
const abortController = new AbortController();

streamingChat({
  message,
  signal: abortController.signal,
  // ...
});

// User clicks "Cancel"
abortController.abort();
```

### 2. Progress Bar Stages
```typescript
const stageProgress = {
  'initialize': 5,
  'routing': 20,
  'checking_duplicates': 35,
  'building_prompt': 60,
  'loading_history': 75,
  'ready_for_completion': 90,
  'complete': 100
};

onProgress: (stage) => {
  progressBar.style.width = stageProgress[stage] + '%';
}
```

### 3. Persistent Stream Logs
```typescript
// Save all streaming events to IndexedDB for debugging
const logs = [];
onProgress: (stage, data) => {
  logs.push({ stage, data, timestamp: Date.now() });
  await db.streamLogs.add({ conversationId, logs }); 
}
```

### 4. Estimated Time Remaining
```typescript
// Based on historical stage durations
const stageTimes = {
  'routing': 300,
  'building_prompt': 200,
  'loading_history': 150,
  // ...
};

onProgress: (stage) => {
  const remaining = Object.entries(stageTimes)
    .filter(([s]) => s > stage)
    .reduce((sum, [_, time]) => sum + time, 0);
  showETA(remaining);
}
```

---

## Deployment Checklist

- [ ] Test all 3 endpoints locally
- [ ] Run demo page through full message flow
- [ ] Test error scenarios (no auth, invalid IDs, OpenAI down)
- [ ] Check browser compatibility (all modern browsers support SSE)
- [ ] Verify CORS headers for streaming endpoints
- [ ] Monitor OpenAI token streaming latency
- [ ] Ensure database writes complete after stream ends
- [ ] Test on production-like PostgreSQL volume
- [ ] Load test with 10+ concurrent streams
- [ ] Monitor server memory during long streams

---

## References

- [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
- [OpenAI Streaming](https://platform.openai.com/docs/api-reference/chat/create#chat/create-stream)
- [SvelteKit Response Streaming](https://kit.svelte.dev/docs/form-actions#progressive-enhancement)
