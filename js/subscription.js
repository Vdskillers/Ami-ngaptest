/* ════════════════════════════════════════════════════════════════════
   subscription.js — AMI NGAP v3.0
   ────────────────────────────────────────────────────────────────────
   v3.0 — REFONTE UI ABONNEMENT (basée sur landing v2)
   ✅ Nouveau design 4 cartes (Essentiel / Pro / Cabinet / Premium)
   ✅ Toggle Premium au sommet (style landing)
   ✅ Mode TEST (défaut) : aucune limitation pour personne
   ✅ Mode PAYANT : essai 30j auto + tiers + verrous
   ✅ Aperçu PUBLIC (tous utilisateurs) : prévisualiser ce que voit chaque tier
   ✅ Simulation admin : inchangée (rétro-compatible)
   ✅ Bandeau "jours restants" + carte abonnement intégrée au profil

   📦 API PUBLIQUE (rétro-compatible)
   SUB.getState() / SUB.currentTier() / SUB.hasAccess()
   SUB.requireAccess() / SUB.bootstrap() / SUB.refresh()
   SUB.upgrade(tier) / SUB.setAdminSim() / SUB.clearAdminSim()
   SUB.previewTier(tier) / SUB.clearPreview()       ← NOUVEAU v3.0
   SUB.renderProfileCard(containerId)               ← NOUVEAU v3.0
   SUB.showPaywall() / SUB.applyUILocks() / SUB.renderAbonnementPage()
═════════════════════════════════════════════════════════════════════ */
'use strict';

window.SUB = (function(){

  /* ───── 1. TIERS & FEATURES ──────────────────────────────────────── */

  const TIERS = {
    TEST:      { label:'Mode test (illimité)',  price:'—',                   priority:999, color:'#00d4aa' },
    TRIAL:     { label:'Essai gratuit',          price:'0 €',                priority:900, color:'#00d4aa' },
    ESSENTIEL: { label:'Essentiel',              price:'29 € / mois',        priority:1,   color:'#4fa8ff', tagline:'« Arrête de perdre de l\'argent »' },
    PRO:       { label:'Pro',                    price:'49 € / mois',        priority:2,   color:'#00d4aa', tagline:'« Optimise tes revenus sans effort »' },
    CABINET:   { label:'Cabinet',                price:'Dégressif',          priority:3,   color:'#a78bfa', tagline:'« Gère ton cabinet comme un pro »', pricingDetail:'1–2 IDE → 49 € · 3–5 IDE → 39 € · 6+ IDE → 29 € HT / IDE / mois' },
    PREMIUM:   { label:'Premium',                price:'+29 € / mois',       priority:4,   color:'#fbbf24', tagline:'« Zéro stress. Zéro contrôle surprise. »' },
    COMPTABLE: { label:'AMI Comptable',          price:'99 € HT / mois',     priority:5,   color:'#ff5f6d', pricingDetail:'20 IDEL incluses · +5 € HT par IDEL supplémentaire' },
    LOCKED:    { label:'Aucun abonnement',       price:'—',                  priority:0,   color:'#6a8099' },
    ADMIN:     { label:'Admin (bypass)',         price:'—',                  priority:999, color:'#ff5f6d' }
  };

  const FEATURES = {
    cotation_ngap:       { tier:'ESSENTIEL', label:'Cotation NGAP',           desc:'Cotation intelligente de vos actes infirmiers avec vérification IA.' },
    patient_book:        { tier:'ESSENTIEL', label:'Carnet patients',         desc:'Gestion chiffrée locale de vos patients.' },
    tournee_basic:       { tier:'ESSENTIEL', label:'Tournée basique',         desc:'Import calendrier, planning, pilotage journée.' },
    tresor_base:         { tier:'ESSENTIEL', label:'Trésorerie',              desc:'Suivi remboursements AMO/AMC.' },
    rapport_mensuel:     { tier:'ESSENTIEL', label:'Rapport mensuel',         desc:'Synthèse automatique de votre activité.' },
    signature:           { tier:'ESSENTIEL', label:'Signatures électroniques', desc:'Signature tactile sur feuille de soins.' },
    contact_admin:       { tier:'ESSENTIEL', label:'Contact support',         desc:'Messagerie directe avec le support AMI.' },
    notes_soins:         { tier:'ESSENTIEL', label:'Notes de soins',          desc:'Prise de notes patient chiffrée.' },
    historique:          { tier:'ESSENTIEL', label:'Historique',              desc:'Historique de vos cotations.' },
    ngap_ref:            { tier:'ESSENTIEL', label:'Référentiel NGAP',        desc:'Nomenclature officielle consultable.' },
    km_journal:          { tier:'ESSENTIEL', label:'Journal kilométrique',    desc:'Suivi des déplacements pour déclaration.' },
    tournee_ia_vrptw:    { tier:'PRO', label:'Tournée IA (VRPTW + 2-opt)',    desc:'Optimisation intelligente de l\'ordre de passage.' },
    dashboard_stats:     { tier:'PRO', label:'Dashboard & statistiques',      desc:'Tableau de bord avancé, comparatifs, tendances.' },
    audit_cpam:          { tier:'PRO', label:'Simulateur audit CPAM',         desc:'Simulez un contrôle CPAM avant qu\'il n\'arrive.' },
    bsi:                 { tier:'PRO', label:'BSI — Bilan soins infirmiers',  desc:'Génération et suivi des BSI.' },
    pilulier:            { tier:'PRO', label:'Semainier / Pilulier',          desc:'Gestion des piluliers patients.' },
    constantes:          { tier:'PRO', label:'Constantes patients',           desc:'Suivi TA, glycémie, SpO2 avec graphiques.' },
    alertes_med:         { tier:'PRO', label:'Alertes médicamenteuses',       desc:'Détection interactions, redondances.' },
    compte_rendu:        { tier:'PRO', label:'Compte-rendu de passage',       desc:'Générateur automatique de CR patient.' },
    consentements:       { tier:'PRO', label:'Consentements éclairés',        desc:'Gestion traçabilité RGPD.' },
    copilote_ia:         { tier:'PRO', label:'Copilote IA',                   desc:'Assistant conversationnel NGAP via xAI Grok.' },
    transmissions:       { tier:'PRO', label:'Transmissions infirmières',     desc:'Journal de transmissions chiffré.' },
    ordonnances:         { tier:'PRO', label:'Gestion ordonnances',           desc:'Cycle de vie des ordos patient.' },
    charges_calc:        { tier:'PRO', label:'Calcul charges & net',          desc:'Projection net/brut, URSSAF, CARPIMKO.' },
    modeles_soins:       { tier:'PRO', label:'Modèles de soins',              desc:'Bibliothèque de modèles réutilisables.' },
    simulateur_maj:      { tier:'PRO', label:'Simulateur majoration',         desc:'Test des cumuls de majorations.' },
    cabinet_multi_ide:   { tier:'CABINET', label:'Cabinet multi-IDE',          desc:'Gestion d\'un cabinet 2 à 6 infirmières.' },
    planning_shared:     { tier:'CABINET', label:'Planning partagé',           desc:'Coordination des tournées du cabinet.' },
    transmissions_shared:{ tier:'CABINET', label:'Transmissions partagées',    desc:'Journal collaboratif du cabinet.' },
    cabinet_manage_members:    { tier:'CABINET', label:'Gestion des membres', desc:'Inviter, promouvoir et retirer des membres du cabinet.' },
    cabinet_consolidated_stats:{ tier:'CABINET', label:'Stats consolidées cabinet', desc:'Vue CA, actes et performance de toutes les IDE du cabinet.' },
    compliance_engine:   { tier:'CABINET', label:'Conformité cabinet',         desc:'Moteur de conformité du cabinet : scoring 4 piliers, auto-correction, risque prédictif.' },
    /* ═══ 💎 PREMIUM — Add-on (+29 € HT / mois) ═══ */
    optimisation_ca_plus:    { tier:'PREMIUM', label:'Optimisation CA avancée',         desc:'Revenue engine premium : IA prédictive sur manques-à-gagner.' },
    ca_sous_declare:         { tier:'PREMIUM', label:'Détection CA sous-déclaré',       desc:'Croisement longitudinal pour détecter les actes non-cotés.' },
    protection_legale_plus:  { tier:'PREMIUM', label:'Protection médico-légale+',       desc:'Couche renforcée : opposabilité CPAM, archivage probant 10 ans.' },
    forensic_certificates:   { tier:'PREMIUM', label:'Preuves légales opposables',      desc:'Bouclier anti-contrôle CPAM : certificats horodatés RFC 3161.' },
    sla_support:             { tier:'PREMIUM', label:'SLA support prioritaire < 2h',    desc:'Engagement contractuel de réponse support < 2h ouvrées.' },
    rapport_juridique_mensuel:{ tier:'PREMIUM', label:'Rapport juridique mensuel',      desc:'Synthèse mensuelle auditée : conformité, preuves, exposition contentieux.' },
    /* ═══ 🧑‍💼 COMPTABLE — Expertise comptable santé ═══ */
    dashboard_consolide: { tier:'COMPTABLE', label:'Dashboard consolidé multi-IDEL',  desc:'Vue agrégée du portefeuille (jusqu\'à 20 IDEL incluses).' },
    export_fiscal:       { tier:'COMPTABLE', label:'Export FEC + liasse fiscale 2035', desc:'Génération automatique du Fichier des Écritures Comptables.' },
    scoring_risque:      { tier:'COMPTABLE', label:'Scoring risque portfolio',         desc:'Scoring de risque CPAM/fiscal de chaque IDEL sous mandat.' },
    generateur_2042:     { tier:'COMPTABLE', label:'Générateur 2042-C-PRO',            desc:'Pré-remplissage automatique des déclarations sociales et fiscales.' },
    alertes_ngap_masse:  { tier:'COMPTABLE', label:'Alertes anomalies NGAP en masse',  desc:'Détection d\'anomalies de cotation sur tout le portefeuille.' },
    connecteurs_compta:  { tier:'COMPTABLE', label:'Connecteurs Cegid · EBP · Quadra', desc:'Export direct vers les principaux logiciels comptables.' },
    vue_anonymisee:      { tier:'COMPTABLE', label:'Vue anonymisée (pseudo-FEC)',      desc:'Vue RGPD-safe : aucune donnée patient identifiable.' },
    rapport_trimestriel: { tier:'COMPTABLE', label:'Rapports trimestriels automatiques', desc:'Génération automatique des rapports trimestriels par IDEL.' }
  };

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

  /* ───── 2. PLAN_DETAILS — features visibles sur la carte ────────── */

  const PLAN_DETAILS = {
    ESSENTIEL: {
      tag: '🟢 Starter',
      subtitle: '« Arrête de perdre de l\'argent »',
      features: [
        { txt:'Cotation intelligente', icon:'✓' },
        { txt:'Alertes erreurs',       icon:'✓' },
        { txt:'Journal des actes',     icon:'✓' },
        { txt:'Support standard',      icon:'✓' }
      ],
      cta: 'Commencer'
    },
    PRO: {
      tag: '🔵 Pro',
      subtitle: '« Optimise tes revenus sans effort »',
      features: [
        { txt:'Tout Starter, plus :',   icon:'✓', bold:true },
        { txt:'Dashboard & statistiques', icon:'✓' },
        { txt:'Simulateur CPAM',         icon:'✓' },
        { txt:'Alertes avancées',        icon:'✓' },
        { txt:'Suggestions d\'optimisation IA', icon:'✓' }
      ],
      callout: { txt:'+150 à +300 € / mois récupérés', icon:'💸', color:'var(--a)' },
      popular: true,
      cta: 'Choisir ce plan'
    },
    CABINET: {
      tag: '🟣 Cabinet',
      subtitle: '« Gère ton cabinet comme un pro »',
      features: [
        { txt:'Tout Pro, plus :',         icon:'✓', bold:true },
        { txt:'Multi-IDE (sync sélective)', icon:'✓' },
        { txt:'Statistiques globales',     icon:'✓' },
        { txt:'Gestion des tournées',      icon:'✓' },
        { txt:'Accès manager / planning',  icon:'✓' }
      ],
      cta: 'Démarrer mon cabinet',
      pricePrefix: 'Dégressif',
      priceDetail: '1-2 IDE → 49 € · 3-5 IDE → 39 € · 6+ IDE → 29 €',
      priceSuffix: 'par IDE / mois'
    },
    PREMIUM: {
      tag: '💎 Premium',
      subtitle: '« Zéro stress. Zéro contrôle surprise. »',
      features: [
        { txt:'Détection des pertes invisibles',    icon:'✓' },
        { txt:'Optimisation IA avancée',            icon:'✓' },
        { txt:'Protection juridique renforcée',     icon:'✓' },
        { txt:'Audit mensuel automatique',          icon:'✓' }
      ],
      callout: { txt:'Chaque mois, tu récupères plus que ce que ça coûte', icon:'💎', color:'#fbbf24' },
      cta: 'Activer Premium',
      pricePrefix: '+',
      priceSuffix: '€ / mois',
      addonNote: 'À ajouter à ton plan actuel'
    },
    COMPTABLE: {
      tag: '🧑‍💼 Comptable',
      subtitle: 'Cabinet d\'expertise comptable santé',
      features: [
        { txt:'Dashboard consolidé multi-IDEL',     icon:'✓' },
        { txt:'Export FEC + liasse fiscale 2035',   icon:'✓' },
        { txt:'Générateur 2042-C-PRO · URSSAF',     icon:'✓' },
        { txt:'Scoring risque portfolio',            icon:'✓' },
        { txt:'Alertes anomalies NGAP en masse',     icon:'✓' },
        { txt:'Connecteurs Cegid · EBP · Quadra',    icon:'✓' },
        { txt:'Rapports trimestriels automatiques',  icon:'✓' }
      ],
      cta: 'Choisir ce plan'
    }
  };

  /* ───── 3. ÉTAT ──────────────────────────────────────────────────── */

  let _state = null;
  let _userId = null;
  let _role   = null;
  const TRIAL_DAYS = 30;
  const STORAGE_ADMIN_SIM = 'ami_admin_sim_tier';
  const STORAGE_PREVIEW   = 'ami_preview_tier';

  /* ───── 4. WORKER FETCH ──────────────────────────────────────────── */

  function _workerURL() { return (typeof W !== 'undefined') ? W : ''; }
  function _token() {
    try { return (typeof ss !== 'undefined' && ss.tok()) || ''; } catch { return ''; }
  }

  async function _api(path, body = null) {
    const url = _workerURL() + path;
    const headers = { 'Content-Type': 'application/json' };
    const tok = _token();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const opts = { method: body !== null ? 'POST' : 'GET', headers };
    if (body !== null) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const txt = await r.text();
    let data = null; try { data = JSON.parse(txt); } catch {}
    if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  }

  /* ───── 5. BOOTSTRAP ─────────────────────────────────────────────── */

  async function bootstrap(userId, role) {
    _userId = userId;
    _role   = role;
    _injectStyles();    // ← CSS auto-injecté (pas besoin de modifier style.css)

    try {
      const data = await _api('/webhook/subscription-status', {});
      const simTier = (role === 'admin') ? sessionStorage.getItem(STORAGE_ADMIN_SIM) : null;
      const prevTier = (role !== 'admin') ? sessionStorage.getItem(STORAGE_PREVIEW) : null;
      _state = {
        appMode:  data.app_mode || 'TEST',
        tier:     data.tier,
        isTrial:  !!data.is_trial,
        trialEnd: data.trial_end || null,
        trialStart: data.trial_start || null,
        paidUntil: data.paid_until || null,
        daysLeft: data.days_left,
        locked:   !!data.locked,
        isAdmin:  role === 'admin',
        simTier:  simTier,
        isAdminSim: !!(role === 'admin' && simTier),
        previewTier: prevTier,
        isPreview: !!(role !== 'admin' && prevTier),
        cabinetMember: !!data.cabinet_member,
        cabinetSize:   data.cabinet_size || 0,
        cabinetRole:   data.cabinet_role || null,
        premiumAddon:  !!data.premium_addon,
        premiumAddonUntil: data.premium_addon_until || null
      };
      console.info('[SUB] bootstrap OK — appMode=%s tier=%s trial=%s locked=%s cabinet=%s',
        _state.appMode, _state.tier, _state.isTrial, _state.locked, _state.cabinetMember);
    } catch (e) {
      console.warn('[SUB] bootstrap failed, fallback mode TEST:', e.message);
      const simTier = (role === 'admin') ? sessionStorage.getItem(STORAGE_ADMIN_SIM) : null;
      const prevTier = (role !== 'admin') ? sessionStorage.getItem(STORAGE_PREVIEW) : null;
      _state = {
        appMode: 'TEST',
        tier: role === 'admin' ? 'ADMIN' : 'TEST',
        isTrial: false, isAdmin: role === 'admin',
        simTier, isAdminSim: !!(role === 'admin' && simTier),
        previewTier: prevTier, isPreview: !!(role !== 'admin' && prevTier),
        cabinetMember: false, cabinetSize: 0, cabinetRole: null,
        premiumAddon: false, premiumAddonUntil: null,
        _fallback: true
      };
    }

    _applyTrialBanner();
    _applyPreviewBanner();
    setTimeout(applyUILocks, 100);
    setTimeout(_checkExpirationNotification, 500);
    setTimeout(_checkCabinetRoleChange, 700);

    setTimeout(() => {
      const modal = document.getElementById('sub-paywall');
      if (modal && modal.classList.contains('open')) {
        const featId = modal.dataset.featId;
        if (featId && hasAccess(featId)) {
          console.info('[SUB] bootstrap OK → fermeture auto paywall %s', featId);
          _closePaywall();
        }
      }
    }, 150);
    return _state;
  }

  async function refresh() {
    if (_userId) return bootstrap(_userId, _role);
  }

  /* ───── 6. GATE API ──────────────────────────────────────────────── */

  function currentTier() {
    if (!_state) return 'LOCKED';
    if (_state.isAdmin && _state.simTier) return _state.simTier;
    if (_state.isPreview && _state.previewTier) return _state.previewTier;
    return _state.tier;
  }

  function getState() {
    if (!_state) return { tier:'LOCKED', locked:true, appMode:'TEST' };
    return {
      tier: currentTier(),
      realTier: _state.tier,
      appMode: _state.appMode,
      isTrial: !!_state.isTrial,
      daysLeft: _state.daysLeft,
      trialEnd: _state.trialEnd,
      trialStart: _state.trialStart,
      paidUntil: _state.paidUntil,
      locked: !!_state.locked,
      isAdmin: !!_state.isAdmin,
      isAdminSim: !!(_state.isAdmin && _state.simTier),
      simTier: _state.simTier,
      isPreview: !!_state.isPreview,
      previewTier: _state.previewTier,
      cabinetMember: !!_state.cabinetMember,
      cabinetSize: _state.cabinetSize || 0,
      cabinetRole: _state.cabinetRole || null,
      isCabinetManager: ['titulaire','gestionnaire'].includes(_state.cabinetRole || ''),
      premiumAddon: !!_state.premiumAddon,
      premiumAddonUntil: _state.premiumAddonUntil || null,
      premiumActive: _premiumActive(),
      premiumStatus: premiumStatus(),
      fallback: !!_state._fallback
    };
  }

  function isCabinetManager() {
    if (!_state) return false;
    return ['titulaire','gestionnaire'].includes(_state.cabinetRole || '');
  }

  function cabinetRole() { return _state?.cabinetRole || null; }

  function _premiumActive() {
    if (!_state) return false;
    if (!_state.premiumAddon) return false;
    const until = _state.premiumAddonUntil;
    if (!until) return true;
    const t = (typeof until === 'number') ? until : Date.parse(until);
    if (isNaN(t)) return true;
    return Date.now() < t;
  }

  function premiumStatus() {
    if (!_state) return 'none';
    if (!_state.premiumAddon) return 'none';
    if (!_state.premiumAddonUntil) return 'active';
    return _premiumActive() ? 'active' : 'expired';
  }

  function entitlements() {
    return {
      canUseDashboard:     hasAccess('dashboard_stats'),
      canUseCopilot:       hasAccess('copilote_ia'),
      canUseTourneeIA:     hasAccess('tournee_ia_vrptw'),
      canUseBSI:           hasAccess('bsi'),
      canUseAuditCPAM:     hasAccess('audit_cpam'),
      canOptimizeCA:       hasAccess('optimisation_ca_plus'),
      canDetectFraud:      hasAccess('ca_sous_declare'),
      hasLegalProtection:  hasAccess('protection_legale_plus'),
      hasForensicCerts:    hasAccess('forensic_certificates'),
      hasSLAPriority:      hasAccess('sla_support'),
      hasLegalReport:      hasAccess('rapport_juridique_mensuel'),
      canManageCabinet:    hasAccess('cabinet_manage_members'),
      hasCabinetStats:     hasAccess('cabinet_consolidated_stats'),
      hasComplianceEngine: hasAccess('compliance_engine'),
      premiumActive:       _premiumActive(),
      premiumStatus:       premiumStatus()
    };
  }

  function hasAccess(featId) {
    if (!featId) return true;
    if (!_state) return true;

    // Admin en SIMULATION : prime sur tout
    if (_state.isAdmin && _state.simTier) {
      const simTier = _state.simTier;
      const MANAGER_ONLY_SIM = ['cabinet_manage_members', 'cabinet_consolidated_stats', 'compliance_engine'];
      if (MANAGER_ONLY_SIM.includes(featId)) {
        return ['CABINET','PREMIUM','COMPTABLE','TRIAL'].includes(simTier);
      }
      const matrix = ACCESS_MATRIX[simTier];
      return matrix ? matrix(featId) : false;
    }

    // 👁️ APERÇU UTILISATEUR : prime sur le tier réel (UI seulement, backend continue d'enforcer)
    if (_state.isPreview && _state.previewTier) {
      const prevTier = _state.previewTier;
      const matrix = ACCESS_MATRIX[prevTier];
      return matrix ? matrix(featId) : false;
    }

    // Mode TEST global
    if (_state.appMode === 'TEST') return true;

    // Admin sans sim
    if (_state.isAdmin) return true;

    const tier = _state.tier;

    // Features manager-only cabinet
    const MANAGER_ONLY = ['cabinet_manage_members', 'cabinet_consolidated_stats', 'compliance_engine'];
    if (MANAGER_ONLY.includes(featId)) {
      if (!isCabinetManager()) return false;
      if (_state.cabinetMember) return true;
      return ['CABINET','PREMIUM','COMPTABLE'].includes(tier);
    }

    // Bonus cabinet
    if (_state.cabinetMember && tier !== 'LOCKED') {
      if (FEATURES[featId]?.tier === 'CABINET') return true;
    }

    // Add-on Premium
    if (_state.premiumAddon && tier !== 'LOCKED' && _premiumActive()) {
      if (FEATURES[featId]?.tier === 'PREMIUM') return true;
    }

    const matrix = ACCESS_MATRIX[tier];
    return matrix ? matrix(featId) : false;
  }

  function requireAccess(featId, opts) {
    opts = opts || {};
    if (hasAccess(featId)) return true;
    if (opts.silent) return false;
    showPaywall(featId);
    if (typeof opts.onDenied === 'function') opts.onDenied(featId);
    return false;
  }

  function _requiredTierFor(featId) { return FEATURES[featId]?.tier || 'PRO'; }

  /* ───── 7. UPGRADE (nurse) ───────────────────────────────────────── */

  async function upgrade(tier) {
    if (!_userId || _role === 'admin') return false;
    try {
      const r = await _api('/webhook/subscription-upgrade', { tier });
      await refresh();
      alert(`✓ ${r.message || ''}\nVous êtes maintenant sur ${TIERS[tier]?.label || tier}.`);
      return true;
    } catch (e) {
      alert('Erreur : ' + e.message);
      return false;
    }
  }

  /* ───── 8. ADMIN SIM (admin uniquement) ──────────────────────────── */

  function setAdminSim(tier) {
    if (_role !== 'admin') return false;
    if (tier && !TIERS[tier] && tier !== 'LOCKED') return false;
    _state.simTier = tier || null;
    _state.isAdminSim = !!tier;
    if (tier) sessionStorage.setItem(STORAGE_ADMIN_SIM, tier);
    else sessionStorage.removeItem(STORAGE_ADMIN_SIM);
    _applyTrialBanner();
    applyUILocks();
    if (document.getElementById('view-mon-abo')?.classList.contains('on')) renderAbonnementPage();
    return true;
  }
  function clearAdminSim() { return setAdminSim(null); }

  /* ───── 9. APERÇU UTILISATEUR (tous, sauf admin) ─────────────────── */
  /* Permet à n'importe quel utilisateur de prévisualiser ce que voit
     un abonné d'un tier donné. UI-only — le backend continue d'enforcer
     les vraies permissions sur les opérations privilégiées. */

  function previewTier(tier) {
    if (_role === 'admin') return setAdminSim(tier);   // admin → utilise sim
    if (!_state) return false;
    if (tier && !TIERS[tier] && tier !== 'LOCKED') return false;
    _state.previewTier = tier || null;
    _state.isPreview = !!tier;
    if (tier) sessionStorage.setItem(STORAGE_PREVIEW, tier);
    else sessionStorage.removeItem(STORAGE_PREVIEW);
    _applyPreviewBanner();
    applyUILocks();
    if (document.getElementById('view-mon-abo')?.classList.contains('on')) renderAbonnementPage();
    return true;
  }
  function clearPreview() { return previewTier(null); }

  /* ───── 10. UI : BANDEAUX ────────────────────────────────────────── */

  function _applyTrialBanner() {
    let banner = document.getElementById('sub-trial-banner');
    const st = getState();

    const shouldShow =
      (st.appMode === 'PAYANT' && st.isTrial && !st.isAdmin) ||
      (st.appMode === 'PAYANT' && st.locked && !st.isAdmin) ||
      (st.isAdmin && st.isAdminSim);

    if (!shouldShow) { if (banner) banner.remove(); return; }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sub-trial-banner';
      banner.className = 'sub-trial-banner';
      const main = document.querySelector('.main');
      if (main) main.insertBefore(banner, main.firstChild);
    }

    let html = '';
    if (st.isAdmin && st.isAdminSim) {
      html = `<span class="stb-ic">🛡️</span>
              <span><b>Mode admin — simulation ${TIERS[st.simTier]?.label || st.simTier}</b>
              · Vous voyez ce qu'une IDEL au tier ${st.simTier} verrait.</span>
              <button class="stb-btn" onclick="SUB.clearAdminSim()">Quitter la simulation</button>`;
    } else if (st.isTrial) {
      const color = st.daysLeft <= 7 ? 'var(--w)' : 'var(--a)';
      html = `<span class="stb-ic">✨</span>
              <span><b style="color:${color}">Essai gratuit — ${st.daysLeft} jour${st.daysLeft>1?'s':''} restant${st.daysLeft>1?'s':''}</b>
              · Accès total à toutes les fonctionnalités.</span>
              <button class="stb-btn" onclick="navTo('mon-abo')">Voir les abonnements</button>`;
    } else if (st.locked) {
      const wasPaidExpired = !!st.paidUntil && new Date(st.paidUntil).getTime() < Date.now();
      if (wasPaidExpired) {
        html = `<span class="stb-ic">⏱️</span>
                <span><b style="color:var(--d)">Votre abonnement a expiré le ${new Date(st.paidUntil).toLocaleDateString('fr-FR')}.</b>
                · Renouvelez pour retrouver l'accès.</span>
                <button class="stb-btn stb-btn-cta" onclick="navTo('mon-abo')">Renouveler</button>`;
      } else {
        html = `<span class="stb-ic">🔒</span>
                <span><b style="color:var(--d)">Votre essai gratuit est terminé.</b>
                · Choisissez un abonnement pour retrouver l'accès complet.</span>
                <button class="stb-btn stb-btn-cta" onclick="navTo('mon-abo')">Voir les abonnements</button>`;
      }
    }
    banner.innerHTML = html;
  }

  /** Bandeau "👁️ Aperçu" — visible uniquement quand un user non-admin est en preview */
  function _applyPreviewBanner() {
    let banner = document.getElementById('sub-preview-banner');
    const st = getState();
    if (!st.isPreview || st.isAdmin) {
      if (banner) banner.remove();
      document.body.classList.remove('sub-in-preview');
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sub-preview-banner';
      banner.className = 'sub-preview-banner';
      const main = document.querySelector('.main');
      if (main) main.insertBefore(banner, main.firstChild);
    }
    document.body.classList.add('sub-in-preview');
    const tinfo = TIERS[st.previewTier];
    banner.innerHTML = `
      <span class="spb-ic">👁️</span>
      <span><b style="color:${tinfo?.color||'var(--a)'}">Mode aperçu — ${tinfo?.label || st.previewTier}</b>
      · Vous visualisez ce que verrait un abonné <em>${tinfo?.label || st.previewTier}</em>.
      Les fonctionnalités s'affichent comme déverrouillées, mais ne sont pas réellement débloquées.</span>
      <button class="spb-btn spb-btn-cta" onclick="SUB._confirmUpgrade('${st.previewTier}')">Activer ce plan</button>
      <button class="spb-btn" onclick="SUB.clearPreview()">Quitter l'aperçu</button>`;
  }

  /* ───── 11. UI : CADENAS NAV ─────────────────────────────────────── */

  const NAV_FEATURE_MAP = {
    'cot':'cotation_ngap','patients':'patient_book','imp':'tournee_basic',
    'tur':'tournee_ia_vrptw','live':'tournee_basic','pla':'tournee_basic',
    'his':'historique','outils-ordos':'ordonnances','outils-km':'km_journal',
    'sig':'signature','pilulier':'pilulier','constantes':'constantes',
    'tresor':'tresor_base','rapport':'rapport_mensuel','dash':'dashboard_stats',
    'copilote':'copilote_ia','compte-rendu':'compte_rendu','bsi':'bsi',
    'consentements':'consentements','alertes-med':'alertes_med','audit-cpam':'audit_cpam',
    'outils-charges':'charges_calc','outils-modeles':'modeles_soins',
    'outils-simulation':'simulateur_maj','cabinet':'cabinet_multi_ide',
    'transmissions':'transmissions','compliance':'compliance_engine',
    'ngap-ref':'ngap_ref','contact':'contact_admin','mon-abo':null,
    'ca-sous-declare':'ca_sous_declare',
    'forensic-cert':'forensic_certificates',
    'rapport-juridique':'rapport_juridique_mensuel',
    'comptable-hub':'dashboard_consolide',
    'comptable-dashboard':'dashboard_consolide',
    'comptable-export-fec':'export_fiscal',
    'comptable-2042':'generateur_2042',
    'comptable-scoring':'scoring_risque',
    'comptable-alertes':'alertes_ngap_masse',
    'comptable-connecteurs':'connecteurs_compta',
    'comptable-anonymisee':'vue_anonymisee',
    'comptable-trimestriel':'rapport_trimestriel'
  };

  function _featureForView(v) { return NAV_FEATURE_MAP[v] || null; }

  function applyUILocks() {
    const st = getState();
    // Mode TEST désactive les locks, SAUF en simulation admin OU en aperçu user
    const modeTest = st.appMode === 'TEST' && !st.isAdminSim && !st.isPreview;

    document.querySelectorAll('.ni[data-v]').forEach(el => {
      const v = el.dataset.v;
      const feat = _featureForView(v);
      if (!feat || modeTest) {
        el.classList.remove('ni-locked');
        el.querySelector('.ni-lock-badge')?.remove();
        return;
      }
      if (hasAccess(feat)) {
        el.classList.remove('ni-locked');
        el.querySelector('.ni-lock-badge')?.remove();
      } else {
        el.classList.add('ni-locked');
        if (!el.querySelector('.ni-lock-badge')) {
          const badge = document.createElement('span');
          badge.className = 'ni-lock-badge';
          const tierReq = _requiredTierFor(feat);
          const tinfo = TIERS[tierReq];
          badge.innerHTML = `🔒 <span class="ni-lock-tier" style="color:${tinfo?.color||'var(--m)'}">${tierReq}</span>`;
          el.appendChild(badge);
        }
      }
    });

    document.querySelectorAll('#bottom-nav .bn-item[data-v], #mobile-menu .bn-item[data-v]').forEach(el => {
      const v = el.dataset.v;
      const feat = _featureForView(v);
      if (!feat || modeTest) { el.classList.remove('ni-locked'); return; }
      if (hasAccess(feat)) el.classList.remove('ni-locked');
      else el.classList.add('ni-locked');
    });
  }

  /* ───── 12. PAYWALL ──────────────────────────────────────────────── */

  function showPaywall(featId) {
    console.info('[SUB] showPaywall(%s) — state:', featId, {
      appMode: _state?.appMode, tier: _state?.tier,
      isTrial: _state?.isTrial, isAdmin: _state?.isAdmin,
      premiumAddon: _state?.premiumAddon, locked: _state?.locked
    });
    const feat = FEATURES[featId];
    const tierReq = _requiredTierFor(featId);
    const tinfo = TIERS[tierReq];
    const st = getState();

    let modal = document.getElementById('sub-paywall');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sub-paywall';
      modal.className = 'sub-paywall-overlay';
      modal.addEventListener('click', e => { if (e.target === modal) _closePaywall(); });
      document.body.appendChild(modal);
    }
    modal.dataset.featId = featId;

    const canContinueTrial = st.isTrial && st.daysLeft > 0;

    modal.innerHTML = `
      <div class="sub-paywall-card">
        <div class="sub-paywall-close" onclick="SUB._closePaywall()">×</div>
        <div class="sub-paywall-ic" style="background:${tinfo?.color||'var(--a)'}22;border-color:${tinfo?.color||'var(--a)'}">
          <span>🔒</span>
        </div>
        <div class="sub-paywall-tier" style="color:${tinfo?.color||'var(--a)'}">${tinfo?.label||tierReq}</div>
        <h2 class="sub-paywall-title">${feat?.label || featId}</h2>
        <p class="sub-paywall-desc">${feat?.desc || 'Cette fonctionnalité nécessite un abonnement supérieur.'}</p>
        <div class="sub-paywall-price">${tinfo?.price||''}</div>
        <div class="sub-paywall-actions">
          <button class="sub-paywall-btn sub-paywall-btn-primary" onclick="SUB._closePaywall(); navTo('mon-abo')">Voir les abonnements</button>
          ${canContinueTrial ? `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">Continuer l'essai (${st.daysLeft}j restant${st.daysLeft>1?'s':''})</button>
          ` : `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">Fermer</button>
          `}
        </div>
      </div>`;
    modal.classList.add('open');
    setTimeout(()=>modal.classList.add('visible'), 10);
  }

  function _closePaywall() {
    const modal = document.getElementById('sub-paywall');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(()=> modal.classList.remove('open'), 200);
  }

  /* ───── 13. PAGE ABONNEMENT — NOUVELLE UI v3.0 ───────────────────── */

  function renderAbonnementPage() {
    const root = document.getElementById('view-mon-abo');
    if (!root) {
      console.warn('[SUB] view-mon-abo introuvable — ajouter <section id="view-mon-abo" class="view"></section> dans index.html');
      return;
    }
    const st = getState();
    const premiumOn = !!st.premiumActive || (st.tier === 'PREMIUM');

    // ─── Bandeaux d'état ───
    let modeBanner = '';
    if (st.appMode === 'TEST' && !st.isAdminSim && !st.isPreview) {
      modeBanner = `
        <div class="sub-mode-banner test">
          <span style="font-size:22px">🧪</span>
          <div>
            <div style="font-weight:700;color:var(--a);margin-bottom:2px">Mode test actif</div>
            <div style="font-size:13px;color:var(--m)">L'application est en mode démonstration. Toutes les fonctionnalités sont accessibles sans limite pour tous les utilisateurs.</div>
          </div>
        </div>`;
    }

    let cabinetBanner = '';
    if (st.cabinetMember && !st.isAdmin) {
      cabinetBanner = `
        <div class="sub-mode-banner cabinet">
          <span style="font-size:22px">🏥</span>
          <div>
            <div style="font-weight:700;color:var(--w);margin-bottom:2px">Bonus cabinet actif (${st.cabinetSize} IDE)</div>
            <div style="font-size:13px;color:var(--m)">Vous êtes membre d'un cabinet multi-IDE. Les fonctionnalités cabinet sont débloquées automatiquement.</div>
          </div>
        </div>`;
    }

    // ─── Carte "Statut actuel" ───
    let header = _renderCurrentStatusCard(st);

    // ─── Toggle Premium (style landing) ───
    const premiumToggle = `
      <label class="sub-premium-toggle-wrap">
        <span class="sub-premium-toggle-label">
          Activer l'option <strong style="color:#fbbf24">💎 Premium</strong> · +29 €/mois
        </span>
        <span class="sub-premium-toggle">
          <input type="checkbox" id="sub-premium-toggle-input" ${premiumOn?'checked':''} onchange="SUB._togglePremiumPreview(this.checked)">
          <span class="sub-premium-toggle-slider"></span>
        </span>
      </label>`;

    // ─── 4 cartes principales (Essentiel / Pro / Cabinet / Premium) ───
    const idelCards = ['ESSENTIEL','PRO','CABINET','PREMIUM']
      .map(k => _renderPlanCardV3(k, st))
      .join('');

    // ─── Carte Comptable (séparée, grand format) ───
    const comptableCard = _renderPlanCardV3('COMPTABLE', st);

    // ─── Panel admin (simulation) ───
    let adminPanel = '';
    if (st.isAdmin) {
      const currentSim = st.simTier;
      adminPanel = `
        <div class="sub-admin-panel">
          <h3>🛡️ Simulation tier (admin uniquement)</h3>
          <p>Visualisez l'application comme la verrait une IDEL au tier de votre choix.</p>
          <div class="sub-admin-buttons">
            <button class="sub-admin-btn ${!currentSim?'active':''}" onclick="SUB.clearAdminSim()">Bypass (accès total)</button>
            ${['TRIAL','ESSENTIEL','PRO','CABINET','PREMIUM','COMPTABLE','LOCKED'].map(t => `
              <button class="sub-admin-btn ${currentSim===t?'active':''}" onclick="SUB.setAdminSim('${t}')"
                      style="${currentSim===t?`background:${TIERS[t]?.color||'var(--a)'};color:#000;border-color:${TIERS[t]?.color||'var(--a)'}`:''}">
                ${TIERS[t]?.label || t}
              </button>
            `).join('')}
          </div>
        </div>`;
    }

    // ─── Matrice comparative (toggle) ───
    const comparator = _renderFeatureComparator(st);

    root.innerHTML = `
      <div class="sub-abo-page">
        <div class="sub-abo-hero">
          <h1 class="sub-abo-h1">💎 Mon abonnement</h1>
          <p class="sub-abo-h2">Choisis ton niveau d'<em>optimisation</em></p>
        </div>
        ${modeBanner}
        ${cabinetBanner}
        ${header}
        ${adminPanel}

        <div class="sub-pricing">
          ${premiumToggle}
          <div class="sub-price-grid">${idelCards}</div>
        </div>

        <div class="sub-plans-group-header compta">
          <div class="sub-plans-group-title">
            <span style="font-size:22px">🧑‍💼</span>
            <span>Pour les experts-comptables santé</span>
          </div>
          <div class="sub-plans-group-sub">Plan multi-cabinets pour les experts-comptables qui gèrent plusieurs IDEL clientes.</div>
        </div>
        <div class="sub-price-grid compta">${comptableCard}</div>

        ${comparator}

        <div class="sub-abo-footer">
          <div class="sub-abo-footer-line">
            <span style="color:var(--ok)">✓ Sans engagement</span> · 
            <span>Annulation en 1 clic</span> · 
            <span>Données 100 % récupérables</span>
          </div>
          <div class="sub-abo-footer-line" style="color:var(--a);font-size:12px">
            Tarif préférentiel garanti à vie pour les 100 premières inscrites
          </div>
        </div>
      </div>`;
  }

  function _renderCurrentStatusCard(st) {
    if (st.isAdmin) {
      return `
        <div class="sub-current-card sub-card-admin">
          <div class="sub-current-label">Mode admin</div>
          <div class="sub-current-tier">🛡️ Accès illimité (bypass)</div>
          <div class="sub-current-sub">${st.appMode === 'TEST' ? 'App en mode test' : 'App en mode payant'} · Utilisez la simulation ci-dessous pour tester un tier.</div>
        </div>`;
    }
    if (st.appMode === 'TEST' && !st.isPreview) {
      return `
        <div class="sub-current-card">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier" style="color:var(--a)">✓ Accès complet</div>
          <div class="sub-current-sub">L'application fonctionne en mode test. Vous avez accès à toutes les fonctionnalités.</div>
        </div>`;
    }
    if (st.isTrial) {
      const urgency = st.daysLeft <= 7 ? 'urgent' : '';
      const pct = Math.max(0, Math.min(100, (st.daysLeft/TRIAL_DAYS)*100));
      return `
        <div class="sub-current-card ${urgency}">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier">✨ Essai gratuit</div>
          <div class="sub-current-sub">${st.daysLeft} jour${st.daysLeft>1?'s':''} restant${st.daysLeft>1?'s':''} · Accès total à toutes les fonctionnalités</div>
          <div class="sub-current-progress"><div class="sub-current-progress-bar" style="width:${pct}%"></div></div>
        </div>`;
    }
    if (st.locked) {
      return `
        <div class="sub-current-card locked">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier">🔒 Aucun abonnement actif</div>
          <div class="sub-current-sub">Votre essai gratuit est terminé. Choisissez un plan ci-dessous.</div>
        </div>`;
    }
    const t = TIERS[st.tier];
    let renewLine = '';
    if (st.paidUntil) {
      const dt = new Date(st.paidUntil);
      const days = Math.ceil((dt.getTime() - Date.now()) / (1000*60*60*24));
      renewLine = ` · Renouvellement le ${dt.toLocaleDateString('fr-FR')} (${days}j)`;
    }
    return `
      <div class="sub-current-card active">
        <div class="sub-current-label">Statut actuel</div>
        <div class="sub-current-tier" style="color:${t?.color||'var(--a)'}">✓ ${t?.label||st.tier}</div>
        <div class="sub-current-sub">${t?.price||''} · Abonnement actif${renewLine}</div>
      </div>`;
  }

  /** Carte plan v3 — design landing avec toggle Premium, hover, glow, CTA tier-coloré */
  function _renderPlanCardV3(key, st) {
    const detail = PLAN_DETAILS[key];
    const tinfo = TIERS[key];
    if (!detail || !tinfo) return '';

    const isCurrent = !st.isAdmin && st.tier === key;
    const isPreviewing = st.isPreview && st.previewTier === key;
    const popularBadge = detail.popular ? '<div class="sub-plan-popular">⭐ Le plus choisi</div>' : '';
    const currentBadge = isCurrent ? '<div class="sub-plan-current-badge">✓ Plan actuel</div>' : '';
    const tagBadge = `<div class="sub-plan-tag" style="color:${tinfo.color};background:${tinfo.color}1a;border-color:${tinfo.color}33">${detail.tag||tinfo.label}</div>`;

    // Bloc prix
    let priceHTML = '';
    if (key === 'CABINET') {
      priceHTML = `
        <div class="sub-plan-price-degressif">
          <div class="sub-plan-amount-text" style="color:${tinfo.color}">Dégressif</div>
          <div class="sub-plan-price-detail">${detail.priceDetail}</div>
          <div class="sub-plan-price-suffix">${detail.priceSuffix}</div>
        </div>`;
    } else if (key === 'PREMIUM') {
      priceHTML = `
        <div class="sub-plan-price-block">
          <span class="sub-plan-amount-prefix">+</span>
          <span class="sub-plan-amount" style="color:${tinfo.color}">29</span>
          <span class="sub-plan-period">€ / mois</span>
        </div>
        <div class="sub-plan-subprice">${detail.addonNote || ''}</div>`;
    } else if (key === 'COMPTABLE') {
      priceHTML = `
        <div class="sub-plan-price-block">
          <span class="sub-plan-amount" style="color:${tinfo.color}">99</span>
          <span class="sub-plan-period">€ HT / mois</span>
        </div>
        <div class="sub-plan-subprice">${tinfo.pricingDetail || ''}</div>`;
    } else {
      // ESSENTIEL, PRO
      const amount = key === 'ESSENTIEL' ? '29' : '49';
      priceHTML = `
        <div class="sub-plan-price-block">
          <span class="sub-plan-amount" style="color:${tinfo.color}">${amount}</span>
          <span class="sub-plan-period">€ / mois</span>
        </div>
        <div class="sub-plan-subprice">${key==='PRO'?'Sans engagement · ROI dès le 1ᵉʳ mois':'Sans engagement'}</div>`;
    }

    const featuresList = detail.features.map(f =>
      `<li class="sub-plan-feat ${f.bold?'bold':''}"><span class="sub-plan-check" style="color:${tinfo.color}">${f.icon||'✓'}</span> ${f.txt}</li>`
    ).join('');

    const callout = detail.callout
      ? `<div class="sub-plan-callout" style="background:${detail.callout.color}1a;border-color:${detail.callout.color}55;color:${detail.callout.color}">
           <span>${detail.callout.icon}</span> ${detail.callout.txt}
         </div>` : '';

    // CTA
    let btnLabel, btnAction;
    if (st.isAdmin) {
      btnLabel = (st.simTier === key) ? '✓ Simulé' : 'Simuler ce tier';
      btnAction = `SUB.setAdminSim('${key}')`;
    } else if (isCurrent) {
      btnLabel = '✓ Plan actuel';
      btnAction = '';
    } else {
      btnLabel = detail.cta || 'Choisir ce plan';
      btnAction = `SUB._confirmUpgrade('${key}')`;
    }

    // Bouton "Aperçu" (non-admin uniquement, pas le tier courant)
    const previewBtn = (!st.isAdmin && !isCurrent) ? `
      <button class="sub-plan-preview-btn ${isPreviewing?'active':''}"
              onclick="SUB.previewTier('${isPreviewing?'':key}')"
              title="${isPreviewing?'Quitter l’aperçu':'Visualiser ce plan dans l’app'}">
        ${isPreviewing ? '✓ En aperçu — cliquer pour quitter' : '👁️ Aperçu de ce plan'}
      </button>` : '';

    return `
      <div class="sub-plan-card sub-plan-${key.toLowerCase()} ${detail.popular?'popular':''} ${isCurrent?'current':''} ${isPreviewing?'previewing':''}"
           data-tier="${key}" style="--tier-color:${tinfo.color}">
        ${popularBadge}
        ${currentBadge}
        <div class="sub-plan-header">
          ${tagBadge}
          <div class="sub-plan-name">${tinfo.label}</div>
          <div class="sub-plan-tagline">${detail.subtitle}</div>
          ${priceHTML}
        </div>
        <ul class="sub-plan-feats">${featuresList}</ul>
        ${callout}
        <button class="sub-plan-cta ${isCurrent?'current':''}" ${isCurrent?'disabled':''}
                style="background:${isCurrent?'transparent':tinfo.color};color:${isCurrent?tinfo.color:'#000'};border-color:${tinfo.color}"
                onclick="${btnAction}">
          ${btnLabel}
        </button>
        ${previewBtn}
      </div>`;
  }

  /** Toggle Premium sur la page abonnement → équivaut à un aperçu / activation */
  function _togglePremiumPreview(checked) {
    const st = getState();
    if (st.isAdmin) {
      setAdminSim(checked ? 'PREMIUM' : null);
      return;
    }
    if (checked) {
      previewTier('PREMIUM');
    } else {
      clearPreview();
    }
  }

  /** Comparateur déroulant : matrice features × tiers */
  function _renderFeatureComparator(st) {
    const TIERS_TO_SHOW = ['ESSENTIEL','PRO','CABINET','PREMIUM'];
    const FEATURE_GROUPS = [
      { label:'Essentiels', tiers:['ESSENTIEL'], features:[
        'cotation_ngap','patient_book','tournee_basic','tresor_base','rapport_mensuel',
        'signature','historique','ngap_ref','km_journal'
      ]},
      { label:'Pro — Optimisation revenus', tiers:['PRO'], features:[
        'tournee_ia_vrptw','dashboard_stats','audit_cpam','copilote_ia','alertes_med',
        'compte_rendu','bsi','consentements','transmissions','charges_calc'
      ]},
      { label:'Cabinet — Multi-IDE', tiers:['CABINET'], features:[
        'cabinet_multi_ide','planning_shared','transmissions_shared',
        'cabinet_manage_members','cabinet_consolidated_stats','compliance_engine'
      ]},
      { label:'Premium — Protection avancée', tiers:['PREMIUM'], features:[
        'optimisation_ca_plus','ca_sous_declare','protection_legale_plus',
        'forensic_certificates','sla_support','rapport_juridique_mensuel'
      ]}
    ];

    const headers = TIERS_TO_SHOW.map(t => {
      const tinfo = TIERS[t];
      return `<th style="color:${tinfo.color}">${tinfo.label}<br><span class="sub-comp-th-price">${tinfo.price}</span></th>`;
    }).join('');

    const rows = FEATURE_GROUPS.map(grp => {
      const grpRow = `<tr class="sub-comp-grp"><td colspan="${TIERS_TO_SHOW.length+1}">${grp.label}</td></tr>`;
      const featRows = grp.features.map(fId => {
        const fInfo = FEATURES[fId];
        if (!fInfo) return '';
        const cells = TIERS_TO_SHOW.map(t => {
          const inc = ACCESS_MATRIX[t] ? ACCESS_MATRIX[t](fId) : false;
          return inc ? `<td class="sub-comp-yes">✓</td>` : `<td class="sub-comp-no">—</td>`;
        }).join('');
        return `<tr><td class="sub-comp-feat">${fInfo.label}</td>${cells}</tr>`;
      }).join('');
      return grpRow + featRows;
    }).join('');

    return `
      <details class="sub-comparator">
        <summary>📊 Comparer toutes les fonctionnalités (matrice détaillée)</summary>
        <div class="sub-comparator-wrap">
          <table class="sub-comp-table">
            <thead><tr><th class="sub-comp-feat-h">Fonctionnalité</th>${headers}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>`;
  }

  async function _confirmUpgrade(tier) {
    const t = TIERS[tier];
    if (!t) return;
    if (!confirm(`Passer à ${t.label} (${t.price}) ?\n\n⚠️ Démo : aucun paiement n'est traité pour l'instant.\nL'intégration Stripe sera activée prochainement.`)) return;
    await upgrade(tier);
  }

  /* ───── 14. CARTE ABONNEMENT INTÉGRÉE AU PROFIL (NOUVEAU v3.0) ───── */
  /** Rend une mini-carte abonnement (utilisable dans la modale profil) */
  function renderProfileCard(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const st = getState();

    // Admin → message court
    if (st.isAdmin) {
      c.innerHTML = `
        <div class="sub-pm-card sub-pm-admin">
          <div class="sub-pm-tier">🛡️ Compte administrateur</div>
          <div class="sub-pm-sub">Accès illimité — bypass abonnement</div>
        </div>`;
      return;
    }

    let tierLabel, tierColor, statusLine, progressBar = '', cta = '';

    if (st.appMode === 'TEST') {
      tierLabel = '🧪 Mode test';
      tierColor = '#00d4aa';
      statusLine = 'Application en mode démonstration · accès illimité';
      cta = `<button class="sub-pm-cta" onclick="closePM();navTo('mon-abo')">Voir les plans</button>`;
    } else if (st.isTrial) {
      tierLabel = '✨ Essai gratuit';
      tierColor = st.daysLeft <= 7 ? '#ffb547' : '#00d4aa';
      const dEnd = st.trialEnd ? new Date(st.trialEnd).toLocaleDateString('fr-FR') : '';
      statusLine = `${st.daysLeft} jour${st.daysLeft>1?'s':''} restant${st.daysLeft>1?'s':''}${dEnd?` · expire le ${dEnd}`:''}`;
      const pct = Math.max(0, Math.min(100, (st.daysLeft/TRIAL_DAYS)*100));
      progressBar = `
        <div class="sub-pm-progress"><div class="sub-pm-progress-bar" style="width:${pct}%;background:${tierColor}"></div></div>`;
      cta = `<button class="sub-pm-cta" onclick="closePM();navTo('mon-abo')">Choisir un plan →</button>`;
    } else if (st.locked) {
      tierLabel = '🔒 Aucun abonnement';
      tierColor = '#ff5f6d';
      statusLine = 'Votre essai est terminé · choisissez un plan pour reprendre';
      cta = `<button class="sub-pm-cta sub-pm-cta-warn" onclick="closePM();navTo('mon-abo')">Voir les plans →</button>`;
    } else {
      const t = TIERS[st.tier] || {};
      tierLabel = `✓ ${t.label || st.tier}`;
      tierColor = t.color || '#00d4aa';
      let renewLine = '';
      let pct = 100, daysLeft = null;
      if (st.paidUntil) {
        const dt = new Date(st.paidUntil);
        daysLeft = Math.ceil((dt.getTime() - Date.now()) / (1000*60*60*24));
        renewLine = ` · renouvelle le ${dt.toLocaleDateString('fr-FR')}`;
        pct = Math.max(5, Math.min(100, (daysLeft/31)*100));
      }
      statusLine = `${t.price || ''}${renewLine}`;
      if (daysLeft != null) {
        statusLine += ` (${daysLeft}j restant${daysLeft>1?'s':''})`;
        progressBar = `
          <div class="sub-pm-progress"><div class="sub-pm-progress-bar" style="width:${pct}%;background:${tierColor}"></div></div>`;
      }
      cta = `<button class="sub-pm-cta" onclick="closePM();navTo('mon-abo')">Gérer mon abonnement</button>`;
    }

    c.innerHTML = `
      <div class="sub-pm-card" style="border-color:${tierColor}55">
        <div class="sub-pm-row">
          <div class="sub-pm-tier" style="color:${tierColor}">${tierLabel}</div>
          ${st.premiumActive ? '<span class="sub-pm-premium-badge">💎 Premium</span>' : ''}
        </div>
        <div class="sub-pm-sub">${statusLine}</div>
        ${progressBar}
        ${cta}
      </div>`;
  }

  /* ───── 15. HOOK NAVIGATION ──────────────────────────────────────── */

  function _installNavGate() {
    if (window._subNavGateInstalled) return;
    if (typeof window.navTo !== 'function') { setTimeout(_installNavGate, 100); return; }
    const _orig = window.navTo;
    window.navTo = function(v, triggerEl) {
      const feat = _featureForView(v);
      if (feat && !hasAccess(feat)) { showPaywall(feat); return; }
      return _orig.call(this, v, triggerEl);
    };
    window._subNavGateInstalled = true;
  }

  document.addEventListener('ui:navigate', e => {
    if (e.detail.view === 'mon-abo') renderAbonnementPage();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _installNavGate);
  } else {
    _installNavGate();
  }

  /* ───── 16. NOTIFICATIONS J-7 (expiration) ───────────────────────── */

  function _checkExpirationNotification() {
    if (!_state) return;
    const st = getState();
    if (st.appMode === 'TEST' || st.isAdmin || st.locked) return;

    let notifType = null, daysRemaining = null, endDate = null;
    if (st.isTrial && st.daysLeft != null && st.daysLeft <= 7 && st.daysLeft > 0) {
      notifType = 'trial'; daysRemaining = st.daysLeft; endDate = st.trialEnd;
    } else if (st.paidUntil && !st.isTrial) {
      const days = Math.ceil((new Date(st.paidUntil).getTime() - Date.now()) / (1000*60*60*24));
      if (days > 0 && days <= 7) {
        notifType = 'paid'; daysRemaining = days; endDate = st.paidUntil;
      }
    }
    if (!notifType) return;

    const dismissKey = `ami_sub_notif_${notifType}_${_userId}`;
    const lastDismissed = localStorage.getItem(dismissKey);
    if (lastDismissed) {
      const ageH = (Date.now() - parseInt(lastDismissed, 10)) / (1000*60*60);
      if (ageH < 24) return;
    }

    const title = notifType === 'trial'
      ? `⏱️ Essai gratuit — ${daysRemaining} jour${daysRemaining>1?'s':''} restant${daysRemaining>1?'s':''}`
      : `💳 Abonnement expire dans ${daysRemaining} jour${daysRemaining>1?'s':''}`;
    const msg = notifType === 'trial'
      ? `Votre essai se termine le ${new Date(endDate).toLocaleDateString('fr-FR')}. Choisissez un plan pour conserver l'accès.`
      : `Votre abonnement expire le ${new Date(endDate).toLocaleDateString('fr-FR')}. Pensez à le renouveler pour éviter l'interruption.`;
    const severity = daysRemaining <= 3 ? 'warning' : 'info';
    _notify(severity, title, msg);
    localStorage.setItem(dismissKey, String(Date.now()));
  }

  function _notify(type, title, msg) {
    if (typeof window.notify === 'function') { window.notify(type, title, msg); return; }
    if (typeof window._addNotifItem === 'function') { window._addNotifItem(type, title, msg); return; }
    console.info(`[SUB notif] ${type.toUpperCase()} — ${title}`, msg);
  }

  function _checkCabinetRoleChange() {
    if (!_state || !_userId) return;
    const currentRole = _state.cabinetRole || null;
    const key = `ami_last_cab_role_${_userId}`;
    const lastKnown = localStorage.getItem(key);
    if (lastKnown === null && currentRole === null) return;
    if (lastKnown === null) { localStorage.setItem(key, currentRole || ''); return; }
    const normalized = currentRole || '';
    if (lastKnown === normalized) return;

    const ROLE_LABELS = { titulaire:'⭐ Titulaire', gestionnaire:'🛠️ Gestionnaire', membre:'👤 Membre' };
    let title = '', msg = '', severity = 'info';
    if (!lastKnown && currentRole) {
      title = `🏥 Vous avez rejoint un cabinet`;
      msg = `Votre rôle : ${ROLE_LABELS[currentRole] || currentRole}.`;
      severity = 'success';
    } else if (lastKnown && !currentRole) {
      title = `🏥 Vous n'êtes plus dans un cabinet`;
      msg = `Votre rôle précédent (${ROLE_LABELS[lastKnown] || lastKnown}) a été révoqué.`;
    } else if (lastKnown === 'membre' && currentRole === 'gestionnaire') {
      title = `🎉 Promotion cabinet`;
      msg = `Vous êtes désormais 🛠️ Gestionnaire du cabinet.`;
      severity = 'success';
    } else if (lastKnown === 'gestionnaire' && currentRole === 'membre') {
      title = `ℹ️ Changement de rôle cabinet`;
      msg = `Vous êtes désormais 👤 Membre standard du cabinet.`;
    } else if (lastKnown === 'membre' && currentRole === 'titulaire') {
      title = `👑 Vous êtes maintenant titulaire`;
      msg = `La propriété du cabinet vous a été transférée.`;
      severity = 'success';
    } else if (lastKnown === 'titulaire' && currentRole !== 'titulaire') {
      title = `ℹ️ Transfert de propriété cabinet`;
      msg = `Vous n'êtes plus titulaire. Rôle actuel : ${ROLE_LABELS[currentRole] || currentRole}.`;
    } else {
      title = `🏥 Rôle cabinet modifié`;
      msg = `${ROLE_LABELS[lastKnown]||lastKnown} → ${ROLE_LABELS[currentRole]||currentRole}`;
    }
    _notify(severity, title, msg);
    localStorage.setItem(key, normalized);
  }

  /* ───── 17. CSS AUTO-INJECTION ──────────────────────────────────── */
  /* Pas besoin de modifier style.css — tout est ici, isolé sous le préfixe `sub-`. */

  function _injectStyles() {
    if (document.getElementById('sub-injected-styles')) return;
    const css = `
/* ════ Bandeau trial / lock / sim ════ */
.sub-trial-banner { display:flex; align-items:center; gap:12px; padding:10px 16px;
  background:linear-gradient(90deg, rgba(0,212,170,.10), rgba(0,212,170,.04));
  border:1px solid rgba(0,212,170,.25); border-radius:10px;
  margin:0 0 14px; font-size:13px; color:var(--t); flex-wrap:wrap;}
.sub-trial-banner .stb-ic { font-size:18px; flex-shrink:0; }
.sub-trial-banner .stb-btn { margin-left:auto; padding:6px 14px; background:var(--s);
  color:var(--t); border:1px solid var(--b); border-radius:8px; font-size:12px;
  cursor:pointer; font-family:var(--ff); font-weight:600; transition:all .15s; }
.sub-trial-banner .stb-btn:hover { border-color:var(--bl); background:var(--c); }
.sub-trial-banner .stb-btn-cta { background:linear-gradient(135deg,var(--a),#00b891);
  color:#000; border-color:transparent; box-shadow:0 4px 18px rgba(0,212,170,.3); }

/* ════ Bandeau aperçu utilisateur ════ */
.sub-preview-banner { display:flex; align-items:center; gap:12px; padding:10px 16px;
  background:linear-gradient(90deg, rgba(167,139,250,.14), rgba(167,139,250,.06));
  border:1px solid rgba(167,139,250,.4); border-radius:10px;
  margin:0 0 14px; font-size:13px; color:var(--t); flex-wrap:wrap; }
.sub-preview-banner .spb-ic { font-size:20px; flex-shrink:0; }
.sub-preview-banner .spb-btn { padding:6px 14px; background:var(--s); color:var(--t);
  border:1px solid var(--b); border-radius:8px; font-size:12px; cursor:pointer;
  font-family:var(--ff); font-weight:600; transition:all .15s; }
.sub-preview-banner .spb-btn:hover { border-color:var(--bl); background:var(--c); }
.sub-preview-banner .spb-btn-cta { background:linear-gradient(135deg,#a78bfa,#8b5cf6);
  color:#fff; border-color:transparent; }
.sub-preview-banner .spb-btn:last-child { margin-left:auto; }
body.sub-in-preview .ni-locked { opacity:1 !important; filter:none !important; }

/* ════ Bandeau de mode (test / cabinet) ════ */
.sub-mode-banner { display:flex; align-items:flex-start; gap:14px; padding:14px 18px;
  background:var(--s); border:1px solid var(--b); border-radius:12px; margin-bottom:16px; }
.sub-mode-banner.test { border-color:rgba(0,212,170,.28); background:linear-gradient(135deg, rgba(0,212,170,.06), var(--s)); }
.sub-mode-banner.cabinet { border-color:rgba(255,181,71,.28); background:linear-gradient(135deg, rgba(255,181,71,.06), var(--s)); }

/* ════ Carte statut actuel ════ */
.sub-current-card { padding:18px 22px; background:var(--c); border:1px solid var(--b);
  border-radius:14px; margin-bottom:20px; }
.sub-current-card.active { border-color:rgba(0,212,170,.3); }
.sub-current-card.locked { border-color:rgba(255,95,109,.4); background:linear-gradient(135deg,rgba(255,95,109,.04),var(--c)); }
.sub-current-card.urgent { border-color:rgba(255,181,71,.5); background:linear-gradient(135deg,rgba(255,181,71,.04),var(--c)); }
.sub-current-card.sub-card-admin { border-color:rgba(255,95,109,.4); background:linear-gradient(135deg,rgba(255,95,109,.04),var(--c)); }
.sub-current-label { font-size:11px; color:var(--m); text-transform:uppercase; letter-spacing:1px; font-family:var(--fm); margin-bottom:6px; }
.sub-current-tier { font-family:var(--fs,serif); font-size:24px; color:var(--t); margin-bottom:4px; }
.sub-current-sub { font-size:13px; color:var(--m); }
.sub-current-progress { margin-top:12px; height:6px; background:rgba(255,255,255,.06); border-radius:3px; overflow:hidden; }
.sub-current-progress-bar { height:100%; background:linear-gradient(90deg,var(--a),#00b891); border-radius:3px; transition:width .3s; }

/* ════ Page abonnement ════ */
.sub-abo-page { max-width:1200px; margin:0 auto; padding:8px 0 60px; }
.sub-abo-hero { text-align:center; margin-bottom:28px; padding:16px 0 8px; }
.sub-abo-h1 { font-family:var(--fs,serif); font-size:34px; color:var(--t); margin:0 0 8px; }
.sub-abo-h2 { font-size:16px; color:var(--m); margin:0; }
.sub-abo-h2 em { color:var(--a); font-style:italic; }

/* ════ Toggle Premium (style landing) ════ */
.sub-pricing { background:radial-gradient(ellipse at top, rgba(0,212,170,.04), transparent 70%);
  padding:24px 12px; border-radius:18px; }
.sub-premium-toggle-wrap { display:flex; align-items:center; justify-content:center; gap:14px;
  padding:14px 22px; background:linear-gradient(90deg, rgba(251,191,36,.08), rgba(0,212,170,.06));
  border:1px solid rgba(251,191,36,.25); border-radius:50px;
  max-width:520px; margin:0 auto 28px; cursor:pointer; transition:all .2s; }
.sub-premium-toggle-wrap:hover { border-color:rgba(251,191,36,.5); transform:translateY(-1px); }
.sub-premium-toggle-label { font-size:14px; color:var(--t); }
.sub-premium-toggle { position:relative; width:48px; height:26px; flex-shrink:0; }
.sub-premium-toggle input { opacity:0; width:0; height:0; position:absolute; }
.sub-premium-toggle-slider { position:absolute; inset:0; background:var(--b); border-radius:26px;
  cursor:pointer; transition:.3s; }
.sub-premium-toggle-slider::before { content:''; position:absolute; height:20px; width:20px; left:3px; bottom:3px;
  background:#fff; border-radius:50%; transition:.3s; }
.sub-premium-toggle input:checked + .sub-premium-toggle-slider { background:linear-gradient(135deg, #fbbf24, #f59e0b); }
.sub-premium-toggle input:checked + .sub-premium-toggle-slider::before { transform:translateX(22px); }

/* ════ Grille 4 cartes ════ */
.sub-price-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
.sub-price-grid.compta { grid-template-columns:1fr; max-width:680px; margin:0 auto; }
@media (max-width:1080px) { .sub-price-grid { grid-template-columns:repeat(2,1fr); } }
@media (max-width:560px)  { .sub-price-grid { grid-template-columns:1fr; } }

/* ════ Carte plan v3 (style landing) ════ */
.sub-plan-card { position:relative; background:var(--c); border:1px solid var(--b);
  border-radius:16px; padding:24px 20px 20px; display:flex; flex-direction:column;
  transition:all .25s; min-height:520px; }
.sub-plan-card:hover { transform:translateY(-3px); border-color:var(--tier-color); box-shadow:0 12px 32px rgba(0,0,0,.3); }
.sub-plan-card.popular { border-color:var(--tier-color); box-shadow:0 0 0 1px var(--tier-color), 0 12px 32px rgba(0,212,170,.15);
  transform:scale(1.02); }
.sub-plan-card.current { border-color:var(--tier-color); background:linear-gradient(180deg, var(--c), rgba(0,212,170,.03)); }
.sub-plan-card.previewing { border-color:#a78bfa; box-shadow:0 0 0 2px rgba(167,139,250,.3); }
.sub-plan-popular { position:absolute; top:-12px; left:50%; transform:translateX(-50%);
  background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#000; padding:5px 16px; border-radius:50px;
  font-size:11px; font-weight:700; font-family:var(--fm); letter-spacing:.5px; white-space:nowrap; }
.sub-plan-current-badge { position:absolute; top:-12px; right:14px; background:var(--ad); color:var(--a);
  border:1px solid var(--ab); padding:4px 12px; border-radius:50px; font-size:10px; font-weight:700; font-family:var(--fm); }
.sub-plan-tag { display:inline-block; padding:4px 10px; border-radius:20px; font-size:10px;
  font-weight:700; letter-spacing:.5px; font-family:var(--fm); border:1px solid; margin-bottom:14px; }
.sub-plan-name { font-family:var(--fs,serif); font-size:26px; color:var(--t); margin:0 0 4px; }
.sub-plan-tagline { font-size:12px; color:var(--m); font-style:italic; margin-bottom:16px; min-height:18px; }
.sub-plan-price-block { display:flex; align-items:baseline; gap:6px; margin-bottom:4px; }
.sub-plan-amount-prefix { font-family:var(--fs,serif); font-size:36px; color:var(--m); }
.sub-plan-amount { font-family:var(--fs,serif); font-size:48px; line-height:1; font-weight:400; }
.sub-plan-period { font-size:13px; color:var(--m); font-family:var(--fm); }
.sub-plan-subprice { font-size:11px; color:var(--m); font-family:var(--fm); margin-bottom:18px; }
.sub-plan-price-degressif { margin-bottom:18px; }
.sub-plan-amount-text { font-family:var(--fs,serif); font-size:34px; line-height:1; margin-bottom:4px; }
.sub-plan-price-detail { font-size:11px; color:var(--m); font-family:var(--fm); margin-bottom:2px; line-height:1.5; }
.sub-plan-price-suffix { font-size:11px; color:var(--m); font-family:var(--fm); }
.sub-plan-feats { list-style:none; padding:0; margin:0 0 14px; flex:1; }
.sub-plan-feat { display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--t);
  padding:5px 0; line-height:1.4; }
.sub-plan-feat.bold { font-weight:600; color:var(--t); padding-top:8px; }
.sub-plan-check { font-weight:700; flex-shrink:0; font-size:14px; }
.sub-plan-callout { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px;
  font-size:12px; border:1px solid; margin-bottom:14px; font-family:var(--fm); font-weight:600; }
.sub-plan-cta { width:100%; padding:14px 20px; border-radius:12px; font-family:var(--ff); font-size:14px;
  font-weight:700; cursor:pointer; border:1px solid; transition:all .2s; }
.sub-plan-cta:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 22px rgba(0,0,0,.3); filter:brightness(1.05); }
.sub-plan-cta.current { cursor:default; }
.sub-plan-preview-btn { width:100%; padding:8px 14px; margin-top:8px; background:transparent;
  color:var(--m); border:1px dashed var(--b); border-radius:10px; font-size:11px; cursor:pointer;
  font-family:var(--ff); transition:all .15s; }
.sub-plan-preview-btn:hover { color:#a78bfa; border-color:rgba(167,139,250,.4); background:rgba(167,139,250,.04); }
.sub-plan-preview-btn.active { color:#a78bfa; border-color:#a78bfa; border-style:solid; background:rgba(167,139,250,.06); }

/* ════ Groupe expert-comptable ════ */
.sub-plans-group-header { margin:48px 0 18px; }
.sub-plans-group-header.compta { border-top:1px dashed var(--b); padding-top:32px; }
.sub-plans-group-title { display:flex; align-items:center; gap:10px; font-family:var(--fs,serif);
  font-size:22px; color:var(--t); margin-bottom:6px; }
.sub-plans-group-sub { font-size:13px; color:var(--m); max-width:680px; }

/* ════ Comparateur (matrice) ════ */
.sub-comparator { margin:32px 0 16px; background:var(--c); border:1px solid var(--b); border-radius:14px;
  padding:0; overflow:hidden; }
.sub-comparator > summary { padding:16px 22px; cursor:pointer; font-weight:600; color:var(--t);
  font-size:14px; list-style:none; display:flex; justify-content:space-between; align-items:center; }
.sub-comparator > summary::-webkit-details-marker { display:none; }
.sub-comparator > summary::after { content:'▾'; color:var(--m); font-size:14px; transition:.2s; }
.sub-comparator[open] > summary::after { transform:rotate(180deg); }
.sub-comparator > summary:hover { background:var(--s); }
.sub-comparator-wrap { padding:0 16px 20px; overflow-x:auto; }
.sub-comp-table { width:100%; border-collapse:collapse; font-size:12px; }
.sub-comp-table th, .sub-comp-table td { padding:10px 14px; text-align:center; border-bottom:1px solid var(--b); }
.sub-comp-feat-h, .sub-comp-feat { text-align:left !important; color:var(--t); font-weight:500; }
.sub-comp-feat { font-size:12.5px; }
.sub-comp-table thead th { background:var(--s); font-family:var(--fm); font-weight:700;
  position:sticky; top:0; z-index:1; }
.sub-comp-th-price { font-size:10px; color:var(--m); font-family:var(--fm); font-weight:400; }
.sub-comp-grp td { background:linear-gradient(90deg, rgba(0,212,170,.08), transparent);
  font-weight:600; color:var(--t); padding:10px 14px; font-size:12px; text-transform:uppercase;
  letter-spacing:.5px; font-family:var(--fm); border-top:1px solid var(--b); }
.sub-comp-yes { color:var(--ok); font-weight:700; font-size:16px; }
.sub-comp-no { color:var(--m); opacity:.5; }

/* ════ Footer abonnement ════ */
.sub-abo-footer { margin-top:32px; padding:20px 0; text-align:center; border-top:1px dashed var(--b); }
.sub-abo-footer-line { font-size:12px; color:var(--m); margin-bottom:6px; }

/* ════ Panel admin ════ */
.sub-admin-panel { padding:18px; background:linear-gradient(135deg, rgba(255,95,109,.05), var(--s));
  border:1px solid rgba(255,95,109,.3); border-radius:12px; margin-bottom:20px; }
.sub-admin-panel h3 { margin:0 0 6px; font-size:15px; color:var(--d); font-family:var(--fs,serif); }
.sub-admin-panel p { margin:0 0 12px; font-size:12px; color:var(--m); }
.sub-admin-buttons { display:flex; flex-wrap:wrap; gap:8px; }
.sub-admin-btn { padding:6px 14px; background:var(--c); color:var(--t); border:1px solid var(--b);
  border-radius:8px; font-size:12px; cursor:pointer; font-family:var(--ff); font-weight:600; transition:all .15s; }
.sub-admin-btn:hover { border-color:var(--bl); background:var(--s); }
.sub-admin-btn.active { background:var(--a); color:#000; border-color:var(--a); }

/* ════ Paywall ════ */
.sub-paywall-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9999;
  display:none; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(6px);
  opacity:0; transition:opacity .2s; }
.sub-paywall-overlay.open { display:flex; }
.sub-paywall-overlay.visible { opacity:1; }
.sub-paywall-card { position:relative; max-width:440px; width:100%; background:var(--c);
  border:1px solid var(--b); border-radius:16px; padding:32px 28px 22px; text-align:center; }
.sub-paywall-close { position:absolute; top:14px; right:18px; width:30px; height:30px; border-radius:50%;
  background:var(--s); border:1px solid var(--b); display:grid; place-items:center; cursor:pointer;
  color:var(--m); font-size:18px; transition:all .15s; }
.sub-paywall-close:hover { color:var(--t); border-color:var(--bl); }
.sub-paywall-ic { width:64px; height:64px; border-radius:50%; border:2px solid; display:grid;
  place-items:center; margin:0 auto 14px; font-size:30px; }
.sub-paywall-tier { font-size:11px; font-family:var(--fm); text-transform:uppercase; letter-spacing:1px;
  font-weight:700; margin-bottom:6px; }
.sub-paywall-title { font-family:var(--fs,serif); font-size:24px; margin:4px 0 10px; color:var(--t); }
.sub-paywall-desc { font-size:13px; color:var(--m); margin-bottom:14px; line-height:1.5; }
.sub-paywall-price { font-family:var(--fs,serif); font-size:20px; color:var(--a); margin-bottom:18px; }
.sub-paywall-actions { display:flex; flex-direction:column; gap:8px; }
.sub-paywall-btn { padding:12px 20px; border-radius:10px; font-family:var(--ff); font-size:13px;
  font-weight:600; cursor:pointer; border:1px solid; transition:all .15s; }
.sub-paywall-btn-primary { background:linear-gradient(135deg,var(--a),#00b891); color:#000; border-color:transparent;
  box-shadow:0 4px 18px rgba(0,212,170,.3); }
.sub-paywall-btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 26px rgba(0,212,170,.4); }
.sub-paywall-btn-ghost { background:transparent; color:var(--m); border-color:var(--b); }
.sub-paywall-btn-ghost:hover { color:var(--t); border-color:var(--bl); }

/* ════ Cadenas nav ════ */
.ni-locked { opacity:.55; position:relative; }
.ni-locked .ni-lock-badge { display:inline-flex; align-items:center; gap:3px; margin-left:auto;
  font-size:10px; font-family:var(--fm); padding:1px 6px; border-radius:6px; background:rgba(0,0,0,.3); }
.ni-lock-tier { font-weight:700; }

/* ════ Mini-carte abonnement (modale profil) ════ */
.sub-pm-card { padding:14px 16px; background:var(--s); border:1px solid var(--b);
  border-radius:12px; margin:12px 0; }
.sub-pm-row { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.sub-pm-tier { font-family:var(--fs,serif); font-size:18px; }
.sub-pm-sub { font-size:12px; color:var(--m); margin-top:4px; line-height:1.5; }
.sub-pm-progress { margin-top:10px; height:5px; background:rgba(255,255,255,.06); border-radius:3px; overflow:hidden; }
.sub-pm-progress-bar { height:100%; border-radius:3px; transition:width .3s; }
.sub-pm-cta { margin-top:12px; padding:8px 16px; background:var(--c); color:var(--t);
  border:1px solid var(--b); border-radius:8px; font-size:12px; cursor:pointer; font-family:var(--ff);
  font-weight:600; transition:all .15s; width:100%; }
.sub-pm-cta:hover { border-color:var(--a); color:var(--a); }
.sub-pm-cta-warn { background:linear-gradient(135deg, rgba(255,95,109,.15), var(--c));
  border-color:rgba(255,95,109,.4); color:var(--d); }
.sub-pm-cta-warn:hover { border-color:var(--d); }
.sub-pm-premium-badge { font-size:10px; padding:3px 8px; border-radius:50px; background:rgba(251,191,36,.15);
  color:#fbbf24; border:1px solid rgba(251,191,36,.4); font-family:var(--fm); font-weight:700; }
.sub-pm-admin .sub-pm-tier { color:var(--d); }

/* ════ Sidebar / nav item "Mon abonnement" mise en avant ════ */
.ni[data-v="mon-abo"] { position:relative; }
.ni[data-v="mon-abo"] .ni-trial-badge { position:absolute; right:8px; top:50%; transform:translateY(-50%);
  font-size:10px; padding:2px 8px; border-radius:50px; background:var(--ad); color:var(--a);
  border:1px solid var(--ab); font-family:var(--fm); font-weight:700; }
`;
    const style = document.createElement('style');
    style.id = 'sub-injected-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ───── 18. EXPORT ──────────────────────────────────────────────── */

  return {
    getState, currentTier, hasAccess, requireAccess,
    isCabinetManager, cabinetRole,
    entitlements, premiumStatus,
    bootstrap, refresh, upgrade,
    setAdminSim, clearAdminSim,
    previewTier, clearPreview,                          // ← NOUVEAU v3.0
    showPaywall, applyUILocks, renderAbonnementPage,
    renderProfileCard,                                  // ← NOUVEAU v3.0
    _closePaywall, _confirmUpgrade, _togglePremiumPreview,
    TIERS, FEATURES, PLAN_DETAILS, NAV_FEATURE_MAP,
    _debug: () => ({ state:_state, userId:_userId, role:_role })
  };
})();

window.hasAccess = (f) => SUB.hasAccess(f);
window.requireAccess = (f, opts) => SUB.requireAccess(f, opts);
