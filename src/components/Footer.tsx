// 站点底脚组件
// 样式沿用 LandingPage 原内联底脚：字色 #666，字号 13px，居中。
// 包含品牌联系信息 + ICP 备案号（每个页面需展示备案号链接到 miit.gov.cn）。
export default function Footer() {
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
      <div>北京链上文投信息技术有限公司</div>
      <div>
        <a
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666", textDecoration: "none" }}
        >
          京ICP备2026011107号-3
        </a>
      </div>
    </footer>
  );
}
