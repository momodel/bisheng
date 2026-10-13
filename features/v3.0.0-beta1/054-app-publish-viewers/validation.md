# F054 验证记录

日期：2026-10-13。工作分支：`feature#10296/bisheng-b-delivery`。

## 已执行

- 后端相关回归：87 项通过，4 项真实部署 E2E 跳过。范围包括 publication、Grant 来源/策略、durable projection、SQL finalize、reconcile CLI。覆盖两类应用、组租户边界、20 项分批、无组、手工来源在上线前/后重叠、下线精确撤销、空 tuple 来源变更的持久化与中断恢复。
- 已在真实 SQLite SQL 状态 + 实际 GrantService/ProjectionService 下复现第二次上线的 Visible source after-state 校验错误；修复后两类应用 × 有/无手工重叠来源均通过连续四次上线、三次下线，逐轮断言权限版本、可见来源版本、FINALIZED 账本与 FGA tuple 一致。
- 查询预算回归：1 组同步仅调用一次资源解析/权限同步；53 组仅调用 3 次（此前有第 4 次空轮询）。验证复用操作者身份、不查询发布流程无关的 Grant 管理等级；53 个可见来源的 prepare 查询及 finalize owner 查询分别只执行 1 次，且来源全部正确激活。以上为查询次数验证，未测量真实部署端到端延迟。
- 测试启动时预加载真实 metric_log 模块，绕开既有 conftest 将 common.services 替换为非 package mock 的导入问题；没有修改仓库测试启动逻辑。SQL 回归使用内存 SQLite，MySQL/DM8 和真实 OpenFGA 仍需部署环境验证。
- 前端 Vitest `publishedAppReadOnly.test.tsx`、`publishedAppLifecycle.test.tsx`、`publishedAssistantLifecycle.test.tsx` 共 12 项通过，覆盖原编辑器和复制/本地交互边界、版本浏览不自动保存、保存失败中止上线、处理中防重复提交、失败后保留状态并允许重试、服务端刷新同步卡片状态，以及智能体发布失败不跳转、成功立即跳转。
- 修改的 Python 文件 Ruff format/check 通过。
- Platform `lint:prune` 与 `lint` 通过；只通过命令缩减既有 suppressions。
- `pnpm check-i18n` 通过，无新增漂移。
- Architecture guard 无 VIOLATION；assistant/workflow 旧端点直接导入 DAO 仍有 RULE-3 WARNING。
- `git diff --check` 通过。

## 既有全量门禁问题

- 全量 `test/permission` 收集受本地缺失 langchain_classic/langchain_core、PyYAML、alembic、rsa 等依赖限制；上述 87 项相关回归已单独完整执行。
- Platform typecheck：`f048DashboardPermissions.test.tsx:91` 使用已移除的组件 props；`routeFilterPurity.test.ts:16` 的 filter(Boolean) 未收窄 undefined。此次变更文件未新增类型错误。
- 根目录 frontend lint：Platform 通过，Client 的既有 htmlCourseware/customizations/agentChat 等文件仍有 156 项错误；本任务未修改 Client。

## API E2E 覆盖报告

`test/e2e/test_e2e_published_viewers.py` 的 4 个组合（两类应用 × 普通/最高管理员）已执行收集，因未设置专用部署启用参数而全部跳过。需要完整中间件、专用租户、预置组账号和可初始化模板，不能将本地单测等同于真实 API 联调。

| AC | 自动化覆盖 | 当前真实部署状态 |
| --- | --- | --- |
| AC1/AC2 | 两类应用 × 发布角色、同组可见/异组决策 | 未执行 |
| AC3 | 下线后列表不可见；手工重叠另由实际 Grant/Projection 回归覆盖 | 未执行 |
| AC4 | visible 列表与详情 | 未执行，筛选/分页见页面清单 |
| AC5 | 查看者下线接口拒绝；原编辑器持久化边界另有 Vitest | 未执行，完整页面见清单 |
| AC6 | 工作流两个 API 入口及重复状态链路 | 未执行 |
| AC7 | 不设置补授权任务 | 代码核对，部署后见清单 |

整体 E2E 状态：PARTIAL。页面验收步骤见 `e2e-checklist.md`，所有待验项保留未勾选。

## 部署诊断补充（用户在 Linux 容器执行）

- API 和 worker 容器中的 control_state、published_viewers、runtime、sql_runtime 四个关键文件，经规范化换行后的 SHA-256 对比，与本次工作区代码一致；前端构建产物尚未核对。
- 用户回传的数据库诊断显示 CURRENT Catalog 未 write_fenced；新工作流的多轮发布操作均为 FINALIZED。两个旧工作流仍绑定 FAILED_CLOSED 操作 198、200，其中 200 的错误为 projection commit state is MIXED。
- 两个旧操作已完成恢复工具 dry-run，分别提出 18、33 条 tuple 修正；已提供绑定 Store/model/recovery checksum 的 apply 命令。尚未收到 apply 成功及恢复后可见性核对结果，不能视为已修复部署中的旧异常记录。

运行要求见 E2E 文件头：`F054_E2E=1`，`F054_E2E_TENANT_CODE`，三类普通账号的 NAME/PASSWORD，两类 TEMPLATE_ID，以及既有 E2E_API_BASE/E2E_ADMIN_PASSWORD。禁止使用正式租户；清理有前缀约束并在 setup/teardown 执行。
