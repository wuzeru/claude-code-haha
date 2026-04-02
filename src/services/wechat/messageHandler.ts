/**
 * WeChat iLink 消息处理器
 * 负责接收消息、调用 Claude 生成回复、发送响应
 */

import { wechatService, type Message } from './ilinkService.js'
import { queryHaiku } from '../api/claude.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { logError } from '../../utils/log.js'
import { AbortError } from '../../utils/errors.js'

export interface WechatMessageHandlerConfig {
  onMessage?: (msg: Message) => void
  onError?: (err: Error) => void
  onStatusChange?: (status: 'connected' | 'disconnected' | 'error') => void
}

export class WechatMessageHandler {
  private config: WechatMessageHandlerConfig
  private isRunning: boolean = false
  private abortController: AbortController | null = null

  constructor(config: WechatMessageHandlerConfig = {}) {
    this.config = config
  }

  /**
   * 启动消息处理循环
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logError('WechatMessageHandler already running')
      return
    }

    if (!wechatService.isLoggedIn()) {
      throw new Error('未登录微信，请先执行 /wechat 绑定')
    }

    this.isRunning = true
    this.abortController = new AbortController()
    this.config.onStatusChange?.('connected')

    this.runLoop()
  }

  /**
   * 停止消息处理循环
   */
  stop(): void {
    this.isRunning = false
    this.abortController?.abort()
    this.abortController = null
    this.config.onStatusChange?.('disconnected')
  }

  /**
   * 主消息循环
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning && this.abortController) {
      try {
        const result = await wechatService.getUpdates()

        if (result.messages && result.messages.length > 0) {
          for (const msg of result.messages) {
            await this.handleMessage(msg)
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || !this.isRunning) {
          // 正常停止
          break
        }

        logError(`微信消息轮询错误: ${err.message}`)
        this.config.onError?.(err)

        // 会话过期错误
        if (err.message?.includes('-14') || err.message?.includes('会话过期')) {
          this.config.onStatusChange?.('error')
          this.stop()
          break
        }

        // 等待后重试
        await this.sleep(3000)
      }
    }
  }

  /**
   * 处理单条消息
   */
  private async handleMessage(msg: Message): Promise<void> {
    this.config.onMessage?.(msg)

    // 忽略非文本消息（目前只处理文本）
    if (msg.msg_type !== 'text') {
      await this.sendTextMessage(msg.from_username, '目前只支持文本消息', msg.context_token)
      return
    }

    const content = msg.content.trim()
    if (!content) return

    // 保存 context_token
    if (msg.context_token) {
      wechatService.saveContextToken(msg.from_username, msg.context_token)
    }

    try {
      // 显示用户正在输入
      const typingTicket = await this.getTypingTicket(msg.from_username)
      if (typingTicket) {
        await wechatService.sendTyping(msg.from_username, 1, typingTicket)
      }

      // 调用 Claude Haiku 生成回复
      const response = await this.generateResponse(content, msg.context_token)

      // 停止显示输入状态
      if (typingTicket) {
        await wechatService.sendTyping(msg.from_username, 2, typingTicket)
      }

      // 发送回复
      await this.sendTextMessage(msg.from_username, response, msg.context_token)
    } catch (err: any) {
      logError(`生成回复失败: ${err.message}`)
      await this.sendTextMessage(
        msg.from_username,
        `处理消息时出错: ${err.message}`,
        msg.context_token,
      )
    }
  }

  /**
   * 调用 Claude Haiku 生成回复
   */
  private async generateResponse(userMessage: string, contextToken?: string): Promise<string> {
    const systemPrompt = asSystemPrompt([])

    // 构建用户消息，包含微信消息作为上下文
    const userPrompt = `微信用户消息: ${userMessage}\n\n请以 Claude Code 的角色回复这条微信消息。保持简洁、直接。`

    try {
      const result = await queryHaiku({
        systemPrompt,
        userPrompt,
        signal: this.abortController?.signal || new AbortController().signal,
        options: {
          querySource: 'wechat_ilink',
          agents: [],
          isNonInteractiveSession: false,
          hasAppendSystemPrompt: false,
          mcpTools: [],
          enablePromptCaching: false,
        },
      })

      const content = result.message.content
      if (content.length > 0 && 'text' in content[0]) {
        return content[0].text
      }
      return '抱歉，我没有收到有效的回复'
    } catch (err: any) {
      if (err instanceof AbortError) {
        throw err
      }
      logError(`Claude API 调用失败: ${err.message}`)
      return `处理消息时出错: ${err.message}`
    }
  }

  /**
   * 获取 typing_ticket
   */
  private async getTypingTicket(toUsername: string): Promise<string | null> {
    try {
      const result = await wechatService.getConfig(toUsername)
      return result.typing_ticket
    } catch {
      return null
    }
  }

  /**
   * 发送文本消息
   */
  private async sendTextMessage(toUsername: string, content: string, contextToken?: string): Promise<void> {
    try {
      // 如果消息太长，分段发送
      const maxLength = 500
      if (content.length <= maxLength) {
        await wechatService.sendTextMessage(toUsername, content, contextToken)
      } else {
        // 分段发送
        const chunks = this.splitMessage(content, maxLength)
        for (const chunk of chunks) {
          await wechatService.sendTextMessage(toUsername, chunk, contextToken)
          await this.sleep(500) // 避免发送太快
        }
      }
    } catch (err: any) {
      logError(`发送消息失败: ${err.message}`)
    }
  }

  /**
   * 将长消息分割成小块
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLength) {
      // 尝试在句号、逗号或换行处分割
      let splitIndex = remaining.lastIndexOf('\n', maxLength)
      if (splitIndex === -1 || splitIndex === 0) {
        splitIndex = remaining.lastIndexOf('。', maxLength)
      }
      if (splitIndex === -1 || splitIndex === 0) {
        splitIndex = remaining.lastIndexOf('，', maxLength)
      }
      if (splitIndex === -1 || splitIndex === 0) {
        splitIndex = maxLength
      }

      chunks.push(remaining.slice(0, splitIndex + 1))
      remaining = remaining.slice(splitIndex + 1)
    }

    if (remaining.length > 0) {
      chunks.push(remaining)
    }

    return chunks
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  isConnected(): boolean {
    return this.isRunning
  }
}

// 导出单例
export const wechatMessageHandler = new WechatMessageHandler()
