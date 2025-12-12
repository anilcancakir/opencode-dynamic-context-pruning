import type { SessionState, WithParts } from "./state"
import type { Logger } from "./logger"
import type { PluginConfig } from "./config"

export const prune = (
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    messages: WithParts[]
): void => {
    pruneToolOutputs(state, logger, config, messages)
}

const pruneToolOutputs = (
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    messages: WithParts[]
): void => {

}
