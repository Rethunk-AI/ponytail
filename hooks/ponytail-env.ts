// The only module that reads process.env. Getters return undefined for unset or empty
// variables, except the two boolean flags, where an empty value means "off" and must be
// told apart from unset.

function read(name: string): string | undefined {
  const value = process.env[name]
  return value === '' ? undefined : value
}

export const getXdgConfigHome = (): string | undefined => read('XDG_CONFIG_HOME')
export const getAppData = (): string | undefined => read('APPDATA')
export const getClaudeConfigDir = (): string | undefined => read('CLAUDE_CONFIG_DIR')
export const getQoderConfigDir = (): string | undefined => read('QODER_CONFIG_DIR')
export const getCodeBuddyConfigDir = (): string | undefined => read('CODEBUDDY_CONFIG_DIR')
export const getPonytailDefaultMode = (): string | undefined => read('PONYTAIL_DEFAULT_MODE')
export const getPonytailSubagentMatcher = (): string | undefined =>
  read('PONYTAIL_SUBAGENT_MATCHER')
export const getCopilotPluginData = (): string | undefined => read('COPILOT_PLUGIN_DATA')
export const getPluginData = (): string | undefined => read('PLUGIN_DATA')
export const getClaudePluginRoot = (): string | undefined => read('CLAUDE_PLUGIN_ROOT')
export const getCodeBuddyPluginRoot = (): string | undefined => read('CODEBUDDY_PLUGIN_ROOT')
export const getQoderSessionId = (): string | undefined => read('QODER_SESSION_ID')
export const getCursorVersion = (): string | undefined => read('CURSOR_VERSION')
export const getCursorProjectDir = (): string | undefined => read('CURSOR_PROJECT_DIR')
export const getClaudeProjectDir = (): string => (read('CLAUDE_PROJECT_DIR') ?? '').trim()
export const getGithubRefType = (): string | undefined => read('GITHUB_REF_TYPE')
export const getGithubRefName = (): string | undefined => read('GITHUB_REF_NAME')

// Unset is distinct from empty: PONYTAIL_QUIET_STARTUP= means "show it".
export const getPonytailQuietStartup = (): string | undefined => process.env.PONYTAIL_QUIET_STARTUP
export const getPonytailHideStatus = (): string | undefined => process.env.PONYTAIL_HIDE_STATUS
