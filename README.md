# 异世界传说 服务端

参照《开箱游戏 / 对决 / 垃圾佬》服务端实现：注册/登录、存档上传下载、交易所（10% 手续费）、充值订单与回调、邮箱（任意奖励）、激活码、排行榜、PVP、公告/版本。

## 部署

1. 服务器装 Node 18+ 与 MySQL 8。
2. 建库：`mysql -u root -p < schema.sql`
3. 建服务账号并授权：
   ```sql
   CREATE USER 'yishijie'@'localhost' IDENTIFIED BY '你的密码';
   GRANT ALL ON yishijie.* TO 'yishijie'@'localhost';
   ```
4. `cp .env.example .env` 并填写（端口建议 5402）。
5. `npm install && npm start`

systemd 参考（与 duijue-server.service 同款）：
```ini
[Unit]
Description=Yishijie Server
After=network.target
[Service]
WorkingDirectory=/opt/yishijie-server
ExecStart=/usr/bin/node /opt/yishijie-server/src/server.js
Restart=always
[Install]
WantedBy=multi-user.target
```

## 接口（前缀 /api/yishijie）

- `POST /register` {playerName, deviceFingerprint, phoneFingerprint?} → {playerId, playerName, apiKey, isNew}
- `POST /login` {deviceFingerprint, phoneFingerprint?} → {playerId, playerName}
- `GET /saves/:playerId?deviceFingerprint=&apiKey=` → {data}
- `POST /saves/:playerId` {deviceFingerprint, apiKey, data} → 覆盖存档
- `POST /exchange/list` 挂单（自动从卖家存档扣除物品）
- `GET /exchange/listings?page=&size=` 在售列表
- `POST /exchange/buy` 购买（买家存档扣金币、卖家存档收金币、物品转给买家）
- `POST /exchange/cancel` 撤单（物品退回卖家存档）
- `GET /exchange/history?playerId=` 成交记录
- `GET /exchange/listings?category=item|gear|pet` 分类筛选在售挂单
- `POST /exchange/list` 支持 `category: "pet"` + `pet`（宠物对象）挂宠物单
- `POST /recharge/order` 创建充值订单
- `POST /recharge/callback` 支付回调（校验 XS-Sign）
- `POST /admin/mark-paid` 手动确认订单到账（测试用，需管理密钥）
- `GET /payment/afdian-url` 获取爱发电商品链接（手机端跳转支付）
- `POST /payment/afdian-webhook` 爱发电支付回调（HMAC-SHA256 验签，备注填 playerId，按 ¥1=10000 金币入存档）
- `GET /payment/orders` 查询我的充值订单（到账状态）
- `GET /mail/:playerId` 邮件列表（含 rewards 奖励对象）
- `POST /mail/claim` 领取邮件（金币/物品/装备/宠物直接写入存档）
- `POST /admin/mail/send` 发邮件，奖励结构 `{coins, items:{key:n}, gear:[], pets:[]}`
- `POST /redeem/redeem` 激活码兑换（奖励发到邮箱）
- `POST /admin/code/create` `GET /admin/code/list` `DELETE /admin/code/:code` 激活码管理
- `GET /leaderboard?type=level|pet|tower` 排行榜
- `GET /pvp/targets` `GET /pvp/defender` `POST /pvp/report` `GET /pvp/rating` PVP（AI 代守 + 积分）
- `POST /rename` 玩家自主改名（每月一次、敏感词/重名校验）
- `GET /announcements` 公告
- `GET /version` 版本号
- `GET /health` 健康检查

## 管理后台（参照垃圾佬）

- `GET /admin` 后台页面（Basic 认证，浏览器直接访问；账号密码在 .env 的 `ADMIN_USER` / `ADMIN_PASS`）
- `GET /api/yishijie/admin/stats` 统计（用户/存档/挂单/订单/邮件/封禁数）
- `GET /api/yishijie/admin/users?keyword=` 玩家列表（搜索、等级、金币、封禁状态）
- `GET /api/yishijie/admin/player/:playerId` 玩家详情 + 存档
- `DELETE /api/yishijie/admin/player/:playerId` 删除玩家及全部数据
- `POST /api/yishijie/admin/rename` 管理员改名
- `POST /api/yishijie/admin/ban` / `POST /api/yishijie/admin/unban` 封号 / 解封
- `POST /api/yishijie/punish` 制裁（强制改名违规昵称 + 封号）
- `GET/POST/DELETE /api/yishijie/admin/banned-fingerprints` 设备指纹黑名单（封设备）
- `POST /api/yishijie/admin/announcement` / `GET /api/yishijie/admin/announcements` / `DELETE /api/yishijie/admin/announcement/:id` 公告管理
- `POST /api/yishijie/admin/version` 版本推送（versionCode/versionName/downloadUrl/updateNotes，手机端检查更新）
- `GET /api/yishijie/admin/saves` 存档列表
- `GET /api/yishijie/admin/listings` 挂单列表

## 存档格式

手环端把整包存档上传为 JSON，服务端原样保存。交易所需要读取存档里的：

```json
{
  "bag": { "coin": 0, "wood": 10, "adamant_helmet": 2, "...": 0 },
  "gear": { "adamant_helmet": [ { "key":"adamant_helmet","quality":"epic","affixes":[],"gem":"","dur":100,"maxDur":100 } ] },
  "stats": { "hp":100, "hunger":100, "mp":50, "lv":1, "exp":0 },
  "pets": { "list": [], "active": "" }
}
```
