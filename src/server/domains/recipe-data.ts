import { z } from "zod";

const optionalNumber = z.number().nonnegative().nullable().optional();

export const tagsSchema = z.array(z.string().trim().min(1).max(100)).max(40);

export const nutritionSchema = z.strictObject({
  calories: optionalNumber,
  protein_g: optionalNumber,
  carbs_g: optionalNumber,
  fat_g: optionalNumber,
  fiber_g: optionalNumber,
  sugar_g: optionalNumber,
  sodium_mg: optionalNumber,
  serving_size: z.string().trim().max(200).nullable().optional(),
  glycemic_load: optionalNumber,
  weight_per_serving_g: optionalNumber
});

export function storedJsonSchema<T extends z.ZodType>(
  schema: T,
  maximumLength: number
) {
  return z.string().max(maximumLength).superRefine((raw, context) => {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        context.addIssue({ code: "custom", message: "JSON does not match the expected structure" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "Value must be valid JSON" });
    }
  });
}
