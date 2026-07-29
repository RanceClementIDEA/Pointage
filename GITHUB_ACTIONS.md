rules_version = '2';

// ---------------------------------------------------------------------------
// Regles de securite Firestore -- A DEPLOYER AVANT TOUTE MISE EN SERVICE.
//
// Sans elles, une base creee en "mode test" est OUVERTE EN ECRITURE a tout
// internet pendant 30 jours : n'importe qui pourrait remplacer vos prix, et
// donc declencher chez vous une fausse alerte « grosse offre ».
//
// Le principe tient en une ligne : le navigateur LIT, il n'ecrit jamais.
// La seule ecriture vient de l'action GitHub, qui s'authentifie avec un
// compte de service. Les comptes de service passent OUTRE ces regles
// (privilege d'administration) -- il n'y a donc rien a leur autoriser ici.
//
// Deploiement :
//   firebase deploy --only firestore:rules
// ou console Firebase -> Firestore Database -> Regles -> coller -> Publier.
// ---------------------------------------------------------------------------

service cloud.firestore {
  match /databases/{database}/documents {

    // La photographie du suivi : lisible par le site, jamais modifiable
    // depuis un navigateur.
    match /suivi/{document} {
      allow read: if true;
      allow write: if false;
    }

    // Tout le reste est ferme. Une regle par defaut permissive est la
    // premiere cause de fuite sur Firestore.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
