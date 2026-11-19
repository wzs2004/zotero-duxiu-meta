# 读秀元数据 · Duxiu Meta for Zotero

为 Zotero 中的 PDF 自动匹配图书元数据：**读秀**、**文津（国家图书馆）**、**豆瓣读书**、**Google Books**、**Open Library**。

选中一个 PDF（或它的父条目），右键选择「读秀元数据 → 搜索并匹配元数据…」。插件会：

1. 从 PDF 全文中提取 ISBN（也会读取文件名、条目已有的 ISBN/书名/作者/年份）；
2. 同时检索你勾选的来源；
3. 按书名、作者、年份、出版社和 ISBN 计算匹配度并排序；
4. 点选一条结果，读取详情页补全 ISBN、页数、摘要，然后一键写入 Zotero。

如果 PDF 还没有父条目，插件会新建一个“图书”条目并把 PDF 挂到它下面。

> 支持 Zotero 7、8、9、10、11（`manifest.json` 中 `strict_min_version: 7.0`，`strict_max_version: 11.*`）。

---

## 为什么还要单独做一个插件？

Zotero 中文圈最著名的元数据插件是 [茉莉花（Jasminum）](https://github.com/l0o0/jasminum)。它已经支持从 **豆瓣读书、文津（国家图书馆）、PubScholar、知网、万方** 等来源抓取元数据，但**不支持读秀**。

读秀（duxiu.com）没有公开 API，检索结果只对机构网络开放，所以没有现成的通用插件可以直接连接它。本项目在插件内部请求读秀检索页并解析 HTML，同时把豆瓣、Google Books、Open Library 作为补充来源；当读秀不可用时，其它来源仍然能工作。

---

## 安装

### 从 GitHub Release 安装（推荐）

1. 打开 [Releases](https://github.com/wzs2004/zotero-duxiu-meta/releases)，下载最新的 `duxiumeta.xpi`；
2. 打开 Zotero → **工具 → 插件**；
3. 点击右上角齿轮 → **Install Plugin From File…**（从文件安装插件）；
4. 选择 `duxiumeta.xpi`，按提示重启 Zotero。

### 从源码构建

```bash
git clone https://github.com/wzs2004/zotero-duxiu-meta.git
cd zotero-duxiu-meta
bash package.sh
# 生成 dist/duxiumeta.xpi
```

构建只依赖 `zip`，不需要 Node.js 或打包工具。

---

## 使用

### 单个 PDF / 条目

1. 在 Zotero 中选中一个 PDF 附件，或选中它的父条目；
2. 右键 → **读秀元数据 → 搜索并匹配元数据…**；
3. 在弹窗里确认/修改检索词（默认优先用 PDF 中识别出的 ISBN，其次用标题）；
4. 勾选来源，点「搜索」；
5. 在左侧选择一条结果，右侧会显示详情（点击后自动读取豆瓣/读秀详情页）；
6. 勾选是否「覆盖已有字段」，点「应用元数据」。

默认只补全空字段，不会覆盖你手动改过的内容。

### 从剪贴板

右键 → **读秀元数据 → 从剪贴板识别 ISBN 并搜索…**。适合从电商、豆瓣、图书馆页面复制 ISBN 后直接建条目。

### 导入 PDF 时自动匹配

在 **设置 → 读秀元数据** 中打开「导入 PDF 时自动匹配」。插件只会在以下条件同时满足时自动写入：

- PDF 是独立附件（没有父条目）；
- 从 PDF 全文中提取到了合法 ISBN；
- 某个来源返回了 **完全相同的 ISBN**，且匹配分数达到设定阈值（默认 0.92）。

自动模式只补全空字段，并在右下角弹出通知。

---

### AI 批量匹配（按分类）

1. 在左侧分类上右键 → **读秀元数据 → AI 批量匹配…**；
2. 勾选要处理的 PDF，可勾选「包含子分类」；「只勾选缺少 ISBN 的」可以快速筛出需要补全的条目；
3. 点「开始识别」。插件会为每个 PDF 提取 ISBN，检索读秀、文津、豆瓣等来源；有 ISBN 时还会读取候选详情页核对 ISBN，避免同名书选错版本；
4. 每条结果可以下拉切换候选，状态列显示匹配度或失败原因；
5. 点「应用选中项并覆盖元数据」，确认后批量写入。独立 PDF 会自动新建图书条目。

AI 辅助是可选的：在设置里填 OpenAI 兼容接口地址、模型和 API Key 后，模型会在多个候选之间选一条，并在状态里标「AI 选择」。只发送文件名、识别出的 ISBN/书名、前几页的短片段（最多约 2000 字）和候选书目，不会上传完整 PDF；不配置 AI 也能正常批量匹配，使用本地评分。

批量识别每个 PDF 只读取全文缓存的前 1.6 万字符，通常几秒就能处理一个；有 ISBN 时只核对前两个候选的详情页，不会把整本书读一遍。

## 读秀的访问限制（重要）

读秀是商业数据库，**没有公开 API**，检索和详情页通常要求机构 IP、VPN 或登录。本插件：

- 直接使用你当前网络请求读秀，不会绕过登录、验证码或付费墙；
- 只解析公开可见的检索结果页和详情页；
- 如果返回登录页或验证码，会在结果区提示「读秀要求登录或机构权限」。

典型使用场景：在校园网、学校 VPN 或图书馆代理下使用。若你的学校使用单独的读秀入口，可在设置里把「检索地址模板」改成学校提供的 URL，`{query}` 会替换为书名或 ISBN。

读秀改版可能导致解析失败。可在设置里调整「结果链接的 CSS 选择器」（默认 `a[href*="bookDetail.jsp"]`），或到 GitHub 提 issue 并附上页面结构。

---

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 检索来源 | 读秀 / 文津 / 豆瓣 / Google Books / Open Library 全开 | 弹窗里也可以临时勾选；设置里的勾选会直接影响检索 |
| 读秀检索地址模板 | `https://www.duxiu.com/search?channel=search&sw={query}&ecode=utf-8` | `{query}` 为书名或 ISBN |
| 读秀结果选择器 | `a[href*="bookDetail.jsp"]` | 抓取详情页链接 |
| 读秀超时 | 15000 ms | |
| 每个来源最多结果数 | 20 | |
| 默认覆盖已有字段 | 关 | 关：只补空字段 |
| 导入时自动匹配 | 关 | 见上文 |
| 自动匹配最低分 | 0.92 | |
| 调试日志 | 关 | 输出到 Zotero 的调试输出 |
| 启用 AI 选书 | 关 | 需要 OpenAI 兼容接口；只发送书目文本，不上传 PDF |

---

## 隐私

- 插件不上传 PDF、笔记或 Zotero 数据库；
- 检索请求直接发往 duxiu.com、douban.com、googleapis.com、openlibrary.org，这些站点会看到你的 IP；
- 没有统计、没有遥测、没有账号体系。

---

## 已知限制

- **读秀依赖 HTML 解析**，页面结构变化会导致失败；这是本插件最脆弱的部分；
- 豆瓣可能触发人机验证（`sec.douban.com`）。触发时插件会自动弹出一个豆瓣验证窗口，完成验证后点「验证完成，重试」即可，不需要手动复制 Cookie；
- Google Books 在中国大陆通常需要代理；
- 自动匹配只信任「精确 ISBN」，因此不会误配，但也不会处理没有 ISBN 的扫描版 PDF；
- 目前只处理图书/专著，不处理期刊论文（期刊元数据建议用茉莉花 + 知网/万方）；
- 已在 macOS + Zotero 10.0.6 上做过完整流程测试（读秀、豆瓣、PDF 全文 ISBN、自动匹配、设置面板）；
  Windows/Linux 未逐项测试，但代码只使用 Zotero 的跨平台 API。

---

## 开发与测试

```bash
node test/unit.mjs     # 纯函数测试（ISBN、日期、相似度、Google/OpenLibrary 解析）
bash package.sh        # 打包 dist/duxiumeta.xpi
```

目录结构：

```
bootstrap.js                    插件生命周期 + chrome 注册
prefs.js                        默认设置
chrome/content/search.xhtml     检索/匹配弹窗
chrome/content/preferences.xhtml 设置面板
chrome/content/scripts/core.js  纯函数（可单测）
chrome/content/scripts/duxiumeta.js Zotero 集成
chrome/content/scripts/search.js 弹窗逻辑
```

---

## 发布到 GitHub 与插件商店

Zotero 客户端本身**没有内置插件商店**。中文社区所说的“插件商店”是
[zotero-chinese.com/plugins](https://zotero-chinese.com/plugins)，目录来自
[zotero-chinese/zotero-plugins](https://github.com/zotero-chinese/zotero-plugins)；
Zotero 官方的插件列表也是人工维护的网页。无论哪种方式，用户最终都是下载 `.xpi` 安装。

另外，插件商店只负责“发现”和“下载”，不会托管代码；你的 GitHub Release 才是实际下载源。

### 1. 推到 GitHub

```bash
cd zotero-duxiu-meta
git init
git add .
git commit -m "feat: initial release"
git branch -M main
git remote add origin https://github.com/wzs2004/zotero-duxiu-meta.git
git push -u origin main
```

> 仓库地址里的 `wzs2004` 需要换成你自己的 GitHub 用户名，同时修改：
> `manifest.json` 的 `homepage_url` / `update_url`、`prefs.js` 之外的 `chrome/content/preferences.xhtml`
> 里的链接、以及 `.github/workflows/release.yml`（无需改，使用 `GITHUB_REPOSITORY`）。

### 2. 打标签，自动发布

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/release.yml` 会构建 `duxiumeta.xpi`、生成 `update.json` 并创建 Release。
Zotero 的「检查更新」会读取 `update.json`。

### 3. 提交到中文插件商店

中文插件商店的目录维护在 [zotero-chinese/zotero-plugins](https://github.com/zotero-chinese/zotero-plugins)，
目前接受新插件提交（issue 或 PR）。

1. Fork `zotero-chinese/zotero-plugins`；
2. 在 `src/plugins.ts` 里按仓库名顺序加入条目：

```ts
{
  repo: 'wzs2004/zotero-duxiu-meta',
  nameZh: '读秀元数据',
  summaryZh: '从读秀、豆瓣、Google Books、Open Library 为 PDF 匹配图书元数据。',
  keywords: ['读秀', '豆瓣', '图书', '元数据', 'ISBN'],
  releases: [],
  tags: ['metadata'],
  discoverReleases: true,
},
```

3. 提 PR（或按 [提交说明](https://github.com/zotero-chinese/zotero-plugins/issues/374) 开 issue）；
4. 维护者审核、抓取 XPI 兼容信息后，插件会出现在
   [zotero-chinese.com/plugins](https://zotero-chinese.com/plugins)。

商店只会读取你 GitHub Release 里的 XPI，因此**先发布 Release，再提交条目**。
收录需要人工审核，不能保证当天上线；在收录之前，用户仍可通过 Release 页面的 XPI 安装。

---

## 更新日志

### 1.2.0

- AI 只读取 PDF 前几页的短片段（最多约 2000 字），不再把大段文本发给模型；
- 批量识别只读全文缓存前 1.6 万字符，减少等待时间；
- 有 ISBN 时只核对前两个候选，命中精确 ISBN 就提前停止；
- 批量并发提高到 3 个，导入后尚未索引的 PDF 最多等约 3 秒。

### 1.1.0

- 新增 AI 批量匹配：在分类上右键，勾选 PDF 后批量识别、逐条确认、覆盖元数据；
- 有 ISBN 时先按 ISBN 检索，并读取候选详情页核对 ISBN，降低同名书选错版本的概率；
- 新增可选的 AI 选书：支持 OpenAI 兼容接口，模型在多个候选中选择，未配置时回退到本地评分；
- 独立 PDF 在批量应用时自动新建图书条目。

### 1.0.2

- 修复设置里取消勾选来源后，右键检索仍然使用该来源的问题（偏好读取没有走全局分支）；
- 新增文津（国家图书馆）图书源，支持检索结果和详情页的 ISBN、出版地、页数、语种、版次；
- 设置里的读秀地址、超时、结果数、自动匹配阈值等偏好现在都会真正生效。

### 1.0.1

- 修复读秀标题里残留的 `<font color=Red>` 高亮标签（例如“轻松学习医学免疫学 第2版”）；
- 豆瓣触发人机验证时自动弹出验证窗口，验证完成后可直接重试；
- 保存元数据时统一清理标题、出版社、丛书等字段里的 HTML 标签。

### 1.0.0

- 首个版本：读秀 / 豆瓣 / Google Books / Open Library 检索，PDF 全文 ISBN 提取，自动匹配，右键菜单与设置面板。

## License

MIT
