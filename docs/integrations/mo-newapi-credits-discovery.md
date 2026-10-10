# MO / BiSheng / NEW API 模型积分

状态：用户已授权直接开发（“直接开发，可以”）；两端代码已实现。本文记录配置、接口和验收步骤。

## 行为

- NEW API 是余额唯一来源。MO 只存 token ID、gateway 地址和绑定状态，不存余额或个人 key。
- MO 创建 BiSheng 用户时，创建名称为 MO `user_ID` 的 NEW API token，归属配置的管理账号；有限额度、永不过期。
- 默认额度由 `newapi_default_quota` 配置，默认 0。当前直接使用 NEW API 原始 quota 单位，不做货币换算。
- “设置模型积分”覆盖当前剩余额度；修改默认值只影响之后首次创建的 token。
- 教学管理的学生/教师资源分配页面展示余额并支持批量设置；个人设置的资源额度展示余额并支持刷新。
- 配置 NEW API 地址即启用接入；隐藏前端积分不关闭个人计费。
- BiSheng 对匹配网关的聊天、向量、重排、ASR、TTS 和 OpenAPI 工具请求替换调用用户的个人 key。供应商最终 URL 必须确实指向 NEW API。
- URL 按协议、主机、有效端口和路径边界匹配。不同用户的运行实例不修改共享配置。
- 已启用的网关请求缺少绑定时直接报错，不使用共享 key 代付。无绑定的系统账号、探活账号和本地用户也遵循此规则。

## 配置

### NEW API

使用 [QuantumNous/new-api main](https://github.com/QuantumNous/new-api/tree/main) 的现有管理接口，无需修改 NEW API 源码。

1. 为管理账号配置模型渠道，并维护足够的钱包余额。个人 token 配额不会为所属账号的钱包充值。
2. 在该账号的安全设置中创建管理访问令牌，授予 `api_key:read`、`api_key:write`、`api_key:reveal`。
3. 将管理访问令牌和账号 ID 配到 MO。管理访问令牌不是模型推理使用的 `sk-...` key。
4. 生产部署应记录所用 main 的具体镜像版本或 commit，升级后重新验证接口契约。

2026-10-10 核对的上游源码：

- [token 管理接口](https://github.com/QuantumNous/new-api/blob/main/controller/token.go)
- [管理权限](https://github.com/QuantumNous/new-api/blob/main/middleware/access_token_routes.go)
- [分页参数](https://github.com/QuantumNous/new-api/blob/main/common/page_info.go)
- [状态常量](https://github.com/QuantumNous/new-api/blob/main/common/constants.go)

### MO 后端

在当前 `product_edition` 的 config 文档 `backend_config` 中设置：

| 字段 | 值 / 说明 |
| --- | --- |
| `newapi_base_url` | 网关根地址，如 `https://newapi.example.com`，可带部署前缀；不要填写模型的 `/v1` 路径 |
| `newapi_admin_user_id` | 上述管理账号的整数 ID |
| `newapi_default_quota` | 新用户默认剩余积分，非负整数，默认 0 |
| `newapi_show_credits` | 是否展示积分，默认 false |
| `newapi_admin_access_token` | 明文管理访问令牌；未配置环境变量时使用 |

管理令牌优先从 MO 服务环境变量 `NEWAPI_ADMIN_ACCESS_TOKEN` 获取。
未配置该环境变量时，直接读取 config 中的明文 `newapi_admin_access_token`，无需加密密钥。
如果此前已填写密文，请将该字段替换成原始管理访问令牌。
管理访问令牌属于 MO 后端配置，不输出到前端配置或普通用户接口。

config 实时读取，不依赖启动时 `PRODUCT_CONFIG` 快照；环境变量修改后重启 MO 后端。
继续使用现有 `bisheng_platform_url`、学校用户组/默认角色和 MO 后端认证配置。
现有反向代理需将 `/mo-agent/api/v1/user/newapi_binding` 转发到 BiSheng 的 `/api/v1/user/newapi_binding`。

### MO 前端

`frontend/src/envConf/envConf.js` 的 `show.showModelCredits` 控制前端显示，默认 true。
最终显示需要同时满足前端开关、后端 `newapi_show_credits=true` 和已配置后端网关地址。
这是现有环境配置方式的开关，修改后需要重新构建前端。

### BiSheng

在全局系统配置（`initdb_config`）中设置：

```yaml
newapi_base_url: "https://newapi.example.com"
```

也支持启动 YAML 的同名字段作为数据库未配置该字段时的回退。
数据库中的显式空字符串会关闭接入。沿用 BiSheng 配置缓存，变更最长约 100 秒生效。
MO 与 BiSheng 必须配置同一个网关根地址。模型供应商/API 工具地址应指向该网关对应模型协议接口。

发布前在 BiSheng 后端执行正常的 `alembic upgrade head`。
新增独立表 `newapi_user_binding` 通过现有模型发现和 `create_all(checkfirst=True)` 创建，无需已有表字段变更。
BiSheng 使用现有 Fernet 密钥加密个人 key；各 API/worker 实例必须使用一致的密钥。

## 接口

MO 的接口均要求登录；批量接口另要求管理员角色和学校管理范围：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/bisheng/model-credits/config` | 仅返回 enabled/show，不返回管理凭据 |
| GET | `/bisheng/model-credits` | 当前用户的实时剩余额度；未创建 token 返回 null |
| POST | `/bisheng/model-credits` | `{user_ids: [MongoDB用户ID]}`，批量读取，1–100 个用户 |
| PUT | `/bisheng/model-credits` | `{user_ids: [...], remaining: 非负整数}`，设置当前剩余额度 |

批量响应 `results` 按 MongoDB 用户 ID 索引，逐用户返回 `success`、`remaining`。
部分失败时前端仅重试失败用户，避免重新覆盖已经成功用户的新消耗。
隐藏显示时普通余额读取不可用；管理员设置接口仍受接入启用状态及权限限制。

BiSheng `POST /api/v1/user/newapi_binding` 同时要求管理员登录和有效 `mo_backend_token`。
请求包含 BiSheng user_id、MO user_ID、token_id、gateway_url、个人 key；响应不返回 key。

## 存量用户与恢复

- 已有 BiSheng 绑定的 MO 用户在下次登录时补建 token 和绑定，无需全量余额迁移。
- 首次创建 BiSheng 用户带 `mo_user_id`，重试沿用同一身份。Redis 锁协调同一用户的并发登录/创建。
- NEW API 创建响应丢失后，MO 保留 `newapi_creation_pending=true`；重试精确搜索同名 token 并接管，不重新发放默认额度。
- 若处于 pending 状态却查不到 token，系统暂停该用户的自动创建。运维须先确认原请求已经结束、网关中确无该用户 token，再清除该用户的 pending 标记后重试。
- 同名 token 多于一个时拒绝自动绑定；人工核实 token 的使用记录和归属后消除歧义，避免绑定错余额。
- 修改网关地址不自动迁移 token。迁移需先备份绑定并规划余额迁移，不能直接清空字段重新发放默认积分。
- 外部手工轮换 key 后，应清除对应用户的 `newapi_bound_bisheng_id` / `newapi_bound_token_id`，再登录以重新同步；勿删除 token ID 或 pending 记录。
- 被耗尽（status=4）的 token 设置正余额后会重新启用；人工禁用状态不会被自动解除。
- 删除 token、恢复 BiSheng 数据库或更换 Fernet key 时，应核对两端绑定并重新同步，避免 MO 的绑定成功标记与 BiSheng 实际数据不一致。

## 验证

本地测试使用 HTTP 网关替身、SQLite 和仓储/锁替身，不连接真实生产服务：

```text
BiSheng: python -m unittest discover -s test/user -p test_newapi_credits.py -v
MO:      python -m unittest discover -s server3/tests/business -p test_newapi_business.py -v
```

部署验收：

1. 配置两端地址、管理令牌、默认额度，开启显示；使用新 MO 用户登录。
2. 在 NEW API 核对名称、管理账号归属、有限额度、永不过期；检查两端绑定。
3. 分别使用两个用户调用同一模型，检查各自 token 的用量；覆盖工作流、流式响应和后台任务的实际用户身份传递。
4. 在资源分配设置余额 0，确认调用受限；设置正余额，确认耗尽 token 恢复。
5. 核对管理员表格与个人设置读取的余额；模拟服务故障，确认显示错误而不是 0。
6. 关闭展示，确认模型调用仍使用个人 key；清空两端网关配置后确认停用。
7. 检查所属管理账号钱包余额足够；真实结算可受 NEW API 预扣、缓存和异步结算影响。

任意普通业务 API 不会仅因替换 key 就自动产生模型计费；只对 NEW API 支持并代理的模型接口计量。
完整前端构建、MySQL/DM8、Redis/MongoDB 和真实 NEW API 联调需在具备项目依赖及中间件的环境验收。
