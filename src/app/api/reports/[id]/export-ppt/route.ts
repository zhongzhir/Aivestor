import { NextResponse } from "next/server";
import pptxgen from "pptxgenjs";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { stripSourceBadges } from "@/lib/reportBadges";
import { extractConfidence } from "@/lib/reportConfidence";
import {
  buildAccessScope,
  scopedProjectChildWhere,
} from "@/lib/resourceAccess";
import type { FinancialData } from "@/lib/types";

// 品牌色
const NAVY = "0D1B3E";
const ORANGE = "FF6B35";
const WHITE = "FFFFFF";
const INK = "1F2937";
const INK_SOFT = "4B5563";
const CARD_BG = "F4F5F7";

interface Section {
  title: string;
  bullets: string[];
  paragraphs: string[];
}

// 去除行内 **加粗** 标记
function stripInline(text: string): string {
  return text.replace(/\*\*/g, "").trim();
}

// 将 Markdown 报告按 ## 标题切分为章节
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      current = { title: stripInline(line.slice(3)), bullets: [], paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("# ")) continue; // 顶级标题忽略，封面已展示项目名

    if (!current) {
      current = { title: "概述", bullets: [], paragraphs: [] };
      sections.push(current);
    }

    if (/^[-*]\s+/.test(line)) {
      current.bullets.push(stripInline(line.replace(/^[-*]\s+/, "")));
    } else if (line.startsWith("### ")) {
      current.paragraphs.push(stripInline(line.slice(4)));
    } else {
      current.paragraphs.push(stripInline(line));
    }
  }
  return sections;
}

// GET /api/reports/[id]/export-ppt — 导出投委会 PPT
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 报告可见性跟随项目；analyst 不可见 kind='committee'。个人版退化等价。
  const scope = await buildAccessScope(session.user.id);
  const child = scopedProjectChildWhere(scope, 2, {
    alias: "r",
    excludeMergedForAnalyst: true,
  });
  const rows = await query<{
    title: string;
    content: string;
    project_name: string;
    industry: string;
    stage: string;
    financial_data: FinancialData | null;
  }>(
    `SELECT r.title, r.content, p.name AS project_name,
            p.industry, p.stage, p.financial_data
     FROM reports r JOIN projects p ON p.id = r.project_id
     WHERE r.id = $1 AND ${child.sql}`,
    [params.id, ...child.params]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  const report = rows[0];
  const sections = parseSections(
    stripSourceBadges(extractConfidence(report.content).cleanContent)
  );

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 英寸
  pptx.author = "Aivestor 投资工作台";

  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // —— 封面页 ——
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText("AIVESTOR", {
    x: 0.7,
    y: 0.5,
    w: 4,
    h: 0.5,
    fontSize: 16,
    bold: true,
    color: ORANGE,
    charSpacing: 3,
  });
  cover.addText(report.project_name, {
    x: 0.7,
    y: 2.6,
    w: 11.9,
    h: 1.6,
    fontSize: 48,
    bold: true,
    color: WHITE,
  });
  const meta = [report.industry, report.stage].filter(Boolean).join("  ·  ");
  if (meta) {
    cover.addText(meta, {
      x: 0.7,
      y: 4.3,
      w: 11.9,
      h: 0.6,
      fontSize: 22,
      color: ORANGE,
    });
  }
  cover.addText(report.title, {
    x: 0.7,
    y: 5.0,
    w: 11.9,
    h: 0.5,
    fontSize: 16,
    color: "AAB2C5",
  });
  cover.addText(`投资委员会评审  |  ${today}`, {
    x: 0.7,
    y: 6.6,
    w: 11.9,
    h: 0.4,
    fontSize: 13,
    color: "AAB2C5",
  });

  // —— 目录页 ——
  const toc = pptx.addSlide();
  toc.background = { color: WHITE };
  toc.addText("目录", {
    x: 0.7,
    y: 0.6,
    w: 11.9,
    h: 0.8,
    fontSize: 30,
    bold: true,
    color: NAVY,
  });
  toc.addShape(pptx.ShapeType.line, {
    x: 0.7,
    y: 1.5,
    w: 1.2,
    h: 0,
    line: { color: ORANGE, width: 3 },
  });
  sections.forEach((s, i) => {
    const rowY = 1.95 + i * 0.7;
    if (rowY > 7) return; // 超出页面则不再列出
    toc.addShape(pptx.ShapeType.ellipse, {
      x: 0.7,
      y: rowY,
      w: 0.5,
      h: 0.5,
      fill: { color: NAVY },
    });
    toc.addText(String(i + 1), {
      x: 0.7,
      y: rowY,
      w: 0.5,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: WHITE,
      align: "center",
      valign: "middle",
    });
    toc.addText(s.title, {
      x: 1.45,
      y: rowY,
      w: 10.8,
      h: 0.5,
      fontSize: 18,
      color: INK,
      valign: "middle",
    });
  });

  // —— 财务概览页（financial_data 存在且有内容时插入）——
  const fd = report.financial_data;
  const hasFinancials =
    !!fd &&
    ((fd.revenue?.length ?? 0) > 0 ||
      (fd.valuation?.length ?? 0) > 0 ||
      (fd.key_metrics?.length ?? 0) > 0);

  if (hasFinancials && fd) {
    const fin = pptx.addSlide();
    fin.background = { color: WHITE };
    fin.addText("财务概览", {
      x: 0.7,
      y: 0.6,
      w: 11.9,
      h: 0.8,
      fontSize: 30,
      bold: true,
      color: NAVY,
    });
    fin.addShape(pptx.ShapeType.line, {
      x: 0.7,
      y: 1.5,
      w: 1.2,
      h: 0,
      line: { color: ORANGE, width: 3 },
    });

    let finY = 1.95;

    // 近三年收入（大字展示）
    const revenue = (fd.revenue ?? []).slice(-3);
    if (revenue.length > 0) {
      fin.addText("近三年收入", {
        x: 0.7,
        y: finY,
        w: 11.9,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: INK_SOFT,
      });
      revenue.forEach((r, i) => {
        const bx = 0.7 + i * 4.05;
        fin.addText(String(r.year), {
          x: bx,
          y: finY + 0.5,
          w: 3.8,
          h: 0.4,
          fontSize: 14,
          color: INK_SOFT,
        });
        fin.addText(`${r.value} ${fd.unit ?? ""}`.trim(), {
          x: bx,
          y: finY + 0.85,
          w: 3.8,
          h: 0.8,
          fontSize: 32,
          bold: true,
          color: NAVY,
        });
      });
      finY += 2.0;
    }

    // 估值信息
    const valuation = fd.valuation ?? [];
    if (valuation.length > 0) {
      const latest = valuation[valuation.length - 1];
      fin.addText("最新估值", {
        x: 0.7,
        y: finY,
        w: 11.9,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: INK_SOFT,
      });
      fin.addText(
        `${latest.value} ${latest.unit ?? ""}${
          latest.round ? `（${latest.round}）` : ""
        }`.trim(),
        {
          x: 0.7,
          y: finY + 0.4,
          w: 11.9,
          h: 0.7,
          fontSize: 26,
          bold: true,
          color: ORANGE,
        }
      );
      finY += 1.5;
    }

    // 核心指标卡片（最多 4 个）
    const metrics = (fd.key_metrics ?? []).slice(0, 4);
    if (metrics.length > 0) {
      fin.addText("核心指标", {
        x: 0.7,
        y: finY,
        w: 11.9,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: INK_SOFT,
      });
      const mCardW = 2.9;
      const mGap = 0.13;
      metrics.forEach((m, i) => {
        const mx = 0.7 + i * (mCardW + mGap);
        const my = finY + 0.5;
        fin.addShape(pptx.ShapeType.roundRect, {
          x: mx,
          y: my,
          w: mCardW,
          h: 1.3,
          fill: { color: CARD_BG },
          line: { color: "E5E7EB", width: 1 },
          rectRadius: 0.08,
        });
        fin.addText(m.label, {
          x: mx + 0.2,
          y: my + 0.15,
          w: mCardW - 0.4,
          h: 0.4,
          fontSize: 11,
          color: INK_SOFT,
        });
        fin.addText(m.value, {
          x: mx + 0.2,
          y: my + 0.5,
          w: mCardW - 0.4,
          h: 0.6,
          fontSize: 20,
          bold: true,
          color: NAVY,
        });
      });
    }
  }

  // —— 内容页 ——
  // 内容区：y 1.9 起，可用高度 5.2 英寸（下边界 7.1，留出页眉页脚）
  const CONTENT_TOP = 1.9;
  const CONTENT_MAX_H = 5.2;

  function addContentSlide(section: Section, index: number) {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    slide.addText(`${String(index + 1).padStart(2, "0")}`, {
      x: 0.7,
      y: 0.45,
      w: 1.5,
      h: 0.5,
      fontSize: 18,
      bold: true,
      color: ORANGE,
    });
    slide.addText(section.title, {
      x: 0.7,
      y: 0.8,
      w: 11.9,
      h: 0.8,
      fontSize: 26,
      bold: true,
      color: NAVY,
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.7,
      y: 1.65,
      w: 11.9,
      h: 0,
      line: { color: "E5E7EB", width: 1 },
    });

    const cardW = 5.78;
    const cardH = 1.5;
    const gapX = 0.34;
    const gapY = 0.3;

    // 要点卡片：每行 2 列，最多 4 张（2 行 x 2 列），超出截断不显示
    const visibleCards = section.bullets.slice(0, 4);
    const cardRows = Math.ceil(visibleCards.length / 2);
    const cardsBlockH =
      cardRows > 0 ? cardRows * cardH + (cardRows - 1) * gapY : 0;

    let cursorY = CONTENT_TOP;

    // 正文段落：最多 4.0 英寸，且不挤占卡片区，超出固定高度的文字自动截断
    if (section.paragraphs.length > 0) {
      const paraH = Math.min(
        4.0,
        CONTENT_MAX_H - cardsBlockH - (cardsBlockH > 0 ? 0.2 : 0)
      );
      slide.addText(
        section.paragraphs.map((p) => ({
          text: p,
          options: { breakLine: true },
        })),
        {
          x: 0.7,
          y: cursorY,
          w: 11.9,
          h: paraH,
          fontSize: 14,
          color: INK_SOFT,
          lineSpacingMultiple: 1.3,
          valign: "top",
        }
      );
      cursorY += paraH + 0.2;
    }

    // 要点卡片网格
    visibleCards.forEach((b, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = 0.7 + col * (cardW + gapX);
      const cy = cursorY + row * (cardH + gapY);
      slide.addShape(pptx.ShapeType.roundRect, {
        x: cx,
        y: cy,
        w: cardW,
        h: cardH,
        fill: { color: CARD_BG },
        line: { color: "E5E7EB", width: 1 },
        rectRadius: 0.08,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: cx,
        y: cy,
        w: 0.09,
        h: cardH,
        fill: { color: ORANGE },
      });
      slide.addText(b, {
        x: cx + 0.28,
        y: cy,
        w: cardW - 0.5,
        h: cardH,
        fontSize: 13,
        color: INK,
        valign: "middle",
        lineSpacingMultiple: 1.2,
      });
    });
  }

  sections.forEach((section, index) => {
    addContentSlide(section, index);
  });

  // —— 结尾页 ——
  const end = pptx.addSlide();
  end.background = { color: NAVY };
  end.addText("感谢审阅", {
    x: 0.7,
    y: 3.0,
    w: 11.9,
    h: 1.2,
    fontSize: 44,
    bold: true,
    color: WHITE,
    align: "center",
  });
  end.addText("AIVESTOR  投资工作台", {
    x: 0.7,
    y: 4.3,
    w: 11.9,
    h: 0.5,
    fontSize: 15,
    color: ORANGE,
    align: "center",
    charSpacing: 2,
  });

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const filename = encodeURIComponent(`${report.project_name}-投委会.pptx`);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
