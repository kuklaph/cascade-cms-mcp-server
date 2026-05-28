import { z } from "zod";

const strictObjectFromShape = (
  shape: z.ZodRawShape,
  description: string | undefined,
) => {
  const objectSchema = z.object(shape).strict();
  return description ? objectSchema.describe(description) : objectSchema;
};

const requireField = (field: z.ZodTypeAny): z.ZodTypeAny =>
  field instanceof z.ZodOptional ? (field.unwrap() as z.ZodTypeAny) : field;

export const objectWithRequiredAlternatives = (
  shape: z.ZodRawShape,
  groups: string[][],
  description: string | undefined,
): z.ZodTypeAny => {
  const applicableGroups = groups.filter((group) =>
    group.every((field) => Object.hasOwn(shape, field)),
  );
  if (applicableGroups.length === 0) {
    return strictObjectFromShape(shape, description);
  }

  const variants: z.ZodObject<z.ZodRawShape>[] = [];
  const visit = (index: number, variantShape: z.ZodRawShape) => {
    if (index === applicableGroups.length) {
      variants.push(strictObjectFromShape(variantShape, description));
      return;
    }

    for (const field of applicableGroups[index]) {
      visit(index + 1, {
        ...variantShape,
        [field]: requireField(variantShape[field] as z.ZodTypeAny),
      });
    }
  };

  visit(0, shape);
  if (variants.length === 1) return variants[0];
  return z.union(
    variants as [
      z.ZodObject<z.ZodRawShape>,
      z.ZodObject<z.ZodRawShape>,
      ...z.ZodObject<z.ZodRawShape>[],
    ],
  );
};
