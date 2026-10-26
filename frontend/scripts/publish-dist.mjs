import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(__dirname, "..");
const sourcePath = path.join(frontendDirectory, "index.html");
const outFlagIndex = process.argv.indexOf("--out");
const outDirectory =
  outFlagIndex > 0 && process.argv[outFlagIndex + 1]
    ? path.resolve(process.argv[outFlagIndex + 1])
    : path.join(frontendDirectory, "dist");

// 管理端是单文件交付：dist 里只允许有 index.html。模板没有 module script，
// 走打包器只会原样搬运，所以这里直接覆盖输出目录，并清掉历史打包残留。
if (
  outDirectory === frontendDirectory ||
  frontendDirectory.startsWith(`${outDirectory}${path.sep}`)
) {
  throw new Error(`[publish-dist] 拒绝写入 ${outDirectory}：会覆盖管理端源码目录`);
}

await rm(outDirectory, { recursive: true, force: true });
await mkdir(outDirectory, { recursive: true });
await copyFile(sourcePath, path.join(outDirectory, "index.html"));
console.log(
  `[publish-dist] ${path.relative(frontendDirectory, outDirectory)}/index.html <- index.html`,
);
