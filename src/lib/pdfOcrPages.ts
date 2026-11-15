import {
  createIsomorphicCanvasFactory,
  getDocumentProxy,
  renderPageAsImage,
} from "unpdf";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// OCR needs the composed PDF page. Embedded image objects can be backgrounds,
// cropped fragments or reused decorations, and are not equivalent to pages.
const OCR_SCALE = 1.7;
const SAMPLE_STEP = 4;
const MIN_DARK_SAMPLES = 40;

export async function hasVisiblePageContent(png: Buffer): Promise<boolean> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let darkSamples = 0;
  for (let y = 0; y < image.height; y += SAMPLE_STEP) {
    for (let x = 0; x < image.width; x += SAMPLE_STEP) {
      const offset = (y * image.width + x) * 4;
      if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 220) {
        if (++darkSamples >= MIN_DARK_SAMPLES) return true;
      }
    }
  }
  return false;
}

export async function openPdfOcrPages(buffer: Buffer) {
  const canvasImport = () => import("@napi-rs/canvas");
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { CanvasFactory });
  return {
    pageCount: pdf.numPages,
    async render(page: number): Promise<Buffer> {
      const image = await renderPageAsImage(pdf, page, {
        scale: OCR_SCALE,
        canvasImport,
      });
      return Buffer.from(image);
    },
    async close() {
      await pdf.destroy();
    },
  };
}
