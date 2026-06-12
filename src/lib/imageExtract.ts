// BP 内嵌图片提取：PDF（unpdf）/ PPTX / DOCX（zip 包 media 文件）。
// 仅在服务端运行（API 路由内调用）。
//
// 预筛选规则（控制 Qwen-VL 调用成本）：
//  - 宽或高 < MIN_IMAGE_DIMENSION 的图片跳过（大概率是图标/logo/装饰元素）
//  - 单文档最多处理 MAX_IMAGES_PER_DOC 张，超出按面积优先保留大图

import { deflateSync } from "zlib";

// —— 可调参数（建议值，可根据实测调整）——
export const MIN_IMAGE_DIMENSION = 100; // px，宽或高低于此值跳过
export const MAX_IMAGES_PER_DOC = 10; // 单文档图片数量上限
export const ESTIMATED_TOKENS_PER_IMAGE = 600; // 单张图片预估 token（量级参考）
// 实测（qwen3.5-plus + enable_thinking:false）：简单图 ~250 tokens，
// 含图表/截图的复杂图描述更长，取 600 作偏保守的量级估算。

export interface ExtractedImage {
  base64: string; // 图片内容（PNG/JPEG 等编码后）
  mimeType: string;
  position: string; // 来源位置描述，如「第3页」「幻灯片5」
  width: number;
  height: number;
}

export interface ImageExtractionResult {
  images: ExtractedImage[];
  skippedCount: number; // 超出数量上限被跳过的图片数（不含尺寸过小的）
}

// 支持图片提取的文档类型
export function supportsImageExtraction(fileType: string): boolean {
  return ["pdf", "pptx", "docx"].includes(fileType);
}

// ============================================================
// PNG 编码（unpdf 返回原始像素数据，无 sharp/canvas 依赖时手工编码）
// ============================================================

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// 原始像素（8bit，1=灰度 / 3=RGB / 4=RGBA 通道）→ PNG Buffer
function encodePNG(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3 | 4
): Buffer {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  // ihdr[10..12] = 0：compression / filter / interlace

  // 每行前置 filter byte 0（None）
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ============================================================
// 已编码图片（zip 包内 media 文件）的尺寸解析
// ============================================================

interface ImageMeta {
  width: number;
  height: number;
  mimeType: string;
}

// 解析 PNG / JPEG / GIF / BMP 头部获取像素尺寸；不支持的格式返回 null。
function parseImageMeta(buf: Buffer): ImageMeta | null {
  if (buf.length < 26) return null;

  // PNG: \x89PNG\r\n\x1a\n + IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      mimeType: "image/png",
    };
  }

  // JPEG: FFD8 开头，扫描 SOF 段
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      // SOF0-SOF15（排除 DHT/JPG/DAC）
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
          mimeType: "image/jpeg",
        };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2) return null;
      offset += 2 + segLen;
    }
    return null;
  }

  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return {
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
      mimeType: "image/gif",
    };
  }

  // BMP: BM
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return {
      width: buf.readInt32LE(18),
      height: Math.abs(buf.readInt32LE(22)),
      mimeType: "image/bmp",
    };
  }

  return null; // emf/wmf/webp 等暂不处理
}

// ============================================================
// PDF：unpdf 提取每页嵌入图片对象（非页面渲染图）
// ============================================================

async function extractPdfImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/",
    cMapPacked: true,
  });

  const results: ExtractedImage[] = [];
  const seenKeys = new Set<string>(); // 同一图片对象在多页复用（logo 等）只取一次

  for (let page = 1; page <= pdf.numPages; page++) {
    let pageImages;
    try {
      pageImages = await extractImages(pdf, page);
    } catch (e) {
      console.warn(`[imageExtract] PDF 第${page}页图片提取失败，跳过:`, e);
      continue;
    }
    for (const img of pageImages) {
      if (seenKeys.has(img.key)) continue;
      seenKeys.add(img.key);
      if (img.width < MIN_IMAGE_DIMENSION || img.height < MIN_IMAGE_DIMENSION) {
        continue;
      }
      try {
        const png = encodePNG(
          new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength),
          img.width,
          img.height,
          img.channels as 1 | 3 | 4
        );
        results.push({
          base64: png.toString("base64"),
          mimeType: "image/png",
          position: `第${page}页`,
          width: img.width,
          height: img.height,
        });
      } catch (e) {
        console.warn(`[imageExtract] PDF 第${page}页图片编码失败，跳过:`, e);
      }
    }
  }
  return results;
}

// ============================================================
// PPTX / DOCX：zip 包内 media 文件
// ============================================================

// PPTX：按幻灯片顺序解析 rels，定位每页引用的 media 图片
async function extractPptxImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  // 幻灯片编号 → 引用的 media 路径（按 slide 序号排序）
  const slideRels: { slide: number; mediaPath: string }[] = [];
  const relFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/.test(name)
  );
  relFiles.sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)/)![1], 10);
    const nb = parseInt(b.match(/slide(\d+)/)![1], 10);
    return na - nb;
  });

  for (const relFile of relFiles) {
    const slideNo = parseInt(relFile.match(/slide(\d+)/)![1], 10);
    const xml = await zip.files[relFile].async("string");
    const targets = xml.match(/Target="[^"]*media\/[^"]+"/g) ?? [];
    for (const t of targets) {
      const rel = t.replace(/^Target="/, "").replace(/"$/, "");
      // ../media/image1.png → ppt/media/image1.png
      const mediaPath = "ppt/" + rel.replace(/^(\.\.\/)+/, "");
      slideRels.push({ slide: slideNo, mediaPath });
    }
  }

  const results: ExtractedImage[] = [];
  const seen = new Set<string>(); // 同一 media 多页复用只取一次
  for (const { slide, mediaPath } of slideRels) {
    if (seen.has(mediaPath)) continue;
    seen.add(mediaPath);
    const entry = zip.files[mediaPath];
    if (!entry) continue;
    const buf = Buffer.from(await entry.async("uint8array"));
    const meta = parseImageMeta(buf);
    if (!meta) continue;
    if (meta.width < MIN_IMAGE_DIMENSION || meta.height < MIN_IMAGE_DIMENSION) {
      continue;
    }
    results.push({
      base64: buf.toString("base64"),
      mimeType: meta.mimeType,
      position: `幻灯片${slide}`,
      width: meta.width,
      height: meta.height,
    });
  }
  return results;
}

// DOCX：word/media/ 下的图片（次要支持，无精确位置信息）
async function extractDocxImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const mediaFiles = Object.keys(zip.files)
    .filter((name) => /^word\/media\//.test(name) && !zip.files[name].dir)
    .sort();

  const results: ExtractedImage[] = [];
  let index = 0;
  for (const name of mediaFiles) {
    const buf = Buffer.from(await zip.files[name].async("uint8array"));
    const meta = parseImageMeta(buf);
    if (!meta) continue;
    if (meta.width < MIN_IMAGE_DIMENSION || meta.height < MIN_IMAGE_DIMENSION) {
      continue;
    }
    index++;
    results.push({
      base64: buf.toString("base64"),
      mimeType: meta.mimeType,
      position: `文档图片${index}`,
      width: meta.width,
      height: meta.height,
    });
  }
  return results;
}

// ============================================================
// 入口：提取 + 预筛选 + 数量截取
// ============================================================

export async function extractDocumentImages(
  buffer: Buffer,
  fileType: string
): Promise<ImageExtractionResult> {
  let images: ExtractedImage[] = [];

  if (fileType === "pdf") {
    images = await extractPdfImages(buffer);
  } else if (fileType === "pptx") {
    images = await extractPptxImages(buffer);
  } else if (fileType === "docx") {
    images = await extractDocxImages(buffer);
  } else {
    return { images: [], skippedCount: 0 };
  }

  if (images.length <= MAX_IMAGES_PER_DOC) {
    return { images, skippedCount: 0 };
  }

  // 超出上限：按面积降序优先保留大图（信息量更高），再按出现顺序还原输出
  const indexed = images.map((img, i) => ({ img, i }));
  indexed.sort((a, b) => b.img.width * b.img.height - a.img.width * a.img.height);
  const picked = indexed.slice(0, MAX_IMAGES_PER_DOC);
  picked.sort((a, b) => a.i - b.i);

  return {
    images: picked.map((p) => p.img),
    skippedCount: images.length - MAX_IMAGES_PER_DOC,
  };
}
