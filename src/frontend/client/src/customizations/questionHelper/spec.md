# 出题助手下载与入库

沿用用户已配置的 BiSheng 智能体、提示词和 `/pyapi` 代理，仅补充定制前端。应用 ID 为 `99998a8308a94e09bfc5901bb77cc200`。

## 验收标准

1. 仅该应用的定制聊天识别 `markdown-exam` 围栏块；普通 Markdown、其他应用和原版聊天保持现有行为。
2. 每个试题块独立预览；正常完成且围栏闭合后允许操作，空内容、只读页面和生成中禁用操作。
3. 下载调用原 Excel 导出接口，保存 `.xlsx`，异常响应不得保存成文件。
4. 沿用原系统 teacher/admin 权限控制入库入口；权限请求失败可重试。
5. 入库弹窗支持题库搜索、分页、多选、新建；保留原 `ignore_school_isolation === false` 过滤规则。
6. 创建后自动选中新题库；提交只发送试题块正文和选中 ID。提交中防重复点击，失败保留选择并允许重试。
7. 同一卡片导入成功后标记成功并禁用再次导入。该状态仅在当前组件生命周期有效，不承诺后端幂等或刷新后去重。
8. 所有接口从当前域名根路径 `/pyapi` 请求，每次读取 `localStorage.token`；复用项目 request、UI、主题和三语文案。

## 接口

- GET `/pyapi/user/get_own_permission`
- GET `/pyapi/question/question_banks?page_no=1&page_size=10&show_all=false&query=...`
- POST `/pyapi/question/create/question_bank`：`{name}`
- POST `/pyapi/question/import_markdown`：`{question_bank_ids, markdown}`
- POST `/pyapi/question/export_question_from_markdown`：`{markdown}`

不新增后端接口、不迁移 Dify、不修改原题库数据模型。
