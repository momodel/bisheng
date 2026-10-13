# F054 应用上下线默认查看者权限与构建页只读访问

状态：Spec Discovery，等待用户确认；尚未进入 spec/design 或代码实施。

关联分支：`feature#10296/bisheng-b-delivery`；Issue：#10296。

## 用户目标

- 构建中的应用上线时，默认赋予当前用户所属用户组查看者权限；最高管理员上线时，默认赋予全部用户组查看者权限。
- 应用下线时自动取消上述权限，列表页和应用内部的上下线入口行为一致。
- 构建应用列表显示只有查看者权限的应用，允许进入应用内部查看，但不能操作更改。

## 现有实现与缺口

| 范围 | 现状 | 证据 |
| --- | --- | --- |
| 应用类型 | 构建应用列表包括智能体和工作流 | `src/frontend/platform/src/pages/BuildPage/apps.tsx` 的 `TypeNames` |
| 列表过滤 | 构建页固定传 `managed: true`，服务端按 `edit` 过滤，排除只有查看权限的应用 | `apps.tsx`；`src/backend/bisheng/api/services/workflow.py` 的 `required_action` |
| 列表入口 | 卡片点击受 `canEdit` 限制，`handleSetting` 也按 `write` 拦截 | `apps.tsx` |
| 内部页面入口 | 智能体和工作流页面初始化都先调用 `checkAppEditPermission`，查看者无法进入 | `assistant/editAssistant/index.tsx`；`flow/index.tsx` |
| 智能体上下线 | `AssistantService.update_status` 校验 `publish/unpublish` 并修改状态，尚无默认用户组查看者授权 | `src/backend/bisheng/api/services/assistant.py` |
| 工作流上下线 | `WorkFlowService.update_flow_status` 校验 `publish/unpublish`，上线还校验并切换版本，尚无默认用户组查看者授权 | `src/backend/bisheng/api/services/workflow.py` |
| 授权来源 | F048 Grant assignee 保存独立来源，可表达自动授权与手工授权的区别 | `permission/domain/models/grant.py`；`permission/domain/services/grant_source_service.py` |

## 待确认的需求解释

1. 范围覆盖构建中的智能体、工作流，列表页和内部所有上下线入口均执行同一规则。
2. “当前用户”指执行上线操作的用户；普通用户取上线时所属的全部用户组。没有所属用户组时，不扩大授权范围。
3. “最高管理员全部用户组”限定为应用所属租户的全部现有用户组，不产生跨租户授权。租户管理员仍按自身所属用户组处理。
4. 下线只撤销本功能在上线时产生的自动查看者授权来源；保留手工授权、创建者权限和独立获得的更高权限。撤销依据上线时记录的来源，不按下线操作者的用户组重新计算。
5. 按用户后续明确的交互要求，查看者进入原有完整编辑界面，保留浏览、复制、导出及本地配置/画布交互；屏蔽保存、上下线、另存为新版本等修改原应用的持久化入口。版本切换只加载，不自动保存；后端仍独立拒绝无对应权限的写操作。
6. 已有更高权限的用户继续按实际动作权限操作。仅有查看者权限不会获得额外写权限。
7. 本次默认对后续上线/下线生效，不批量改写已有在线应用的权限；历史补授权如需要应另行明确范围。
8. 重复请求、失败及重试不得遗留重复授权；权限变更失败不能返回上下线成功。

## 流程与约束

- 本功能跨应用状态、权限生命周期、前端列表和编辑器访问，改变权限行为契约，按 `docs/SDD-Guide.md` §1 走 Full SDD。
- 遵守 `docs/constitution.md` C1/C2/C3/C4/C7；权限对象由 F048 持有，只通过权限 application 协议调用其服务。
- 已阅读 `features/v3.0.0-beta1/release-contract.md`；若设计需要新增跨 Feature 契约，须在设计阶段同步版本契约。
- `AGENTS.md` §6 与 `docs/SDD-Guide.md` §3 要求 Discovery、spec、design 三个确认点，当前为第一个确认点。
- 下一步：确认上述解释后形成 spec、完成审查，再进入规定的 spec/design 确认点。

## 后续验证范围

- 两种应用 × 两种上下线入口 × 普通用户/最高管理员。
- 多个用户组、无用户组、租户边界、手工权限与自动权限重叠、操作者或用户组成员变化。
- 只有查看者权限的列表筛选/分页、进入详情、全部写入口禁用和后端写请求拒绝。
- 重复上下线、发布校验失败、授权投影失败和重试一致性。
