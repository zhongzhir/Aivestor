// 使用说明页：分模块讲解 Aivestor 的功能，未登录也可访问（middleware 未保护）。

interface Section {
  title: string;
  positioning: string;
  bullets: string[];
  tip: string;
}

const SECTIONS: Section[] = [
  {
    title: "使用与安装",
    positioning: "普通用户打开网页即可使用；需要自控数据边界时可私有化部署",
    bullets: [
      "个人用户直接访问 aivestor.cn 注册使用，无需下载安装客户端",
      "Chrome/Edge 可将 Aivestor 安装到桌面，之后像独立应用一样打开",
      "机构或个人服务器可使用 Docker 私有化部署，数据库、上传文件和项目记录留在自控环境",
    ],
    tip: "如果你只是试用产品，优先使用云端版本；如果你有内网、合规或数据边界要求，再选择私有化部署",
  },
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
    title: "项目管线与工作区",
    positioning: "从初筛到投后，在同一个项目空间持续推进",
    bullets: [
      "工作台和项目管线集中展示活跃项目、阶段与近期变化",
      "项目内统一管理材料、分析、投资决策、投后规划和项目记录",
      "为项目维护下一步动作、截止时间、负责人和证据完整度",
      "项目时间线串联材料、报告、判断、决策与投后更新",
    ],
    tip: "先维护项目阶段和下一步动作，重新打开项目时更容易快速进入状态",
  },
  {
    title: "材料分析与投资决策",
    positioning: "把分析结果变成可以复核和推进的决策依据",
    bullets: [
      "上传 PDF/Word/PPT/Excel 等材料，生成结构化报告并保留来源提示",
      "记录多空理由、核心假设、创始人判断、置信度和待核问题",
      "通过投资节点控制记录立项、尽调、投委会、交割、Pass 等正式节点",
      "在项目内生成、编辑和评审 IC Memo，形成投委会共同底稿",
    ],
    tip: "AI 生成内容用于辅助判断；正式决策前请结合原始材料和专业意见复核",
  },
  {
    title: "投后管理",
    positioning: "让投前判断进入持续跟踪、行动和退出管理",
    bullets: [
      "上传财务、审计、经营、董事会和股东会等投后材料",
      "记录经营指标、重大事项、风险信号和会议更新",
      "维护投后行动项、负责人、截止日期和完成状态",
      "维护主要与备选退出路径，并生成内部复盘、LP更新或协会报送底稿",
    ],
    tip: "结构化指标和行动项需要人工确认，文本中自动识别的线索只作为录入辅助",
  },
  {
    title: "关系与项目上下文",
    positioning: "把人、机构、介绍来源和历史知识带回项目",
    bullets: [
      "记录与项目相关的人、机构、角色、关系强度和介绍来源",
      "在项目内查看与当前主题相关的个人或机构知识卡片",
      "将关系记录与材料、判断、会议和时间线放在同一个上下文中",
    ],
    tip: "当前关系层以轻量手工记录为主，不会自动读取你的邮件或日历",
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
      "官方提供近 30 个投资框架，覆盖分析、尽调、IC 和投后等场景",
      "支持自建 SKILL，定义自己的分析模板",
      "支持导入 JSON 格式的 SKILL 定义（兼容豆包、GPTs 等平台）",
    ],
    tip: "常用的分析框架收藏后可在项目分析中一键调用",
  },
  {
    title: "设置",
    positioning: "分别配置投资偏好、账户安全与 AI 服务",
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
        <p className="mb-1 text-sm font-medium text-[#1B6FE8]">Aivestor 2.0</p>
        <p className="text-sm text-slate-600">
          Aivestor 2.0 已完成项目工作区、投资决策与投后管理的主要升级，产品仍在持续迭代中。
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

      {/* 免责声明 */}
      <section className="prose text-sm text-gray-500 mt-8">
        <h2 className="text-base font-semibold text-slate-700">免责声明</h2>
        <p>
          Aivestor 生成的分析报告、数据提取结果及 Term Sheet 草稿均由 AI 辅助生成，
          仅供参考，不构成投资建议或法律意见。AI 输出存在误判和遗漏风险，
          报告中标注 [src:ai] 的内容尤其需要人工核实。
          用户应对最终投资决策承担完全责任。
        </p>
      </section>
    </div>
  );
}
