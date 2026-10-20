/**
 * Резолвер Zod для react-hook-form без @hookform/resolvers
 * (у него конфликт peer-зависимостей с zod 4 / effect).
 */
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

export function zodResolver<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
): Resolver<z.input<TSchema>, unknown, z.output<TSchema>> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join(".") || "root";
      // Первое сообщение по пути — как у @hookform/resolvers без criteriaMode: all.
      if (!(path in errors)) errors[path] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<z.input<TSchema>> };
  };
}
