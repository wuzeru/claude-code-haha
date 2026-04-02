import type { Command } from '../../commands.js'

export default (): Command => ({
  type: 'local-jsx',
  name: 'wechat-daemon',
  description: '启动微信 iLink 后台监听服务',
  load: () => import('./wechat-daemon.js'),
})
