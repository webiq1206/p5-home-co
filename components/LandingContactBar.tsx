import { OpenChatButton } from "./SiteChat";
import { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS, PUBLIC_PHONE_TEL } from "../app/publicIdentity";

/** Fixed call, chat, and text row for the full-screen estimator, which covers the page. */
export function LandingContactBar() {
  return (
    <nav className="estimator-contact" aria-label="Call or text">
      <a href={PUBLIC_PHONE_TEL}>Call {PUBLIC_PHONE_DISPLAY}</a>
      <OpenChatButton location="estimate">Chat</OpenChatButton>
      <a href={PUBLIC_PHONE_SMS}>Text {PUBLIC_PHONE_DISPLAY}</a>
    </nav>
  );
}
