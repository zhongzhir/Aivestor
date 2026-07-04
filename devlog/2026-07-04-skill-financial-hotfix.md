# 2026-07-04 · SKILL 补充说明与财报年份口径热修复

> 起因：用户连续反馈两处生成结果不符合预期：
> 1. SKILL 运行时填写不同「补充说明」，输出结果变化不明显。
> 2. 上传的是 2026 年财报，但报告输出仍引用默认/旧的 2024 年口径。
>
> 提交：`a48a603 fix: honor skill supplements and latest financial docs`
> 生产更新：无数据库迁移，ECS 拉取 `main` 后重建 Docker 即可。

## 一、问题一：SKILL 补充说明未有效影响输出

### 根因

前端已正确把补充说明作为 `extra_input` 传到 `/api/skills/run`，后端也会追加到 prompt 中。

问题在于追加位置和约束强度：旧逻辑把「投资人补充说明」放在 Skill 模板末尾，且没有明确声明其优先级。对于「尽调清单生成」这类通用模板较强的 SKILL，模型容易继续按模板默认范围输出，导致用户感觉不同补充说明没有生效。

### 修复

- 新增 `src/lib/skillPrompt.ts`，统一构造 Skill 最终 prompt。
- 将补充说明前置到 prompt 顶部，并明确为本次运行的最高优先级约束。
- 若补充说明与通用 Skill 模板冲突，以补充说明为准。
- `/api/skills/run` 改为调用统一构造函数，避免后续手工拼接再次回退。

### 回归测试

- 新增 `scripts/skill-run-prompt.test.ts`
- 覆盖：
  - 最终 prompt 必须包含补充说明；
  - 补充说明必须出现在 Skill 模板之前；
  - 空白补充说明不应产生额外约束段。

## 二、问题二：上传 2026 财报但报告沿用 2024 口径

### 根因

这是两个链路问题叠加：

1. 项目报告生成时只拼接 `bp/research/other` 文档正文，排除了 `financial_model`。而 Excel/xlsx 上传会自动归类为 `financial_model`，因此新上传的 2026 财报正文没有进入报告上下文。
2. Excel 结构化财务数据提取失败时，旧逻辑不会更新 `projects.financial_data`。如果项目里已有旧的 2024 结构化财务数据，旧数据会继续被注入报告，模型就会沿用 2024 年口径。

此外，报告系统提示里存在 2024 示例年份；在缺少最新财报上下文时，模型更容易被示例或旧数据带偏。

### 修复

- 在 `src/lib/report.ts` 新增 `REPORT_CONTEXT_DOC_KINDS`，报告上下文纳入 `financial_model`。
- `/api/projects/[id]/reports` 改为按 `REPORT_CONTEXT_DOC_KINDS` 查询文档，确保 Excel 财报正文进入报告上下文。
- `src/lib/excelFinancials.ts` 新增 `serializeExcelFinancialDataForProject()`。
- `/api/projects/[id]/documents` 上传 Excel 后，无论是否成功提取结构化财务数据，都会覆盖项目的 `financial_data`：
  - 提取成功：写入新的结构化财务数据；
  - 提取失败：清空旧 `financial_data`，避免旧年份污染。
- 报告 prompt 增加「时间口径要求」：
  - 财务年份、报告期和月份必须以项目材料或结构化财务数据为准；
  - 不得沿用系统提示中的示例年份；
  - 不得在材料未出现时默认使用 2024 年；
  - 如果文件名、表头或正文显示 2026 年，必须按 2026 年口径分析。

### 回归测试

- 新增 `scripts/report-financial-context.test.ts`
- 覆盖：
  - 报告上下文必须包含 `financial_model`；
  - Excel 结构化提取失败时必须清空旧财务数据；
  - 报告 prompt 必须包含禁止沿用示例年份的约束；
  - 上传材料中的 2026 财务文本必须保留在报告 prompt 中。

## 三、验证记录

本次修复已执行以下验证：

```bash
node -r ts-node/register -r tsconfig-paths/register scripts/skill-run-prompt.test.ts
node -r ts-node/register -r tsconfig-paths/register scripts/report-financial-context.test.ts
cmd /c npx next build
cmd /c npx tsc --noEmit
git diff --check
```

结果：

- 两个回归测试通过。
- `next build` 通过；仅保留项目既有 warning：
  - `officeparser/file-type` 动态依赖警告；
  - `/api/skills/catalog` 静态渲染探测时触发的 `DYNAMIC_SERVER_USAGE` 提示。
- 构建后 `tsc --noEmit` 通过。
- `git diff --check` 通过；仅有 Windows 换行转换提示。

## 四、部署

本次无数据库迁移。ECS 更新命令：

```bash
cd /opt/aivestor
git pull origin main
docker compose --env-file .env.docker up -d --build
docker compose ps
curl -s http://localhost/api/health
```

如需查看日志：

```bash
docker compose logs -f app
```

## 五、用户回复口径

建议回复：

> 感谢反馈，我们已经定位并修复了这两个问题。  
> 第一个问题是 Skill 的“补充说明”虽然传到了后台，但优先级不够高，模型容易仍按通用模板输出；现在已调整为高优先级约束。  
> 第二个问题是上传的 Excel 财报被归类为财务模型后，报告生成时没有纳入上下文，同时旧的结构化财务数据可能残留，导致输出沿用了 2024 年口径；现在已修复为优先读取最新上传的财务文件，并避免旧数据污染。  
> 请您再次试用看看效果，如还有不符合预期的地方，也欢迎继续提出宝贵意见，我们会持续优化。

