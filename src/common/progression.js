// 等级成长公式：地图/战斗/背包共用
export var MAX_LEVEL = 69

export function maxHpForLevel(lv) {
  var l = typeof lv === 'number' && lv > 0 ? lv : 1
  return 100 + (l - 1) * 8
}

export function maxMpForLevel(lv) {
  var l = typeof lv === 'number' && lv > 0 ? lv : 1
  return 50 + (l - 1) * 4
}

// 升级所需经验：二次曲线（需求更高，升级更慢，总量约 32 万）
export function expForLevel(lv) {
  var l = typeof lv === 'number' && lv > 0 ? lv : 1
  var i = l - 1
  return Math.round(150 + 65 * i + 1.5 * i * i)
}
