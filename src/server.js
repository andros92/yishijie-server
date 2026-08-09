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

function parseJsonSafe(v, fb) {
  if (v === null || v === undefined || v === '') return fb
  try {
    const p = JSON.parse(v)
    return (p === null || p === undefined) ? fb : p
  } catch (e) {
    return fb
  }
}

// 奖励结构：{ coins, items: {key: n}, gear: [inst], pets: [pet] }
// 返回实际发放摘要
function applyRewardsToSave(save, rewards) {
  const applied = { coins: 0, items: {}, gear: 0, pets: 0 }
  if (!rewards || typeof rewards !== 'object') return applied
  if (!save.bag) save.bag = {}
  const coins = Number(rewards.coins) || 0
  if (coins > 0) {
    setCoins(save, getCoins(save) + coins)
    applied.coins = coins
  }
  if (rewards.items && typeof rewards.items === 'object') {
    for (const k of Object.keys(rewards.items)) {
      const n = Math.max(1, parseInt(rewards.items[k], 10) || 1)
      save.bag[k] = (save.bag[k] || 0) + n
      applied.items[k] = (applied.items[k] || 0) + n
    }
  }
  if (Array.isArray(rewards.gear)) {
    if (!save.gear) save.gear = {}
    for (const g of rewards.gear) {
      if (!g || !g.key) continue
      if (!save.gear[g.key]) save.gear[g.key] = []
      save.gear[g.key].push({
        key: g.key,
        quality: g.quality || 'common',
        affixes: Array.isArray(g.affixes) ? g.affixes : [],
        gem: g.gem || '',
        dur: typeof g.dur === 'number' ? g.dur : 0,
        maxDur: typeof g.maxDur === 'number' ? g.maxDur : 0,
        broken: !!g.broken
      })
      applied.gear++
    }
  }
  if (Array.isArray(rewards.pets)) {
    if (!save.pets) save.pets = { list: [], active: '' }
    for (const p of rewards.pets) {
      if (!p || !p.key) continue
      if (save.pets.list.length >= 6) break
      const np = { key: p.key, name: p.name || p.key, lv: Number(p.lv) || 1, exp: Number(p.exp) || 0, boss: !!p.boss, elite: !!p.elite }
      if (p.id) np.id = p.id
      save.pets.list.push(np)
      applied.pets++
    }
  }
  return applied
}

// 宠物战力（与手环端 pets.js 口径一致，用于排行榜/挂单展示）
function petPower(pet) {
  const lv = Number(pet && pet.lv) || 1
  const coef = pet && pet.boss ? 6 : (pet && pet.elite ? 5 : 4)
  return 6 + lv * coef
}

function ratingOf(row) {
  return row ? (Number(row.rating) || 1000) : 1000
}

async function getRatingRow(playerId) {
  const [rows] = await pool.query('SELECT * FROM pvp_ratings WHERE player_id = ? LIMIT 1', [playerId])
  return rows.length ? rows[0] : null
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
    const { playerId, deviceFingerprint, apiKey, key, name, img, qty, price, quality, dur, maxDur, category, pet } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!key || !(qty > 0) || !(price > 0)) return json(res, 400, { error: '参数不完整' })
    const save = await readSave(user.player_id)
    if (!save) return json(res, 400, { error: '没有存档' })
    if (category === 'pet') {
      // 宠物挂单：按 id（兼容旧档按 key+lv+exp）从宠物背包移除
      if (!pet || !pet.key) return json(res, 400, { error: '宠物数据不完整' })
      const pets = (save.pets && save.pets.list) || []
      let idx = -1
      if (pet.id) idx = pets.findIndex(p => p && p.id === pet.id)
      if (idx < 0) idx = pets.findIndex(p => p && p.key === pet.key && Number(p.lv || 1) === (Number(pet.lv) || 1) && Number(p.exp || 0) === (Number(pet.exp) || 0))
      if (idx < 0) return json(res, 400, { error: '宠物背包里没有这只宠物' })
      const p = pets.splice(idx, 1)[0]
      if (!p.id) p.id = 'pet_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
      if (save.pets && save.pets.active === p.key) save.pets.active = ''
      await writeSave(user.player_id, save)
      const [r] = await pool.query(
        'INSERT INTO exchange_listings (seller_id, seller_name, item_key, item_name, category, pet_json, item_img, qty, price, quality, affix_json, gem, dur, max_dur, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user.player_id, user.player_name, key, name || key, 'pet', JSON.stringify(p), img || '', 1, price, '', null, '', 0, 0, 0]
      )
      return json(res, 200, { success: true, listingId: r.insertId })
    }
    const isGear = !!(quality || dur || maxDur)
    const listing = {
      item_key: key,
      item_name: name || key,
      category: isGear ? 'gear' : 'item',
      item_img: img || '',
      qty: isGear ? 1 : qty,
      price: price,
      quality: '', affix_json: null, gem: '', dur: 0, max_dur: 0, broken: 0
    }
    if (isGear) {
      // 装备：取该 key 的第一件实例做快照，保证品质/宝石/耐久/词条完整，再从存档移除
      const list = (save.gear && save.gear[key]) || []
      const inst = list[0]
      if (!inst) return json(res, 400, { error: '背包里没有这件装备' })
      list.splice(0, 1)
      if (!list.length && save.gear) delete save.gear[key]
      listing.quality = inst.quality || ''
      listing.affix_json = inst.affixes && inst.affixes.length ? JSON.stringify(inst.affixes) : null
      listing.gem = inst.gem || ''
      listing.dur = inst.dur || 0
      listing.max_dur = inst.maxDur || 0
      listing.broken = inst.broken ? 1 : 0
    } else {
      const cur = (save.bag && save.bag[key]) || 0
      if (cur < qty) return json(res, 400, { error: '背包里没有这件物品' })
      save.bag[key] = cur - qty
    }
    await writeSave(user.player_id, save)
    const [r] = await pool.query(
      'INSERT INTO exchange_listings (seller_id, seller_name, item_key, item_name, category, item_img, qty, price, quality, affix_json, gem, dur, max_dur, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.player_id, user.player_name, listing.item_key, listing.item_name, 'item', listing.item_img, listing.qty, price, listing.quality, listing.affix_json, listing.gem, listing.dur, listing.max_dur, listing.broken]
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
    const cat = req.query.category || 'all'
    let sql = 'SELECT * FROM exchange_listings WHERE status = "on"'
    const params = []
    if (cat === 'item' || cat === 'gear' || cat === 'pet') {
      sql += ' AND category = ?'
      params.push(cat)
    }
    const [rows] = await pool.query(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?', params.concat([size, offset]))
    const [[{ total }]] = await pool.query(sql.replace('SELECT * FROM exchange_listings', 'SELECT COUNT(*) AS total'), params)
    // 宠物挂单附上完整宠物数据，方便手环直接渲染
    const data = rows.map(r => {
      if (r.category === 'pet' && r.pet_json) {
        const p = parseJsonSafe(r.pet_json, null)
        if (p) return Object.assign({}, r, { pet: p })
      }
      return r
    })
    return json(res, 200, { success: true, data, total, page, size })
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
    if (listing.category === 'pet') {
      const p = parseJsonSafe(listing.pet_json, null)
      if (!p || !p.key) {
        await conn.rollback()
        return json(res, 400, { error: '宠物数据异常' })
      }
      if (!buyerSave.pets) buyerSave.pets = { list: [], active: '' }
      if (buyerSave.pets.list.length >= 6) {
        await conn.rollback()
        return json(res, 400, { error: '宠物背包已满（最多6只）' })
      }
      buyerSave.pets.list.push({
        key: p.key, name: p.name || p.key, lv: Number(p.lv) || 1, exp: Number(p.exp) || 0,
        boss: !!p.boss, elite: !!p.elite, id: p.id || undefined
      })
    } else {
      addItem(buyerSave, listing, listing.qty)
    }
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
    if (listing.category === 'pet') {
      const p = parseJsonSafe(listing.pet_json, null)
      if (!p || !p.key) return json(res, 400, { error: '宠物数据异常' })
      if (!save.pets) save.pets = { list: [], active: '' }
      if (save.pets.list.length >= 6) return json(res, 400, { error: '宠物背包已满（最多6只）' })
      save.pets.list.push({
        key: p.key, name: p.name || p.key, lv: Number(p.lv) || 1, exp: Number(p.exp) || 0,
        boss: !!p.boss, elite: !!p.elite, id: p.id || undefined
      })
    } else {
      addItem(save, listing, listing.qty)
    }
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

// ============ 邮箱（奖励可包含金币/物品/装备/宠物，参照垃圾佬） ============
app.get('/api/yishijie/mail/:playerId', async (req, res) => {
  try {
    const user = await authUser(req.params.playerId, req.query.deviceFingerprint, req.query.apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      'SELECT id, title, content, coins, rewards_json, claimed, created_at FROM mail WHERE player_id = ? ORDER BY id DESC LIMIT 50',
      [user.player_id]
    )
    const data = rows.map(m => Object.assign({}, m, {
      rewards: parseJsonSafe(m.rewards_json, null)
    }))
    return json(res, 200, { success: true, data })
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
    let applied = { coins: 0, items: {}, gear: 0, pets: 0 }
    if (save) {
      const rewards = parseJsonSafe(mail.rewards_json, { coins: mail.coins || 0 })
      applied = applyRewardsToSave(save, rewards)
      await writeSave(user.player_id, save)
    }
    await pool.query('UPDATE mail SET claimed = 1 WHERE id = ?', [mail.id])
    return json(res, 200, { success: true, coins: applied.coins, applied })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理端发邮件（充值/补偿用）
app.post('/api/yishijie/admin/mail/send', async (req, res) => {
  try {
    const { secret, playerId, title, content, coins, rewards } = req.body || {}
    if (secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    if (!playerId || !title) return json(res, 400, { error: '参数不完整' })
    const rewardsJson = rewards && typeof rewards === 'object' ? JSON.stringify(rewards) : (coins ? JSON.stringify({ coins: Number(coins) || 0 }) : null)
    await pool.query(
      'INSERT INTO mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
      [playerId, title, content || '', Number(coins) || 0, rewardsJson]
    )
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 激活码（参照垃圾佬：兑换后发邮件，领取时发放奖励） ============
app.post('/api/yishijie/redeem/redeem', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, code } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!code) return json(res, 400, { error: '请输入激活码' })
    const c = String(code).trim().toUpperCase()
    const [rows] = await pool.query('SELECT * FROM redeem_codes WHERE code = ? LIMIT 1', [c])
    if (!rows.length) return json(res, 404, { error: '激活码不存在' })
    const cd = rows[0]
    if (cd.expires_at && new Date(cd.expires_at).getTime() < Date.now()) {
      return json(res, 400, { error: '激活码已过期' })
    }
    if (cd.max_uses > 0 && cd.used_count >= cd.max_uses) {
      return json(res, 400, { error: '激活码已被使用完毕' })
    }
    // 唯一约束防重复兑换；先占位后回滚的并发窗口由数据库唯一键兜底
    try {
      await pool.query('INSERT INTO redeem_uses (code, player_id) VALUES (?, ?)', [c, user.player_id])
    } catch (e) {
      return json(res, 400, { error: '您已使用过该激活码' })
    }
    const rewards = parseJsonSafe(cd.rewards_json, null)
    const rewardsJson = rewards && typeof rewards === 'object' ? JSON.stringify(rewards) : '{}'
    await pool.query(
      'INSERT INTO mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
      [user.player_id, '激活码奖励：' + c, '您已成功兑换激活码 ' + c + '，奖励已发放到邮箱，请查收', 0, rewardsJson]
    )
    await pool.query('UPDATE redeem_codes SET used_count = used_count + 1 WHERE code = ?', [c])
    return json(res, 200, { success: true, message: '兑换成功，奖励已发送到邮箱', rewards: rewards || {} })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/admin/code/create', async (req, res) => {
  try {
    const { secret, code, rewards, maxUses, expiresAt, description } = req.body || {}
    if (secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    const c = String(code || '').trim().toUpperCase()
    if (!c || !rewards || typeof rewards !== 'object') return json(res, 400, { error: '缺少激活码或奖励内容' })
    await pool.query(
      'INSERT INTO redeem_codes (code, rewards_json, max_uses, expires_at, description) VALUES (?, ?, ?, ?, ?)',
      [c, JSON.stringify(rewards), Math.max(1, parseInt(maxUses, 10) || 1), expiresAt || null, String(description || '')]
    )
    return json(res, 200, { success: true, message: '激活码创建成功' })
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return json(res, 409, { error: '激活码已存在' })
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/code/list', async (req, res) => {
  try {
    if (req.query.secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    const [rows] = await pool.query('SELECT code, max_uses, used_count, expires_at, description, created_at FROM redeem_codes ORDER BY created_at DESC')
    return json(res, 200, { success: true, codes: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.delete('/api/yishijie/admin/code/:code', async (req, res) => {
  try {
    if (req.query.secret !== SECRET) return json(res, 403, { error: '管理密钥错误' })
    const c = decodeURIComponent(req.params.code).toUpperCase()
    await pool.query('DELETE FROM redeem_codes WHERE code = ?', [c])
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 排行榜（等级 / 宠物战力 / 试炼塔） ============
app.get('/api/yishijie/leaderboard', async (req, res) => {
  try {
    const type = req.query.type || 'level'
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const [rows] = await pool.query(
      'SELECT s.player_id, s.data, u.player_name FROM saves s JOIN users u ON u.player_id = s.player_id'
    )
    const list = []
    for (const r of rows) {
      const save = parseJsonSafe(r.data, null)
      if (!save) continue
      if (type === 'tower') {
        const t = parseJsonSafe(save.tower, null)
        list.push({ playerId: r.player_id, playerName: r.player_name, value: t && t.bestFloor ? Number(t.bestFloor) : 0 })
      } else if (type === 'pet') {
        const pets = (save.pets && save.pets.list) || []
        let power = 0
        let topLv = 0
        for (const p of pets) {
          power += petPower(p)
          topLv = Math.max(topLv, Number(p.lv) || 1)
        }
        list.push({ playerId: r.player_id, playerName: r.player_name, value: power, topLv, count: pets.length })
      } else {
        const st = parseJsonSafe(save.stats, null)
        list.push({ playerId: r.player_id, playerName: r.player_name, value: st ? (Number(st.lv) || 1) : 1, exp: st ? (Number(st.exp) || 0) : 0 })
      }
    }
    list.sort((a, b) => (b.value - a.value) || ((b.exp || 0) - (a.exp || 0)))
    return json(res, 200, { success: true, data: list.slice(0, limit) })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ PVP（进攻方打防守方存档快照，AI 代守） ============
app.get('/api/yishijie/pvp/targets', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      'SELECT s.player_id, s.data, u.player_name, r.rating, r.wins, r.losses FROM saves s JOIN users u ON u.player_id = s.player_id LEFT JOIN pvp_ratings r ON r.player_id = s.player_id WHERE s.player_id <> ?',
      [user.player_id]
    )
    const list = []
    for (const r of rows) {
      const save = parseJsonSafe(r.data, null)
      if (!save) continue
      const st = parseJsonSafe(save.stats, null)
      list.push({
        playerId: r.player_id,
        playerName: r.player_name,
        rating: r.rating ? Number(r.rating) : 1000,
        lv: st ? (Number(st.lv) || 1) : 1
      })
    }
    list.sort((a, b) => b.rating - a.rating)
    return json(res, 200, { success: true, data: list.slice(0, 50) })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/pvp/defender', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, targetId } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!targetId || targetId === user.player_id) return json(res, 400, { error: '目标无效' })
    const save = await readSave(targetId)
    if (!save) return json(res, 404, { error: '该玩家暂无存档' })
    const [u] = await pool.query('SELECT player_name FROM users WHERE player_id = ? LIMIT 1', [targetId])
    const rating = await getRatingRow(targetId)
    return json(res, 200, {
      success: true,
      defender: {
        playerId: targetId,
        playerName: u.length ? u[0].player_name : '未知玩家',
        rating: ratingOf(rating),
        class: parseJsonSafe(save.class, null),
        stats: parseJsonSafe(save.stats, null),
        equip: parseJsonSafe(save.equip, null),
        gear: parseJsonSafe(save.gear, null),
        pets: parseJsonSafe(save.pets, { list: [], active: '' })
      }
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/pvp/report', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, targetId, win } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!targetId || targetId === user.player_id) return json(res, 400, { error: '目标无效' })
    const [tu] = await pool.query('SELECT player_id FROM users WHERE player_id = ? LIMIT 1', [targetId])
    if (!tu.length) return json(res, 404, { error: '目标玩家不存在' })
    const winFlag = !!win
    const ra = await getRatingRow(user.player_id)
    const rd = await getRatingRow(targetId)
    const Ra = ratingOf(ra)
    const Rd = ratingOf(rd)
    const expectedA = 1 / (1 + Math.pow(10, (Rd - Ra) / 400))
    const delta = Math.max(1, Math.round(32 * ((winFlag ? 1 : 0) - expectedA)))
    const newRa = Math.max(0, Ra + delta)
    const newRd = Math.max(0, Rd - delta)
    await pool.query(
      'INSERT INTO pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [user.player_id, newRa, winFlag ? 1 : 0, winFlag ? 0 : 1]
    )
    await pool.query(
      'INSERT INTO pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [targetId, newRd, winFlag ? 0 : 1, winFlag ? 1 : 0]
    )
    await pool.query(
      'INSERT INTO pvp_matches (attacker_id, defender_id, attacker_win, rating_delta) VALUES (?, ?, ?, ?)',
      [user.player_id, targetId, winFlag ? 1 : 0, delta]
    )
    return json(res, 200, { success: true, rating: newRa, delta, win: winFlag })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/pvp/rating', async (req, res) => {
  try {
    const { playerId } = req.query
    if (!playerId) return json(res, 400, { error: '缺少玩家ID' })
    const row = await getRatingRow(playerId)
    return json(res, 200, { success: true, rating: ratingOf(row), wins: row ? Number(row.wins) : 0, losses: row ? Number(row.losses) : 0 })
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
