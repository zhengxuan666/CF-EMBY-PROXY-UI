// 管理端跨层契约审计：action registry、boot 协议、参考源 frontend/src。
// 这些断言只读源码与只读 introspection，不发请求、不写状态；运行时行为仍由各自的功能测试覆盖。
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { ADMIN_RUNTIME_ENHANCEMENT_SCRIPT } from "../frontend/scripts/admin-runtime-enhancements.mjs";
import { MAX_ADMIN_SHELL_BYTES } from "../frontend/scripts/check-cdn-paths.mjs";
import { createTestApplication } from "../worker/testing/hooks.js";

const BACKSLASH = String.fromCharCode(92);
const UNICODE_ESCAPE = new RegExp(`${BACKSLASH}${BACKSLASH}u([0-9a-fA-F]{4})`, "g");

// 线上壳层把中文写成 \uXXXX 转义，比对文案前必须先解码。
function decodeUnicodeEscapes(text = "") {
  return String(text || "").replace(UNICODE_ESCAPE, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readShippedAdminShell() {
  return decodeUnicodeEscapes(await readSource("frontend/admin-runtime.template.html"));
}

// 前端调用点：apiCall("action", ...)。动态拼名（如 "d1"===x?"tidyD1Data":"tidyKvData"）抓不到，
// 只影响"注册但无调用方"清单的完整度，不影响下面的包含关系断言。
function collectFrontendActions(source = "") {
  return new Set(
    [...String(source || "").matchAll(/apiCall\(\s*["']([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
}

function collectSrcActions(source = "") {
  return new Set(
    [...String(source || "").matchAll(/callAdminAction\(\s*["']([A-Za-z][A-Za-z0-9_]*)/g)].map(
      (m) => m[1],
    ),
  );
}

async function readSrcSources() {
  const root = new URL("../frontend/src/", import.meta.url);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await walk(target);
      else if (/\.(vue|js)$/.test(entry.name)) files.push(await readFile(target, "utf8"));
    }
  }
  await walk(root);
  return files.join("\n");
}

function createRegistryProbe() {
  const { testPlatform } = createTestApplication();
  const { adminActionNames = [], resolveAdminAction } = testPlatform.fetch;
  return {
    names: adminActionNames,
    isCallable: (action) =>
      typeof resolveAdminAction === "function" && typeof resolveAdminAction(action) === "function",
  };
}

test("every action the shipped admin shell calls exists in the Worker registry", async (t) => {
  const registry = createRegistryProbe();
  const shell = await readShippedAdminShell();
  const called = collectFrontendActions(`${shell}\n${ADMIN_RUNTIME_ENHANCEMENT_SCRIPT}`);

  const unresolved = [...called].filter((action) => !registry.isCallable(action)).sort();
  assert.deepEqual(
    unresolved,
    [],
    `前端调用了不存在的 admin action：${unresolved.join(", ")}（先注册 Worker 处理器，再改前端）`,
  );

  // 注册但没有静态调用方的 action：列出来供人工判断（可能是 Worker 内部触发、
  // 或前端用动态拼名调用），不作为失败条件。
  const unused = registry.names.filter((action) => !called.has(action)).sort();
  t.diagnostic(`注册但前端无静态调用（${unused.length}）：${unused.join(", ") || "none"}`);
});

test("admin boot protocol globals stay identical across shell, loader and fallback", async () => {
  const BOOT_PROTOCOL = [
    "__ADMIN_UI_BOOTED__",
    "__ADMIN_UI_BOOT_ERROR__",
    "__ADMIN_UI_RENDER_BOOT_ERROR__",
    "__ADMIN_UI_DEPENDENCY_TIMEOUT__",
  ];

  const shell = await readSource("frontend/admin-runtime.template.html");
  for (const symbol of BOOT_PROTOCOL) {
    assert.ok(
      shell.includes(symbol),
      `admin runtime template 缺少启动协议符号 ${symbol}：白屏时浏览器将没有可读错误`,
    );
  }

  // 补丁层跑在 boot 之后，不允许重置或改名启动协议；要改就改本测试，让改动显式发生。
  for (const symbol of BOOT_PROTOCOL) {
    assert.ok(
      !ADMIN_RUNTIME_ENHANCEMENT_SCRIPT.includes(symbol),
      `runtime enhancements 不该改写启动协议符号 ${symbol}`,
    );
  }

  // Worker 兜底壳只负责错误上报，但它出现的符号必须是这套协议的子集，不能自造第五个全局名。
  const workerSource = await readSource("worker/runtime/application-facades.js");
  const workerSymbols = new Set(workerSource.match(/__ADMIN_UI_[A-Z0-9_]+__/g) || []);
  const invented = [...workerSymbols].filter((symbol) => !BOOT_PROTOCOL.includes(symbol));
  assert.deepEqual(invented, [], `Worker 自造了启动协议符号：${invented.join(", ")}`);
  assert.ok(
    workerSymbols.has("__ADMIN_UI_BOOT_ERROR__"),
    "Worker 兜底壳/loader 必须写 __ADMIN_UI_BOOT_ERROR__，否则启动失败无错误可读",
  );
});

test("frontend/src reference keeps calling only actions the Worker can resolve", async (t) => {
  const registry = createRegistryProbe();
  const srcActions = collectSrcActions(await readSrcSources());
  const unresolved = [...srcActions].filter((action) => !registry.isCallable(action)).sort();
  assert.deepEqual(
    unresolved,
    [],
    `frontend/src 调用了 Worker 中不存在的 admin action：${unresolved.join(", ")}`,
  );

  // 反向漂移：src 引用了、但当前线上壳层完全不再出现的 action。
  // 这里用"任意字符串字面量"而不是 apiCall 调用点，因为壳层存在动态拼名
  // （"d1"===x?"tidyD1Data":"tidyKvData"），只有被彻底删掉的 action 才算漂移。
  // sendPredictedAlert 是已知的"Worker 有实现、线上 UI 不再调用"项。
  const shippedSource = `${await readShippedAdminShell()}\n${ADMIN_RUNTIME_ENHANCEMENT_SCRIPT}`;
  const shippedMentions = new Set(
    [...shippedSource.matchAll(/["']([A-Za-z][A-Za-z0-9_]{3,})["']/g)].map((m) => m[1]),
  );
  const srcOnly = [...srcActions].filter((action) => !shippedMentions.has(action)).sort();
  t.diagnostic(`src 引用但线上壳层完全不出现：${srcOnly.join(", ") || "none"}`);
  assert.deepEqual(
    srcOnly.filter((action) => action !== "sendPredictedAlert"),
    [],
    "frontend/src 与线上壳层的 action 契约已经进一步分叉：请同步参考源，或在本测试登记新的已知差异",
  );
});

test("frontend/src keeps the shipped admin information architecture", async () => {
  const shell = await readShippedAdminShell();
  const app = await readSource("frontend/src/App.vue");

  const settingsSections = [
    "系统 UI",
    "代理与网络",
    "静态资源策略",
    "安全防护",
    "日志设置",
    "监控告警",
    "账号设置",
    "备份与恢复",
  ];
  const primaryViews = ["dashboard", "nodes", "logs", "dns", "settings"];

  for (const name of settingsSections) {
    assert.ok(app.includes(`"${name}"`), `frontend/src/App.vue 缺少设置分区 ${name}`);
    assert.ok(shell.includes(name), `线上壳层缺少设置分区 ${name}，参考源已与生产 IA 分叉`);
  }
  for (const view of primaryViews) {
    assert.ok(app.includes(`"${view}"`), `frontend/src/App.vue 缺少主视图 ${view}`);
    assert.ok(shell.includes(`#${view}`), `线上壳层缺少主视图锚点 #${view}`);
  }
});

// 壳层体积与资产策略是 Worker 的运行时门槛：构建期必须用真实产物验证一次，
// 否则超限、缺 enhancement 层或引入禁用资源的壳只会在线上请求时才被拒绝。
test("frontend shell byte budget mirrors the Worker shell limit", async () => {
  const workerShell = await readSource("worker/runtime/application-facades.js");
  assert.match(workerShell, /ADMIN_REMOTE_SHELL_MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.equal(MAX_ADMIN_SHELL_BYTES, 2 * 1024 * 1024);
});

test("shipped admin shell passes the Worker shell gate", async () => {
  const { testPlatform } = createTestApplication();
  const shellHtml = await readSource("frontend/dist/index.html");
  const validated = testPlatform.fetch.adminShell.validateAdminShellHtmlSource(
    shellHtml,
    "https://worker.test/index.html",
    { sourceLabel: "bundled admin shell", contentType: "text/html; charset=utf-8" },
  );
  assert.equal(validated.bytes, Buffer.byteLength(shellHtml, "utf8"));
  assert.ok(validated.bytes <= MAX_ADMIN_SHELL_BYTES);
});
