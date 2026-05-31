# Veille — Brief de design (à transmettre à Claude Design)

## 0. Mission
Veille est une application web **pleinement fonctionnelle mais visuellement minimale**. L'objectif : **la rendre belle** — identité visuelle, mise en page, typographie, couleurs, composants, micro-interactions, tout.

**Toutes les décisions de design vous reviennent.** Ce document décrit *ce que fait* le produit, *son âme*, *ses écrans et leur contenu*, et les *contraintes techniques* à respecter. Il ne décrit volontairement **pas** la forme : la forme, c'est vous qui la décidez, de bout en bout.

---

## 1. L'âme du produit
- Veille transforme une **intention en langage naturel** en un **dossier vivant** : l'utilisateur dit ce qu'il veut suivre, Veille assemble les sources, les surveille dans le temps et présente le résultat. *La machinerie est cachée ; l'utilisateur voit des résultats.*
- **Ce n'est pas** un moteur de recherche ni un fil d'actualités. C'est plus proche d'un **dossier / renseignement / veille** : durable, rigoureux sur les citations, qui se met à jour tout seul.
- **Utilisateurs** : professionnels francophones **non-techniques** (journalistes, analystes, créateurs). La complexité est cachée derrière des défauts intelligents. **Toute l'interface est en français.**
- **Le principe UX, partout** : *défaut intelligent + toujours modifiable + bibliothèque extensible.*
- **Le modèle** : intention → plan → présentation → rafraîchissement. On tape une phrase → un dossier se compose (sources + présentation + cadence) → il s'assemble en direct → il se lit → il se rafraîchit et fait remonter des faits nouveaux, datés et sourcés.
- **La provenance est sacrée** : chaque fait remonte à un passage source vérifiable, et la synthèse attribue ses affirmations à leurs sources.
- **Ton** : sérieux, soigné, posé — du renseignement, pas du divertissement. (Éviter le registre « moteur de recherche ».)

---

## 2. Parcours utilisateur (de bout en bout)
1. **Connexion** par lien magique (email, sans mot de passe).
2. **Accueil** : l'utilisateur tape une phrase d'intention → Veille crée le dossier et l'ouvre.
3. **Page dossier** : le dossier **s'assemble en direct** (progression streamée), puis se lit comme un **brief de synthèse** en prose, suivi d'un **journal de mises à jour** datées, et d'une zone **Sources et faits** (les faits regroupés par publication, avec passages verbatim).
4. À tout moment : **rafraîchir** (chercher du nouveau), **réécrire la synthèse**, et **gérer ses recherches** (ajouter / voir le détail / éditer / retirer des sources).

---

## 3. Les écrans à (re)designer
Pour chaque écran : son but et son contenu (l'architecture d'information). La **présentation** est à votre entière discrétion.

### A. Connexion — `/sign-in`
- **But** : authentification par lien magique.
- **Contenu** : le nom « Veille » ; un sous-titre (« Dossiers vivants. ») ; un champ email (placeholder « vous@exemple.com ») ; un bouton « Recevoir le lien de connexion » (état « Envoi… ») ; un message de succès (« Vérifiez votre email — un lien de connexion vous attend. ») ; un état d'erreur générique.

### B. Accueil / liste des dossiers — `/`
- **But** : point d'entrée ; créer un dossier et retrouver les siens.
- **Contenu** :
  - En-tête : « Veille », « Vos dossiers vivants — {email} », et la déconnexion.
  - **Création** : une zone « Nouveau dossier » avec un grand champ texte multiligne (libellé « Décrivez en une phrase ce que vous souhaitez suivre. Veille en compose le dossier. » ; placeholder d'exemple ; raccourci ⌘↵ pour lancer ; bouton « Créer le dossier » ; état « Analyse de votre intention… »). **C'est le geste central du produit** — une phrase devient un dossier.
  - **Liste « Vos dossiers »** : un dossier par entrée — nom, une métadonnée (type de présentation · statut : *En préparation* / *Actif* / *En veille*), et l'intention (tronquée). État vide : « Votre premier dossier commence par une intention ci-dessus. »

### C. Page dossier — `/dossier/[slug]` (l'écran central)
De haut en bas :
- **En-tête** : lien retour « ← Tous les dossiers » ; le nom du dossier ; l'intention ; une ligne de métadonnées (statut · nombre de faits · « Actualisé le {date} »).
- **Panneau « runtime » (interactif, temps réel)** :
  - Actions : **« Réécrire la synthèse »** et **« Rafraîchir »** (avec états de chargement).
  - **Progression en direct** (pendant l'assemblage / le rafraîchissement) : un statut global (« Assemblage en cours — N faits » → « À jour — N faits », ou erreur) ; une ligne **par source** qui apparaît au fil de l'eau (en cours / « N nouveaux faits » / « indisponible ») ; puis une ligne de synthèse (« Rédaction de la synthèse… »). **Moment clé : on regarde le dossier se construire.**
  - **Panneau « Recherches »** (repliable) : la liste des sources suivies. Chaque source : un nom + un badge de type (*Page web* / *Recherche* / *Flux RSS* / *Chaîne YouTube*) ; dépliable → Type · Cible · Dernière extraction ; éditable (nom + cible) ; supprimable. Un bouton « Ajouter une source » ouvre une boîte de dialogue à 4 choix (page web / recherche permanente / flux RSS / chaîne YouTube) + un champ + validation. État vide : « Aucune recherche pour l'instant. »
- **Le brief (la synthèse) — la pièce maîtresse** : une prose de synthèse de la « situation actuelle », rendue depuis du markdown, qui **attribue ses affirmations à leurs sources** (liens). Un interrupteur **« Afficher / Masquer les sources »** (masqué par défaut) montre/cache les liens inline pour une lecture plus propre. État vide : « Synthèse en attente — lancez l'assemblage. »
- **Journal des mises à jour (« Mises à jour »)** : des notes **datées**, les plus récentes d'abord, chacune une brève prose de « ce qui est nouveau ».
- **Sources et faits** (repliable, secondaire) : tous les faits **regroupés par publication** (ex. *lemonde.fr*, *rtl.fr*) ; chaque groupe a une courte description de la source, puis ses faits (texte, date, indice de confiance, et un **passage source verbatim** dépliable). C'est la preuve auditable derrière le brief — chaque affirmation est traçable.

---

## 4. Capacités actuelles (ce que l'outil sait déjà faire)
- Créer un dossier **à partir d'une phrase** ; un planificateur choisit automatiquement les sources + un gabarit de présentation + une cadence.
- **Assembler / rafraîchir en direct** (streamé) avec détection de nouveauté ; chaque rafraîchissement ajoute des faits et, le cas échéant, une **note de mise à jour datée**.
- Présenter : un **brief** rédigé + des **mises à jour** datées + des **faits sourcés regroupés par publication** avec passages verbatim.
- **Gérer les sources** : ajouter / voir / éditer / retirer ; 4 types (page web, recherche permanente, flux RSS, chaîne YouTube).
- **Liens sources** dans le brief (affichables/masquables) ; **réécriture** de la synthèse à la demande.
- **Mode sombre** actuellement pris en charge.

---

## 5. État visuel actuel — *point de départ, librement remplaçable*
*Pour information uniquement.* Vous pouvez le **garder, le faire évoluer, ou le remplacer entièrement** — c'est votre décision.
- Esthétique actuelle : minimale, éditoriale, calme. Palette **achromatique** (gris ; un rouge pour les actions destructrices). Titres en **serif** (pile Hoefler Text → Georgia) ; corps en sans-serif système. Coins arrondis (~0,5 rem). Cartes à ombre légère. Une seule animation (apparition en fondu des faits). Clair **et** sombre (via `prefers-color-scheme`).
- Composants existants : boutons (variantes), cartes, badges, boîtes de dialogue, champs, une zone de prose markdown, des lignes de faits dépliables, icônes Lucide.
- C'est volontairement sobre — mais le « beau » reste à inventer : vous pouvez proposer une vraie identité (couleur, typographie, grille, hiérarchie, densité, motion, texture, états vides, etc.).

---

## 6. Contraintes techniques (à respecter pour que le design soit implémentable)
- **Stack** : Next.js 15 (App Router, React 19) ; **Tailwind CSS v4** en CSS-first (bloc `@theme` dans `app/globals.css`, sans fichier de config) ; composants **shadcn/ui** (primitives **Radix**) + variantes CVA ; icônes **lucide-react** ; markdown via **react-markdown** (sous-ensemble sûr, pas de HTML brut). → Le design doit pouvoir s'exprimer en **tokens Tailwind/CSS + composants React**.
- **Langue** : toute la copie en **français**.
- **Ton** : éviter le registre « recherche / search » ; rester « dossier vivant / veille / renseignement ».
- **Temps réel** : l'essentiel de la page dossier est rendu côté serveur ; une **île client** (`DossierRuntime`) gère le flux live (SSE). Le panneau de progression doit fonctionner **en streaming** (apparition progressive des lignes).
- **Responsive** (mobile-first) ; **mode sombre** souhaitable ; **accessibilité** (focus visibles, libellés ARIA, replis via `<details>` natifs).
- Aucune police n'est importée aujourd'hui (pile système) — vous pouvez introduire une vraie typographie si vous le jugez utile, en respectant l'implémentation/perf Next (`next/font`).

---

## 7. Ce qui vous revient entièrement (toutes les décisions de design)
- L'**identité visuelle** de Veille (sa « marque »).
- La **typographie** (familles, échelle, rythme), les **couleurs** et le **thème** (clair/sombre).
- La **grille**, la **mise en page** et la **densité** de chaque écran.
- Le **système de composants** et tous leurs **états** (repos, survol, focus, chargement, vide, erreur).
- L'**iconographie**, les **micro-interactions** et la **motion** — en particulier le moment « le dossier s'assemble » (progression live).
- Le **traitement du brief** (lisibilité d'une longue prose sourcée), du **journal**, et de la **zone de preuves**.
- La **hiérarchie** entre la synthèse (vedette, ce qu'on lit) et les faits (preuve, secondaire).

**Prenez toutes ces décisions.** Vous pouvez aussi proposer des écrans/états absents aujourd'hui s'ils servent le produit.

---

## 8. Boussole (à quoi ressemble le succès)
Une application qui **donne envie de lire** : un outil de renseignement **calme, dense mais lisible**, qui fait sentir le « dossier vivant » — sérieux, soigné, sourcé, durable. Belle **au repos** (la lecture du brief) comme **en mouvement** (l'assemblage en direct). Une interface dont un journaliste ou un analyste exigeant serait fier de se servir au quotidien.

---

*Pour explorer le produit en fonctionnement : l'app tourne en local (Next dev) et toutes les pages au-delà de la connexion sont protégées par authentification. Les surfaces ci-dessus (§3) couvrent l'intégralité de l'interface utilisateur actuelle.*
