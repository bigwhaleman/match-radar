#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公开静态站快照生成与 GitHub Actions 定时增量更新脚本（纯 Python 标准库）。
- 本地导出：`python3 scripts/update_public_snapshot.py --from-sqlite`
- Actions 定时/手动补录：`python3 scripts/update_public_snapshot.py [--supplement-url URL --city-hint CITY]`
遵循合规采集契约：固定公开源或显式公开 URL，遇 403/503/验证码保留既有成功快照并标 blocked，原子替换 JSON。
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
from urllib.parse import urlparse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from parser import mask_sensitive_text, parse_document_to_profiles

SHANGHAI_TZ = timezone(timedelta(hours=8))
SNAPSHOT_PATH = os.path.join(ROOT_DIR, "public", "data", "snapshot.json")

PUBLIC_CANDIDATE_FIELDS = [
    "fingerprint", "code_name", "gender", "birth_year", "age",
    "height_cm", "weight_kg", "education", "edu_level", "city", "hometown",
    "occupation", "is_tizhi", "income_annual_wan", "income_text",
    "housing_car", "has_house", "has_car", "marital_status",
    "self_intro", "tags", "req_raw", "req_birth_min", "req_birth_max",
    "req_height_min", "req_edu_min", "req_house", "req_local", "req_tizhi",
    "source_platform", "source_title", "source_url", "raw_masked", "fetched_at",
]


def now_cn() -> str:
    return datetime.now(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M:%S")


def html_to_clean_text(raw_html: str) -> str:
    s = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw_html, flags=re.DOTALL | re.IGNORECASE)
    s = re.sub(r"<(br|p|div|li|tr|h[1-6])[^>]*>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def fetch_public_page_stdlib(url: str, timeout: int = 25) -> Dict[str, Any]:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"ok": False, "status": "error", "error": "Invalid HTTP/HTTPS URL", "text": ""}
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MatchRadar-PublicSnapshotBot/2.0 (+https://github.com/bigwhaleman/match-radar)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.getcode() or 200
            raw_bytes = resp.read(1_800_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            raw_html = raw_bytes.decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        st = "blocked" if e.code in (401, 403, 429, 503) else "error"
        return {"ok": False, "status": st, "error": f"HTTP {e.code}", "text": ""}
    except Exception as exc:
        return {"ok": False, "status": "error", "error": str(exc)[:140], "text": ""}

    lower_chk = raw_html[:6000].lower()
    if any(k in lower_chk for k in ("captcha", "wappoc_appmsgcaptcha", "cf-browser-verification", "安全验证")):
        return {"ok": False, "status": "blocked", "error": "检测到站点验证码或访问验证墙，按合规策略跳过", "text": ""}

    title_m = re.search(r"<title[^>]*>(.*?)</title>", raw_html, flags=re.DOTALL | re.IGNORECASE)
    page_title = html.unescape(title_m.group(1)).strip() if title_m else ""
    text = html_to_clean_text(raw_html)
    return {"ok": True, "status": "ok", "code": code, "title": page_title[:90], "text": text}


def infer_platform_label(url: str) -> str:
    host = (urlparse(url).netloc or "").lower()
    if "mp.weixin.qq.com" in host:
        return "微信公众号"
    if "163.com" in host:
        return "网易号专栏"
    if "sohu.com" in host:
        return "搜狐号专栏"
    if "cloud.tencent." in host:
        return "硕士博士俱乐部(企鹅号归档)"
    if "thepaper.cn" in host:
        return "澎湃政务/媒体号"
    return host or "公开网页"


def atomic_write_json(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp.{os.getpid()}"
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=2)
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(data)
        f.write("\n")
    os.replace(tmp_path, path)


def export_from_local_sqlite() -> Dict[str, Any]:
    import db

    db.init_db()
    cands = db.list_all_candidates()
    sources = db.list_sources()
    logs = db.list_logs(limit=35)

    clean_cands: List[Dict[str, Any]] = []
    for idx, c in enumerate(cands, start=1):
        row = {"id": idx}
        for k in PUBLIC_CANDIDATE_FIELDS:
            val = c.get(k)
            if k in ("self_intro", "req_raw", "raw_masked") and isinstance(val, str):
                val = mask_sensitive_text(val)
            row[k] = val
        clean_cands.append(row)

    ok_srcs = [s for s in sources if s.get("last_status") == "ok"]
    blocked_srcs = [s for s in sources if s.get("last_status") == "blocked"]
    latest_ok = max((s["last_success_at"] for s in ok_srcs if s.get("last_success_at")), default=now_cn())

    payload = {
        "meta": {
            "site_version": "2.0.0",
            "generated_at": now_cn(),
            "latest_success_at": latest_ok,
            "total_candidates": len(clean_cands),
            "ok_source_count": len(ok_srcs),
            "blocked_source_count": len(blocked_srcs),
            "repo_slug": "bigwhaleman/match-radar",
            "platform_name": "从简Clarvy",
            "platform_url": "https://claudeai.chat",
        },
        "candidates": clean_cands,
        "sources": sources,
        "logs": logs,
    }
    atomic_write_json(SNAPSHOT_PATH, payload)
    return payload


def refresh_snapshot_in_ci(supplement_url: str = "", city_hint: str = "") -> Dict[str, Any]:
    if os.path.isfile(SNAPSHOT_PATH):
        with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
            snap = json.load(f)
    else:
        snap = {"meta": {}, "candidates": [], "sources": [], "logs": []}

    by_fp: Dict[str, Dict[str, Any]] = {c["fingerprint"]: c for c in snap.get("candidates", []) if c.get("fingerprint")}
    sources: List[Dict[str, Any]] = snap.get("sources", [])
    logs: List[Dict[str, Any]] = snap.get("logs", [])

    if supplement_url.strip():
        u = supplement_url.strip()
        if not any(s.get("target") == u for s in sources):
            sources.append({
                "id": len(sources) + 1,
                "name": f"工作流补录源 ({city_hint or '公开链接'})",
                "kind": "public_url",
                "target": u,
                "city_hint": city_hint.strip(),
                "enabled": 1,
                "interval_hours": 24,
                "last_attempt_at": None,
                "last_success_at": None,
                "last_status": "never",
                "last_error": "",
                "last_sha256": "",
                "items_extracted": 0,
            })

    now = now_cn()
    for s in sources:
        if not s.get("enabled", 1) or s.get("kind") != "public_url":
            continue
        target = s["target"]
        res = fetch_public_page_stdlib(target)
        s["last_attempt_at"] = now
        if not res["ok"]:
            # 保留原 last_success_at 与已入库数据，不清空旧值
            s["last_status"] = res["status"]
            s["last_error"] = res["error"]
            logs.insert(0, {
                "run_at": now,
                "source_name": s["name"],
                "kind": "public_url",
                "target": target,
                "status": res["status"],
                "new_count": 0,
                "updated_count": 0,
                "detail": f"保留既有快照；本次未更新：{res['error']}",
            })
            continue

        txt = res["text"]
        sha = hashlib.sha256(txt.encode("utf-8")).hexdigest()[:16]
        profiles = parse_document_to_profiles(
            raw_text=txt,
            source_title=res.get("title") or s["name"],
            source_url=target,
            source_platform=infer_platform_label(target),
            override_city=s.get("city_hint") or None,
        )
        if not profiles and s.get("items_extracted", 0) > 0:
            # 防止动态渲染空壳覆盖已有成功状态
            s["last_status"] = "stale"
            s["last_error"] = "静态响应未提取到结构化卡片，保留历史成功快照"
            continue

        new_c = 0
        upd_c = 0
        for p in profiles:
            fp = p["fingerprint"]
            clean_p = {k: p.get(k) for k in PUBLIC_CANDIDATE_FIELDS}
            clean_p["fetched_at"] = by_fp[fp].get("fetched_at", now) if fp in by_fp else now
            if fp in by_fp:
                by_fp[fp].update(clean_p)
                upd_c += 1
            else:
                by_fp[fp] = clean_p
                new_c += 1

        s["last_success_at"] = now
        s["last_status"] = "ok"
        s["last_error"] = ""
        s["last_sha256"] = sha
        s["items_extracted"] = len(profiles)
        logs.insert(0, {
            "run_at": now,
            "source_name": s["name"],
            "kind": "public_url",
            "target": target,
            "status": "ok",
            "new_count": new_c,
            "updated_count": upd_c,
            "detail": f"校验通过 (SHA:{sha})，识别 {len(profiles)} 人，新增 {new_c}，更新 {upd_c}",
        })

    merged_list = []
    for i, item in enumerate(by_fp.values(), start=1):
        merged_list.append({"id": i, **item})

    ok_srcs = [s for s in sources if s.get("last_status") == "ok"]
    blocked_srcs = [s for s in sources if s.get("last_status") in ("blocked", "stale")]
    latest_ok = max((s["last_success_at"] for s in ok_srcs if s.get("last_success_at")), default=snap.get("meta", {}).get("latest_success_at"))

    out_payload = {
        "meta": {
            "site_version": "2.0.0",
            "generated_at": now,
            "latest_success_at": latest_ok,
            "total_candidates": len(merged_list),
            "ok_source_count": len(ok_srcs),
            "blocked_source_count": len(blocked_srcs),
            "repo_slug": "bigwhaleman/match-radar",
            "platform_name": "从简Clarvy",
            "platform_url": "https://claudeai.chat",
        },
        "candidates": merged_list,
        "sources": sources,
        "logs": logs[:45],
    }
    atomic_write_json(SNAPSHOT_PATH, out_payload)
    return out_payload


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-sqlite", action="store_true", help="从本地 SQLite 导出公开脱敏快照")
    ap.add_argument("--supplement-url", default="", help="附加补录的公开相亲网页 URL")
    ap.add_argument("--city-hint", default="", help="补录链接的默认城市")
    args = ap.parse_args()

    if args.from_sqlite:
        res = export_from_local_sqlite()
    else:
        res = refresh_snapshot_in_ci(supplement_url=args.supplement_url, city_hint=args.city_hint)
    print(json.dumps(res["meta"], ensure_ascii=False))


if __name__ == "__main__":
    main()
