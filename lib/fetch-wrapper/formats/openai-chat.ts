import type { FormatDescriptor, ToolOutput } from "../types"
import type { PluginState } from "../../state"

export const openaiChatFormat: FormatDescriptor = {
    name: 'openai-chat',

    detect(body: any): boolean {
        return body.messages && Array.isArray(body.messages)
    },

    getDataArray(body: any): any[] | undefined {
        return body.messages
    },

    injectSystemMessage(body: any, injection: string): boolean {
        if (!injection || !body.messages) return false

        let lastSystemIndex = -1
        for (let i = 0; i < body.messages.length; i++) {
            if (body.messages[i].role === 'system') {
                lastSystemIndex = i
            }
        }

        const insertIndex = lastSystemIndex + 1
        body.messages.splice(insertIndex, 0, { role: 'system', content: injection })
        return true
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const m of data) {
            if (m.role === 'tool' && m.tool_call_id) {
                const metadata = state.toolParameters.get(m.tool_call_id.toLowerCase())
                outputs.push({
                    id: m.tool_call_id.toLowerCase(),
                    toolName: metadata?.tool
                })
            }

            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result' && part.tool_use_id) {
                        const metadata = state.toolParameters.get(part.tool_use_id.toLowerCase())
                        outputs.push({
                            id: part.tool_use_id.toLowerCase(),
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

            if (m.role === 'tool' && m.tool_call_id?.toLowerCase() === toolIdLower) {
                data[i] = { ...m, content: prunedMessage }
                replaced = true
            }

            if (m.role === 'user' && Array.isArray(m.content)) {
                let messageModified = false
                const newContent = m.content.map((part: any) => {
                    if (part.type === 'tool_result' && part.tool_use_id?.toLowerCase() === toolIdLower) {
                        messageModified = true
                        return { ...part, content: prunedMessage }
                    }
                    return part
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
            if (m.role === 'tool') return true
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result') return true
                }
            }
        }
        return false
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalMessages: data.length
        }
    }
}
