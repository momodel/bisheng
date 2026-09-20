# 定制聊天：可运行的前端副本

这个目录包含原应用聊天的前端组件和运行逻辑副本，初始布局和功能沿用原版。它不是占位页，也不在新路由下直接渲染原 `AppChat`。

## 进入方式

登录工作台后，在 `/mo-agent/workspace/apps/explore` 每张智能体／工作流卡片下方点击 **进入定制版**。

- 点击原卡片或“开始对话”：进入原版 `/app/...`。
- 点击“进入定制版”：进入 `/custom-app/...`。
- 定制应用入口：`http://localhost:4001/mo-agent/workspace/custom-app/ccde4b83d7e548b4b042652269d83fe4/5`
- 定制会话：`http://localhost:4001/mo-agent/workspace/custom-app/00f03d0ea55dd1580b2f64a2e7b0205d/ccde4b83d7e548b4b042652269d83fe4/5`

完整路径是 `/custom-app/:conversationId/:fid/:type`，`5` 为智能体，`10` 为工作流。不带会话 ID 的入口与原版一样，打开最近会话，无历史时生成新会话 ID。部署前缀继续由原 `__APP_ENV__.BASE_URL` 控制。

## 后续在哪改

| 文件／目录 | 内容 |
| --- | --- |
| `index.tsx` | 应用权限、详情、历史消息和聊天初始化 |
| `ChatView.tsx` | 聊天主区域、引用面板、消息选择与导出入口 |
| `ChatMessages.tsx` | 消息类型分发、消息列表 |
| `ChatInput.tsx` | 输入框、发送、停止、语音入口 |
| `components/MessageBs.tsx`、`MessageUser.tsx` | 助手／用户消息 |
| `components/InputFiles.tsx`、`InputForm.tsx` | 上传和工作流表单 |
| `SideNav.tsx`、`hooks/useAppSidebar.ts` | 会话列表、新建、切换、删除后的导航 |
| `components/MobileNav.tsx`、`MobileAppHistoryDropdown.tsx` | 移动端页头和历史列表 |
| `layout/MainLayout.tsx`、`layout/AppRoot.tsx` | 系统导航和聊天页面布局 |
| `useAreaText.ts`、`useWebsocket.ts`、`useChatHelpers.ts` | 发送事件、WebSocket 和消息处理 |
| `ExploreAgentCard.tsx` | 探索页的定制版按钮，原卡片通过组合复用 |
| `routes.tsx`、`CustomChatBoundary.tsx` | 路由与页面运行作用域 |

修改以上副本，不要修改 `src/pages/appChat/`、原 `routes/AppRoot.tsx` 或原 `layouts/MainLayout.tsx` 来实现定制效果。

## 共享与隔离的边界

- **共享后端**：使用原应用 ID、会话 ID 和原 API。发送消息、重命名、删除、上传等仍作用于同一份后端数据。页面副本不提供数据隔离。
- **组件和聊天运行逻辑独立**：定制版内部导入指向本目录；WebSocket Map、输入事件总线是副本自己的模块实例。新建、历史切换、应用切换、删除后的地址保持 `/custom-app/...`。
- **复用原状态定义，不新增 atoms/selectors**：`store/` 仅重新导出已有定义。定制路由的 `RecoilRoot` 隔离运行值，避免原页面的 KeepAlive 树监听到定制版的发送事件；局部 `AliveScope` 管理自己的缓存。
- **基础能力继续共享**：认证、HTTP/API 封装、数据类型、主题、国际化、通用 UI、Markdown、引用和导出组件。若以后需要修改其中某个共享组件，应先在此目录复制该组件并修改定制版的引用。直接修改共享组件仍会影响原版。
- **浏览器偏好可共享**：原状态定义中的语言、侧栏显示等持久化偏好保持现有行为。定制聊天返回地址和消息 DOM ID 已单独命名。
- **样式修改应限定范围**：优先用组件内 className 或 CSS Modules，也可用 `[data-custom-agent-chat]` 限定定制布局内的样式。不要为定制效果改全局标签选择器或共享样式。
- **分享保持原产品语义**：继续使用原分享接口和专门的分享页面，并不会把分享链接替换成要求登录的定制工作台地址。

原源码只接入了两处入口：`src/routes/index.tsx` 注册新路由，`src/pages/apps/explore.tsx` 使用组合卡片；三语翻译文件增加了按钮和副本文案。原聊天、布局、卡片组件文件不修改。

## 实现注意事项

- 路由使用 React Router 的 `lazy` 属性，在渲染前加载对应模块。不要改成包在整个 `AliveScope` 外部的 React `Suspense`：在实际浏览器检查中，这种组合会让 react-activation 的 fallback 监听器反复挂载。
- 副本保留原 WebSocket 协议，退出定制路由时释放副本的连接，重进页面重新从后端加载历史。
- 新文案使用 `useLocalize()`，同时维护 `src/locales/{zh-Hans,en,ja}/translation.json`。新前端状态优先使用局部 hooks/props；此副本只是沿用原有 Recoil 逻辑，并未引入新的状态库。
- 后续修改仍应保持单文件不超过 600 行。

## 验证范围

新增模块使用 TypeScript 语义检查，不添加 `@ts-strict-ignore`；原聊天、布局、卡片文件通过内容指纹核对。浏览器检查使用现有 4001 服务、独立浏览器配置以及模拟 API／WebSocket，不修改真实业务数据。

本次检查结果：定制模块 TypeScript 诊断为 0；18 项浏览器检查通过，未捕获运行时异常。覆盖历史加载、智能体连接初始化、单次发送、流式回复、完成后恢复输入、停止、新建会话、移动端页头和历史列表、探索页新旧入口，以及工作流初始化、附件上传和携带文件路径发送。该结果不代表真实后端联调已完成。

真实后端的模型回复、权限差异、大文件上传、语音与导出仍需在项目正常环境中验收。没有运行 ESLint，也没有启动开发服务或执行构建。
