# Anthropic API Format Support Implementation

## Summary

Successfully implemented proper Anthropic Messages API format support to fix the broken system message injection. The implementation now correctly handles Anthropic's unique top-level `system` array format.

## Changes Made

### 1. Created `lib/fetch-wrapper/formats/anthropic.ts`

Implements the `FormatDescriptor` interface with Anthropic-specific handling:

#### Detection Logic
```typescript
detect(body: any): boolean {
    return (
        body.system !== undefined &&
        Array.isArray(body.messages)
    )
}
```
- Checks for `body.system` (can be string or array) at the top level
- Requires `body.messages` array
- Distinguishes from OpenAI (no top-level system) and Bedrock (has inferenceConfig)

#### System Message Injection
```typescript
injectSystemMessage(body: any, injection: string): boolean {
    // Converts string system to array if needed
    if (typeof body.system === 'string') {
        body.system = [{ type: 'text', text: body.system }]
    } else if (!Array.isArray(body.system)) {
        body.system = []
    }
    
    // Appends injection as text block
    body.system.push({ type: 'text', text: injection })
    return true
}
```
- Handles both string and array system formats
- Converts string to array of text blocks automatically
- Appends to top-level `body.system` array (NOT in messages)

#### Tool Output Extraction
```typescript
extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
    // Looks for role='user' messages with type='tool_result' blocks
    // Uses tool_use_id field (Anthropic-specific)
}
```
- Searches user messages for `type: 'tool_result'` content blocks
- Uses `tool_use_id` field (not `tool_call_id`)
- Normalizes IDs to lowercase for consistency

#### Tool Output Replacement
```typescript
replaceToolOutput(data: any[], toolId: string, prunedMessage: string): boolean {
    // Replaces content field in tool_result blocks
    return {
        ...block,
        content: prunedMessage  // Direct string replacement
    }
}
```
- Finds matching `tool_result` blocks by `tool_use_id`
- Replaces the `content` field with pruned message
- Preserves other block properties (is_error, cache_control, etc.)

### 2. Updated `lib/fetch-wrapper/formats/index.ts`

```typescript
export { anthropicFormat } from './anthropic'
```

Added export for the new Anthropic format descriptor.

### 3. Updated `lib/fetch-wrapper/index.ts`

#### Import Statement
```typescript
import { openaiChatFormat, openaiResponsesFormat, geminiFormat, bedrockFormat, anthropicFormat } from "./formats"
```

#### Detection Chain Order (CRITICAL)
```typescript
// 1. OpenAI Responses API: has body.input (not body.messages)
if (openaiResponsesFormat.detect(body)) { ... }

// 2. Bedrock: has body.system + body.inferenceConfig + body.messages
else if (bedrockFormat.detect(body)) { ... }

// 3. Anthropic: has body.system + body.messages (no inferenceConfig)
else if (anthropicFormat.detect(body)) { ... }

// 4. OpenAI Chat: has body.messages (no top-level system)
else if (openaiChatFormat.detect(body)) { ... }

// 5. Gemini: has body.contents
else if (geminiFormat.detect(body)) { ... }
```

**Why Order Matters:**
- `anthropicFormat` MUST come before `openaiChatFormat`
- Both have `body.messages`, but Anthropic has `body.system` at top level
- Without proper ordering, Anthropic requests would be incorrectly handled by OpenAI format
- Bedrock comes before Anthropic because it has more specific fields (inferenceConfig)

### 4. OpenAI Format Compatibility

The existing `openaiChatFormat` has fallback handling for `tool_result` blocks (lines 42-52 in `openai-chat.ts`). This is preserved for:
- Backward compatibility with hybrid providers
- Edge cases where providers use mixed formats
- The detection order ensures true Anthropic requests are caught first

## Key Differences: Anthropic vs OpenAI

| Feature | OpenAI | Anthropic |
|---------|--------|-----------|
| System location | In messages array | Top-level `system` field |
| System format | `{role: "system", content: "..."}` | String or array of blocks |
| Tool results | `role: "tool"` message | In `user` message with `type: "tool_result"` |
| Tool ID field | `tool_call_id` | `tool_use_id` |
| Message roles | system/user/assistant/tool | user/assistant only |

## Testing

Successfully compiled with TypeScript:
```bash
npm run build  # ✓ No errors
```

Generated outputs:
- `dist/lib/fetch-wrapper/formats/anthropic.js`
- `dist/lib/fetch-wrapper/formats/anthropic.d.ts`
- Properly exported in `dist/lib/fetch-wrapper/formats/index.js`
- Integrated into main wrapper in `dist/lib/fetch-wrapper/index.js`

## Verification Points

1. ✅ Format detection distinguishes Anthropic from OpenAI (checks `body.system`)
2. ✅ System injection appends to top-level array (not messages)
3. ✅ Handles both string and array system formats
4. ✅ Tool extraction uses `tool_use_id` (Anthropic convention)
5. ✅ Tool replacement targets `tool_result` blocks in user messages
6. ✅ Detection order prevents OpenAI format from capturing Anthropic requests
7. ✅ Log metadata tags with `format: 'anthropic'`
8. ✅ TypeScript compilation successful

## References

- Documentation: `docs/providers/anthropic.md`
- Similar pattern: `lib/fetch-wrapper/formats/bedrock.ts` (also uses top-level system array)
- Official API: https://docs.anthropic.com/en/api/messages

## Impact

This fix resolves the issue where Anthropic requests were being incorrectly processed by the OpenAI format handler, which tried to inject system messages into the messages array instead of the top-level system field. The new implementation:

- Properly injects pruning context into Anthropic's system array
- Correctly identifies and replaces pruned tool outputs
- Maintains separation between format handlers
- Preserves backward compatibility with existing OpenAI handling
