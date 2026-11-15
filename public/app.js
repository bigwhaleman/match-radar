// 寻缘雷达 MatchRadar V2.0 — 支持 GitHub Pages 纯静态公开发布 + 本地容器双模自适应前端
import {
  DEFAULT_PROFILE,
  EDU_LABELS,
  buildClarvyExtractPrompt,
  computeStatistics,
  evaluateCandidate,
  parseSupplementTextOrJson,
} from "./engine.mjs";

const FOLLOW_LABELS = { new: "待筛选", interested: "重点关注", contacted: "已联系", archived: "暂不合适" };
const LS_KEYS = {
  profile: "mr_profile_v2",
  meta: "mr_cand_meta_v2",
  supplements: "mr_user_supplements_v2",
};

let isLocalBackend = false;
let repoSlug = "bigwhaleman/match-radar";
let rawPublicCandidates = [];
let publicSources = [];
let publicLogs = [];
let snapshotMeta = {};

let userProfile = loadJsonLS(LS_KEYS.profile, { ...DEFAULT_PROFILE });
let candMetaMap = loadJsonLS(LS_KEYS.meta, {}); // fingerprint -> { starred, follow_status, user_note }
let userSupplements = loadJsonLS(LS_KEYS.supplements, []);

let computedState = { candidates: [], stats: null };

let uiFilter = {
  tab: "match",
  mode: "compatible",
  city: "",
  follow: "",
  keyword: "",
  sort: "mutual_desc",
};

function loadJsonLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveJsonLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {}
}

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(msg, isError = false) {
  const el = document.getElementById("globalToast");
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? "toast error" : "toast";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 6500);
}

/* ==================== 数据加载与双模初始化 ==================== */
async function initData() {
  // 1) 优先探测是否存在同源本地后端 API
  try {
    const res = await fetch("./api/state", { headers: { Accept: "application/json" } });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && ct.includes("application/json")) {
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.candidates)) {
        isLocalBackend = true;
        rawPublicCandidates = data.candidates;
        publicSources = data.sources || [];
        publicLogs = data.logs || [];
        snapshotMeta = {
          latest_success_at: data.stats?.latest_success_at,
          generated_at: data.server_time,
        };
        recomputeAll();
        restoreUrlQueryState();
        return;
      }
    }
  } catch (_) {
    isLocalBackend = false;
  }

  // 2) GitHub Pages 纯静态模式：读取 ./data/snapshot.json
  try {
    const res = await fetch("./data/snapshot.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    isLocalBackend = false;
    snapshotMeta = snap.meta || {};
    if (snapshotMeta.repo_slug) repoSlug = snapshotMeta.repo_slug;
    rawPublicCandidates = snap.candidates || [];
    publicSources = snap.sources || [];
    publicLogs = snap.logs || [];
    recomputeAll();
    restoreUrlQueryState();
  } catch (err) {
    showToast("加载公开数据快照失败：" + err.message, true);
  }
}

function recomputeAll() {
  // 合并全站公共快照 + 当前浏览器用户补录记录（按 fingerprint 去重，用户补录可覆盖同名指纹）
  const map = new Map();
  for (const c of rawPublicCandidates) {
    map.set(c.fingerprint, { ...c, is_user_supplement: false });
  }
  for (const u of userSupplements) {
    map.set(u.fingerprint, { ...u, is_user_supplement: true });
  }

  const merged = [];
  let seq = 1;
  for (const item of map.values()) {
    const localM = candMetaMap[item.fingerprint] || {};
    const starred = localM.starred !== undefined ? localM.starred : (item.starred || 0);
    const follow_status = localM.follow_status || item.follow_status || "new";
    const user_note = localM.user_note !== undefined ? localM.user_note : (item.user_note || "");
    const cand = { ...item, _seq: seq++, starred, follow_status, user_note };
    cand.match = evaluateCandidate(cand, userProfile);
    merged.push(cand);
  }

  merged.sort((a, b) => {
    const gc = (b.match.gender_compatible ? 1 : 0) - (a.match.gender_compatible ? 1 : 0);
    if (gc !== 0) return gc;
    return b.match.mutual_score - a.match.mutual_score || b.match.forward_score - a.match.forward_score;
  });

  const stats = computeStatistics(merged, publicSources);
  computedState = { candidates: merged, stats };

  // 更新顶栏与角标
  const badge = document.getElementById("syncBadge");
  const lastOk = stats.latest_success_at || snapshotMeta.latest_success_at || "已就绪";
  badge.textContent = `公共库快照：${lastOk}`;

  document.getElementById("tabCountMatch").textContent = stats.mutual_high_count;
  document.getElementById("tabCountTotal").textContent = stats.total;
  document.getElementById("tabCountUserSup").textContent = userSupplements.length;
  document.getElementById("tabCountSources").textContent = publicSources.length;
  document.getElementById("userSupCountLabel").textContent = userSupplements.length;

  populateProfileForm(userProfile);
  populateCityOptions(merged);
  renderMatchKpis(stats, userProfile);
  renderCandidates();
  renderRetrievePanel();
  renderStatsPanel(stats);
  renderSchedulePanel(publicSources, publicLogs);
}

function switchTab(tab) {
  uiFilter.tab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${tab}`);
  });
}

function populateProfileForm(p) {
  const form = document.getElementById("profileForm");
  if (!form) return;
  for (const [k, v] of Object.entries(p)) {
    const field = form.elements.namedItem(k);
    if (field && document.activeElement !== field) field.value = v ?? "";
  }
  const gText = p.my_gender === "M" ? "男" : "女";
  const tgText = p.target_gender === "F" ? "女嘉宾" : p.target_gender === "M" ? "男嘉宾" : "不限性别";
  const cityPref = p.pref_city ? `意向 ${p.pref_city}` : "全国不限";
  document.getElementById("profileQuickSummary").textContent =
    `我的条件：${p.my_birth_year}年${gText} · ${p.my_height_cm}cm · ${EDU_LABELS[p.my_edu_level] || "本科"} · 现居${p.my_city || "未设"} ｜ 寻找：${tgText} (${p.pref_age_min}-${p.pref_age_max}岁, ${cityPref})`;
}

function populateCityOptions(candidates) {
  const sel = document.getElementById("cityFilterSelect");
  const prev = uiFilter.city;
  const map = new Map();
  for (const c of candidates) {
    const ct = c.city || "未注明";
    map.set(ct, (map.get(ct) || 0) + 1);
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  sel.innerHTML = `<option value="">全部城市 (${candidates.length})</option>` +
    entries.map(([ct, cnt]) => `<option value="${esc(ct)}">${esc(ct)} (${cnt})</option>`).join("");
  if (map.has(prev)) sel.value = prev;
}

function renderMatchKpis(stats, profile) {
  const strip = document.getElementById("matchKpiStrip");
  const tgLabel = profile.target_gender === "F" ? "女嘉宾" : profile.target_gender === "M" ? "男嘉宾" : "全部嘉宾";
  const compatCount = profile.target_gender === "F" ? stats.female_count : profile.target_gender === "M" ? stats.male_count : stats.total;
  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">当前可检索总档案</div>
      <div class="kpi-val">${stats.total} <small style="font-size:13px;font-weight:500;">人</small></div>
      <div class="kpi-foot">公共快照 ${rawPublicCandidates.length} 人 + 我的补录 ${userSupplements.length} 人</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">目标方向（${esc(tgLabel)}）池</div>
      <div class="kpi-val">${compatCount} <small style="font-size:13px;font-weight:500;">人</small></div>
      <div class="kpi-foot">合我心意(正向≥75) ${stats.forward_ok_count} 人</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">双向高匹配推荐 (≥80分)</div>
      <div class="kpi-val emerald">${stats.mutual_high_count} <small style="font-size:13px;font-weight:500;">人</small></div>
      <div class="kpi-foot">同时满足「合我意」且「我达TA门槛」</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">本地星标收藏</div>
      <div class="kpi-val accent">${stats.starred_count} <small style="font-size:13px;font-weight:500;">人</small></div>
      <div class="kpi-foot">数据检索全免费 · 私人收藏仅存本机</div>
    </div>
  `;
}

function getFilteredMatchCandidates() {
  let list = [...computedState.candidates];
  if (uiFilter.mode === "compatible") list = list.filter((c) => c.match.gender_compatible);
  else if (uiFilter.mode === "mutual_high") list = list.filter((c) => c.match.gender_compatible && c.match.match_tier === "双向高匹配");
  else if (uiFilter.mode === "forward_ok") list = list.filter((c) => c.match.gender_compatible && c.match.forward_score >= 75);
  else if (uiFilter.mode === "no_warning") list = list.filter((c) => c.match.gender_compatible && c.match.reverse_warnings.length === 0);
  else if (uiFilter.mode === "starred") list = list.filter((c) => c.starred === 1);

  if (uiFilter.city) list = list.filter((c) => (c.city || "未注明") === uiFilter.city);
  if (uiFilter.follow) list = list.filter((c) => (c.follow_status || "new") === uiFilter.follow);
  if (uiFilter.keyword.trim()) {
    const kw = uiFilter.keyword.trim().toLowerCase();
    list = list.filter((c) =>
      `${c.code_name} ${c.city} ${c.hometown} ${c.occupation} ${c.education} ${c.self_intro} ${c.req_raw} ${c.tags} ${c.user_note}`
        .toLowerCase()
        .includes(kw)
    );
  }

  if (uiFilter.sort === "mutual_desc") list.sort((a, b) => b.match.mutual_score - a.match.mutual_score || b._seq - a._seq);
  else if (uiFilter.sort === "forward_desc") list.sort((a, b) => b.match.forward_score - a.match.forward_score || b._seq - a._seq);
  else if (uiFilter.sort === "reverse_desc") list.sort((a, b) => b.match.reverse_score - a.match.reverse_score || b.match.forward_score - a.match.forward_score);
  else if (uiFilter.sort === "age_asc") list.sort((a, b) => (a.age ?? 99) - (b.age ?? 99));
  else if (uiFilter.sort === "newest") list.sort((a, b) => (b.is_user_supplement ? 1 : 0) - (a.is_user_supplement ? 1 : 0) || b._seq - a._seq);

  return list;
}

function tierClassInfo(tier) {
  if (tier === "双向高匹配") return { card: "tier-high", badge: "high" };
  if (tier === "正向心仪·留意对方门槛") return { card: "tier-warn", badge: "warn" };
  if (tier === "对方门槛友好") return { card: "", badge: "friendly" };
  return { card: "", badge: "normal" };
}

function buildCandidateCardHtml(c) {
  const m = c.match;
  const tc = tierClassInfo(m.match_tier);
  const gLabel = c.gender === "F" ? "女" : c.gender === "M" ? "男" : "未注";
  const ageStr = c.birth_year ? `${c.birth_year}年 (${c.age}岁)` : "年龄未注";
  const hStr = c.height_cm ? `${c.height_cm}cm` : "身高未注";
  const wStr = c.weight_kg ? ` · ${c.weight_kg}kg` : "";

  const revHtml = m.reverse_warnings.length === 0
    ? `<div class="reverse-box ok">✅ 反向核验通过：您的条件满足对方已列明的硬性要求</div>`
    : `<div class="reverse-box warn">⚠️ 反向门槛提示：${m.reverse_warnings.map(esc).join("；")}</div>`;

  const followOpts = Object.entries(FOLLOW_LABELS)
    .map(([k, lbl]) => `<option value="${k}" ${c.follow_status === k ? "selected" : ""}>${lbl}</option>`)
    .join("");

  const srcLink = c.source_url
    ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(c.source_platform)} ↗</a>`
    : `<span>${esc(c.source_platform)}</span>`;

  return `
    <article class="cand-card ${tc.card}" data-fp="${esc(c.fingerprint)}">
      <div class="cand-top">
        <div class="cand-title-row">
          <span class="gender-tag ${esc(c.gender)}">${gLabel}</span>
          <span class="cand-name">${esc(c.code_name)}</span>
          <span class="spec-chip">${esc(c.marital_status)}</span>
          ${c.is_user_supplement ? `<span class="user-sup-tag">补录数据</span>` : ""}
        </div>
        <div class="cand-actions">
          <select class="follow-select" data-fp="${esc(c.fingerprint)}" aria-label="跟进状态">${followOpts}</select>
          <button type="button" class="star-btn ${c.starred ? "starred" : ""}" data-fp="${esc(c.fingerprint)}" data-starred="${c.starred}">
            ${c.starred ? "★ 已藏" : "☆ 收藏"}
          </button>
        </div>
      </div>

      ${m.gender_compatible ? `
      <div class="score-box">
        <div class="score-row-main">
          <div><span style="font-size:12px;color:var(--muted);">双向综合指数</span> <span class="mutual-num">${m.mutual_score}</span></div>
          <span class="tier-badge ${tc.badge}">${esc(m.match_tier)}</span>
        </div>
        <div class="sub-bars">
          <div>
            <span>TA合我意：<strong>${m.forward_score}</strong></span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, m.forward_score)}%"></div></div>
          </div>
          <div>
            <span>我合TA要求：<strong>${m.reverse_score}</strong></span>
            <div class="bar-track"><div class="bar-fill ${m.reverse_score < 75 ? "amber" : ""}" style="width:${Math.min(100, m.reverse_score)}%"></div></div>
          </div>
        </div>
      </div>` : `<div class="score-box"><span class="tier-badge normal">同性样本（市场分布对照参考）</span></div>`}

      <div class="spec-pills">
        <span class="spec-chip">${esc(ageStr)}</span>
        <span class="spec-chip">${esc(hStr + wStr)}</span>
        <span class="spec-chip">${esc(c.education)}</span>
        <span class="spec-chip">现居 ${esc(c.city)}</span>
        ${c.hometown && c.hometown !== "未注明" ? `<span class="spec-chip">籍贯 ${esc(c.hometown)}</span>` : ""}
        ${c.occupation && c.occupation !== "未注明" ? `<span class="spec-chip">${esc(c.occupation)}</span>` : ""}
        ${c.income_text && c.income_text !== "未注明" ? `<span class="spec-chip">${esc(c.income_text)}</span>` : ""}
        ${c.housing_car && c.housing_car !== "未注明" ? `<span class="spec-chip">${esc(c.housing_car)}</span>` : ""}
      </div>

      ${m.gender_compatible ? revHtml : ""}

      <div class="cand-text-block">
        <strong>对方择偶要求：</strong>${esc(c.req_raw || "未列明硬性限制（以眼缘和相处合拍为主）")}
      </div>
      <div class="cand-text-block">
        <strong>个人简介/特点：</strong>${esc(c.self_intro || "暂无补充说明")}
      </div>

      ${c.user_note ? `<div class="cand-text-block" style="background:#f9f6ee;padding:5px 8px;border-radius:5px;"><strong>我的备注：</strong>${esc(c.user_note)}</div>` : ""}

      <details style="font-size:12px;color:var(--muted);">
        <summary style="cursor:pointer;">本地备注 / 查看已脱敏原文</summary>
        <div class="note-editor">
          <input type="text" class="note-input" data-fp="${esc(c.fingerprint)}" value="${esc(c.user_note)}" placeholder="仅保存在您本地浏览器的跟进备注…" />
          <button type="button" class="btn btn-outline btn-sm save-note-btn" data-fp="${esc(c.fingerprint)}">保存</button>
          ${c.is_user_supplement ? `<button type="button" class="btn btn-outline btn-sm del-sup-btn" data-fp="${esc(c.fingerprint)}" style="color:var(--accent);">移除补录</button>` : ""}
        </div>
        <pre style="white-space:pre-wrap;background:#f5f4f0;padding:8px;border-radius:6px;margin-top:6px;max-height:130px;overflow:auto;">${esc(c.raw_masked)}</pre>
      </details>

      <div class="cand-footer">
        <span>来源：${srcLink}</span>
        <span>入库：${esc((c.fetched_at || "").slice(0, 16))}</span>
      </div>
    </article>
  `;
}

function renderCandidates() {
  const list = getFilteredMatchCandidates();
  document.getElementById("candidateCountBar").innerHTML = `
    <span>当前筛选结果：<strong>${list.length}</strong> 位候选人</span>
    <span>想做多条件交叉布尔筛选或补录新链接？可切换至顶部「02 数据再检索」或「03 链接补录与AI提取」</span>
  `;
  const grid = document.getElementById("candidateGrid");
  if (!list.length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;padding:32px;"><h3>暂无符合当前过滤条件的档案</h3><p class="section-lead">可放宽筛选胶囊，或前往「03 链接补录与AI提取」添加您目标城市的相亲链接。</p></div>`;
    return;
  }
  grid.innerHTML = list.map(buildCandidateCardHtml).join("");
}

/* ==================== TAB 02: 多维数据再检索工作台 ==================== */
function getRetrieveCriteria() {
  const form = document.getElementById("retrieveForm");
  const fd = new FormData(form);
  return {
    r_gender: fd.get("r_gender") || "",
    r_age_min: fd.get("r_age_min") ? Number(fd.get("r_age_min")) : null,
    r_age_max: fd.get("r_age_max") ? Number(fd.get("r_age_max")) : null,
    r_h_min: fd.get("r_h_min") ? Number(fd.get("r_h_min")) : null,
    r_h_max: fd.get("r_h_max") ? Number(fd.get("r_h_max")) : null,
    r_edu_min: Number(fd.get("r_edu_min") || 0),
    r_cities: String(fd.get("r_cities") || "").trim(),
    r_tizhi: fd.get("r_tizhi") ?? "",
    r_house: fd.get("r_house") ?? "",
    r_marital: fd.get("r_marital") || "",
    r_pool: fd.get("r_pool") || "all",
    r_view: fd.get("r_view") || "table",
    r_inc: String(fd.get("r_inc") || "").trim(),
    r_exc: String(fd.get("r_exc") || "").trim(),
    r_zero_warn: form.elements.namedItem("r_zero_warn").checked,
  };
}

function executeReSearch() {
  const q = getRetrieveCriteria();
  let rows = [...computedState.candidates];

  if (q.r_pool === "user_only") rows = rows.filter((c) => c.is_user_supplement);
  else if (q.r_pool === "public_only") rows = rows.filter((c) => !c.is_user_supplement);
  else if (q.r_pool === "shuobo_only") rows = rows.filter((c) => (c.source_platform || "").includes("硕士博士俱乐部"));

  if (q.r_gender) rows = rows.filter((c) => c.gender === q.r_gender);
  if (q.r_age_min != null) rows = rows.filter((c) => c.age != null && c.age >= q.r_age_min);
  if (q.r_age_max != null) rows = rows.filter((c) => c.age != null && c.age <= q.r_age_max);
  if (q.r_h_min != null) rows = rows.filter((c) => c.height_cm != null && c.height_cm >= q.r_h_min);
  if (q.r_h_max != null) rows = rows.filter((c) => c.height_cm != null && c.height_cm <= q.r_h_max);
  if (q.r_edu_min > 0) rows = rows.filter((c) => (c.edu_level || 0) >= q.r_edu_min);

  if (q.r_cities) {
    const cityTokens = q.r_cities.split(/[\s,，、]+/).filter(Boolean);
    if (cityTokens.length) {
      rows = rows.filter((c) => cityTokens.some((tk) => (c.city || "").includes(tk) || (c.hometown || "").includes(tk)));
    }
  }

  if (q.r_tizhi === "1") rows = rows.filter((c) => c.is_tizhi === 1);
  else if (q.r_tizhi === "0") rows = rows.filter((c) => !c.is_tizhi);

  if (q.r_house === "1") rows = rows.filter((c) => c.has_house === 1);
  if (q.r_marital) rows = rows.filter((c) => (c.marital_status || "").includes(q.r_marital));

  if (q.r_inc) {
    const incWords = q.r_inc.split(/[\s,，、]+/).map((w) => w.toLowerCase()).filter(Boolean);
    rows = rows.filter((c) => {
      const hay = `${c.code_name} ${c.city} ${c.hometown} ${c.occupation} ${c.education} ${c.self_intro} ${c.req_raw} ${c.tags}`.toLowerCase();
      return incWords.every((w) => hay.includes(w));
    });
  }

  if (q.r_exc) {
    const excWords = q.r_exc.split(/[\s,，、]+/).map((w) => w.toLowerCase()).filter(Boolean);
    rows = rows.filter((c) => {
      const hay = `${c.code_name} ${c.city} ${c.occupation} ${c.self_intro} ${c.req_raw}`.toLowerCase();
      return !excWords.some((w) => hay.includes(w));
    });
  }

  if (q.r_zero_warn) {
    rows = rows.filter((c) => c.match.reverse_warnings.length === 0);
  }

  return { rows, criteria: q };
}

function renderRetrievePanel() {
  const { rows, criteria } = executeReSearch();
  const strip = document.getElementById("retrieveSummaryStrip");
  const fCnt = rows.filter((c) => c.gender === "F").length;
  const mCnt = rows.filter((c) => c.gender === "M").length;
  const shuoboCnt = rows.filter((c) => (c.edu_level || 0) >= 4).length;
  const heights = rows.map((c) => c.height_cm).filter(Boolean);
  const avgH = heights.length ? (heights.reduce((a, b) => a + b, 0) / heights.length).toFixed(1) + "cm" : "—";

  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">再检索命中档案</div>
      <div class="kpi-val emerald">${rows.length} <small style="font-size:13px;">人</small></div>
      <div class="kpi-foot">女 ${fCnt} 人 · 男 ${mCnt} 人</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">命中群体硕博人数</div>
      <div class="kpi-val">${shuoboCnt} <small style="font-size:13px;">人</small></div>
      <div class="kpi-foot">占命中样本 ${rows.length ? Math.round((shuoboCnt / rows.length) * 100) : 0}%</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">命中样本平均身高</div>
      <div class="kpi-val">${avgH}</div>
      <div class="kpi-foot">仅统计已注明身高样本 (${heights.length} 人)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">含用户补录记录</div>
      <div class="kpi-val accent">${rows.filter((c) => c.is_user_supplement).length} <small style="font-size:13px;">人</small></div>
      <div class="kpi-foot">可通过「链接补录」持续扩充检索池</div>
    </div>
  `;

  const container = document.getElementById("retrieveResultContainer");
  if (!rows.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:32px;"><h3>再检索命中 0 条记录</h3><p class="section-lead">请尝试放宽年龄/学历/关键词条件，或前往「03 链接补录与AI提取」补充新数据源。</p></div>`;
    return;
  }

  if (criteria.r_view === "cards") {
    container.innerHTML = `<div class="candidate-grid">${rows.map(buildCandidateCardHtml).join("")}</div>`;
    return;
  }

  // 高密度对比表格视图
  container.innerHTML = `
    <div class="card table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>代称/编号</th>
            <th>性别</th>
            <th>出生/年龄</th>
            <th>身高</th>
            <th>学历</th>
            <th>城市/籍贯</th>
            <th>职业/院校</th>
            <th>房车/婚况</th>
            <th>双向分</th>
            <th>对方择偶要求摘要</th>
            <th>来源溯源</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((c) => `
            <tr>
              <td>
                <strong>${esc(c.code_name)}</strong>
                ${c.is_user_supplement ? `<span class="user-sup-tag">补录</span>` : ""}
              </td>
              <td><span class="gender-tag ${esc(c.gender)}">${c.gender === "F" ? "女" : c.gender === "M" ? "男" : "未注"}</span></td>
              <td style="white-space:nowrap;">${c.birth_year ? `${c.birth_year} (${c.age}岁)` : "—"}</td>
              <td style="white-space:nowrap;">${c.height_cm ? `${c.height_cm}cm` : "—"}</td>
              <td style="white-space:nowrap;">${esc(c.education)}</td>
              <td>${esc(c.city)}${c.hometown && c.hometown !== "未注明" ? `<div style="font-size:11.5px;color:var(--muted);">籍贯:${esc(c.hometown)}</div>` : ""}</td>
              <td>${esc(c.occupation)}</td>
              <td style="font-size:12px;">${esc(c.housing_car)} · ${esc(c.marital_status)}</td>
              <td><strong>${c.match.gender_compatible ? c.match.mutual_score : "—"}</strong></td>
              <td style="max-width:260px;font-size:12px;">${esc((c.req_raw || "未设硬门槛").slice(0, 90))}</td>
              <td style="font-size:12px;white-space:nowrap;">
                ${c.source_url ? `<a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(c.source_platform)} ↗</a>` : esc(c.source_platform)}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildCsvDownload(rows, filename) {
  const header = [
    "编号/代称", "性别", "出生年", "年龄(2026)", "身高(cm)", "学历", "城市", "籍贯",
    "职业/院校", "体制内", "收入说明", "房车情况", "婚况",
    "双向综合分", "正向合意分", "反向达标分", "匹配分层",
    "反向条件提示", "对方择偶要求", "个人简介", "是否用户补录", "来源平台", "来源URL",
  ];
  const csvEsc = (v) => {
    const s = v == null ? "" : String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const lines = [header.map(csvEsc).join(",")];
  for (const r of rows) {
    const m = r.match;
    lines.push([
      r.code_name,
      r.gender === "F" ? "女" : r.gender === "M" ? "男" : "未注",
      r.birth_year || "",
      r.age || "",
      r.height_cm || "",
      r.education,
      r.city,
      r.hometown,
      r.occupation,
      r.is_tizhi ? "是" : "否",
      r.income_text,
      r.housing_car,
      r.marital_status,
      m.gender_compatible ? m.mutual_score : "",
      m.gender_compatible ? m.forward_score : "",
      m.gender_compatible ? m.reverse_score : "",
      m.match_tier,
      m.reverse_warnings.join("；"),
      r.req_raw,
      r.self_intro,
      r.is_user_supplement ? "是" : "否",
      r.source_platform,
      r.source_url,
    ].map(csvEsc).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ==================== SVG 图表渲染 ==================== */
function renderStatsPanel(stats) {
  const strip = document.getElementById("statsKpiStrip");
  const fh = stats.avg_female_height ? `${stats.avg_female_height}cm` : "—";
  const mh = stats.avg_male_height ? `${stats.avg_male_height}cm` : "—";
  const frh = stats.avg_female_req_height ? `${stats.avg_female_req_height}cm` : "—";
  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">样本性别结构</div>
      <div class="kpi-val">女 ${stats.female_count} : 男 ${stats.male_count}</div>
      <div class="kpi-foot">合并总计 ${stats.total} 份档案</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">女嘉宾平均身高</div>
      <div class="kpi-val">${fh}</div>
      <div class="kpi-foot">女嘉宾平均要求男方最低身高：<strong>${frh}</strong></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">男嘉宾平均身高</div>
      <div class="kpi-val">${mh}</div>
      <div class="kpi-foot">直观对照市场期望与真实供给分布</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">双向高匹配占比</div>
      <div class="kpi-val emerald">${stats.total ? Math.round((stats.mutual_high_count / stats.total) * 100) : 0}%</div>
      <div class="kpi-foot">共 ${stats.mutual_high_count} 人双向综合分 ≥ 80</div>
    </div>
  `;

  // 1) 年代柱状图
  const ageBox = document.getElementById("chartAgeCohort");
  const W = 520, H = 240, padL = 44, padR = 20, padT = 28, padB = 42;
  const maxAge = Math.max(4, ...stats.age_dist.map((d) => Math.max(d.female, d.male)));
  const gW = (W - padL - padR) / Math.max(1, stats.age_dist.length);
  const ageBars = stats.age_dist.map((d, i) => {
    const gx = padL + i * gW + gW * 0.18;
    const bw = Math.min(26, gW * 0.28);
    const fhPx = ((H - padT - padB) * d.female) / maxAge;
    const mhPx = ((H - padT - padB) * d.male) / maxAge;
    return `
      <rect x="${gx}" y="${H - padB - fhPx}" width="${bw}" height="${fhPx}" rx="3" fill="#c95b72" />
      <text x="${gx + bw / 2}" y="${H - padB - fhPx - 5}" text-anchor="middle" font-size="11" fill="#444">${d.female}</text>
      <rect x="${gx + bw + 5}" y="${H - padB - mhPx}" width="${bw}" height="${mhPx}" rx="3" fill="#356ca3" />
      <text x="${gx + bw + 5 + bw / 2}" y="${H - padB - mhPx - 5}" text-anchor="middle" font-size="11" fill="#444">${d.male}</text>
      <text x="${gx + bw + 2}" y="${H - padB + 18}" text-anchor="middle" font-size="12" fill="#333">${esc(d.label)}</text>
    `;
  }).join("");
  ageBox.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="年代分布"><line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#d5d0c5"/><rect x="${W - 150}" y="6" width="10" height="10" rx="2" fill="#c95b72"/><text x="${W - 135}" y="15" font-size="11.5" fill="#555">女嘉宾</text><rect x="${W - 82}" y="6" width="10" height="10" rx="2" fill="#356ca3"/><text x="${W - 67}" y="15" font-size="11.5" fill="#555">男嘉宾</text>${ageBars}</svg>`;

  // 2) 身高错配对照图
  const hBox = document.getElementById("chartHeightMismatch");
  const maxH = Math.max(4, ...stats.height_dist.map((d) => Math.max(d.female, d.male, d.female_req_min)));
  const hgW = (W - 40 - 16) / Math.max(1, stats.height_dist.length);
  const hEls = stats.height_dist.map((d, i) => {
    const gx = 40 + i * hgW + 8;
    const bw = Math.min(16, (hgW - 18) / 3);
    const hF = ((H - padT - padB) * d.female) / maxH;
    const hM = ((H - padT - padB) * d.male) / maxH;
    const hR = ((H - padT - padB) * d.female_req_min) / maxH;
    return `
      <rect x="${gx}" y="${H - padB - hF}" width="${bw}" height="${hF}" rx="2" fill="#d98a9c"/>
      <rect x="${gx + bw + 3}" y="${H - padB - hM}" width="${bw}" height="${hM}" rx="2" fill="#356ca3"/>
      <rect x="${gx + (bw + 3) * 2}" y="${H - padB - hR}" width="${bw}" height="${hR}" rx="2" fill="#d4831d"/>
      ${d.male > 0 ? `<text x="${gx + bw + 3 + bw / 2}" y="${H - padB - hM - 4}" text-anchor="middle" font-size="10" fill="#23598c">${d.male}</text>` : ""}
      ${d.female_req_min > 0 ? `<text x="${gx + (bw + 3) * 2 + bw / 2}" y="${H - padB - hR - 4}" text-anchor="middle" font-size="10" fill="#ad620e">${d.female_req_min}</text>` : ""}
      <text x="${gx + bw * 1.6}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="#333">${esc(d.label)}</text>
    `;
  }).join("");
  hBox.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="身高对照"><line x1="40" y1="${H - padB}" x2="${W - 16}" y2="${H - padB}" stroke="#d5d0c5"/><rect x="42" y="6" width="10" height="10" rx="2" fill="#d98a9c"/><text x="56" y="15" font-size="11" fill="#555">女实际身高</text><rect x="132" y="6" width="10" height="10" rx="2" fill="#356ca3"/><text x="146" y="15" font-size="11" fill="#555">男实际身高</text><rect x="222" y="6" width="10" height="10" rx="2" fill="#d4831d"/><text x="236" y="15" font-size="11" fill="#555">女方要求男方最低身高</text>${hEls}</svg>`;

  // 3) 学历分布
  const eduBox = document.getElementById("chartEducation");
  const maxEdu = Math.max(1, ...stats.edu_dist.map((d) => d.count));
  const rowH = Math.min(34, 195 / Math.max(1, stats.edu_dist.length));
  eduBox.innerHTML = `<svg viewBox="0 0 520 225" role="img" aria-label="学历层次">${stats.edu_dist.map((d, i) => {
    const y = 16 + i * rowH;
    const bw = (384 * d.count) / maxEdu;
    return `<text x="76" y="${y + 16}" text-anchor="end" font-size="12" fill="#333">${esc(d.label)}</text><rect x="86" y="${y + 4}" width="${Math.max(2, bw)}" height="16" rx="4" fill="#1c7656" opacity="0.85"/><text x="${93 + bw}" y="${y + 16}" font-size="12" fill="#222" font-weight="600">${d.count} 人</text>`;
  }).join("")}</svg>`;

  // 4) 门槛与城市
  const rcBox = document.getElementById("chartReqAndCity");
  const topR = stats.req_dist.slice(0, 6);
  const maxR = Math.max(1, ...topR.map((r) => r.count));
  const maxC = Math.max(1, ...stats.city_dist.map((c) => c.count));
  rcBox.innerHTML = `<svg viewBox="0 0 520 235" role="img" aria-label="择偶门槛与城市"><text x="8" y="14" font-size="12" font-weight="700" fill="#5d6673">高频择偶要求提及数</text><line x1="292" y1="6" x2="292" y2="225" stroke="#e4e1d8" stroke-dasharray="3,3"/><text x="305" y="14" font-size="12" font-weight="700" fill="#5d6673">样本城市分布</text>${topR.map((r, i) => {
    const y = 26 + i * 32;
    const bw = (155 * r.count) / maxR;
    return `<text x="8" y="${y + 12}" font-size="11.5" fill="#333">${esc(r.label)}</text><rect x="102" y="${y + 1}" width="${Math.max(2, bw)}" height="13" rx="3" fill="#b24536" opacity="0.85"/><text x="${106 + bw}" y="${y + 12}" font-size="11.5" fill="#333">${r.count}</text>`;
  }).join("")}${stats.city_dist.slice(0, 6).map((c, i) => {
    const y = 26 + i * 32;
    const bw = (115 * c.count) / maxC;
    return `<text x="305" y="${y + 12}" font-size="11.5" fill="#333">${esc(c.city)}</text><rect x="358" y="${y + 1}" width="${Math.max(2, bw)}" height="13" rx="3" fill="#23598c" opacity="0.82"/><text x="${363 + bw}" y="${y + 12}" font-size="11.5" fill="#333">${c.count}</text>`;
  }).join("")}</svg>`;
}

/* ==================== TAB 05: 定时搜集与合规日志 ==================== */
function renderSchedulePanel(sources, logs) {
  const banner = document.getElementById("runtimeModeBanner");
  const localBox = document.getElementById("localScheduleActions");
  if (isLocalBackend) {
    banner.innerHTML = `当前处于<strong>容器本地实时模式</strong>：后台常驻调度线程每 12 小时自动巡检公开源，您也可点击右侧按钮立即触发采集。`;
    localBox.classList.remove("hidden");
  } else {
    banner.innerHTML = `当前处于 <strong>GitHub Pages 公网静态模式</strong>：全站公共基准快照（<code>data/snapshot.json</code>）由仓库 <strong>GitHub Actions 工作流（每 12 小时定时巡检 + 手动补录链接触发）</strong>自动更新并重新部署；浏览器刷新读取最新公开快照，单源受阻时自动保留历史成功快照。`;
    localBox.classList.add("hidden");
  }

  const kindMap = { public_url: "公开专栏URL", web_search: "公开关键词检索", wechat_rss: "微信公众号RSS" };
  document.querySelector("#sourcesTable tbody").innerHTML = sources.map((s) => {
    const st = s.last_status || "never";
    const stText = st === "ok" ? "正常 (ok)" : st === "blocked" ? "反爬合规跳过 (blocked)" : st === "stale" ? "保留历史快照 (stale)" : "待运行";
    return `
      <tr>
        <td><strong>${esc(s.name)}</strong><div style="font-size:11.5px;color:var(--muted);word-break:break-all;">${esc(s.target)}</div></td>
        <td>${esc(kindMap[s.kind] || s.kind)}</td>
        <td>${esc(s.city_hint || "自动推断")}</td>
        <td><span class="badge-status ${esc(st === "stale" ? "blocked" : st)}">${stText}</span>${s.last_error ? `<div style="font-size:11.5px;color:var(--amber);margin-top:3px;">${esc(s.last_error)}</div>` : ""}</td>
        <td style="font-size:12px;"><div>尝试：${esc(s.last_attempt_at || "—")}</div><div>成功：${esc(s.last_success_at || "—")}</div></td>
        <td style="font-size:12px;"><div>识别：${s.items_extracted || 0} 人</div><div style="color:var(--muted);">SHA: ${esc(s.last_sha256 || "—")}</div></td>
      </tr>
    `;
  }).join("");

  document.querySelector("#logsTable tbody").innerHTML = logs.map((l) => `
    <tr>
      <td style="white-space:nowrap;">${esc(l.run_at)}</td>
      <td><strong>${esc(l.source_name)}</strong></td>
      <td>${esc(l.kind)}</td>
      <td><span class="badge-status ${esc(l.status)}">${esc(l.status)}</span></td>
      <td style="white-space:nowrap;">+${l.new_count || 0} / ↻${l.updated_count || 0}</td>
      <td>${esc(l.detail)}</td>
    </tr>
  `).join("");
}

/* ==================== URL 参数恢复与分享 ==================== */
function restoreUrlQueryState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab && ["match", "retrieve", "supplement", "stats", "schedule"].includes(tab)) {
    switchTab(tab);
  }
  const form = document.getElementById("retrieveForm");
  let hasRetrieveParam = false;
  for (const k of ["r_gender", "r_age_min", "r_age_max", "r_h_min", "r_h_max", "r_edu_min", "r_cities", "r_tizhi", "r_house", "r_marital", "r_pool", "r_view", "r_inc", "r_exc"]) {
    if (params.has(k) && form.elements.namedItem(k)) {
      form.elements.namedItem(k).value = params.get(k);
      hasRetrieveParam = true;
    }
  }
  if (params.get("r_zero_warn") === "1") {
    form.elements.namedItem("r_zero_warn").checked = true;
    hasRetrieveParam = true;
  }
  if (hasRetrieveParam) renderRetrievePanel();
}

/* ==================== 事件绑定 ==================== */
function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 导出 CSV
  document.getElementById("exportCsvTopBtn").addEventListener("click", () => {
    const rows = uiFilter.tab === "retrieve" ? executeReSearch().rows : getFilteredMatchCandidates();
    buildCsvDownload(rows, "match_radar_export.csv");
  });
  document.getElementById("exportRetrieveCsvBtn").addEventListener("click", () => {
    const { rows } = executeReSearch();
    buildCsvDownload(rows, "match_radar_research_export.csv");
  });

  // 个人画像保存与重置
  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = Object.fromEntries(fd.entries());
    for (const nk of ["my_birth_year", "my_height_cm", "my_edu_level", "my_has_house", "my_is_tizhi", "pref_age_min", "pref_age_max", "pref_height_min", "pref_height_max", "pref_edu_min", "pref_only_unmarried"]) {
      if (next[nk] !== "") next[nk] = Number(next[nk]);
    }
    next.my_income_wan = Number(next.my_income_wan || 0);
    userProfile = { ...DEFAULT_PROFILE, ...next };
    saveJsonLS(LS_KEYS.profile, userProfile);
    if (isLocalBackend) {
      try { await fetch("./api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(userProfile) }); } catch (_) {}
    }
    recomputeAll();
    showToast("个人画像已保存在当前浏览器，全部候选人双向匹配分已实时更新！");
  });

  document.getElementById("resetProfileBtn").addEventListener("click", () => {
    userProfile = { ...DEFAULT_PROFILE };
    saveJsonLS(LS_KEYS.profile, userProfile);
    recomputeAll();
    showToast("已恢复默认个人画像设置");
  });

  // Tab 1 筛选控件
  document.getElementById("modePills").addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    uiFilter.mode = btn.dataset.mode;
    document.querySelectorAll("#modePills .pill").forEach((p) => p.classList.toggle("active", p === btn));
    renderCandidates();
  });
  document.getElementById("cityFilterSelect").addEventListener("change", (e) => { uiFilter.city = e.target.value; renderCandidates(); });
  document.getElementById("followFilterSelect").addEventListener("change", (e) => { uiFilter.follow = e.target.value; renderCandidates(); });
  document.getElementById("keywordSearchInput").addEventListener("input", (e) => { uiFilter.keyword = e.target.value; renderCandidates(); });
  document.getElementById("sortSelect").addEventListener("change", (e) => { uiFilter.sort = e.target.value; renderCandidates(); });

  // 候选人卡片星标、备注、跟进状态委托（同时覆盖 Tab 1 和 Tab 2 卡片视图）
  document.querySelector("main").addEventListener("click", (e) => {
    const starBtn = e.target.closest(".star-btn");
    if (starBtn) {
      const fp = starBtn.dataset.fp;
      const cur = candMetaMap[fp] || {};
      cur.starred = Number(starBtn.dataset.starred) === 1 ? 0 : 1;
      candMetaMap[fp] = cur;
      saveJsonLS(LS_KEYS.meta, candMetaMap);
      recomputeAll();
      return;
    }
    const noteBtn = e.target.closest(".save-note-btn");
    if (noteBtn) {
      const fp = noteBtn.dataset.fp;
      const inp = document.querySelector(`.note-input[data-fp="${CSS.escape(fp)}"]`);
      const cur = candMetaMap[fp] || {};
      cur.user_note = inp ? inp.value : "";
      candMetaMap[fp] = cur;
      saveJsonLS(LS_KEYS.meta, candMetaMap);
      recomputeAll();
      showToast("本地跟进备注已保存");
      return;
    }
    const delSup = e.target.closest(".del-sup-btn");
    if (delSup) {
      const fp = delSup.dataset.fp;
      userSupplements = userSupplements.filter((u) => u.fingerprint !== fp);
      saveJsonLS(LS_KEYS.supplements, userSupplements);
      recomputeAll();
      showToast("已移除该条本地补录记录");
    }
  });

  document.querySelector("main").addEventListener("change", (e) => {
    const sel = e.target.closest(".follow-select");
    if (sel) {
      const fp = sel.dataset.fp;
      const cur = candMetaMap[fp] || {};
      cur.follow_status = sel.value;
      candMetaMap[fp] = cur;
      saveJsonLS(LS_KEYS.meta, candMetaMap);
      recomputeAll();
    }
  });

  // Tab 2 再检索事件
  const rForm = document.getElementById("retrieveForm");
  rForm.addEventListener("submit", (e) => { e.preventDefault(); renderRetrievePanel(); });
  rForm.addEventListener("change", () => renderRetrievePanel());
  rForm.addEventListener("input", () => renderRetrievePanel());
  document.getElementById("resetRetrieveBtn").addEventListener("click", () => {
    rForm.reset();
    history.replaceState(null, "", window.location.pathname + "?tab=retrieve");
    renderRetrievePanel();
  });
  document.getElementById("copyQueryUrlBtn").addEventListener("click", async () => {
    const fd = new FormData(rForm);
    const p = new URLSearchParams();
    p.set("tab", "retrieve");
    for (const [k, v] of fd.entries()) {
      if (v && v !== "0" && v !== "all") p.set(k, String(v));
    }
    if (rForm.elements.namedItem("r_zero_warn").checked) p.set("r_zero_warn", "1");
    const shareUrl = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
    history.replaceState(null, "", `?${p.toString()}`);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("已复制当前多维再检索分享链接！");
    } catch (_) {
      showToast("已更新地址栏检索参数，可直接复制浏览器地址栏链接分享！");
    }
  });

  // Tab 3 链接补录与从简Clarvy 模型提取联动
  function showClarvyHelperForUrls(reasonPrefix = "") {
    const urlsRaw = document.getElementById("suppUrlsInput").value.trim();
    if (!urlsRaw) {
      showToast("请先输入至少一条相亲信息文章链接", true);
      return;
    }
    const cityHint = document.getElementById("suppUrlCityInput").value.trim();
    const prompt = buildClarvyExtractPrompt(urlsRaw, cityHint);
    const box = document.getElementById("clarvyPromptBox");
    const out = document.getElementById("clarvyPromptOutput");
    out.value = prompt;
    box.classList.remove("hidden");
    navigator.clipboard?.writeText(prompt).catch(() => {});
    showToast((reasonPrefix ? reasonPrefix + " " : "") + "已生成并复制「从简Clarvy」AI提取指令（平台检索全免费，调用模型仅按实际消耗 Token 计费）！");
  }

  document.getElementById("genClarvyPromptBtn").addEventListener("click", () => showClarvyHelperForUrls());
  document.getElementById("copyPromptAgainBtn").addEventListener("click", async () => {
    const txt = document.getElementById("clarvyPromptOutput").value;
    try { await navigator.clipboard.writeText(txt); showToast("提取指令已复制到剪贴板！"); } catch (_) {}
  });

  document.getElementById("linkSupplementForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urls = document.getElementById("suppUrlsInput").value.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
    const cityHint = document.getElementById("suppUrlCityInput").value.trim();
    const titleHint = document.getElementById("suppUrlTitleInput").value.trim();
    if (!urls.length) return;

    const btn = document.getElementById("directFetchUrlBtn");
    btn.disabled = true;
    btn.textContent = "正在尝试直连抓取解析…";
    try {
      if (isLocalBackend) {
        let added = 0;
        let blockedAny = false;
        for (const u of urls.slice(0, 3)) {
          const r = await fetch("./api/candidates/extract-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: u, city_hint: cityHint, title_hint: titleHint }),
          }).then((x) => x.json());
          if (r.ok) {
            added += Number(r.parsed_count || 0);
            if (r.state?.candidates) rawPublicCandidates = r.state.candidates;
          } else {
            blockedAny = true;
          }
        }
        recomputeAll();
        if (added > 0 && !blockedAny) {
          showToast(`直连提取完成，成功识别入库 ${added} 位嘉宾！`);
        } else {
          showClarvyHelperForUrls("部分链接存在防爬或跨域验证墙，");
        }
        return;
      }

      // GitHub Pages 纯静态浏览器环境：尝试公开可读 CORS 源，若跨域拦截则自动弹出从简Clarvy 模型提取指令
      let totalParsed = 0;
      for (const u of urls.slice(0, 2)) {
        const resp = await fetch(u, { mode: "cors" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const items = parseSupplementTextOrJson(text, {
          city_hint: cityHint,
          source_title: titleHint || "公开链接直读补录",
          source_url: u,
          source_platform: "公开链接补录",
        });
        if (items.length) {
          mergeIntoUserSupplements(items);
          totalParsed += items.length;
        }
      }
      if (totalParsed > 0) {
        recomputeAll();
        showToast(`直连补录成功！新增/更新 ${totalParsed} 位嘉宾。`);
      } else {
        showClarvyHelperForUrls("该网页需要服务端或模型读取正文，");
      }
    } catch (_) {
      showClarvyHelperForUrls("目标站点限制浏览器跨域直抓（如微信公众号等），");
    } finally {
      btn.disabled = false;
      btn.textContent = "① 尝试在线直连抓取补录 (免 Token)";
    }
  });

  // 提交 GitHub Issue 众包补录
  document.getElementById("submitGithubIssueBtn").addEventListener("click", () => {
    const urlsRaw = document.getElementById("suppUrlsInput").value.trim();
    const cityHint = document.getElementById("suppUrlCityInput").value.trim();
    if (!urlsRaw) {
      showToast("请先填写需要提交共建补录的公开相亲文章链接", true);
      return;
    }
    const title = `[数据补录] ${cityHint ? cityHint + " · " : ""}公开相亲信息源补充`;
    const body = `### 待补录公开链接\n${urlsRaw}\n\n### 默认城市\n${cityHint || "自动识别"}\n\n> 说明：仅提交公开可访问的相亲/联谊专栏链接，入库时自动掩码脱敏私人联系方式。`;
    const issueUrl = `https://github.com/${repoSlug}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(issueUrl, "_blank", "noopener,noreferrer");
  });

  // 方式二：粘贴原文或模型 JSON 零 Token 即时补录
  document.getElementById("fillDemoTextBtn").addEventListener("click", () => {
    const form = document.getElementById("pasteImportForm");
    form.elements.namedItem("source_title").value = "方糖·硕士博士俱乐部格式补录测试";
    form.elements.namedItem("source_platform").value = "微信公众号粘贴补录";
    form.elements.namedItem("city_hint").value = "上海";
    document.getElementById("pasteRawTextarea").value = [
      "1",
      "昵称：清风徐来",
      "年龄：29",
      "学校：复旦大学",
      "专业：生物医学 硕士",
      "家乡：江苏苏州",
      "现居：上海徐汇",
      "关于我",
      "1997年生，女生，身高165cm，复旦硕士毕业后在上海三甲医院科研岗工作，未婚，性格温和理性，平时喜欢羽毛球、看展与烹饪，微信号 secret_wx888（系统会自动掩码脱敏）。",
      "希望你",
      "92-98年男生，身高174cm以上，硕士及以上学历或知名高校本科，在上海发展，情绪稳定、不抽烟。",
    ].join("\n");
    showToast("已填充「方糖·硕士博士俱乐部」排版样例，点击「解析脱敏并立即并入检索库」即可体验零 Token 本地补录！");
  });

  document.getElementById("pasteImportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const meta = Object.fromEntries(fd.entries());
    const items = parseSupplementTextOrJson(meta.raw_text, meta);
    if (!items.length) {
      showToast("未识别出有效的结构化嘉宾卡片（请确认包含年龄/出生年、身高、学历或择偶要求，或粘贴合法 JSON 数组）", true);
      return;
    }
    mergeIntoUserSupplements(items);
    if (isLocalBackend) {
      try {
        await fetch("./api/candidates/import-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(meta),
        });
      } catch (_) {}
    }
    e.target.reset();
    recomputeAll();
    showToast(`补录成功！已解析并脱敏入库 ${items.length} 位嘉宾，现可在「智能双向匹配」与「数据再检索」中直接筛选！`);
  });

  // 补录包导出 / 导入 / 清空
  document.getElementById("exportUserSupJsonBtn").addEventListener("click", () => {
    if (!userSupplements.length) {
      showToast("当前还没有本地补录数据可导出", true);
      return;
    }
    const blob = new Blob([JSON.stringify(userSupplements, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "match_radar_supplements.json";
    a.click();
  });

  document.getElementById("importUserSupFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const items = parseSupplementTextOrJson(txt, { source_platform: "JSON数据包导入" });
      if (!items.length) throw new Error("未识别到有效嘉宾条目");
      mergeIntoUserSupplements(items);
      recomputeAll();
      showToast(`成功导入 ${items.length} 条补录档案！`);
    } catch (err) {
      showToast("导入 JSON 失败：" + err.message, true);
    } finally {
      e.target.value = "";
    }
  });

  document.getElementById("clearUserSupBtn").addEventListener("click", () => {
    userSupplements = [];
    saveJsonLS(LS_KEYS.supplements, userSupplements);
    recomputeAll();
    showToast("已清空本地补录数据（公共基准库不受影响）");
  });

  // 本地容器触发采集
  const runBtn = document.getElementById("runAllSourcesBtn");
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      if (!isLocalBackend) return;
      const r = await fetch("./api/sources/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_all" }),
      }).then((x) => x.json());
      showToast(r.message || r.error || "已触发后台采集任务");
    });
  }
}

function mergeIntoUserSupplements(items) {
  const byFp = new Map(userSupplements.map((x) => [x.fingerprint, x]));
  for (const it of items) {
    byFp.set(it.fingerprint, { ...it, is_user_supplement: true });
  }
  userSupplements = [...byFp.values()];
  saveJsonLS(LS_KEYS.supplements, userSupplements);
}

bindEvents();
initData();
