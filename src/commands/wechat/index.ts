import type { Command } from '../../commands.js'

export default (): Command => ({
  type: 'local-jsx',
  name: 'wechat',
  description: '绑定微信 iLink 机器人',
  load: () => import('./wechat.js'),
})
