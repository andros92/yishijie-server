// 宠物系统：存储、经验、属性
export var PET_MAX = 6

export function parsePets(data) {
  var p = { list: [], active: '' }
  if (data) {
    try {
      var d = JSON.parse(data)
      p.list = (d && d.list) || []
      p.active = (d && d.active) || ''
    } catch (e) {}
  }
  return p
}

// 宠物升级所需经验：二次曲线（前期快、后期慢）
// need(lv) = 20 + lv*10 + lv*lv*2；60 级满累计约 16 万
export function petExpNeed(lv) {
  var l = typeof lv === 'number' && lv > 0 ? lv : 1
  return 20 + l * 10 + l * l * 2
}

// 宠物等级上限：普通 40 / 精英 50 / Boss 60
// 由宠物 key 决定（Boss 在 MONSTER_DEFS 里标记 boss: true）
export function petMaxLv(pet) {
  if (!pet) return 40
  if (pet.boss) return 60
  if (pet.elite) return 50
  return 40
}

// 宠物基础攻击：随等级成长（战力核心，数值明显高于早期玩家的普攻）
// Boss 宠物（名字带神兽标签的）基础攻击更高
export function petAtkOf(pet) {
  var l = pet && pet.lv ? pet.lv : 1
  // 成长系数：普通 4 / 精英 5 / Boss 6
  var coef = pet && pet.boss ? 6 : (pet && pet.elite ? 5 : 4)
  return 6 + l * coef
}

export function getActivePet(pets) {
  if (!pets || !pets.active) return null
  for (var i = 0; i < pets.list.length; i++) {
    if (pets.list[i].key === pets.active) return pets.list[i]
  }
  return null
}
