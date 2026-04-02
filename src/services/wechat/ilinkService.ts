/**
 * WeChat iLink Bot HTTP API Service
 * 协议文档: https://www.wechatbot.dev/zh/protocol
 */

import axios, { type AxiosInstance } from 'axios'
import crypto from 'crypto'

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const POLL_TIMEOUT_MS = 35_000 // 长轮询 35 秒

export interface LoginQRCode {
  qrcode_url: string
  qrcode_id: string
}

export interface LoginResult {
  bot_token: string
  baseurl: string
  app_id: string
}

export interface QRCodeStatus {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired'
  bot_token?: string
  baseurl?: string
}

export interface Message {
  msg_id: string
  msg_type: 'text' | 'image' | 'video' | 'audio' | 'file'
  content: string
  from_username: string
  to_username: string
  create_time: number
  context_token?: string
}

export interface SendMessageResult {
  msg_id: string
  ret: number
}

export interface GetUpdatesResult {
  ret: number
  get_updates_buf: string
  messages: Message[]
}

export class WechatILinkService {
  private http: AxiosInstance
  private botToken?: string
  private baseUrl: string
  private contextTokenMap: Map<string, string> = new Map() // userId -> contextToken
  private getUpdatesBuf: string = ''

  constructor() {
    this.baseUrl = ILINK_BASE_URL
    this.http = this.createHttpClient()
  }

  private createHttpClient(): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl,
      timeout: POLL_TIMEOUT_MS + 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  private generateXWechatUin(): string {
    const randomBytes = crypto.randomBytes(4)
    const uint32 = randomBytes.readUInt32BE(0)
    return Buffer.from(String(uint32)).toString('base64')
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.botToken}`,
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': this.generateXWechatUin(),
    }
  }

  private getBaseInfo() {
    return { base_info: { channel_version: '2.0.0' } }
  }

  /**
   * 获取登录二维码
   */
  async getQRCode(): Promise<LoginQRCode> {
    const response = await this.http.get('/get_bot_qrcode', {
      params: { bot_type: 3 },
    })
    return {
      qrcode_url: response.data.qrcode_url,
      qrcode_id: response.data.qrcode_id,
    }
  }

  /**
   * 轮询扫码状态
   */
  async getQRCodeStatus(qrcodeId: string): Promise<QRCodeStatus> {
    const response = await this.http.get('/get_qrcode_status', {
      params: { qrcode: qrcodeId },
      headers: this.getAuthHeaders(),
    })

    return {
      status: response.data.status,
      bot_token: response.data.bot_token,
      baseurl: response.data.baseurl,
    }
  }

  /**
   * 完成登录并保存 token
   */
  async confirmLogin(qrcodeId: string): Promise<LoginResult> {
    // 等待扫码确认
    while (true) {
      const status = await this.getQRCodeStatus(qrcodeId)

      if (status.status === 'confirmed' && status.bot_token && status.baseurl) {
        this.botToken = status.bot_token
        this.baseUrl = status.baseurl
        this.http = this.createHttpClient()

        return {
          bot_token: status.bot_token,
          baseurl: status.baseurl,
          app_id: status.bot_token.split(':')[0] ?? '',
        }
      }

      if (status.status === 'expired') {
        throw new Error('二维码已过期，请重新获取')
      }

      // 等待 1 秒后重试
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  /**
   * 长轮询获取新消息
   */
  async getUpdates(): Promise<GetUpdatesResult> {
    if (!this.botToken) {
      throw new Error('未登录，请先执行 wechat login')
    }

    const response = await this.http.post(
      '/getupdates',
      {
        ...this.getBaseInfo(),
        get_updates_buf: this.getUpdatesBuf,
      },
      {
        headers: this.getAuthHeaders(),
        timeout: POLL_TIMEOUT_MS,
      },
    )

    const data = response.data

    if (data.ret === -14 || data.ret === -2) {
      // 会话过期或参数错误，抛出错误让调用方处理
      throw new Error(`会话过期 (ret: ${data.ret})，请重新登录`)
    }

    // 保存游标用于下次请求
    this.getUpdatesBuf = data.get_updates_buf ?? ''

    return {
      ret: data.ret,
      get_updates_buf: data.get_updates_buf,
      messages: data.msgs ?? [],
    }
  }

  /**
   * 发送文本消息
   */
  async sendTextMessage(
    toUsername: string,
    content: string,
    contextToken?: string,
  ): Promise<SendMessageResult> {
    if (!this.botToken) {
      throw new Error('未登录')
    }

    const response = await this.http.post(
      '/sendmessage',
      {
        ...this.getBaseInfo(),
        context_token: contextToken ?? this.contextTokenMap.get(toUsername),
        to_username: toUsername,
        msg_type: 'text',
        content,
      },
      {
        headers: this.getAuthHeaders(),
      },
    )

    return {
      msg_id: response.data.msg_id,
      ret: response.data.ret,
    }
  }

  /**
   * 获取 typing_ticket
   */
  async getConfig(toUsername: string): Promise<{ typing_ticket: string }> {
    if (!this.botToken) {
      throw new Error('未登录')
    }

    const response = await this.http.post(
      '/getconfig',
      {
        ...this.getBaseInfo(),
        to_username: toUsername,
      },
      {
        headers: this.getAuthHeaders(),
      },
    )

    return {
      typing_ticket: response.data.typing_ticket,
    }
  }

  /**
   * 显示/隐藏输入状态
   */
  async sendTyping(
    toUsername: string,
    status: 1 | 2, // 1=开始输入, 2=停止输入
    typingTicket: string,
  ): Promise<void> {
    if (!this.botToken) {
      throw new Error('未登录')
    }

    await this.http.post(
      '/sendtyping',
      {
        ...this.getBaseInfo(),
        to_username: toUsername,
        typing_ticket: typingTicket,
        status,
      },
      {
        headers: this.getAuthHeaders(),
      },
    )
  }

  /**
   * 保存 context_token
   */
  saveContextToken(userId: string, contextToken: string): void {
    this.contextTokenMap.set(userId, contextToken)
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn(): boolean {
    return !!this.botToken
  }

  /**
   * 获取上传媒体 URL
   */
  async getUploadUrl(
    fileName: string,
    fileSize: number,
    contentType: string,
  ): Promise<{ upload_url: string; video_url: string }> {
    if (!this.botToken) {
      throw new Error('未登录')
    }

    const response = await this.http.post(
      '/getuploadurl',
      {
        ...this.getBaseInfo(),
        file_name: fileName,
        file_size: fileSize,
        content_type: contentType,
      },
      {
        headers: this.getAuthHeaders(),
      },
    )

    return {
      upload_url: response.data.upload_url,
      video_url: response.data.video_url,
    }
  }

  /**
   * 上传媒体文件
   */
  async uploadMedia(
    uploadUrl: string,
    data: Buffer,
    secretKey: string,
  ): Promise<void> {
    const encrypted = this.encryptMedia(data, secretKey)

    await axios.post(uploadUrl, encrypted, {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })
  }

  /**
   * AES-128-ECB 加密媒体
   */
  private encryptMedia(data: Buffer, secretKey: string): Buffer {
    // 解析密钥
    let key: Buffer
    if (secretKey.length === 32) {
      // 十六进制字符串
      key = Buffer.from(secretKey, 'hex')
    } else if (secretKey.length === 24) {
      // base64
      key = Buffer.from(secretKey, 'base64')
    } else {
      throw new Error('无效的密钥格式')
    }

    const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
    cipher.setAutoPadding(true)

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    return encrypted
  }

  /**
   * 登出
   */
  logout(): void {
    this.botToken = undefined
    this.baseUrl = ILINK_BASE_URL
    this.contextTokenMap.clear()
    this.getUpdatesBuf = ''
    this.http = this.createHttpClient()
  }

  /**
   * 获取当前 bot token（仅用于调试/存储）
   */
  getBotToken(): string | undefined {
    return this.botToken
  }

  /**
   * 获取当前 baseurl
   */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /**
   * 从保存的数据恢复会话
   */
  restoreSession(botToken: string, baseUrl: string): void {
    this.botToken = botToken
    this.baseUrl = baseUrl
    this.http = this.createHttpClient()
  }
}

// 导出单例
export const wechatService = new WechatILinkService()
