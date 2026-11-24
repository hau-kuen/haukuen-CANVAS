#!/usr/bin/env python
"""从 Chrome/Edge 的 Local Storage LevelDB 里导出某个 origin 的 localStorage。

用途：升级/换版本前把画布前端配置（API 渠道、Key）导出成 JSON 兜底，
不依赖浏览器是否在线、也不依赖用户手动点导出。

用法:
    python scripts/extract-chrome-localstorage.py --origin http://127.0.0.1:3000 \
        --out data/backups/localstorage-export.json [--mask]

默认只读 .ldb（SST）。Chrome 正在运行时 .ldb 是冻结的，内容一致；
最新几秒内的写入可能还在 .log 里，需要时用 --include-log。

注意：输出文件含明文 Key，不要提交进 git。
"""

import argparse
import glob
import json
import os
import re
import sys


# ---------- varint ----------
def read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        if pos >= len(buf):
            raise ValueError("varint out of range")
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")


# ---------- raw snappy ----------
def snappy_decompress(src):
    pos = 0
    length, pos = read_varint(src, pos)
    out = bytearray()
    while pos < len(src):
        tag = src[pos]
        pos += 1
        kind = tag & 0x03
        if kind == 0:  # literal
            ln = tag >> 2
            if ln < 60:
                ln += 1
            else:
                nbytes = ln - 59
                ln = int.from_bytes(src[pos:pos + nbytes], "little")
                pos += nbytes
                ln += 1
            out += src[pos:pos + ln]
            pos += ln
        else:
            if kind == 1:
                ln = ((tag >> 2) & 0x07) + 4
                off = ((tag >> 5) << 8) | src[pos]
                pos += 1
            elif kind == 2:
                ln = (tag >> 2) + 1
                off = int.from_bytes(src[pos:pos + 2], "little")
                pos += 2
            else:
                ln = (tag >> 2) + 1
                off = int.from_bytes(src[pos:pos + 4], "little")
                pos += 4
            if off == 0 or off > len(out):
                raise ValueError("bad snappy offset")
            start = len(out) - off
            for i in range(ln):
                out.append(out[start + i])
    if length != len(out):
        raise ValueError("snappy length mismatch %d != %d" % (length, len(out)))
    return bytes(out)


# ---------- leveldb table ----------
def read_block(data, handle):
    offset, size = handle
    raw = data[offset:offset + size]
    if len(raw) != size:
        raise ValueError("block truncated")
    trailer = data[offset + size:offset + size + 5]
    if not trailer:
        raise ValueError("block trailer missing")
    ctype = trailer[0]
    if ctype == 0:
        return raw
    if ctype == 1:
        return snappy_decompress(raw)
    raise ValueError("unsupported compression %d" % ctype)


def iter_block(block):
    if len(block) < 4:
        return
    n_restarts = int.from_bytes(block[-4:], "little")
    end = len(block) - 4 - 4 * n_restarts
    if end < 0:
        end = len(block) - 4
    pos = 0
    key = b""
    while pos < end:
        shared, pos = read_varint(block, pos)
        non_shared, pos = read_varint(block, pos)
        vlen, pos = read_varint(block, pos)
        key = key[:shared] + block[pos:pos + non_shared]
        pos += non_shared
        val = block[pos:pos + vlen]
        pos += vlen
        yield key, val


def parse_table(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 48:
        return
    footer = data[-48:]
    # 两个 BlockHandle 在 footer 开头，末尾 8 字节是 magic
    pos = 0
    try:
        _, pos = read_varint(footer, pos)   # metaindex offset
        _, pos = read_varint(footer, pos)   # metaindex size
        idx_off, pos = read_varint(footer, pos)
        idx_size, pos = read_varint(footer, pos)
    except ValueError:
        return
    try:
        index_block = read_block(data, (idx_off, idx_size))
    except Exception:
        return
    for _key, val in iter_block(index_block):
        try:
            off, pos2 = read_varint(val, 0)
            size, _ = read_varint(val, pos2)
        except ValueError:
            continue
        try:
            yield read_block(data, (off, size))
        except Exception:
            continue


# ---------- localStorage value ----------
def decode_value(raw):
    if not raw:
        return ""
    tag, body = raw[0], raw[1:]
    if tag == 0:
        return body.decode("utf-16-le", "replace")
    if tag == 1:
        return body.decode("latin-1")
    return raw.decode("utf-8", "replace")


def mask(text):
    led = 0
    out = []
    for ch in text:
        if ch.isalnum() and ch not in "-_":
            led += 1
            out.append("*" if led > 4 else ch)
        else:
            led = 0
            out.append(ch)
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leveldb", default=os.path.expanduser(
        "~/AppData/Local/Google/Chrome/User Data/Default/Local Storage/leveldb"))
    ap.add_argument("--origin", action="append", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-log", action="store_true")
    ap.add_argument("--mask", action="store_true", help="只打印脱敏摘要，不打印内容")
    args = ap.parse_args()

    origins = args.origin or ["http://127.0.0.1:3000", "http://localhost:3000"]
    patterns = ["*.ldb"] + (["*.log"] if args.include_log else [])
    files = []
    for pat in patterns:
        files += glob.glob(os.path.join(args.leveldb, pat))
    if not files:
        sys.exit("no leveldb files in %s" % args.leveldb)

    found = {}
    for path in files:
        for block in parse_table(path):
            for key, val in iter_block(block):
                try:
                    text = key.decode("latin-1")
                except Exception:
                    continue
                for origin in origins:
                    prefix = "_" + origin + "\x00"
                    if not text.startswith(prefix):
                        continue
                    # Chromium 格式: _<origin>\x00\x01<key>\x01<seq>
                    name = text[len(prefix):].lstrip("\x01")
                    name = re.split(r"[\x00-\x1f]", name)[0]
                    if not name:
                        continue
                    found.setdefault(origin, {})[name] = decode_value(val)

    if not found:
        sys.exit("origin 未在 .ldb 中找到：%s" % ", ".join(origins))

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(found, fh, ensure_ascii=False, indent=2)

    for origin, items in found.items():
        print("[%s] %d 个 key → %s" % (origin, len(items), args.out))
        for name, value in sorted(items.items()):
            body = str(value)
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = None
            detail = ""
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict) and "kind" in parsed[0]:
                detail = "快照 x%d, 首条 kind=%s savedAt=%s 渠道=%d" % (
                    len(parsed), parsed[0].get("kind"), parsed[0].get("savedAt"),
                    len(parsed[0].get("channels") or []))
            elif isinstance(parsed, dict):
                chs = parsed.get("channels") or (parsed.get("state") or {}).get("channels") or []
                detail = "对象 %d 键, 渠道=%d" % (len(parsed), len(chs) if isinstance(chs, list) else 0)
            preview = body if not args.mask else mask(body)
            print("  - %-46s %6d 字符 %s" % (name, len(body), detail))
            if args.mask is False:
                print("      %s" % preview[:160].replace("\n", " "))


if __name__ == "__main__":
    main()
