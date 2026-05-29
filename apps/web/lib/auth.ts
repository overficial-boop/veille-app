import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { Resend } from 'resend';
import { db } from './db';
import { env } from './env';

const resend = new Resend(env.RESEND_API_KEY);

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: 'pg' }),
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await resend.emails.send({
          from: env.RESEND_FROM_EMAIL,
          to: email,
          subject: 'Votre lien de connexion Veille',
          html: `<p>Cliquez pour vous connecter à Veille :</p><p><a href="${url}">${url}</a></p><p>Ce lien expire bientôt.</p>`,
        });
      },
    }),
  ],
});
