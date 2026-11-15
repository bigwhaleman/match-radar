#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多格式中文相亲/征友信息结构化解析器与个人隐私脱敏模块。
支持：
1. 公众号/网易号/搜狐号多行键值卡片（①号女嘉宾 / 01号女嘉宾资料 / Love.01）
2. 行内键值卡片（性别：男 / 出生年：1990 / 身高：173）
3. 社群/朋友圈/小红书自然段自我介绍文本
4. 自动联系方式隐私脱敏（手机号、身份证、微信号、QQ、邮箱）
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

CURRENT_YEAR = 2026

EDU_MAP: List[Tuple[str, str, int]] = [
    (r"博士|博士后|Ph\.?D", "博士", 5),
    (r"硕士|研究生|MBA|MPA|法硕|科硕|专硕", "硕士", 4),
    (r"本科|学士|全日制本|专升本|进修本科|一本|二本|985|211|双一流", "本科", 3),
    (r"大专|专科|高职|进修大专", "大专", 2),
    (r"高中|中专|职高|初中|技校", "高中及以下", 1),
]

COMMON_CITIES = [
    "北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "无锡", "常州", "南通", "盐城", "泰州", "徐州", "扬州",
    "成都", "重庆", "武汉", "西安", "长沙", "郑州", "青岛", "济南", "宁波", "温州", "嘉兴", "湖州", "绍兴", "金华", "衢州",
    "合肥", "福州", "厦门", "泉州", "南昌", "新余", "赣州", "九江", "沈阳", "大连", "哈尔滨", "长春", "石家庄", "太原",
    "昆明", "贵阳", "南宁", "海口", "兰州", "银川", "西宁", "乌鲁木齐", "呼和浩特", "天津", "珠海", "佛山", "东莞", "中山",
    "惠州", "濮阳", "洛阳", "新乡", "南阳", "烟台", "潍坊", "临沂", "淄博", "威海", "保定", "唐山", "芜湖", "绵阳", "宜昌",
    "平湖", "宜春", "樟树", "内江", "连云港", "安阳", "信阳",
]

FOOTER_CUTOFF_PATTERNS = [
    r"免责声明[:：]?",
    r"特别声明[:：]?",
    r"返回搜狐，查看更多",
    r"Notice:\s*The content above",
    r"只需扫码填写基本资料",
    r"点击下方小程序即可查看嘉宾",
    r"扫码获取更多嘉宾信息",
    r"本期嘉宾是不是你心动的那个",
    r"如你想认识这位嘉宾",
    r"加入单身扶持计划，意味着",
    r"腾讯「腾讯云开发者社区」",
    r"原文链接[:：]\s*http",
]


def mask_sensitive_text(text: str) -> str:
    """对原始文本中的手机号、身份证号、微信号、QQ号、邮箱做本地合规脱敏。"""
    if not text:
        return ""
    out = text
    # 18位身份证号
    out = re.sub(r"(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)", "[身份证已脱敏]", out)
    # 大陆11位手机号
    out = re.sub(r"(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)", r"\1****\2", out)
    # 邮箱
    out = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱已脱敏]", out)
    # 显式微信号/VX
    out = re.sub(
        r"((?:微信号?|VX|vx|WeChat)\s*[:：是为]?\s*)([A-Za-z][A-Za-z0-9_-]{5,19})",
        r"\1[微信号已脱敏]",
        out,
    )
    # 显式QQ
    out = re.sub(r"((?:QQ|qq|扣扣)\s*[:：是为]?\s*)(\d{5,12})", r"\1[QQ已脱敏]", out)
    return out


def clean_markdown_noise(raw: str) -> str:
    """清理 Markdown 粗体符号与多余空行，截断文章末尾引流免责声明。"""
    if not raw:
        return ""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = text.replace("**", "")
    lines = [ln.strip() for ln in text.split("\n")]
    cleaned_lines: List[str] = []
    for ln in lines:
        if ln in {"♥", "／／／", "∨", "（点击图片查看详情）", "(点击图片查看详情)"}:
            continue
        cleaned_lines.append(ln)
    joined = "\n".join(cleaned_lines)
    for pat in FOOTER_CUTOFF_PATTERNS:
        m = re.search(pat, joined)
        if m and m.start() > 120:
            joined = joined[: m.start()]
    return joined.strip()


def infer_context_from_article(title: str, body: str) -> Tuple[Optional[str], Optional[str]]:
    """从文章标题和导语推断默认性别和主要城市。"""
    sample = f"{title}\n{body[:350]}"
    ctx_gender: Optional[str] = None
    has_female = bool(re.search(r"女嘉宾|女生|小姐姐|女青年|妹子篇|妹子合辑", title))
    has_male = bool(re.search(r"男嘉宾|男生|小哥|男青年|男士|汉子篇|帅哥篇", title))
    if has_female and not has_male:
        ctx_gender = "F"
    elif has_male and not has_female:
        ctx_gender = "M"

    ctx_city: Optional[str] = None
    for c in COMMON_CITIES:
        if c in title:
            ctx_city = c
            break
    if not ctx_city:
        for c in COMMON_CITIES:
            # 统计正文高频出现城市
            if sample.count(c) >= 2:
                ctx_city = c
                break
    return ctx_gender, ctx_city


HEADER_PATTERNS = [
    # ①号女嘉宾 / 01 号 女 嘉 宾 资 料 / 1号男生
    re.compile(
        r"^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|\d{1,3})\s*号\s*(?:[男女]\s*)?(?:嘉\s*宾|男\s*生|女\s*生|小\s*哥|小\s*姐\s*姐)(?:\s*资\s*料)?$"
    ),
    # Love. 01 / NO.01 / 嘉宾 01
    re.compile(r"^(?:Love\.?|NO\.?|No\.?|嘉宾编号|嘉宾)\s*0?\d{1,3}$", re.IGNORECASE),
]


def is_candidate_header(line: str) -> bool:
    s = line.strip().lstrip("*#-• ").strip()
    if not s or len(s) > 28:
        return False
    for pat in HEADER_PATTERNS:
        if pat.match(s):
            return True
    return False


def split_candidates(raw_text: str, title: str = "") -> List[Tuple[str, str]]:
    """
    将整篇文章或粘贴文本切分为 [(header_label, block_text), ...]。
    支持标准嘉宾头、「硕士博士俱乐部」纯数字序号+昵称头、分隔线及群接龙。
    """
    cleaned = clean_markdown_noise(raw_text)
    if not cleaned:
        return []

    lines = cleaned.split("\n")
    indices: List[Tuple[int, str]] = []
    for idx, ln in enumerate(lines):
        if is_candidate_header(ln):
            label = re.sub(r"\s+", "", ln.strip().lstrip("*#-• "))
            indices.append((idx, label))
            continue
        # 兼容「方糖·硕士博士俱乐部 / 硕博联谊」纯数字行后紧跟 昵称：/ 学校：
        s_num = ln.strip().lstrip("*#-• ").strip()
        if re.fullmatch(r"0?\d{1,2}", s_num):
            nxt_nonempty = ""
            for j in range(idx + 1, min(idx + 4, len(lines))):
                if lines[j].strip():
                    nxt_nonempty = lines[j].strip()
                    break
            if re.match(r"^(?:昵称|代号|学校|编号)\s*[:：]", nxt_nonempty):
                indices.append((idx, f"硕博联谊{int(s_num):02d}号"))

    if indices:
        blocks: List[Tuple[str, str]] = []
        for i, (start_idx, label) in enumerate(indices):
            end_idx = indices[i + 1][0] if i + 1 < len(indices) else len(lines)
            chunk = "\n".join(lines[start_idx + 1 : end_idx]).strip()
            if len(chunk) >= 15:
                blocks.append((label, chunk))
        return blocks

    # 若以 --- 或 === 分隔多个自述段
    sep_chunks = [c.strip() for c in re.split(r"\n\s*(?:---+|\===+|###+)\s*\n", cleaned) if len(c.strip()) >= 25]
    if len(sep_chunks) > 1:
        return [(f"候选人{i+1:02d}", ch) for i, ch in enumerate(sep_chunks)]

    # 尝试按行首 “1. 95年女生...” 或 “【1】...” 拆分群接龙格式
    jielong = re.split(r"\n(?=(?:【\d+】|\d+[\.、])\s*(?:\d{2,4}年|[男女]|身高|坐标|目前))", "\n" + cleaned)
    jielong = [c.strip() for c in jielong if len(c.strip()) >= 25]
    if len(jielong) > 1:
        return [(f"接龙{i+1:02d}", ch) for i, ch in enumerate(jielong)]

    # 单人帖子检查是否具备相亲要素
    if re.search(r"(身高|出生|学历|择偶|未婚|离异|\d{3}\s*cm|\d{2}年)", cleaned):
        short_title = (title[:16] if title else "单篇嘉宾").strip()
        return [(short_title, cleaned)]
    return []


KNOWN_KEYS = {
    "编号": "serial",
    "昵称": "nickname",
    "代号": "nickname",
    "性别": "gender",
    "籍贯": "hometown",
    "户籍": "hometown",
    "家乡": "hometown",
    "目前所在地": "city",
    "所在地": "city",
    "定居": "city",
    "现居": "city",
    "常居地": "city",
    "坐标": "city",
    "工作地": "city",
    "出生年份": "birth",
    "出生年": "birth",
    "出生": "birth",
    "年龄": "birth",
    "年纪": "birth",
    "生日": "birth",
    "身高": "height",
    "体重": "weight",
    "学校": "school",
    "毕业院校": "school",
    "最高学历": "education",
    "学历": "education",
    "专业": "education",
    "所学专业": "education",
    "目前职业": "occupation",
    "职业": "occupation",
    "工作": "occupation",
    "从事": "occupation",
    "年薪": "income_annual",
    "年入": "income_annual",
    "年收入": "income_annual",
    "月均收入": "income_monthly",
    "月薪": "income_monthly",
    "月入": "income_monthly",
    "收入": "income_any",
    "车房情况": "housing_car",
    "我个人车房情况": "housing_car",
    "房车状况": "housing_car",
    "房车": "housing_car",
    "婚姻状况": "marital",
    "婚姻": "marital",
    "阶段": "marital",
    "爱好": "hobbies",
    "兴趣爱好": "hobbies",
    "红娘印象": "impression",
    "嘉宾自述": "self_intro",
    "自我介绍": "self_intro",
    "个人介绍": "self_intro",
    "个人简介": "self_intro",
    "关于我": "self_intro",
    "家庭情况": "family",
    "类型": "style_tags",
    "星座": "zodiac",
    "择偶要求": "requirements",
    "择偶标准": "requirements",
    "希望另一半": "requirements",
    "理想对象": "requirements",
    "希望你": "requirements",
    "希望对方": "requirements",
    "对你的要求": "requirements",
    "要求": "requirements",
}


def _norm_key_token(s: str) -> str:
    return re.sub(r"[\s【】\[\]()（）]", "", s)


def extract_kv_pairs(block: str) -> Dict[str, str]:
    """支持 `键：值`、`【键名】：值` 以及 `关于我\\n多段正文` 换行格式。"""
    kv: Dict[str, str] = {}
    raw_lines = [ln.lstrip("*•- ").strip() for ln in block.split("\n") if ln.strip()]
    i = 0
    while i < len(raw_lines):
        ln = raw_lines[i]
        # 优先匹配行内 key: value（含【个人简介】：xxx）
        m = re.match(r"^([【\[]?[\u4e00-\u9fa5\s]{2,10}[】\]]?)\s*[:：]\s*(.*)$", ln)
        if m:
            k_raw = _norm_key_token(m.group(1))
            val = m.group(2).strip()
            norm_k = KNOWN_KEYS.get(k_raw)
            if norm_k:
                if val:
                    kv[norm_k] = f"{kv[norm_k]}；{val}" if norm_k in kv else val
                elif i + 1 < len(raw_lines) and _norm_key_token(raw_lines[i + 1]) not in KNOWN_KEYS:
                    nxt = raw_lines[i + 1]
                    if not re.match(r"^[【\[]?[\u4e00-\u9fa5\s]{2,10}[】\]]?\s*[:：]", nxt):
                        kv[norm_k] = nxt
                        i += 1
                i += 1
                continue
        # 匹配独立成行的 key（如「关于我」「希望你」或网易号独立键行）
        k_solo = _norm_key_token(ln)
        if k_solo in KNOWN_KEYS:
            norm_k = KNOWN_KEYS[k_solo]
            collected: List[str] = []
            j = i + 1
            max_lines = 8 if norm_k in ("self_intro", "requirements") else 1
            while j < len(raw_lines) and len(collected) < max_lines:
                cand_ln = raw_lines[j]
                if _norm_key_token(cand_ln) in KNOWN_KEYS:
                    break
                if re.match(r"^[【\[]?[\u4e00-\u9fa5\s]{2,10}[】\]]?\s*[:：]", cand_ln):
                    break
                if cand_ln in ("男嘉宾入围资料", "女嘉宾入围资料"):
                    break
                collected.append(cand_ln)
                j += 1
            if collected:
                joined_val = " ".join(collected)
                kv[norm_k] = f"{kv[norm_k]}；{joined_val}" if norm_k in kv else joined_val
                i = j
                continue
        i += 1
    return kv


def normalize_year(yr_int: int) -> Optional[int]:
    if 1950 <= yr_int <= 2008:
        return yr_int
    if 50 <= yr_int <= 99:
        return 1900 + yr_int
    if 0 <= yr_int <= 8:
        return 2000 + yr_int
    return None


def parse_birth_year(kv: Dict[str, str], full_text: str) -> Optional[int]:
    src = kv.get("birth", "")
    intro_part = re.split(r"择偶(?:要求|标准)|希望另一半|希望你|希望对方", full_text)[0]
    # 1) 先找明确的四位年份（1989 / 1996）
    for target in (src, intro_part):
        if not target:
            continue
        m4 = re.search(r"(19[5-9]\d|200[0-8])\s*年?", target)
        if m4:
            return int(m4.group(1))
    # 2) 再找带“年”的两位出生年份（90年 / 95年）
    for target in (src, intro_part):
        if not target:
            continue
        m2 = re.search(r"(?<!\d)([789]\d|0[0-6])\s*(?:年|后(?![男女人]))", target)
        if m2:
            return normalize_year(int(m2.group(1)))
    # 3) 处理裸两位数字（96 -> 1996；28 -> 岁数折算）
    if src and re.fullmatch(r"\d{2}", src.strip()):
        v = int(src.strip())
        ny = normalize_year(v)
        if ny:
            return ny
        if 18 <= v <= 49:
            return CURRENT_YEAR - v
    for target in (src, intro_part):
        if not target:
            continue
        m_age = re.search(r"(?<!\d)([2-6]\d)\s*岁", target)
        if m_age:
            return CURRENT_YEAR - int(m_age.group(1))
    return None


def parse_height_cm(kv: Dict[str, str], full_text: str) -> Optional[int]:
    src = kv.get("height", "")
    if src:
        m = re.search(r"(1[4-9]\d|20\d)", src)
        if m:
            return int(m.group(1))
        m_m = re.search(r"1\s*[米m\.]\s*(\d{2})", src)
        if m_m:
            return 100 + int(m_m.group(1))
    # 全文回退（避开“择偶要求”后半段）
    intro_part = re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    m2 = re.search(r"(?:身高\s*[:：]?\s*)(1[4-9]\d|20\d)", intro_part)
    if m2:
        return int(m2.group(1))
    m3 = re.search(r"(?<!\d)(1[5-9]\d)\s*cm", intro_part, re.IGNORECASE)
    if m3:
        return int(m3.group(1))
    m4 = re.search(r"1\s*米\s*(\d{2})", intro_part)
    if m4:
        return 100 + int(m4.group(1))
    return None


def parse_weight_kg(kv: Dict[str, str], full_text: str) -> Optional[float]:
    src = kv.get("weight", "") or re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    m_kg = re.search(r"(?<!\d)([3-9]\d(?:\.\d)?|1[0-3]\d)\s*(?:kg|公斤)", src, re.IGNORECASE)
    if m_kg:
        return round(float(m_kg.group(1)), 1)
    m_jin = re.search(r"(?<!\d)([7-9]\d|1\d{2}|2[0-2]\d)\s*斤", src)
    if m_jin:
        return round(float(m_jin.group(1)) / 2.0, 1)
    return None


def parse_education(kv: Dict[str, str], full_text: str) -> Tuple[str, int]:
    intro_part = kv.get("education", "") or re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    for pat, label, lvl in EDU_MAP:
        if re.search(pat, intro_part, re.IGNORECASE):
            return label, lvl
    return "未注明", 0


def parse_income(kv: Dict[str, str], full_text: str) -> Tuple[Optional[float], str]:
    """统一折算为年收入（万元/年），并保留原始口径描述。"""
    if "income_annual" in kv:
        raw = kv["income_annual"]
        val = _extract_wan_value(raw, is_monthly=False)
        return val, f"年收入 {raw}"
    if "income_monthly" in kv:
        raw = kv["income_monthly"]
        val = _extract_wan_value(raw, is_monthly=True)
        return val, f"月收入 {raw}"
    if "income_any" in kv:
        raw = kv["income_any"]
        is_m = "月" in raw or (re.search(r"\d{4,5}", raw) is not None and "万" not in raw and "w" not in raw.lower())
        val = _extract_wan_value(raw, is_monthly=is_m)
        return val, raw

    intro_part = re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    m_ann = re.search(r"年(?:薪|入|收入)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*[-~至]\s*[0-9]+(?:\.[0-9]+)?)?\s*[wW万➕+]?)", intro_part)
    if m_ann:
        raw = m_ann.group(1)
        return _extract_wan_value(raw, is_monthly=False), f"年薪 {raw}"
    m_mon = re.search(r"月(?:薪|均收入|入|收入)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?\s*[wW万kK千➕+]?)", intro_part)
    if m_mon:
        raw = m_mon.group(1)
        return _extract_wan_value(raw, is_monthly=True), f"月薪 {raw}"
    return None, "未注明"


def _extract_wan_value(raw: str, is_monthly: bool) -> Optional[float]:
    s = raw.strip().lower().replace("➕", "+")
    # 区间如 15-20w 取中位数
    m_range = re.search(r"(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)", s)
    if m_range:
        num = (float(m_range.group(1)) + float(m_range.group(2))) / 2.0
    else:
        m_single = re.search(r"(\d+(?:\.\d+)?)", s)
        if not m_single:
            return None
        num = float(m_single.group(1))

    if is_monthly:
        if "w" in s or "万" in s:
            monthly_wan = num
        elif "k" in s or "千" in s:
            monthly_wan = num * 0.1
        elif num >= 500:  # 如 8000 / 10000 元
            monthly_wan = num / 10000.0
        else:
            monthly_wan = num
        return round(monthly_wan * 12.0, 1)
    else:
        if num >= 2000:  # 如 150000 元
            return round(num / 10000.0, 1)
        return round(num, 1)


def parse_housing_car(kv: Dict[str, str], full_text: str) -> Tuple[str, Optional[bool], Optional[bool]]:
    intro_part = re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    raw = kv.get("housing_car", "").strip()
    if not raw:
        m = re.search(r"(有房有车|有车有房|有房无车|有车无房|名下有房|独立购房|已购车|已经购车|市区有房)", intro_part)
        raw = m.group(1) if m else ""
    if not raw or raw in {"暂无", "无"}:
        if raw in {"暂无", "无"}:
            return raw, False, False
        return "未注明", None, None

    has_house: Optional[bool] = None
    has_car: Optional[bool] = None
    if re.search(r"无房|未买房|没房", raw):
        has_house = False
    elif re.search(r"有房|有住房|购房|市区有房|有车房|名下有房", raw) and not re.search(r"有能力购房", raw):
        has_house = True

    if re.search(r"无车|未买车|没车", raw):
        has_car = False
    elif re.search(r"有车|已购车|已经购车|已买车|代步车|有车房", raw) and not re.search(r"有能力买车", raw):
        has_car = True

    return raw, has_house, has_car


def parse_city(kv: Dict[str, str], full_text: str, context_city: Optional[str]) -> str:
    loc_raw = kv.get("city", "")
    for c in COMMON_CITIES:
        if c in loc_raw:
            return c
    if loc_raw:
        # 提取前2~4个汉字作为城市名
        m = re.match(r"([\u4e00-\u9fa5]{2,4})", loc_raw)
        if m:
            return m.group(1)
    if context_city:
        return context_city
    intro_part = re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    for c in COMMON_CITIES:
        if c in intro_part:
            return c
    return "未注明"


def parse_marital_status(kv: Dict[str, str], full_text: str) -> str:
    src = kv.get("marital", "") or re.split(r"择偶(?:要求|标准)|希望另一半", full_text)[0]
    if "未婚" in src:
        return "未婚"
    if "离异" in src or "短婚" in src:
        if "未育" in src or "无孩" in src:
            return "离异未育"
        return "离异"
    if "丧偶" in src:
        return "丧偶"
    return "未婚" if "单身" in src else "未注明"


def parse_partner_requirements(req_text: str, candidate_birth_year: Optional[int]) -> Dict[str, Any]:
    """从择偶要求文本中解析反向匹配硬性指标。"""
    res: Dict[str, Any] = {
        "req_raw": req_text.strip(),
        "req_birth_min": None,
        "req_birth_max": None,
        "req_height_min": None,
        "req_edu_min": 0,
        "req_house": False,
        "req_local": False,
        "req_tizhi": False,
    }
    if not req_text:
        return res

    # 1) 出生年份区间：如 94-98 / 1990-1998
    m_yr_range = re.search(r"(?<!\d)(19[7-9]\d|200\d|[789]\d|0[0-5])\s*[-~至到]\s*(19[7-9]\d|200\d|[789]\d|0[0-5])(?:\s*年)?", req_text)
    if m_yr_range:
        y1 = normalize_year(int(m_yr_range.group(1)))
        y2 = normalize_year(int(m_yr_range.group(2)))
        if y1 and y2:
            res["req_birth_min"] = min(y1, y2)
            res["req_birth_max"] = max(y1, y2)
    else:
        # 如 95年及以后 / 93以后 / 92后 / 88年以后
        m_after = re.search(r"(?<!\d)(19[7-9]\d|[789]\d)\s*(?:年\s*及?\s*以后|以后|后)", req_text)
        if m_after:
            raw_y = int(m_after.group(1))
            y = normalize_year(raw_y)
            if y:
                # 若写“90后”且紧跟男/女生而无“以后”，通常指1990及以后
                res["req_birth_min"] = y
        elif candidate_birth_year:
            # 相对年龄：接受大三岁以内 / 同龄或小3岁
            m_older = re.search(r"大\s*([一二三四五1-5])\s*岁\s*以内", req_text)
            if m_older:
                cn_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}
                d = cn_map.get(m_older.group(1), int(m_older.group(1)) if m_older.group(1).isdigit() else 3)
                res["req_birth_min"] = candidate_birth_year - d

    # 2) 最低身高：如 身高178以上 / 172以上 / 175左右 / 180+
    m_h = re.search(r"(?:身高\s*)?(1[5-9]\d)\s*(?:cm)?\s*(?:及以上|以上|\+|➕)", req_text, re.IGNORECASE)
    if m_h:
        res["req_height_min"] = int(m_h.group(1))
    else:
        m_h_around = re.search(r"身高\s*(1[5-9]\d)\s*左右", req_text)
        if m_h_around:
            res["req_height_min"] = int(m_h_around.group(1)) - 2

    # 3) 最低学历
    if re.search(r"硕士|硕博|研究生", req_text):
        res["req_edu_min"] = 4
    elif re.search(r"本科|全日制本|985|211", req_text):
        res["req_edu_min"] = 3
    elif re.search(r"大专|专科", req_text):
        res["req_edu_min"] = 2
    elif re.search(r"高中", req_text):
        res["req_edu_min"] = 1

    # 4) 住房、本地与体制内要求
    if re.search(r"有房|有婚房|有住房|独立住房|单独住房", req_text) and not re.search(r"房车无硬性要求|房车不限", req_text):
        res["req_house"] = True
    if re.search(r"本地|定居|同城", req_text):
        res["req_local"] = True
    if re.search(r"体制内|在编|公务员|事业编", req_text) and not re.search(r"非体制也接受|单位类型不限|或者企业", req_text):
        res["req_tizhi"] = True

    return res


def parse_candidate_block(
    header: str,
    block: str,
    context_gender: Optional[str] = None,
    context_city: Optional[str] = None,
    source_platform: str = "公开网页",
    source_url: str = "",
    source_title: str = "",
) -> Optional[Dict[str, Any]]:
    """把单个候选人文本块解析为标准结构化字典。"""
    masked_block = mask_sensitive_text(block)
    kv = extract_kv_pairs(masked_block)

    # 性别识别
    gender: Optional[str] = None
    if re.search(r"女", header) and not re.search(r"男", header):
        gender = "F"
    elif re.search(r"男", header) and not re.search(r"女", header):
        gender = "M"
    elif "gender" in kv:
        if "女" in kv["gender"]:
            gender = "F"
        elif "男" in kv["gender"]:
            gender = "M"
    if not gender:
        intro_part = re.split(r"择偶(?:要求|标准)|希望另一半", masked_block)[0]
        if re.search(r"女生|女孩|独生女|天蝎女|小姐姐|宝藏女生", intro_part):
            gender = "F"
        elif re.search(r"男生|小哥|男青年|男士", intro_part):
            gender = "M"
        else:
            gender = context_gender or "U"

    birth_year = parse_birth_year(kv, masked_block)
    age = (CURRENT_YEAR - birth_year) if birth_year else None
    height_cm = parse_height_cm(kv, masked_block)
    weight_kg = parse_weight_kg(kv, masked_block)
    education, edu_level = parse_education(kv, masked_block)
    city = parse_city(kv, masked_block, context_city)
    hometown = kv.get("hometown", "").strip() or "未注明"
    school = kv.get("school", "").strip()
    occupation = re.sub(r"^从事|工作$", "", kv.get("occupation", "").strip()).strip()
    if not occupation and school:
        occupation = f"{school}"
    occupation = occupation or "未注明"
    is_tizhi = bool(re.search(r"公务员|事业编|在编|国企|央企|公办|三甲|银行正式|高校|专任教师", f"{occupation} {masked_block[:220]}"))

    income_wan, income_text = parse_income(kv, masked_block)
    housing_car, has_house, has_car = parse_housing_car(kv, masked_block)
    marital_status = parse_marital_status(kv, masked_block)

    # 要求提取
    req_text = kv.get("requirements", "")
    if not req_text:
        m_req = re.search(r"(?:择偶要求|择偶标准|希望另一半|理想对象|希望你|希望对方)\s*[:：]?\s*(.+)", masked_block, re.DOTALL)
        if m_req:
            req_text = m_req.group(1).split("\n\n")[0].strip()
    req_info = parse_partner_requirements(req_text, birth_year)

    # 自我介绍汇总
    intro_parts = []
    if school and school not in occupation:
        intro_parts.append(f"院校：{school}")
    for k in ("self_intro", "impression", "hobbies", "family", "style_tags"):
        if kv.get(k):
            intro_parts.append(kv[k])
    self_intro = "；".join(intro_parts) if intro_parts else masked_block[:180].replace("\n", " ")

    # 至少具备2项关键画像才视为有效相亲档案，避免误抓普通新闻段落
    valid_signals = sum(
        1
        for x in (birth_year, height_cm, edu_level > 0, req_text != "", marital_status != "未注明")
        if x
    )
    if valid_signals < 2:
        return None

    nickname = kv.get("nickname", "").strip()
    display_code = f"{header}·{nickname}" if nickname else header
    if school and len(school) <= 10 and school not in display_code:
        display_code = f"{display_code}({school})"
    if city != "未注明" and city not in display_code:
        display_code = f"{city}·{display_code}"

    # 唯一内容指纹（用于跨次采集幂等去重）
    dedup_seed = f"{source_url}|{header}|{gender}|{birth_year}|{height_cm}|{education}|{city}"
    fingerprint = hashlib.sha256(dedup_seed.encode("utf-8")).hexdigest()[:24]

    tags: List[str] = []
    if is_tizhi:
        tags.append("体制内/稳定岗")
    if has_house:
        tags.append("已购房")
    if has_car:
        tags.append("已购车")
    if edu_level >= 4:
        tags.append("硕博高学历")
    for kw in ("情绪稳定", "运动", "旅游", "下厨", "摄影", "阅读", "健身", "音乐", "不抽烟"):
        if kw in masked_block:
            tags.append(kw)

    return {
        "fingerprint": fingerprint,
        "code_name": display_code,
        "gender": gender,
        "birth_year": birth_year,
        "age": age,
        "height_cm": height_cm,
        "weight_kg": weight_kg,
        "education": education,
        "edu_level": edu_level,
        "city": city,
        "hometown": hometown,
        "occupation": occupation,
        "is_tizhi": 1 if is_tizhi else 0,
        "income_annual_wan": income_wan,
        "income_text": income_text,
        "housing_car": housing_car,
        "has_house": None if has_house is None else (1 if has_house else 0),
        "has_car": None if has_car is None else (1 if has_car else 0),
        "marital_status": marital_status,
        "self_intro": self_intro[:400],
        "tags": ",".join(dict.fromkeys(tags)),
        "req_raw": req_info["req_raw"][:300],
        "req_birth_min": req_info["req_birth_min"],
        "req_birth_max": req_info["req_birth_max"],
        "req_height_min": req_info["req_height_min"],
        "req_edu_min": req_info["req_edu_min"],
        "req_house": 1 if req_info["req_house"] else 0,
        "req_local": 1 if req_info["req_local"] else 0,
        "req_tizhi": 1 if req_info["req_tizhi"] else 0,
        "source_platform": source_platform,
        "source_title": source_title[:120],
        "source_url": source_url,
        "raw_masked": masked_block[:1200],
    }


def parse_document_to_profiles(
    raw_text: str,
    source_title: str = "",
    source_url: str = "",
    source_platform: str = "公开网页",
    override_city: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """解析整篇推文/网页或粘贴文本，返回所有识别出的相亲嘉宾记录。"""
    ctx_gender, ctx_city = infer_context_from_article(source_title, raw_text)
    if override_city and override_city.strip():
        ctx_city = override_city.strip()

    blocks = split_candidates(raw_text, title=source_title)
    results: List[Dict[str, Any]] = []
    for header, block in blocks:
        item = parse_candidate_block(
            header=header,
            block=block,
            context_gender=ctx_gender,
            context_city=ctx_city,
            source_platform=source_platform,
            source_url=source_url,
            source_title=source_title,
        )
        if item:
            results.append(item)
    return results
