import { PUBLIC_EMAIL } from "../publicIdentity.ts";

/** The details that let us find the project and the problem without a second round of questions. */
export const HELP_EMAIL_SUBJECT = "Help with a completed project";
export const HELP_EMAIL_BODY = [
  "Name:",
  "Project address:",
  "Affected item and location:",
  "When it started:",
  "Description:",
  "Photos (please attach any you have):",
].join("\n");
export const HELP_MAILTO = `mailto:${PUBLIC_EMAIL}?subject=${encodeURIComponent(HELP_EMAIL_SUBJECT)}&body=${encodeURIComponent(HELP_EMAIL_BODY)}`;
