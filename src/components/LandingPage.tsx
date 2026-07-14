"use client";
import Link from "next/link";
import Footer from "@/components/Footer";

export default function LandingPage() {
  return (
    <>
      {/* Schema.org JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "Aivestor",
            "url": "https://aivestor.cn",
            "description": "面向一级股权投资人的全周期AI工作台。连接项目管线、材料分析、投资决策、IC Memo、投后管理与知识沉淀。",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web",
            "inLanguage": "zh-CN",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "CNY"
            },
            "audience": {
              "@type": "Audience",
              "audienceType": "Venture Capital Investors, Private Equity Professionals, Angel Investors"
            },
            "creator": {
              "@type": "Organization",
              "name": "北京链上文投信息技术有限公司",
              "email": "Aivestor@qq.com"
            },
            "featureList": [
              "BP智能分析与报告生成",
              "私有知识库（向量检索）",
              "投资判断记录与回溯",
              "投资节点控制与IC Memo",
              "投后指标、行动项与退出策略",
              "投后报告生成与导出",
              "项目关系与知识上下文",
              "跨会话AI记忆",
              "SKILL分析框架广场",
              "数据溯源标注",
              "投委会报告生成"
            ]
          })
        }}
      />

      <main style={{ fontFamily: "system-ui, sans-serif", color: "#1a1a1a", maxWidth: "860px", margin: "0 auto", padding: "60px 24px" }}>

        {/* Hero */}
        <section style={{ textAlign: "center", marginBottom: "80px" }}>
          <div style={{ fontSize: "42px", fontWeight: "800", marginBottom: "12px" }}>
            <span style={{ fontWeight: "300" }}>Ai</span>vestor
          </div>
          <p style={{ fontSize: "13px", color: "#1B6FE8", fontWeight: "700", letterSpacing: "0.12em", marginBottom: "12px" }}>
            AIVESTOR 2.0
          </p>
          <p style={{ fontSize: "22px", color: "#0D1B3E", fontWeight: "600", marginBottom: "16px" }}>
            股权投资全周期 AI 工作台
          </p>
          <p style={{ fontSize: "17px", color: "#666", lineHeight: "1.7", maxWidth: "600px", margin: "0 auto 32px" }}>
            从项目初筛、尽调和投资决策，到投后管理与报告输出。<br />
            让材料、判断、关系与行动留在同一个持续演进的项目工作区。
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" style={{ background: "#1B6FE8", color: "#fff", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600", fontSize: "16px" }}>
              免费开始使用
            </Link>
            <Link href="/demo/consumer" style={{ border: "2px solid #1B6FE8", color: "#1B6FE8", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600", fontSize: "16px" }}>
              查看示例报告 →
            </Link>
          </div>
        </section>

        {/* 解决的问题 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "32px", textAlign: "center", color: "#0D1B3E" }}>
            AI 能回答问题，工作台负责让决策连续发生
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
            {[
              { title: "项目上下文容易断裂", desc: "材料、会议、判断和报告分散在不同工具里，重新打开项目时还要从头找回状态" },
              { title: "决策过程缺少支点", desc: "分析结论很多，但关键假设、待核问题、投资节点和正式决策没有形成连续记录" },
              { title: "投前与投后彼此割裂", desc: "投前形成的判断很少进入投后验证，指标、行动、退出策略和对外报告又靠人工拼接" },
            ].map((item) => (
              <div key={item.title} style={{ background: "#F0F5FF", borderRadius: "12px", padding: "24px", borderLeft: "4px solid #1B6FE8" }}>
                <div style={{ fontWeight: "700", marginBottom: "8px", color: "#0D1B3E" }}>{item.title}</div>
                <div style={{ color: "#666", fontSize: "15px", lineHeight: "1.6" }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 核心功能 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "32px", textAlign: "center", color: "#0D1B3E" }}>
            核心功能
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            {[
              { icon: "🗂", title: "项目管线与工作台", desc: "集中查看活跃项目、阶段、下一步动作与近期变化" },
              { icon: "📄", title: "材料分析与报告", desc: "解析BP与财务材料，生成可追溯、可修改、可导出的报告" },
              { icon: "🎯", title: "投资决策与 IC", desc: "记录关键假设和决策节点，在项目内准备并评审 IC Memo" },
              { icon: "📈", title: "投后管理", desc: "跟踪指标、重大事项、行动项、退出策略与投后报告" },
              { icon: "🔗", title: "关系与知识上下文", desc: "把联系人、介绍来源和历史知识带回当前项目" },
              { icon: "🧠", title: "个人与机构知识", desc: "个人判断与机构沉淀分层保留，在工作流中按需调用" },
              { icon: "🛠", title: "SKILL 广场", desc: "近30个投资框架，支持自定义、导入导出与项目调用" },
              { icon: "🔒", title: "数据与权限边界", desc: "支持自带模型密钥、组织权限控制、数据导出与私有部署" },
            ].map((item) => (
              <div key={item.title} style={{ background: "#fff", border: "1px solid #E8F0FD", borderRadius: "12px", padding: "20px" }}>
                <div style={{ fontSize: "28px", marginBottom: "10px" }}>{item.icon}</div>
                <div style={{ fontWeight: "700", marginBottom: "6px", color: "#0D1B3E" }}>{item.title}</div>
                <div style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 与ChatGPT对比 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "24px", textAlign: "center", color: "#0D1B3E" }}>
            与直接使用 ChatGPT 的区别
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "15px" }}>
              <thead>
                <tr style={{ background: "#0D1B3E", color: "#fff" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>对比维度</th>
                  <th style={{ padding: "12px 16px", textAlign: "left" }}>ChatGPT / 通用 AI</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", color: "#4A9EFF" }}>Aivestor</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["上下文组织", "记忆以通用对话为主", "项目、判断、知识与投后记录结构化关联"],
                  ["部署与控制", "取决于所用模型服务", "支持数据导出、自带模型密钥与私有部署"],
                  ["历史沉淀", "分析完即消失", "每次判断留存，可回溯，可对比"],
                  ["个人化程度", "对所有用户一样", "越用越懂你的投资逻辑"],
                  ["专业工作流", "以对话和单次任务为主", "项目管线→分析→决策→投后→输出"],
                  ["决策落地", "需要自行组织记录", "关键假设、投资节点与 IC Memo 连续留痕"],
                  ["投后管理", "需要另建表格和文档", "指标、行动、退出策略与报告在项目内衔接"],
                ].map(([dim, gpt, aivestor], i) => (
                  <tr key={dim} style={{ background: i % 2 === 0 ? "#F8FAFF" : "#fff" }}>
                    <td style={{ padding: "12px 16px", fontWeight: "600", color: "#0D1B3E" }}>{dim}</td>
                    <td style={{ padding: "12px 16px", color: "#999" }}>{gpt}</td>
                    <td style={{ padding: "12px 16px", color: "#1B6FE8", fontWeight: "500" }}>{aivestor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ — 结构化自然语言，GEO核心资产 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "32px", textAlign: "center", color: "#0D1B3E" }}>
            常见问题
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {[
              {
                q: "Aivestor 和直接用 ChatGPT 分析BP有什么本质区别？",
                a: "最核心的区别是“沉淀”。用ChatGPT分析完一个项目，对话结束数据就消失了。Aivestor会把每次判断存入你的私有知识库，半年后再看新项目时，AI能自动关联你历史上看过的类似案例，告诉你上次在哪里判断对了、哪里踩坑了。"
              },
              {
                q: "需要下载安装吗？",
                a: "普通用户不需要下载安装，直接打开 aivestor.cn 注册即可使用。想固定到桌面时，可在 Chrome 或 Edge 中选择“安装 Aivestor”或“将此站点作为应用安装”。如果你需要数据完全留在自控环境，也可以使用 Docker 私有化部署。"
              },
              {
                q: "我的投资分析数据安全吗？会被平台看到吗？",
                a: "Aivestor支持用户自带API Key，密钥使用AES-256-GCM加密；项目与组织资源按权限隔离，并提供数据导出和Docker私有部署。使用SaaS版本时，项目材料与工作记录会按产品功能存储和处理；对数据边界要求更高的团队可选择私有部署。"
              },
              {
                q: "支持哪些 AI 模型？必须用某个特定模型吗？",
                a: "不绑定任何模型。目前支持DeepSeek、OpenAI、Claude、通义千问、智谱AI、Moonshot。新用户可使用平台提供的免费额度（绑定手机号后激活），无需立即配置自己的API Key。"
              },
              {
                q: "适合什么阶段的投资机构？个人投资人能用吗？",
                a: "都可以。个人版适合分析师、投资经理和天使投资人持续管理自己的判断；机构版已支持组织权限、共享项目与知识、团队判断协作、LP报告和机构数据应用，采用联系开通方式。"
              },
              {
                q: "知识库里的内容是怎么产生的？需要手动维护吗？",
                a: "主要靠自动沉淀，无需手动维护。每次AI分析报告完成后，关键判断会自动提炼为知识条目；对话达到一定轮次后，系统会自动生成认知摘要写入知识库。你也可以手动添加行业观点或投资论点。"
              },
              {
                q: "SKILL 广场是什么？",
                a: "投资分析框架的模板库。平台内置近30个官方SKILL，覆盖消费、SaaS、医疗、硬件、尽调、IC和投后等场景。你可以直接使用官方框架，也可以自定义、导入导出，或让AI根据你的历史判断自动生成专属框架。"
              },
              {
                q: "现在可以使用吗？",
                a: "可以。个人用户可直接访问 aivestor.cn 注册使用，并获得平台试用额度；也可以配置自己的模型API Key。机构版采用联系开通方式，可通过 Aivestor@qq.com 沟通团队协作、数据接入与私有化部署需求。"
              },
            ].map((item) => (
              <div key={item.q} style={{ border: "1px solid #E8F0FD", borderRadius: "12px", padding: "20px 24px" }}>
                <div style={{ fontWeight: "700", color: "#0D1B3E", marginBottom: "10px", fontSize: "16px" }}>
                  Q: {item.q}
                </div>
                <div style={{ color: "#555", lineHeight: "1.7", fontSize: "15px" }}>
                  A: {item.a}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SKILL 预览 — 引导至公开的 SKILL 广场 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "12px", textAlign: "center", color: "#0D1B3E" }}>
            专业分析框架，开箱即用
          </h2>
          <p style={{ fontSize: "16px", color: "#666", lineHeight: "1.7", textAlign: "center", maxWidth: "640px", margin: "0 auto 32px" }}>
            近30个由投资实践提炼的分析框架，覆盖BP解读、尽调、行业研究、IC和投后等核心场景
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
            {[
              { name: "BP 综合分析", desc: "结构化拆解商业计划书，定位关键风险与亮点" },
              { name: "行业竞争格局", desc: "梳理赛道玩家与壁垒，判断差异化是否成立" },
              { name: "财务健康度评估", desc: "审视收入质量、现金跑道与单位经济模型" },
              { name: "创始人评估", desc: "从背景与执行力构建创始团队画像" },
            ].map((item) => (
              <div key={item.name} style={{ background: "#fff", border: "1px solid #E8F0FD", borderRadius: "12px", padding: "20px" }}>
                <div style={{ fontWeight: "700", marginBottom: "6px", color: "#0D1B3E", fontSize: "15px" }}>{item.name}</div>
                <div style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "28px" }}>
            <Link href="/skills" style={{ color: "#1B6FE8", fontWeight: "600", fontSize: "16px", textDecoration: "none" }}>
              查看全部分析框架 →
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section style={{ textAlign: "center", background: "#0D1B3E", borderRadius: "16px", padding: "48px 32px", color: "#fff" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "12px" }}>
            把下一个项目放进 Aivestor
          </h2>
          <p style={{ color: "#9BB8E8", marginBottom: "28px", fontSize: "16px" }}>
            个人用户可直接注册并使用平台试用额度；机构团队可联系开通协作与数据能力。
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" style={{ background: "#1B6FE8", color: "#fff", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600" }}>
              立即注册
            </Link>
            <a href="mailto:Aivestor@qq.com" style={{ border: "2px solid #4A9EFF", color: "#4A9EFF", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600" }}>
              咨询机构版
            </a>
          </div>
        </section>

        <Footer />

      </main>
    </>
  );
}
