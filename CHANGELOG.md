# CHANGELOG

按版本倒序记录对外可见的变化。条目由各版本的发布提交与当时的发布摘要整理，只收已合并到 `main` 的内容；更早版本见 git 历史。

当前版本号由 `worker/core/build-info.js` 的 `APP_VERSION` 决定，`npm run check` 会校验本文件包含对应版本小节。

## V19.9（2026-10-19）

- **管理端**：界面皮肤由本机偏好升级为全局配置（KV `sys:theme` 的 `adminUiSkin`），随 bootstrap 下发，首帧即落主题，换设备与清缓存后仍保留；导入旧备份不再重置皮肤，备份里显式写入时仍按显式选择覆盖。主题面板标签由「仅本机」改为「全局」。
- **管理端请求收敛**：仪表盘分层数据 60 秒内复用（优先 1 小时 D1 快照）、设置 bootstrap 5 秒内合并在飞请求 / 10 秒内直接返回、日志首页 30 秒内复用；翻页、强刷、跨域请求绕开缓存，代价是窗口内可能读到旧数据。管理端改用 Vue runtime-only 构建。
- **代理与重定向**：客户端可见的 `Location` 一律剥离 userinfo，包含此前漏掉的 300/305；只有与节点基址 origin、账号、密码完全一致的凭据保留。路径式跨域写法（`//`、`/\`、`\\`、`\t//`）统一归一为同一绝对目标，仅 Cookie 鉴权时仍 409 fail closed；跳数预算收敛为单常量，与 `redirect_limit` 诊断标签不再失同步。
- **访问日志**：改为先判定后构造，命中缓存、进度节流 204、直连 404、探针透传、entry 307、上游错误等路径中注定被丢弃的行不再构造 `detailJson`。行数不变（`Logger.record` 的过滤未改）；流式响应体状态码要等流结束才定，该路径仍会构造日志详情。
- **交付**：`worker.js` 标记 `-diff`，评审只看 `worker/` 源码，产物新鲜度由 `check-worker-bundle` 守住；bundle 硬守卫 1.5 MB / 工作目标 1.1 MB，`*.pprof` 进 `.gitignore`；发布摘要移出 `AGENTS.md`，版本门禁新增反向断言，摘要标题不得回到指令文件。
- **升级注意**：升级后浏览器本地皮肤会被服务器值覆盖一次（默认 `classic`），多设备选择会统一；300/305 的 `Location` 现在会剥离 userinfo，依赖该跳转携带凭据的节点需改为在节点基址配置凭据。

## V19.8（2026-10-18）

- **管理端功能**：新增界面皮肤（经典蓝 / 暖纸）与字体加载，主题面板同步当前皮肤；上传类请求跳过 `withUiRequestTimeout`，重新登录期间的挂起请求同样不计超时；自绘弹层补上原生 dialog 语义、焦点管理与 Esc 关闭（弹层是 `#app-shell` 子节点，不对 shell 加 inert）。组合链新增两条断言：发布源预览方法必须存在、设置保存必须带 `expectedConfigRevision`。
- **管理端简化**：模板重新生成后不再包含配置快照面板与 `__INIT_HEALTH_BANNER__`，sync 里那套切除改写器（`stripLegacyConfigSnapshotUi` 及专用工具函数）随之删除，`applyHeadProbeContract` 成为唯一保留的编译产物改写层；fallback bootstrap 不再携带 `primaryViews` / 设置分区元数据，IA 事实改由契约测试断言。
- **壳层校验**：`validateAdminShellHtmlSource` 要求一份管理端壳同时带 `data-admin-runtime-enhancements` 的 `<style>` 与 `<script>`，缺 enhancement 层的旧壳被直接拒绝，而不是静默降级丢掉皮肤、并发保存保护和探针并发池。
- **契约测试**：新增 `admin-contract-parity`。壳层与补丁层静态调用的 action 必须能被 worker registry 解析；`__ADMIN_UI_BOOTED__` 等 4 个启动协议符号在模板、loader 与 Worker 兜底壳中是同一套；`frontend/src` 只调用可解析 action，且保持 5 个主视图与 8 个设置分区。
- **管理端交付**：构建不再经过打包器。`publish-dist.mjs` 先清空输出目录再把 sync 生成的 `frontend/index.html` 拷进 `frontend/dist/`，所以 `dist/` 里只剩 `index.html`，历史打包残留（`assets/`、`.vite/manifest.json`）不会进仓库；`build:bundle` 删除，`VITE_CDN_BASE_URL` 与 Vite 的 `base` 归一化一并退场。
- **构建期与部署门禁**：`check-cdn-paths.mjs` 量真实产物的 UTF-8 字节数，超过 Worker 的 2 MiB 壳层上限直接失败，并通过 `admin-contract-parity` 用 `validateAdminShellHtmlSource` 校验仓库里的 `dist/index.html`；GitHub Actions 在构建与部署前先跑 `npm run check`，构建步骤换成 `npm run build:cdn`，同步漂移、资产策略、壳层上限和 `worker.js` 新鲜度都在部署前失败。
- **依赖与配置清理**：workspace 依赖统一提升到根 `node_modules`，dev-server 不再写死 Vite CLI 路径而是用 `createRequire` 从 `frontend/package.json` 解析，Vite 缓存目录显式指到根 `node_modules/.vite`，`allowScripts` 显式登记安装脚本；`CONFIG_AUTHORITY_MODE`、`VITE_VENDOR_MODE`、`VITE_CDN_IMPORT_*` 等运行时已不再读取的条目从 `.dev.vars.example` 与 `frontend/.env.example` 删除。
- **主题B 视觉收口**：设置页的危险与维护类按钮（整理 KV / D1、三组「导入备份」与「导出…」、一键清理全站缓存）统一成红豆 `#964742` 纯色填充、白色文字与图标、图标与文字同行居中，hover 取 `#7f3b37`，深色模式同款；面板标题标签（`UTC+08:00`、`仅本机`、`设置 / 密钥 / 节点` 等）留在最右侧并与标题同一条底边对齐，同时去掉外围胶囊包裹；日志表格补 `vertical-align:middle`，资源类别标签撑高行后文字不再贴基线；「界面主题」的选中按钮改用暖纸底色 `rgb(245,244,237)` 配红豆描边，不再在暖纸下亮蓝色高亮。
- **显示修正**：优选 IP 来源列在备注为空时不再多渲染一行 `-`（改渲染空串，空 div 不占高度），不区分皮肤。

## V19.7（2026-10-16）

- **重定向与鉴权加固**：媒体查询 token 按 `api_key` / `ApiKey` 逐名补全；`auto` 模式把已识别的 `Emby` scheme 改写为 `MediaBrowser`；客户端鉴权无法随跳转携带时，跨域重定向在跳数用尽等中断点返回 409，不再透传无鉴权的节点 `Location`。
- **重定向映射**：target base 路径大小写不敏感；legacy `/emby`、`/mediabrowser` 根兜底仅用于 `Location` 映射，PlaybackInfo 改写与元数据预热保持严格 base 匹配；只跟随 301/302/303/307/308，非 http(s) 或无法解析的 `Location` 一律删除。

## V19.6（2026-10-15）

- **Jellyfin 12 兼容**：`/emby` 前缀移除后，节点探测与故障转移探测自动回退无前缀根；媒体鉴权可从 `api_key` / `ApiKey` 查询参数或独立 token 头提取 token 并合成、合并进 `Authorization`；直连重定向按节点鉴权模式选择 `api_key` / `ApiKey` 命名；README 补充 Jellyfin 12 legacy 鉴权与直连回退说明。
- **探测与故障转移**：节点与故障转移探测发送完整客户端请求头、跟随入站 `User-Agent`，新增 `/emby/system/ping` 兜底路径，并把 403 视为节点可达；健康探测保留节点端口；管理端节点卡片展示实际探测路径与 403 可达状态。
- **功能与修复**：为 emos 节点提供 `medb.lat` 媒体库计数；忽略会破坏请求头的查询 token 值；vendor 资源缓存 key 加入 schema 版本以淘汰旧缓存；清理不可达探测分支与死代码。

## V19.5（2026-10-12）

- **TMDB 集成**：账号设置新增 TMDB 凭据并可配置元数据语言；配置凭据优先于环境变量、失败短缓存、查询限流；新增节点 TMDB 聚合；对"账号设置凭据遮蔽环境变量"给出告警。
- **Cloudflare 流量归档**：新增按日归档 CF Zone 流量以补足超出保留期的月度总量，抽出查询 helper 并补测试。
- **Worker 修复**：修复 D1 日志表结构并移除遗留 FTS 触发器；协议回退重试失败时透传原始响应；403 保留真实上游状态；对齐媒体鉴权 scheme 与 token；缓存远端 shell 响应先物化再复用；图片回退到客户端可见重定向。
