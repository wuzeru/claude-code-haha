// REPLTool stub - only used when USER_TYPE === 'ant'
// This file is a stub because the actual REPLTool implementation
// is not available in the local build

import type { Tool } from '../../Tool.js'

// Stub implementation - not actually used in local builds
export const REPLTool: Tool = {
  name: 'REPL',
  description: 'REPL tool (stub - ant only)',
  isEnabled: () => false,
  async *run() {
    throw new Error('REPL tool is only available in ant builds')
  },
}
