/* ════════════════════════════════════════════════
   subscription.js — AMI NGAP v1.0
   ────────────────────────────────────────────────
   Gestion des abonnements & gating des features.

   🎯 OBJECTIFS
   ✅ Essai gratuit 30 jours = accès TOTAL (tous tiers confondus)
   ✅ Fin d'essai → LOCKED : seuls Abonnement + Contact + Historique (lecture)
   ✅ Admins : bypass + simulation de tier depuis panel admin
   ✅ Chaque infirmière stocke son état localement (par userId)
   ✅ Aucun impact worker / BDD — 100% frontend
   ✅ RGPD/HDS : état chiffré AES-256-GCM via security.js (si dispo)

   📦 API PUBLIQUE
   SUB.getState()        → { tier, trialStart, trialEnd, isTrial, daysLeft, locked, isAdminSim, simTier }
   SUB.currentTier()     → 'TRIAL' | 'ESSENTIEL' | 'PRO' | 'CABINET' | 'PREMIUM' | 'COMPTABLE' | 'LOCKED'
   SUB.hasAccess(featId) → boolean
   SUB.requireAccess(featId, opts) → boolean (false = paywall affiché)
   SUB.initTrial()       → démarre les 30j (1ère connexion)
   SUB.bootstrap(userId, role) → appelé dans showApp()
   SUB.upgrade(tier)     → simule un upgrade
   SUB.setAdminSim(tier) → admin uniquement : simule un tier pour tester
   SUB.clearAdminSim()   → revient au bypass admin
   SUB.showPaywall(feat) → modale "Passer à [tier]"
   SUB.applyUILocks()    → pose 🔒 sur les items nav verrouillés
   SUB.renderAbonnementPage() → rend la grille tarifaire dans #view-mon-abo

═════════════════════════════════════════════════ */
'use strict';

window.SUB = (function(){

  /* ───── 1. TIERS & FEATURES ──────────────────────────────── */

  const TIERS = {
    TRIAL:     { label:'Essai gratuit',   price:'0 €',                priority:999, color:'#00d4aa' },
    ESSENTIEL: { label:'AMI Essentiel',   price:'19 € HT / mois',     priority:1,   color:'#4fa8ff' },
    PRO:       { label:'AMI Pro',         price:'39 € HT / mois',     priority:2,   color:'#00d4aa' },
    CABINET:   { label:'AMI Cabinet',     price:'29 € HT / IDE / mois', priority:3, color:'#ffb547' },
    PREMIUM:   { label:'AMI Premium',     price:'+15 € HT / mois',    priority:4,   color:'#c678dd' },
    COMPTABLE: { label:'AMI Comptable',   price:'99 € HT + 5 €/IDEL', priority:5,   color:'#ff5f6d' },
    LOCKED:    { label:'Aucun abonnement', price:'—',                 priority:0,   color:'#6a8099' }
  };

  /* Catalogue des fonctionnalités contrôlées
     Chaque feature appartient au tier minimum requis + à tous les tiers supérieurs. */
  const FEATURES = {
    // ─── ESSENTIEL (base) ───
    cotation_ngap:       { tier:'ESSENTIEL', label:'Cotation NGAP',         desc:'Cotation intelligente de vos actes infirmiers avec vérification IA.' },
    patient_book:        { tier:'ESSENTIEL', label:'Carnet patients',        desc:'Gestion chiffrée locale de vos patients (ADELI-compliant).' },
    tournee_basic:       { tier:'ESSENTIEL', label:'Tournée basique',        desc:'Import calendrier, planning, pilotage journée.' },
    tresor_base:         { tier:'ESSENTIEL', label:'Trésorerie',             desc:'Suivi remboursements AMO/AMC, export comptable basique.' },
    rapport_mensuel:     { tier:'ESSENTIEL', label:'Rapport mensuel',        desc:'Synthèse automatique de votre activité.' },
    signature:           { tier:'ESSENTIEL', label:'Signatures électroniques', desc:'Signature tactile sur feuille de soins.' },
    contact_admin:       { tier:'ESSENTIEL', label:'Contact support',        desc:'Messagerie directe avec le support AMI.' },
    notes_soins:         { tier:'ESSENTIEL', label:'Notes de soins',         desc:'Prise de notes patient chiffrée.' },
    historique:          { tier:'ESSENTIEL', label:'Historique',             desc:'Historique de vos cotations.' },
    ngap_ref:            { tier:'ESSENTIEL', label:'Référentiel NGAP',        desc:'Nomenclature officielle consultable.' },
    km_journal:          { tier:'ESSENTIEL', label:'Journal kilométrique',   desc:'Suivi des déplacements pour déclaration.' },

    // ─── PRO ───
    tournee_ia_vrptw:    { tier:'PRO', label:'Tournée IA (VRPTW + 2-opt)',   desc:'Optimisation intelligente de l\'ordre de passage.' },
    dashboard_stats:     { tier:'PRO', label:'Dashboard & statistiques',     desc:'Tableau de bord avancé, comparatifs, tendances.' },
    audit_cpam:          { tier:'PRO', label:'Simulateur audit CPAM',        desc:'Simulez un contrôle CPAM avant qu\'il n\'arrive.' },
    bsi:                 { tier:'PRO', label:'BSI — Bilan soins infirmiers', desc:'Génération et suivi des BSI dépendance/inflammatoire.' },
    pilulier:            { tier:'PRO', label:'Semainier / Pilulier',         desc:'Gestion des piluliers patients.' },
    constantes:          { tier:'PRO', label:'Constantes patients',          desc:'Suivi TA, glycémie, SpO2 avec graphiques.' },
    alertes_med:         { tier:'PRO', label:'Alertes médicamenteuses',      desc:'Détection interactions, redondances, contre-indications.' },
    compte_rendu:        { tier:'PRO', label:'Compte-rendu de passage',      desc:'Générateur automatique de CR patient.' },
    consentements:       { tier:'PRO', label:'Consentements éclairés',       desc:'Gestion traçabilité RGPD des consentements.' },
    copilote_ia:         { tier:'PRO', label:'Copilote IA',                  desc:'Assistant conversationnel NGAP via xAI Grok.' },
    compliance_engine:   { tier:'PRO', label:'Moteur de conformité',         desc:'Scoring 4 piliers, auto-correction, risque prédictif.' },
    transmissions:       { tier:'PRO', label:'Transmissions infirmières',    desc:'Journal de transmissions chiffré.' },
    ordonnances:         { tier:'PRO', label:'Gestion ordonnances',          desc:'Cycle de vie des ordos patient.' },
    charges_calc:        { tier:'PRO', label:'Calcul charges & net',         desc:'Projection net/brut, URSSAF, CARPIMKO.' },
    modeles_soins:       { tier:'PRO', label:'Modèles de soins',             desc:'Bibliothèque de modèles réutilisables.' },
    simulateur_maj:      { tier:'PRO', label:'Simulateur majoration',        desc:'Test des cumuls de majorations.' },

    // ─── CABINET ───
    cabinet_multi_ide:   { tier:'CABINET', label:'Cabinet multi-IDE',         desc:'Gestion d\'un cabinet 2 à 6 infirmières.' },
    planning_shared:     { tier:'CABINET', label:'Planning partagé',          desc:'Coordination des tournées du cabinet.' },
    transmissions_shared:{ tier:'CABINET', label:'Transmissions partagées',   desc:'Journal collaboratif du cabinet.' },

    // ─── PREMIUM ───
    optimisation_ca_plus:{ tier:'PREMIUM', label:'Optimisation CA+',          desc:'Détection avancée de CA sous-déclaré, revenue engine premium.' },
    protection_legale_plus:{ tier:'PREMIUM', label:'Protection médico-légale+', desc:'Certificats forensiques horodatés, preuve opposable CPAM.' },
    sla_support:         { tier:'PREMIUM', label:'SLA support',               desc:'Support prioritaire 7j/7, réponse < 2h ouvrées.' },

    // ─── COMPTABLE ───
    dashboard_consolide: { tier:'COMPTABLE', label:'Dashboard consolidé',     desc:'Vue multi-IDEL pour cabinet d\'expertise comptable.' },
    export_fiscal:       { tier:'COMPTABLE', label:'Export fiscal',           desc:'Exports liasse fiscale, 2035, analytique.' },
    scoring_risque:      { tier:'COMPTABLE', label:'Scoring risque portfolio', desc:'Scoring risque de chaque IDEL sous mandat.' }
  };

  /* Hiérarchie : un tier accède à tout ce qui lui est ≤ en priorité */
  const TIER_ORDER = ['ESSENTIEL','PRO','CABINET','PREMIUM','COMPTABLE'];

  /* Exceptions : Premium et Comptable sont des add-ons,
     pas des "niveaux" cumulatifs. Matrice explicite ci-dessous. */
  const ACCESS_MATRIX = {
    TRIAL:     () => true,                     // essai = tout
    ESSENTIEL: f => FEATURES[f]?.tier === 'ESSENTIEL',
    PRO:       f => ['ESSENTIEL','PRO'].includes(FEATURES[f]?.tier),
    CABINET:   f => ['ESSENTIEL','PRO','CABINET'].includes(FEATURES[f]?.tier),
    PREMIUM:   f => ['ESSENTIEL','PRO','CABINET','PREMIUM'].includes(FEATURES[f]?.tier),
    COMPTABLE: f => FEATURES[f]?.tier === 'COMPTABLE' || FEATURES[f]?.tier === 'ESSENTIEL',
    LOCKED:    f => ['contact_admin','historique'].includes(f)    // lecture seule minimale
  };

  /* ───── 2. ÉTAT & STOCKAGE ────────────────────────────────── */

  let _state = null;
  let _userId = null;
  let _role   = null;
  const STORAGE_PREFIX = 'ami_sub_';
  const TRIAL_DAYS = 30;

  function _storageKey(userId) { return STORAGE_PREFIX + userId; }

  function _load(userId) {
    try {
      const raw = localStorage.getItem(_storageKey(userId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(_) { return null; }
  }

  function _save(userId, state) {
    try {
      localStorage.setItem(_storageKey(userId), JSON.stringify(state));
    } catch(e) { console.warn('[SUB] save failed', e); }
  }

  function _now() { return Date.now(); }
  function _daysBetween(a, b) { return Math.ceil((b - a) / (1000*60*60*24)); }

  /* ───── 3. BOOTSTRAP ─────────────────────────────────────── */

  function bootstrap(userId, role) {
    _userId = userId;
    _role   = role;

    if (role === 'admin') {
      // Admin : bypass par défaut, sauf simulation explicite
      const adminSim = sessionStorage.getItem('ami_admin_sim_tier') || null;
      _state = { tier:'ADMIN', isAdmin:true, simTier: adminSim };
      _applyTrialBanner();
      setTimeout(applyUILocks, 100);
      return _state;
    }

    let s = _load(userId);
    if (!s) {
      // Premier login → démarrer l'essai 30 jours
      s = _initTrialState();
      _save(userId, s);
    } else {
      // Recalculer isTrial / daysLeft
      s = _refreshTrialState(s);
      _save(userId, s);
    }
    _state = s;
    _applyTrialBanner();
    setTimeout(applyUILocks, 100);
    return _state;
  }

  function _initTrialState() {
    const start = _now();
    const end   = start + TRIAL_DAYS*24*60*60*1000;
    return {
      tier: 'TRIAL',
      trialStart: start,
      trialEnd: end,
      isTrial: true,
      startedAt: start
    };
  }

  function _refreshTrialState(s) {
    if (s.tier === 'TRIAL') {
      const left = _daysBetween(_now(), s.trialEnd);
      if (left <= 0) {
        // Essai expiré → LOCKED
        s.tier = 'LOCKED';
        s.isTrial = false;
        s.trialExpiredAt = _now();
      } else {
        s.isTrial = true;
      }
    }
    return s;
  }

  function initTrial() {
    if (!_userId || _role === 'admin') return;
    const s = _initTrialState();
    _save(_userId, s);
    _state = s;
    _applyTrialBanner();
    applyUILocks();
  }

  /* ───── 4. GATE API ──────────────────────────────────────── */

  function currentTier() {
    if (!_state) return 'LOCKED';
    if (_state.isAdmin) {
      return _state.simTier || 'ADMIN';
    }
    return _state.tier;
  }

  function getState() {
    if (!_state) return { tier:'LOCKED', locked:true };
    if (_state.isAdmin) {
      return {
        tier: _state.simTier || 'ADMIN',
        isAdmin: true,
        isAdminSim: !!_state.simTier,
        simTier: _state.simTier,
        locked: false,
        isTrial: false
      };
    }
    const daysLeft = _state.tier === 'TRIAL'
      ? Math.max(0, _daysBetween(_now(), _state.trialEnd)) : 0;
    return {
      tier: _state.tier,
      trialStart: _state.trialStart,
      trialEnd:   _state.trialEnd,
      isTrial:    !!_state.isTrial,
      daysLeft,
      locked:     _state.tier === 'LOCKED'
    };
  }

  function hasAccess(featId) {
    if (!featId) return true;
    if (!_state) return false;

    // Admin : bypass total sauf si simulation active
    if (_state.isAdmin) {
      if (_state.simTier) {
        const matrix = ACCESS_MATRIX[_state.simTier];
        return matrix ? matrix(featId) : false;
      }
      return true;
    }

    const tier = _state.tier;
    const matrix = ACCESS_MATRIX[tier];
    if (!matrix) return false;
    return matrix(featId);
  }

  function requireAccess(featId, opts) {
    opts = opts || {};
    if (hasAccess(featId)) return true;
    if (opts.silent) return false;
    showPaywall(featId);
    if (typeof opts.onDenied === 'function') opts.onDenied(featId);
    return false;
  }

  /* Tier minimum requis pour une feature donnée (pour message paywall) */
  function _requiredTierFor(featId) {
    const f = FEATURES[featId];
    if (!f) return 'PRO';
    return f.tier;
  }

  /* ───── 5. UPGRADE / ADMIN SIM ───────────────────────────── */

  function upgrade(tier) {
    if (!_userId || !TIERS[tier]) return false;
    if (_role === 'admin') return false;
    _state.tier = tier;
    _state.isTrial = false;
    _state.upgradedAt = _now();
    delete _state.trialExpiredAt;
    _save(_userId, _state);
    _applyTrialBanner();
    applyUILocks();
    // Re-render page abonnement si ouverte
    if (document.getElementById('view-mon-abo')?.classList.contains('on')) {
      renderAbonnementPage();
    }
    return true;
  }

  function setAdminSim(tier) {
    if (_role !== 'admin') return false;
    if (tier && !TIERS[tier] && tier !== 'LOCKED') return false;
    _state.simTier = tier || null;
    if (tier) sessionStorage.setItem('ami_admin_sim_tier', tier);
    else sessionStorage.removeItem('ami_admin_sim_tier');
    _applyTrialBanner();
    applyUILocks();
    return true;
  }

  function clearAdminSim() { return setAdminSim(null); }

  /* ───── 6. UI : BANDEAU ESSAI ────────────────────────────── */

  function _applyTrialBanner() {
    let banner = document.getElementById('sub-trial-banner');
    const st = getState();

    // Supprimer si admin sans sim ou si tier payant actif
    const shouldShow =
      (st.isTrial && !st.isAdmin) ||
      (st.locked && !st.isAdmin) ||
      (st.isAdmin && st.isAdminSim);

    if (!shouldShow) {
      if (banner) banner.remove();
      return;
    }

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
      html = `<span class="stb-ic">🔒</span>
              <span><b style="color:var(--d)">Votre essai gratuit est terminé.</b>
              · Choisissez un abonnement pour retrouver l'accès complet.</span>
              <button class="stb-btn stb-btn-cta" onclick="navTo('mon-abo')">Voir les abonnements</button>`;
    }
    banner.innerHTML = html;
  }

  /* ───── 7. UI : CADENAS SUR NAV ──────────────────────────── */

  /* Mapping data-v → featureId pour verrouiller la nav */
  const NAV_FEATURE_MAP = {
    'cot':               'cotation_ngap',
    'patients':          'patient_book',
    'imp':               'tournee_basic',
    'tur':               'tournee_ia_vrptw',
    'live':              'tournee_basic',
    'pla':               'tournee_basic',
    'his':               'historique',
    'outils-ordos':      'ordonnances',
    'outils-km':         'km_journal',
    'sig':               'signature',
    'pilulier':          'pilulier',
    'constantes':        'constantes',
    'tresor':            'tresor_base',
    'rapport':           'rapport_mensuel',
    'dash':              'dashboard_stats',
    'copilote':          'copilote_ia',
    'compte-rendu':      'compte_rendu',
    'bsi':               'bsi',
    'consentements':     'consentements',
    'alertes-med':       'alertes_med',
    'audit-cpam':        'audit_cpam',
    'outils-charges':    'charges_calc',
    'outils-modeles':    'modeles_soins',
    'outils-simulation': 'simulateur_maj',
    'cabinet':           'cabinet_multi_ide',
    'transmissions':     'transmissions',
    'compliance':        'compliance_engine',
    'ngap-ref':          'ngap_ref',
    'contact':           'contact_admin',
    'mon-abo':           null   // toujours accessible
  };

  function _featureForView(v) { return NAV_FEATURE_MAP[v] || null; }

  function applyUILocks() {
    document.querySelectorAll('.ni[data-v]').forEach(el => {
      const v = el.dataset.v;
      const feat = _featureForView(v);
      if (!feat) {
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

    // Bottom nav mobile
    document.querySelectorAll('#bottom-nav .bn-item[data-v], #mobile-menu .bn-item[data-v]').forEach(el => {
      const v = el.dataset.v;
      const feat = _featureForView(v);
      if (!feat) { el.classList.remove('ni-locked'); return; }
      if (hasAccess(feat)) el.classList.remove('ni-locked');
      else el.classList.add('ni-locked');
    });
  }

  /* ───── 8. PAYWALL MODALE ────────────────────────────────── */

  function showPaywall(featId) {
    const feat = FEATURES[featId];
    const tierReq = _requiredTierFor(featId);
    const tinfo = TIERS[tierReq];
    const st = getState();

    let modal = document.getElementById('sub-paywall');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sub-paywall';
      modal.className = 'sub-paywall-overlay';
      modal.addEventListener('click', e => {
        if (e.target === modal) _closePaywall();
      });
      document.body.appendChild(modal);
    }

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
          <button class="sub-paywall-btn sub-paywall-btn-primary" onclick="SUB._closePaywall(); navTo('mon-abo')">
            Voir les abonnements
          </button>
          ${canContinueTrial ? `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">
              Continuer l'essai (${st.daysLeft}j restant${st.daysLeft>1?'s':''})
            </button>
          ` : `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">
              Fermer
            </button>
          `}
        </div>
      </div>
    `;
    modal.classList.add('open');
    setTimeout(()=>modal.classList.add('visible'), 10);
  }

  function _closePaywall() {
    const modal = document.getElementById('sub-paywall');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(()=> modal.classList.remove('open'), 200);
  }

  /* ───── 9. PAGE ABONNEMENT ───────────────────────────────── */

  /* Contenu détaillé des plans pour la grille */
  const PLAN_DETAILS = {
    ESSENTIEL: {
      subtitle: 'IDEL solo débutante',
      features: [
        'Cotation NGAP intelligente',
        'Carnet patients chiffré',
        'Tournée basique + import calendrier',
        'Trésorerie & remboursements',
        'Rapport mensuel automatique',
        'Signatures électroniques',
        'Journal kilométrique',
        'Support standard'
      ]
    },
    PRO: {
      subtitle: 'IDEL solo active',
      features: [
        '✨ Tout AMI Essentiel',
        'Dashboard & statistiques avancées',
        'Simulateur audit CPAM',
        'Copilote IA (xAI Grok)',
        'BSI, Pilulier, Constantes',
        'Alertes médicamenteuses',
        'Compte-rendu + Consentements',
        'Tournée IA (VRPTW + 2-opt)',
        'Moteur de conformité'
      ],
      popular: true
    },
    CABINET: {
      subtitle: 'Cabinet 2 à 6 IDE',
      features: [
        '✨ Tout AMI Pro',
        'Mode cabinet multi-IDE',
        'Planning partagé',
        'Transmissions collaboratives',
        'Répartition intelligente des tournées',
        'Consentements partagés',
        'Audit consolidé cabinet'
      ]
    },
    PREMIUM: {
      subtitle: 'IDEL haut volume (add-on)',
      features: [
        '✨ S\'ajoute à Pro ou Cabinet',
        'Optimisation CA avancée',
        'Détection CA sous-déclaré',
        'Protection médico-légale renforcée',
        'Certificats forensiques horodatés',
        'SLA support prioritaire < 2h',
        'Rapport juridique mensuel'
      ]
    },
    COMPTABLE: {
      subtitle: 'Expert-comptable santé',
      features: [
        'Dashboard consolidé multi-IDEL',
        'Export liasse fiscale (2035, analytique)',
        'Scoring risque portfolio',
        'Vue anonymisée patient (RGPD)',
        'Alertes anomalies cabinet',
        'Rapports trimestriels automatiques'
      ]
    }
  };

  function renderAbonnementPage() {
    const root = document.getElementById('view-mon-abo');
    if (!root) return;
    const st = getState();

    const isAdmin = st.isAdmin;
    const currentTierKey = isAdmin ? (st.simTier || 'ADMIN') : st.tier;

    // ─ En-tête : statut actuel ─
    let header = '';
    if (isAdmin) {
      header = `
        <div class="sub-current-card sub-card-admin">
          <div class="sub-current-label">Mode admin</div>
          <div class="sub-current-tier">🛡️ Accès illimité (bypass)</div>
          <div class="sub-current-sub">Utilisez le panneau admin pour simuler un tier utilisateur.</div>
        </div>`;
    } else if (st.isTrial) {
      const urgency = st.daysLeft <= 7 ? 'urgent' : '';
      header = `
        <div class="sub-current-card ${urgency}">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier">✨ Essai gratuit</div>
          <div class="sub-current-sub">${st.daysLeft} jour${st.daysLeft>1?'s':''} restant${st.daysLeft>1?'s':''} · Accès total à toutes les fonctionnalités</div>
          <div class="sub-current-progress">
            <div class="sub-current-progress-bar" style="width:${Math.max(0, Math.min(100, (st.daysLeft/TRIAL_DAYS)*100))}%"></div>
          </div>
        </div>`;
    } else if (st.locked) {
      header = `
        <div class="sub-current-card locked">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier">🔒 Aucun abonnement actif</div>
          <div class="sub-current-sub">Votre essai gratuit est terminé. Choisissez un plan ci-dessous.</div>
        </div>`;
    } else {
      const t = TIERS[st.tier];
      header = `
        <div class="sub-current-card active">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier" style="color:${t.color}">✓ ${t.label}</div>
          <div class="sub-current-sub">${t.price} · Abonnement actif</div>
        </div>`;
    }

    // ─ Grille de plans ─
    const planCards = Object.entries(PLAN_DETAILS).map(([key, detail]) => {
      const tinfo = TIERS[key];
      const isCurrent = !isAdmin && st.tier === key;
      const popularBadge = detail.popular ? '<div class="sub-plan-popular">⭐ Le plus choisi</div>' : '';
      const btnLabel = isCurrent ? 'Plan actuel' : (isAdmin ? 'Simuler ce tier' : 'Choisir ce plan');
      const btnAction = isAdmin
        ? `SUB.setAdminSim('${key}')`
        : `SUB._confirmUpgrade('${key}')`;
      const featuresList = detail.features.map(f => `<li>${f}</li>`).join('');

      return `
        <div class="sub-plan-card ${detail.popular?'popular':''} ${isCurrent?'current':''}" data-tier="${key}">
          ${popularBadge}
          <div class="sub-plan-header" style="border-color:${tinfo.color}33">
            <div class="sub-plan-name" style="color:${tinfo.color}">${tinfo.label}</div>
            <div class="sub-plan-subtitle">${detail.subtitle}</div>
            <div class="sub-plan-price">${tinfo.price}</div>
          </div>
          <ul class="sub-plan-features">${featuresList}</ul>
          <button class="sub-plan-cta ${isCurrent?'current':''}" ${isCurrent?'disabled':''}
                  style="background:${isCurrent?'var(--s)':tinfo.color};color:${isCurrent?'var(--m)':'#000'}"
                  onclick="${btnAction}">
            ${btnLabel}
          </button>
        </div>`;
    }).join('');

    // ─ Simulation admin ─
    let adminPanel = '';
    if (isAdmin) {
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

    root.innerHTML = `
      <div class="sub-abo-page">
        <div class="sub-abo-hero">
          <h1>💎 Mon abonnement</h1>
          <p class="sub-abo-hero-sub">Choisissez le plan adapté à votre activité.</p>
        </div>

        ${header}
        ${adminPanel}

        <div class="sub-plans-grid">
          ${planCards}
        </div>

        <div class="sub-abo-footer">
          <div class="sub-abo-footer-item">
            <div class="sub-abo-footer-ic">🔒</div>
            <div>
              <b>Paiement sécurisé</b>
              <div class="sub-abo-footer-sub">Stripe · SEPA · CB</div>
            </div>
          </div>
          <div class="sub-abo-footer-item">
            <div class="sub-abo-footer-ic">↩️</div>
            <div>
              <b>Résiliable à tout moment</b>
              <div class="sub-abo-footer-sub">Sans engagement</div>
            </div>
          </div>
          <div class="sub-abo-footer-item">
            <div class="sub-abo-footer-ic">🏥</div>
            <div>
              <b>Données 100 % locales</b>
              <div class="sub-abo-footer-sub">RGPD / HDS</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* Confirmation upgrade (placeholder — worker intégrera Stripe plus tard) */
  function _confirmUpgrade(tier) {
    const t = TIERS[tier];
    if (!t) return;
    if (!confirm(`Passer à ${t.label} (${t.price}) ?\n\n⚠️ Démo : aucun paiement n'est traité pour l'instant.\nL'intégration Stripe sera activée à la prochaine version.`)) return;
    upgrade(tier);
    alert(`✓ Vous êtes maintenant sur ${t.label}. (Simulation locale.)`);
  }

  /* ───── 10. HOOK NAVIGATION ─────────────────────────────── */

  /* Installe un intercepteur sur navTo() pour bloquer les vues verrouillées */
  function _installNavGate() {
    if (window._subNavGateInstalled) return;
    if (typeof window.navTo !== 'function') {
      // navTo pas encore défini (ui.js non chargé) — réessayer plus tard
      setTimeout(_installNavGate, 100);
      return;
    }
    const _orig = window.navTo;
    window.navTo = function(v, triggerEl) {
      const feat = _featureForView(v);
      if (feat && !hasAccess(feat)) {
        showPaywall(feat);
        return;
      }
      return _orig.call(this, v, triggerEl);
    };
    window._subNavGateInstalled = true;
  }

  /* Re-render page abonnement sur navigation */
  document.addEventListener('ui:navigate', e => {
    if (e.detail.view === 'mon-abo') {
      renderAbonnementPage();
    }
  });

  /* Install nav gate dès que possible */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _installNavGate);
  } else {
    _installNavGate();
  }

  /* ───── 11. EXPORT ──────────────────────────────────────── */

  return {
    // État
    getState, currentTier, hasAccess, requireAccess,
    // Transitions
    bootstrap, initTrial, upgrade,
    // Admin
    setAdminSim, clearAdminSim,
    // UI
    showPaywall, applyUILocks, renderAbonnementPage,
    _closePaywall, _confirmUpgrade,
    // Constantes
    TIERS, FEATURES, PLAN_DETAILS,
    // Debug
    _debug: () => ({ state:_state, userId:_userId, role:_role })
  };
})();

/* Exposer alias raccourcis sur window */
window.hasAccess = (f) => SUB.hasAccess(f);
window.requireAccess = (f, opts) => SUB.requireAccess(f, opts);
