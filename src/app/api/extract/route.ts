import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { extractedRecordResponseSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  image: z.string().startsWith("data:image/").max(12_000_000),
  prompt: z.string().min(20).max(10_000),
});

export async function POST(request: Request) {
  try {
    const config = readAgentConfig(request, "vision");
    const { image, prompt } = requestSchema.parse(await request.json());
    const data = await callStructured({
      config,
      schema: extractedRecordResponseSchema,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Распознай документ. Верни только JSON-объект: {"topic":"string","full_name":"string","birth_date":"string","address":"string","phone":"string","confidence_notes":"string"}. Все шесть ключей обязательны.',
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    });
    return Response.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const tooLarge = error.issues.some((issue) => issue.code === "too_big");
      return Response.json(
        { error: tooLarge ? "Изображение слишком большое для отправки." : "Некорректные данные изображения." },
        { status: tooLarge ? 413 : 400 },
      );
    }
    return apiError(error);
  }
}
