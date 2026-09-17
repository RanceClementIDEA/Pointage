/* ═════════════════════════════════════════════════════════════════════
   TimeFlow — configuration Firebase
   Chargé AVANT app.js par index.html.

   Ces six valeurs ne sont PAS un secret : Firebase les publie de toute
   façon dans toute application web, elles identifient le projet, elles ne
   donnent aucun droit. Ce qui donne les droits, ce sont les règles
   Firestore et l'authentification — voir firestore.rules.

   Ce fichier ne contient délibérément AUCUN code de synchronisation :
   ce dépôt est public, et un code publié est un code compromis.
   Le code se saisit une fois par appareil (☰ → Synchronisation), le
   navigateur le retient ensuite. Bouton 🎲 pour en générer un fort.
   ════════════════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBOuUwspRnbMhwt1kU66zZ4U5rzDfv7FI8",
  authDomain: "pointage-e9591.firebaseapp.com",
  projectId: "pointage-e9591",
  storageBucket: "pointage-e9591.firebasestorage.app",
  messagingSenderId: "967658174113",
  appId: "1:967658174113:web:defe0e59d70afe6cc562e0"
};

/* Volontairement vide. Ne jamais y remettre de code : ce fichier part sur
   GitHub à chaque déploiement. */
const DEFAULT_SYNC_CODE = "";

/* ── Compte de synchronisation ─────────────────────────────────────────
   Adresse FICTIVE qui nomme l'unique compte Firebase autorisé par les
   règles Firestore. Aucun e-mail n'y est jamais envoyé, ce n'est pas un
   secret : le mot de passe est dérivé du code d'accès sur l'appareil et
   n'est écrit nulle part.
     ""  → connexion anonyme (fonctionnement d'avant)
     une adresse → compte dédié. N'activer qu'APRÈS avoir activé la
     méthode « Adresse e-mail/Mot de passe » dans la console Firebase.
   Exemple : "timeflow@pointage-e9591.firebaseapp.com"               */
const SYNC_EMAIL = "timeflow@pointage-e9591.firebaseapp.com";

/* ── App Check ─────────────────────────────────────────────────────────
   Clé de site reCAPTCHA Enterprise (console Google Cloud → Fraud Defense).
   Publique par nature, comme les valeurs ci-dessus.
     ""  → App Check inactif                                         */
const APP_CHECK_SITE_KEY = "";
