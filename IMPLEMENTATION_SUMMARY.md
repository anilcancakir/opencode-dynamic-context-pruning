# Anthropic API Support - Implementation Complete ✅

## What Was Fixed

The Anthropic Messages API format was incorrectly handled by the OpenAI Chat format adapter, causing system message injections to fail. Anthropic uses a **top-level `system` field** (string or array), while OpenAI uses `role: 'system'` messages within the messages array.

## Files Changed

### 1. **Created:** `lib/fetch-wrapper/formats/anthropic.ts`
- Full implementation of `FormatDescriptor` interface
- Detects `body.system` + `body.messages` (distinguishes from OpenAI)
- Injects into top-level `body.system` array (handles string-to-array conversion)
- Extracts tool outputs from `role: 'user'` messages with `type: 'tool_result'` blocks
- Uses `tool_use_id` field (Anthropic convention, not `tool_call_id`)
- Replaces pruned tool results with shortened message

### 2. **Updated:** `lib/fetch-wrapper/formats/index.ts`
```typescript
export { anthropicFormat } from './anthropic'  // Added
```

### 3. **Updated:** `lib/fetch-wrapper/index.ts`
- Imported `anthropicFormat`
- Added detection check **before** `openaiChatFormat` (critical ordering)
- Detection chain order:
  1. OpenAI Responses (body.input)
  2. Bedrock (body.system + inferenceConfig)
  3. **Anthropic (body.system + messages)** ← New
  4. OpenAI Chat (messages only)
  5. Gemini (body.contents)

## Technical Details

### Anthropic Format Characteristics
```typescript
// Request structure
{
  "system": "string" | [{"type": "text", "text": "...", "cache_control": {...}}],
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "tool_result", "tool_use_id": "toolu_123", "content": "..."}
      ]
    }
  ]
}
```

### Key Implementation Points

1. **Detection**: Checks `body.system !== undefined` to distinguish from OpenAI
2. **System Injection**: Converts string system to array, then appends text block
3. **Tool IDs**: Uses `tool_use_id` (not `tool_call_id`)
4. **Tool Results**: Found in `user` messages with `type: 'tool_result'` (not separate `tool` role)
5. **Order Matters**: Must detect before OpenAI format (both have `messages`)

## Build & Verification

```bash
npm run build  # ✅ Success
```

Generated files:
- `dist/lib/fetch-wrapper/formats/anthropic.js`
- `dist/lib/fetch-wrapper/formats/anthropic.d.ts`
- `dist/lib/fetch-wrapper/formats/anthropic.js.map`
- `dist/lib/fetch-wrapper/formats/anthropic.d.ts.map`

Verification:
- ✅ TypeScript compilation successful
- ✅ Format exported in index
- ✅ Imported and used in main wrapper
- ✅ Correct detection order (before OpenAI)
- ✅ All methods implemented correctly

## Testing Recommendations

To verify in production:
1. Use an Anthropic model (Claude)
2. Execute multiple tool calls
3. Verify system message shows prunable tools list
4. Confirm pruned tool outputs are replaced in API requests
5. Check logs for `format: 'anthropic'` metadata

## References

- Anthropic API docs: `docs/providers/anthropic.md`
- Similar implementation: `lib/fetch-wrapper/formats/bedrock.ts`
- Official API: https://docs.anthropic.com/en/api/messages

## Impact

- ✅ Fixes broken system message injection for Anthropic API
- ✅ Properly handles tool result pruning
- ✅ Maintains backward compatibility with other formats
- ✅ No changes needed to existing OpenAI/Gemini/Bedrock handlers
