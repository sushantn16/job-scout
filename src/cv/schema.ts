import { z } from "zod";

// Bullet and profile text may mark emphasis with **double asterisks**; the renderer turns it into <strong>.
const Text = z.string().min(1);

export const Bullet = z.object({ id: z.string(), text: Text });

export const Experience = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string(),
  bullets: z.array(Bullet).min(1),
});

export const Cv = z.object({
  basics: z.object({
    name: z.string(),
    title: z.string(),
    email: z.string(),
    phone: z.string(),
    linkedin: z.string(),
    location: z.string(),
    photo: z.string().optional().describe("Path relative to the CV JSON file"),
    /** Headlines the tailor may choose from; the first is the default. Anything else is never used. */
    headlines: z.array(z.string()).optional(),
  }),
  profile: Text,
  skills: z.array(z.object({ id: z.string(), label: z.string(), items: z.array(z.string()).min(1) })),
  experience: z.array(Experience).min(1),
  education: z.array(
    z.object({ id: z.string(), degree: z.string(), school: z.string(), year: z.string(), location: z.string() }),
  ),
});

export type Cv = z.infer<typeof Cv>;
