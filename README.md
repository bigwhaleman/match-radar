# 寻缘雷达 MatchRadar V2.0 — 公开相亲帖双向匹配 · 多维数据再检索 · 链接补录平台

> **免费开放与透明计费声明**：我们是**免费的公开信息检索与双向匹配平台**——浏览公开相亲样本库、多维数据再检索、双向匹配打分、市场统计看板、浏览器本地粘贴/JSON补录与 CSV 导出均 **0 元免费开放**；仅当用户主动选择调用 **从简Clarvy（[claudeai.chat](https://claudeai.chat)）** 平台大模型辅助抽取复杂非结构化长文时，才按实际调用消耗的模型 Token 透明计费。

- **在线公开发布地址（GitHub Pages）**：`https://bigwhaleman.github.io/match-radar/`
- **模型能力协同工作台**：[从简Clarvy · claudeai.chat](https://claudeai.chat)

---

## 核心功能模块

1. **`01 智能双向匹配`**：不仅计算对方是否符合你的年龄/身高/学历/城市/体制偏好（$S_{\text{forward}}$），更自动反向核验你是否满足对方择偶要求中的年龄、最低身高、最低学历、房车与同城门槛（$S_{\text{reverse}}$），按 $S_{\text{mutual}} = 0.55 S_{\text{forward}} + 0.45 S_{\text{reverse}}$ 综合排序并给出反向硬伤预警。
2. **`02 数据再检索`**：独立 12 维交叉组合检索引擎（关键词全文检索、性别、年龄上下限、最低身高、最低学历、城市、体制内外、房产情况、渠道来源、双向匹配分层、仅看本人追加/收藏），支持**紧凑对比表**与**卡片网格**双视图切换、URL 参数一键分享以及 UTF-8 CSV 导出。
3. **`03 链接补录与AI提取`**：支持用户通过给链接或粘贴文本扩充数据：
   - **公开网页链接直抓解析**：输入公开相亲帖 URL 直接提取（兼容本地后端代理或静态 CORS 直连）；
   - **从简Clarvy 模型辅助提取**：遇到排版极不规则的微信推文或社群长帖，一键生成标准化 JSON 提取指令，前往 `claudeai.chat` 调用大模型抽取后回填导入（仅该步骤消耗模型自身 Token）；
   - **提交公共快照库收录**：支持一键唤起预填 GitHub Issue 或管理员通过 `workflow_dispatch` 触发全站公共快照合并；
   - **0 Token 本地规则补录**：支持「方糖·硕士博士俱乐部」格式、多行键值对、行内键值对、`【键名】`及群接龙格式即时解析与脱敏。
4. **`04 市场统计看板`**：纯原生 SVG 绘制出生代际男女对比、男嘉宾身高 vs 女嘉宾最低身高门槛错配、学历层次结构、择偶高频硬门槛与样本城市分布。
5. **`05 定时源与合规审计`**：展示 GitHub Actions 每 12 小时定时采集状态与 SHA-256 校验流水。严守 robots 与反爬合规边界，绝不绕过验证码、登录墙或访问限制；受阻站点如实记录 `blocked` 并保留历史成功快照；所有公开与补录文本均自动掩码脱敏手机号、微信号、QQ号、邮箱与身份证号。

---

## 目录结构（双模同构架构）

- `public/`：纯静态前端与浏览器端同构推理引擎（可直接托管于 GitHub Pages）
  - `public/index.html` / `public/styles.css` / `public/app.js`
  - `public/engine.mjs`：纯前端脱敏、双向匹配打分、统计聚合与规则解析引擎
  - `public/data/snapshot.json`：已脱敏的公开相亲嘉宾快照库
- `parser.py`：Python 多格式相亲帖解析与敏感联系方式脱敏核心模块
- `scripts/update_public_snapshot.py`：GitHub Actions 无第三方依赖增量采集与原子快照更新脚本
- `.github/workflows/refresh-and-pages.yml`：每 12 小时定时刷新快照并自动部署 GitHub Pages 工作流

---

## 本地预览运行

```bash
# 纯静态模式启动预览（等价于 GitHub Pages 线上环境）
python3 -m http.server 8080 --directory public
```
