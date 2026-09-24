import { z } from 'zod';

export const taskNameSchema = z.object({
  name: z.string().min(1).max(12).describe('A short, recognizable name for this task, two to six characters in the language of the folder. It titles the work log and labels this task everywhere in the product.'),
  category: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[a-z][a-z0-9-]*$/)
    .describe('The kind of work, as a lowercase ASCII word. Use the project\'s own category list when its guide files define one; otherwise a stable word for this field of work, such as review, analysis or writing.'),
});

export const suggestionSchema = z.object({
  title: z.string().min(1).max(40).describe('The task, as a short name in the language of the folder.'),
  reason: z.string().min(1).max(200).describe('Which material, result or gap makes it worth doing.'),
  prompt: z.string().min(1).max(600).describe('The request that starts it, written as the user would send it.'),
});

export const planSchema = z.object({
  title: z.string().min(1).max(40).describe('The plan in a few words.'),
  basis: z.string().min(1).max(300).describe('Which material or fact makes this plan reasonable.'),
  risk: z.string().min(1).max(300).describe('The main way this plan could go wrong or what it gives up.'),
  prompt: z.string().min(1).max(800).describe('The instruction that starts this plan if the user picks it, written as the user would say it.'),
  fit: z.string().min(1).max(80).describe('One line in the language of the folder on the situation this plan suits: what would make someone pick it.'),
  caution: z.string().min(1).max(200).optional().describe('Only when this plan has a concrete problem worth warning the user about: the problem and what it rests on, in one line.'),
  detail: z.string().max(4000).optional().describe('The fuller plan in Markdown: steps, what gets produced, open points. Written into the plan file.'),
});
