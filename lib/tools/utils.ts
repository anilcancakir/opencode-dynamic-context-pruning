import { partial_ratio } from "fuzzball"
import type { WithParts, CompressSummary } from "../state"
import type { Logger } from "../logger"

/**
 * Configuration for fuzzy matching behavior
 */
export interface FuzzyConfig {
    minScore: number // Minimum score to accept (0-100)
    minGap: number // Minimum gap between best and second-best match
}

export const DEFAULT_FUZZY_CONFIG: FuzzyConfig = {
    minScore: 85,
    minGap: 15,
}

interface MatchResult {
    messageId: string
    messageIndex: number
    score: number
    matchType: "exact" | "fuzzy"
}

/**
 * Extracts all textual content from a message for matching purposes.
 * Includes: text, reasoning, tool (input/output), compaction, and subtask parts.
 */
function extractMessageContent(msg: WithParts): string {
    const parts = Array.isArray(msg.parts) ? msg.parts : []
    let content = ""

    for (const part of parts) {
        const p = part as Record<string, unknown>

        switch (part.type) {
            case "text":
            case "reasoning":
                if (typeof p.text === "string") {
                    content += " " + p.text
                }
                break

            case "tool": {
                const state = p.state as Record<string, unknown> | undefined
                if (!state) break

                // Include tool output (completed or error)
                if (state.status === "completed" && typeof state.output === "string") {
                    content += " " + state.output
                } else if (state.status === "error" && typeof state.error === "string") {
                    content += " " + state.error
                }

                // Include tool input
                if (state.input) {
                    content +=
                        " " +
                        (typeof state.input === "string"
                            ? state.input
                            : JSON.stringify(state.input))
                }
                break
            }

            case "compaction":
                if (typeof p.summary === "string") {
                    content += " " + p.summary
                }
                break

            case "subtask":
                if (typeof p.summary === "string") {
                    content += " " + p.summary
                }
                if (typeof p.result === "string") {
                    content += " " + p.result
                }
                break
        }
    }

    return content
}

/**
 * Find all exact substring matches across messages and compress summaries.
 */
function findExactMatches(
    messages: WithParts[],
    searchString: string,
    compressSummaries: CompressSummary[],
): MatchResult[] {
    const matches: MatchResult[] = []
    const seenMessageIds = new Set<string>()

    // Search compress summaries first
    for (const summary of compressSummaries) {
        if (summary.summary.includes(searchString)) {
            const anchorIndex = messages.findIndex((m) => m.info.id === summary.anchorMessageId)
            if (anchorIndex !== -1 && !seenMessageIds.has(summary.anchorMessageId)) {
                seenMessageIds.add(summary.anchorMessageId)
                matches.push({
                    messageId: summary.anchorMessageId,
                    messageIndex: anchorIndex,
                    score: 100,
                    matchType: "exact",
                })
            }
        }
    }

    // Search raw messages
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (seenMessageIds.has(msg.info.id)) continue

        const content = extractMessageContent(msg)
        if (content.includes(searchString)) {
            seenMessageIds.add(msg.info.id)
            matches.push({
                messageId: msg.info.id,
                messageIndex: i,
                score: 100,
                matchType: "exact",
            })
        }
    }

    return matches
}

/**
 * Find all fuzzy substring matches above the minimum score threshold.
 */
function findFuzzyMatches(
    messages: WithParts[],
    searchString: string,
    compressSummaries: CompressSummary[],
    minScore: number,
): MatchResult[] {
    const matches: MatchResult[] = []
    const seenMessageIds = new Set<string>()

    // Search compress summaries first
    for (const summary of compressSummaries) {
        const score = partial_ratio(searchString, summary.summary)
        if (score >= minScore) {
            const anchorIndex = messages.findIndex((m) => m.info.id === summary.anchorMessageId)
            if (anchorIndex !== -1 && !seenMessageIds.has(summary.anchorMessageId)) {
                seenMessageIds.add(summary.anchorMessageId)
                matches.push({
                    messageId: summary.anchorMessageId,
                    messageIndex: anchorIndex,
                    score,
                    matchType: "fuzzy",
                })
            }
        }
    }

    // Search raw messages
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (seenMessageIds.has(msg.info.id)) continue

        const content = extractMessageContent(msg)
        const score = partial_ratio(searchString, content)
        if (score >= minScore) {
            seenMessageIds.add(msg.info.id)
            matches.push({
                messageId: msg.info.id,
                messageIndex: i,
                score,
                matchType: "fuzzy",
            })
        }
    }

    return matches
}

/**
 * Searches messages for a string and returns the message ID where it's found.
 * Uses exact matching first, then falls back to fuzzy matching with confidence thresholds.
 * Searches in text parts, tool outputs, tool inputs, and compress summaries.
 * Throws an error if no confident match is found.
 */
export function findStringInMessages(
    messages: WithParts[],
    searchString: string,
    logger: Logger,
    compressSummaries: CompressSummary[] = [],
    stringType: "startString" | "endString",
    fuzzyConfig: FuzzyConfig = DEFAULT_FUZZY_CONFIG,
): { messageId: string; messageIndex: number } {
    // ============ PHASE 1: Exact Match ============
    const exactMatches = findExactMatches(messages, searchString, compressSummaries)

    if (exactMatches.length === 1) {
        return { messageId: exactMatches[0].messageId, messageIndex: exactMatches[0].messageIndex }
    }

    if (exactMatches.length > 1) {
        throw new Error(
            `Found multiple exact matches for ${stringType}. ` +
                `Provide more surrounding context to uniquely identify the intended match.`,
        )
    }

    // ============ PHASE 2: Fuzzy Match ============
    const fuzzyMatches = findFuzzyMatches(
        messages,
        searchString,
        compressSummaries,
        fuzzyConfig.minScore,
    )

    if (fuzzyMatches.length === 0) {
        throw new Error(
            `${stringType} not found in conversation (exact or fuzzy). ` +
                `Make sure the string exists and is spelled correctly.`,
        )
    }

    // Sort by score descending to find best match
    fuzzyMatches.sort((a, b) => b.score - a.score)

    const best = fuzzyMatches[0]
    const secondBest = fuzzyMatches[1]

    // Check confidence gap - best must be significantly better than second best
    if (secondBest && best.score - secondBest.score < fuzzyConfig.minGap) {
        throw new Error(
            `Ambiguous fuzzy match for ${stringType}: ` +
                `two candidates scored similarly (${best.score}% vs ${secondBest.score}%). ` +
                `Provide more unique text to disambiguate.`,
        )
    }

    logger.info(
        `Fuzzy matched ${stringType} with ${best.score}% confidence at message index ${best.messageIndex}`,
    )

    return { messageId: best.messageId, messageIndex: best.messageIndex }
}

/**
 * Collects all tool callIDs from messages between start and end indices (inclusive).
 */
export function collectToolIdsInRange(
    messages: WithParts[],
    startIndex: number,
    endIndex: number,
): string[] {
    const toolIds: string[] = []

    for (let i = startIndex; i <= endIndex; i++) {
        const msg = messages[i]
        const parts = Array.isArray(msg.parts) ? msg.parts : []

        for (const part of parts) {
            if (part.type === "tool" && part.callID) {
                if (!toolIds.includes(part.callID)) {
                    toolIds.push(part.callID)
                }
            }
        }
    }

    return toolIds
}

/**
 * Collects all message IDs from messages between start and end indices (inclusive).
 */
export function collectMessageIdsInRange(
    messages: WithParts[],
    startIndex: number,
    endIndex: number,
): string[] {
    const messageIds: string[] = []

    for (let i = startIndex; i <= endIndex; i++) {
        const msgId = messages[i].info.id
        if (!messageIds.includes(msgId)) {
            messageIds.push(msgId)
        }
    }

    return messageIds
}

/**
 * Collects all textual content (text parts, tool inputs, and tool outputs)
 * from a range of messages. Used for token estimation.
 */
export function collectContentInRange(
    messages: WithParts[],
    startIndex: number,
    endIndex: number,
): string[] {
    const contents: string[] = []
    for (let i = startIndex; i <= endIndex; i++) {
        const msg = messages[i]
        const parts = Array.isArray(msg.parts) ? msg.parts : []
        for (const part of parts) {
            if (part.type === "text") {
                contents.push(part.text)
            } else if (part.type === "tool") {
                const toolState = part.state as any
                if (toolState?.input) {
                    contents.push(
                        typeof toolState.input === "string"
                            ? toolState.input
                            : JSON.stringify(toolState.input),
                    )
                }
                if (toolState?.status === "completed" && toolState?.output) {
                    contents.push(
                        typeof toolState.output === "string"
                            ? toolState.output
                            : JSON.stringify(toolState.output),
                    )
                } else if (toolState?.status === "error" && toolState?.error) {
                    contents.push(
                        typeof toolState.error === "string"
                            ? toolState.error
                            : JSON.stringify(toolState.error),
                    )
                }
            }
        }
    }
    return contents
}
