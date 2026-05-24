// 使用说明页：分模块讲解 Aivestor 的功能，未登录也可访问（middleware 未保护）。

interface Section {
  title: string;
  positioning: string;
  bullets: string[];
  tip: string;
}

const SECTIONS: Section[] = [
  {
    title: "对话",
    positioning: "与 AI 自由探讨投资问题，对话内容可沉淀入知识库",
    bullets: [
      "新建对话后直接输入问题，无需配置",
      "可关联具体项目，AI 会自动读取项目背景",
      "对话满 3 轮后可点击「沉淀此次对话」，将认知提炼入知识库",
      "AI 会自动检索你的知识库，给出有针对性的回答",
    ],
    tip: "对话是积累认知最自然的方式，不必刻意整理，聊完沉淀即可",
  },
  {
    title: "项目分析",
    positioning: "上传 BP 等材料，AI 生成结构化分析报告",
    bullets: [
      "新建项目后上传 PDF/Word/PPT/Excel 等文件",
      "AI 自动提取财务数据并生成七章节分析报告",
      "支持多轮自然语言修改报告内容",
      "投资决策中心提供魔鬼代言人、行业外视角、历史镜像三种决策辅助",
    ],
    tip: "财务数据建议用 Excel 上传，识别准确率最高",
  },
  {
    title: "项目档案",
    positioning: "每个项目的完整生命周期记录",
    bullets: [
      "项目文件：集中管理该项目的所有原始材料",
      "分析报告：查看和导出历次生成的报告",
      "判断记录：记录每次对项目的核心判断，追踪认知演变",
      "投后跟踪：记录会议纪要和项目进展",
    ],
    tip: "养成每次看完项目就记录判断的习惯，系统会随时间越来越懂你",
  },
  {
    title: "知识库",
    positioning: "你的私有投资知识库，越用越丰富",
    bullets: [
      "支持手动录入、文件上传、对话沉淀三种方式入库",
      "AI 问答时自动检索相关知识，给出有依据的回答",
      "认知模式分析：基于历史判断识别你的投资偏好与盲区",
    ],
    tip: "知识库是 Aivestor 的核心资产，建议定期将重要对话沉淀入库",
  },
  {
    title: "SKILL 广场",
    positioning: "投资分析专用技能包",
    bullets: [
      "官方提供 20 个常用分析框架（波特五力、SWOT、商业模式画布等）",
      "支持自建 SKILL，定义自己的分析模板",
      "支持导入 JSON 格式的 SKILL 定义（兼容豆包、GPTs 等平台）",
    ],
    tip: "常用的分析框架收藏后可在项目分析中一键调用",
  },
  {
    title: "个人设置",
    positioning: "配置个人画像与 AI 服务",
    bullets: [
      "投资人画像：填写关注阶段、赛道、判断标准等，AI 将据此个性化输出",
      "AI 模型配置：填入你的 API Key，支持 DeepSeek、OpenAI、Claude 等 9 个服务商",
    ],
    tip: "画像填写越完整，AI 分析越贴合你的实际风格",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-doc px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
        使用说明
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        了解 Aivestor 的各项功能，快速上手
      </p>

      <div className="mt-8 space-y-4">
        {SECTIONS.map((s) => (
          <article
            key={s.title}
            className="card-base p-5"
          >
            <h2 className="text-base font-semibold text-slate-800">
              {s.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{s.positioning}</p>

            <ul className="mt-3 space-y-1.5">
              {s.bullets.map((b, i) => (
                <li key={i} className="text-sm text-slate-600">
                  · {b}
                </li>
              ))}
            </ul>

            <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600">
              💡 {s.tip}
            </p>
          </article>
        ))}
      </div>

      {/* 联系方式 */}
      <div className="mt-8 rounded-r-lg border-l-4 border-[#1B6FE8] bg-blue-50 p-4">
        <p className="mb-1 text-sm font-medium text-[#1B6FE8]">🚀 公测阶段</p>
        <p className="text-sm text-slate-600">
          Aivestor 目前处于公测阶段，产品仍在持续迭代中。
          如果你在使用过程中遇到任何问题，或有功能建议、合作意向，欢迎随时联系我们：
        </p>
        <a
          href="mailto:Aivestor@qq.com"
          className="mt-1 inline-block text-sm font-medium text-[#1B6FE8] hover:underline"
        >
          Aivestor@qq.com
        </a>
        <p className="mt-1 text-xs text-slate-400">
          你的每一条反馈都会被认真阅读。
        </p>
      </div>
    </div>
  );
}
