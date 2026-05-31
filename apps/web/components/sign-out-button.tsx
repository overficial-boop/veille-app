'use client';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await authClient.signOut();
        location.href = '/sign-in';
      }}
      className="btn btn-ghost btn-sm"
    >
      Déconnexion
    </button>
  );
}
