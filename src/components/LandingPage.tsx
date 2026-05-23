"use client";
import Link from "next/link";

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
            "description": "面向一级股权投资专业人员的AI增强型工作台。支持BP分析、私有知识库、投资判断沉淀、跨会话记忆。数据主权归用户。",
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
              "name": "北京链上文投有限公司",
              "email": "Aivestor@qq.com"
            },
            "featureList": [
              "BP智能分析与报告生成",
              "私有知识库（向量检索）",
              "投资判断记录与回溯",
              "跨会话AI记忆",
              "SKILL分析框架市场",
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
          <p style={{ fontSize: "22px", color: "#1B6FE8", fontWeight: "600", marginBottom: "16px" }}>
            投资人的 AI 增强工作台
          </p>
          <p style={{ fontSize: "17px", color: "#666", lineHeight: "1.7", maxWidth: "600px", margin: "0 auto 32px" }}>
            不只是生成报告——把你每一次投资判断沉淀成可调用的资产。<br />
            私有知识库越用越懂你，三年后还能看到当初怎么判断的。
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" style={{ background: "#1B6FE8", color: "#fff", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600", fontSize: "16px" }}>
              申请内测
            </Link>
            <Link href="/demo/consumer" style={{ border: "2px solid #1B6FE8", color: "#1B6FE8", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600", fontSize: "16px" }}>
              查看示例报告 →
            </Link>
          </div>
        </section>

        {/* 解决的问题 */}
        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "32px", textAlign: "center", color: "#0D1B3E" }}>
            为什么投资人不该直接用 ChatGPT 做尽调
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
            {[
              { title: "分析结论无法沉淀", desc: "每次分析BP都从头开始，历史判断散落在邮件和记忆里，无法检索，无法复用" },
              { title: "通用AI不懂你的逻辑", desc: "ChatGPT不知道你的投资偏好、关注赛道、历史踩坑，每次都要重新解释背景" },
              { title: "个人认知演变不可见", desc: "做了5年投资，你的判断框架进化了多少？哪类项目你持续高估？没有数据，只有感觉" },
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
              { icon: "📄", title: "BP 分析报告", desc: "上传BP，生成结构化七章节分析，支持Word/PPT导出" },
              { icon: "🧠", title: "私有知识库", desc: "判断自动沉淀，语义检索，越用越懂你" },
              { icon: "🎯", title: "投资判断中心", desc: "多空记录、Outcome追踪、认知盲区识别" },
              { icon: "🛠", title: "SKILL 市场", desc: "20+官方分析框架，支持自定义与分享" },
              { icon: "💬", title: "跨会话记忆", desc: "AI记住你的投资偏好，无需每次重新介绍背景" },
              { icon: "🔒", title: "数据主权", desc: "用户自带API Key，数据不经第三方，支持私有部署" },
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
                  ["上下文记忆", "每次对话从零开始", "跨会话记忆你的投资偏好与历史"],
                  ["数据归属", "数据在 OpenAI 服务器", "数据主权归用户，支持私有部署"],
                  ["历史沉淀", "分析完即消失", "每次判断留存，可回溯，可对比"],
                  ["个人化程度", "对所有用户一样", "越用越懂你的投资逻辑"],
                  ["专业工作流", "单轮对话，结构松散", "完整工作台：上传→分析→存档→检索"],
                  ["决策辅助", "需要自己设计prompt", "内置多角度质疑框架"],
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
                q: "我的投资分析数据安全吗？会被平台看到吗？",
                a: "不会。Aivestor采用“用户自带API Key”模式——AI调用从你自己的账号发出，平台不持有你的对话内容。数据库加密存储，API Key用AES-256-GCM加密。我们正在开发本地化部署版本（Docker+本地模型），届时数据完全不离开你的服务器。"
              },
              {
                q: "支持哪些 AI 模型？必须用某个特定模型吗？",
                a: "不绑定任何模型。目前支持DeepSeek、OpenAI、Claude、通义千问、智谱AI、Moonshot。新用户可使用平台提供的免费额度（绑定手机号后激活），无需立即配置自己的API Key。"
              },
              {
                q: "适合什么阶段的投资机构？个人投资人能用吗？",
                a: "都可以。产品面向所有一级股权投资从业者：VC/PE分析师、投资经理、合伙人，以及活跃的天使投资人。机构团队版（多人协作、机构知识库）在路线图中，目前以个人版为主。"
              },
              {
                q: "知识库里的内容是怎么产生的？需要手动维护吗？",
                a: "主要靠自动沉淀，无需手动维护。每次AI分析报告完成后，关键判断会自动提炼为知识条目；对话达到一定轮次后，系统会自动生成认知摘要写入知识库。你也可以手动添加行业观点或投资论点。"
              },
              {
                q: "SKILL 市场是什么？",
                a: "投资分析框架的模板库。平台内置20+官方SKILL，覆盖消费、SaaS、医疗、硬件等细分赛道，每个SKILL定义了分析该类项目的结构化问题框架。你可以直接使用官方框架，也可以自定义、导入导出，或让AI根据你的历史判断自动生成专属框架。"
              },
              {
                q: "现在可以使用吗？怎么申请？",
                a: "目前处于邀请制内测阶段。发邮件到 Aivestor@qq.com 申请，注明你的机构背景和投资阶段，内测用户享有免费使用额度和直接反馈渠道。域名 aivestor.cn 备案中，正式上线后开放注册。"
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

        {/* CTA */}
        <section style={{ textAlign: "center", background: "#0D1B3E", borderRadius: "16px", padding: "48px 32px", color: "#fff" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "12px" }}>
            加入内测
          </h2>
          <p style={{ color: "#9BB8E8", marginBottom: "28px", fontSize: "16px" }}>
            面向一级市场从业者开放，内测用户享有免费使用额度
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login" style={{ background: "#1B6FE8", color: "#fff", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600" }}>
              立即注册
            </Link>
            <a href="mailto:Aivestor@qq.com" style={{ border: "2px solid #4A9EFF", color: "#4A9EFF", padding: "12px 28px", borderRadius: "8px", textDecoration: "none", fontWeight: "600" }}>
              发邮件申请
            </a>
          </div>
          <p style={{ color: "#666", fontSize: "13px", marginTop: "20px" }}>
            aivestor.cn · Aivestor@qq.com · 北京链上文投有限公司
          </p>
        </section>

      </main>
    </>
  );
}
