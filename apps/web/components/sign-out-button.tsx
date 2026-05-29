'use client';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await authClient.signOut();
        location.href = '/sign-in';
      }}
      className="text-muted-foreground hover:text-foreground text-sm underline"
    >
      Se déconnecter
    </button>
  );
}
