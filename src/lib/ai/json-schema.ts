import { z } from "zod";

// Gemini accepts a subset of JSON Schema for structured output and function parameters
// (see `responseJsonSchema` in @google/genai). Convert Zod -> JSON Schema, then keep only
// the supported keywords so requests never fail on e.g. `pattern` or `const`.
const SUPPORTED = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items",
  "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties",
  "additionalProperties", "required", "propertyOrdering", "nullable",
]);

type Json = Record<string, unknown>;

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "const") {
      out.enum = [v];
      if (typeof v === "string") out.type = "string";
      continue;
    }
    if (!SUPPORTED.has(k)) continue;
    if (k === "properties" || k === "$defs") {
      out[k] = Object.fromEntries(Object.entries(v as Json).map(([pk, pv]) => [pk, clean(pv)]));
    } else if (k === "additionalProperties" && typeof v === "boolean") {
      // `false` is the default for Gemini; omitting avoids rejections on some models.
      continue;
    } else {
      out[k] = clean(v);
    }
  }
  // Fold length hints into the description so the model still sees them.
  const hints: string[] = [];
  if (typeof src.maxLength === "number") hints.push(`max ${src.maxLength} characters`);
  if (typeof src.minLength === "number" && src.minLength > 1) hints.push(`min ${src.minLength} characters`);
  if (typeof src.pattern === "string") hints.push(`must match /${src.pattern}/`);
  if (hints.length) out.description = [out.description, `(${hints.join(", ")})`].filter(Boolean).join(" ");
  return out;
}

export function toGeminiSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json;
  return clean(raw) as Json;
}
