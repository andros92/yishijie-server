// 异世界传说 服务端 v0.1
// 参照《开箱游戏 / 对决》服务端：注册/登录、存档同步、交易所、充值
import express from 'express'
import cors from 'cors'
import mysql from 'mysql2/promise'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 手动加载 .env（不额外依赖）
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (!process.env.PORT && fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const PORT = Number(process.env.PORT || 5402)
const HOST = process.env.HOST || '0.0.0.0'
const SECRET = process.env.YS_SECRET || 'change-this-secret'
const COIN_PER_YUAN = Number(process.env.RECHARGE_COIN_PER_YUAN || 10000)
const EXCHANGE_FEE_RATE = 0.10 // 平台手续费 10%
const MAX_BODY = 2 * 1024 * 1024

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'yishijie',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'yishijie',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
})

const app = express()
app.use(cors())
app.use(express.json({ limit: MAX_BODY }))

function json(res, code, obj) {
  return res.status(code).json(obj)
}

function hash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex')
}

function randomPlayerId() {
  return String(Math.floor(10000000 + Math.random() * 89999999))
}

function randomApiKey() {
  return crypto.randomBytes(24).toString('hex')
}

function randomOrderId() {
  return 'YS' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase()
}

function sanitizeName(name) {
  return String(name || '').trim().slice(0, 12)
}

function validFingerprint(fp) {
  return !!(fp && typeof fp === 'string' && fp.length >= 8 && fp !== 'NA' && fp !== 'unknown')
}

function sign(str) {
  return crypto.createHmac('sha256', SECRET).update(String(str)).digest('hex')
}

async function findUserByFp(deviceFp, phoneFp) {
  if (deviceFp) {
    const [rows] = await pool.query('SELECT * FROM users WHERE device_fingerprint = ? LIMIT 1', [deviceFp])
    if (rows.length) return rows[0]
  }
  if (phoneFp) {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone_fingerprint = ? LIMIT 1', [phoneFp])
    if (rows.length) return rows[0]
  }
  return null
}

async function authUser(playerId, deviceFp, apiKey) {
  if (!playerId || !deviceFp || !apiKey) return null
  const [rows] = await pool.query('SELECT * FROM users WHERE player_id = ? AND device_fingerprint = ? AND api_key = ? LIMIT 1', [playerId, deviceFp, apiKey])
  return rows.length ? rows[0] : null
}

async function readSave(playerId) {
  const [rows] = await pool.query('SELECT data FROM saves WHERE player_id = ? LIMIT 1', [playerId])
  if (!rows.length) return null
  try {
    return JSON.parse(rows[0].data)
  } catch (e) {
    return null
  }
}

async function writeSave(playerId, data) {
  await pool.query(
    'INSERT INTO saves (player_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [playerId, JSON.stringify(data)]
  )
}

// ============ 存档内的金币/物品操作 ============
function getCoins(save) {
  return (save && save.bag && typeof save.bag.coin === 'number') ? save.bag.coin : 0
}

function setCoins(save, n) {
  if (!save.bag) save.bag = {}
  save.bag.coin = Math.max(0, Math.round(n))
}

function isGearListing(l) {
  return !!(l.quality || l.dur > 0 || l.max_dur > 0)
}

// 从存档扣除物品：装备按实例扣，普通物品按数量扣
function deductItem(save, listing, qty) {
  const key = listing.item_key
  if (!save.bag) save.bag = {}
  if (isGearListing(listing)) {
    const list = (save.gear && save.gear[key]) || []
    const idx = list.findIndex(g => g && g.quality === (listing.quality || '') && (g.gem || '') === (listing.gem || '') && (g.dur || 0) === (listing.dur || 0))
    if (idx < 0) return false
    list.splice(idx, 1)
    if (!list.length && save.gear) delete save.gear[key]
    return true
  }
  const cur = save.bag[key] || 0
  if (cur < qty) return false
  save.bag[key] = cur - qty
  return true
}

// 向存档加入物品
function addItem(save, listing, qty) {
  if (!save.bag) save.bag = {}
  if (isGearListing(listing)) {
    if (!save.gear) save.gear = {}
    if (!save.gear[listing.item_key]) save.gear[listing.item_key] = []
    save.gear[listing.item_key].push({
      key: listing.item_key,
      quality: listing.quality || 'common',
      affixes: listing.affix_json ? JSON.parse(listing.affix_json) : [],
      gem: listing.gem || '',
      dur: listing.dur || 0,
      maxDur: listing.max_dur || 0,
      broken: !!listing.broken
    })
    return
  }
  save.bag[listing.item_key] = (save.bag[listing.item_key] || 0) + qty
}

// ============ 注册 / 登录 ============
app.post('/api/yishijie/register', async (req, res) => {
  try {
    const { playerName, deviceFingerprint, phoneFingerprint } = req.body || {}
    const name = sanitizeName(playerName)
    if (!name || !validFingerprint(deviceFingerprint)) {
      return json(res, 400, { error: '缺少玩家名称或设备指纹' })
    }
    let fp = deviceFingerprint
    if (fp.length < 16 && !validFingerprint(phoneFingerprint)) {
      return json(res, 400, { error: '设备识别失败，无法注册。请确保手环和手机已正常连接。' })
    }
    if (fp.length < 16 && validFingerprint(phoneFingerprint)) fp = 'phone_' + phoneFingerprint.slice(0, 32)
    const existing = await findUserByFp(fp, phoneFingerprint || '')
    if (existing) {
      if (existing.banned) return json(res, 403, { error: '该账号已被封禁：' + (existing.ban_reason || '违规行为') })
      // 补绑手机指纹
      if (phoneFingerprint && !existing.phone_fingerprint) {
        await pool.query('UPDATE users SET phone_fingerprint = ? WHERE player_id = ?', [phoneFingerprint, existing.player_id])
      }
      return json(res, 200, { success: true, playerId: existing.player_id, playerName: existing.player_name, isNew: false })
    }
    const playerId = randomPlayerId()
    const apiKey = randomApiKey()
    await pool.query(
      'INSERT INTO users (player_id, player_name, device_fingerprint, phone_fingerprint, api_key) VALUES (?, ?, ?, ?, ?)',
      [playerId, name, fp, phoneFingerprint || '', apiKey]
    )
    // 初始空存档
    await writeSave(playerId, { bag: { coin: 0 }, stats: { hp: 100, hunger: 100, mp: 50, lv: 1, exp: 0 }, gear: {}, pets: { list: [], active: '' } })
    return json(res, 200, { success: true, playerId, playerName: name, apiKey, isNew: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/login', async (req, res) => {
  try {
    const { deviceFingerprint, phoneFingerprint } = req.body || {}
    const user = await findUserByFp(validFingerprint(deviceFingerprint) ? deviceFingerprint : '', phoneFingerprint || '')
    if (!user) return json(res, 404, { error: '该设备还没有账号，请先注册' })
    if (user.banned) return json(res, 403, { error: '该账号已被封禁：' + (user.ban_reason || '违规行为') })
    return json(res, 200, { success: true, playerId: user.player_id, playerName: user.player_name, isNew: false })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 存档同步 ============
app.get('/api/yishijie/saves/:playerId', async (req, res) => {
  try {
    const user = await authUser(req.params.playerId, req.query.deviceFingerprint, req.query.apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const data = await readSave(user.player_id)
    return json(res, 200, { success: true, data: data || null })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/saves/:playerId', async (req, res) => {
  try {
    const { deviceFingerprint, apiKey, data } = req.body || {}
    const user = await authUser(req.params.playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!data || typeof data !== 'object') return json(res, 400, { error: '存档数据无效' })
    await writeSave(user.player_id, data)
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 交易所 ============
app.post('/api/yishijie/exchange/list', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, key, name, img, qty, price, quality, affixes, gem, dur, maxDur, broken } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!key || !(qty > 0) || !(price > 0)) return json(res, 400, { error: '参数不完整' })
    const save = await readSave(user.player_id)
    if (!save) return json(res, 400, { error: '没有存档' })
    const listing = {
      item_key: key,
      item_name: name || key,
      item_img: img || '',
      qty: qty,
      price: price,
      quality: quality || '',
      affix_json: affixes && affixes.length ? JSON.stringify(affixes) : null,
      gem: gem || '',
      dur: dur || 0,
      max_dur: maxDur || 0,
      broken: broken ? 1 : 0
    }
    // 先扣物品，扣不掉就不允许挂单
    if (!deductItem(save, listing, qty)) {
      return json(res, 400, { error: '背包里没有这件物品' })
    }
    await writeSave(user.player_id, save)
    const [r] = await pool.query(
      'INSERT INTO exchange_listings (seller_id, seller_name, item_key, item_name, item_img, qty, price, quality, affix_json, gem, dur, max_dur, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.player_id, user.player_name, listing.item_key, listing.item_name, listing.item_img, qty, price, quality || '', listing.affix_json, gem || '', dur || 0, maxDur || 0, broken ? 1 : 0]
    )
    return json(res, 200, { success: true, listingId: r.insertId })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/exchange/listings', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10))
    const size = Math.min(50, Math.max(1, parseInt(req.query.size || '10', 10)))
    const offset = (page - 1) * size
    const [rows] = await pool.query(
      'SELECT * FROM exchange_listings WHERE status = "on" ORDER BY id DESC LIMIT ? OFFSET ?',
      [size, offset]
    )
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM exchange_listings WHERE status = "on"')
    return json(res, 200, { success: true, data: rows, total, page, size })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/exchange/buy', async (req, res) => {
  const conn = await pool.getConnection()
  try {
    const { listingId, buyerId, deviceFingerprint, apiKey } = req.body || {}
    const buyer = await authUser(buyerId, deviceFingerprint, apiKey)
    if (!buyer) return json(res, 403, { error: '鉴权失败' })
    await conn.beginTransaction()
    const [ls] = await conn.query('SELECT * FROM exchange_listings WHERE id = ? AND status = "on" FOR UPDATE', [listingId])
    if (!ls.length) {
      await conn.rollback()
      return json(res, 404, { error: '该挂单不存在或已售出' })
    }
    const listing = ls[0]
    if (listing.seller_id === buyer.player_id) {
      await conn.rollback()
      return json(res, 400, { error: '不能购买自己挂的单' })
    }
    const sellerSave = await readSave(listing.seller_id)
    const buyerSave = await readSave(buyer.player_id)
    if (!buyerSave || getCoins(buyerSave) < listing.price) {
      await conn.rollback()
      return json(res, 400, { error: '金币不足' })
    }
    const fee = Math.floor(listing.price * EXCHANGE_FEE_RATE)
    // 买家扣金币
    setCoins(buyerSave, getCoins(buyerSave) - listing.price)
    // 卖家收金币（扣手续费）
    if (!sellerSave) sellerSave = { bag: { coin: 0 }, gear: {} }
    setCoins(sellerSave, getCoins(sellerSave) + (listing.price - fee))
    // 物品转给买家
    addItem(buyerSave, listing, listing.qty)
    await conn.query('UPDATE exchange_listings SET status = "sold" WHERE id = ?', [listing.id])
    await conn.query(
      'INSERT INTO exchange_trade_history (listing_id, item_key, item_name, qty, price, fee, seller_id, buyer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [listing.id, listing.item_key, listing.item_name, listing.qty, listing.price, fee, listing.seller_id, buyer.player_id]
    )
    await writeSave(listing.seller_id, sellerSave)
    await writeSave(buyer.player_id, buyerSave)
    await conn.commit()
    return json(res, 200, { success: true, fee })
  } catch (e) {
    await conn.rollback()
    return json(res, 500, { error: '服务器错误：' + e.message })
  } finally {
    conn.release()
  }
})

app.post('/api/yishijie/exchange/cancel', async (req, res) => {
  try {
    const { listingId, playerId, deviceFingerprint, apiKey } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [ls] = await pool.query('SELECT * FROM exchange_listings WHERE id = ? AND status = "on" LIMIT 1', [listingId])
    if (!ls.length) return json(res, 404, { error: '该挂单不存在或已售出' })
    const listing = ls[0]
    if (listing.seller_id !== user.player_id) return json(res, 403, { error: '只能撤自己的单' })
    const save = await readSave(user.player_id)
    if (!save) return json(res, 400, { error: '没有存档' })
    addItem(save, listing, listing.qty)
    await writeSave(user.player_id, save)
    await pool.query('UPDATE exchange_listings SET status = "cancelled" WHERE id = ?', [listing.id])
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/exchange/history', async (req, res) => {
  try {
    const { playerId } = req.query
    const [rows] = await pool.query(
      'SELECT * FROM exchange_trade_history WHERE seller_id = ? OR buyer_id = ? ORDER BY id DESC LIMIT 100',
      [playerId, playerId]
    )
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 充值 ============
app.post('/api/yishijie/recharge/order', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, amount, item } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const amt = Number(amount)
    if (!(amt > 0)) return json(res, 400, { error: '金额无效' })
    const it = item === 'diamonds' ? 'diamonds' : 'coins'
    const qty = Math.floor(amt * COIN_PER_YUAN)
    const orderId = randomOrderId()
    await pool.query(
      'INSERT INTO recharge_orders (order_id, player_id, amount, item, qty) VALUES (?, ?, ?, ?, ?)',
      [orderId, user.player_id, amt, it, qty]
    )
    return json(res, 200, { success: true, orderId, amount: amt, item: it, qty })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 支付回调（模拟支付宝：header XS-Sign = hmac(order_id + trade_status, SECRET)）
app.post('/api/yishijie/recharge/callback', async (req, res) => {
  try {
    const { order_id, trade_status } = req.body || {}
    const expect = sign(order_id + '|' + trade_status)
    if ((req.headers['xs-sign'] || '') !== expect) return json(res, 400, { error: '签名错误' })
    if (trade_status !== 'TRADE_SUCCESS' && trade_status !== 'TRADE_FINISHED') return json(res, 200, { success: false })
    await creditOrder(order_id)
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理端手动确认到账（测试用）：POST {orderId, secret}
app.post('/api/yishijie/admin/mark-paid', async (req, res) => {
  try {
    const { orderId, secret } = req.body || {}
    if (secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    await creditOrder(orderId)
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

async function creditOrder(orderId) {
  const [rows] = await pool.query('SELECT * FROM recharge_orders WHERE order_id = ? LIMIT 1', [orderId])
  if (!rows.length) throw new Error('订单不存在')
  const order = rows[0]
  if (order.status === 'paid') return
  const save = await readSave(order.player_id)
  if (save) {
    if (order.item === 'coins') setCoins(save, getCoins(save) + order.qty)
    await writeSave(order.player_id, save)
  }
  await pool.query('UPDATE recharge_orders SET status = "paid", paid_at = NOW() WHERE order_id = ?', [orderId])
}

// ============ 公告 / 版本 / 健康 ============
app.get('/api/yishijie/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM announcements ORDER BY id DESC LIMIT 20')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 邮箱 ============
app.get('/api/yishijie/mail/:playerId', async (req, res) => {
  try {
    const user = await authUser(req.params.playerId, req.query.deviceFingerprint, req.query.apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      'SELECT id, title, content, coins, claimed, created_at FROM mail WHERE player_id = ? ORDER BY id DESC LIMIT 50',
      [user.player_id]
    )
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/mail/claim', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, mailId } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query('SELECT * FROM mail WHERE id = ? AND player_id = ? LIMIT 1', [mailId, user.player_id])
    if (!rows.length) return json(res, 404, { error: '邮件不存在' })
    const mail = rows[0]
    if (mail.claimed) return json(res, 200, { success: true, already: true })
    const save = await readSave(user.player_id)
    if (save && mail.coins > 0) {
      setCoins(save, getCoins(save) + mail.coins)
      await writeSave(user.player_id, save)
    }
    await pool.query('UPDATE mail SET claimed = 1 WHERE id = ?', [mail.id])
    return json(res, 200, { success: true, coins: mail.coins })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理端发邮件（充值/补偿用）
app.post('/api/yishijie/admin/mail/send', async (req, res) => {
  try {
    const { secret, playerId, title, content, coins } = req.body || {}
    if (secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    if (!playerId || !title) return json(res, 400, { error: '参数不完整' })
    await pool.query(
      'INSERT INTO mail (player_id, title, content, coins) VALUES (?, ?, ?, ?)',
      [playerId, title, content || '', Number(coins) || 0]
    )
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/version', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT svalue FROM settings WHERE skey = 'version' LIMIT 1")
    return json(res, 200, { success: true, version: rows.length ? rows[0].svalue : '0.1.0' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/health', (req, res) => json(res, 200, { ok: true }))

// ============ 管理（基础） ============
app.get('/api/yishijie/admin/users', async (req, res) => {
  try {
    if (req.query.secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    const [rows] = await pool.query('SELECT player_id, player_name, created_at, banned FROM users ORDER BY id DESC LIMIT 200')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/listings', async (req, res) => {
  try {
    if (req.query.secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    const [rows] = await pool.query('SELECT * FROM exchange_listings ORDER BY id DESC LIMIT 200')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.listen(PORT, HOST, () => {
  console.log(`[异世界传说] 服务端已启动: http://${HOST}:${PORT}`)
  console.log('  交易所手续费: ' + (EXCHANGE_FEE_RATE * 100) + '%')
  console.log('  充值汇率: 1 元 = ' + COIN_PER_YUAN + ' 金币')
})
