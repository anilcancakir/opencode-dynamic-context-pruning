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
