import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { buildEvolveInput } from "../src/evolve";
import { OPENAI_DESIGN_MODEL, OPENAI_IMAGE_GENERATION_MODEL } from "../src/models";
import { generateVariant } from "../src/variants";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("OpenAI model defaults", () => {
  test("design CLI defaults are centralized on current model IDs", () => {
    expect(OPENAI_DESIGN_MODEL).toBe("gpt-5.6");
    expect(OPENAI_IMAGE_GENERATION_MODEL).toBe("gpt-image-2");
  });

  test("evolve sends the screenshot as direct Responses image input", () => {
    const input = buildEvolveInput("abc123", "tighten the header") as any[];

    expect(input).toHaveLength(1);
    expect(input[0].content[0]).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,abc123",
      detail: "auto",
    });
    expect(input[0].content[1].text).toContain("tighten the header");
    expect(input[0].content[1].text).not.toContain("200 words");
  });

  test("image generation payload uses the centralized design and image models", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openai-models-"));
    const outputPath = path.join(tmpDir, "variant.png");
    let body: any;
    const fetchFn = (async (_input: any, init?: any) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output: [{ type: "image_generation_call", result: TINY_PNG_BASE64 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    try {
      const result = await generateVariant(
        "fake-key",
        "prompt",
        outputPath,
        "1024x1024",
        "high",
        fetchFn,
      );

      expect(result.success).toBe(true);
      expect(body.model).toBe(OPENAI_DESIGN_MODEL);
      expect(body.tools[0].model).toBe(OPENAI_IMAGE_GENERATION_MODEL);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
