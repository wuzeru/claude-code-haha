/**
 * WeChat iLink 会话持久化
 * 保存 bot_token 和 baseurl 到本地文件
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { appDataDir } from 'env-paths'
import { logError } from '../../utils/log.js'

interface WechatSession {
  botToken: string
  baseUrl: string
  createdAt: number
}

const SESSION_FILE = 'wechat-session.json'

function getSessionPath(): string {
  const dir = appDataDir('claude-code-local')
  return join(dir, SESSION_FILE)
}

export function saveWechatSession(botToken: string, baseUrl: string): void {
  try {
    const session: WechatSession = {
      botToken,
      baseUrl,
      createdAt: Date.now(),
    }
    const path = getSessionPath()
    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
  } catch (err) {
    logError(`保存微信会话失败: ${err}`)
  }
}

export function loadWechatSession(): WechatSession | null {
  try {
    const path = getSessionPath()
    if (!existsSync(path)) {
      return null
    }
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as WechatSession
  } catch (err) {
    logError(`加载微信会话失败: ${err}`)
    return null
  }
}

export function clearWechatSession(): void {
  try {
    const path = getSessionPath()
    if (existsSync(path)) {
      unlinkSync(path)
    }
  } catch (err) {
    logError(`清除微信会话失败: ${err}`)
  }
}
