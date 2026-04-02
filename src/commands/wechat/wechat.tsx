import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text } from 'ink'
import QRCode from 'qrcode'
import { wechatService, type LoginQRCode } from '../../services/wechat/ilinkService.js'
import { saveWechatSession, loadWechatSession, clearWechatSession } from './sessionStorage.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

type Step = 'menu' | 'qr_display' | 'qr_wait_scan' | 'qr_wait_confirm' | 'success' | 'error'

interface Props {
  onDone: () => void
}

export const call: LocalJSXCommandCall = (onDone) => {
  return Promise.resolve(<WechatCommand onDone={onDone} />)
}

const WechatCommand: React.FC<Props> = ({ onDone }) => {
  const [step, setStep] = useState<Step>('menu')
  const [qrcodeUrl, setQrcodeUrl] = useState<string>('')
  const [qrcodeId, setQrcodeId] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [inputValue, setInputValue] = useState('')

  // 检查已保存的会话
  useEffect(() => {
    const saved = loadWechatSession()
    if (saved && !wechatService.isLoggedIn()) {
      try {
        wechatService.restoreSession(saved.botToken, saved.baseUrl)
        setIsLoggedIn(true)
      } catch {
        clearWechatSession()
      }
    } else if (wechatService.isLoggedIn()) {
      setIsLoggedIn(true)
    }
  }, [])

  // 获取二维码
  const fetchQRCode = useCallback(async () => {
    try {
      setErrorMsg('')
      const result: LoginQRCode = await wechatService.getQRCode()
      setQrcodeId(result.qrcode_id)
      setQrcodeUrl(result.qrcode_url)
      setStep('qr_display')
    } catch (err: any) {
      setErrorMsg(`获取二维码失败: ${err.message}`)
      setStep('error')
    }
  }, [])

  // 轮询扫码状态
  useEffect(() => {
    if (step !== 'qr_display' && step !== 'qr_wait_scan' && step !== 'qr_wait_confirm') return
    if (!qrcodeId) return

    const pollStatus = async () => {
      try {
        const status = await wechatService.getQRCodeStatus(qrcodeId)

        if (status.status === 'scaned') {
          setStep('qr_wait_confirm')
        } else if (status.status === 'confirmed' && status.bot_token && status.baseurl) {
          // 登录成功
          saveWechatSession(status.bot_token, status.baseurl)
          setIsLoggedIn(true)
          setStep('success')
        } else if (status.status === 'expired') {
          setErrorMsg('二维码已过期，请重新获取')
          setStep('error')
        }
      } catch (err: any) {
        setErrorMsg(`检查状态失败: ${err.message}`)
        setStep('error')
      }
    }

    // 刚显示二维码时等待扫码
    if (step === 'qr_display') {
      // 等待 500ms 后开始轮询
      const timer = setTimeout(() => setStep('qr_wait_scan'), 500)
      return () => clearTimeout(timer)
    }

    const interval = setInterval(pollStatus, 1000)
    return () => clearInterval(interval)
  }, [step, qrcodeId])

  // 处理用户输入
  const handleInput = useCallback((input: string) => {
    const cmd = input.trim().toLowerCase()

    if (step === 'menu') {
      if (cmd === '1' || cmd === 'login') {
        fetchQRCode()
      } else if (cmd === '2' || cmd === 'logout') {
        if (isLoggedIn) {
          wechatService.logout()
          clearWechatSession()
          setIsLoggedIn(false)
        }
      } else if (cmd === '0' || cmd === 'q' || cmd === 'exit') {
        onDone()
      } else if (cmd === '' && isLoggedIn) {
        onDone()
      }
    } else if (step === 'error') {
      setStep('menu')
    } else if (step === 'success') {
      onDone()
    }
  }, [step, isLoggedIn, fetchQRCode, onDone])

  // 渲染菜单
  if (step === 'menu') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>微信 iLink 绑定</Text>
        <Text dimColor>将 Claude Code 与微信机器人绑定，通过微信与 AI 对话</Text>
        <Box marginY={1}>
          <Text>状态: {isLoggedIn ? '✅ 已绑定' : '❌ 未绑定'}</Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Text>请选择操作:</Text>
          <Text dimColor>  1. 绑定微信（扫码登录）</Text>
          {isLoggedIn && <Text dimColor>  2. 解除绑定</Text>}
          <Text dimColor>  0. 返回</Text>
        </Box>

        <Box marginTop={1}>
          <Text>输入选项编号: </Text>
        </Box>
        <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleInput} />
      </Box>
    )
  }

  // 显示二维码
  if (step === 'qr_display' || step === 'qr_wait_scan' || step === 'qr_wait_confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>请使用微信扫描二维码</Text>
        <Text dimColor>扫描下方二维码完成绑定:</Text>
        <Box marginY={1}>
          <QRCodeDisplay url={qrcodeUrl} />
        </Box>

        {step === 'qr_wait_scan' && (
          <Text dimColor>等待扫码中...</Text>
        )}
        {step === 'qr_wait_confirm' && (
          <Text bold color="yellow">✅ 已扫码，请在微信中确认登录</Text>
        )}

        <Box marginTop={1}>
          <Text dimColor>按 0 返回取消</Text>
        </Box>
        <TextInput value={inputValue} onChange={setInputValue} onSubmit={(cmd) => {
          if (cmd === '0') setStep('menu')
        }} />
      </Box>
    )
  }

  // 登录成功
  if (step === 'success') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="green">✅ 绑定成功！</Text>
        <Text dimColor>现在可以通过微信与 Claude Code 对话了</Text>
        <Box marginTop={1}>
          <Text>按回车键返回...</Text>
        </Box>
        <TextInput value={inputValue} onChange={setInputValue} onSubmit={onDone} />
      </Box>
    )
  }

  // 错误
  if (step === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">❌ 操作失败</Text>
        <Text color="red">{errorMsg}</Text>
        <Box marginTop={1}>
          <Text>按回车键重试...</Text>
        </Box>
        <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleInput} />
      </Box>
    )
  }

  return null
}

// 二维码显示组件
const QRCodeDisplay: React.FC<{ url: string }> = ({ url }) => {
  const [qrData, setQrData] = useState<string>('')

  useEffect(() => {
    // 生成终端友好的 ASCII 二维码
    QRCode.toString(url, { type: 'terminal', small: true })
      .then(ascii => setQrData(ascii))
      .catch(err => setQrData(`Error: ${err.message}`))
  }, [url])

  return (
    <Box>
      <Text white>{qrData}</Text>
    </Box>
  )
}

// 简单文本输入组件
const TextInput: React.FC<{
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}> = ({ value, onChange, onSubmit }) => {
  const [displayValue, setDisplayValue] = useState('')

  useEffect(() => {
    setDisplayValue(value)
  }, [value])

  const handleKey = useCallback((input: string) => {
    if (input === '\r' || input === '\n') {
      onSubmit(displayValue)
      setDisplayValue('')
      onChange('')
    } else if (input === '\x7f') { // Backspace
      setDisplayValue(prev => prev.slice(0, -1))
      onChange(displayValue.slice(0, -1))
    } else if (input.length === 1) {
      const newValue = displayValue + input
      setDisplayValue(newValue)
      onChange(newValue)
    }
  }, [displayValue, onChange, onSubmit])

  return (
    <Text>
      {displayValue}
      <Text blink>_</Text>
    </Text>
  )
}

export default WechatCommand
