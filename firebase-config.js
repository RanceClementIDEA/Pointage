/* ════════════════════════════════════════════════════════════════════
   TimeFlow — configuration Firebase
   Chargé AVANT app.js par index.html.

   Pourquoi ce fichier : en v1, la config et le code de synchronisation
   n'existaient que dans le localStorage du navigateur. Un vidage du
   navigateur effaçait les données ET le code permettant de les
   retrouver. Ici les deux sont versionnés avec l'app : même après un
   nettoyage complet, l'app se reconnecte seule et récupère l'historique.
   ════════════════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBOuUwspRnbMhwt1kU66zZ4U5rzDfv7FI8",
  authDomain: "pointage-e9591.firebaseapp.com",
  projectId: "pointage-e9591",
  storageBucket: "pointage-e9591.firebasestorage.app",
  messagingSenderId: "967658174113",
  appId: "1:967658174113:web:defe0e59d70afe6cc562e0"
};

/* Code de synchronisation par défaut — celui du document déjà existant
   dans Firestore (`tf_pointage/4455`). Mettre '' pour désactiver la
   reprise automatique et exiger une saisie manuelle. */
const DEFAULT_SYNC_CODE = "4455";
