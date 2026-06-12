// 阿里云百炼 Qwen-VL 多模态调用：BP 内嵌图片 → 文字描述。
// 与 embedding.ts 同源：API Key 从环境变量 BAILIAN_API_KEY 读取，不走用户配置的 AI Key。
// 注意：BAILIAN_API_KEY 需在百炼控制台单独开通 Qwen-VL 模型调用权限。

const QWEN_VL_ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
// qwen-vl-plus 于 2026-07-13 下线；改用 qwen3.5-plus（原生多模态，支持 image_url 输入）。
// 注意：不要用 qwen-plus（纯文本模型，不接受图片输入）。
const QWEN_VL_MODEL = "qwen3.5-plus";

// 统一的图片描述 prompt：聚焦投资分析需要的信息
const IMAGE_PROMPT = `你正在协助分析一份商业计划书（BP），请描述这张图片中的关键信息：
- 如果是产品截图：描述产品功能、界面结构、核心交互
- 如果是数据图表：尽量读出具体数据、趋势、坐标轴含义
- 如果是商业模式图/架构图：描述各模块及其结构关系
- 如果是团队照片、装饰图等无信息量内容：一句话简要说明即可，不要详细描述人物外观
直接输出描述内容，不要客套语。`;

export interface ImageDescription {
  description: string;
  tokensIn: number;
  tokensOut: number;
}

export function isQwenVLAvailable(): boolean {
  return !!process.env.BAILIAN_API_KEY;
}

// 单张图片识别。失败返回 null（调用方跳过该图，不阻断整体流程）。
export async function describeImage(
  base64: string,
  mimeType: string
): Promise<ImageDescription | null> {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(QWEN_VL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_VL_MODEL,
        // qwen3.5-plus 默认开启思考链，单张图片描述会多烧 ~4000 推理 token；
        // 关闭后实测 token 降至 ~1/17，描述质量不受影响。
        enable_thinking: false,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
              { type: "text", text: IMAGE_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[qwenVL] 请求失败 ${res.status}: ${detail.slice(0, 500)}`);
      return null;
    }

    const data = await res.json();
    const description: string = data?.choices?.[0]?.message?.content?.trim();
    if (!description) {
      console.error("[qwenVL] 返回内容为空");
      return null;
    }
    return {
      description,
      tokensIn: Number(data?.usage?.prompt_tokens) || 0,
      tokensOut: Number(data?.usage?.completion_tokens) || 0,
    };
  } catch (e) {
    console.error("[qwenVL] 调用异常:", e);
    return null;
  }
}
