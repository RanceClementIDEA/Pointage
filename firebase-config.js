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
