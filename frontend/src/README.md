# frontend/src — 管理台 Vue 源世代（保留，勿删）

**一句话：这里存放当前线上管理台在分叉之前的可读源码。它不参与构建，但它是这个仓库里唯一可读的管理台实现。不要删除。**

## 不要删除

线上管理台是 `frontend/admin-runtime.template.html` 内联的一段 651 KB 压缩 Vue bundle（无 sourcemap，历史 `.js.map` 已在 `a73d94f` 删除），加上 `frontend/scripts/admin-runtime-enhancements.mjs` 的运行时补丁。删掉本目录，仓库内就不再有任何可读的管理台源码，只剩一个 651 KB 的黑盒。

本目录与当前线上 HTML 的关系已经逐项核实：

| 联系 | 证据 |
| --- | --- |
| 同一信息架构 | `App.vue` 的 8 个设置分区名（系统 UI、代理与网络、静态资源策略、安全防护、日志设置、监控告警、账号设置、备份与恢复）与 5 个主视图（dashboard、nodes、logs、dns、settings）在模板 bundle 中全部命中 |
| 同一 API 契约 | 本目录 37 个 admin action 中 36 个在生产中存在；生产比本目录多 11 个，本目录独有 `sendPredictedAlert` |
| 同一启动协议 | `__ADMIN_UI_BOOTED__` / `__ADMIN_UI_BOOT_ERROR__` / `__ADMIN_UI_RENDER_BOOT_ERROR__` / `__ADMIN_UI_DEPENDENCY_TIMEOUT__` 这套符号由本目录历史上的 `main.js` 定义，今天同时活在模板 bundle 尾部、模板的 `admin-bootstrap-loader` 与 Worker 兜底壳（`worker/runtime/application-facades.js`） |
| 测试依赖 | `tests/frontend-runtime-enhancements.test.mjs` 有 15 处引用本目录，覆盖 8 个测试；删除会让 `npm.cmd run check` 直接失败 |

## 与生产链的真实关系

本目录是**分叉前的源世代**，不是当前 bundle 的构建输入：

- 状态层已分叉：`seedBootstrap`、`dnsWorkspace`、`authRequired`、`logsQuery` 等字段在模板 bundle 中命中数为 0。
- 代码已分叉：本目录 1,290 个声明标识符与 bundle 的 803 个只有 35 个重合；中文短语 1,428 条对 1,536 条，仅 22% 重合。
- 样式已分叉：本目录 `style.css` 是 `--app-*` 的深色 Tailwind 主题，没有皮肤概念；生产用 `--ui-c-*` 令牌并支持 ui skins。
- 功能已分叉：生产新增了仪表盘拆分调用（`getDashboardCachedSnapshot` / `getDashboardCoreStats` / `getDashboardD1WriteHotspot`）、`getMonthlyTrafficStats`、`getD1SchemaStatus`、`deleteDnsIpPoolItems`、`fillDnsDraftFromIpPool`、`saveMainVideoStreamPolicyShortcuts`，本目录都没有。

分叉点在工作区历史里可以直接查：`git show a73d94f` 同时删除了 `frontend/src/main.js`（原本执行 `createApp(App).mount('#app')`）、把 `App.vue` 从 394 行削成本目录现在的占位页、从 `useAdminConsole.js` 删掉 135 行、从 `SettingsPanel.vue` 删掉 351 行，并把交付方式改为模板内联；`git show a73d94f^:frontend/src` 能看到完整接线。

## 允许与禁止

- 允许：把它当参考实现在本地跑通、读它的 action 契约与 IA、按生产改动补齐它的对应实现。
- 禁止把它接到生产链上：`sync-admin-runtime.mjs` 会拒绝模板或组合产物里的 `<script type="module">`，Worker 的 `validateAdminShellHtmlSource` 也禁止 importmap、内联动态 `import()` 和本地 bundle 资源（上限 2 MiB），所以不存在"半接通可用"的状态。
- 生产功能仍然只在模板链落地：`admin-runtime.template.html` + `admin-runtime-enhancements.mjs`。改生产功能时按现有断言同步本目录；无法同步时先改对应断言并在同一提交里说明原因，不要只改一侧留下断言失败。
- 想重新接成可运行的管理台，先取回被削掉的接线：`git show a73d94f^:frontend/src/main.js` 与 `git show a73d94f^:frontend/src/App.vue`，再自行解决上面提到的资产策略限制。这是独立工程，不是改几行配置。

交付链路与资产策略细节见 `docs/architecture.md` 的「管理端事实来源与组合链」。
