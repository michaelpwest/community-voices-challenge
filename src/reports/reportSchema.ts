import { z } from 'zod';
import type { Report } from '../shared/reports';

const text = z.string().trim().min(1);
const sources = z.array(z.string()).max(20);

/** What the model must return. The same schema is used for baseline and RAG runs. */
export const reportSchema = z.object({
  summary: text,
  themes: z
    .array(z.object({ title: text, description: text, sources }))
    .min(1)
    .max(8),
  predictions: z
    .array(
      z.object({
        prediction: text,
        rationale: text,
        confidence: z.enum(['low', 'medium', 'high']),
        sources,
      }),
    )
    .min(1)
    .max(8),
  limitations: z.array(text).max(8),
});

/** The same schema in the JSON Schema form that Ollama uses to constrain the model's output. */
export const reportJsonSchema: unknown = z.toJSONSchema(reportSchema);

export class ReportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportFormatError';
  }
}

/** Parses and validates the model's reply. Throws ReportFormatError when it is not a usable report. */
export function parseReport(modelOutput: string): Report {
  let json: unknown;
  try {
    json = JSON.parse(modelOutput);
  } catch {
    throw new ReportFormatError('The model did not return valid JSON.');
  }
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'report'}: ${issue.message}`)
      .join('; ');
    throw new ReportFormatError(`The model returned a report in an unexpected shape (${problems}).`);
  }
  return parsed.data;
}
