import { Type, type Schema } from "@google/genai";
import { AI_FIELDS } from "@/core/fields";

/**
 * Builds Gemini's response schema straight from core/fields.ts.
 *
 * This is why adding a column is a one-line change: the schema, the sheet headings
 * and the review form all read from the same list, so they cannot drift apart.
 *
 * Every property is nullable on purpose. `null` means "the trader didn't say" —
 * which is different from zero, and must never be filled in with a guess.
 */
function tradeSchema(): Schema {
  const properties: Record<string, Schema> = {};

  for (const field of AI_FIELDS) {
    const base = { description: field.desc, nullable: true };

    properties[field.key] =
      field.type === "number"
        ? { ...base, type: Type.NUMBER }
        : field.type === "enum"
          ? { ...base, type: Type.STRING, enum: [...(field.values ?? [])] }
          : { ...base, type: Type.STRING };
  }

  return {
    type: Type.OBJECT,
    properties,
    propertyOrdering: AI_FIELDS.map((f) => f.key),
  };
}

/**
 * The response is always a LIST of trades, even when there is only one.
 *
 * One message often describes several trades ("took gold in the morning, then shorted
 * Nifty later"). Making the list the only shape means the multi-trade case is the normal
 * path rather than a special case bolted on — a single trade is just a list of one.
 */
export function buildResponseSchema(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      trades: {
        type: Type.ARRAY,
        description:
          "One entry per distinct trade described. Usually one. Use several only when " +
          "the trader clearly took separate positions.",
        items: tradeSchema(),
      },
    },
    required: ["trades"],
  };
}
