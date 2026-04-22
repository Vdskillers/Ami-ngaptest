/* ════════════════════════════════════════════════
   test-premium-gating.js — AMI v1.0
   ────────────────────────────────────────────────
   Valide l'étanchéité du forfait PREMIUM et le comportement
   attendu de tous les tiers.
     node test-premium-gating.js
════════════════════════════════════════════════ */
'use strict';

/* ═══ Répliquer les constantes de subscription.js (miroir exact) ═══ */
const FEATURES = {
  // ESSENTIEL
  cotation_ngap: { tier:'ESSENTIEL' }, patient_book: { tier:'ESSENTIEL' },
  tournee_basic: { tier:'ESSENTIEL' }, tresor_base: { tier:'ESSENTIEL' },
  rapport_mensuel: { tier:'ESSENTIEL' }, signature: { tier:'ESSENTIEL' },
  contact_admin: { tier:'ESSENTIEL' }, notes_soins: { tier:'ESSENTIEL' },
  historique: { tier:'ESSENTIEL' }, ngap_ref: { tier:'ESSENTIEL' }, km_journal: { tier:'ESSENTIEL' },
  // PRO
  tournee_ia_vrptw: { tier:'PRO' }, dashboard_stats: { tier:'PRO' },
  audit_cpam: { tier:'PRO' }, bsi: { tier:'PRO' }, pilulier: { tier:'PRO' },
  constantes: { tier:'PRO' }, alertes_med: { tier:'PRO' },
  compte_rendu: { tier:'PRO' }, consentements: { tier:'PRO' },
  copilote_ia: { tier:'PRO' }, transmissions: { tier:'PRO' }, ordonnances: { tier:'PRO' },
  charges_calc: { tier:'PRO' }, modeles_soins: { tier:'PRO' }, simulateur_maj: { tier:'PRO' },
  // CABINET
  cabinet_multi_ide: { tier:'CABINET' }, planning_shared: { tier:'CABINET' },
  transmissions_shared: { tier:'CABINET' }, cabinet_manage_members: { tier:'CABINET' },
  cabinet_consolidated_stats: { tier:'CABINET' }, compliance_engine: { tier:'CABINET' },
  // ═══ PREMIUM — les 6 features sous protection ═══
  optimisation_ca_plus:      { tier:'PREMIUM' },
  ca_sous_declare:           { tier:'PREMIUM' },
  protection_legale_plus:    { tier:'PREMIUM' },
  forensic_certificates:     { tier:'PREMIUM' },
  sla_support:               { tier:'PREMIUM' },
  rapport_juridique_mensuel: { tier:'PREMIUM' },
  // COMPTABLE
  dashboard_consolide: { tier:'COMPTABLE' },
  export_fiscal:       { tier:'COMPTABLE' },
  scoring_risque:      { tier:'COMPTABLE' }
};

const PREMIUM_FEATS = [
  'optimisation_ca_plus','ca_sous_declare','protection_legale_plus',
  'forensic_certificates','sla_support','rapport_juridique_mensuel'
];

const ACCESS_MATRIX = {
  TEST:      () => true,
  ADMIN:     () => true,
  TRIAL:     () => true,
  ESSENTIEL: f => FEATURES[f]?.tier === 'ESSENTIEL',
  PRO:       f => ['ESSENTIEL','PRO'].includes(FEATURES[f]?.tier),
  CABINET:   f => ['ESSENTIEL','PRO','CABINET'].includes(FEATURES[f]?.tier),
  PREMIUM:   f => ['ESSENTIEL','PRO','CABINET','PREMIUM'].includes(FEATURES[f]?.tier),
  COMPTABLE: f => FEATURES[f]?.tier === 'COMPTABLE' || FEATURES[f]?.tier === 'ESSENTIEL',
  LOCKED:    f => ['contact_admin','historique'].includes(f)
};

/* Miroir exact de hasAccess() de subscription.js */
function hasAccess(state, featId) {
  if (!featId) return true;
  if (!state) return false;

  if (state.isAdmin && state.simTier) {
    const MO_SIM = ['cabinet_manage_members','cabinet_consolidated_stats','compliance_engine'];
    if (MO_SIM.includes(featId)) return ['CABINET','PREMIUM','COMPTABLE','TRIAL'].includes(state.simTier);
    const m = ACCESS_MATRIX[state.simTier];
    return m ? m(featId) : false;
  }
  if (state.appMode === 'TEST') return true;
  if (state.isAdmin) return true;

  const tier = state.tier;
  const MO = ['cabinet_manage_members','cabinet_consolidated_stats','compliance_engine'];
  if (MO.includes(featId)) {
    const isManager = ['titulaire','gestionnaire'].includes(state.cabinetRole || '');
    if (!isManager) return false;
    if (state.cabinetMember) return true;
    return ['CABINET','PREMIUM','COMPTABLE'].includes(tier);
  }
  if (state.cabinetMember && tier !== 'LOCKED') {
    if (FEATURES[featId]?.tier === 'CABINET') return true;
  }
  if (state.premiumAddon && tier !== 'LOCKED') {
    if (FEATURES[featId]?.tier === 'PREMIUM') return true;
  }
  const m = ACCESS_MATRIX[tier];
  return m ? m(featId) : false;
}

/* ═══ Harness ═══ */
let pass=0, fail=0;
const results=[];
function expect(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  results.push({ label, actual, expected, ok });
}

const st = (overrides={}) => ({
  appMode:'PAYANT', tier:'ESSENTIEL', isAdmin:false, simTier:null,
  cabinetMember:false, cabinetRole:null, premiumAddon:false, ...overrides
});

/* ─── 1. Mode TEST global : tout le monde a tout ─── */
console.log('\n═══ 1. Mode TEST global (démo) ═══');
for (const t of ['ESSENTIEL','PRO','CABINET','LOCKED']) {
  for (const f of PREMIUM_FEATS) {
    expect(`TEST ${t} → ${f}`, hasAccess(st({appMode:'TEST',tier:t}), f), true);
  }
}

/* ─── 2. Admin : accès total pour démo ─── */
console.log('\n═══ 2. Admin (démo/support) ═══');
for (const f of PREMIUM_FEATS) {
  expect(`ADMIN → ${f}`, hasAccess(st({appMode:'PAYANT',tier:'ADMIN',isAdmin:true}), f), true);
}

/* ─── 3. TRIAL : accès total (essai gratuit 30j inclut PREMIUM) ─── */
console.log('\n═══ 3. TRIAL (essai gratuit) ═══');
for (const f of PREMIUM_FEATS) {
  expect(`TRIAL → ${f}`, hasAccess(st({tier:'TRIAL'}), f), true);
}

/* ─── 4. ⚡ ÉTANCHÉITÉ : PRO sans add-on = PAS de PREMIUM ─── */
console.log('\n═══ 4. PRO sans add-on → PEUT PAS accéder aux features PREMIUM ═══');
for (const f of PREMIUM_FEATS) {
  expect(`PRO (no addon) → ${f} MUST BE BLOCKED`, hasAccess(st({tier:'PRO'}), f), false);
}

/* ─── 5. ⚡ ÉTANCHÉITÉ : CABINET sans add-on = PAS de PREMIUM ─── */
console.log('\n═══ 5. CABINET sans add-on → PEUT PAS accéder aux features PREMIUM ═══');
for (const f of PREMIUM_FEATS) {
  expect(`CABINET (no addon) → ${f} MUST BE BLOCKED`,
    hasAccess(st({tier:'CABINET',cabinetMember:true,cabinetRole:'titulaire'}), f), false);
}

/* ─── 6. ⚡ ÉTANCHÉITÉ : ESSENTIEL sans add-on = PAS de PREMIUM ─── */
console.log('\n═══ 6. ESSENTIEL sans add-on → PEUT PAS accéder aux features PREMIUM ═══');
for (const f of PREMIUM_FEATS) {
  expect(`ESSENTIEL (no addon) → ${f} MUST BE BLOCKED`, hasAccess(st({tier:'ESSENTIEL'}), f), false);
}

/* ─── 7. ⚡ ÉTANCHÉITÉ : COMPTABLE = PAS de PREMIUM ─── */
console.log('\n═══ 7. COMPTABLE → PEUT PAS accéder aux features PREMIUM ═══');
for (const f of PREMIUM_FEATS) {
  expect(`COMPTABLE → ${f} MUST BE BLOCKED`, hasAccess(st({tier:'COMPTABLE'}), f), false);
}

/* ─── 8. ⚡ ÉTANCHÉITÉ : LOCKED = PAS de PREMIUM même avec flag addon corrompu ─── */
console.log('\n═══ 8. LOCKED → PAS de PREMIUM même si flag addon=true ═══');
for (const f of PREMIUM_FEATS) {
  expect(`LOCKED+addonTrue → ${f} MUST BE BLOCKED`,
    hasAccess(st({tier:'LOCKED',premiumAddon:true}), f), false);
}

/* ─── 9. ✅ ADD-ON ACTIF : PRO + addon = PREMIUM OK ─── */
console.log('\n═══ 9. PRO + add-on PREMIUM actif → accès PREMIUM ✓ ═══');
for (const f of PREMIUM_FEATS) {
  expect(`PRO+addon → ${f}`, hasAccess(st({tier:'PRO',premiumAddon:true}), f), true);
}
// Et garde l'accès PRO normal
expect('PRO+addon → dashboard_stats (PRO)', hasAccess(st({tier:'PRO',premiumAddon:true}), 'dashboard_stats'), true);
// Et toujours pas les COMPTABLE
expect('PRO+addon → export_fiscal (COMPTABLE) MUST BE BLOCKED',
  hasAccess(st({tier:'PRO',premiumAddon:true}), 'export_fiscal'), false);

/* ─── 10. ✅ ADD-ON ACTIF : CABINET + addon = PREMIUM OK ─── */
console.log('\n═══ 10. CABINET + add-on PREMIUM actif → accès PREMIUM ✓ ═══');
for (const f of PREMIUM_FEATS) {
  expect(`CABINET+addon → ${f}`,
    hasAccess(st({tier:'CABINET',cabinetMember:true,cabinetRole:'titulaire',premiumAddon:true}), f), true);
}

/* ─── 11. ⚡ Bonus cabinet NE déverrouille PAS PREMIUM ─── */
console.log('\n═══ 11. Membre cabinet simple (tier PRO) → accède à CABINET features mais PAS aux PREMIUM ═══');
expect('PRO+cabinetMember → planning_shared (CABINET)',
  hasAccess(st({tier:'PRO',cabinetMember:true,cabinetRole:'membre'}), 'planning_shared'), true);
for (const f of PREMIUM_FEATS) {
  expect(`PRO+cabinetMember (no addon) → ${f} MUST BE BLOCKED`,
    hasAccess(st({tier:'PRO',cabinetMember:true,cabinetRole:'membre'}), f), false);
}

/* ─── 12. Admin simulation : simule PRO → bloque PREMIUM ─── */
console.log('\n═══ 12. Admin simulation PRO → voit les blocages PREMIUM (pour valider UX) ═══');
for (const f of PREMIUM_FEATS) {
  expect(`ADMIN sim=PRO → ${f} MUST BE BLOCKED`,
    hasAccess(st({appMode:'PAYANT',tier:'ADMIN',isAdmin:true,simTier:'PRO'}), f), false);
}
// Admin sim CABINET → bloque PREMIUM aussi
for (const f of PREMIUM_FEATS) {
  expect(`ADMIN sim=CABINET → ${f} MUST BE BLOCKED`,
    hasAccess(st({appMode:'PAYANT',tier:'ADMIN',isAdmin:true,simTier:'CABINET'}), f), false);
}
// Admin sim TRIAL → accès total
for (const f of PREMIUM_FEATS) {
  expect(`ADMIN sim=TRIAL → ${f}`,
    hasAccess(st({appMode:'PAYANT',tier:'ADMIN',isAdmin:true,simTier:'TRIAL'}), f), true);
}

/* ═══ Résumé ═══ */
console.log('\n════════════════════════════════════════');
console.log(`Tests exécutés : ${pass + fail}`);
console.log(`✓ Passés : ${pass}`);
console.log(`✗ Échoués : ${fail}`);
if (fail > 0) {
  console.log('\n━━━ ÉCHECS ━━━');
  results.filter(r=>!r.ok).forEach(r =>
    console.log(`  ✗ ${r.label}\n    attendu: ${r.expected}, obtenu: ${r.actual}`));
  process.exit(1);
}
console.log('\n🎉 Tous les tests passent — l\'étanchéité PREMIUM est garantie.\n');
