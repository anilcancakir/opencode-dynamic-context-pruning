import type { SessionState, ToolParameterEntry, WithParts } from "./types"
import type { Logger } from "../logger"
import { loadSessionState } from "./persistence"
import { isSubAgentSession } from "./utils"
import { getLastUserMessage } from "../shared-utils"

export const checkSession = async (
    client: any,
    state: SessionState,
    logger: Logger,
    messages: WithParts[]
): Promise<void> => {

    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage) {
        return
    }

    const lastSessionId = lastUserMessage.info.sessionID

    if (state.sessionId === null || state.sessionId !== lastSessionId) {
        logger.info(`Session changed: ${state.sessionId} -> ${lastSessionId}`)
        try {
            await ensureSessionInitialized(client, state, lastSessionId, logger, messages)
        } catch (err: any) {
            logger.error("Failed to initialize session state", { error: err.message })
        }
    }

    // Always check for compaction on every message check
    const lastCompactionTimestamp = findLastCompactionTimestamp(messages)
    if (lastCompactionTimestamp > state.lastCompaction) {
        state.lastCompaction = lastCompactionTimestamp
        // Clear stale tool data - these tools no longer exist in context
        state.toolParameters.clear()
        state.prune.toolIds = []
        logger.info("Detected compaction from messages - cleared tool cache", { timestamp: lastCompactionTimestamp })
    }
}

export function createSessionState(): SessionState {
    return {
        sessionId: null,
        isSubAgent: false,
        prune: {
            toolIds: []
        },
        stats: {
            pruneTokenCounter: 0,
            totalPruneTokens: 0,
        },
        toolParameters: new Map<string, ToolParameterEntry>(),
        nudgeCounter: 0,
        lastToolPrune: false,
        lastCompaction: 0
    }
}

export function resetSessionState(state: SessionState): void {
    state.sessionId = null
    state.isSubAgent = false
    state.prune = {
        toolIds: []
    }
    state.stats = {
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
    }
    state.toolParameters.clear()
    state.nudgeCounter = 0
    state.lastToolPrune = false
    state.lastCompaction = 0
}

export async function ensureSessionInitialized(
    client: any,
    state: SessionState,
    sessionId: string,
    logger: Logger,
    messages: WithParts[]
): Promise<void> {
    if (state.sessionId === sessionId) {
        return;
    }

    logger.info("session ID = " + sessionId)
    logger.info("Initializing session state", { sessionId: sessionId })

    // Clear previous session data
    resetSessionState(state)
    state.sessionId = sessionId

    const isSubAgent = await isSubAgentSession(client, sessionId)
    state.isSubAgent = isSubAgent
    logger.info("isSubAgent = " + isSubAgent)

    // Load session data from storage
    const persisted = await loadSessionState(sessionId, logger)
    if (persisted === null) {
        return;
    }

    // Populate state with loaded data
    state.prune = {
        toolIds: persisted.prune.toolIds || []
    }
    state.stats = {
        pruneTokenCounter: persisted.stats?.pruneTokenCounter || 0,
        totalPruneTokens: persisted.stats?.totalPruneTokens || 0,
    }
}

function findLastCompactionTimestamp(messages: WithParts[]): number {
    let lastTimestamp = 0
    for (const msg of messages) {
        if (msg.info.role === "assistant" && msg.info.summary === true) {
            const created = msg.info.time.created
            if (created > lastTimestamp) {
                lastTimestamp = created
            }
        }
    }
    return lastTimestamp
}
