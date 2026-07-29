{
  "_comment": "Config v2. Nouveautes : 'reference' (prix reperes connus AVANT le suivi), 'seed_history' (points de prix historiques releves manuellement), 'budget' et 'market_context'. Grace a cela les conseils sont pertinents des le 1er jour.",
  "budget": {
    "target_total": 1000,
    "max_total": 1150,
    "currency": "EUR"
  },
  "thresholds": {
    "deal_percent": 3,
    "wait_percent": 10,
    "strong_deal_percent": 1,
    "volatility_high_percent": 8,
    "seuil_occasion_ultime_percent": 5,
    "seuil_bug_prix_percent": 30,
    "chute_soudaine_percent": 15,
    "couverture_min_sources": 3,
    "seuil_gonflage_percent": 5,
    "archivage_jours": 90,
    "marge_alimentation_percent": 30,
    "max_vendeurs_par_composant": 8,
    "vendeurs_en_parallele": 8,
    "delai_par_domaine": 2.5,
    "seuil_pertinence_titre": 0.72,
    "plausibilite_basse": 0.35,
    "plausibilite_haute": 2.5,
    "comparer_prix_livre": true,
    "inclure_ruptures": false,
    "essayer_variantes": true,
    "etats_acceptes_defaut": [
      "neuf"
    ],
    "autoriser_lots": false,
    "recherche_groupee": true,
    "jours_avant_retrait": 7,
    "respecter_robots": false,
    "budget_secondes": 420,
    "exiger_https": true,
    "confiance_par_defaut": "inconnue",
    "confiance_refusee": [],
    "verifier_sur_fiche": true,
    "offres_a_verifier": 2,
    "seuil_offre_suspecte": 0.55,
    "seuil_offre_a_verifier": 0.75,
    "quorum_consensus": 4,
    "ecarter_suspectes": true
  },
  "alertes": {
    "_comment": "ntfy_topic : choisissez un nom SECRET et impossible a deviner (ex: pcprix-k7m2x9qz). Installez l'appli 'ntfy' sur votre telephone, abonnez-vous a ce nom, et vous recevrez une notification instantanee des qu'une occasion ultime est detectee. Laissez vide pour desactiver.",
    "ntfy_topic": ""
  },
  "market_context": {
    "RAM": {
      "trend": "hausse",
      "note": "Penurie mondiale DDR4/DDR5 (demande datacenters IA). Les prix montent depuis plusieurs mois : acheter tot est plus prudent qu'attendre."
    },
    "GPU": {
      "trend": "stable",
      "note": "Segment 400-500 EUR tres concurrentiel (RX 9060 XT vs RTX 5060 Ti). Grosses baisses surtout au Black Friday."
    },
    "CPU": {
      "trend": "baisse",
      "note": "AM4 en fin de cycle : les prix s'erodent doucement, mais les stocks se rarefient. Ne pas trop attendre non plus."
    }
  },
  "components": [
    {
      "id": "cpu_5700x",
      "name": "AMD Ryzen 7 5700X",
      "category": "CPU",
      "priority": "haute",
      "sources": [
        {
          "site": "cdiscount",
          "url": "https://www.cdiscount.com/informatique/processeurs/processeur-amd-ryzen-7-5700x-100-100000926wof/f-10764-100100000926wof.html"
        },
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/fiche/PB00720784.html"
        },
        {
          "site": "idealo",
          "type": "comparateur",
          "url": "https://www.idealo.fr/prix/201899339/amd-ryzen-7-5700x.html"
        },
        {
          "site": "amazon",
          "url": "https://www.amazon.fr/s?k=Ryzen+7+5700X"
        }
      ],
      "reference": {
        "msrp": 309,
        "historical_low": 119.0,
        "typical_price": 155,
        "note": "Plus bas connu ~119 EUR (Cdiscount). Prix habituel constate 143-183 EUR selon revendeur.",
        "prix_reve": 110
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "cdiscount",
          "price": 122.6
        },
        {
          "date": "2026-06-06",
          "site": "amazon",
          "price": 143.05
        },
        {
          "date": "2026-06-06",
          "site": "rakuten",
          "price": 145.99
        },
        {
          "date": "2026-06-07",
          "site": "carrefour",
          "price": 154.08
        },
        {
          "date": "2026-06-07",
          "site": "cdiscount",
          "price": 156.94
        },
        {
          "date": "2026-07-23",
          "site": "cdiscount",
          "price": 121.45
        },
        {
          "date": "2026-07-23",
          "site": "ldlc",
          "price": 182.95
        }
      ],
      "slot": "CPU",
      "perf_index": 100,
      "specs": {
        "socket": "AM4",
        "tdp": 65
      },
      "recherche": "AMD Ryzen 7 5700X",
      "recherche_variantes": [
        "Ryzen 7 5700X",
        "100-100000926WOF"
      ],
      "exclure": [
        "5700G",
        "5700X3D",
        "5800X"
      ],
      "famille_recherche": "AMD Ryzen 7 5000 AM4"
    },
    {
      "id": "carte_mere_b550",
      "name": "Gigabyte B550 Gaming X V2",
      "category": "Carte mere",
      "priority": "haute",
      "sources": [
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/fiche/PB00387599.html"
        },
        {
          "site": "grosbill",
          "url": "https://www.grosbill.com/recherche?q=B550+GAMING+X+V2"
        },
        {
          "site": "pccomponentes",
          "url": "https://www.pccomponentes.fr/gigabyte-b550-gaming-x-v2"
        }
      ],
      "reference": {
        "msrp": 131.9,
        "historical_low": 94.99,
        "typical_price": 99.99,
        "note": "Vue a 94,99 EUR (Amazon/Grosbill) et 99,99 EUR (Darty/Cdiscount/Fnac) en juin 2026.",
        "prix_reve": 89
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "amazon",
          "price": 94.99
        },
        {
          "date": "2026-06-06",
          "site": "grosbill",
          "price": 94.99
        },
        {
          "date": "2026-06-06",
          "site": "darty",
          "price": 99.99
        },
        {
          "date": "2026-06-06",
          "site": "cdiscount",
          "price": 99.99
        }
      ],
      "specs": {
        "socket": "AM4",
        "type_ram": "DDR4",
        "format": "ATX",
        "slots_ram": 4
      },
      "recherche": "Gigabyte B550 GAMING X V2",
      "recherche_variantes": [
        "B550 GAMING X V2",
        "Gigabyte B550 Gaming X"
      ],
      "exclure": [
        "B550M",
        "B550I"
      ]
    },
    {
      "id": "ram_kingston_16go",
      "name": "Kingston Fury Beast 16 Go (2x8) DDR4 3200 CL16",
      "category": "RAM",
      "priority": "haute",
      "sources": [
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/fiche/PB00447676.html"
        }
      ],
      "reference": {
        "msrp": null,
        "historical_low": null,
        "typical_price": 100,
        "note": "ATTENTION : prix RAM tres volatils en 2026 (penurie). A titre de comparaison, un kit concurrent Corsair Vengeance RGB RS 16 Go etait a 169,99 EUR en juin 2026 chez Fnac/Cdiscount/Darty. Renseignez un vrai releve des que possible.",
        "prix_reve": 85
      },
      "seed_history": [],
      "specs": {
        "type_ram": "DDR4"
      },
      "recherche": "Kingston Fury Beast 16Go DDR4 3200 CL16",
      "recherche_variantes": [
        "Kingston Fury Beast DDR4 16Go 3200",
        "KF432C16BBK2/16"
      ]
    },
    {
      "id": "gpu_rx9060xt",
      "name": "AMD RX 9060 XT 16 Go",
      "category": "GPU",
      "priority": "haute",
      "sources": [
        {
          "site": "cdiscount",
          "url": "https://www.cdiscount.com/informatique/cartes-meres/radeon-asrock-rx-9060-xt/f-10765-aaati65333.html"
        },
        {
          "site": "prix.net",
          "type": "comparateur",
          "url": "https://www.prix.net/prix/rx-9060-xt-16gb-1087564711364737183.html"
        },
        {
          "site": "prix.net-2",
          "type": "comparateur",
          "url": "https://www.prix.net/prix/radeon-rx-9060-xt-16gb-5387646175810895269.html"
        },
        {
          "site": "alternate",
          "url": "https://www.alternate.fr/html/search.html?query=RX+9060+XT+16"
        },
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/informatique/pieces-informatique/carte-graphique-interne/c4684/+fv121-126949.html"
        }
      ],
      "reference": {
        "msrp": 499,
        "historical_low": 349.0,
        "typical_price": 429,
        "note": "Plus bas connu 349 EUR (Sapphire Pulse, nov. 2025). Prix marche mai 2026 : ~419 EUR. Modeles premium (Gaming OC, Steel Legend) 470-540 EUR.",
        "prix_reve": 349
      },
      "seed_history": [
        {
          "date": "2025-11-20",
          "site": "divers",
          "price": 349.0
        },
        {
          "date": "2026-05-15",
          "site": "divers",
          "price": 419.0
        },
        {
          "date": "2026-07-23",
          "site": "alternate",
          "price": 429.0
        },
        {
          "date": "2026-07-23",
          "site": "alternate",
          "price": 439.0
        },
        {
          "date": "2026-07-23",
          "site": "compumsa",
          "price": 472.9
        },
        {
          "date": "2026-07-23",
          "site": "cdiscount",
          "price": 495.9
        }
      ],
      "slot": "GPU",
      "perf_index": 100,
      "specs": {
        "tdp": 150,
        "longueur_mm": 280,
        "alim_recommandee": 550
      },
      "recherche": "Radeon RX 9060 XT 16Go",
      "recherche_variantes": [
        "RX 9060 XT 16Go",
        "Radeon 9060 XT 16G"
      ],
      "exclure": [
        "9060 XT 8Go",
        "9070"
      ],
      "famille_recherche": "Radeon RX 9060",
      "etats_acceptes": [
        "neuf",
        "reconditionne"
      ]
    },
    {
      "id": "ssd_lexar_512",
      "name": "Lexar ARES 512 Go NVMe Gen4",
      "category": "SSD",
      "priority": "moyenne",
      "sources": [
        {
          "site": "amazon",
          "url": "https://www.amazon.fr/dp/REMPLACEZ_PAR_ASIN_REEL"
        }
      ],
      "reference": {
        "msrp": null,
        "historical_low": 106.99,
        "typical_price": 107,
        "note": "106,99 EUR sur Amazon en juin 2026. Alternative moins chere : Crucial P3 Plus 1 To ~70-73 EUR (plus de capacite, un peu moins rapide).",
        "prix_reve": 95
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "amazon",
          "price": 106.99
        }
      ],
      "specs": {
        "format": "M.2 2280",
        "interface": "PCIe 4.0"
      },
      "recherche": "Lexar ARES 512Go NVMe",
      "recherche_variantes": [
        "Lexar ARES 512Go",
        "LNM790X512G"
      ]
    },
    {
      "id": "ventirad_peerless",
      "name": "Thermalright Peerless Assassin 120 SE",
      "category": "Ventirad",
      "priority": "basse",
      "sources": [
        {
          "site": "amazon",
          "url": "https://www.amazon.fr/dp/REMPLACEZ_PAR_ASIN_REEL"
        }
      ],
      "reference": {
        "msrp": null,
        "historical_low": null,
        "typical_price": 40,
        "note": "Le petit frere AssassinX120 SE ARGB etait a 21,88 EUR (Amazon, juin 2026). Le Peerless (double tour) se situe habituellement 35-45 EUR.",
        "prix_reve": 32
      },
      "seed_history": [],
      "specs": {
        "hauteur_mm": 155,
        "sockets": [
          "AM4",
          "AM5",
          "LGA1700",
          "LGA1200"
        ],
        "tdp_max": 250
      },
      "recherche": "Thermalright Peerless Assassin 120 SE",
      "recherche_variantes": [
        "Peerless Assassin 120 SE",
        "Thermalright PA120 SE"
      ]
    },
    {
      "id": "boitier_msi_forge",
      "name": "MSI MAG Forge 320R Airflow",
      "category": "Boitier",
      "priority": "basse",
      "sources": [
        {
          "site": "rakuten",
          "url": "https://fr.shopping.rakuten.com/REMPLACEZ_PAR_URL_REELLE"
        },
        {
          "site": "grosbill",
          "url": "https://www.grosbill.com/recherche?q=MAG+Forge+320R"
        }
      ],
      "reference": {
        "msrp": 84.99,
        "historical_low": 74.9,
        "typical_price": 74.99,
        "note": "Tres stable a 74,90-74,99 EUR chez Rakuten/Grosbill/Fnac/Darty/Cdiscount. 84,99 EUR chez RueDuCommerce (a eviter).",
        "prix_reve": 65
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "rakuten",
          "price": 74.9
        },
        {
          "date": "2026-06-06",
          "site": "grosbill",
          "price": 74.9
        },
        {
          "date": "2026-06-06",
          "site": "fnac",
          "price": 74.99
        },
        {
          "date": "2026-06-06",
          "site": "cdiscount",
          "price": 74.99
        },
        {
          "date": "2026-06-06",
          "site": "ruecommerce",
          "price": 84.99
        }
      ],
      "specs": {
        "formats_acceptes": [
          "ATX",
          "Micro-ATX",
          "Mini-ITX"
        ],
        "gpu_max_mm": 390,
        "ventirad_max_mm": 160
      },
      "recherche": "MSI MAG Forge 320R Airflow",
      "recherche_variantes": [
        "MAG Forge 320R Airflow",
        "MSI Forge 320R"
      ]
    },
    {
      "id": "alim_msi_650w",
      "name": "MSI MAG A650BN 650W 80+ Bronze",
      "category": "Alimentation",
      "priority": "moyenne",
      "sources": [
        {
          "site": "amazon",
          "url": "https://www.amazon.fr/dp/REMPLACEZ_PAR_ASIN_REEL"
        }
      ],
      "reference": {
        "msrp": 69.99,
        "historical_low": 56.65,
        "typical_price": 62,
        "note": "56,65 EUR sur Amazon en juin 2026 (soit -19% du prix catalogue 69,99 EUR).",
        "prix_reve": 50
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "amazon",
          "price": 56.65
        }
      ],
      "specs": {
        "watts": 650
      },
      "recherche": "MSI MAG A650BN",
      "recherche_variantes": [
        "MAG A650BN",
        "MSI A650BN 650W"
      ]
    },
    {
      "id": "gpu_rtx5060ti_16",
      "name": "NVIDIA RTX 5060 Ti 16 Go",
      "category": "GPU",
      "slot": "GPU",
      "perf_index": 103,
      "priority": "haute",
      "sources": [
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/informatique/pieces-informatique/carte-graphique-interne/c4684/+fv121-126767.html"
        },
        {
          "site": "alternate",
          "url": "https://www.alternate.fr/html/search.html?query=RTX+5060+Ti+16"
        }
      ],
      "reference": {
        "msrp": 449,
        "historical_low": 399,
        "typical_price": 449,
        "prix_reve": 380,
        "note": "Meilleur ray tracing et encodeur NVENC AV1 (utile montage video). Prix lancement 449 EUR en 16 Go."
      },
      "seed_history": [
        {
          "date": "2026-05-15",
          "site": "divers",
          "price": 449.0
        },
        {
          "date": "2026-07-23",
          "site": "ldlc",
          "price": 649.95
        }
      ],
      "specs": {
        "tdp": 180,
        "longueur_mm": 300,
        "alim_recommandee": 600
      },
      "recherche": "GeForce RTX 5060 Ti 16Go",
      "recherche_variantes": [
        "RTX 5060 Ti 16Go",
        "5060 Ti 16G"
      ],
      "exclure": [
        "5060 Ti 8Go",
        "5060 non-Ti"
      ],
      "famille_recherche": "GeForce RTX 5060 Ti",
      "etats_acceptes": [
        "neuf",
        "reconditionne"
      ]
    },
    {
      "id": "gpu_rtx5060ti_8",
      "name": "NVIDIA RTX 5060 Ti 8 Go",
      "category": "GPU",
      "slot": "GPU",
      "perf_index": 96,
      "priority": "moyenne",
      "sources": [
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/informatique/pieces-informatique/carte-graphique-interne/c4684/+fv121-126767.html"
        }
      ],
      "reference": {
        "msrp": 399,
        "historical_low": 399,
        "typical_price": 399,
        "prix_reve": 340,
        "note": "8 Go seulement : suffisant en 1080p competitif, limitant sur certains AAA en 1440p."
      },
      "seed_history": [
        {
          "date": "2026-05-15",
          "site": "divers",
          "price": 399.0
        },
        {
          "date": "2026-07-23",
          "site": "ldlc",
          "price": 489.95
        }
      ],
      "specs": {
        "tdp": 180,
        "longueur_mm": 300,
        "alim_recommandee": 600
      },
      "recherche": "GeForce RTX 5060 Ti 8Go",
      "recherche_variantes": [
        "RTX 5060 Ti 8Go",
        "5060 Ti 8G"
      ],
      "famille_recherche": "GeForce RTX 5060 Ti",
      "etats_acceptes": [
        "neuf",
        "reconditionne"
      ]
    },
    {
      "id": "gpu_rx9060_8",
      "name": "AMD RX 9060 (non-XT) 8 Go",
      "category": "GPU",
      "slot": "GPU",
      "perf_index": 84,
      "priority": "basse",
      "sources": [
        {
          "site": "cdiscount",
          "url": "https://www.cdiscount.com/informatique/r-amd+radeon+rx+9060+xt+16+g.html"
        }
      ],
      "reference": {
        "msrp": 369,
        "historical_low": 330,
        "typical_price": 360,
        "prix_reve": 300,
        "note": "Environ 15-17% moins performante que la XT (tests TechSpot). Option budget."
      },
      "seed_history": [
        {
          "date": "2026-05-15",
          "site": "divers",
          "price": 369.0
        }
      ],
      "specs": {
        "tdp": 136,
        "longueur_mm": 250,
        "alim_recommandee": 500
      },
      "recherche": "Radeon RX 9060 8Go",
      "recherche_variantes": [
        "RX 9060 8Go"
      ],
      "famille_recherche": "Radeon RX 9060",
      "etats_acceptes": [
        "neuf",
        "reconditionne"
      ]
    },
    {
      "id": "cpu_5700x3d",
      "name": "AMD Ryzen 7 5700X3D",
      "category": "CPU",
      "slot": "CPU",
      "perf_index": 104,
      "priority": "moyenne",
      "sources": [
        {
          "site": "ldlc",
          "url": "https://www.ldlc.com/fiche/PB00588197.html"
        },
        {
          "site": "cdiscount",
          "url": "https://www.cdiscount.com/informatique/r-ryzen+7+5700x3d.html"
        }
      ],
      "reference": {
        "msrp": 249,
        "historical_low": 170,
        "typical_price": 200,
        "prix_reve": 160,
        "note": "3D V-Cache : nettement meilleur en jeu, equivalent en applicatif. Meme socket AM4."
      },
      "seed_history": [
        {
          "date": "2026-07-23",
          "site": "ldlc",
          "price": 229.95
        }
      ],
      "specs": {
        "socket": "AM4",
        "tdp": 105
      },
      "recherche": "AMD Ryzen 7 5700X3D",
      "recherche_variantes": [
        "Ryzen 7 5700X3D"
      ],
      "exclure": [
        "5700X ",
        "5800X3D"
      ],
      "famille_recherche": "AMD Ryzen 7 5000 AM4"
    },
    {
      "id": "cpu_5600",
      "name": "AMD Ryzen 5 5600",
      "category": "CPU",
      "slot": "CPU",
      "perf_index": 80,
      "priority": "basse",
      "sources": [
        {
          "site": "cdiscount",
          "url": "https://www.cdiscount.com/informatique/r-amd+ryzen+7+5700x.html"
        }
      ],
      "reference": {
        "msrp": 199,
        "historical_low": 110,
        "typical_price": 130,
        "prix_reve": 100,
        "note": "6 coeurs au lieu de 8 : proche en jeu, en retrait sur compilation/Docker/montage."
      },
      "seed_history": [
        {
          "date": "2026-06-06",
          "site": "cdiscount",
          "price": 122.6
        },
        {
          "date": "2026-06-06",
          "site": "amazon",
          "price": 143.05
        }
      ],
      "specs": {
        "socket": "AM4",
        "tdp": 65
      },
      "recherche": "AMD Ryzen 5 5600",
      "recherche_variantes": [
        "Ryzen 5 5600",
        "100-100000927BOX"
      ],
      "famille_recherche": "AMD Ryzen 5 5000 AM4"
    }
  ],
  "history_file": "history.json",
  "email": {
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "sender_email": "VOTRE_ADRESSE@gmail.com",
    "recipient_email": "VOTRE_ADRESSE@gmail.com",
    "subject_prefix": "[PC Tracker]"
  },
  "slots": {
    "_comment": "Groupes d'equivalence : produits interchangeables pour un meme poste. Le systeme compare leur cout par point de performance et recommande le meilleur achat du moment. perf_index = indice relatif (100 = reference du slot), a ajuster selon vos priorites.",
    "CPU": {
      "label": "Processeur",
      "reference_id": "cpu_5700x"
    },
    "GPU": {
      "label": "Carte graphique",
      "reference_id": "gpu_rx9060xt"
    }
  },
  "projet": {
    "_comment": "Suivi du cycle d'achat (roadmap 5.1 et 5.3). date_cible : a l'approche de cette date, le systeme privilegie ACHETER plutot que d'attendre indefiniment.",
    "nom": "Tour polyvalente 1000 EUR",
    "date_cible": null,
    "achats": []
  },
  "evenements_produits": [
    {
      "_comment": "Calendrier produit. Depuis la v3.1, ces entrees ALIMENTENT LA DECISION et ne servent plus seulement d'affichage. Champ 'nature' (facultatif) : 'refresh' = nouvelle generation annoncee/rumoree, pousse le conseil vers ATTENDRE si elle tombe dans l'horizon (60 j par defaut, reglable via thresholds.horizon_refresh_jours) ; 'aucun_refresh' = silence produit constate, annule un 'refresh' de la meme categorie devenu caduc. SANS champ 'nature', l'entree reste purement informative et ne change aucun conseil. 'impact' liste les categories concernees ; 'slots' (facultatif) restreint a certains slots. Une occasion ultime ou un prix au plancher historique ne sont JAMAIS basculees par un refresh.",
      "exemple_refresh": {
        "date": "2027-03-01",
        "nom": "RTX 60xx (rumeur)",
        "nature": "refresh",
        "impact": [
          "GPU"
        ],
        "note": "Decommentez en changeant la cle en une vraie entree."
      },
      "exemple_aucun_refresh": {
        "date": "2027-03-01",
        "nom": "AM4 : succession repoussee",
        "nature": "aucun_refresh",
        "impact": [
          "CPU"
        ],
        "note": "Annule un refresh CPU devenu caduc."
      }
    },
    {
      "date": "2027-01-06",
      "nom": "CES 2027",
      "impact": [
        "GPU",
        "CPU"
      ],
      "note": "Annonces majeures AMD/NVIDIA/Intel. Les generations precedentes baissent souvent dans les semaines qui suivent."
    },
    {
      "date": "2026-11-20",
      "nom": "Black Friday (rappel)",
      "impact": [
        "GPU",
        "CPU",
        "SSD",
        "RAM"
      ],
      "note": "Doublon volontaire avec le calendrier commercial : sert de repere ici."
    }
  ],
  "selecteurs_sites": {
    "_comment": "Roadmap 8.1 : ajouter un nouveau site ne demande plus de modifier le code Python. Renseignez ici ses selecteurs CSS de prix. La methode principale (donnees structurees JSON-LD) fonctionne deja sans configuration sur la plupart des sites ; ceci n'est qu'un repli.",
    "ldlc": [
      ".price",
      ".basket-price"
    ],
    "cdiscount": [
      ".fpPrice",
      ".price"
    ],
    "amazon": [
      "span.a-price > span.a-offscreen",
      "#priceblock_ourprice"
    ],
    "rakuten": [
      ".price",
      "[class*='Price']"
    ],
    "materiel.net": [
      ".sale-price",
      ".price"
    ],
    "grosbill": [
      ".price"
    ],
    "topachat": [
      ".offer-price__price"
    ],
    "alternate": [
      ".price",
      "[class*='price']"
    ],
    "pccomponentes": [
      "#precio-main",
      ".precio-main"
    ],
    "fnac": [
      ".userPrice",
      ".f-priceBox-price"
    ],
    "darty": [
      ".darty_prix",
      ".product_price"
    ]
  },
  "vendeurs": {
    "_comment": "Les vendeurs marques 'a_verifier' sont inactifs tant que 'python price_tracker.py --verifier-vendeurs' ne les a pas testes. Leurs URLs de recherche n'ont pas ete confirmees.",
    "idealo": {
      "pays": "FR",
      "type": "comparateur",
      "priorite": 1,
      "actif": true,
      "url": "https://www.idealo.fr/prix/search.html?q={q}",
      "confiance": "haute"
    },
    "ledenicheur": {
      "pays": "FR",
      "type": "comparateur",
      "priorite": 1,
      "actif": true,
      "url": "https://ledenicheur.fr/search?search={q}",
      "confiance": "haute"
    },
    "geizhals": {
      "pays": "DE/AT",
      "type": "comparateur",
      "priorite": 1,
      "actif": true,
      "url": "https://geizhals.eu/?fs={q}&hloc=fr&hloc=de&hloc=at",
      "confiance": "haute"
    },
    "ldlc": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.ldlc.com/recherche/{q}/",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "materiel.net": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.materiel.net/recherche/{q}/",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "topachat": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.topachat.com/pages/recherche.php?mc={q}",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "grosbill": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.grosbill.com/recherche?q={q}",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "cybertek": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.cybertek.fr/boutique/recherche.aspx?rec={q}",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "1fodiscount": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.1fodiscount.com/recherche/{q}",
      "franchise_port": 0,
      "confiance": "moyenne"
    },
    "cdiscount": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.cdiscount.com/search/10/{q}.html",
      "franchise_port": 0,
      "confiance": "moyenne",
      "marketplace": true
    },
    "rueducommerce": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.rueducommerce.fr/recherche/{q}",
      "franchise_port": 0,
      "confiance": "moyenne",
      "marketplace": true
    },
    "fnac": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.fnac.com/SearchResult/ResultList.aspx?Search={q}",
      "franchise_port": 0,
      "confiance": "moyenne",
      "marketplace": true
    },
    "boulanger": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.boulanger.com/resultats?tr={q}",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "rakuten": {
      "pays": "FR",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://fr.shopping.rakuten.com/search/{q}",
      "franchise_port": 0,
      "confiance": "moyenne",
      "marketplace": true
    },
    "alternate.fr": {
      "pays": "FR/DE",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.alternate.fr/html/search.html?query={q}",
      "franchise_port": 0,
      "confiance": "haute"
    },
    "pccomponentes": {
      "pays": "ES",
      "type": "marchand",
      "priorite": 2,
      "actif": true,
      "url": "https://www.pccomponentes.fr/buscar/?query={q}",
      "confiance": "haute"
    },
    "mindfactory": {
      "pays": "DE",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.mindfactory.de/search_result.php?search_query={q}",
      "confiance": "haute"
    },
    "caseking": {
      "pays": "DE",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.caseking.de/search?sSearch={q}",
      "confiance": "haute"
    },
    "computeruniverse": {
      "pays": "DE",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.computeruniverse.net/fr/search?q={q}",
      "confiance": "haute"
    },
    "galaxus": {
      "pays": "DE/CH",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.galaxus.de/fr/search?q={q}",
      "confiance": "haute"
    },
    "megekko": {
      "pays": "NL",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.megekko.nl/zoeken?q={q}",
      "confiance": "haute"
    },
    "proshop": {
      "pays": "DK",
      "type": "marchand",
      "priorite": 3,
      "actif": true,
      "url": "https://www.proshop.fr/?s={q}",
      "confiance": "haute"
    },
    "amazon.fr": {
      "url": "https://www.amazon.fr/s?k={q}",
      "pays": "FR",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": true
    },
    "darty": {
      "url": "https://www.darty.com/nav/recherche?text={q}",
      "pays": "FR",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "materielnet-pro": {
      "url": "https://www.materiel.net/recherche/{q}/",
      "pays": "FR",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "alternate.de": {
      "url": "https://www.alternate.de/listing.xhtml?q={q}",
      "pays": "DE",
      "priorite": 2,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "notebooksbilliger": {
      "url": "https://www.notebooksbilliger.de/produkte/{q}",
      "pays": "DE",
      "priorite": 2,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "cyberport": {
      "url": "https://www.cyberport.de/suche/?q={q}",
      "pays": "DE",
      "priorite": 2,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "jacob": {
      "url": "https://www.jacob.de/suche.html?q={q}",
      "pays": "DE",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "reichelt": {
      "url": "https://www.reichelt.de/index.html?ACTION=446&SEARCH={q}",
      "pays": "DE",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "amazon.de": {
      "url": "https://www.amazon.de/s?k={q}",
      "pays": "DE",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": true
    },
    "azerty": {
      "url": "https://azerty.nl/search?q={q}",
      "pays": "NL",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "alternate.nl": {
      "url": "https://www.alternate.nl/listing.xhtml?q={q}",
      "pays": "NL",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "coolblue": {
      "url": "https://www.coolblue.nl/zoeken?query={q}",
      "pays": "NL",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "coolmod": {
      "url": "https://www.coolmod.com/busqueda?q={q}",
      "pays": "ES",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "neobyte": {
      "url": "https://www.neobyte.es/buscar?controller=search&s={q}",
      "pays": "ES",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "versusgamers": {
      "url": "https://www.versusgamers.com/busqueda?s={q}",
      "pays": "ES",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "drako": {
      "url": "https://www.drako.it/drako_catalog/advanced_search_result.php?keywords={q}",
      "pays": "IT",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "nexths": {
      "url": "https://www.nexths.it/ricerca?q={q}",
      "pays": "IT",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "alternate.be": {
      "url": "https://www.alternate.be/listing.xhtml?q={q}",
      "pays": "BE",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "vandenborre": {
      "url": "https://www.vandenborre.be/fr/search?text={q}",
      "pays": "BE",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "e-tec": {
      "url": "https://e-tec.at/index.php?keyword={q}",
      "pays": "AT",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "x-kom": {
      "url": "https://www.x-kom.pl/szukaj?q={q}",
      "pays": "PL",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "morele": {
      "url": "https://www.morele.net/wyszukiwarka/0/,,,,,,,,0,,,,/1/?q={q}",
      "pays": "PL",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "komplett.dk": {
      "url": "https://www.komplett.dk/search?q={q}",
      "pays": "DK",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "inet.se": {
      "url": "https://www.inet.se/sok?q={q}",
      "pays": "SE",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "webhallen": {
      "url": "https://www.webhallen.com/se/search/{q}",
      "pays": "SE",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "pcdiga": {
      "url": "https://www.pcdiga.com/catalogsearch/result/?q={q}",
      "pays": "PT",
      "priorite": 4,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "moyenne",
      "marketplace": false
    },
    "alza": {
      "url": "https://www.alza.cz/search.htm?exps={q}",
      "pays": "CZ",
      "priorite": 3,
      "type": "marchand",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "skinflint": {
      "url": "https://skinflint.co.uk/?cat=&fs={q}",
      "pays": "UK",
      "priorite": 2,
      "type": "comparateur",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "prisjakt": {
      "url": "https://www.prisjakt.nu/search?query={q}",
      "pays": "SE",
      "priorite": 2,
      "type": "comparateur",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    },
    "kieskeurig": {
      "url": "https://www.kieskeurig.nl/zoeken?q={q}",
      "pays": "NL",
      "priorite": 2,
      "type": "comparateur",
      "actif": false,
      "a_verifier": true,
      "confiance": "haute",
      "marketplace": false
    }
  },
  "frais_port_par_pays": {
    "_comment": "Frais de port estimes, utilises pour comparer a armes egales. Mettez 'frais_port' sur un vendeur pour une valeur exacte.",
    "FR": 0,
    "FR/DE": 0,
    "DE": 14,
    "DE/AT": 14,
    "DE/CH": 18,
    "NL": 12,
    "ES": 10,
    "DK": 16,
    "BE": 8,
    "IT": 12
  },
  "franchise_port_par_defaut": null,
  "taux_change": {
    "_comment": "Taux vers l'euro. Sans taux renseigne, une offre dans une autre devise est ecartee plutot que comptee comme des euros.",
    "CHF": 1.07
  },
  "publication_dashboard": false,
  "publication": {
    "_comment": "Publication OPTIONNELLE du dashboard (prompt 9.2). Desactivee par defaut. Mettre publication_dashboard a true est un geste explicite : il rend les donnees du dashboard PUBLIQUES. Le depot cible doit etre un SECOND depot, public, dedie a ce seul usage -- jamais celui-ci. Voir PUBLICATION.md.",
    "depot": null,
    "branche": "main",
    "anonymiser": false
  }
}
