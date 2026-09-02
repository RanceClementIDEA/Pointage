/* ═══════════════════════════════════════════════════════════════════════
   TimeFlow — paie.js
   Passage du BRUT au NET selon le régime social du contrat.

   Module autonome, chargé avant app.js. Aucune dépendance, aucun état :
   des fonctions pures, donc testables une par une.

   ⚠️ Ce que ce module calcule : le « net à payer AVANT impôt sur le
   revenu », la ligne de la fiche de paie. Le prélèvement à la source
   n'est pas appliqué : son taux est personnel.
   C'est une ESTIMATION. Une fiche de paie réelle dépend de la convention
   collective, de la mutuelle, de la prévoyance et de la tranche.

   ─── Barèmes 2026 (vérifiés le 02/09/2026) ────────────────────────────
   SMIC horaire brut         12,02 € au 01/01/2026 · 12,31 € au 01/06/2026
   SMIC mensuel 35 h       1 823,03 € au 01/01     · 1 867,02 € au 01/06
   Plafond horaire SS              30,00 €
   Gratification stage mini    15 % du plafond horaire = 4,50 €/h
   Apprenti : cotisations salariales, CSG et CRDS exonérées jusqu'à
              50 % du SMIC (depuis le 01/03/2025 ; c'était 79 % avant)
   Cotisations salariales   ≈ 22 % non-cadre · ≈ 25 % cadre
   Intérim  IFM 10 % du brut, ICCP 10 % de (brut + IFM) → +21 %
   ═══════════════════════════════════════════════════════════════════════ */

const PAIE = {
  BAREME: '2026-06-01',

  /* Barèmes datés : on retient la valeur en vigueur au mois calculé.
     Les seuils bougent chaque revalorisation du SMIC — d'où le tableau
     plutôt qu'une constante, pour que les mois passés restent justes. */
  SMIC_MENSUEL: [
    { des: '2026-06-01', valeur: 1867.02 },
    { des: '2026-01-01', valeur: 1823.03 },
    { des: '0000-01-01', valeur: 1823.03 },
  ],
  SMIC_HORAIRE: [
    { des: '2026-06-01', valeur: 12.31 },
    { des: '2026-01-01', valeur: 12.02 },
    { des: '0000-01-01', valeur: 12.02 },
  ],
  PLAFOND_HORAIRE_SS: [
    { des: '2026-01-01', valeur: 30.00 },
    { des: '0000-01-01', valeur: 30.00 },
  ],

  APPRENTI_SEUIL: 0.50,          // 50 % du SMIC exonérés
  STAGE_FRANCHISE: 0.15,         // 15 % du plafond horaire SS
  IFM_TAUX: 0.10,
  ICCP_TAUX: 0.10,

  TAUX_COTISATIONS: {            // part salariale, en % du brut
    general: 22,
    cadre: 25,
    apprenti: 22,                // appliqué à la seule fraction imposable
    stage: 22,
    independant: 0,              // pas de cotisations salariales
  },

  REGIMES: {
    general: 'Salarié non-cadre',
    cadre: 'Salarié cadre',
    apprenti: 'Apprenti / alternance',
    stage: 'Stagiaire',
    independant: 'Indépendant (non salarié)',
  },

  /* Régime déduit du type de contrat, modifiable ensuite par l'utilisateur. */
  regimeParDefaut(type) {
    switch (type) {
      case 'Alternance': case 'Apprentissage': return 'apprenti';
      case 'Stage': return 'stage';
      case 'Freelance': return 'independant';
      default: return 'general';
    }
  },

  valeurAu(table, dateIso) {
    const d = dateIso || '9999-12-31';
    for (const e of table) if (d >= e.des) return e.valeur;
    return table[table.length - 1].valeur;
  },

  taux(contrat) {
    const c = contrat || {};
    const r = c.regime || PAIE.regimeParDefaut(c.type);
    const t = Number(c.tauxCotisations);
    return t > 0 && t < 100 ? t : PAIE.TAUX_COTISATIONS[r] ?? PAIE.TAUX_COTISATIONS.general;
  },

  /* ── Cœur du calcul, sur un MOIS ──────────────────────────────────────
     Les seuils d'exonération (apprenti, stage) sont mensuels : calculer
     jour par jour donnerait un résultat faux. `mois` au format AAAA-MM.  */
  netDuMois(brut, contrat, mois, heures) {
    const c = contrat || {};
    const regime = c.regime || PAIE.regimeParDefaut(c.type);
    const taux = PAIE.taux(c) / 100;
    const premierDuMois = (mois || '').length >= 7 ? mois.slice(0, 7) + '-01' : null;
    brut = Math.max(0, Number(brut) || 0);

    let franchise = 0, motif = '';

    if (regime === 'apprenti') {
      const smic = PAIE.valeurAu(PAIE.SMIC_MENSUEL, premierDuMois);
      franchise = smic * PAIE.APPRENTI_SEUIL;
      motif = `exonéré jusqu'à 50 % du SMIC (${PAIE.euros(franchise)})`;
    } else if (regime === 'stage') {
      const plafond = PAIE.valeurAu(PAIE.PLAFOND_HORAIRE_SS, premierDuMois);
      franchise = plafond * PAIE.STAGE_FRANCHISE * (Number(heures) || 0);
      motif = `franchise de ${PAIE.euros(plafond * PAIE.STAGE_FRANCHISE)}/h sur ${PAIE.nb(heures)} h`;
    } else if (regime === 'independant') {
      motif = 'non salarié : aucune cotisation salariale';
    }

    const assiette = Math.max(0, brut - franchise);
    const cotisations = assiette * taux;

    return {
      regime, brut, franchise, assiette, motif,
      tauxCotisations: taux * 100,
      cotisations,
      net: brut - cotisations,
      exonere: franchise > 0 && assiette === 0,
    };
  },

  /* ── Primes de fin de mission (intérim) ──────────────────────────────
     ICCP calculée sur le brut IFM incluse : +21 % au total, pas +20 %.  */
  primesInterim(brut, contrat) {
    const c = contrat || {};
    if (c.ifm === false) return { ifm: 0, iccp: 0, total: 0, brutTotal: brut, applicable: false };
    const applicable = c.ifm === true || c.type === 'Intérim';
    if (!applicable) return { ifm: 0, iccp: 0, total: 0, brutTotal: brut, applicable: false };
    const ifm = brut * PAIE.IFM_TAUX;
    const iccp = (brut + ifm) * PAIE.ICCP_TAUX;
    return { ifm, iccp, total: ifm + iccp, brutTotal: brut + ifm + iccp, applicable: true };
  },

  /* Brut → net sur une seule ligne, pour les aperçus. */
  apercu(tauxHoraire, contrat, heures, mois) {
    const h = Number(heures) || 151.67;
    const brut = (Number(tauxHoraire) || 0) * h;
    const n = PAIE.netDuMois(brut, contrat, mois || null, h);
    const p = PAIE.primesInterim(brut, contrat);
    return Object.assign({}, n, { heures: h, primes: p });
  },

  euros(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €'; },
  nb(v) { return String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ','); },
};

if (typeof module !== 'undefined' && module.exports) module.exports = PAIE;
