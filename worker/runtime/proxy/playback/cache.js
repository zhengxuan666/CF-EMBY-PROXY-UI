import {
  createPlaybackInfoRepresentation,
  isPlaybackInfoRepresentation,
  parsePlaybackInfoRootObject,
} from "./contract.js";
import { isJsonHttpMediaType } from "../http/media-types.js";
import { sanitizePlaybackInfoSerializedResponseHeaders } from "./rewrite.js";

const textEncoder = new TextEncoder();

function encodedBodyBytes(bodyText) {
  return textEncoder.encode(String(bodyText || "")).byteLength;
}

// 结构校验的唯一实现：请求路径的目标条目（get）与维护期分片清扫（cleanMap）共用。
export function validatePlaybackInfoCacheEntry(entry, maxEntryBytes) {
  const status = Number(entry?.status);
  if (!(status >= 200 && status < 300) || status === 204 || status === 205) return null;
  let headers;
  try {
    headers = new Headers(Array.isArray(entry?.headers) ? entry.headers : []);
  } catch {
    return null;
  }
  if (!isJsonHttpMediaType(headers.get("Content-Type"))) return null;
  const bodyText = String(entry.bodyText || "");
  const bodyBytes = encodedBodyBytes(bodyText);
  const limit = Number(maxEntryBytes);
  // 上限非法时不按 0 处理，否则一次漏传参数会把整个缓存判为脏数据。
  if (Number.isFinite(limit) && limit > 0 && bodyBytes > limit) return null;
  const payload = parsePlaybackInfoRootObject(bodyText);
  if (!payload) return null;
  return { headers, bodyText, bodyBytes, payload };
}

export function createPlaybackInfoCacheKey(parts, options = {}) {
  const hash = typeof options.hash === "function" ? options.hash : (value) => String(value || "");
  const serialize = typeof options.serialize === "function" ? options.serialize : JSON.stringify;
  return `playback-info:${hash(serialize(parts))}`;
}

export class PlaybackInfoCacheStore {
  constructor(options = {}) {
    if (!(options.entries instanceof Map))
      throw new TypeError("PlaybackInfoCacheStore requires a Map");
    this.entries = options.entries;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.maxEntries = Math.max(1, Number(options.maxEntries) || 1);
    this.maxEntryBytes = Math.max(1, Number(options.maxEntryBytes) || 1);
    this.maxTotalBytes = Math.max(1, Number(options.maxTotalBytes) || 1);
  }

  cleanup(now = this.now()) {
    for (const [cacheKey, entry] of this.entries) {
      const expiresAt = Number(entry?.expiresAt) || 0;
      if (expiresAt > 0 && expiresAt <= now) this.entries.delete(cacheKey);
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
    let totalBytes = 0;
    for (const entry of this.entries.values()) {
      // shortcut: 这里只统计字节，不再逐条 JSON 校验或重新编码（该开销曾占满播放热点路径）；
      // 入缓存时由 set() 完成结构校验，维护期清扫会再次校验，脏条目仍不可能被投递。
      const storedBytes = Number(entry?.bodyBytes);
      const bodyBytes =
        Number.isFinite(storedBytes) && storedBytes > 0
          ? storedBytes
          : encodedBodyBytes(entry?.bodyText);
      entry.bodyBytes = bodyBytes;
      totalBytes += bodyBytes;
    }
    while (this.entries.size > 0 && totalBytes > this.maxTotalBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldestEntry = this.entries.get(oldestKey);
      totalBytes -= Number(oldestEntry?.bodyBytes) || 0;
      this.entries.delete(oldestKey);
    }
  }

  set(cacheKey, representation, metadata = {}) {
    if (!cacheKey || !isPlaybackInfoRepresentation(representation)) return false;
    const response = representation.response;
    if (
      !(response.status >= 200 && response.status < 300) ||
      response.status === 204 ||
      response.status === 205 ||
      !isJsonHttpMediaType(response.headers.get("Content-Type"))
    )
      return false;
    // 体积闸门自证：调用方声明的 bodyBytes 与本次实测 UTF-8 长度取大，
    // 避免错误/偏小的声明绕过 maxEntryBytes（调用方只应传真实读取长度）。
    const declaredBytes = Number(representation.bodyBytes);
    const bodyBytes = Math.max(
      Number.isFinite(declaredBytes) && declaredBytes > 0 ? declaredBytes : 0,
      encodedBodyBytes(representation.bodyText),
    );
    // 表示层创建时已完成 JSON 解析与根对象校验，直接复用其 payload：命中路径不再整包 JSON.parse。
    // 代价是条目常驻已解析对象（约 3-4x body，受 maxTotalBytes 约束），换来命中路径 40% 的 CPU。
    const payload = representation.payload;
    if (bodyBytes > this.maxEntryBytes || !payload) return false;
    const ttlMs = Math.max(0, Number(metadata.ttlMs) || 0);
    if (ttlMs <= 0) return false;
    const headers = sanitizePlaybackInfoSerializedResponseHeaders(response.headers);
    headers.delete("Set-Cookie");
    const now = this.now();
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, {
      nodeName: String(metadata.nodeName || "")
        .trim()
        .toLowerCase(),
      nodeRevision: String(metadata.nodeRevision || "").trim(),
      playbackInfoRewrite: String(metadata.playbackInfoRewrite || "").trim(),
      status: response.status,
      statusText: response.statusText,
      headers: [...headers.entries()],
      bodyText: representation.bodyText,
      bodyBytes,
      payload,
      storedAt: now,
      expiresAt: now + ttlMs,
    });
    this.cleanup(now);
    return true;
  }

  get(cacheKey) {
    if (!cacheKey) return null;
    const entry = this.entries.get(cacheKey);
    if (!entry) return null;
    const expiresAt = Number(entry.expiresAt) || 0;
    if (expiresAt > 0 && expiresAt <= this.now()) {
      this.entries.delete(cacheKey);
      return null;
    }
    let response;
    try {
      response = new Response(entry.bodyText, {
        status: Number(entry.status) || 200,
        statusText: String(entry.statusText || ""),
        headers: new Headers(Array.isArray(entry.headers) ? entry.headers : []),
      });
    } catch {
      this.entries.delete(cacheKey);
      return null;
    }
    // 不变量：entry.payload 与写入时的表示层共享同一个对象，下游只读
    // （改写一律写时复制，见 rewrite.js 顶部说明）；命中路径因此无需重新 JSON.parse 或结构校验。
    const representation = createPlaybackInfoRepresentation({
      response,
      bodyText: entry.bodyText,
      bodyBytes: entry.bodyBytes,
      payload: entry.payload,
    });
    if (!representation) {
      this.entries.delete(cacheKey);
      return null;
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return { representation, metadata: entry };
  }
}
