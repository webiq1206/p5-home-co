import { buildBusinessVCard, BUSINESS_VCARD_FILENAME } from "@/lib/vcard";

export const dynamic = "force-static";

export function GET() {
  const body = buildBusinessVCard();

  return new Response(body, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${BUSINESS_VCARD_FILENAME}"`,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
