#!/usr/bin/env python
"""回捞画布里只存了远程 URL、没有落本地存储的图片节点。

背景：grsai 等渠道返回的图床链接会过期（404），节点 metadata 里
content 指向远程 URL 而 storageKey 为空，后续编辑就报「读取参考图失败：502」。

做法：对每个这类节点，经本地后端 /api/proxy-image 拉一次原图，再走
/api/v1/files（带 projectId）存进本地存储（D:\\canvas-storage\\<user>\\<项目>\\...），
然后把节点改写成 content=/api/files/<id>/content + storageKey=server:<id>。
已经 404 的图救不回来，脚本会跳过并逐个报告。

用法：
  python scripts/backfill-canvas-images.py --dry-run   # 只统计，不下载不上传
  python scripts/backfill-canvas-images.py             # 真跑（自动备份数据库）
"""

import argparse
import datetime
import io
import json
import os
import shutil
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "infinite-canvas.db")
API = "http://127.0.0.1:8080"


def api_post_json(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body or {}).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def fetch_via_proxy(url, timeout=60):
    """经后端代理取图，返回 (bytes, content_type) 或 (None, 错误说明)。"""
    proxied = API + "/api/proxy-image?url=" + urllib.parse.quote(url, safe="")
    try:
        with urllib.request.urlopen(proxied, timeout=timeout) as resp:
            return resp.read(), resp.headers.get("Content-Type", "image/png")
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def upload_bytes(data, content_type, filename, project_id, token):
    boundary = "----backfill" + uuid.uuid4().hex
    buf = io.BytesIO()
    buf.write(
        f'--{boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n{project_id}\r\n'.encode()
    )
    buf.write(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode()
    )
    buf.write(data)
    buf.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(API + "/api/v1/files", data=buf.getvalue(), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode())
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("msg") or "上传失败")
    return payload["data"]


def is_remote(url):
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只统计，不下载不上传")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少个节点（0 = 全部）")
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        sys.exit(f"找不到数据库：{DB_PATH}")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    rows = cur.execute(
        "select user_id, id, project_data from canvas_projects where deleted_at = ''"
    ).fetchall()

    projects = {}   # project_id -> {"user_id", "title", "data"}
    targets = []    # (project_id, node_index, node_id, url)
    for user_id, project_id, raw in rows:
        try:
            data = json.loads(raw)
        except Exception:  # noqa: BLE001
            continue
        projects[project_id] = {"user_id": user_id, "title": str(data.get("title") or ""), "data": data}
        for index, node in enumerate(data.get("nodes") or []):
            if node.get("type") != "image":
                continue
            meta = node.get("metadata") or {}
            if meta.get("storageKey"):
                continue
            if is_remote(meta.get("content")):
                targets.append((project_id, index, node.get("id"), meta.get("content")))

    print(f"项目 {len(rows)} 个，待回捞节点 {len(targets)} 个")
    for project_id, _index, node_id, url in targets[:20]:
        title = projects[project_id]["title"] or "(无标题)"
        print(f"  - {title} / {node_id} → {url[:90]}")
    if len(targets) > 20:
        print(f"  ... 其余 {len(targets) - 20} 个")

    if args.dry_run or not targets:
        return
    if args.limit:
        targets = targets[: args.limit]

    bak = DB_PATH + ".backfill-backup-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(DB_PATH, bak)
    print(f"已备份数据库 → {os.path.basename(bak)}")

    token = api_post_json("/api/auth/auto-login")["data"]["token"]
    ok = failed = 0
    touched = set()
    for project_id, index, node_id, url in targets:
        data, content_type = fetch_via_proxy(url)
        if data is None:
            failed += 1
            print(f"  跳过 {node_id}：原图已失效（{content_type}）")
            continue
        if not str(content_type).startswith("image/"):
            failed += 1
            print(f"  跳过 {node_id}：返回的不是图片（{content_type}）")
            continue
        try:
            uploaded = upload_bytes(data, content_type, os.path.basename(urllib.parse.urlparse(url).path) or "image.png", project_id, token)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  上传失败 {node_id}：{exc}")
            continue
        meta = projects[project_id]["data"]["nodes"][index].setdefault("metadata", {})
        meta["content"] = uploaded["url"]
        meta["storageKey"] = uploaded["storageKey"]
        meta["bytes"] = uploaded.get("bytes") or len(data)
        meta["mimeType"] = uploaded.get("mimeType") or content_type
        touched.add(project_id)
        ok += 1
        print(f"  已回捞 {node_id} → {uploaded['storageKey']}")

    now = datetime.datetime.now().astimezone().isoformat()
    for project_id in touched:
        entry = projects[project_id]
        cur.execute(
            "update canvas_projects set project_data = ?, updated_at = ? where user_id = ? and id = ?",
            (json.dumps(entry["data"], ensure_ascii=False), now, entry["user_id"], project_id),
        )
    con.commit()
    con.close()
    print(f"完成：回捞 {ok} 张，失败/已失效 {failed} 张，更新 {len(touched)} 个项目")


if __name__ == "__main__":
    main()
