import type { FormatDescriptor, ToolOutput } from "../types"
import type { PluginState } from "../../state"

/**
 * Anthropic Messages API format with top-level `system` array.
 * Tool calls: `tool_use` blocks in assistant content with `id`
 * Tool results: `tool_result` blocks in user content with `tool_use_id`
 */
export const anthropicFormat: FormatDescriptor = {
    name: 'anthropic',

    detect(body: any): boolean {
        return (
            body.system !== undefined &&
            Array.isArray(body.messages)
        )
    },

    getDataArray(body: any): any[] | undefined {
        return body.messages
    },

    injectSystemMessage(body: any, injection: string): boolean {
        if (!injection) return false

        if (typeof body.system === 'string') {
            body.system = [{ type: 'text', text: body.system }]
        } else if (!Array.isArray(body.system)) {
            body.system = []
        }

        body.system.push({ type: 'text', text: injection })
        return true
    },

    appendToLastAssistantMessage(body: any, injection: string): boolean {
        if (!injection || !body.messages || body.messages.length === 0) return false
        
        // Find the last assistant message
        for (let i = body.messages.length - 1; i >= 0; i--) {
            const msg = body.messages[i]
            if (msg.role === 'assistant') {
                // Append to existing content array
                if (Array.isArray(msg.content)) {
                    const firstToolUseIndex = msg.content.findIndex((block: any) => block.type === 'tool_use')
                    if (firstToolUseIndex !== -1) {
                        msg.content.splice(firstToolUseIndex, 0, { type: 'text', text: injection })
                    } else {
                        msg.content.push({ type: 'text', text: injection })
                    }
                } else if (typeof msg.content === 'string') {
                    // Convert string content to array format
                    msg.content = [
                        { type: 'text', text: msg.content },
                        { type: 'text', text: injection }
                    ]
                } else {
                    msg.content = [{ type: 'text', text: injection }]
                }
                return true
            }
        }
        return false
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const m of data) {
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.type === 'tool_result' && block.tool_use_id) {
                        const toolUseId = block.tool_use_id.toLowerCase()
                        const metadata = state.toolParameters.get(toolUseId)
                        outputs.push({
                            id: toolUseId,
                            toolName: metadata?.tool
                        })
                    }
                }
            }
        }

        return outputs
    },

    replaceToolOutput(data: any[], toolId: string, prunedMessage: string, _state: PluginState): boolean {
        const toolIdLower = toolId.toLowerCase()
        let replaced = false

        for (let i = 0; i < data.length; i++) {
            const m = data[i]

            if (m.role === 'user' && Array.isArray(m.content)) {
                let messageModified = false
                const newContent = m.content.map((block: any) => {
                    if (block.type === 'tool_result' && block.tool_use_id?.toLowerCase() === toolIdLower) {
                        messageModified = true
                        return {
                            ...block,
                            content: prunedMessage
                        }
                    }
                    return block
                })
                if (messageModified) {
                    data[i] = { ...m, content: newContent }
                    replaced = true
                }
            }
        }

        return replaced
    },

    hasToolOutputs(data: any[]): boolean {
        for (const m of data) {
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.type === 'tool_result') return true
                }
            }
        }
        return false
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalMessages: data.length,
            format: 'anthropic'
        }
    }
}
