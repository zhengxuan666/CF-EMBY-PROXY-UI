import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../worker/core/build-info.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionLabel = `V${APP_VERSION}`;

// Worker 落地页、前端标题/徽章与产物都由 APP_VERSION 派生；这里只兜住手工维护的文档。
const REQUIRED_DOC_MARKERS = [
  { file: "README.md", needle: `version-${versionLabel}-`, description: "版本徽章" },
  { file: "README.md", needle: `当前 **${versionLabel}**`, description: "版本摘要" },
  { file: "AGENTS.md", needle: `当前 **${versionLabel}**`, description: "版本指针" },
  { file: "CHANGELOG.md", needle: `## ${versionLabel}`, description: "版本小节" },
];

// 发布摘要唯一的落点是 README：AGENTS.md 整份进每个会话的系统提示，只留规则与指针。
// 这两个标题一旦重新长出来，说明摘要又被搬回指令文件（历史形态见 1d23d4e）。
const FORBIDDEN_DOC_HEADINGS = [
  {
    file: "AGENTS.md",
    pattern: /^##[ \t]*V\d+(?:\.\d+)*版本[ \t]*$/m,
    description: "版本摘要标题",
  },
  { file: "AGENTS.md", pattern: /^##[ \t]*更新摘要[ \t]*$/m, description: "更新摘要标题" },
];

function collectVersionDocFailures(documents = {}) {
  const failures = [];
  for (const { file, needle, description } of REQUIRED_DOC_MARKERS) {
    const text = documents[file];
    if (typeof text !== "string") {
      failures.push(`${file} 未读取，无法校验${description}`);
      continue;
    }
    if (!text.includes(needle)) {
      failures.push(`${file} 缺少${description}（应包含 "${needle}"）`);
    }
  }
  for (const { file, pattern, description } of FORBIDDEN_DOC_HEADINGS) {
    const text = documents[file];
    if (typeof text !== "string") continue;
    const matched = text.match(pattern);
    if (matched) {
      failures.push(
        `${file} 不应再包含${description}（命中 "${matched[0].trim()}"）：发布摘要只放 README`,
      );
    }
  }
  return failures;
}

async function main() {
  const documents = {};
  for (const file of new Set(
    [...REQUIRED_DOC_MARKERS, ...FORBIDDEN_DOC_HEADINGS].map((doc) => doc.file),
  ))
    documents[file] = await readFile(path.join(repositoryRoot, file), "utf8");
  const failures = collectVersionDocFailures(documents);
  if (failures.length) {
    console.error(
      `[check-version-consistency] 文档版本号与 worker/core/build-info.js 的 ${versionLabel} 不一致：`,
    );
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `[check-version-consistency] 版本号 ${versionLabel} 在 worker/core/build-info.js 与 README.md / AGENTS.md 中一致，且 AGENTS.md 未夹带发布摘要`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { collectVersionDocFailures };
