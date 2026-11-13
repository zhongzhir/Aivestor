# P1 项目管线与项目工作区响应式 Design QA

## 比较对象

- 视觉参考：
  - `D:/Projects/Aivestor/artifacts/ui-demo-audit-20261113/screenshots/05-mobile-project-library.jpg`
  - `D:/Projects/Aivestor/artifacts/ui-demo-audit-20261113/screenshots/06-mobile-project-detail-source.jpg`
- 实现截图：
  - `artifacts/p1-ui-qa/mobile-projects.png`
  - `artifacts/p1-ui-qa/mobile-projects-filter.png`
  - `artifacts/p1-ui-qa/mobile-project-detail.png`
  - `artifacts/p1-ui-qa/mobile-project-decision.png`
  - `artifacts/p1-ui-qa/tablet-projects-768.png`
  - `artifacts/p1-ui-qa/tablet-project-detail-1024.png`
  - `artifacts/p1-ui-qa/desktop-project-detail-1440.png`
- 合并比较图：
  - `artifacts/p1-ui-qa/compare-mobile-projects.png`
  - `artifacts/p1-ui-qa/compare-mobile-detail.png`

## 视口和归一化

- 源参考图像均为 900 × 1000 像素，包含手机框或概念展示背景，不是纯页面截图。
- 移动实现设置 CSS 视口 390 × 844，浏览器内容截图为 380 × 822 像素，deviceScaleFactor 为 1。
- 其他实现检查覆盖 768 × 900、1024 × 900 和 1440 × 1000 CSS 视口；对应内容截图分别为 758 × 888、1014 × 891 和 1430 × 993 像素。
- 合并比较图把源参考与实现截图等高缩放后并排，只比较应用内容的信息层级、密度、卡片节奏和导航方式；不比较源图的手机外框、状态栏和展示背景。
- 状态：项目管线默认态与筛选展开态；项目工作区项目分析态、滚动态和投资决策态。

## Findings

- 没有遗留 P0、P1 或 P2 问题。
- 项目管线沿用参考图的紧凑卡片与底部高频导航，但有意增加“下一步”、阶段、结论和更新时间，满足真实投资流程；这属于产品融合，不是视觉漂移。
- 项目工作区没有复制“原版 BP—分析报告—投后跟踪”的静态页签，而是保留 Aivestor 的“项目分析—投资决策—投后管理”三阶段；材料、报告、证据和跟踪被放入阶段内部的响应式分区，属于已确认的业务边界。

## 必查表面

- 字体与排版：继续使用 Aivestor 现有系统中文字体与 Inter 数字字体；移动正文不低于现有 12px 辅助文字尺度，项目名、下一步和阶段层级清楚，未发现异常换行或截断关键内容。
- 间距与布局：390px 卡片、筛选按钮和阶段页签没有重叠；768px 筛选自然换行；1024px 使用可折叠分区控制长页面；1440px 恢复桌面宽屏证据布局。
- 颜色与视觉变量：复用 `canvas/surface/ink/line/accent`，没有引入客户专属颜色或新的渐变；状态与主操作对比清楚。
- 图像与资产：本次界面没有新增图片、插画或品牌资产，也没有用 CSS/手工 SVG 伪造视觉资产。原 Demo 的手机外框属于展示基础设施，不进入产品界面。
- 文案与内容：界面文案使用真实流程术语；所有新入口和状态均对应现有路由或数据字段，没有演示性假按钮。
- 交互与无障碍：搜索和重点项目始终可达；筛选、分区按钮有 `aria-expanded`；三阶段导航使用 tab/tablist 语义、44px 以上移动触控高度和可见选中态。

## 交互与控制台验证

- 筛选面板展开/收起通过，展开后六组条件完整可见。
- 项目工作区长页面滚动时三阶段导航保持吸顶。
- “项目分析→投资决策”切换通过，URL 状态同步且没有整页跳转。
- 材料、关系、材料原文、分析与报告分区在窄屏可独立展开/收起。
- 浏览器控制台无 error 或 warning。

## 比较历史

- 最终比较：390、768、1024、1440 四档截图均未发现可执行的 P0/P1/P2 问题，因此没有进入额外视觉修补循环。

## Follow-up Polish

- P3：上线前可在真实登录态和真实长项目名称下补一次 200% 缩放检查；这不阻断 P1 代码完成。
- P3：底部导航未来可在统一图标体系确定后补充图标，本轮继续保持 P0 已采用的文字导航，避免临时图标风格不一致。

## Implementation Checklist

- [x] 移动项目卡片突出阶段、结论、更新时间和下一步。
- [x] 搜索和重点项目常驻，其他筛选窄屏折叠。
- [x] 项目头部在移动端压缩并保留主操作。
- [x] 三阶段导航具备吸顶、选中态和语义标签。
- [x] 材料、报告、证据和跟踪在窄屏渐进展开。
- [x] 桌面端保留宽屏材料与证据布局。

final result: passed
