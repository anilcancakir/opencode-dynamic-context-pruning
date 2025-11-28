import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"
import { homedir } from "os"

export class Logger {
    private logDir: string
    public enabled: boolean
    private fileCounter: number = 0

    constructor(enabled: boolean) {
        this.enabled = enabled
        const opencodeConfigDir = join(homedir(), ".config", "opencode")
        this.logDir = join(opencodeConfigDir, "logs", "dcp")
    }

    private async ensureLogDir() {
        if (!existsSync(this.logDir)) {
            await mkdir(this.logDir, { recursive: true })
        }
    }

    private formatData(data?: any): string {
        if (!data) return ""

        const parts: string[] = []
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) continue

            // Format arrays compactly
            if (Array.isArray(value)) {
                if (value.length === 0) continue
                parts.push(`${key}=[${value.slice(0, 3).join(",")}${value.length > 3 ? `...+${value.length - 3}` : ""}]`)
            }
            else if (typeof value === 'object') {
                const str = JSON.stringify(value)
                if (str.length < 50) {
                    parts.push(`${key}=${str}`)
                }
            }
            else {
                parts.push(`${key}=${value}`)
            }
        }
        return parts.join(" ")
    }

    private async write(level: string, component: string, message: string, data?: any) {
        if (!this.enabled) return

        try {
            await this.ensureLogDir()

            const timestamp = new Date().toISOString()
            const dataStr = this.formatData(data)

            const logLine = `${timestamp} ${level.padEnd(5)} ${component}: ${message}${dataStr ? " | " + dataStr : ""}\n`

            const dailyLogDir = join(this.logDir, "daily")
            if (!existsSync(dailyLogDir)) {
                await mkdir(dailyLogDir, { recursive: true })
            }

            const logFile = join(dailyLogDir, `${new Date().toISOString().split('T')[0]}.log`)
            await writeFile(logFile, logLine, { flag: "a" })
        } catch (error) {
        }
    }

    info(component: string, message: string, data?: any) {
        return this.write("INFO", component, message, data)
    }

    debug(component: string, message: string, data?: any) {
        return this.write("DEBUG", component, message, data)
    }

    warn(component: string, message: string, data?: any) {
        return this.write("WARN", component, message, data)
    }

    error(component: string, message: string, data?: any) {
        return this.write("ERROR", component, message, data)
    }

    private parseJanitorPrompt(prompt: string): {
        instructions: string
        availableToolCallIds: string[]
        sessionHistory: any[]
        responseSchema: any
    } | null {
        try {
            const idsMatch = prompt.match(/Available tool call IDs for analysis:\s*([^\n]+)/)
            const availableToolCallIds = idsMatch
                ? idsMatch[1].split(',').map(id => id.trim())
                : []

            const historyMatch = prompt.match(/Session history[^\n]*:\s*\n([\s\S]*?)\n\nYou MUST respond/)
            let sessionHistory: any[] = []

            if (historyMatch) {
                const historyText = historyMatch[1]

                const fixedJson = this.escapeNewlinesInJson(historyText)
                sessionHistory = JSON.parse(fixedJson)
            }

            const instructionsMatch = prompt.match(/([\s\S]*?)\n\nIMPORTANT: Available tool call IDs/)
            const instructions = instructionsMatch
                ? instructionsMatch[1].trim()
                : ''

            const schemaMatch = prompt.match(/matching this exact schema:\s*\n(\{[\s\S]*?\})\s*$/)
            const responseSchema = schemaMatch
                ? schemaMatch[1]
                : null

            return {
                instructions,
                availableToolCallIds,
                sessionHistory,
                responseSchema
            }
        } catch (error) {
            return null
        }
    }

    private escapeNewlinesInJson(jsonText: string): string {
        let result = ''
        let inString = false

        for (let i = 0; i < jsonText.length; i++) {
            const char = jsonText[i]
            const prevChar = i > 0 ? jsonText[i - 1] : ''

            if (char === '"' && prevChar !== '\\') {
                inString = !inString
                result += char
            } else if (char === '\n' && inString) {
                result += '\\n'
            } else {
                result += char
            }
        }

        return result
    }

    private extractReasoningBlocks(sessionMessages: any[]): any[] {
        const reasoningBlocks: any[] = []

        for (const msg of sessionMessages) {
            if (!msg.parts) continue

            for (const part of msg.parts) {
                if (part.type === "reasoning") {
                    // Calculate encrypted content size for different providers
                    let encryptedContentLength = 0
                    if (part.metadata?.openai?.reasoningEncryptedContent) {
                        encryptedContentLength = part.metadata.openai.reasoningEncryptedContent.length
                    } else if (part.metadata?.anthropic?.signature) {
                        encryptedContentLength = part.metadata.anthropic.signature.length
                    } else if (part.metadata?.google?.thoughtSignature) {
                        encryptedContentLength = part.metadata.google.thoughtSignature.length
                    }

                    reasoningBlocks.push({
                        messageId: msg.id,
                        messageRole: msg.role,
                        text: part.text,
                        textLength: part.text?.length || 0,
                        encryptedContentLength,
                        time: part.time,
                        hasMetadata: !!part.metadata,
                        metadataKeys: part.metadata ? Object.keys(part.metadata) : []
                    })
                }
            }
        }

        return reasoningBlocks
    }

    async saveWrappedContext(sessionID: string, messages: any[], metadata: any, sessionMessages?: any[]) {
        if (!this.enabled) return

        try {
            await this.ensureLogDir()

            const aiContextDir = join(this.logDir, "ai-context")
            if (!existsSync(aiContextDir)) {
                await mkdir(aiContextDir, { recursive: true })
            }

            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
            const counter = (this.fileCounter++).toString().padStart(3, '0')
            const filename = `${timestamp}_${counter}_${sessionID.substring(0, 15)}.json`
            const filepath = join(aiContextDir, filename)

            const isJanitorShadow = sessionID === "janitor-shadow" &&
                messages.length === 1 &&
                messages[0]?.role === 'user' &&
                typeof messages[0]?.content === 'string'

            let content: any

            if (isJanitorShadow) {
                const parsed = this.parseJanitorPrompt(messages[0].content)

                if (parsed) {
                    content = {
                        timestamp: new Date().toISOString(),
                        sessionID,
                        metadata,
                        janitorAnalysis: {
                            instructions: parsed.instructions,
                            availableToolCallIds: parsed.availableToolCallIds,
                            protectedTools: ["task", "todowrite", "todoread"],
                            sessionHistory: parsed.sessionHistory,
                            responseSchema: parsed.responseSchema
                        },
                        rawPrompt: messages[0].content
                    }
                } else {
                    content = {
                        timestamp: new Date().toISOString(),
                        sessionID,
                        metadata,
                        messages,
                        note: "Failed to parse janitor prompt structure"
                    }
                }
            } else {
                // Extract reasoning blocks from session messages if available
                const reasoningBlocks = sessionMessages
                    ? this.extractReasoningBlocks(sessionMessages)
                    : []

                content = {
                    timestamp: new Date().toISOString(),
                    sessionID,
                    metadata,
                    messages,
                    ...(reasoningBlocks.length > 0 && {
                        reasoning: {
                            count: reasoningBlocks.length,
                            totalTextCharacters: reasoningBlocks.reduce((sum, b) => sum + b.textLength, 0),
                            totalEncryptedCharacters: reasoningBlocks.reduce((sum, b) => sum + b.encryptedContentLength, 0),
                            blocks: reasoningBlocks
                        }
                    })
                }
            }

            const jsonString = JSON.stringify(content, null, 2)

            await writeFile(filepath, jsonString)
        } catch (error) {
        }
    }
}
