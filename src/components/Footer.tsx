// 站点底脚组件（仅 Landing Page 使用）
// 样式：字色 #666，字号 13px，居中。
// 含工商主体 + ICP 备案 + 公安网安备案。
//
// 登录后的 app 内页面不展示备案信息（运营决策）；
// 因此本组件不在 (app) / (auth) 布局中挂载，由 LandingPage 自己引用。

import { BRAND } from "@/lib/brand";

export default function Footer() {
  const { publicSecurityFiling } = BRAND.compliance;

  return (
    <footer
      style={{
        textAlign: "center",
        color: "#666",
        fontSize: "13px",
        lineHeight: 1.8,
        padding: "20px 16px",
      }}
    >
      <div>{BRAND.legalName}</div>
      <div>
        <a
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666", textDecoration: "none" }}
        >
          {BRAND.compliance.icpFiling}
        </a>
        {publicSecurityFiling ? (
          <>
            <span style={{ margin: "0 8px", color: "#bbb" }}>·</span>
            <a
              href={publicSecurityFiling.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#666",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://beian.mps.gov.cn/web/assets/logo01.dd7ff50a.png"
                alt=""
                width={14}
                height={14}
                style={{ display: "block" }}
              />
              {publicSecurityFiling.number}
            </a>
          </>
        ) : null}
      </div>
      <div className="text-xs text-gray-400 mt-1">
        AI 辅助生成内容可能存在误差，重要投资决策请以原始文件及专业判断为准
      </div>
    </footer>
  );
}
