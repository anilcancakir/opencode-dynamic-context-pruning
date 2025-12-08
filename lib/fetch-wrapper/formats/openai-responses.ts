import type { FormatDescriptor, ToolOutput } from "../types"
import type { PluginState } from "../../state"

export const openaiResponsesFormat: FormatDescriptor = {
    name: 'openai-responses',

    detect(body: any): boolean {
        return body.input && Array.isArray(body.input)
    },

    getDataArray(body: any): any[] | undefined {
        return body.input
    },

    injectSystemMessage(body: any, injection: string): boolean {
        if (!injection) return false

        if (body.instructions && typeof body.instructions === 'string') {
            body.instructions = body.instructions + '\n\n' + injection
        } else {
            body.instructions = injection
        }
        return true
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const item of data) {
            if (item.type === 'function_call_output' && item.call_id) {
                const metadata = state.toolParameters.get(item.call_id.toLowerCase())
                outputs.push({
                    id: item.call_id.toLowerCase(),
                    toolName: metadata?.tool ?? item.name
                })
            }
        }

        return outputs
    },

    replaceToolOutput(data: any[], toolId: string, prunedMessage: string, _state: PluginState): boolean {
        const toolIdLower = toolId.toLowerCase()
        let replaced = false

        for (let i = 0; i < data.length; i++) {
            const item = data[i]
            if (item.type === 'function_call_output' && item.call_id?.toLowerCase() === toolIdLower) {
                data[i] = { ...item, output: prunedMessage }
                replaced = true
            }
        }

        return replaced
    },

    hasToolOutputs(data: any[]): boolean {
        return data.some((item: any) => item.type === 'function_call_output')
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalItems: data.length,
            format: 'openai-responses-api'
        }
    }
}
