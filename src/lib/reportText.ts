/** 只移除真实 HTML 标签，保留“<3”“毛利率<30%”等比较表达。 */
export function stripActualHtmlTags(value: string): string {
  return value.replace(/<\/?[A-Za-z][^<>]*>/g, "");
}

/** 统一中文标点前的多余空格；代码围栏中的内容保持原样。 */
export function normalizeChineseTypography(value: string): string {
  let inFence = false;
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .replace(/[ \t]+([，。；：！？、）】》])/g, "$1")
        .replace(/([（【《])[ \t]+/g, "$1")
        .replace(/[ \t]{2,}/g, " ");
    })
    .join("\n");
}
