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
// 管理后台 Basic 认证（与垃圾佬后台一致，/admin 页面 + admin 接口共用）
const ADMIN_USER = process.env.ADMIN_USER || 'shatangju'
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-this-admin-pass'
// ============ 爱发电（与垃圾佬/对决战2 同一套配置） ============
const AFDIAN_URL = process.env.AFDIAN_URL || 'https://www.ifdian.net/item/6684be3293a211f1853d52540025c377'
const AFDIAN_WEBHOOK_TOKEN = process.env.AFDIAN_WEBHOOK_TOKEN || 'pw3N5qWDUV9syFxhSJKufCeAdabrX7Bm'

// 敏感词（参照垃圾佬，用于改名过滤）
const SENSITIVE_WORDS = ['admin', '管理员', '客服', '垃圾', '傻逼', 'sb', 'cnm', 'nmsl', 'fuck', 'shit', '妓', '赌', '毒品', '代练', '外挂', '脚本', '挂机']

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
app.use(express.json({
  limit: MAX_BODY,
  // 保留原始请求体，用于爱发电 webhook HMAC-SHA256 验签
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8') }
}))

function json(res, code, obj) {
  return res.status(code).json(obj)
}

function hash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex')
}

async function nextPlayerId() {
  const [[{ maxId }]] = await pool.query("SELECT COALESCE(MAX(CAST(player_id AS UNSIGNED)), 10000000) AS maxId FROM ysj_users")
  return String(maxId + 1)
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

function sanitizeNickname(name) {
  return String(name || '').replace(/[<>&"'\\/]/g, '').trim().slice(0, 12)
}

function checkAdminAuth(req) {
  const h = req.header('authorization') || ''
  if (h.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(h.slice(6), 'base64').toString()
      const [u, p] = decoded.split(':')
      return u === ADMIN_USER && p === ADMIN_PASS
    } catch (e) {
      return false
    }
  }
  // 兼容 ?secret= 形式（旧管理接口）
  return req.query && req.query.secret === SECRET
}

function requireAdmin(req, res) {
  if (!checkAdminAuth(req)) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"')
    return json(res, 401, { error: '需要管理认证' })
  }
  return true
}

async function checkBannedFingerprint(fp) {
  if (!fp) return false
  const [rows] = await pool.query('SELECT * FROM ysj_banned_fingerprints WHERE fingerprint = ? LIMIT 1', [fp])
  return rows.length ? rows[0] : null
}

// 爱发电 webhook 验签（与对决战2 economyService.verifyWebhookSignature 一致）
function verifyAfdianSignature(rawBody, signature) {
  if (!signature || !AFDIAN_WEBHOOK_TOKEN) return false
  try {
    const expected = crypto.createHmac('sha256', AFDIAN_WEBHOOK_TOKEN).update(String(rawBody)).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))
  } catch (e) {
    return false
  }
}

async function findUserByFp(deviceFp, phoneFp) {
  if (deviceFp) {
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE device_fingerprint = ? LIMIT 1', [deviceFp])
    if (rows.length) return rows[0]
  }
  if (phoneFp) {
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE phone_fingerprint = ? LIMIT 1', [phoneFp])
    if (rows.length) return rows[0]
  }
  return null
}

async function authUser(playerId, deviceFp, apiKey) {
  if (!playerId || !deviceFp || !apiKey) return null
  const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? AND device_fingerprint = ? AND api_key = ? AND banned = 0 LIMIT 1', [playerId, deviceFp, apiKey])
  return rows.length ? rows[0] : null
}

async function readSave(playerId) {
  const [rows] = await pool.query('SELECT data FROM ysj_saves WHERE player_id = ? LIMIT 1', [playerId])
  if (!rows.length) return null
  try {
    return JSON.parse(rows[0].data)
  } catch (e) {
    return null
  }
}

async function writeSave(playerId, data) {
  await pool.query(
    'INSERT INTO ysj_saves (player_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [playerId, JSON.stringify(data)]
  )
}

// 每个玩家的存档写操作串行化：readSave→改→writeSave 不是原子的，
// 并发请求会互相覆盖（交易所双挂单/双买、邮件重复领取、充值重复到账都可能刷出物品）。
// 单进程部署下用内存队列即可；多进程部署需改用数据库行锁。
const playerLocks = new Map()
function withPlayerLock(playerId, fn) {
  const key = String(playerId || '')
  const prev = playerLocks.get(key) || Promise.resolve()
  const run = prev.then(fn, fn)
  playerLocks.set(key, run.catch(() => {}))
  return run
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
        broken: !!g.broken,
        uid: g.uid || undefined
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
  const [rows] = await pool.query('SELECT * FROM ysj_pvp_ratings WHERE player_id = ? LIMIT 1', [playerId])
  return rows.length ? rows[0] : null
}

function todayStr() {
  const d = new Date()
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
}

async function pvpDailyUsed(playerId) {
  const [rows] = await pool.query('SELECT used FROM ysj_pvp_daily WHERE player_id = ? AND day = ? LIMIT 1', [playerId, todayStr()])
  return rows.length ? Number(rows[0].used) : 0
}

// 服务器端对战模拟（房间战用，双方快照 → 战报；与手环匹配战口径接近）
function pvpBuildStats(save) {
  const cls = save && save.class ? save.class : null
  const st = save && save.stats ? save.stats : null
  const eq = save && save.equip ? save.equip : null
  const lv = st && Number(st.lv) > 0 ? Number(st.lv) : 1
  const base = { hp: 80, atk: 8, def: 0, magic: 0, agi: 0, crit: 0, heal: 0 }
  const clsBonus = {
    warrior: { hp: 30, atk: 6, def: 4 },
    knight: { hp: 70, atk: 2, def: 12 },
    priest: { hp: 20, atk: 3, def: 6, heal: 8 },
    mage: { hp: 10, atk: 1, def: 3, magic: 12 }
  }
  const b = cls && cls.key ? (clsBonus[cls.key] || {}) : {}
  const eqAtk = 0
  let atk = base.atk + (lv - 1) + (b.atk || 0) + eqAtk
  const magic = base.magic + (lv - 1) + (b.magic || 0)
  if (cls && cls.key === 'mage') atk = Math.max(1, Math.round(atk * 0.5))
  const pets = (save && save.pets && save.pets.list) || []
  let petDmg = 0
  for (const p of pets.slice(0, 2)) petDmg += petPower(p)
  return {
    maxHp: base.hp + (lv - 1) * 8 + (b.hp || 0),
    atk: Math.max(1, Math.round(atk * 0.9)),
    magic: Math.round(magic * 0.9),
    def: Math.round(((b.def || 0)) * 0.75),
    crit: (b.crit || 0) + (cls && cls.key === 'warrior' ? 5 : 0),
    agi: (b.agi || 0) + (cls && cls.key === 'mage' ? 5 : 0),
    heal: (b.heal || 0),
    petDmg: Math.round(petDmg * 0.8)
  }
}

function pvpSimulate(a, b, aName, bName) {
  let A = { hp: a.maxHp, ...a }
  let B = { hp: b.maxHp, ...b }
  const log = []
  const aFirst = A.agi >= B.agi
  const atk = (who, def) => {
    const raw = Math.max(1, who.atk + (who.magic || 0) - Math.round(def.def * 0.5))
    let dmg = raw
    if (Math.random() * 100 < (who.crit || 0)) dmg = Math.round(dmg * 1.6)
    return Math.max(1, dmg)
  }
  const heal = (who) => (who.heal || 0) > 0 ? Math.round(who.maxHp * who.heal / 100) : 0
  for (let i = 0; i < 60 && A.hp > 0 && B.hp > 0; i++) {
    if (aFirst) {
      const d = atk(A, B); B.hp -= d; log.push(aName + ' 造成 ' + d + ' 伤害')
      if (B.hp <= 0) break
      const h = heal(B); if (h > 0) { B.hp = Math.min(B.maxHp, B.hp + h); log.push(bName + ' 回复 ' + h + ' 生命') }
      const d2 = atk(B, A); A.hp -= d2; log.push(bName + ' 造成 ' + d2 + ' 伤害')
      if (A.hp <= 0) break
      const h2 = heal(A); if (h2 > 0) { A.hp = Math.min(A.maxHp, A.hp + h2); log.push(aName + ' 回复 ' + h2 + ' 生命') }
    } else {
      const d2 = atk(B, A); A.hp -= d2; log.push(bName + ' 造成 ' + d2 + ' 伤害')
      if (A.hp <= 0) break
      const h2 = heal(A); if (h2 > 0) { A.hp = Math.min(A.maxHp, A.hp + h2); log.push(aName + ' 回复 ' + h2 + ' 生命') }
      const d = atk(A, B); B.hp -= d; log.push(aName + ' 造成 ' + d + ' 伤害')
      if (B.hp <= 0) break
      const h = heal(B); if (h > 0) { B.hp = Math.min(B.maxHp, B.hp + h); log.push(bName + ' 回复 ' + h + ' 生命') }
    }
    if (A.petDmg > 0 && B.hp > 0) { const pd = Math.max(1, Math.round(A.petDmg * (0.7 + Math.random() * 0.6))); B.hp -= pd; log.push(aName + ' 的宠物造成 ' + pd + ' 伤害') }
    if (B.petDmg > 0 && A.hp > 0) { const pd = Math.max(1, Math.round(B.petDmg * (0.7 + Math.random() * 0.6))); A.hp -= pd; log.push(bName + ' 的宠物造成 ' + pd + ' 伤害') }
  }
  const aWin = A.hp > 0 && B.hp <= 0
  const draw = A.hp > 0 && B.hp > 0
  log.push(draw ? '平局！' : (aWin ? aName + ' 获胜！' : bName + ' 获胜！'))
  return { aWin, winner: draw ? '' : (aWin ? 'host' : 'guest'), log }
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
        uid: listing.item_uid || undefined,
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
    // 设备黑名单：被封禁的设备不允许注册/登录
    const bfp = await checkBannedFingerprint(fp)
    if (bfp) return json(res, 403, { error: '该设备已被封禁：' + (bfp.reason || '违规行为') + '。如有疑问请联系管理员。' })
    const existing = await findUserByFp(fp, phoneFingerprint || '')
    if (existing) {
      if (existing.banned) return json(res, 403, { error: '该账号已被封禁：' + (existing.ban_reason || '违规行为') })
      // 补绑手机指纹
      if (phoneFingerprint && !existing.phone_fingerprint) {
        await pool.query('UPDATE ysj_users SET phone_fingerprint = ? WHERE player_id = ?', [phoneFingerprint, existing.player_id])
      }
      return json(res, 200, { success: true, playerId: existing.player_id, playerName: existing.player_name, isNew: false })
    }
    const playerId = await nextPlayerId()
    const apiKey = randomApiKey()
    await pool.query(
      'INSERT INTO ysj_users (player_id, player_name, device_fingerprint, phone_fingerprint, api_key) VALUES (?, ?, ?, ?, ?)',
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
    const { deviceFingerprint, apiKey, data, deviceTime } = req.body || {}
    const user = await authUser(req.params.playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!data || typeof data !== 'object') return json(res, 400, { error: '存档数据无效' })
    // 防调时间：客户端设备时间与服务器时间偏差超过 1 小时则拒绝（参照对决 data/ranking 校验）
    const clientTime = Number(deviceTime || 0)
    if (clientTime > 0 && Math.abs(Date.now() - clientTime) > 3600000) {
      return json(res, 403, { error: '时间校验失败，请检查设备时间设置', serverTime: Date.now(), deviceTime: clientTime })
    }
    await writeSave(user.player_id, data)
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 交易所 ============
// 交易所挂单/购买/撤单只允许从手环伴侣通道发起（手机端无背包数据，防止脱离手环刷数据）
function requireCompanionChannel(req, res) {
  if (req.header('x-yishijie-channel') !== 'companion') {
    return json(res, 403, { error: '交易所仅支持手环操作，请连接手机伴侣后从手环进入' })
  }
  return true
}

app.post('/api/yishijie/exchange/list', async (req, res) => {
  try {
    if (!requireCompanionChannel(req, res)) return
    const { playerId, deviceFingerprint, apiKey, key, name, img, qty, price, quality, dur, maxDur, category, pet, uid, petCaseId } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!key || !(qty > 0) || !(price > 0)) return json(res, 400, { error: '参数不完整' })
    // 串行化本玩家的存档读写，防止并发挂单重复扣同一批物品
    return withPlayerLock(user.player_id, async () => {
    const save = await readSave(user.player_id)
    if (!save) return json(res, 400, { error: '没有存档' })
    if (category === 'pet') {
      // 宠物挂单：只能卖装在宠物栏（宠物栏物品）里的宠物，从 survival.pet_cases 移除
      if (!petCaseId) return json(res, 400, { error: '宠物必须装在宠物栏里才能出售' })
      if (!save.pet_cases || !save.pet_cases.list) save.pet_cases = { list: [] }
      const cases = save.pet_cases.list || []
      const ci = cases.findIndex(c => c && c.id === petCaseId)
      if (ci < 0) return json(res, 400, { error: '背包里没有这个宠物栏' })
      const pc = cases.splice(ci, 1)[0]
      const p = pc.pet || {}
      if (!p || !p.key) return json(res, 400, { error: '宠物数据不完整' })
      save.pet_cases.list = cases
      await writeSave(user.player_id, save)
      const [r] = await pool.query(
        'INSERT INTO ysj_exchange_listings (seller_id, seller_name, item_key, item_name, item_uid, category, pet_json, item_img, qty, price, quality, affix_json, gem, dur, max_dur, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user.player_id, user.player_name, p.key, name || p.name || p.key, pc.id || petCaseId, 'pet', JSON.stringify(p), img || '', 1, price, '', null, '', 0, 0, 0]
      )
      return json(res, 200, { success: true, listingId: r.insertId })
    }
    const isGear = category === 'gear' || !!(quality || dur || maxDur)
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
      // 装备：优先按 uid 匹配实例（手环背包直接选择），未带 uid 时兼容取第一件
      const list = (save.gear && save.gear[key]) || []
      let inst = null
      let idx = -1
      if (uid) {
        idx = list.findIndex(g => g && g.uid === uid)
        if (idx >= 0) inst = list[idx]
      } else if (list.length) {
        inst = list[0]
        idx = 0
      }
      if (!inst) return json(res, 400, { error: '背包里没有这件装备' })
      if (!inst.uid) inst.uid = 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6)
      list.splice(idx, 1)
      if (!list.length && save.gear) delete save.gear[key]
      listing.quality = inst.quality || ''
      listing.item_uid = inst.uid
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
      'INSERT INTO ysj_exchange_listings (seller_id, seller_name, item_key, item_name, item_uid, category, item_img, qty, price, quality, affix_json, gem, dur, max_dur, broken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.player_id, user.player_name, listing.item_key, listing.item_name, listing.item_uid || '', listing.category, listing.item_img, listing.qty, price, listing.quality, listing.affix_json, listing.gem, listing.dur, listing.max_dur, listing.broken]
    )
    return json(res, 200, { success: true, listingId: r.insertId })
    })
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
    const mine = req.query.mine === '1'
    const keyword = String(req.query.keyword || '').trim()
    let sql = 'SELECT * FROM ysj_exchange_listings'
    const params = []
    const conds = []
    if (mine) {
      const user = await authUser(req.query.playerId, req.query.deviceFingerprint, req.query.apiKey)
      if (!user) return json(res, 403, { error: '鉴权失败' })
      conds.push('seller_id = ?')
      params.push(user.player_id)
    } else {
      conds.push('status = "on"')
    }
    if (cat === 'item' || cat === 'gear' || cat === 'pet') {
      conds.push('category = ?')
      params.push(cat)
    }
    if (keyword) {
      conds.push('(item_name LIKE ? OR item_uid LIKE ? OR item_key LIKE ?)')
      params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%')
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ')
    const [rows] = await pool.query(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?', params.concat([size, offset]))
    const countSql = 'SELECT COUNT(*) AS total FROM ysj_exchange_listings' + (conds.length ? ' WHERE ' + conds.join(' AND ') : '')
    const [[{ total }]] = await pool.query(countSql, params)
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
  if (!requireCompanionChannel(req, res)) return
  try {
    const { listingId, buyerId, deviceFingerprint, apiKey } = req.body || {}
    const buyer = await authUser(buyerId, deviceFingerprint, apiKey)
    if (!buyer) return json(res, 403, { error: '鉴权失败' })
    const [pre] = await pool.query('SELECT seller_id FROM ysj_exchange_listings WHERE id = ? AND status = "on" LIMIT 1', [listingId])
    if (!pre.length) return json(res, 404, { error: '该挂单不存在或已售出' })
    if (pre[0].seller_id === buyer.player_id) return json(res, 400, { error: '不能购买自己挂的单' })
    // 买家/卖家存档读写都串行化，防止并发购买/挂单/撤单互相覆盖
    // 锁按玩家 ID 排序获取，避免 A买B 与 B买A 同时发生时 AB-BA 死锁
    const lockIds = [buyer.player_id, pre[0].seller_id].sort()
    return withPlayerLock(lockIds[0], () => withPlayerLock(lockIds[1], async () => {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [ls] = await conn.query('SELECT * FROM ysj_exchange_listings WHERE id = ? AND status = "on" FOR UPDATE', [listingId])
        if (!ls.length) {
          await conn.rollback()
          return json(res, 404, { error: '该挂单不存在或已售出' })
        }
        const listing = ls[0]
        if (listing.seller_id !== pre[0].seller_id) {
          await conn.rollback()
          return json(res, 404, { error: '该挂单不存在或已售出' })
        }
        const buyerSave = await readSave(buyer.player_id)
        if (!buyerSave || getCoins(buyerSave) < listing.price) {
          await conn.rollback()
          return json(res, 400, { error: '金币不足' })
        }
        const fee = Math.floor(listing.price * EXCHANGE_FEE_RATE)
        // 买家扣金币（立即入账）
        setCoins(buyerSave, getCoins(buyerSave) - listing.price)
        await writeSave(buyer.player_id, buyerSave)
        // 买家：物品/宠物一律通过邮件发放（不直接写存档，防止被旧档覆盖/刷单）
        const buyerMailRewards = {}
        if (listing.category === 'pet') {
          const p = parseJsonSafe(listing.pet_json, null)
          if (!p || !p.key) {
            await conn.rollback()
            return json(res, 400, { error: '宠物数据异常' })
          }
          buyerMailRewards.pets = [{
            key: p.key, name: p.name || p.key, lv: Number(p.lv) || 1, exp: Number(p.exp) || 0,
            boss: !!p.boss, elite: !!p.elite, id: p.id || undefined
          }]
        } else if (listing.category === 'gear') {
          buyerMailRewards.gear = [{
            key: listing.item_key,
            quality: listing.quality || 'common',
            affixes: parseJsonSafe(listing.affix_json, null) || [],
            gem: listing.gem || '',
            dur: listing.dur || 0,
            maxDur: listing.max_dur || 0,
            broken: !!listing.broken,
            uid: listing.item_uid || ''
          }]
        } else {
          const it = {}
          it[listing.item_key] = listing.qty
          buyerMailRewards.items = it
        }
        await conn.query(
          'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
          [buyer.player_id, '交易购买：' + listing.item_name, '你购买的「' + listing.item_name + '」已到货，请到邮箱领取。', 0, JSON.stringify(buyerMailRewards)]
        )
        // 卖家：扣除手续费后的金币通过邮件发放
        const sellerIncome = listing.price - fee
        await conn.query(
          'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
          [listing.seller_id, '交易收入：' + sellerIncome + ' 金币', '你上架的「' + listing.item_name + '」已售出，扣除 ' + fee + ' 金币手续费后入账，请到邮箱领取。', 0, JSON.stringify({ coins: sellerIncome })]
        )
        await conn.query('UPDATE ysj_exchange_listings SET status = "sold" WHERE id = ?', [listing.id])
        await conn.query(
          'INSERT INTO ysj_exchange_trade_history (listing_id, item_key, item_name, item_uid, qty, price, fee, seller_id, buyer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [listing.id, listing.item_key, listing.item_name, listing.item_uid || '', listing.qty, listing.price, fee, listing.seller_id, buyer.player_id]
        )
        await conn.commit()
        return json(res, 200, { success: true, fee })
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    }))
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/exchange/cancel', async (req, res) => {
  try {
    if (!requireCompanionChannel(req, res)) return
    const { listingId, playerId, deviceFingerprint, apiKey } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    // 撤单加行锁：防止与并发购买竞态导致“已售出仍退款”（物品+金币双份）
    return withPlayerLock(user.player_id, async () => {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [ls] = await conn.query('SELECT * FROM ysj_exchange_listings WHERE id = ? AND status = "on" FOR UPDATE', [listingId])
        if (!ls.length) {
          await conn.rollback()
          return json(res, 404, { error: '该挂单不存在或已售出' })
        }
        const listing = ls[0]
        if (listing.seller_id !== user.player_id) {
          await conn.rollback()
          return json(res, 403, { error: '只能撤自己的单' })
        }
        const save = await readSave(user.player_id)
        if (!save) {
          await conn.rollback()
          return json(res, 400, { error: '没有存档' })
        }
        if (listing.category === 'pet') {
          const p = parseJsonSafe(listing.pet_json, null)
          if (!p || !p.key) {
            await conn.rollback()
            return json(res, 400, { error: '宠物数据异常' })
          }
          if (!save.pet_cases) save.pet_cases = { list: [] }
          if (save.pet_cases.list.length >= 60) {
            await conn.rollback()
            return json(res, 400, { error: '宠物栏背包已满（最多60个）' })
          }
          save.pet_cases.list.push({
            id: listing.item_uid || ('pc' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6)),
            pet: {
              key: p.key, name: p.name || p.key, lv: Number(p.lv) || 1, exp: Number(p.exp) || 0,
              boss: !!p.boss, elite: !!p.elite, id: p.id || undefined
            }
          })
        } else {
          addItem(save, listing, listing.qty)
        }
        await writeSave(user.player_id, save)
        await conn.query('UPDATE ysj_exchange_listings SET status = "cancelled" WHERE id = ?', [listing.id])
        await conn.commit()
        return json(res, 200, { success: true })
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/exchange/history', async (req, res) => {
  try {
    const { playerId } = req.query
    const [rows] = await pool.query(
      'SELECT * FROM ysj_exchange_trade_history WHERE seller_id = ? OR buyer_id = ? ORDER BY id DESC LIMIT 100',
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
      'INSERT INTO ysj_recharge_orders (order_id, player_id, amount, item, qty) VALUES (?, ?, ?, ?, ?)',
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
    if (!requireAdmin(req, res)) return
    await creditOrder(orderId)
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

async function creditOrder(orderId) {
  const [rows] = await pool.query('SELECT * FROM ysj_recharge_orders WHERE order_id = ? LIMIT 1', [orderId])
  if (!rows.length) throw new Error('订单不存在')
  const order = rows[0]
  if (order.status === 'paid') return
  // 改用邮件到账：无论玩家有无存档，邮件一定送达，玩家在游戏里领取，避免无存档时丢金币
  return withPlayerLock(order.player_id, async () => {
    const [rows2] = await pool.query('SELECT * FROM ysj_recharge_orders WHERE order_id = ? LIMIT 1', [orderId])
    if (!rows2.length) throw new Error('订单不存在')
    if (rows2[0].status === 'paid') return
    await pool.query(
      'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
      [order.player_id, `充值到账 ¥${order.amount}`, `您已成功充值 ¥${order.amount}，获得 ${order.qty} 金币，请到邮箱查收！`, order.qty, JSON.stringify({ coins: order.qty })]
    )
    await pool.query('UPDATE ysj_recharge_orders SET status = "paid", paid_at = NOW() WHERE order_id = ? AND status <> "paid"', [orderId])
  })
}

// ============ 爱发电充值（参照垃圾佬/对决战2：备注填 playerId + webhook 发奖） ============
app.get('/api/yishijie/payment/afdian-url', (req, res) => {
  return json(res, 200, { success: true, afdianUrl: AFDIAN_URL })
})

app.get('/api/yishijie/payment/orders', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      'SELECT order_id, amount, qty, status, created_at, paid_at FROM ysj_recharge_orders WHERE player_id = ? ORDER BY id DESC LIMIT 10',
      [user.player_id]
    )
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/payment/afdian-webhook', async (req, res) => {
  try {
    const rawBody = req.rawBody || ''
    const signature = req.header('x-afdian-sign') || ''
    if (signature) {
      if (!rawBody || !verifyAfdianSignature(rawBody, signature)) {
        console.warn('[爱发电] 签名验证失败，拒绝请求')
        return json(res, 200, { ec: 200, em: '' })
      }
    } else {
      console.warn('[爱发电] 未收到签名头，已放行（请尽快在爱发电后台配置 webhook token）')
    }
    const payload = req.body || {}
    const data = payload.data
    if (!data || data.type !== 'order' || !data.order) {
      return json(res, 200, { ec: 200, em: '' })
    }
    const order = data.order
    if (Number(order.status) !== 2) {
      return json(res, 200, { ec: 200, em: '' })
    }
    const uid = Number(order.remark)
    const outTradeNo = String(order.out_trade_no || '')
    if (!Number.isFinite(uid) || !uid || !outTradeNo) {
      console.warn('[爱发电] 无效订单数据（备注playerId/订单号）:', JSON.stringify({ uid, orderId: outTradeNo }))
      return json(res, 200, { ec: 200, em: '' })
    }
    const orderId = 'AF' + outTradeNo
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [urows] = await conn.query('SELECT player_id FROM ysj_users WHERE player_id = ? LIMIT 1', [String(uid)])
      if (!urows.length) {
        await conn.rollback()
        console.warn('[爱发电] 玩家不存在，已忽略:', uid)
        return json(res, 200, { ec: 200, em: '' })
      }
      const [existing] = await conn.query('SELECT status FROM ysj_recharge_orders WHERE order_id = ? LIMIT 1 FOR UPDATE', [orderId])
      if (existing.length && existing[0].status === 'paid') {
        await conn.rollback()
        return json(res, 200, { ec: 200, em: '' })
      }
      const totalAmount = Number(order.total_amount) || 0
      const coins = Math.floor(totalAmount * COIN_PER_YUAN)
      if (coins <= 0) {
        await conn.rollback()
        console.warn('[爱发电] 无法确定金币数:', JSON.stringify({ uid, orderId: outTradeNo, total_amount: totalAmount }))
        return json(res, 200, { ec: 200, em: '' })
      }
      // 充值到账改为发邮件，由玩家在邮箱里领取，避免直接改写服务器存档
      await conn.query(
        'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
        [String(uid), `充值到账 ¥${totalAmount}`, `您已成功充值 ¥${totalAmount}，获得 ${coins} 金币，请到邮箱查收！`, coins, JSON.stringify({ coins })]
      )
      await conn.query(
        'INSERT INTO ysj_recharge_orders (order_id, player_id, amount, item, qty, status, paid_at) VALUES (?, ?, ?, ?, ?, "paid", NOW()) ON DUPLICATE KEY UPDATE status = "paid", paid_at = NOW()',
        [orderId, String(uid), totalAmount, 'coins', coins]
      )
      await conn.commit()
      console.log(`[爱发电] 玩家 ${uid} 充值 ¥${totalAmount} → ${coins} 金币（订单 ${outTradeNo}），已发邮件`)
      return json(res, 200, { ec: 200, em: '' })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  } catch (e) {
    console.error('[爱发电] webhook 处理失败:', e)
    return json(res, 200, { ec: 200, em: '' })
  }
})

// ============ 公告 / 版本 / 健康 ============
app.get('/api/yishijie/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ysj_announcements ORDER BY id DESC LIMIT 20')
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
      'SELECT id, title, content, coins, rewards_json, claimed, created_at FROM ysj_mail WHERE player_id = ? ORDER BY id DESC LIMIT 50',
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
    // 行锁 + 玩家写锁：防止并发领取同一封邮件导致奖励重复发放
    return withPlayerLock(user.player_id, async () => {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [rows] = await conn.query('SELECT * FROM ysj_mail WHERE id = ? AND player_id = ? FOR UPDATE', [mailId, user.player_id])
        if (!rows.length) {
          await conn.rollback()
          return json(res, 404, { error: '邮件不存在' })
        }
        const mail = rows[0]
        if (mail.claimed) {
          await conn.rollback()
          return json(res, 200, { success: true, already: true })
        }
        const save = await readSave(user.player_id)
        let applied = { coins: 0, items: {}, gear: 0, pets: 0 }
        if (save) {
          const rewards = parseJsonSafe(mail.rewards_json, { coins: mail.coins || 0 })
          applied = applyRewardsToSave(save, rewards)
          await writeSave(user.player_id, save)
        }
        const [up] = await conn.query('UPDATE ysj_mail SET claimed = 1 WHERE id = ? AND claimed = 0', [mail.id])
        if (!up.affectedRows) {
          await conn.rollback()
          return json(res, 200, { success: true, already: true })
        }
        await conn.commit()
        return json(res, 200, { success: true, coins: applied.coins, applied })
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理端发邮件（充值/补偿用）
app.post('/api/yishijie/admin/mail/send', async (req, res) => {
  try {
    const { secret, playerId, title, content, coins, rewards } = req.body || {}
    if (!requireAdmin(req, res)) return
    if (!playerId || !title) return json(res, 400, { error: '参数不完整' })
    const rewardsJson = rewards && typeof rewards === 'object' ? JSON.stringify(rewards) : (coins ? JSON.stringify({ coins: Number(coins) || 0 }) : null)
    await pool.query(
      'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
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
    const [rows] = await pool.query('SELECT * FROM ysj_redeem_codes WHERE code = ? LIMIT 1', [c])
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
      await pool.query('INSERT INTO ysj_redeem_uses (code, player_id) VALUES (?, ?)', [c, user.player_id])
    } catch (e) {
      return json(res, 400, { error: '您已使用过该激活码' })
    }
    const rewards = parseJsonSafe(cd.rewards_json, null)
    const rewardsJson = rewards && typeof rewards === 'object' ? JSON.stringify(rewards) : '{}'
    await pool.query(
      'INSERT INTO ysj_mail (player_id, title, content, coins, rewards_json) VALUES (?, ?, ?, ?, ?)',
      [user.player_id, '激活码奖励：' + c, '您已成功兑换激活码 ' + c + '，奖励已发放到邮箱，请查收', 0, rewardsJson]
    )
    await pool.query('UPDATE ysj_redeem_codes SET used_count = used_count + 1 WHERE code = ?', [c])
    return json(res, 200, { success: true, message: '兑换成功，奖励已发送到邮箱', rewards: rewards || {} })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/admin/code/create', async (req, res) => {
  try {
    const { secret, code, rewards, maxUses, expiresAt, description } = req.body || {}
    if (!requireAdmin(req, res)) return
    const c = String(code || '').trim().toUpperCase()
    if (!c || !rewards || typeof rewards !== 'object') return json(res, 400, { error: '缺少激活码或奖励内容' })
    await pool.query(
      'INSERT INTO ysj_redeem_codes (code, rewards_json, max_uses, expires_at, description) VALUES (?, ?, ?, ?, ?)',
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
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT code, max_uses, used_count, expires_at, description, created_at FROM ysj_redeem_codes ORDER BY created_at DESC')
    return json(res, 200, { success: true, codes: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.delete('/api/yishijie/admin/code/:code', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const c = decodeURIComponent(req.params.code).toUpperCase()
    await pool.query('DELETE FROM ysj_redeem_codes WHERE code = ?', [c])
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
      'SELECT s.player_id, s.data, u.player_name FROM ysj_saves s JOIN ysj_users u ON u.player_id = s.player_id WHERE u.banned = 0'
    )
    const list = []
    for (const r of rows) {
      const save = parseJsonSafe(r.data, null)
      if (!save) continue
      if (type === 'tower') {
        const t = save.tower
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
        const st = save.stats
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
      'SELECT s.player_id, s.data, u.player_name, r.rating, r.wins, r.losses FROM ysj_saves s JOIN ysj_users u ON u.player_id = s.player_id LEFT JOIN ysj_pvp_ratings r ON r.player_id = s.player_id WHERE s.player_id <> ? AND u.banned = 0',
      [user.player_id]
    )
    const list = []
    for (const r of rows) {
      const save = parseJsonSafe(r.data, null)
      if (!save) continue
      const st = save.stats
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

// Elo 匹配：返回与当前玩家段位最接近的 5 个对手（参照垃圾佬 battle_match）
app.get('/api/yishijie/pvp/matchmake', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const ra = ratingOf(await getRatingRow(user.player_id))
    const [rows] = await pool.query(
      'SELECT s.player_id, s.data, u.player_name, r.rating FROM ysj_saves s JOIN ysj_users u ON u.player_id = s.player_id LEFT JOIN ysj_pvp_ratings r ON r.player_id = s.player_id WHERE s.player_id <> ? AND u.banned = 0',
      [user.player_id]
    )
    const list = []
    for (const r of rows) {
      const save = parseJsonSafe(r.data, null)
      if (!save) continue
      const st = save.stats
      const rt = r.rating ? Number(r.rating) : 1000
      list.push({
        playerId: r.player_id,
        playerName: r.player_name,
        rating: rt,
        diff: Math.abs(rt - ra),
        lv: st ? (Number(st.lv) || 1) : 1
      })
    }
    list.sort((a, b) => a.diff - b.diff || b.rating - a.rating)
    return json(res, 200, { success: true, data: list.slice(0, 5) })
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
    const [u] = await pool.query('SELECT player_name FROM ysj_users WHERE player_id = ? LIMIT 1', [targetId])
    const rating = await getRatingRow(targetId)
    return json(res, 200, {
      success: true,
      defender: {
        playerId: targetId,
        playerName: u.length ? u[0].player_name : '未知玩家',
        rating: ratingOf(rating),
        class: parseJsonSafe(save.class, null),
        stats: save.stats,
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
    const [tu] = await pool.query('SELECT player_id FROM ysj_users WHERE player_id = ? LIMIT 1', [targetId])
    if (!tu.length) return json(res, 404, { error: '目标玩家不存在' })
    // 匹配战每日 12 次限制
    const day = todayStr()
    const used = await pvpDailyUsed(user.player_id)
    if (used >= 12) return json(res, 403, { error: '今日匹配战次数已用完（12次），明天再来吧' })
    await pool.query(
      'INSERT INTO ysj_pvp_daily (player_id, day, used) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE used = used + 1',
      [user.player_id, day]
    )
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
      'INSERT INTO ysj_pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [user.player_id, newRa, winFlag ? 1 : 0, winFlag ? 0 : 1]
    )
    await pool.query(
      'INSERT INTO ysj_pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [targetId, newRd, winFlag ? 0 : 1, winFlag ? 1 : 0]
    )
    await pool.query(
      'INSERT INTO ysj_pvp_matches (attacker_id, defender_id, attacker_win, rating_delta) VALUES (?, ?, ?, ?)',
      [user.player_id, targetId, winFlag ? 1 : 0, delta]
    )
    return json(res, 200, { success: true, rating: newRa, delta, win: winFlag })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 手机端 PVP 匹配战：服务端直接模拟对战并结算（不再信任客户端上报胜负，防止自刷/改包）
app.post('/api/yishijie/pvp/match', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, targetId } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    if (!targetId || targetId === user.player_id) return json(res, 400, { error: '目标无效' })
    const [tu] = await pool.query('SELECT player_id, player_name FROM ysj_users WHERE player_id = ? LIMIT 1', [targetId])
    if (!tu.length) return json(res, 404, { error: '目标玩家不存在' })
    // 匹配战每日 12 次限制
    const day = todayStr()
    const used = await pvpDailyUsed(user.player_id)
    if (used >= 12) return json(res, 403, { error: '今日匹配战次数已用完（12次），明天再来吧' })
    const aSave = await readSave(user.player_id)
    const dSave = await readSave(targetId)
    const a = pvpBuildStats(aSave || null)
    const d = pvpBuildStats(dSave || null)
    const result = pvpSimulate(a, d, user.player_name || user.player_id, tu[0].player_name || targetId)
    const winFlag = !!result.aWin
    await pool.query(
      'INSERT INTO ysj_pvp_daily (player_id, day, used) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE used = used + 1',
      [user.player_id, day]
    )
    const ra = await getRatingRow(user.player_id)
    const rd = await getRatingRow(targetId)
    const Ra = ratingOf(ra)
    const Rd = ratingOf(rd)
    const expectedA = 1 / (1 + Math.pow(10, (Rd - Ra) / 400))
    const delta = Math.max(1, Math.round(32 * ((winFlag ? 1 : 0) - expectedA)))
    const newRa = Math.max(0, Ra + delta)
    const newRd = Math.max(0, Rd - delta)
    await pool.query(
      'INSERT INTO ysj_pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [user.player_id, newRa, winFlag ? 1 : 0, winFlag ? 0 : 1]
    )
    await pool.query(
      'INSERT INTO ysj_pvp_ratings (player_id, rating, wins, losses) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), wins = wins + VALUES(wins), losses = losses + VALUES(losses)',
      [targetId, newRd, winFlag ? 0 : 1, winFlag ? 1 : 0]
    )
    const [matchIns] = await pool.query(
      'INSERT INTO ysj_pvp_matches (attacker_id, defender_id, attacker_win, rating_delta) VALUES (?, ?, ?, ?)',
      [user.player_id, targetId, winFlag ? 1 : 0, delta]
    )
    try {
      await pool.query(
        'INSERT INTO ysj_pvp_match_logs (match_id, log_json) VALUES (?, ?)',
        [matchIns.insertId, JSON.stringify(result.log || [])]
      )
    } catch (e) {
      // 日志表异常不影响对战结算
    }
    return json(res, 200, {
      success: true,
      winner: result.winner,
      aWin: result.aWin,
      delta,
      rating: newRa,
      dailyLeft: Math.max(0, 12 - (used + 1)),
      log: result.log
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/pvp/rating', async (req, res) => {
  try {
    const { playerId } = req.query
    if (!playerId) return json(res, 400, { error: '缺少玩家ID' })
    const row = await getRatingRow(playerId)
    const used = await pvpDailyUsed(playerId)
    return json(res, 200, { success: true, rating: ratingOf(row), wins: row ? Number(row.wins) : 0, losses: row ? Number(row.losses) : 0, dailyLeft: Math.max(0, 12 - used) })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 竞技场段位排行榜（手机端查看）
app.get('/api/yishijie/pvp/leaderboard', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      'SELECT u.player_name, r.rating, r.wins, r.losses FROM ysj_pvp_ratings r JOIN ysj_users u ON u.player_id = r.player_id WHERE u.banned = 0 ORDER BY r.rating DESC, r.wins DESC LIMIT 50'
    )
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 我的对战记录（含战斗回放日志）
app.get('/api/yishijie/pvp/matches', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.query
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const [rows] = await pool.query(
      `SELECT m.id, m.attacker_id, m.defender_id, m.attacker_win, m.rating_delta, m.created_at,
              ua.player_name AS attacker_name, ud.player_name AS defender_name, l.log_json
       FROM ysj_pvp_matches m
       LEFT JOIN ysj_users ua ON ua.player_id = m.attacker_id
       LEFT JOIN ysj_users ud ON ud.player_id = m.defender_id
       LEFT JOIN ysj_pvp_match_logs l ON l.match_id = m.id
       WHERE m.attacker_id = ? OR m.defender_id = ?
       ORDER BY m.id DESC LIMIT 20`,
      [user.player_id, user.player_id]
    )
    const list = rows.map((r) => {
      const me = r.attacker_id === user.player_id
      const win = me ? r.attacker_win === 1 : r.attacker_win === 0
      const opp = me ? (r.defender_name || r.defender_id) : (r.attacker_name || r.attacker_id)
      let log = []
      if (r.log_json) {
        try { log = JSON.parse(r.log_json) || [] } catch (e) { log = [] }
      }
      return {
        id: r.id,
        opponent: opp,
        win: !!win,
        delta: me ? Number(r.rating_delta) : -Number(r.rating_delta),
        createdAt: r.created_at,
        log: log
      }
    })
    return json(res, 200, { success: true, data: list })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// ============ 房间对战（参照垃圾佬：4位房间码，双方确认后服务器模拟） ============
async function cleanRooms() {
  // 清理超过 2 小时的房间
  await pool.query('DELETE FROM ysj_pvp_rooms WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)')
}

app.post('/api/yishijie/pvp/room/create', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    await cleanRooms()
    // 玩家只能在一个房间
    await pool.query('DELETE FROM ysj_pvp_rooms WHERE (host_id = ? OR guest_id = ?) AND status IN ("waiting","ready")', [user.player_id, user.player_id])
    let code = ''
    for (let i = 0; i < 20; i++) {
      code = String(Math.floor(1000 + Math.random() * 9000))
      const [ex] = await pool.query('SELECT code FROM ysj_pvp_rooms WHERE code = ? LIMIT 1', [code])
      if (!ex.length) break
    }
    await pool.query(
      'INSERT INTO ysj_pvp_rooms (code, host_id, host_name) VALUES (?, ?, ?)',
      [code, user.player_id, user.player_name]
    )
    return json(res, 200, { success: true, roomCode: code })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/pvp/room/join', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, roomCode } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const code = String(roomCode || '').trim()
    if (!/^\d{4}$/.test(code)) return json(res, 400, { error: '房间码为4位数字' })
    const [rows] = await pool.query('SELECT * FROM ysj_pvp_rooms WHERE code = ? LIMIT 1', [code])
    if (!rows.length) return json(res, 404, { error: '房间不存在或已关闭' })
    const room = rows[0]
    if (room.status !== 'waiting') return json(res, 400, { error: '房间已满或已开始对战' })
    if (room.host_id === user.player_id) return json(res, 400, { error: '不能加入自己的房间' })
    await pool.query('DELETE FROM ysj_pvp_rooms WHERE (host_id = ? OR guest_id = ?) AND code <> ? AND status IN ("waiting","ready")', [user.player_id, user.player_id, code])
    await pool.query('UPDATE ysj_pvp_rooms SET guest_id = ?, guest_name = ?, status = "ready" WHERE code = ?', [user.player_id, user.player_name, code])
    return json(res, 200, { success: true, roomCode: code })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/pvp/room/:code', async (req, res) => {
  try {
    const code = req.params.code
    const [rows] = await pool.query('SELECT * FROM ysj_pvp_rooms WHERE code = ? LIMIT 1', [code])
    if (!rows.length) return json(res, 200, { success: false, error: '房间不存在或已关闭' })
    const r = rows[0]
    return json(res, 200, {
      success: true,
      room: {
        code: r.code,
        hostId: r.host_id,
        hostName: r.host_name,
        guestId: r.guest_id,
        guestName: r.guest_name,
        status: r.status,
        winner: r.winner,
        log: r.log || null
      }
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/pvp/room/fight', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, roomCode } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const code = String(roomCode || '').trim()
    const [rows] = await pool.query('SELECT * FROM ysj_pvp_rooms WHERE code = ? LIMIT 1', [code])
    if (!rows.length) return json(res, 404, { error: '房间不存在' })
    const room = rows[0]
    if (room.status === 'finished') return json(res, 400, { error: '对战已结束' })
    if (user.player_id !== room.host_id && user.player_id !== room.guest_id) return json(res, 403, { error: '不是房间成员' })
    if (!room.guest_id) return json(res, 400, { error: '等待对手加入' })
    if (room.status !== 'ready') return json(res, 400, { error: '对战未就绪' })
    const hostSave = await readSave(room.host_id)
    const guestSave = await readSave(room.guest_id)
    if (!hostSave || !guestSave) return json(res, 400, { error: '对手存档缺失' })
    const h = pvpBuildStats(hostSave)
    const g = pvpBuildStats(guestSave)
    const result = pvpSimulate(h, g, room.host_name || room.host_id, room.guest_name || room.guest_id)
    await pool.query(
      'UPDATE ysj_pvp_rooms SET status = "finished", winner = ?, log = ? WHERE code = ?',
      [result.winner, result.log.join('\n'), code]
    )
    return json(res, 200, { success: true, winner: result.winner, aWin: result.aWin, log: result.log })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/version', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT svalue FROM ysj_settings WHERE skey = 'app_version' LIMIT 1")
    const ver = rows.length ? parseJsonSafe(rows[0].svalue, null) : null
    return json(res, 200, {
      success: true,
      versionCode: ver ? Number(ver.versionCode) || 1 : 1,
      versionName: (ver && ver.versionName) || '0.1.0',
      downloadUrl: (ver && ver.downloadUrl) || '',
      updateNotes: (ver && ver.updateNotes) || ''
    })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理端保存版本信息（手机端据此检查更新并下载新版本）
app.post('/api/yishijie/admin/version', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { versionCode, versionName, downloadUrl, updateNotes } = req.body || {}
    const ver = {
      versionCode: parseInt(versionCode, 10) || 1,
      versionName: String(versionName || '0.1.0'),
      downloadUrl: String(downloadUrl || ''),
      updateNotes: String(updateNotes || '')
    }
    await pool.query(
      "INSERT INTO ysj_settings (skey, svalue) VALUES ('app_version', ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
      [JSON.stringify(ver)]
    )
    return json(res, 200, { success: true, message: '版本信息已保存' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/health', (req, res) => json(res, 200, { ok: true }))

// 管理后台页面（参照垃圾佬 /admin WebView 入口）
app.get('/admin', (req, res) => {
  res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html'))
})

// ============ 管理（完整后台，参照垃圾佬：玩家/改名/封禁/黑名单/公告/版本/存档） ============
app.get('/api/yishijie/admin/stats', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [[{ users }]] = await pool.query('SELECT COUNT(*) AS users FROM ysj_users')
    const [[{ saves }]] = await pool.query('SELECT COUNT(*) AS saves FROM ysj_saves')
    const [[{ listings }]] = await pool.query('SELECT COUNT(*) AS listings FROM ysj_exchange_listings WHERE status = "on"')
    const [[{ paidOrders }]] = await pool.query('SELECT COUNT(*) AS paidOrders FROM ysj_recharge_orders WHERE status = "paid"')
    const [[{ mails }]] = await pool.query('SELECT COUNT(*) AS mails FROM ysj_mail')
    const [[{ bannedUsers }]] = await pool.query('SELECT COUNT(*) AS bannedUsers FROM ysj_users WHERE banned = 1')
    return json(res, 200, { success: true, data: { users, saves, listings, paidOrders, mails, bannedUsers } })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/users', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const keyword = String(req.query.keyword || '').toLowerCase()
    let sql = 'SELECT u.player_id, u.player_name, u.created_at, u.banned, u.ban_reason, u.name_changed, s.data FROM ysj_users u LEFT JOIN ysj_saves s ON s.player_id = u.player_id'
    const params = []
    if (keyword) {
      sql += ' WHERE u.player_id LIKE ? OR u.player_name LIKE ?'
      params.push('%' + keyword + '%', '%' + keyword + '%')
    }
    sql += ' ORDER BY u.id DESC LIMIT 200'
    const [rows] = await pool.query(sql, params)
    const data = rows.map(r => {
      const save = parseJsonSafe(r.data, null)
      const st = save && save.stats ? save.stats : null
      return {
        playerId: r.player_id,
        playerName: r.player_name,
        createdAt: r.created_at,
        banned: !!r.banned,
        banReason: r.ban_reason || '',
        nameChanged: !!r.name_changed,
        lv: st ? (Number(st.lv) || 1) : 1,
        gold: (save && save.bag && save.bag.coin) || 0
      }
    })
    return json(res, 200, { success: true, data })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/player/:playerId', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? LIMIT 1', [req.params.playerId])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    const save = await readSave(req.params.playerId)
    return json(res, 200, { success: true, data: { user: rows[0], save } })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.delete('/api/yishijie/admin/player/:playerId', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const pid = req.params.playerId
    const [rows] = await pool.query('SELECT player_id FROM ysj_users WHERE player_id = ? LIMIT 1', [pid])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    await pool.query('DELETE FROM ysj_users WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_saves WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_exchange_listings WHERE seller_id = ?', [pid])
    await pool.query('DELETE FROM ysj_exchange_trade_history WHERE seller_id = ? OR buyer_id = ?', [pid, pid])
    await pool.query('DELETE FROM ysj_recharge_orders WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_mail WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_redeem_uses WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_pvp_ratings WHERE player_id = ?', [pid])
    await pool.query('DELETE FROM ysj_pvp_matches WHERE attacker_id = ? OR defender_id = ?', [pid, pid])
    return json(res, 200, { success: true, message: '已删除玩家及其全部数据' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/saves', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT s.player_id, u.player_name, s.updated_at FROM ysj_saves s JOIN ysj_users u ON u.player_id = s.player_id ORDER BY s.updated_at DESC LIMIT 200')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/listings', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT * FROM ysj_exchange_listings ORDER BY id DESC LIMIT 200')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 管理员改名（参照垃圾佬：封号/改名/制裁统一走这里）
app.post('/api/yishijie/admin/rename', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { playerId, newName } = req.body || {}
    const name = sanitizeNickname(newName)
    if (!playerId || !name || name.length < 2) return json(res, 400, { error: '名称需 2-12 个字符' })
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? LIMIT 1', [playerId])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    await pool.query('UPDATE ysj_users SET player_name = ?, name_changed = 1, name_changed_at = NOW() WHERE player_id = ?', [name, playerId])
    return json(res, 200, { success: true, message: '已改名：' + name })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 封号（参照垃圾佬：移出排行榜/PVP）
app.post('/api/yishijie/admin/ban', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { playerId, reason } = req.body || {}
    if (!playerId) return json(res, 400, { error: '缺少玩家ID' })
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? LIMIT 1', [playerId])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    if (rows[0].banned) return json(res, 400, { error: '该玩家已被封号' })
    await pool.query('UPDATE ysj_users SET banned = 1, ban_reason = ? WHERE player_id = ?', [String(reason || '违规行为').slice(0, 255), playerId])
    await pool.query('DELETE FROM ysj_pvp_ratings WHERE player_id = ?', [playerId])
    return json(res, 200, { success: true, message: '已封号' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/admin/unban', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { playerId } = req.body || {}
    if (!playerId) return json(res, 400, { error: '缺少玩家ID' })
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? LIMIT 1', [playerId])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    if (!rows[0].banned) return json(res, 400, { error: '该玩家未被封号' })
    await pool.query('UPDATE ysj_users SET banned = 0, ban_reason = "" WHERE player_id = ?', [playerId])
    return json(res, 200, { success: true, message: '已解封' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 制裁：改名（违规昵称+随机后缀）+ 封号
app.post('/api/yishijie/punish', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { playerId, reason } = req.body || {}
    if (!playerId) return json(res, 400, { error: '缺少玩家ID' })
    const [rows] = await pool.query('SELECT * FROM ysj_users WHERE player_id = ? LIMIT 1', [playerId])
    if (!rows.length) return json(res, 404, { error: '玩家不存在' })
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let suffix = ''
    for (let i = 0; i < 6; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length))
    const newName = '违规昵称' + suffix
    await pool.query('UPDATE ysj_users SET player_name = ?, name_changed = 1, name_changed_at = NOW(), banned = 1, ban_reason = ? WHERE player_id = ?',
      [newName, String(reason || '违规行为').slice(0, 255), playerId])
    await pool.query('DELETE FROM ysj_pvp_ratings WHERE player_id = ?', [playerId])
    return json(res, 200, { success: true, newName, banned: true, message: '已制裁并封号' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 设备指纹黑名单（封设备）
app.get('/api/yishijie/admin/banned-fingerprints', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT * FROM ysj_banned_fingerprints ORDER BY created_at DESC')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.post('/api/yishijie/admin/banned-fingerprints', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { fingerprint, reason } = req.body || {}
    if (!fingerprint) return json(res, 400, { error: '缺少设备指纹' })
    await pool.query('INSERT INTO ysj_banned_fingerprints (fingerprint, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)',
      [String(fingerprint), String(reason || '违规行为').slice(0, 255)])
    return json(res, 200, { success: true, message: '设备指纹已加入黑名单' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.delete('/api/yishijie/admin/banned-fingerprints/:fingerprint', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const fp = decodeURIComponent(req.params.fingerprint)
    await pool.query('DELETE FROM ysj_banned_fingerprints WHERE fingerprint = ?', [fp])
    return json(res, 200, { success: true, message: '已移出黑名单' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 公告管理（增删查；GET /announcements 为玩家接口）
app.post('/api/yishijie/admin/announcement', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const { title, content } = req.body || {}
    if (!title || !content) return json(res, 400, { error: '缺少标题或内容' })
    const [r] = await pool.query('INSERT INTO ysj_announcements (title, content) VALUES (?, ?)', [String(title).slice(0, 128), String(content)])
    return json(res, 200, { success: true, id: r.insertId })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.get('/api/yishijie/admin/announcements', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    const [rows] = await pool.query('SELECT * FROM ysj_announcements ORDER BY id DESC LIMIT 200')
    return json(res, 200, { success: true, data: rows })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

app.delete('/api/yishijie/admin/announcement/:id', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return
    await pool.query('DELETE FROM ysj_announcements WHERE id = ?', [parseInt(req.params.id, 10) || 0])
    return json(res, 200, { success: true })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

// 玩家自主改名（参照垃圾佬：设备校验 + 每月一次 + 敏感词/重名过滤）
app.post('/api/yishijie/rename', async (req, res) => {
  try {
    const { playerId, deviceFingerprint, apiKey, newName } = req.body || {}
    const user = await authUser(playerId, deviceFingerprint, apiKey)
    if (!user) return json(res, 403, { error: '鉴权失败' })
    const name = sanitizeNickname(newName)
    if (name.length < 2) return json(res, 400, { error: '名字长度需要 2-12 个字符' })
    if (user.name_changed_at) {
      const last = new Date(user.name_changed_at).getTime()
      const diff = Date.now() - last
      const MONTH_MS = 30 * 24 * 3600 * 1000
      if (diff < MONTH_MS) {
        const remainDays = Math.ceil((MONTH_MS - diff) / (24 * 3600 * 1000))
        return json(res, 403, { error: `一个月内只能修改一次昵称，还需等待 ${remainDays} 天` })
      }
    }
    const lower = name.toLowerCase()
    for (const w of SENSITIVE_WORDS) {
      if (lower.includes(w.toLowerCase())) return json(res, 400, { error: '名字包含违禁词，请重新输入' })
    }
    const [dup] = await pool.query('SELECT player_id FROM ysj_users WHERE player_name = ? AND player_id <> ? LIMIT 1', [name, user.player_id])
    if (dup.length) return json(res, 409, { error: '该名字已被使用' })
    await pool.query('UPDATE ysj_users SET player_name = ?, name_changed = 1, name_changed_at = NOW() WHERE player_id = ?', [name, user.player_id])
    return json(res, 200, { success: true, playerName: name, message: '改名成功' })
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message })
  }
})

async function initSchema() {
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS pvp_match_logs (' +
      'id INT AUTO_INCREMENT PRIMARY KEY, ' +
      'match_id INT NOT NULL, ' +
      'log_json LONGTEXT, ' +
      'created_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ')'
    )
  } catch (e) {
    console.error('初始化 pvp_match_logs 表失败:', e.message)
  }
}

initSchema().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`[异世界传说] 服务端已启动: http://${HOST}:${PORT}`)
    console.log('  交易所手续费: ' + (EXCHANGE_FEE_RATE * 100) + '%')
    console.log('  充值汇率: 1 元 = ' + COIN_PER_YUAN + ' 金币')
  })
})
