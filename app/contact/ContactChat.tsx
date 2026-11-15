"use client";

import { familyButtonClass } from "@/components/family/Button";
import { FAMILY_BRAND } from "@/lib/familyBrand";

/** Opens the same chat the header and footer use. */
export function ContactChat() {
  return (
    <button
      type="button"
      className={familyButtonClass({ variant: "secondary", size: "lg" })}
      onClick={() => window.dispatchEvent(new Event(FAMILY_BRAND.chat.openEvent))}
    >
      Chat
    </button>
  );
}
