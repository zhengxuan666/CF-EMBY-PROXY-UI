# 开发、构建与验证

## 1. 修改前检查

```powershell
git status --short --branch
rg --files -g '!node_modules' -g '!dist'
```

仓库当前可能存在未提交的源码改动。先确认改动归属；不要用 `git reset --hard`、`git checkout --` 或批量删除来“整理”工作区。

## 2. 源码与生成物

### Worker

编辑 `worker/` 和必要的 `scripts/` 源码。执行：

```powershell
npm.cmd run build:worker
```

脚本调用 Vite library build，把 `worker/index.js` 打包到临时 `.worker-dist/worker.js`，再原子替换根目录 `worker.js`。`wrangler.toml` 的 `main` 指向根目录 `worker.js`，所以发布前必须确认生成物已更新。

### 管理端

编辑模板或增强脚本后执行：

```powershell
npm.cmd run --workspace frontend sync:admin-runtime
npm.cmd run --workspace frontend build
```

同步脚本把 `admin-runtime.template.html` 的占位符（`__ADMIN_BOOTSTRAP_JSON__`、`__ADMIN_APP_ROOT__`、`__APP_VERSION__`）替换为 bootstrap、`#app` 和版本号，注入 `admin-runtime-enhancements.mjs` 的 style/script，再跑一遍 `applyHeadProbeContract` 改写编译产物（节点探测 HEAD→GET、注入 `hedgeProbePreferGet`），写出 `frontend/index.html`。随后 `publish-dist.mjs` 把组合产物拷贝到 `frontend/dist/index.html`；管理端是单文件交付，`dist/` 只允许存在这一个文件，所以构建不再经过 Vite（模板没有 module script，打包只会原样搬运）。不要直接改这两个生成 HTML；模板里看起来是 HEAD 语义的节点探测 UI 会被 sync 改写，改那部分必须先读 `applyHeadProbeContract`（说明见 `docs/architecture.md` §4）。

`wrangler.toml` 将 `frontend/dist` 声明为 `ASSETS` 静态资产目录。GitHub Actions 部署会先执行 `npm ci`、`npm run check` 和 `npm run build:cdn`，再由 Wrangler 将前端与 Worker 一起上传；Worker 在没有 KV/远端管理端 HTML 配置时直接使用该构建产物。`npm run check` 挡在部署前，同步漂移、CDN 资源策略、2 MiB 壳上限和 `worker.js` 新鲜度都会在那里失败。

`frontend/src/` 的 Vue 文件由 `node scripts/check-frontend-sources.mjs` 编译检查，但当前 `frontend/index.html` 没有从 `src/App.vue` 导入的 module script。该目录是线上管理台分叉前的可读源码，**不要删除**：改动不改变线上 UI，但它是仓库内唯一可读的管理台实现；规则、证据与禁令见 `frontend/src/README.md`。

## 3. 常用命令

依赖只安装一次：在仓库根目录执行 `npm.cmd ci`。`frontend` 是 npm workspace，它的依赖和根依赖一起提升到根 `node_modules/`，仓库里不应出现 `frontend/node_modules/` 里的依赖；不要在 `frontend/` 内单独 `npm install`，那会重新生成一套嵌套依赖树。Vite 的缓存默认按最近的 `package.json` 落在 `frontend/node_modules/.vite`（`.vite-temp` 同理），会凭空造出这个目录，所以 `frontend/vite.config.js` 用 `cacheDir` 把它固定到根 `node_modules/.vite`；看到 `frontend/node_modules` 就说明有人在那里装过依赖，或者 `cacheDir` 被改掉了。

从仓库根目录运行：

```powershell
# 完整门禁：Worker、架构、bundle、Node 测试、管理端同步、Vue 语法、CDN 和 diff 检查
npm.cmd run check

# 单项构建
npm.cmd run build:worker
npm.cmd run build:frontend
npm.cmd run build:release

# 单项检查
npm.cmd run check:worker-syntax
npm.cmd run check:worker-architecture
npm.cmd run check:worker-bundle
npm.cmd run --workspace frontend check:admin-runtime
npm.cmd run --workspace frontend check:cdn

# 管理端本地开发（默认 Vite 5173；预览 4173）
npm.cmd run --workspace frontend dev
npm.cmd run --workspace frontend preview
```

如果只需要运行 Node 测试，可使用：

```powershell
node --test tests/*.test.mjs
```

## 4. 测试覆盖范围

- `tests/worker-defensive-boundaries.test.mjs`：代理路由、缓存身份、PlaybackInfo、HTML shell、failover、请求边界、并发和安全响应。
- `tests/config-kv-safety.test.mjs`：KV 写入回滚、revision、遗留设置快照清理、密钥脱敏、导入、HTML 激活和整理计划。
- `tests/d1-schema.test.mjs`：当前 D1 schema 初始化、兼容检查、索引和整理。
- `tests/frontend-runtime-enhancements.test.mjs`：管理端增强脚本、设置保存、仪表盘、DNS、备份、CDN 资源和开发服务器约束。
- `tests/admin-contract-parity.test.mjs`：管理端跨层契约——前端调用的 action 必须能在 Worker registry 解析、boot 协议符号在壳层/loader/兜底壳三处一致、`frontend/src` 参考源仍只调用可解析的 action 并保持 5 个主视图与 8 个设置分区，以及真实 `frontend/dist/index.html` 能通过 Worker 的壳层校验（含 2 MiB 上限与资产策略）。
- `tests/worker-bundle-smoke.test.mjs`：生成 Worker bundle 的入口和 Cloudflare handler 形状。
- `tests/fixtures/worker-architecture/negative-cases.json`：架构检查器的反例夹具。

改动路由/代理时至少跑 defensive boundaries 和 bundle；改动配置/KV/D1 时至少跑对应 safety/schema 测试；改动管理端组合链时至少跑 frontend runtime 与同步检查。

## 5. 发布前顺序

1. 检查工作区并阅读相关架构文档。
2. 修改源文件和测试。
3. 运行 `npm.cmd run build:worker` 或前端同步/构建命令生成产物。
4. 运行 `npm.cmd run check`。
5. 查看 `git diff --stat`、`git diff --check`，确认生成物变更来自本次源码改动，没有密钥或大块无关格式化。
6. 使用 `wrangler.toml` 对应的 Cloudflare 环境部署；生产 binding、`HOST`、`ADMIN_PATH`、认证密钥和 D1/KV ID 不写入仓库。

### 版本号

应用版本号唯一来源是 `worker/core/build-info.js` 的 `APP_VERSION`：Worker 落地页与管理端标题/徽章占位符 `__APP_VERSION__` 都由它派生，生成物随构建自动更新。发布时改这一处并同步 `README.md`、`AGENTS.md` 的版本字样，`npm.cmd run check` 的 version consistency 项会校验三者一致。

## 6. 环境变量和本地运行

- 根目录 `.dev.vars.example` 是 Worker 本地变量模板，实际 `.dev.vars` 被忽略。
- `frontend/.env.example` 是前端 Vite 变量模板，`.env.local` 等本地文件被忽略。
- `wrangler.toml` 中的 KV/D1 ID 当前是占位值时，不应直接部署；先配置真实 namespace/database。
- PowerShell 如果 `npm` 命中执行策略错误，使用 `npm.cmd`；不要为了绕过策略修改仓库文件。
