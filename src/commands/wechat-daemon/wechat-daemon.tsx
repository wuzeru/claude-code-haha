import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text } from 'ink'
import { wechatService } from '../../services/wechat/ilinkService.js'
import { WechatMessageHandler } from '../../services/wechat/messageHandler.js'
import { loadWechatSession } from '../wechat/sessionStorage.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { type Message } from '../../services/wechat/ilinkService.js'

type Status = 'starting' | 'checking_session' | 'connecting' | 'connected' | 'error' | 'stopped'

interface Props {
  onDone: () => void
}

export const call: LocalJSXCommandCall = (onDone) => {
  return Promise.resolve(<WechatDaemon onDone={onDone} />)
}

const WechatDaemon: React.FC<Props> = ({ onDone }) => {
  const [status, setStatus] = useState<Status>('starting')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [lastMessage, setLastMessage] = useState<string>('')
  const [messageCount, setMessageCount] = useState(0)

  const messageHandlerRef = React.useRef<WechatMessageHandler | null>(null)

  // 启动服务
  const startService = useCallback(async () => {
    setStatus('checking_session')

    // 检查会话
    const saved = loadWechatSession()
    if (saved && !wechatService.isLoggedIn()) {
      try {
        wechatService.restoreSession(saved.botToken, saved.baseUrl)
      } catch (err: any) {
        setErrorMsg(`恢复会话失败: ${err.message}`)
        setStatus('error')
        return
      }
    }

    if (!wechatService.isLoggedIn()) {
      setErrorMsg('未登录微信，请先执行 /wechat 绑定')
      setStatus('error')
      return
    }

    setStatus('connecting')

    // 创建消息处理器
    const handler = new WechatMessageHandler({
      onMessage: (msg: Message) => {
        setLastMessage(`${msg.from_username}: ${msg.content.slice(0, 50)}...`)
        setMessageCount(prev => prev + 1)
      },
      onError: (err: Error) => {
        setErrorMsg(err.message)
        setStatus('error')
      },
      onStatusChange: (newStatus) => {
        if (newStatus === 'connected') {
          setStatus('connected')
        } else if (newStatus === 'error') {
          setStatus('error')
        } else if (newStatus === 'disconnected') {
          setStatus('stopped')
        }
      },
    })

    messageHandlerRef.current = handler

    try {
      await handler.start()
    } catch (err: any) {
      setErrorMsg(`启动失败: ${err.message}`)
      setStatus('error')
    }
  }, [])

  // 组件挂载时启动
  useEffect(() => {
    startService()

    // 组件卸载时停止服务
    return () => {
      messageHandlerRef.current?.stop()
    }
  }, [startService])

  // 处理用户输入
  const handleInput = useCallback((input: string) => {
    const cmd = input.trim().toLowerCase()

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit' || cmd === '0') {
      messageHandlerRef.current?.stop()
      onDone()
    } else if (cmd === 'r' || cmd === 'restart') {
      messageHandlerRef.current?.stop()
      setStatus('starting')
      setErrorMsg('')
      setLastMessage('')
      setMessageCount(0)
      startService()
    }
  }, [onDone, startService])

  // 渲染
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>微信 iLink 守护进程</Text>
      <Box marginY={1}>
        <Text>状态: </Text>
        {status === 'starting' && <Text color="yellow">启动中...</Text>}
        {status === 'checking_session' && <Text color="yellow">检查会话...</Text>}
        {status === 'connecting' && <Text color="cyan">连接中...</Text>}
        {status === 'connected' && <Text color="green">✅ 已连接</Text>}
        {status === 'error' && <Text color="red">❌ 错误</Text>}
        {status === 'stopped' && <Text color="yellow">已停止</Text>}
      </Box>

      {status === 'connected' && (
        <>
          <Box marginY={1}>
            <Text dimColor>收到消息数: {messageCount}</Text>
          </Box>
          {lastMessage && (
            <Box marginY={1}>
              <Text dimColor>最近消息: {lastMessage}</Text>
            </Box>
          )}
        </>
      )}

      {status === 'error' && (
        <Box marginY={1}>
          <Text color="red">{errorMsg}</Text>
        </Box>
      )}

      <Box marginY={1} flexDirection="column">
        <Text>控制命令:</Text>
        <Text dimColor>  q/quit/exit - 退出守护进程</Text>
        <Text dimColor>  r/restart - 重启服务</Text>
      </Box>

      <Box marginTop={1}>
        <Text>按命令后回车: </Text>
      </Box>
      <TextInput onSubmit={handleInput} />
    </Box>
  )
}

// 简单文本输入组件
const TextInput: React.FC<{ onSubmit: (value: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState('')

  const handleKey = useCallback((input: string) => {
    if (input === '\r' || input === '\n') {
      onSubmit(value)
      setValue('')
    } else if (input === '\x7f') { // Backspace
      setValue(prev => prev.slice(0, -1))
    } else if (input.length === 1) {
      setValue(prev => prev + input)
    }
  }, [value, onSubmit])

  return (
    <Box>
      <Text>{value}_</Text>
    </Box>
  )
}

export default WechatDaemon
