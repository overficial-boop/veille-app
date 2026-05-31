/**
 * Instant loading skeleton for the dossier route.
 *
 * Next renders this the moment a dossier link is clicked (the route's implicit
 * Suspense boundary) and streams in the real page once the server render + DB
 * fetch finish — so navigation feels immediate instead of leaving the previous
 * page frozen with no feedback. It mirrors the real dossier layout (shell + top
 * bar + head + rail/brief) so the swap to actual content doesn't jump.
 *
 * Note: in dev the *first* visit to this route still pays a one-time on-demand
 * compile before anything (including this fallback) can show; that cost is
 * dev-only and never happens in production.
 */
import { VeilleGlyph } from '@/components/veille-ui';

/** A shimmer block. `.skel` carries the animation; props tune the box. */
function Skel({
  w,
  h,
  mb,
}: {
  w?: string | number;
  h?: string | number;
  mb?: string | number;
}) {
  return <div className="skel" style={{ width: w, height: h, marginBottom: mb }} />;
}

export default function DossierLoading() {
  return (
    <div className="shell">
      {/* Static top bar so it doesn't disappear mid-navigation. The account
          area shimmers (we don't have the session here); it fills in with the
          real page. */}
      <div className="topbar">
        <a href="/" className="wordmark" aria-label="Veille — accueil">
          <VeilleGlyph size={22} />
          Veille
        </a>
        <div className="topbar-spacer" />
        <div className="topbar-acct">
          <Skel w={150} h={18} mb={0} />
        </div>
      </div>

      <div className="page dossier" aria-busy="true" aria-label="Chargement du dossier…">
        {/* « Tous les dossiers » back link */}
        <Skel w={150} h={14} mb="1.6rem" />

        {/* Head — title · intent · meta */}
        <header className="dossier-head">
          <Skel w="62%" h={40} mb="1rem" />
          <Skel w="42%" h={22} mb=".9rem" />
          <Skel w={300} h={13} mb={0} />
        </header>

        <div className="dossier-body">
          {/* Rail — live panel + sources */}
          <aside className="rail">
            <Skel h={132} mb="1rem" />
            <Skel h={96} mb={0} />
          </aside>

          {/* Main — the brief */}
          <main style={{ minWidth: 0 }}>
            <Skel w={84} h={11} mb=".7rem" />
            <Skel w="46%" h={28} mb="1.6rem" />
            <Skel w="100%" />
            <Skel w="98%" />
            <Skel w="93%" />
            <Skel w="99%" />
            <Skel w="88%" />
            <Skel w="68%" />
          </main>
        </div>
      </div>
    </div>
  );
}
