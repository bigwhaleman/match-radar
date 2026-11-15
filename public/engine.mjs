// 寻缘雷达 MatchRadar 公开版纯前端计算、再检索与多格式解析脱敏引擎 (ES Module)
// 同时驱动 GitHub Pages 纯静态站点与本地容器预览，零后端依赖即可完成全部匹配、再检索、脱敏解析与统计

export const CURRENT_YEAR = 2026;
export const EDU_LABELS = { 0: "不限", 1: "高中及以下", 2: "大专", 3: "本科", 4: "硕士", 5: "博士" };

export const DEFAULT_PROFILE = {
  my_gender: "M",
  my_birth_year: 1995,
  my_height_cm: 176,
  my_edu_level: 3,
  my_city: "杭州",
  my_income_wan: 22.0,
  my_has_house: 1,
  my_has_car: 1,
  my_is_tizhi: 0,
  my_marital: "未婚",
  target_gender: "F",
  pref_age_min: 24,
  pref_age_max: 33,
  pref_height_min: 158,
  pref_height_max: 175,
  pref_edu_min: 3,
  pref_city: "",
  pref_only_unmarried: 1,
  pref_require_house: 0,
  pref_keywords: "温柔,运动,旅游,教师,稳定",
};

const COMMON_CITIES = [
  "北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "无锡", "常州", "南通", "盐城", "泰州", "徐州", "扬州",
  "成都", "重庆", "武汉", "西安", "长沙", "郑州", "青岛", "济南", "宁波", "温州", "嘉兴", "湖州", "绍兴", "金华", "衢州",
  "合肥", "福州", "厦门", "泉州", "南昌", "新余", "赣州", "九江", "沈阳", "大连", "哈尔滨", "长春", "石家庄", "太原",
  "昆明", "贵阳", "南宁", "海口", "兰州", "银川", "西宁", "乌鲁木齐", "呼和浩特", "天津", "珠海", "佛山", "东莞", "中山",
  "惠州", "濮阳", "洛阳", "新乡", "南阳", "烟台", "潍坊", "临沂", "淄博", "威海", "保定", "唐山", "芜湖", "绵阳", "宜昌",
  "平湖", "宜春", "樟树", "内江", "连云港", "安阳", "信阳",
];

/* ==================== 1. 隐私联系方式自动脱敏 ==================== */
export function maskSensitiveText(text) {
  if (!text) return "";
  let out = String(text);
  out = out.replace(/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, "[身份证已脱敏]");
  out = out.replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, "$1****$2");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]");
  out = out.replace(/((?:微信号?|VX|vx|WeChat)\s*[:：是为]?\s*)([A-Za-z][A-Za-z0-9_-]{5,19})/g, "$1[微信号已脱敏]");
  out = out.replace(/((?:QQ|qq|扣扣)\s*[:：是为]?\s*)(\d{5,12})/g, "$1[QQ已脱敏]");
  return out;
}

/* ==================== 2. 双向择偶匹配计算核心 ==================== */
export function evaluateCandidate(candidate, profileInput) {
  const p = { ...DEFAULT_PROFILE, ...(profileInput || {}) };
  const targetG = String(p.target_gender || "").toUpperCase();
  const candG = String(candidate.gender || "U").toUpperCase();

  if ((targetG === "M" || targetG === "F") && (candG === "M" || candG === "F") && candG !== targetG) {
    return {
      gender_compatible: false,
      forward_score: 0,
      reverse_score: 0,
      mutual_score: 0,
      match_tier: "性别不匹配",
      forward_notes: ["性别与筛选方向不一致"],
      reverse_warnings: [],
      hard_pass: false,
    };
  }

  const forwardNotes = [];
  let hardPass = true;

  // 1) 年龄 (25)
  const age = candidate.age;
  const amin = Number(p.pref_age_min || 18);
  const amax = Number(p.pref_age_max || 60);
  let sAge = 16;
  if (age == null) {
    forwardNotes.push("年龄未注明（中性计分）");
  } else if (age >= amin && age <= amax) {
    sAge = 25;
    forwardNotes.push(`年龄 ${age}岁 符合期望(${amin}-${amax}岁)`);
  } else {
    const diff = age < amin ? amin - age : age - amax;
    sAge = Math.max(0, 25 - diff * 4.5);
    if (diff > 3) hardPass = false;
    forwardNotes.push(`年龄 ${age}岁 偏离期望 ${diff}岁`);
  }

  // 2) 身高 (20)
  const h = candidate.height_cm;
  const hmin = Number(p.pref_height_min || 145);
  const hmax = Number(p.pref_height_max || 205);
  let sHeight = 13;
  if (h == null) {
    forwardNotes.push("身高未注明");
  } else if (h >= hmin && h <= hmax) {
    sHeight = 20;
    forwardNotes.push(`身高 ${h}cm 符合期望`);
  } else {
    const diffH = h < hmin ? hmin - h : h - hmax;
    sHeight = Math.max(0, 20 - diffH * 3);
    if (diffH >= 5) hardPass = false;
    forwardNotes.push(`身高 ${h}cm 偏离期望 ${diffH}cm`);
  }

  // 3) 学历 (20)
  const eduLvl = Number(candidate.edu_level || 0);
  const prefEdu = Number(p.pref_edu_min || 0);
  let sEdu = 12;
  if (prefEdu <= 0) {
    sEdu = 20;
  } else if (eduLvl === 0) {
    sEdu = 12;
  } else if (eduLvl >= prefEdu) {
    sEdu = Math.min(20, 18 + Math.min(2, eduLvl - prefEdu));
    forwardNotes.push(`学历 ${candidate.education} 达标`);
  } else {
    sEdu = Math.max(2, 18 - (prefEdu - eduLvl) * 8);
    hardPass = false;
    forwardNotes.push(`学历 ${candidate.education} 低于期望`);
  }

  // 4) 城市 (20)
  const prefCity = String(p.pref_city || "").trim();
  const candCity = String(candidate.city || "未注明").trim();
  let sCity = 18;
  if (prefCity) {
    if (prefCity.includes(candCity) || candCity.includes(prefCity)) {
      sCity = 20;
      forwardNotes.push(`同城匹配(${candCity})`);
    } else if (candCity === "未注明") {
      sCity = 10;
    } else {
      sCity = 6;
      hardPass = false;
      forwardNotes.push(`异地：${candCity}`);
    }
  }

  // 5) 婚况与偏好词 (15)
  let sExtra = 10;
  const marital = candidate.marital_status || "未注明";
  if (Number(p.pref_only_unmarried || 0) === 1 && marital !== "未婚" && marital !== "未注明") {
    sExtra -= 8;
    hardPass = false;
    forwardNotes.push(`婚况为 ${marital}`);
  }
  if (Number(p.pref_require_house || 0) === 1) {
    sExtra += candidate.has_house === 1 ? 3 : -5;
  }
  const kws = String(p.pref_keywords || "")
    .replace(/[，、\s]+/g, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const blob = `${candidate.occupation || ""} ${candidate.self_intro || ""} ${candidate.tags || ""}`;
  const hitKws = kws.filter((k) => blob.includes(k));
  if (hitKws.length > 0) {
    sExtra = Math.min(15, sExtra + Math.min(5, hitKws.length * 2));
    forwardNotes.push(`命中偏好：${hitKws.slice(0, 3).join("/")}`);
  }
  sExtra = Math.max(0, Math.min(15, sExtra));

  const forwardScore = Math.round(Math.min(100, sAge + sHeight + sEdu + sCity + sExtra) * 10) / 10;

  // 反向核验
  const reverseWarnings = [];
  const reqRaw = String(candidate.req_raw || "").trim();
  let reverseScore = 88;
  if (reqRaw) {
    let r = 100;
    const myBy = Number(p.my_birth_year || 1995);
    const myH = Number(p.my_height_cm || 175);
    const myEdu = Number(p.my_edu_level || 3);
    const myCity = String(p.my_city || "").trim();
    const myHouse = Number(p.my_has_house || 0);
    const myTizhi = Number(p.my_is_tizhi || 0);
    const myMarital = String(p.my_marital || "未婚");

    if (candidate.req_birth_min && myBy < Number(candidate.req_birth_min)) {
      const d = Number(candidate.req_birth_min) - myBy;
      r -= Math.min(30, 10 + d * 5);
      reverseWarnings.push(`对方倾向 ${candidate.req_birth_min}年及以后出生（您为 ${myBy}年）`);
    }
    if (candidate.req_birth_max && myBy > Number(candidate.req_birth_max)) {
      const d = myBy - Number(candidate.req_birth_max);
      r -= Math.min(25, 8 + d * 4);
      reverseWarnings.push(`对方倾向 ${candidate.req_birth_max}年及以前出生（您为 ${myBy}年）`);
    }
    if (candidate.req_height_min && myH < Number(candidate.req_height_min)) {
      const d = Number(candidate.req_height_min) - myH;
      r -= Math.min(35, 8 + d * 5);
      reverseWarnings.push(`对方要求身高 ≥${candidate.req_height_min}cm（您为 ${myH}cm，差 ${d}cm）`);
    }
    if (Number(candidate.req_edu_min || 0) > 0 && myEdu < Number(candidate.req_edu_min)) {
      r -= 24;
      reverseWarnings.push(`对方要求学历 ${EDU_LABELS[candidate.req_edu_min] || ""}及以上`);
    }
    if (Number(candidate.req_house || 0) === 1 && myHouse === 0) {
      r -= 20;
      reverseWarnings.push("对方要求有房/婚房（您当前设为未购房）");
    }
    if (Number(candidate.req_tizhi || 0) === 1 && myTizhi === 0) {
      r -= 18;
      reverseWarnings.push("对方倾向体制内/在编岗位");
    }
    if (Number(candidate.req_local || 0) === 1 && myCity && candCity !== "未注明") {
      if (!myCity.includes(candCity) && !candCity.includes(myCity)) {
        r -= 22;
        reverseWarnings.push(`对方要求 ${candCity} 本地/定居（您当前在 ${myCity}）`);
      }
    }
    if (reqRaw.includes("未婚") && myMarital !== "未婚") {
      r -= 25;
      reverseWarnings.push("对方要求未婚");
    }
    reverseScore = Math.round(Math.max(0, Math.min(100, r)) * 10) / 10;
  }

  const mutualScore = Math.round((0.55 * forwardScore + 0.45 * reverseScore) * 10) / 10;
  let tier = "一般候选";
  if (forwardScore >= 76 && reverseScore >= 78 && mutualScore >= 80) tier = "双向高匹配";
  else if (forwardScore >= 75 && reverseScore < 75) tier = "正向心仪·留意对方门槛";
  else if (reverseScore >= 85 && forwardScore >= 62) tier = "对方门槛友好";

  return {
    gender_compatible: true,
    forward_score: forwardScore,
    reverse_score: reverseScore,
    mutual_score: mutualScore,
    match_tier: tier,
    forward_notes: forwardNotes,
    reverse_warnings: reverseWarnings,
    hard_pass: hardPass && reverseWarnings.length === 0,
  };
}

/* ==================== 3. 统计看板聚合计算 ==================== */
export function computeStatistics(scored, sources = []) {
  const fList = scored.filter((c) => c.gender === "F");
  const mList = scored.filter((c) => c.gender === "M");
  const mutualHigh = scored.filter((c) => c.match.gender_compatible && c.match.match_tier === "双向高匹配");
  const forwardOk = scored.filter((c) => c.match.gender_compatible && c.match.forward_score >= 75);
  const starred = scored.filter((c) => c.starred === 1);

  const cohorts = [
    ["85-89年", 1985, 1989],
    ["90-94年", 1990, 1994],
    ["95-99年", 1995, 1999],
    ["00后", 2000, 2008],
  ];
  const covered = new Set();
  const age_dist = cohorts.map(([label, y1, y2]) => {
    const fc = fList.filter((c) => c.birth_year >= y1 && c.birth_year <= y2).length;
    const mc = mList.filter((c) => c.birth_year >= y1 && c.birth_year <= y2).length;
    scored.forEach((c) => {
      if (c.birth_year >= y1 && c.birth_year <= y2) covered.add(c.fingerprint);
    });
    return { label, female: fc, male: mc, total: fc + mc };
  });
  const otherF = fList.filter((c) => !covered.has(c.fingerprint)).length;
  const otherM = mList.filter((c) => !covered.has(c.fingerprint)).length;
  if (otherF + otherM > 0) {
    age_dist.push({ label: "其他/未注", female: otherF, male: otherM, total: otherF + otherM });
  }

  const eduOrder = ["博士", "硕士", "本科", "大专", "高中及以下", "未注明"];
  const edu_dist = eduOrder
    .map((ed) => ({ label: ed, count: scored.filter((c) => (c.education || "未注明") === ed).length }))
    .filter((d) => d.count > 0 || ["硕士", "本科", "大专"].includes(d.label));

  const fHeights = fList.map((c) => c.height_cm).filter(Boolean);
  const mHeights = mList.map((c) => c.height_cm).filter(Boolean);
  const fReqH = fList.map((c) => c.req_height_min).filter(Boolean);
  const mReqH = mList.map((c) => c.req_height_min).filter(Boolean);

  const hBuckets = [
    ["<160cm", 0, 159],
    ["160-164", 160, 164],
    ["165-169", 165, 169],
    ["170-174", 170, 174],
    ["175-179", 175, 179],
    ["180cm+", 180, 230],
  ];
  const height_dist = hBuckets.map(([label, lo, hi]) => ({
    label,
    female: fHeights.filter((h) => h >= lo && h <= hi).length,
    male: mHeights.filter((h) => h >= lo && h <= hi).length,
    female_req_min: fReqH.filter((h) => h >= lo && h <= hi).length,
  }));

  const cityMap = new Map();
  scored.forEach((c) => {
    const ct = c.city || "未注明";
    cityMap.set(ct, (cityMap.get(ct) || 0) + 1);
  });
  const city_dist = [...cityMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([city, count]) => ({ city, count }));

  const reqFactors = [
    ["身高硬门槛", (c) => Boolean(c.req_height_min)],
    ["年龄段限定", (c) => Boolean(c.req_birth_min || c.req_birth_max)],
    ["要求有房/住房", (c) => c.req_house === 1],
    ["同城/本地优先", (c) => c.req_local === 1],
    ["工作/收入稳定", (c) => (c.req_raw || "").includes("稳定")],
    ["情绪稳定/脾气好", (c) => ["情绪稳定", "脾气好", "性格好", "温和"].some((w) => (c.req_raw || "").includes(w))],
    ["人品/三观合拍", (c) => ["人品", "三观", "责任", "孝顺"].some((w) => (c.req_raw || "").includes(w))],
    ["倾向体制内/编制", (c) => c.req_tizhi === 1],
  ];
  const req_dist = reqFactors
    .map(([label, fn]) => ({ label, count: scored.filter(fn).length }))
    .sort((a, b) => b.count - a.count);

  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
  const okSrcs = sources.filter((s) => s.last_status === "ok");
  const blockedSrcs = sources.filter((s) => s.last_status === "blocked" || s.last_status === "stale");
  const latestSuccess = okSrcs.map((s) => s.last_success_at).filter(Boolean).sort().pop() || null;

  return {
    total: scored.length,
    female_count: fList.length,
    male_count: mList.length,
    mutual_high_count: mutualHigh.length,
    forward_ok_count: forwardOk.length,
    starred_count: starred.length,
    avg_female_height: avg(fHeights),
    avg_male_height: avg(mHeights),
    avg_female_req_height: avg(fReqH),
    avg_male_req_height: avg(mReqH),
    age_dist,
    edu_dist,
    height_dist,
    city_dist,
    req_dist,
    ok_source_count: okSrcs.length,
    blocked_source_count: blockedSrcs.length,
    latest_success_at: latestSuccess,
  };
}

/* ==================== 4. 浏览器端多格式解析与 JSON 补录引擎 ==================== */
const KNOWN_KEYS = {
  编号: "serial", 昵称: "nickname", 代号: "nickname", 性别: "gender",
  籍贯: "hometown", 户籍: "hometown", 家乡: "hometown",
  目前所在地: "city", 所在地: "city", 定居: "city", 现居: "city", 常居地: "city", 坐标: "city", 工作地: "city",
  出生年份: "birth", 出生年: "birth", 出生: "birth", 年龄: "birth", 年纪: "birth", 生日: "birth",
  身高: "height", 体重: "weight",
  学校: "school", 毕业院校: "school", 最高学历: "education", 学历: "education", 专业: "education", 所学专业: "education",
  目前职业: "occupation", 职业: "occupation", 工作: "occupation", 从事: "occupation",
  年薪: "income_annual", 年入: "income_annual", 年收入: "income_annual",
  月均收入: "income_monthly", 月薪: "income_monthly", 月入: "income_monthly", 收入: "income_any",
  车房情况: "housing_car", 我个人车房情况: "housing_car", 房车状况: "housing_car", 房车: "housing_car",
  婚姻状况: "marital", 婚姻: "marital", 阶段: "marital",
  爱好: "hobbies", 兴趣爱好: "hobbies", 红娘印象: "impression",
  嘉宾自述: "self_intro", 自我介绍: "self_intro", 个人介绍: "self_intro", 个人简介: "self_intro", 关于我: "self_intro",
  家庭情况: "family", 类型: "style_tags",
  择偶要求: "requirements", 择偶标准: "requirements", 希望另一半: "requirements", 理想对象: "requirements",
  希望你: "requirements", 希望对方: "requirements", 对你的要求: "requirements", 要求: "requirements",
};

function simpleHash(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function normYear(y) {
  if (y >= 1950 && y <= 2008) return y;
  if (y >= 50 && y <= 99) return 1900 + y;
  if (y >= 0 && y <= 8) return 2000 + y;
  return null;
}

function parseEdu(text) {
  if (/博士|Ph\.?D/i.test(text)) return ["博士", 5];
  if (/硕士|研究生|MBA|MPA|法硕|专硕/.test(text)) return ["硕士", 4];
  if (/本科|学士|全日制本|专升本|进修本科|985|211|双一流/.test(text)) return ["本科", 3];
  if (/大专|专科|高职/.test(text)) return ["大专", 2];
  if (/高中|中专|初中/.test(text)) return ["高中及以下", 1];
  return ["未注明", 0];
}

function parseReqs(reqText, candBirthYear) {
  const res = {
    req_raw: (reqText || "").trim().slice(0, 300),
    req_birth_min: null,
    req_birth_max: null,
    req_height_min: null,
    req_edu_min: 0,
    req_house: 0,
    req_local: 0,
    req_tizhi: 0,
  };
  if (!reqText) return res;
  const mRange = reqText.match(/(?<!\d)(19[7-9]\d|200\d|[789]\d|0[0-5])\s*[-~至到]\s*(19[7-9]\d|200\d|[789]\d|0[0-5])/);
  if (mRange) {
    const y1 = normYear(Number(mRange[1]));
    const y2 = normYear(Number(mRange[2]));
    if (y1 && y2) {
      res.req_birth_min = Math.min(y1, y2);
      res.req_birth_max = Math.max(y1, y2);
    }
  } else {
    const mAfter = reqText.match(/(?<!\d)(19[7-9]\d|[789]\d)\s*(?:年\s*及?\s*以后|以后|后)/);
    if (mAfter) {
      const y = normYear(Number(mAfter[1]));
      if (y) res.req_birth_min = y;
    } else if (candBirthYear) {
      const mOlder = reqText.match(/大\s*([1-5一二三四五])\s*岁\s*以内/);
      if (mOlder) {
        const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
        const d = map[mOlder[1]] || Number(mOlder[1]) || 3;
        res.req_birth_min = candBirthYear - d;
      }
    }
  }
  const mH = reqText.match(/(?:身高\s*)?(1[5-9]\d)\s*(?:cm)?\s*(?:及以上|以上|\+|➕)/i);
  if (mH) res.req_height_min = Number(mH[1]);
  else {
    const mAround = reqText.match(/身高\s*(1[5-9]\d)\s*左右/);
    if (mAround) res.req_height_min = Number(mAround[1]) - 2;
  }
  if (/硕士|硕博|研究生/.test(reqText)) res.req_edu_min = 4;
  else if (/本科|全日制本|985|211/.test(reqText)) res.req_edu_min = 3;
  else if (/大专|专科/.test(reqText)) res.req_edu_min = 2;
  if (/有房|有婚房|有住房|独立住房/.test(reqText) && !/房车不限|无硬性要求/.test(reqText)) res.req_house = 1;
  if (/本地|定居|同城/.test(reqText)) res.req_local = 1;
  if (/体制内|在编|公务员|事业编/.test(reqText) && !/非体制也接受|单位类型不限|或者企业/.test(reqText)) res.req_tizhi = 1;
  return res;
}

export function parseSupplementTextOrJson(rawInput, meta = {}) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) return [];

  // 支持直接粘贴从简Clarvy模型输出的 JSON 代码块或 JSON 数组
  const jsonFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const maybeJson = jsonFence ? jsonFence[1].trim() : trimmed;
  if (maybeJson.startsWith("[") || maybeJson.startsWith("{")) {
    try {
      const parsed = JSON.parse(maybeJson);
      const arr = Array.isArray(parsed) ? parsed : (parsed.candidates || [parsed]);
      return arr
        .filter((it) => it && typeof it === "object")
        .map((it, idx) => normalizeJsonCandidate(it, idx, meta))
        .filter(Boolean);
    } catch (_) {
      // 非合法 JSON 则继续走中文多格式自然文本解析
    }
  }

  return parseChineseDocumentClient(trimmed, meta);
}

function normalizeJsonCandidate(it, idx, meta) {
  const by = it.birth_year ? normYear(Number(it.birth_year)) : null;
  const age = by ? CURRENT_YEAR - by : (it.age ? Number(it.age) : null);
  const [eduStr, eduLvl] = parseEdu(String(it.education || ""));
  const reqInfo = parseReqs(String(it.req_raw || it.requirements || ""), by);
  const city = String(it.city || meta.city_hint || "未注明").trim();
  const genderRaw = String(it.gender || "U").toUpperCase();
  const gender = genderRaw === "女" ? "F" : genderRaw === "男" ? "M" : (["F", "M"].includes(genderRaw) ? genderRaw : "U");
  const code = String(it.code_name || it.nickname || `补录嘉宾${idx + 1}`);
  const displayCode = city !== "未注明" && !code.includes(city) ? `${city}·${code}` : code;
  const srcUrl = String(it.source_url || meta.source_url || "");
  const fp = it.fingerprint || `usr_${simpleHash(`${srcUrl}|${displayCode}|${gender}|${by}|${it.height_cm}`)}`;

  return {
    fingerprint: fp,
    code_name: displayCode,
    gender,
    birth_year: by,
    age,
    height_cm: it.height_cm ? Number(it.height_cm) : null,
    weight_kg: it.weight_kg ? Number(it.weight_kg) : null,
    education: eduStr,
    edu_level: eduLvl,
    city,
    hometown: maskSensitiveText(it.hometown || "未注明"),
    occupation: maskSensitiveText(it.occupation || "未注明"),
    is_tizhi: /公务员|事业编|在编|国企|央企|公办|三甲|高校/.test(String(it.occupation || "")) ? 1 : 0,
    income_annual_wan: it.income_annual_wan ? Number(it.income_annual_wan) : null,
    income_text: maskSensitiveText(it.income_text || "未注明"),
    housing_car: maskSensitiveText(it.housing_car || "未注明"),
    has_house: /有房|购房/.test(String(it.housing_car || "")) && !/无房/.test(String(it.housing_car || "")) ? 1 : null,
    has_car: /有车|购车/.test(String(it.housing_car || "")) && !/无车/.test(String(it.housing_car || "")) ? 1 : null,
    marital_status: it.marital_status || "未婚",
    self_intro: maskSensitiveText(it.self_intro || "").slice(0, 400),
    tags: maskSensitiveText(it.tags || "用户补录"),
    ...reqInfo,
    source_platform: meta.source_platform || it.source_platform || "链接/模型补录",
    source_title: meta.source_title || it.source_title || "用户补录数据",
    source_url: srcUrl,
    raw_masked: maskSensitiveText(it.raw_masked || JSON.stringify(it)),
    fetched_at: new Date().toISOString().slice(0, 16).replace("T", " "),
    is_user_supplement: true,
  };
}

function parseChineseDocumentClient(rawText, meta = {}) {
  const clean = rawText.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*\*/g, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").map((l) => l.trim());
  const headerRe1 = /^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|\d{1,3})\s*号\s*(?:[男女]\s*)?(?:嘉\s*宾|男\s*生|女\s*生|小\s*哥|小\s*姐\s*姐)(?:\s*资\s*料)?$/;
  const headerRe2 = /^(?:Love\.?|NO\.?|嘉宾编号|嘉宾)\s*0?\d{1,3}$/i;

  const indices = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].replace(/^[*#•-]+\s*/, "").trim();
    if (!s || s.length > 28) continue;
    if (headerRe1.test(s) || headerRe2.test(s)) {
      indices.push([i, s.replace(/\s+/g, "")]);
      continue;
    }
    if (/^0?\d{1,2}$/.test(s)) {
      const nxt = lines.slice(i + 1, i + 4).find((x) => x.length > 0) || "";
      if (/^(?:昵称|代号|学校|编号)\s*[:：]/.test(nxt)) {
        indices.push([i, `硕博联谊${String(Number(s)).padStart(2, "0")}号`]);
      }
    }
  }

  let blocks = [];
  if (indices.length > 0) {
    indices.forEach(([startIdx, label], idx) => {
      const endIdx = idx + 1 < indices.length ? indices[idx + 1][0] : lines.length;
      const chunk = lines.slice(startIdx + 1, endIdx).join("\n").trim();
      if (chunk.length >= 15) blocks.push([label, chunk]);
    });
  } else {
    const sep = clean.split(/\n\s*(?:---+|\===+|###+)\s*\n/).map((c) => c.trim()).filter((c) => c.length >= 20);
    if (sep.length > 1) {
      blocks = sep.map((c, idx) => [`补录嘉宾${String(idx + 1).padStart(2, "0")}`, c]);
    } else {
      blocks = [[meta.source_title ? meta.source_title.slice(0, 14) : "单条补录嘉宾", clean]];
    }
  }

  const out = [];
  for (const [header, block] of blocks) {
    const masked = maskSensitiveText(block);
    const kv = {};
    const bLines = masked.split("\n").map((l) => l.replace(/^[*•-]\s*/, "").trim()).filter(Boolean);
    const normTok = (x) => x.replace(/[\s【】\[\]()（）]/g, "");

    for (let i = 0; i < bLines.length; i++) {
      const ln = bLines[i];
      const m = ln.match(/^([【\[]?[\u4e00-\u9fa5\s]{2,10}[】\]]?)\s*[:：]\s*(.*)$/);
      if (m) {
        const nk = KNOWN_KEYS[normTok(m[1])];
        if (nk) {
          const val = m[2].trim();
          if (val) kv[nk] = kv[nk] ? `${kv[nk]}；${val}` : val;
          continue;
        }
      }
      const solo = KNOWN_KEYS[normTok(ln)];
      if (solo) {
        const maxL = solo === "self_intro" || solo === "requirements" ? 6 : 1;
        const acc = [];
        let j = i + 1;
        while (j < bLines.length && acc.length < maxL) {
          if (KNOWN_KEYS[normTok(bLines[j])] || /^[【\[]?[\u4e00-\u9fa5\s]{2,10}[】\]]?\s*[:：]/.test(bLines[j])) break;
          acc.push(bLines[j]);
          j++;
        }
        if (acc.length) {
          kv[solo] = kv[solo] ? `${kv[solo]}；${acc.join(" ")}` : acc.join(" ");
          i = j - 1;
        }
      }
    }

    let gender = "U";
    if (/女/.test(header) && !/男/.test(header)) gender = "F";
    else if (/男/.test(header) && !/女/.test(header)) gender = "M";
    else if (kv.gender && kv.gender.includes("女")) gender = "F";
    else if (kv.gender && kv.gender.includes("男")) gender = "M";
    else if (/女生|女孩|小姐姐|独生女/.test(masked)) gender = "F";
    else if (/男生|小哥|男士/.test(masked)) gender = "M";

    const introPart = masked.split(/择偶(?:要求|标准)|希望另一半|希望你/)[0];
    let by = null;
    const m4 = `${kv.birth || ""} ${introPart}`.match(/(19[5-9]\d|200[0-8])\s*年?/);
    if (m4) by = Number(m4[1]);
    else {
      const m2 = `${kv.birth || ""} ${introPart}`.match(/(?<!\d)([789]\d|0[0-6])\s*年/);
      if (m2) by = normYear(Number(m2[1]));
      else if (kv.birth && /^\d{2}$/.test(kv.birth.trim())) {
        const v = Number(kv.birth.trim());
        by = normYear(v) || (v >= 18 && v <= 49 ? CURRENT_YEAR - v : null);
      }
    }

    let height = null;
    const mh = `${kv.height || ""} ${introPart}`.match(/(?:身高\s*[:：]?\s*|(?!\d))(1[4-9]\d|20\d)\s*(?:cm)?/i);
    if (mh && (kv.height || /身高|cm/i.test(mh[0]))) {
      const mh2 = (kv.height || introPart).match(/(?:身高\s*[:：]?\s*)(1[4-9]\d|20\d)|(?<!\d)(1[5-9]\d)\s*cm/i);
      if (mh2) height = Number(mh2[1] || mh2[2]);
      else if (kv.height && /^\d{3}$/.test(kv.height.trim())) height = Number(kv.height.trim());
    }

    const [eduStr, eduLvl] = parseEdu(`${kv.education || ""} ${introPart}`);
    let city = meta.city_hint || "";
    const cityBlob = kv.city || introPart;
    for (const c of COMMON_CITIES) {
      if ((kv.city && kv.city.includes(c)) || (!city && cityBlob.includes(c))) {
        city = c;
        break;
      }
    }
    city = city || "未注明";

    const reqText = kv.requirements || ((masked.match(/(?:择偶要求|择偶标准|希望另一半|希望你)\s*[:：]?\s*([\s\S]+)/) || [])[1] || "").trim();
    const reqInfo = parseReqs(reqText, by);

    const signals = [by, height, eduLvl > 0, reqText.length > 0].filter(Boolean).length;
    if (signals < 2) continue;

    const school = kv.school || "";
    const nick = kv.nickname || "";
    let code = nick ? `${header}·${nick}` : header;
    if (school && school.length <= 10) code += `(${school})`;
    if (city !== "未注明" && !code.includes(city)) code = `${city}·${code}`;

    const occ = kv.occupation || school || "未注明";
    const hc = kv.housing_car || "未注明";
    const fp = `usr_${simpleHash(`${meta.source_url || ""}|${code}|${gender}|${by}|${height}`)}`;

    out.push({
      fingerprint: fp,
      code_name: code,
      gender,
      birth_year: by,
      age: by ? CURRENT_YEAR - by : null,
      height_cm: height,
      weight_kg: null,
      education: eduStr,
      edu_level: eduLvl,
      city,
      hometown: kv.hometown || "未注明",
      occupation: occ,
      is_tizhi: /公务员|事业编|在编|国企|央企|公办|三甲|高校/.test(`${occ} ${introPart}`) ? 1 : 0,
      income_annual_wan: null,
      income_text: kv.income_annual || kv.income_monthly || kv.income_any || "未注明",
      housing_car: hc,
      has_house: /有房|购房/.test(hc) && !/无房/.test(hc) ? 1 : (/无房/.test(hc) ? 0 : null),
      has_car: /有车|购车/.test(hc) && !/无车/.test(hc) ? 1 : null,
      marital_status: /离异/.test(kv.marital || introPart) ? "离异" : "未婚",
      self_intro: [school ? `院校：${school}` : "", kv.self_intro, kv.impression, kv.hobbies].filter(Boolean).join("；").slice(0, 400) || masked.slice(0, 180),
      tags: "用户补录",
      ...reqInfo,
      source_platform: meta.source_platform || "用户本地补录",
      source_title: meta.source_title || "网页补录",
      source_url: meta.source_url || "",
      raw_masked: masked.slice(0, 1000),
      fetched_at: new Date().toISOString().slice(0, 16).replace("T", " "),
      is_user_supplement: true,
    });
  }
  return out;
}

/* ==================== 5. 生成从简Clarvy 模型链接提取提示词 ==================== */
export function buildClarvyExtractPrompt(urlsText, cityHint = "") {
  const urls = String(urlsText || "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);
  const urlListStr = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
  const cityLine = cityHint ? `若页面未逐人标明所在城市，默认归属城市填「${cityHint}」。` : "";
  return [
    "请帮我提取以下公开相亲/征友文章链接中的所有男女嘉宾资料，并对原文中的手机号、微信号、QQ号、身份证号做脱敏掩码处理。",
    cityLine,
    "链接列表：",
    urlListStr,
    "",
    "请严格只输出一个 JSON 数组代码块（```json ... ```），每个嘉宾对象包含以下字段，便于我直接粘贴回「寻缘雷达」补录：",
    '[',
    '  {',
    '    "code_name": "编号或昵称（如 01号女嘉宾 / 咕咕）",',
    '    "gender": "F 或 M",',
    '    "birth_year": 1996,',
    '    "height_cm": 165,',
    '    "education": "博士/硕士/本科/大专",',
    '    "city": "所在城市",',
    '    "hometown": "籍贯",',
    '    "occupation": "职业或院校",',
    '    "income_text": "年薪或月薪原话",',
    '    "housing_car": "房车情况",',
    '    "marital_status": "未婚/离异",',
    '    "self_intro": "自我介绍、爱好与特点摘要（已脱敏）",',
    '    "req_raw": "对方择偶要求完整描述",',
    '    "source_url": "对应原帖链接"',
    '  }',
    ']',
  ].filter(Boolean).join("\n");
}
