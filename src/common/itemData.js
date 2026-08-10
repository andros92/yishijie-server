// 物品目录：key 与 survival.bag 存档字段一一对应
// 背包页使用；后续商店/合成等功能可复用此目录

// 背包全部物品键（新增物品时在这里补一个默认值即可，各页面统一用 parseBag 解析）
// 宝石：8 种 × 6 级，属性随等级成长
export var GEM_TYPES = ['power', 'agility', 'vitality', 'mana', 'armorpen', 'lifesteal', 'resist', 'magic']
export var GEM_DEFS = {
  power:    { name: '力量宝石', color: '#ff8a5a', stats: [{ atk: 2, crit: 1 }, { atk: 4, crit: 1 }, { atk: 8, crit: 2 }, { atk: 13, crit: 3 }, { atk: 19, crit: 4 }, { atk: 26, crit: 5 }] },
  agility:  { name: '敏捷宝石', color: '#7ec850', stats: [{ agi: 2, dodge: 1 }, { agi: 3, dodge: 1 }, { agi: 6, dodge: 2 }, { agi: 9, dodge: 2 }, { agi: 14, dodge: 3 }, { agi: 18, dodge: 4 }] },
  vitality: { name: '生命宝石', color: '#ff7a9a', stats: [{ hp: 20, def: 1 }, { hp: 40, def: 1 }, { hp: 70, def: 2 }, { hp: 110, def: 3 }, { hp: 160, def: 4 }, { hp: 220, def: 5 }] },
  mana:     { name: '蓝量宝石', color: '#5aa8ff', stats: [{ mp: 12, manaRegen: 1 }, { mp: 24, manaRegen: 1 }, { mp: 40, manaRegen: 2 }, { mp: 65, manaRegen: 3 }, { mp: 95, manaRegen: 4 }, { mp: 130, manaRegen: 5 }] },
  armorpen: { name: '破甲宝石', color: '#b7c0cc', stats: [{ armorPen: 2, atk: 1 }, { armorPen: 4, atk: 2 }, { armorPen: 7, atk: 3 }, { armorPen: 10, atk: 5 }, { armorPen: 14, atk: 7 }, { armorPen: 18, atk: 10 }] },
  lifesteal:{ name: '吸血宝石', color: '#e84a5a', stats: [{ lifesteal: 1, hp: 15 }, { lifesteal: 2, hp: 30 }, { lifesteal: 4, hp: 50 }, { lifesteal: 6, hp: 75 }, { lifesteal: 9, hp: 110 }, { lifesteal: 12, hp: 150 }] },
  resist:   { name: '减伤宝石', color: '#ffd36d', stats: [{ resist: 2, def: 1 }, { resist: 3, def: 1 }, { resist: 5, def: 2 }, { resist: 7, def: 2 }, { resist: 9, def: 3 }, { resist: 11, def: 4 }] },
  magic:    { name: '法术宝石', color: '#c070ff', stats: [{ magic: 2, crit: 1 }, { magic: 4, crit: 1 }, { magic: 8, crit: 2 }, { magic: 12, crit: 3 }, { magic: 17, crit: 4 }, { magic: 22, crit: 5 }] }
}

var GEM_PCT = { crit: 1, dodge: 1, armorPen: 1, lifesteal: 1, resist: 1, manaRegen: 1 }
var GEM_LABEL = { atk: '攻击', crit: '暴击', agi: '敏捷', dodge: '闪避', hp: '生命', mp: '蓝量', armorPen: '破甲', lifesteal: '吸血', resist: '减伤', magic: '法术', manaRegen: '回蓝', def: '防御' }

export function gemInfo(key) {
  var m = /^gem_(\w+)_(\d)$/.exec(key || '')
  if (!m || !GEM_DEFS[m[1]]) return null
  var lv = parseInt(m[2], 10)
  return { type: m[1], lv: lv, def: GEM_DEFS[m[1]], stats: GEM_DEFS[m[1]].stats[lv - 1] || {} }
}

export function gemStats(key) {
  var g = gemInfo(key)
  return g ? g.stats : {}
}

export function gemName(key) {
  var g = gemInfo(key)
  return g ? (g.def.name + '·' + g.lv + '级') : key
}

export function gemDesc(key) {
  var st = gemStats(key)
  var parts = []
  for (var k in st) {
    parts.push((GEM_LABEL[k] || k) + '+' + st[k] + (GEM_PCT[k] ? '%' : ''))
  }
  return parts.join('、')
}

// 合成成功率：等级越高失败率越大（1→2 90% … 5→6 40%）
export function gemCombineSuccess(lv) {
  if (lv === 1) return 90
  if (lv === 2) return 80
  if (lv === 3) return 70
  if (lv === 4) return 55
  if (lv === 5) return 40
  return 0
}


export var BAG_DEFAULTS = {
  wood: 0, stone: 0, grass: 0, copper: 0, iron: 0, gold: 0, coal: 0, berry: 0, mushroom: 0, leaf: 0, fiber: 0,
  copper_ingot: 0, iron_ingot: 0, gold_ingot: 0,
  hearthstone: 0, crafting_table: 0, furnace2: 0, chest: 0, bed: 0, chair: 0, furnace: 0, forge: 0, gem_forge: 0, gem_remover: 0, repair_table: 0, alchemy_table: 0, coin: 0,
  cooking_pot: 0,
  boss_ticket: 0, class_change_ticket: 0, gem_protect_ticket: 0, pet_case: 0,
  fiber_helmet: 0, fiber_armor: 0, fiber_pants: 0, fiber_shoes: 0,
  iron_helmet: 0, iron_armor: 0, iron_pants: 0, iron_shoes: 0,
  wood_axe: 0, stone_axe: 0, iron_axe: 0, wood_pick: 0, stone_pick: 0, iron_pick: 0,
  wood_sword: 0, stone_sword: 0, iron_sword: 0, bone_sword: 0,
  wood_staff: 0, stone_staff: 0, bone_staff: 0, iron_staff: 0,
  old_tome: 0, holy_tome: 0,
  copper_sword: 0, copper_staff: 0, silver_sword: 0, silver_staff: 0,
  gold_sword: 0, gold_staff: 0, mythril_sword: 0, mythril_staff: 0,
  dark_iron_sword: 0, dark_iron_staff: 0, amber_staff: 0, crystal_sword: 0, crystal_staff: 0,
  starfall_sword: 0, starfall_staff: 0, adamant_sword: 0, adamant_staff: 0,
  starfall_helmet: 0, starfall_armor: 0, starfall_pants: 0, starfall_shoes: 0,
  adamant_helmet: 0, adamant_armor: 0, adamant_pants: 0, adamant_shoes: 0,
  silver_helmet: 0, silver_armor: 0, silver_pants: 0, silver_shoes: 0,
  dark_helmet: 0, dark_armor: 0, dark_pants: 0, dark_shoes: 0,
  slime_goo: 0, bat_wing: 0, beast_hide: 0, beast_claw: 0, boar_tusk: 0, bone_shard: 0, goblin_rag: 0,
  spirit_crystal: 0,
  wood_rod: 0, iron_rod: 0, mythril_rod: 0, worm_bait: 0, sweet_bait: 0,
  crucian: 0, bass: 0, sea_bream: 0, salmon: 0, seaweed: 0,
  water_turtle_shell: 0,
  gem_core: 0, ember_core: 0,
  silver: 0, mythril: 0, dark_iron: 0, silver_ingot: 0, mythril_ingot: 0, dark_iron_ingot: 0,
  starfall_ore: 0, adamant_ore: 0, starfall_ingot: 0, adamant_ingot: 0,
  herb: 0, glow_mushroom: 0, snow_lotus: 0, firethorn: 0,
  roasted_glow: 0, herb_stew: 0, firethorn_skewer: 0, holy_potion: 0, moon_potion: 0, sun_potion: 0, atk_potion: 0, crit_potion: 0, lifesteal_potion: 0, armor_potion: 0,
  beef_stew: 0, seafood_feast: 0, glow_soup: 0, dragon_roast: 0, royal_meal: 0, moon_cake: 0,
  maple_leaf: 0, coconut: 0, mint: 0, reishi: 0, blueberry: 0, pumpkin: 0,
  deer_antler: 0, rabbit_fur: 0, tiger_fang: 0, python_scale: 0,
  feed_slime: 0, feed_bat: 0, feed_spider: 0, feed_wolf: 0, feed_boar: 0, feed_water_turtle: 0,
  cactus_fruit: 0, desert_salt: 0, amber: 0, scorpion_stinger: 0, snake_scale: 0, vulture_feather: 0,
  salt_mushroom: 0,
  snake_armor: 0, vulture_boots: 0, amber_sword: 0,
  healing_potion: 0,
  roasted_mushroom: 0, roasted_berry: 0, greater_potion: 0,
  adventurer_card: 0,
  willow_branch: 0, peach: 0, banana: 0, grape: 0, aloe: 0, bamboo_shoot: 0,
  fox_fur: 0, wool: 0, crocodile_scale: 0, crab_meat: 0, owl_feather: 0,
  thunder_feather: 0, spore_core: 0, dragon_scale: 0,
  mulberry: 0, tea_leaf: 0, lotus_seed: 0, honey: 0, duck_down: 0, duck_meat: 0,
  sakura_petal: 0, reed: 0, starlight_herb: 0, dragonblood_herb: 0,
  pine_cone: 0, beef: 0, buffalo_hide: 0, eagle_feather: 0, heartwood: 0,
  shark_fin: 0, shark_meat: 0, lobster_meat: 0, polar_bear_hide: 0, penguin_down: 0,
  ice_crystal: 0, coral: 0, meteorite_iron: 0, pearl: 0, clam_meat: 0, shark_king_tooth: 0,
  ginkgo_leaf: 0, dates: 0, water_caltrop: 0, moon_petal: 0, panda_fur: 0,
  butterfly_wing: 0, snow_leopard_hide: 0, scorpion_king_stinger: 0,
  apple: 0, cherry: 0, radish: 0, truffle: 0, monkey_fur: 0,
  turkey_leg: 0, turkey_feather: 0, frog_meat: 0, lava_core: 0,
  ginseng: 0, hedgehog_quill: 0, seagull_feather: 0, beeswax: 0,
  cotton: 0, sugarcane: 0, banyan_root: 0, horse_mane: 0, horse_meat: 0,
  antelope_horn: 0, mantis_claw: 0, giant_lizard_hide: 0, crystal: 0,
  coffee_bean: 0, rubber: 0, osmanthus: 0, pangolin_scale: 0, crane_feather: 0, otter_pelt: 0,
  moonstone: 0, dandelion_fluff: 0, peacock_feather: 0, white_tiger_hide: 0, crystal_dragon_scale: 0,
  camel_wool: 0, camel_meat: 0, octopus_tentacle: 0, stag_beetle_horn: 0,
  flame_petal: 0, frost_petal: 0, unicorn_horn: 0,
  carp: 0, tuna: 0, wheat: 0, potato: 0, flamingo_feather: 0,
  dragon_resin: 0, dragon_crystal: 0, snow_fox_fur: 0, fire_salamander_skin: 0, star_beast_horn: 0,
  copper_helmet: 0, copper_armor: 0, copper_pants: 0, copper_shoes: 0,
  gold_helmet: 0, gold_armor: 0, gold_pants: 0, gold_shoes: 0,
  mythril_helmet: 0, mythril_armor: 0, mythril_pants: 0, mythril_shoes: 0,
  silver_axe: 0, silver_pick: 0, gold_axe: 0, gold_pick: 0,
  mythril_axe: 0, mythril_pick: 0, dark_iron_axe: 0, dark_iron_pick: 0,
  crystal_axe: 0, crystal_pick: 0, starfall_axe: 0, starfall_pick: 0,
  adamant_axe: 0, adamant_pick: 0,
  feed_deer: 0, feed_rabbit: 0, feed_fox: 0, feed_goat: 0, feed_crocodile: 0, feed_crab: 0, feed_owl: 0, feed_bee: 0, feed_duck: 0, feed_squirrel: 0, feed_buffalo: 0, feed_eagle: 0, feed_penguin: 0, feed_polar_bear: 0, feed_shark: 0, feed_lobster: 0, feed_clam: 0, feed_seagull: 0, feed_peacock: 0, feed_white_tiger: 0, feed_snow_leopard: 0, feed_pangolin: 0, feed_crane: 0, feed_otter: 0, feed_monkey: 0, feed_turkey: 0, feed_frog: 0, feed_camel: 0, feed_octopus: 0, feed_stag_beetle: 0, feed_flamingo: 0, feed_snow_fox: 0, feed_fire_salamander: 0, feed_wild_horse: 0, feed_antelope: 0, feed_mantis: 0, feed_panda: 0, feed_bear: 0, feed_tiger: 0, feed_python: 0, feed_hedgehog: 0, feed_butterfly: 0, feed_bear_king: 0, feed_spider_queen: 0, feed_lava_demon: 0, feed_frost_phoenix: 0, feed_shadow_lord: 0, feed_sea_serpent: 0, feed_thunder_eagle: 0, feed_crystal_dragon: 0, feed_unicorn_king: 0
}

export function newBag() {
  var b = {}
  for (var k in BAG_DEFAULTS) b[k] = BAG_DEFAULTS[k]
  return b
}

// 死亡不掉落的物品：炉石/门票/卡片/金币等特殊道具与家具
var DEATH_DROP_EXCLUDE = {
  hearthstone: 1, adventurer_card: 1, class_change_ticket: 1, boss_ticket: 1, gem_protect_ticket: 1, coin: 1,
  crafting_table: 1, chest: 1, bed: 1, chair: 1, furnace: 1, furnace2: 1, forge: 1, cooking_pot: 1, gem_forge: 1, gem_remover: 1, repair_table: 1, alchemy_table: 1
}

// 死亡掉落：从背包随机抽取部分物品（最多 5 种、每种 1~5 个），特殊道具与家具不参与
export function pickDeathDrops(bag) {
  var out = {}
  if (!bag) return out
  var cands = []
  for (var k in bag) {
    if (DEATH_DROP_EXCLUDE[k]) continue
    var c = bag[k] || 0
    if (c > 0) cands.push(k)
  }
  var n = Math.min(5, cands.length)
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(Math.random() * cands.length)
    var key = cands.splice(idx, 1)[0]
    var cnt = bag[key] || 0
    out[key] = 1 + Math.floor(Math.random() * Math.min(5, cnt))
  }
  return out
}

for (var gd0 = 0; gd0 < GEM_TYPES.length; gd0++) {
  for (var gl1 = 1; gl1 <= 6; gl1++) {
    BAG_DEFAULTS['gem_' + GEM_TYPES[gd0] + '_' + gl1] = 0
  }
}

// 统一解析存档背包：缺的键补 0，避免各页面手写一长串
export function parseBag(data) {
  var bag = newBag()
  if (data) {
    try {
      var b = JSON.parse(data)
      for (var k in BAG_DEFAULTS) bag[k] = b[k] || 0
    } catch (e) {}
  }
  return bag
}

// 装备槽位：四件防具 + 一个工具 + 一个武器
export var EQUIP_SLOTS = [
  { key: 'helmet', name: '头盔' },
  { key: 'armor',  name: '胸甲' },
  { key: 'pants',  name: '裤子' },
  { key: 'shoes',  name: '鞋子' },
  { key: 'tool',   name: '工具' },
  { key: 'weapon', name: '武器' }
]

// 装备定义：stats 里 hp=生命上限加成，def=减伤，chop=伐木加成，mine=挖矿加成，dmg=战斗伤害加成
export var EQUIP_DEFS = [
  { key: 'fiber_helmet', name: '纤维帽', slot: 'helmet', type: '防具', color: '#c8a56a', img: '/common/item/icon_fiber_helmet.png', stats: { hp: 12, def: 2, resist: 1 }, desc: '植物纤维编成的帽子，聊胜于无。减伤+1%。' },
  { key: 'fiber_armor',  name: '纤维胸甲', slot: 'armor', type: '防具', color: '#c8a56a', img: '/common/item/icon_fiber_armor.png', stats: { hp: 18, def: 5, resist: 2 }, desc: '植物纤维编成的胸甲，能挡一点伤害。减伤+2%。' },
  { key: 'fiber_pants',  name: '纤维裤', slot: 'pants', type: '防具', color: '#c8a56a', img: '/common/item/icon_fiber_pants.png', stats: { hp: 14, def: 3, resist: 1 }, desc: '植物纤维编成的裤子，行动方便。减伤+1%。' },
  { key: 'fiber_shoes',  name: '纤维鞋', slot: 'shoes', type: '防具', color: '#c8a56a', img: '/common/item/icon_fiber_shoes.png', stats: { hp: 10, def: 2, resist: 1 }, desc: '植物纤维编成的鞋子，轻便耐磨。减伤+1%。' },
  { key: 'iron_helmet', name: '铁盔', slot: 'helmet', type: '防具', color: '#b7c0cc', img: '/common/item/icon_iron_helmet.png', stats: { hp: 20, def: 5, resist: 2 }, desc: '锻造出的铁盔，坚固可靠。减伤+2%。' },
  { key: 'iron_armor',  name: '铁胸甲', slot: 'armor', type: '防具', color: '#b7c0cc', img: '/common/item/icon_iron_armor.png', stats: { hp: 30, def: 9, resist: 3 }, desc: '锻造出的铁胸甲，防御出众。减伤+3%。' },
  { key: 'iron_pants',  name: '铁裤', slot: 'pants', type: '防具', color: '#b7c0cc', img: '/common/item/icon_iron_pants.png', stats: { hp: 24, def: 6, resist: 2 }, desc: '锻造出的铁裤，行动依然灵活。减伤+2%。' },
  { key: 'iron_shoes',  name: '铁靴', slot: 'shoes', type: '防具', color: '#b7c0cc', img: '/common/item/icon_iron_shoes.png', stats: { hp: 16, def: 4, resist: 2 }, desc: '锻造出的铁靴，厚重沉稳。减伤+2%。' },
{ key: 'copper_helmet', name: '铜盔', slot: 'helmet', type: '防具', color: '#d68e5f', img: '/common/item/icon_copper_helmet.png', stats: { hp: 24, def: 6, resist: 2 }, desc: '铜铸成的头盔，比铁轻便。减伤+2%。' },
{ key: 'copper_armor', name: '铜胸甲', slot: 'armor', type: '防具', color: '#d68e5f', img: '/common/item/icon_copper_armor.png', stats: { hp: 36, def: 11, resist: 3 }, desc: '铜铸成的胸甲，防御不俗。减伤+3%。' },
{ key: 'copper_pants', name: '铜裤', slot: 'pants', type: '防具', color: '#d68e5f', img: '/common/item/icon_copper_pants.png', stats: { hp: 28, def: 7, resist: 2 }, desc: '铜铸成的战裤，行动便捷。减伤+2%。' },
{ key: 'copper_shoes', name: '铜靴', slot: 'shoes', type: '防具', color: '#d68e5f', img: '/common/item/icon_copper_shoes.png', stats: { hp: 20, def: 5, resist: 2 }, desc: '铜铸成的战靴，踏实有力。减伤+2%。' },
  { key: 'wood_axe',  name: '木斧', slot: 'tool', type: '工具', color: '#c8a56a', img: '/common/item/icon_wood_axe.png', stats: { chop: 2 }, desc: '粗木做成的斧头，砍树比拳头快。' },
  { key: 'stone_axe', name: '石斧', slot: 'tool', type: '工具', color: '#9aa7b5', img: '/common/item/icon_stone_axe.png', stats: { chop: 5 }, desc: '锋利的石斧，砍树更省力。' },
  { key: 'iron_axe',  name: '铁斧', slot: 'tool', type: '工具', color: '#b7c0cc', img: '/common/item/icon_iron_axe.png', stats: { chop: 9 }, desc: '结实的铁斧，伐木利器。' },
  { key: 'wood_pick',  name: '木镐', slot: 'tool', type: '工具', color: '#c8a56a', img: '/common/item/icon_wood_pick.png', stats: { mine: 2 }, desc: '粗木做成的镐，挖矿比拳头快。' },
 { key: 'stone_pick', name: '石镐', slot: 'tool', type: '工具', color: '#9aa7b5', img: '/common/item/icon_stone_pick.png', stats: { mine: 5 }, desc: '坚硬的石镐，凿矿更省力。' },
  { key: 'wood_rod', name: '木鱼竿', slot: 'tool', type: '工具', color: '#b0885a', img: '/common/item/icon_wood_rod.png', stats: { fish: 1 }, desc: '粗糙的木鱼竿，新手入门。' },
  { key: 'iron_rod', name: '铁鱼竿', slot: 'tool', type: '工具', color: '#b7c0cc', img: '/common/item/icon_iron_rod.png', stats: { fish: 2 }, desc: '铁制鱼竿，收杆更容易命中。' },
  { key: 'mythril_rod', name: '秘银鱼竿', slot: 'tool', type: '工具', color: '#bfe8ff', img: '/common/item/icon_mythril_rod.png', stats: { fish: 3 }, desc: '秘银鱼竿，传说能钓起深海巨物。' },
  { key: 'iron_pick',  name: '铁镐', slot: 'tool', type: '工具', color: '#b7c0cc', img: '/common/item/icon_iron_pick.png', stats: { mine: 9 }, desc: '锋利的铁镐，挖矿利器。' },
{ key: 'silver_axe',  name: '银斧', slot: 'tool', type: '工具', color: '#c8d8e8', img: '/common/item/icon_silver_axe.png', stats: { chop: 14 }, desc: '银制斧，砍树更轻盈。' },
{ key: 'silver_pick', name: '银镐', slot: 'tool', type: '工具', color: '#c8d8e8', img: '/common/item/icon_silver_pick.png', stats: { mine: 14 }, desc: '银制镐，挖矿更顺畅。' },
{ key: 'gold_axe',    name: '金斧', slot: 'tool', type: '工具', color: '#ffd36d', img: '/common/item/icon_gold_axe.png', stats: { chop: 18 }, desc: '金制斧，砍树轻而易举。' },
{ key: 'gold_pick',   name: '金镐', slot: 'tool', type: '工具', color: '#ffd36d', img: '/common/item/icon_gold_pick.png', stats: { mine: 18 }, desc: '金制镐，挖矿效率极高。' },
{ key: 'mythril_axe',   name: '秘银斧', slot: 'tool', type: '工具', color: '#bfe8ff', img: '/common/item/icon_mythril_axe.png', stats: { chop: 22 }, desc: '秘银斧，旋转如风。' },
{ key: 'mythril_pick',  name: '秘银镐', slot: 'tool', type: '工具', color: '#bfe8ff', img: '/common/item/icon_mythril_pick.png', stats: { mine: 22 }, desc: '秘银镐，错石如泥。' },
{ key: 'dark_iron_axe',  name: '玄铁斧', slot: 'tool', type: '工具', color: '#8a90a8', img: '/common/item/icon_dark_iron_axe.png', stats: { chop: 26 }, desc: '玄铁斧，力能拆山。' },
{ key: 'dark_iron_pick', name: '玄铁镐', slot: 'tool', type: '工具', color: '#8a90a8', img: '/common/item/icon_dark_iron_pick.png', stats: { mine: 26 }, desc: '玄铁镐，尖锐无比。' },
{ key: 'crystal_axe',  name: '魂晶斧', slot: 'tool', type: '工具', color: '#7ad8e8', img: '/common/item/icon_crystal_axe.png', stats: { chop: 30 }, desc: '魂晶斧，充满灵力。' },
{ key: 'crystal_pick', name: '魂晶镐', slot: 'tool', type: '工具', color: '#7ad8e8', img: '/common/item/icon_crystal_pick.png', stats: { mine: 30 }, desc: '魂晶镐，快如闪电。' },
{ key: 'starfall_axe',  name: '星辉斧', slot: 'tool', type: '工具', color: '#5a96e6', img: '/common/item/icon_starfall_axe.png', stats: { chop: 34 }, desc: '星辉斧，斜斩星辰。' },
{ key: 'starfall_pick', name: '星辉镐', slot: 'tool', type: '工具', color: '#5a96e6', img: '/common/item/icon_starfall_pick.png', stats: { mine: 34 }, desc: '星辉镐，挖开宇宙。' },
{ key: 'adamant_axe',  name: '圣金斧', slot: 'tool', type: '工具', color: '#e6b242', img: '/common/item/icon_adamant_axe.png', stats: { chop: 40 }, desc: '圣金斧，斠往不利。' },
{ key: 'adamant_pick', name: '圣金镐', slot: 'tool', type: '工具', color: '#e6b242', img: '/common/item/icon_adamant_pick.png', stats: { mine: 40 }, desc: '圣金镐，可以挖穿大地。' },
  { key: 'wood_sword',  name: '木剑', slot: 'weapon', type: '武器', color: '#c8a56a', img: '/common/item/icon_wood_sword.png', atkMin: 10, atkMax: 14, desc: '削尖的木剑，攻击 10~14。' },
  { key: 'stone_sword', name: '石剑', slot: 'weapon', type: '武器', color: '#9aa7b5', img: '/common/item/icon_stone_sword.png', atkMin: 18, atkMax: 24, desc: '石刃剑，攻击 18~24。' },
  { key: 'iron_sword',  name: '铁剑', slot: 'weapon', type: '武器', color: '#b7c0cc', img: '/common/item/icon_iron_sword.png', atkMin: 36, atkMax: 45, desc: '铁剑，攻击 36~45。' },
  { key: 'bone_sword',  name: '骨剑', slot: 'weapon', type: '武器', color: '#e8e4d8', img: '/common/item/icon_bone_sword.png', atkMin: 26, atkMax: 33, desc: '白骨磨成的剑，攻击 26~33。' },
  { key: 'wood_staff',  name: '木杖', slot: 'weapon', type: '武器', color: '#8fca7a', img: '/common/item/icon_wood_staff.png', magMin: 11, magMax: 15, stats: { manaRegen: 2 }, desc: '魔法学徒的木杖，法伤 11~15，普攻回蓝+2%。' },
  { key: 'stone_staff', name: '石杖', slot: 'weapon', type: '武器', color: '#9aa7b5', img: '/common/item/icon_stone_staff.png', magMin: 20, magMax: 26, stats: { manaRegen: 3 }, desc: '石杖，法伤 20~26，普攻回蓝+3%。' },
  { key: 'bone_staff',  name: '骨杖', slot: 'weapon', type: '武器', color: '#e8e4d8', img: '/common/item/icon_bone_staff.png', magMin: 28, magMax: 35, stats: { manaRegen: 4 }, desc: '白骨法杖，法伤 28~35，普攻回蓝+4%。' },
  { key: 'iron_staff',  name: '铁杖', slot: 'weapon', type: '武器', color: '#b7c0cc', img: '/common/item/icon_iron_staff.png', magMin: 38, magMax: 47, stats: { manaRegen: 6 }, desc: '铁杖，法伤 38~47，普攻回蓝+6%。' },
  { key: 'old_tome',    name: '旧典', slot: 'weapon', type: '武器', color: '#c8a56a', img: '/common/item/icon_old_tome.png', atkMin: 22, atkMax: 28, stats: { resist: 2 }, cls: 'priest', desc: '泛黄的古老典籍，攻击 22~28，减伤+2%，只有牧师能装备。' },
  { key: 'holy_tome',   name: '圣典', slot: 'weapon', type: '武器', color: '#e8d86a', img: '/common/item/icon_holy_tome.png', atkMin: 42, atkMax: 50, stats: { resist: 4, hp: 30 }, cls: 'priest', desc: '神圣箴言之书，攻击 42~50，减伤+4%、生命+30，只有牧师能装备。' },
  { key: 'copper_sword', name: '铜剑', slot: 'weapon', type: '武器', color: '#d98e5f', img: '/common/item/icon_copper_sword.png', atkMin: 30, atkMax: 38, desc: '铜剑，攻击 30~38。' },
  { key: 'copper_staff', name: '铜杖', slot: 'weapon', type: '武器', color: '#d98e5f', img: '/common/item/icon_copper_staff.png', magMin: 31, magMax: 39, stats: { manaRegen: 2 }, desc: '铜杖，法伤 31~39，普攻回蓝+2%。' },
  { key: 'silver_sword', name: '银剑', slot: 'weapon', type: '武器', color: '#c8d8e8', img: '/common/item/icon_silver_sword.png', atkMin: 48, atkMax: 58, desc: '银剑，攻击 48~58。' },
  { key: 'silver_staff', name: '银杖', slot: 'weapon', type: '武器', color: '#c8d8e8', img: '/common/item/icon_silver_staff.png', magMin: 49, magMax: 59, stats: { manaRegen: 6 }, desc: '银杖，法伤 49~59，普攻回蓝+6%。' },
  { key: 'gold_sword', name: '金剑', slot: 'weapon', type: '武器', color: '#ffd36d', img: '/common/item/icon_gold_sword.png', atkMin: 60, atkMax: 70, desc: '金剑，攻击 60~70。' },
  { key: 'gold_staff', name: '金杖', slot: 'weapon', type: '武器', color: '#ffd36d', img: '/common/item/icon_gold_staff.png', magMin: 61, magMax: 71, stats: { manaRegen: 7 }, desc: '金杖，法伤 61~71，普攻回蓝+7%。' },
  { key: 'mythril_sword', name: '秘银剑', slot: 'weapon', type: '武器', color: '#bfe8ff', img: '/common/item/icon_mythril_sword.png', atkMin: 78, atkMax: 90, desc: '秘银剑，攻击 78~90。' },
  { key: 'mythril_staff', name: '秘银杖', slot: 'weapon', type: '武器', color: '#bfe8ff', img: '/common/item/icon_mythril_staff.png', magMin: 79, magMax: 91, stats: { manaRegen: 9 }, desc: '秘银杖，法伤 79~91，普攻回蓝+9%。' },
  { key: 'dark_iron_sword', name: '玄铁剑', slot: 'weapon', type: '武器', color: '#8a90a8', img: '/common/item/icon_dark_iron_sword.png', atkMin: 92, atkMax: 106, desc: '玄铁剑，攻击 92~106。' },
  { key: 'dark_iron_staff', name: '玄铁杖', slot: 'weapon', type: '武器', color: '#8a90a8', img: '/common/item/icon_dark_iron_staff.png', magMin: 93, magMax: 107, stats: { manaRegen: 10 }, desc: '玄铁杖，法伤 93~107，普攻回蓝+10%。' },
  { key: 'amber_staff', name: '琥珀杖', slot: 'weapon', type: '武器', color: '#ffb050', img: '/common/item/icon_amber_staff.png', magMin: 63, magMax: 73, stats: { manaRegen: 6 }, desc: '琥珀杖，法伤 63~73，普攻回蓝+6%。' },
  { key: 'crystal_sword', name: '魂晶剑', slot: 'weapon', type: '武器', color: '#7ad8e8', img: '/common/item/icon_crystal_sword.png', atkMin: 108, atkMax: 124, desc: '魂晶剑，攻击 108~124。' },
  { key: 'crystal_staff', name: '魂晶杖', slot: 'weapon', type: '武器', color: '#7ad8e8', img: '/common/item/icon_crystal_staff.png', magMin: 109, magMax: 125, stats: { manaRegen: 12 }, desc: '魂晶杖，法伤 109~125，普攻回蓝+12%。' },
  { key: 'starfall_sword', name: '星辉剑', slot: 'weapon', type: '武器', color: '#5a96e6', img: '/common/item/icon_starfall_sword.png', atkMin: 120, atkMax: 134, desc: '星辉剑，攻击 120~134。' },
  { key: 'starfall_staff', name: '星辉杖', slot: 'weapon', type: '武器', color: '#5a96e6', img: '/common/item/icon_starfall_staff.png', magMin: 121, magMax: 135, stats: { manaRegen: 14 }, desc: '星辉杖，法伤 121~135，普攻回蓝+14%。' },
  { key: 'adamant_sword', name: '圣金剑', slot: 'weapon', type: '武器', color: '#e6b242', img: '/common/item/icon_adamant_sword.png', atkMin: 150, atkMax: 170, desc: '圣金剑，攻击 150~170。' },
  { key: 'adamant_staff', name: '圣金杖', slot: 'weapon', type: '武器', color: '#e6b242', img: '/common/item/icon_adamant_staff.png', magMin: 151, magMax: 171, stats: { manaRegen: 16 }, desc: '圣金杖，法伤 151~171，普攻回蓝+16%。' },
  { key: 'snake_armor',  name: '蛇鳞胸甲', slot: 'armor', type: '防具', color: '#c8b890', img: '/common/item/icon_fiber_armor.png', stats: { hp: 26, def: 9, resist: 3 }, desc: '蛇鳞缝制的胸甲，坚韧防毒。减伤+3%。' },
  { key: 'vulture_boots', name: '秃鹫羽靴', slot: 'shoes', type: '防具', color: '#8a8a90', img: '/common/item/icon_fiber_shoes.png', stats: { hp: 14, def: 4, resist: 2 }, desc: '秃鹫羽编成的轻靴，脚步轻快。减伤+2%。' },
  { key: 'amber_sword', name: '琥珀剑', slot: 'weapon', type: '武器', color: '#ffb050', img: '/common/item/icon_iron_sword.png', atkMin: 48, atkMax: 58, desc: '琥珀与铁锻成的利剑，攻击 48~58。' },
  { key: 'silver_helmet', name: '银盔', slot: 'helmet', type: '防具', color: '#c8d8e8', img: '/common/item/icon_silver_helmet.png', stats: { hp: 28, def: 7, resist: 2 }, desc: '锻造出的银盔，轻盈坚固。减伤+2%。' },
  { key: 'silver_armor', name: '银胸甲', slot: 'armor', type: '防具', color: '#c8d8e8', img: '/common/item/icon_silver_armor.png', stats: { hp: 42, def: 13, resist: 3 }, desc: '锻造出的银胸甲，防御出众。减伤+3%。' },
  { key: 'silver_pants', name: '银裤', slot: 'pants', type: '防具', color: '#c8d8e8', img: '/common/item/icon_silver_pants.png', stats: { hp: 34, def: 9, resist: 2 }, desc: '锻造出的银裤，行动自如。减伤+2%。' },
  { key: 'silver_shoes', name: '银靴', slot: 'shoes', type: '防具', color: '#c8d8e8', img: '/common/item/icon_silver_shoes.png', stats: { hp: 24, def: 6, resist: 2 }, desc: '锻造出的银靴，轻快沉稳。减伤+2%。' },
{ key: 'gold_helmet', name: '金盔', slot: 'helmet', type: '防具', color: '#e6b242', img: '/common/item/icon_gold_helmet.png', stats: { hp: 34, def: 9, resist: 3 }, desc: '金光闪闪的头盔，华贵而坚固。减伤+3%。' },
{ key: 'gold_armor', name: '金胸甲', slot: 'armor', type: '防具', color: '#e6b242', img: '/common/item/icon_gold_armor.png', stats: { hp: 52, def: 16, resist: 4 }, desc: '纯金铸成的胸甲，防御出众。减伤+4%。' },
{ key: 'gold_pants', name: '金裤', slot: 'pants', type: '防具', color: '#e6b242', img: '/common/item/icon_gold_pants.png', stats: { hp: 40, def: 11, resist: 3 }, desc: '金线编织的战裤，轻便而耐用。减伤+3%。' },
{ key: 'gold_shoes', name: '金靴', slot: 'shoes', type: '防具', color: '#e6b242', img: '/common/item/icon_gold_shoes.png', stats: { hp: 28, def: 7, resist: 2 }, desc: '金铸成的战靴，步步生辉。减伤+2%。' },
  { key: 'dark_helmet', name: '玄铁盔', slot: 'helmet', type: '防具', color: '#8a90a8', img: '/common/item/icon_dark_helmet.png', stats: { hp: 40, def: 10, resist: 3 }, desc: '玄铁铸成的头盔，坚不可摧。减伤+3%。' },
  { key: 'dark_armor', name: '玄铁胸甲', slot: 'armor', type: '防具', color: '#8a90a8', img: '/common/item/icon_dark_armor.png', stats: { hp: 60, def: 18, resist: 4 }, desc: '玄铁铸成的胸甲，防御极高。减伤+4%。' },
  { key: 'dark_pants', name: '玄铁裤', slot: 'pants', type: '防具', color: '#8a90a8', img: '/common/item/icon_dark_pants.png', stats: { hp: 48, def: 12, resist: 3 }, desc: '玄铁铸成的裤子，厚重沉稳。减伤+3%。' },
  { key: 'dark_shoes', name: '玄铁靴', slot: 'shoes', type: '防具', color: '#8a90a8', img: '/common/item/icon_dark_shoes.png', stats: { hp: 34, def: 8, resist: 3 }, desc: '玄铁铸成的靴子，步步沉稳。减伤+3%。' },
{ key: 'mythril_helmet', name: '秘银盔', slot: 'helmet', type: '防具', color: '#bfe8ff', img: '/common/item/icon_mythril_helmet.png', stats: { hp: 48, def: 12, resist: 4 }, desc: '秘银铸成的头盔，寒光凛烈。减伤+4%。' },
{ key: 'mythril_armor', name: '秘银胸甲', slot: 'armor', type: '防具', color: '#bfe8ff', img: '/common/item/icon_mythril_armor.png', stats: { hp: 72, def: 21, resist: 5 }, desc: '秘银铸成的胸甲，轻盈坚硬。减伤+5%。' },
{ key: 'mythril_pants', name: '秘银裤', slot: 'pants', type: '防具', color: '#bfe8ff', img: '/common/item/icon_mythril_pants.png', stats: { hp: 56, def: 14, resist: 4 }, desc: '秘银铸成的战裤，灵活自如。减伤+4%。' },
{ key: 'mythril_shoes', name: '秘银靴', slot: 'shoes', type: '防具', color: '#bfe8ff', img: '/common/item/icon_mythril_shoes.png', stats: { hp: 38, def: 9, resist: 3 }, desc: '秘银铸成的战靴，踏雪无痕。减伤+3%。' },
  { key: 'starfall_helmet', name: '星辉盔', slot: 'helmet', type: '防具', color: '#5a96e6', img: '/common/item/icon_starfall_helmet.png', stats: { hp: 55, def: 14, resist: 4 }, desc: '星辉铸成的头盔，星光护体。减伤+4%。' },
  { key: 'starfall_armor',  name: '星辉胸甲', slot: 'armor', type: '防具', color: '#5a96e6', img: '/common/item/icon_starfall_armor.png', stats: { hp: 80, def: 24, resist: 5 }, desc: '星辉铸成的胸甲，坚不可摧。减伤+5%。' },
  { key: 'starfall_pants',  name: '星辉裤', slot: 'pants', type: '防具', color: '#5a96e6', img: '/common/item/icon_starfall_pants.png', stats: { hp: 65, def: 17, resist: 4 }, desc: '星辉铸成的战裤，行动如风。减伤+4%。' },
  { key: 'starfall_shoes',  name: '星辉靴', slot: 'shoes', type: '防具', color: '#5a96e6', img: '/common/item/icon_starfall_shoes.png', stats: { hp: 45, def: 11, resist: 3 }, desc: '星辉铸成的战靴，踏星而行。减伤+3%。' },
  { key: 'adamant_helmet', name: '圣金盔', slot: 'helmet', type: '防具', color: '#e6b242', img: '/common/item/icon_adamant_helmet.png', stats: { hp: 70, def: 18, resist: 5 }, desc: '传说圣金铸成的头盔，天下无双。减伤+5%。' },
  { key: 'adamant_armor',  name: '圣金胸甲', slot: 'armor', type: '防具', color: '#e6b242', img: '/common/item/icon_adamant_armor.png', stats: { hp: 100, def: 30, resist: 6 }, desc: '传说圣金铸成的胸甲，万敌难破。减伤+6%。' },
  { key: 'adamant_pants',  name: '圣金裤', slot: 'pants', type: '防具', color: '#e6b242', img: '/common/item/icon_adamant_pants.png', stats: { hp: 80, def: 21, resist: 5 }, desc: '传说圣金铸成的战裤，刚柔并济。减伤+5%。' },
  { key: 'adamant_shoes',  name: '圣金靴', slot: 'shoes', type: '防具', color: '#e6b242', img: '/common/item/icon_adamant_shoes.png', stats: { hp: 55, def: 14, resist: 4 }, desc: '传说圣金铸成的战靴，坚若磐石。减伤+4%。' },
]

var EQUIP_MAP = {}
for (var ei = 0; ei < EQUIP_DEFS.length; ei++) EQUIP_MAP[EQUIP_DEFS[ei].key] = EQUIP_DEFS[ei]

export function isEquip(key) { return !!EQUIP_MAP[key] }
export function getEquip(key) { return EQUIP_MAP[key] || null }

// 武器/防具（带品质、词条、宝石的装备）一件一格；工具不属于此类，仍按数量叠放
export function isGearKey(key) {
  var ed = getEquip(key)
  return !!(ed && (ed.slot === 'weapon' || ed.slot === 'helmet' || ed.slot === 'armor' || ed.slot === 'pants' || ed.slot === 'shoes'))
}

// 品质：越高攻击区间加成越高、随机词条越多
export var QUALITY_DEFS = [
  { key: 'common',    name: '普通', color: '#b8b8b8', atkMult: 1.0,  affixes: 0, weight: 50 },
  { key: 'fine',      name: '优秀', color: '#7ec850', atkMult: 1.1,  affixes: 0, weight: 25 },
  { key: 'rare',      name: '精良', color: '#5aa8e8', atkMult: 1.2,  affixes: 1, weight: 15 },
  { key: 'epic',      name: '史诗', color: '#c070e8', atkMult: 1.35, affixes: 1, weight: 8 },
  { key: 'legendary', name: '传说', color: '#ffa050', atkMult: 1.5,  affixes: 2, weight: 2 }
]

// 高级制作（额外消耗 Boss 掉落物）的品质概率：大幅提高高品质概率
export var ADV_QUALITY_DEFS = [
  { key: 'common',    name: '普通', color: '#b8b8b8', atkMult: 1.0,  affixes: 0, weight: 0 },
  { key: 'fine',      name: '优秀', color: '#7ec850', atkMult: 1.1,  affixes: 0, weight: 10 },
  { key: 'rare',      name: '精良', color: '#5aa8e8', atkMult: 1.2,  affixes: 1, weight: 30 },
  { key: 'epic',      name: '史诗', color: '#c070e8', atkMult: 1.35, affixes: 1, weight: 40 },
  { key: 'legendary', name: '传说', color: '#ffa050', atkMult: 1.5,  affixes: 2, weight: 20 }
]

// 随机词条池：数值在区间内随机
export var AFFIX_DEFS = [
  { key: 'lifesteal', name: '吸血', unit: '%', min: 2, max: 10 },
  { key: 'armorPen',  name: '破甲', unit: '%', min: 5, max: 25 },
  { key: 'crit',      name: '暴击', unit: '%', min: 2, max: 8 },
  { key: 'agi',       name: '敏捷', unit: '',  min: 1, max: 5 },
  { key: 'hp',        name: '生命', unit: '',  min: 10, max: 40 },
  { key: 'mp',        name: '蓝量', unit: '',  min: 5, max: 20 },
  { key: 'atk',       name: '攻击', unit: '',  min: 2, max: 8 },
  { key: 'magic',     name: '法术', unit: '',  min: 3, max: 10 },
  { key: 'resist',    name: '减伤', unit: '%', min: 1, max: 5 },
  { key: 'dodge',     name: '闪避', unit: '%', min: 1, max: 4 },
  { key: 'expPct',    name: '经验', unit: '%', min: 3, max: 10 }
]

export function getQuality(key) {
  for (var i = 0; i < QUALITY_DEFS.length; i++) {
    if (QUALITY_DEFS[i].key === key) return QUALITY_DEFS[i]
  }
  return QUALITY_DEFS[0]
}

export function rollQuality(adv) {
  var list = adv ? ADV_QUALITY_DEFS : QUALITY_DEFS
  var total = 0
  for (var i = 0; i < list.length; i++) total += list[i].weight
  var r = Math.random() * total
  for (var j = 0; j < list.length; j++) {
    r -= list[j].weight
    if (r < 0) return list[j].key
  }
  return 'common'
}

export function rollAffixes(count) {
  var pool = AFFIX_DEFS.slice()
  var out = []
  for (var i = 0; i < count && pool.length; i++) {
    var idx = Math.floor(Math.random() * pool.length)
    var a = pool.splice(idx, 1)[0]
    out.push({ key: a.key, name: a.name, unit: a.unit, val: a.min + Math.floor(Math.random() * (a.max - a.min + 1)) })
  }
  return out
}

// 生成一件随机品质的装备实例（武器/防具通用；adv=true 为高级制作品质池）
export function makeGearInstance(key, adv) {
  var q = rollQuality(adv)
  var inst = { key: key, quality: q, affixes: rollAffixes(getQuality(q).affixes), uid: newItemUid('it') }
  return initDurability(inst)
}

// 物品实例唯一ID（交易所按ID查询/展示，品质宝石不同的装备各自独立）
export function newItemUid(prefix) {
  return (prefix || 'it') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6)
}

// 兼容旧调用
export function makeWeaponInstance(key) {
  return makeGearInstance(key, false)
}

export function affixText(a) {
  return a.name + (a.unit === '%' ? '+' + a.val + '%' : '+' + a.val)
}

// 空的装备存档：{ 槽位: 物品key }
export function emptyEquip() {
  return { helmet: '', armor: '', pants: '', shoes: '', tool: '', weapon: '' }
}

// 装备耐久：按槽位和品质设定上限
// 工具/武器 250~410，防具 300~460（品质越高耐久越高）
export function maxDurabilityFor(slot, quality) {
  var base = (slot === 'tool' || slot === 'weapon') ? 250 : 300
  var qBonus = 0
  if (quality === 'fine') qBonus = 40
  else if (quality === 'rare') qBonus = 80
  else if (quality === 'epic') qBonus = 120
  else if (quality === 'legendary') qBonus = 160
  return base + qBonus
}

// 耐久初始化：给装备实例补充耐久字段
export function initDurability(inst) {
  if (!inst || typeof inst !== 'object') return inst
  if (!inst.uid) inst.uid = newItemUid('it')
  if (typeof inst.maxDur !== 'number') {
    var d = getEquip(inst.key)
    var slot = d ? d.slot : 'weapon'
    inst.maxDur = maxDurabilityFor(slot, inst.quality)
  }
  if (typeof inst.dur !== 'number') inst.dur = inst.maxDur
  if (inst.dur <= 0) inst.broken = true
  return inst
}

// 扣耐久：返回是否损坏
export function damageDurability(inst, amount) {
  if (!inst || typeof inst !== 'object') return false
  if (inst.broken) return true
  inst.dur = Math.max(0, (inst.dur || inst.maxDur || 100) - (amount || 1))
  if (inst.dur <= 0) {
    inst.broken = true
    return true
  }
  return false
}

// 修复耐久：返回修复后是否完好
export function repairDurability(inst) {
  if (!inst || typeof inst !== 'object') return false
  inst.dur = inst.maxDur
  inst.broken = false
  return true
}

// 装备修复材料：key -> 修复用的主材料 + 数量（约为制作成本的 60~70%）
// 材料按装备等级：木/石/铜/铁/银/金/秘银/玄铁/魂晶/星辉/圣金
export var REPAIR_MATS = {
  // 工具（斧/镐）
  wood_axe: 'wood', stone_axe: 'stone', copper_axe: 'copper_ingot', iron_axe: 'iron_ingot',
  silver_axe: 'silver_ingot', gold_axe: 'gold_ingot', mythril_axe: 'mythril_ingot', dark_iron_axe: 'dark_iron_ingot',
  crystal_axe: 'spirit_crystal', starfall_axe: 'starfall_ingot', adamant_axe: 'adamant_ingot',
  wood_pick: 'wood', stone_pick: 'stone', copper_pick: 'copper_ingot', iron_pick: 'iron_ingot',
  silver_pick: 'silver_ingot', gold_pick: 'gold_ingot', mythril_pick: 'mythril_ingot', dark_iron_pick: 'dark_iron_ingot',
  crystal_pick: 'spirit_crystal', starfall_pick: 'starfall_ingot', adamant_pick: 'adamant_ingot',
  // 鱼竿
  wood_rod: 'wood', iron_rod: 'iron_ingot', mythril_rod: 'mythril_ingot',
  // 武器（剑/杖）
  wood_sword: 'wood', stone_sword: 'stone', copper_sword: 'copper_ingot', iron_sword: 'iron_ingot',
  silver_sword: 'silver_ingot', gold_sword: 'gold_ingot', mythril_sword: 'mythril_ingot', dark_iron_sword: 'dark_iron_ingot',
  crystal_sword: 'spirit_crystal', starfall_sword: 'starfall_ingot', adamant_sword: 'adamant_ingot',
  wood_staff: 'wood', stone_staff: 'stone', copper_staff: 'copper_ingot', iron_staff: 'iron_ingot',
  silver_staff: 'silver_ingot', gold_staff: 'gold_ingot', mythril_staff: 'mythril_ingot', dark_iron_staff: 'dark_iron_ingot',
  crystal_staff: 'spirit_crystal', starfall_staff: 'starfall_ingot', adamant_staff: 'adamant_ingot',
  bone_sword: 'bone_shard', bone_staff: 'bone_shard', old_tome: 'bone_shard', holy_tome: 'iron_ingot',
  amber_sword: 'amber', amber_staff: 'amber',
  // 防具
  fiber_helmet: 'fiber', fiber_armor: 'fiber', fiber_pants: 'fiber', fiber_shoes: 'fiber',
  copper_helmet: 'copper_ingot', copper_armor: 'copper_ingot', copper_pants: 'copper_ingot', copper_shoes: 'copper_ingot',
  iron_helmet: 'iron_ingot', iron_armor: 'iron_ingot', iron_pants: 'iron_ingot', iron_shoes: 'iron_ingot',
  silver_helmet: 'silver_ingot', silver_armor: 'silver_ingot', silver_pants: 'silver_ingot', silver_shoes: 'silver_ingot',
  gold_helmet: 'gold_ingot', gold_armor: 'gold_ingot', gold_pants: 'gold_ingot', gold_shoes: 'gold_ingot',
  dark_helmet: 'dark_iron_ingot', dark_armor: 'dark_iron_ingot', dark_pants: 'dark_iron_ingot', dark_shoes: 'dark_iron_ingot',
  mythril_helmet: 'mythril_ingot', mythril_armor: 'mythril_ingot', mythril_pants: 'mythril_ingot', mythril_shoes: 'mythril_ingot',
  starfall_helmet: 'starfall_ingot', starfall_armor: 'starfall_ingot', starfall_pants: 'starfall_ingot', starfall_shoes: 'starfall_ingot',
  adamant_helmet: 'adamant_ingot', adamant_armor: 'adamant_ingot', adamant_pants: 'adamant_ingot', adamant_shoes: 'adamant_ingot',
  snake_armor: 'snake_scale', vulture_boots: 'vulture_feather'
}

// 修复成本：主材料数量按装备品质加成，另需少量魂晶
// 基础材料量：工具/武器 12~18，防具 10~16（按档次）
export function repairCost(key, quality) {
  var mat = REPAIR_MATS[key] || 'iron_ingot'
  var d = getEquip(key)
  var slot = d ? d.slot : 'weapon'
  var base = slot === 'armor' || slot === 'helmet' || slot === 'pants' || slot === 'shoes' ? 10 : 14
  var q = quality === 'fine' ? 1.2 : quality === 'rare' ? 1.4 : quality === 'epic' ? 1.7 : quality === 'legendary' ? 2 : 1
  var matN = Math.max(1, Math.round(base * q))
  var crystalN = slot === 'tool' ? 5 : 8
  var coinN = quality === 'legendary' ? 1000 : quality === 'epic' ? 400 : quality === 'rare' ? 150 : quality === 'fine' ? 50 : 0
  return { mat: mat, matN: matN, crystalN: crystalN, coinN: coinN }
}

// 汇总当前装备的所有加成
export function equipStats(e) {
  var s = { hp: 0, def: 0, chop: 0, mine: 0, fish: 0, dmg: 0, magic: 0, lifesteal: 0, armorPen: 0, resist: 0, crit: 0, agi: 0, mp: 0, atk: 0, atkMin: 0, atkMax: 0, magMin: 0, magMax: 0, dodge: 0, expPct: 0, manaRegen: 0 }
  if (!e) return s
  for (var i = 0; i < EQUIP_DEFS.length; i++) {
    var d = EQUIP_DEFS[i]
    var slotVal = e[d.slot]
    var key = typeof slotVal === 'string' ? slotVal : (slotVal && slotVal.key) || ''
    if (key !== d.key) continue
    // 损坏的装备不提供任何加成（但保持装备状态）
    if (typeof slotVal === 'object' && slotVal.broken) continue
    var qd = (typeof slotVal === 'object' && slotVal.quality) ? getQuality(slotVal.quality) : getQuality('common')
    if (d.stats) {
      var qm = (qd && qd.atkMult) || 1
      s.hp += Math.round((d.stats.hp || 0) * qm)
      s.def += Math.round((d.stats.def || 0) * qm)
      s.chop += d.stats.chop || 0
      s.mine += d.stats.mine || 0
      s.fish += d.stats.fish || 0
      s.dmg += d.stats.dmg || 0
      s.magic += d.stats.magic || 0
      s.lifesteal += d.stats.lifesteal || 0
      s.armorPen += d.stats.armorPen || 0
      s.resist += d.stats.resist || 0
      s.manaRegen += d.stats.manaRegen || 0
    }
    if (typeof d.atkMin === 'number' && typeof d.atkMax === 'number') {
      var mult = (qd && qd.atkMult) || 1
      s.atkMin += Math.round(d.atkMin * mult)
      s.atkMax += Math.round(d.atkMax * mult)
    }
    if (typeof d.magMin === 'number' && typeof d.magMax === 'number') {
      var mmult = (qd && qd.atkMult) || 1
      s.magMin += Math.round(d.magMin * mmult)
      s.magMax += Math.round(d.magMax * mmult)
    }
    if (typeof slotVal === 'object' && slotVal.affixes) {
      for (var ai = 0; ai < slotVal.affixes.length; ai++) {
        var a = slotVal.affixes[ai]
        s[a.key] = (s[a.key] || 0) + (a.val || 0)
      }
    }
    if (typeof slotVal === 'object' && slotVal.gem) {
      var gst = gemStats(slotVal.gem)
      for (var gk3 in gst) s[gk3] = (s[gk3] || 0) + gst[gk3]
    }
  }
  return s
}

// 存储上限：背包最多同时持有多少种物品，箱子同理（按“种类”计格位）
export var MAX_BAG_TYPES = 60
export var MAX_CHEST_TYPES = 30

// 总背包上限：普通物品种类 + 装备实例合计最多 60 格（不再区分普通物品与装备）
export var MAX_BAG_SLOTS = 60

// 总占用格数：普通物品种类数 + 装备实例数（背包内未装备 + 身上穿着的）
export function bagSlotCount(bag, gearBag, equip) {
  var n = bagTypeCount(bag)
  n += gearSlotCount(gearBag, equip)
  return n
}

// 当前装备实例总数（背包里未装备的 + 身上穿着的）
export function gearSlotCount(gearBag, equip) {
  var n = 0
  var g = gearBag || {}
  for (var k in g) {
    if ((g[k] || []).length > 0) n += g[k].length
  }
  var e = equip || {}
  for (var s in e) {
    var v = e[s]
    if (v && typeof v === 'object' && v.key && isGearKey(v.key)) n++
  }
  return n
}

// 统计一个背包/仓库里目前占用了多少种物品格位
export function bagTypeCount(bag) {
  var n = 0
  if (!bag) return 0
  for (var k in BAG_DEFAULTS) {
    // 装备走“一件一格”，不再占用普通物品的类型上限
    if ((bag[k] || 0) > 0 && !isGearKey(k)) n++
  }
  return n
}

// 背包是否还能容纳这个物品类型：已有该类型可继续叠加；否则要求未满 40 种
export function canAddType(bag, key) {
  if (!bag) return true
  return (bag[key] || 0) > 0 || bagTypeCount(bag) < MAX_BAG_TYPES
}

// 家园地图坐标（炉石传送目标：室内门口内；对应地图页 MAP_NAMES 中「家园」的位置）
export var HOME_POS = { x: 327, y: 610, mx: 1, my: 0 }

// 资源/怪物刷新时间（10 分钟）
export var RESPAWN_MS = 10 * 60 * 1000
