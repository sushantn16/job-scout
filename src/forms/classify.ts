// Sort form fields by who answers them. Rules only: profile fields come from the CV, uploads are the tailored files,
// consent and demographic questions are always yours, and only real questions go to the LLM.
import type { Cv } from "../cv/schema.ts";
import type { FormField } from "./read.ts";

export type FieldKind = "profile" | "upload" | "consent" | "demographic" | "question";

const DEMOGRAPHIC = /\b(gender|pronoun|ethnic|race|racial|sexual orientation|transgender|disabilit|veteran|armed forces|age range|date of birth)\b/i;
const CONSENT = /privacy|consent|acknowledge|\bi agree\b|agree to|terms and conditions|\bgdpr\b|data protection|future (job )?(opportunit|opening|role)|contact me about|double-check|information provided above/i;
const PROFILE: [RegExp, keyof ProfileValues][] = [
  [/^(full |preferred |legal )?name$/i, "name"],
  [/^first name$|^given name$|^vorname$/i, "firstName"],
  [/^last name$|^family name$|^surname$|^nachname$/i, "lastName"],
  [/^(e-?mail|email address|e-mail address)$/i, "email"],
  [/^(phone|mobile|phone number|mobile number|telefon)$/i, "phone"],
  [/linkedin/i, "linkedin"],
  [/github/i, "github"],
  [/^(website|personal website|portfolio|other website|portfolio url|website url)$/i, "website"],
  [/^(home )?address$|^postal address$/i, "address"],
  [/^(city|current location|location|location \(city\)|current city)$/i, "location"],
  [/^current (company|employer)$/i, "currentCompany"],
];

export interface ProfileValues {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  github?: string;
  website?: string;
  address?: string;
  location: string;
  currentCompany?: string;
}

export function kindOf(f: Pick<FormField, "question" | "type" | "options">): FieldKind {
  if (f.type === "file") return "upload";
  if (DEMOGRAPHIC.test(f.question) || f.options?.some((o) => /^(he\/him|she\/her|they\/them)$/i.test(o))) return "demographic";
  if (CONSENT.test(f.question) && f.type !== "textarea") return "consent";
  if (PROFILE.some(([rx]) => rx.test(f.question))) return "profile";
  return "question";
}

/** The profile fields a form may ask for, from the CV plus saved answers (GitHub, website, address). */
export function profileValues(cv: Cv, saved: Record<string, string>): ProfileValues {
  const [firstName = "", ...rest] = cv.basics.name.split(/\s+/);
  const current = cv.experience.find((r) => /present|now|heute|current/i.test(r.end));
  const url = (s: string) => (s && !/^https?:\/\//.test(s) ? `https://${s}` : s);
  return {
    name: cv.basics.name, firstName, lastName: rest.join(" "), email: cv.basics.email, phone: cv.basics.phone,
    linkedin: url(cv.basics.linkedin), location: cv.basics.location,
    ...(saved.github ? { github: url(saved.github) } : {}),
    ...(saved.website ? { website: url(saved.website) } : {}),
    ...(saved.address ? { address: saved.address } : {}),
    ...(current ? { currentCompany: current.company } : {}),
  };
}

export const profileKey = (question: string): keyof ProfileValues | null => PROFILE.find(([rx]) => rx.test(question))?.[1] ?? null;
