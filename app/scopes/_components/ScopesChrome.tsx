/**
 * The scope platform's own header. It deliberately has no admin menu: a
 * scopes-only account (a contractor) must never be shown a way into the
 * admin panel. Employees get one link back to it.
 */

import Link from "next/link";

import type { ScopeUser } from "../../lib/auth.ts";

export default function ScopesChrome({ user }: { user: ScopeUser }) {
  return (
    <header className="admin-bar">
      <Link href="/scopes" className="admin-brand">
        P5 <small>Scopes</small>
      </Link>
      <span className="admin-bar-right">
        {!user.scopesOnly && (
          <Link href="/admin" className="sc-bar-link">
            Admin
          </Link>
        )}
        <span className="admin-who">{user.fullName}</span>
        <form action="/api/auth/signout?next=scopes" method="post">
          <button type="submit" className="admin-signout">
            Sign out
          </button>
        </form>
      </span>
    </header>
  );
}
