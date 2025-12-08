// Quick test to verify Anthropic format detection and system injection
const { anthropicFormat } = require('./lib/fetch-wrapper/formats/anthropic.ts');

console.log("Testing Anthropic Format Detection...\n");

// Test 1: Detection with string system
const body1 = {
    model: "claude-3-5-sonnet-20241022",
    system: "You are a helpful assistant",
    messages: [
        { role: "user", content: "Hello" }
    ]
};
console.log("Test 1 - String system + messages:", anthropicFormat.detect(body1) ? "✓ PASS" : "✗ FAIL");

// Test 2: Detection with array system
const body2 = {
    model: "claude-3-5-sonnet-20241022",
    system: [
        { type: "text", text: "You are a helpful assistant" }
    ],
    messages: [
        { role: "user", content: "Hello" }
    ]
};
console.log("Test 2 - Array system + messages:", anthropicFormat.detect(body2) ? "✓ PASS" : "✗ FAIL");

// Test 3: Should NOT detect OpenAI (no system)
const body3 = {
    model: "gpt-4",
    messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" }
    ]
};
console.log("Test 3 - OpenAI format (no detect):", !anthropicFormat.detect(body3) ? "✓ PASS" : "✗ FAIL");

// Test 4: System injection with string
const body4 = {
    system: "Original system",
    messages: []
};
anthropicFormat.injectSystemMessage(body4, "Injected message");
console.log("Test 4 - Inject into string system:", 
    Array.isArray(body4.system) && body4.system.length === 2 ? "✓ PASS" : "✗ FAIL");

// Test 5: System injection with array
const body5 = {
    system: [{ type: "text", text: "Original" }],
    messages: []
};
anthropicFormat.injectSystemMessage(body5, "Injected");
console.log("Test 5 - Inject into array system:", 
    body5.system.length === 2 && body5.system[1].text === "Injected" ? "✓ PASS" : "✗ FAIL");

// Test 6: Tool result extraction
const body6 = {
    messages: [
        {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: "toolu_123",
                    content: "Result data"
                }
            ]
        }
    ]
};
const mockState = {
    toolParameters: new Map([["toolu_123", { tool: "test_tool" }]])
};
const outputs = anthropicFormat.extractToolOutputs(body6.messages, mockState);
console.log("Test 6 - Extract tool outputs:", 
    outputs.length === 1 && outputs[0].id === "toolu_123" ? "✓ PASS" : "✗ FAIL");

// Test 7: Tool output replacement
const body7 = {
    messages: [
        {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: "toolu_456",
                    content: "Original content"
                }
            ]
        }
    ]
};
const replaced = anthropicFormat.replaceToolOutput(body7.messages, "toolu_456", "[PRUNED]", mockState);
console.log("Test 7 - Replace tool output:", 
    replaced && body7.messages[0].content[0].content === "[PRUNED]" ? "✓ PASS" : "✗ FAIL");

console.log("\nAll tests completed!");
