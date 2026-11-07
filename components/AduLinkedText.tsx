import { ADU_QUOTE_URL } from "@/app/publicIdentity";

const ADU_NAME = "Boise ADU Co";

/** Visible company name links to the P5 ADU quote path. The underlying words stay plain. */
export function AduLinkedText({ text }: { text: string }) {
  const parts = text.split(ADU_NAME);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <span key={index}>
      {index > 0 ? (
        <a className="adu-quote-link" href={ADU_QUOTE_URL}>
          {ADU_NAME}
        </a>
      ) : null}
      {part}
    </span>
  ));
}
