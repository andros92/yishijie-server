// 职业与技能系统（v2）
// 职业特色：战士=怒气值，骑士=高血高防，牧师=治疗，法师=攻击无视防御
// 属性加成全部为固定数值（不是倍率）：战士 1 级生命 = 100 + 10 = 110
import { maxHpForLevel, maxMpForLevel, MAX_LEVEL } from './progression.js'

export var CLASS_DEFS = {
  warrior: {
    key: 'warrior', name: '战士', desc: '均衡的近战战士，越战越勇',
    hp: 10, mp: 0, atk: 3, def: 0, crit: 0, agi: 3,
    attackVerb: '挥剑斩击',
    special: '怒气值：攻击与挨打积攒怒气，可释放狂暴斩',
    rageDmg: 2,
    initSkills: ['w_slash', 'w_rage', 'w_fury'], learn: ['w_cyclone', 'w_execute', 'w_bloodlust'],
    color: '#e0a050'
  },
  knight: {
    key: 'knight', name: '骑士', desc: '血厚防高的钢铁壁垒',
    hp: 30, mp: -10, atk: -3, def: 6, crit: 0, agi: 1, resist: 3,
    attackVerb: '持盾挥砍',
    special: '高血高防：天生的肉盾',
    counterChance: 30, counterDmg: 0.5,
    initSkills: ['k_smash', 'k_shield', 'k_guard'], learn: ['k_judge', 'k_taunt', 'k_counter'],
    color: '#7ab8e8'
  },
  priest: {
    key: 'priest', name: '牧师', desc: '蓝量深厚的治疗者',
    hp: -10, mp: 20, atk: -1, def: 0, crit: 0, agi: 2,
    attackVerb: '挥动法杖',
    special: '治疗与吸血：每回合恢复生命，攻击附带吸血',
    regenPct: 2, lifesteal: 5,
    initSkills: ['p_heal', 'p_light', 'p_sacred'], learn: ['p_bless', 'p_bloodsac', 'p_ward'],
    color: '#e8e0a0'
  },
  mage: {
    key: 'mage', name: '法师', desc: '法术威猛，攻击无视防御',
    hp: 0, mp: 25, atk: -8, def: 1, crit: 5, agi: 2, magic: 13,
    attackVerb: '念动咒语',
    special: '无视防御：攻击完全忽略怪物防御',
    chargeDmg: 15,
    initSkills: ['m_fire', 'm_frost', 'm_thunder'], learn: ['m_chain', 'm_meteor', 'm_arcaneburst'],
    color: '#c0a0e8'
  }
}

export var SKILL_DEFS = {
  // 战士
  w_slash:   { name: '猛击',     mp: 15, dmg: 1.5, rage: 20,  rageNeed: 0,  cost: 0, needLv: 1, text: '全力一击，1.5倍伤害并积怒20' },
  w_rage:    { name: '蓄力猛击', mp: 10, dmg: 0.8, rage: 40,  rageNeed: 0,  cost: 0, needLv: 1, text: '挥出弱击，积怒40' },
  w_fury:    { name: '狂暴斩',   mp: 0,  dmg: 2.2, rage: -70, rageNeed: 70, cost: 0, needLv: 1, text: '消耗70怒气，造成2.2倍伤害' },
  w_cyclone: { name: '旋风斩',   mp: 20, dmg: 1.8, rage: 15,  cost: 30, needLv: 10, text: '旋转斩击，1.8倍伤害并积怒15' },
  w_execute: { name: '处决',     mp: 0,  dmg: 1.2, rageAll: true, rageNeed: 10, rageMult: 0.1, cost: 80, needLv: 20, text: '消耗全部怒气，每10怒+10%伤害' },
  w_bloodlust: { name: '血怒',   mp: 0,  rageAll: true, rageNeed: 10, rageHeal: 4, cost: 150, needLv: 25, text: '消耗全部怒气，每10怒恢复4%最大生命' },
  // 骑士
  k_smash:   { name: '重击',     mp: 8,  dmg: 1.3, cost: 0, needLv: 1, text: '沉重一击，1.3倍伤害' },
  k_shield:  { name: '盾墙',     mp: 12, dmg: 0.9, defUp: 1.6, defTurns: 3, cost: 0, needLv: 1, text: '3回合内防御提升60%' },
  k_guard:   { name: '圣盾',     mp: 14, shield: true, shieldTurns: 2, cost: 0, needLv: 1, text: '获得护盾吸收防御×2的伤害，持续2回合' },
  k_judge:   { name: '正义裁决', mp: 16, dmg: 1.5, cost: 30, needLv: 10, text: '圣光裁决，1.5倍伤害' },
  k_taunt:   { name: '战吼',     mp: 10, defUp: 1.8, defTurns: 2, cost: 80, needLv: 20, text: '嘲讽怒吼，2回合内防御提升80%' },
  k_counter: { name: '反击风暴', mp: 12, counterBuff: 30, counterTurns: 3, cost: 150, needLv: 25, text: '3回合内反击概率+30%' },
  // 牧师
  p_heal:    { name: '治疗术',   mp: 22, heal: 0.18, cost: 0, needLv: 1, text: '恢复18%最大生命' },
  p_light:   { name: '圣光弹',   mp: 14, dmg: 1.5, heal: 0.06, cost: 0, needLv: 1, text: '1.5倍伤害并恢复6%生命' },
  p_sacred:  { name: '圣裁',     mp: 20, dmg: 2.0, heal: 0.06, cost: 0, needLv: 1, text: '圣光审判，2倍伤害并回复6%生命' },
  p_bless:   { name: '祝福',     mp: 10, heal: 0.12, cost: 30, needLv: 10, text: '圣光祝福，恢复12%生命' },
  p_bloodsac:{ name: '血祭',     mp: 10, dmg: 2.4, hpCost: 0.15, cost: 80, needLv: 20, text: '消耗当前生命15%，造成2.4倍伤害' },
  p_ward:    { name: '圣佑',     mp: 16, dmgRed: 0.3, dmgRedTurns: 2, cost: 150, needLv: 25, text: '接下来2回合受到的伤害-30%' },
  // 法师
  m_fire:    { name: '火球术',   mp: 14, dmg: 1.6, burn: { dmg: 0.2, turns: 2 }, cost: 0, needLv: 1, text: '1.6倍伤害并点燃目标2回合' },
  m_frost:   { name: '寒冰箭',   mp: 16, dmg: 1.2, monAtkDown: 0.5, monAtkTurns: 2, cost: 0, needLv: 1, text: '1.2倍伤害并让怪物攻击减半2回合' },
  m_thunder: { name: '雷击',     mp: 24, dmg: 2.2, cost: 0, needLv: 1, text: '召唤雷霆，2.2倍伤害；对点燃目标+50%' },
  m_chain:   { name: '连锁闪电', mp: 18, dmg: 2.2, cost: 30, needLv: 10, text: '连锁闪电，2.2倍法术伤害' },
  m_meteor:  { name: '陨石术',   mp: 30, dmg: 2.8, cost: 80, needLv: 20, text: '召唤陨石，2.8倍伤害；对点燃目标+50%' },
  m_arcaneburst: { name: '奥术爆裂', mp: 0, dmg: 1.5, manaBurn: 0.6, manaBonus: 0.3, cost: 150, needLv: 25, text: '消耗60%当前蓝量，1.5倍伤害+蓝量×0.3额外伤害' }
}

// 通用被动（所有职业可学，2 个被动槽，1~10 级可升级）
export var PASSIVE_DEFS = [
  { key: 'vitality', name: '强健体魄', desc: '每级最大生命+1%（10级+10%）', needLv: 10, cost: 150, perLv: 1 },
  { key: 'surge',    name: '蓄势待发', desc: '每3回合第3回合攻击+3%/级（10级+30%）', needLv: 15, cost: 300, perLv: 3 },
  { key: 'ironwall', name: '铁壁',     desc: '每级受到的伤害-0.5%（10级-5%）', needLv: 20, cost: 500, perLv: 0.5 }
]

export function defaultClassData() {
  return { key: '', skills: [], equipped: [], skillLv: {}, talents: {} }
}

export var SKILL_MAX_LV = 10

// 技能当前等级（默认1级）
export function skillLevel(clsData, key) {
  var d = clsData || {}
  var t = d.skillLv || {}
  var lv = t[key] || 1
  return Math.min(SKILL_MAX_LV, Math.max(1, lv))
}

// 升级到下一级所需魂晶：当前等级×15（1→2需15，2→3需30…，升满共675）
export function skillUpgradeCost(key, curLv) {
  return curLv * 15
}

// 技能蓝耗随等级成长：每级 +15%（防止后期蓝量溢出无脑甩技能）
export function skillMpCost(sk, lv) {
  if (!sk || !sk.mp) return 0
  return Math.round(sk.mp * Math.pow(1.15, (lv || 1) - 1))
}

// 伤害倍率随等级成长：每级+8%
export function skillDmgMul(sk, lv) {
  var base = sk && sk.dmg ? sk.dmg : 0
  if (!base) return 0
  return base * (1 + 0.08 * ((lv || 1) - 1))
}

// 治疗/回蓝比例随等级成长：每级+5%
export function skillHealMul(rate, lv) {
  return rate * (1 + 0.05 * ((lv || 1) - 1))
}

// 未选职业时返回原始属性（无加成）
export function classStats(clsData, lv, equipStats) {
  var es = equipStats || { hp: 0, def: 0, dmg: 0 }
  var l = typeof lv === 'number' && lv > 0 ? lv : 1
  if (!clsData || !clsData.key || !CLASS_DEFS[clsData.key]) {
    return {
      maxHp: maxHpForLevel(l) + (es.hp || 0),
      maxMp: maxMpForLevel(l),
      atk: 8 + (l - 1) + (es.atk || 0) + (es.dmg || 0) + Math.round(((es.atkMin || 0) + (es.atkMax || 0)) / 2),
      def: es.def || 0,
      magic: es.magic || 0,
      resist: es.resist || 0,
      crit: es.crit || 0,
      agi: es.agi || 0,
      weaponMin: es.atkMin || 0,
      weaponMax: es.atkMax || 0,
      weaponMagMin: 0,
      weaponMagMax: 0,
      regenPct: 0,
      counterChance: 0,
      rageGain: 15,
      lifesteal: 0,
      cls: null
    }
  }
  var c = CLASS_DEFS[clsData.key]
  var tb = talentBonus(clsData)
  return {
    maxHp: maxHpForLevel(l) + (c.hp || 0) + (es.hp || 0) + (tb.hp || 0),
    maxMp: maxMpForLevel(l) + (c.mp || 0) + (es.mp || 0) + (tb.mp || 0),
    atk: 8 + (l - 1) + (c.atk || 0) + (es.atk || 0) + (es.dmg || 0) + (c.key === 'mage' ? 0 : (tb.atk || 0)) + (c.key === 'mage' ? 0 : Math.round(((es.atkMin || 0) + (es.atkMax || 0)) / 2)),
    weaponMin: es.atkMin || 0,
    weaponMax: es.atkMax || 0,
    magic: (c.magic || 0) + (l - 1) + (es.magic || 0) + (c.key === 'mage' ? (tb.atk || 0) : 0) + (c.key === 'mage' ? Math.round(((es.magMin || 0) + (es.magMax || 0)) / 2) : 0),
    weaponMagMin: c.key === 'mage' ? (es.magMin || 0) : 0,
    weaponMagMax: c.key === 'mage' ? (es.magMax || 0) : 0,
    def: (es.def || 0) + (c.def || 0) + (tb.def || 0),
    resist: (c.resist || 0) + (es.resist || 0),
    crit: (c.crit || 0) + (es.crit || 0) + (tb.crit || 0),
    agi: (c.agi || 0) + (es.agi || 0) + (tb.agi || 0),
    // 职业被动随等级成长
    regenPct: c.key === 'priest' ? (2 + (l - 1) * 0.4) : 0,
    counterChance: c.key === 'knight' ? (30 + (l - 1) * 0.5) : 0,
    rageGain: c.key === 'warrior' ? (15 + (l - 1) * 0.5) : 15,
    lifesteal: c.lifesteal || 0,
    cls: c
  }
}

// 敏捷 → 闪避：每点 0.5%，上限 25%
export function dodgeFromAgi(agi) {
  return Math.min(25, Math.round((agi || 0) * 0.5))
}

// 天赋定义（属性点与天赋合并后的唯一加点系统）：每级 1 点，最高 10 级
export var TALENT_DEFS = [
  { key: 'atk',  name: '攻击', desc: '攻击+2 / 级',  maxLv: 10, atk: 2 },
  { key: 'def',  name: '防御', desc: '防御+1 / 级',  maxLv: 10, def: 1 },
  { key: 'hp',   name: '生命', desc: '生命+15 / 级', maxLv: 10, hp: 15 },
  { key: 'mp',   name: '蓝量', desc: '蓝量+8 / 级',  maxLv: 10, mp: 8 },
  { key: 'agi',  name: '敏捷', desc: '闪避+0.5% / 级（并影响先手）', maxLv: 10, agi: 1 },
  { key: 'burst', name: '爆发', desc: '暴击+1% / 级', maxLv: 10, crit: 1 }
]

function talentBonus(clsData) {
  var b = { hp: 0, mp: 0, atk: 0, def: 0, crit: 0, agi: 0 }
  if (!clsData || !clsData.key) return b
  var t = clsData.talents || {}
  for (var i = 0; i < TALENT_DEFS.length; i++) {
    var d = TALENT_DEFS[i]
    var lv = t[d.key] || 0
    if (!lv) continue
    b.hp += (d.hp || 0) * lv
    b.mp += (d.mp || 0) * lv
    b.atk += (d.atk || 0) * lv
    b.def += (d.def || 0) * lv
    b.crit += (d.crit || 0) * lv
    b.agi += (d.agi || 0) * lv
  }
  // 旧存档的 crit 天赋并入爆发，不丢点数
  if (t.crit) b.crit += (t.crit || 0)
  return b
}

// 剩余天赋点 = 等级-1 减去已投入的点数（每级天赋 1 点）
export function talentPts(lv, clsData) {
  var d = clsData || defaultClassData()
  var t = d.talents || {}
  var spent = 0
  for (var k in t) spent += t[k] || 0
  // 6 项天赋 × 10 级上限 = 60 点封顶
  var maxPts = Math.min(MAX_LEVEL - 1, 60)
  return Math.max(0, Math.min((lv - 1), maxPts) - spent)
}
