/* ════════════════════════════════════════════════
   subscription.js — AMI NGAP v2.0
   ────────────────────────────────────────────────
   v2.0 — SYNCHRONISÉ AVEC LE WORKER (Supabase)
   ✅ Mode TEST (défaut) : aucune limitation pour personne
   ✅ Mode PAYANT : essai 30j + tiers + verrous
   ✅ Admins : bypass + simulation locale
   ✅ Overrides admin persistés en BDD
   ✅ Fallback gracieux si worker injoignable (mode dégradé = TEST)

   📦 API PUBLIQUE
   SUB.getState()        → { tier, appMode, isTrial, daysLeft, locked, isAdmin, simTier }
   SUB.currentTier()     → 'TEST' | 'ADMIN' | 'TRIAL' | 'ESSENTIEL' | 'PRO' | 'CABINET' | 'PREMIUM' | 'COMPTABLE' | 'LOCKED'
   SUB.hasAccess(featId) → boolean
   SUB.requireAccess(featId, opts)
   SUB.bootstrap(userId, role) → fetch worker → hydrate _state
   SUB.refresh()         → re-fetch l'état
   SUB.upgrade(tier)     → POST /webhook/subscription-upgrade
   SUB.setAdminSim(tier) / SUB.clearAdminSim()
   SUB.showPaywall(feat) / SUB.applyUILocks() / SUB.renderAbonnementPage()

═════════════════════════════════════════════════ */
'use strict';

window.SUB = (function(){

  /* ───── 1. TIERS & FEATURES ──────────────────────────────── */

  const TIERS = {
    TEST:      { label:'Mode test (illimité)', price:'—', priority:999, color:'#00d4aa' },
    TRIAL:     { label:'Essai gratuit',        price:'0 €',                priority:900, color:'#00d4aa' },
    ESSENTIEL: { label:'AMI Essentiel',        price:'19 € HT / mois',     priority:1,   color:'#4fa8ff' },
    PRO:       { label:'AMI Pro',              price:'39 € HT / mois',     priority:2,   color:'#00d4aa' },
    CABINET:   { label:'AMI Cabinet',          price:'29 € HT / IDE / mois', priority:3, color:'#ffb547' },
    PREMIUM:   { label:'AMI Premium',          price:'+15 € HT / mois',    priority:4,   color:'#c678dd' },
    COMPTABLE: { label:'AMI Comptable',        price:'99 € HT / mois', priority:5,   color:'#ff5f6d', pricingDetail:'20 IDEL incluses · +5 € HT par IDEL supplémentaire' },
    LOCKED:    { label:'Aucun abonnement',     price:'—',                 priority:0,   color:'#6a8099' },
    ADMIN:     { label:'Admin (bypass)',       price:'—',                 priority:999, color:'#ff5f6d' }
  };

  const FEATURES = {
    cotation_ngap:       { tier:'ESSENTIEL', label:'Cotation NGAP',          desc:'Cotation intelligente de vos actes infirmiers avec vérification IA.' },
    patient_book:        { tier:'ESSENTIEL', label:'Carnet patients',        desc:'Gestion chiffrée locale de vos patients.' },
    tournee_basic:       { tier:'ESSENTIEL', label:'Tournée basique',        desc:'Import calendrier, planning, pilotage journée.' },
    tresor_base:         { tier:'ESSENTIEL', label:'Trésorerie',             desc:'Suivi remboursements AMO/AMC.' },
    rapport_mensuel:     { tier:'ESSENTIEL', label:'Rapport mensuel',        desc:'Synthèse automatique de votre activité.' },
    signature:           { tier:'ESSENTIEL', label:'Signatures électroniques', desc:'Signature tactile sur feuille de soins.' },
    contact_admin:       { tier:'ESSENTIEL', label:'Contact support',        desc:'Messagerie directe avec le support AMI.' },
    notes_soins:         { tier:'ESSENTIEL', label:'Notes de soins',         desc:'Prise de notes patient chiffrée.' },
    historique:          { tier:'ESSENTIEL', label:'Historique',             desc:'Historique de vos cotations.' },
    ngap_ref:            { tier:'ESSENTIEL', label:'Référentiel NGAP',        desc:'Nomenclature officielle consultable.' },
    km_journal:          { tier:'ESSENTIEL', label:'Journal kilométrique',   desc:'Suivi des déplacements pour déclaration.' },
    tournee_ia_vrptw:    { tier:'PRO', label:'Tournée IA (VRPTW + 2-opt)',   desc:'Optimisation intelligente de l\'ordre de passage.' },
    dashboard_stats:     { tier:'PRO', label:'Dashboard & statistiques',     desc:'Tableau de bord avancé, comparatifs, tendances.' },
    audit_cpam:          { tier:'PRO', label:'Simulateur audit CPAM',        desc:'Simulez un contrôle CPAM avant qu\'il n\'arrive.' },
    bsi:                 { tier:'PRO', label:'BSI — Bilan soins infirmiers', desc:'Génération et suivi des BSI.' },
    pilulier:            { tier:'PRO', label:'Semainier / Pilulier',         desc:'Gestion des piluliers patients.' },
    constantes:          { tier:'PRO', label:'Constantes patients',          desc:'Suivi TA, glycémie, SpO2 avec graphiques.' },
    alertes_med:         { tier:'PRO', label:'Alertes médicamenteuses',      desc:'Détection interactions, redondances.' },
    compte_rendu:        { tier:'PRO', label:'Compte-rendu de passage',      desc:'Générateur automatique de CR patient.' },
    consentements:       { tier:'PRO', label:'Consentements éclairés',       desc:'Gestion traçabilité RGPD.' },
    copilote_ia:         { tier:'PRO', label:'Copilote IA',                  desc:'Assistant conversationnel NGAP via xAI Grok.' },
    transmissions:       { tier:'PRO', label:'Transmissions infirmières',    desc:'Journal de transmissions chiffré.' },
    ordonnances:         { tier:'PRO', label:'Gestion ordonnances',          desc:'Cycle de vie des ordos patient.' },
    charges_calc:        { tier:'PRO', label:'Calcul charges & net',         desc:'Projection net/brut, URSSAF, CARPIMKO.' },
    modeles_soins:       { tier:'PRO', label:'Modèles de soins',             desc:'Bibliothèque de modèles réutilisables.' },
    simulateur_maj:      { tier:'PRO', label:'Simulateur majoration',        desc:'Test des cumuls de majorations.' },
    cabinet_multi_ide:   { tier:'CABINET', label:'Cabinet multi-IDE',         desc:'Gestion d\'un cabinet 2 à 6 infirmières.' },
    planning_shared:     { tier:'CABINET', label:'Planning partagé',          desc:'Coordination des tournées du cabinet.' },
    transmissions_shared:{ tier:'CABINET', label:'Transmissions partagées',   desc:'Journal collaboratif du cabinet.' },
    cabinet_manage_members:  { tier:'CABINET', label:'Gestion des membres',    desc:'Inviter, promouvoir et retirer des membres du cabinet (titulaire/gestionnaire uniquement).' },
    cabinet_consolidated_stats: { tier:'CABINET', label:'Stats consolidées cabinet', desc:'Vue CA, actes et performance de toutes les IDE du cabinet (titulaire/gestionnaire uniquement).' },
    compliance_engine:   { tier:'CABINET', label:'Conformité cabinet',        desc:'Moteur de conformité du cabinet : scoring 4 piliers, auto-correction, risque prédictif (titulaire/gestionnaire uniquement).' },
    optimisation_ca_plus:{ tier:'PREMIUM', label:'Optimisation CA+',          desc:'Revenue engine premium.' },
    protection_legale_plus:{ tier:'PREMIUM', label:'Protection médico-légale+', desc:'Certificats forensiques horodatés.' },
    sla_support:         { tier:'PREMIUM', label:'SLA support',               desc:'Support prioritaire < 2h.' },
    dashboard_consolide: { tier:'COMPTABLE', label:'Dashboard consolidé',     desc:'Vue multi-IDEL pour cabinet comptable.' },
    export_fiscal:       { tier:'COMPTABLE', label:'Export fiscal',           desc:'Exports liasse fiscale, 2035.' },
    scoring_risque:      { tier:'COMPTABLE', label:'Scoring risque portfolio', desc:'Scoring risque de chaque IDEL sous mandat.' }
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

  /* ───── 2. ÉTAT ──────────────────────────────────────────── */

  let _state = null;
  let _userId = null;
  let _role   = null;
  const TRIAL_DAYS = 30;
  const STORAGE_ADMIN_SIM = 'ami_admin_sim_tier';

  /* ───── 3. WORKER FETCH ──────────────────────────────────── */

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

  /* ───── 4. BOOTSTRAP ─────────────────────────────────────── */

  async function bootstrap(userId, role) {
    _userId = userId;
    _role   = role;

    try {
      const data = await _api('/webhook/subscription-status', {});
      const simTier = (role === 'admin') ? sessionStorage.getItem(STORAGE_ADMIN_SIM) : null;
      _state = {
        appMode:  data.app_mode || 'TEST',
        tier:     data.tier,
        isTrial:  !!data.is_trial,
        trialEnd: data.trial_end || null,
        paidUntil: data.paid_until || null,
        daysLeft: data.days_left,
        locked:   !!data.locked,
        isAdmin:  role === 'admin',
        simTier:  simTier,
        isAdminSim: !!(role === 'admin' && simTier),
        cabinetMember: !!data.cabinet_member,
        cabinetSize:   data.cabinet_size || 0,
        cabinetRole:   data.cabinet_role || null
      };
      // 🔎 Debug diagnostic — visible dans la console navigateur
      //   Permet de vérifier que le worker renvoie bien app_mode='TEST' côté client.
      //   Si appMode n'est pas 'TEST' alors que tu attends le mode test, problème serveur/DB.
      console.info('[SUB] bootstrap OK — appMode=%s tier=%s trial=%s locked=%s cabinet=%s',
        _state.appMode, _state.tier, _state.isTrial, _state.locked, _state.cabinetMember);
    } catch (e) {
      console.warn('[SUB] bootstrap failed, fallback mode TEST:', e.message);
      const simTier = (role === 'admin') ? sessionStorage.getItem(STORAGE_ADMIN_SIM) : null;
      _state = {
        appMode: 'TEST',
        tier: role === 'admin' ? 'ADMIN' : 'TEST',
        isTrial: false,
        isAdmin: role === 'admin',
        simTier: simTier,
        isAdminSim: !!(role === 'admin' && simTier),
        cabinetMember: false,
        cabinetSize: 0,
        cabinetRole: null,
        _fallback: true
      };
    }

    _applyTrialBanner();
    setTimeout(applyUILocks, 100);
    setTimeout(_checkExpirationNotification, 500);  // 💎 J-7 notification
    setTimeout(_checkCabinetRoleChange, 700);       // 🏥 Promo/démo cabinet notification
    return _state;
  }

  async function refresh() {
    if (_userId) return bootstrap(_userId, _role);
  }

  /* ───── 5. GATE API ──────────────────────────────────────── */

  function currentTier() {
    if (!_state) return 'LOCKED';
    if (_state.isAdmin && _state.simTier) return _state.simTier;
    return _state.tier;
  }

  function getState() {
    if (!_state) return { tier:'LOCKED', locked:true, appMode:'TEST' };
    return {
      tier: currentTier(),
      appMode: _state.appMode,
      isTrial: !!_state.isTrial,
      daysLeft: _state.daysLeft,
      trialEnd: _state.trialEnd,
      paidUntil: _state.paidUntil,
      locked: !!_state.locked,
      isAdmin: !!_state.isAdmin,
      isAdminSim: !!(_state.isAdmin && _state.simTier),
      simTier: _state.simTier,
      cabinetMember: !!_state.cabinetMember,
      cabinetSize: _state.cabinetSize || 0,
      cabinetRole: _state.cabinetRole || null,
      isCabinetManager: ['titulaire','gestionnaire'].includes(_state.cabinetRole || ''),
      fallback: !!_state._fallback
    };
  }

  /** Helper : true si l'user est titulaire ou gestionnaire du cabinet */
  function isCabinetManager() {
    if (!_state) return false;
    return ['titulaire','gestionnaire'].includes(_state.cabinetRole || '');
  }

  /** Helper : retourne 'titulaire' | 'gestionnaire' | 'membre' | null */
  function cabinetRole() {
    return _state?.cabinetRole || null;
  }

  function hasAccess(featId) {
    if (!featId) return true;
    if (!_state) return false;

    // ⚡ Admin en SIMULATION active : la simulation prime sur tout (même mode TEST)
    //   Permet de tester les verrous tier par tier sans désactiver le mode test global.
    if (_state.isAdmin && _state.simTier) {
      const simTier = _state.simTier;
      // Features manager-only : en sim, on autorise pour CABINET+ (cohérent avec la matrice)
      const MANAGER_ONLY_SIM = ['cabinet_manage_members', 'cabinet_consolidated_stats', 'compliance_engine'];
      if (MANAGER_ONLY_SIM.includes(featId)) {
        return ['CABINET','PREMIUM','COMPTABLE','TRIAL'].includes(simTier);
      }
      const matrix = ACCESS_MATRIX[simTier];
      return matrix ? matrix(featId) : false;
    }

    // Mode TEST global = tout accessible pour tous (hors admin en sim, déjà traité)
    if (_state.appMode === 'TEST') return true;

    // Admin sans sim = bypass total
    if (_state.isAdmin) return true;

    const tier = _state.tier;

    // 💎 Features manager cabinet : réservées aux titulaire/gestionnaire
    //   Pour éviter qu'un simple membre accède à la gestion / conformité cabinet.
    const MANAGER_ONLY = ['cabinet_manage_members', 'cabinet_consolidated_stats', 'compliance_engine'];
    if (MANAGER_ONLY.includes(featId)) {
      if (!isCabinetManager()) return false;
      if (_state.cabinetMember) return true;  // bonus cabinet couvre ce cas
      return ['CABINET','PREMIUM','COMPTABLE'].includes(tier);
    }

    // 💎 Bonus cabinet : si l'user est membre d'un cabinet ≥ 2 IDE,
    //   il a accès aux features CABINET (planning_shared, transmissions_shared, cabinet_multi_ide)
    //   quel que soit son tier souscrit.
    if (_state.cabinetMember && tier !== 'LOCKED') {
      if (FEATURES[featId]?.tier === 'CABINET') return true;
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

  function _requiredTierFor(featId) {
    return FEATURES[featId]?.tier || 'PRO';
  }

  /* ───── 6. UPGRADE (nurse) ──────────────────────────────── */

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

  /* ───── 7. ADMIN SIM (local seulement, session) ──────────── */

  function setAdminSim(tier) {
    if (_role !== 'admin') return false;
    if (tier && !TIERS[tier] && tier !== 'LOCKED') return false;
    _state.simTier = tier || null;
    _state.isAdminSim = !!tier;
    if (tier) sessionStorage.setItem(STORAGE_ADMIN_SIM, tier);
    else sessionStorage.removeItem(STORAGE_ADMIN_SIM);
    _applyTrialBanner();
    applyUILocks();
    if (document.getElementById('view-mon-abo')?.classList.contains('on')) {
      renderAbonnementPage();
    }
    return true;
  }

  function clearAdminSim() { return setAdminSim(null); }

  /* ───── 8. UI : BANDEAU ─────────────────────────────────── */

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
      // Différencier : essai expiré vs abonnement payant expiré
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

  /* ───── 9. UI : CADENAS NAV ─────────────────────────────── */

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
    'ngap-ref':'ngap_ref','contact':'contact_admin','mon-abo':null
  };

  function _featureForView(v) { return NAV_FEATURE_MAP[v] || null; }

  function applyUILocks() {
    const st = getState();
    // Mode TEST désactive les locks SAUF si admin en simulation (pour tester les verrous)
    const modeTest = st.appMode === 'TEST' && !st.isAdminSim;

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

  /* ───── 10. PAYWALL ──────────────────────────────────────── */

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
      modal.addEventListener('click', e => { if (e.target === modal) _closePaywall(); });
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
          <button class="sub-paywall-btn sub-paywall-btn-primary" onclick="SUB._closePaywall(); navTo('mon-abo')">Voir les abonnements</button>
          ${canContinueTrial ? `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">Continuer l'essai (${st.daysLeft}j restant${st.daysLeft>1?'s':''})</button>
          ` : `
            <button class="sub-paywall-btn sub-paywall-btn-ghost" onclick="SUB._closePaywall()">Fermer</button>
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

  /* ───── 11. PAGE ABONNEMENT ──────────────────────────────── */

  const PLAN_DETAILS = {
    ESSENTIEL: { subtitle:'IDEL solo débutante', features:['Cotation NGAP intelligente','Carnet patients chiffré','Tournée basique + import calendrier','Trésorerie & remboursements','Rapport mensuel','Signatures électroniques','Journal kilométrique','Support standard'] },
    PRO:       { subtitle:'IDEL solo active', features:['✨ Tout AMI Essentiel','Dashboard & statistiques','Simulateur audit CPAM','Copilote IA (xAI Grok)','BSI, Pilulier, Constantes','Alertes médicamenteuses','Compte-rendu + Consentements','Tournée IA (VRPTW + 2-opt)'], popular:true },
    CABINET:   { subtitle:'Cabinet 2 à 6 IDE', features:['✨ Tout AMI Pro','Mode cabinet multi-IDE','Planning partagé','Transmissions collaboratives','Répartition intelligente','Consentements partagés','🧠 Conformité cabinet (manager)','📊 Stats consolidées (manager)','🛠️ Gestion des membres (titulaire)'] },
    PREMIUM:   { subtitle:'IDEL haut volume (add-on)', features:['✨ S\'ajoute à Pro ou Cabinet','Optimisation CA avancée','Détection CA sous-déclaré','Protection médico-légale renforcée','Certificats forensiques horodatés','SLA support prioritaire < 2h','Rapport juridique mensuel'] },
    COMPTABLE: { subtitle:'Cabinet d\'expertise comptable santé', features:['Dashboard consolidé multi-IDEL (jusqu\'à 20 incluses)','Export FEC + liasse fiscale 2035','Générateur 2042-C-PRO · URSSAF · CARPIMKO','Scoring risque portfolio client','Alertes anomalies NGAP en masse','Connecteurs Cegid · EBP · Quadra','Vue anonymisée (pseudo-FEC)','Rapports trimestriels automatiques'] }
  };

  function renderAbonnementPage() {
    const root = document.getElementById('view-mon-abo');
    if (!root) return;
    const st = getState();

    let modeBanner = '';
    // Bandeau "Mode test" : visible uniquement si TEST global ET admin n'est PAS en simulation
    //   (en simulation, l'admin teste les verrous, afficher "mode test" serait confus)
    if (st.appMode === 'TEST' && !st.isAdminSim) {
      modeBanner = `
        <div class="sub-mode-banner test">
          <span style="font-size:22px">🧪</span>
          <div>
            <div style="font-weight:700;color:var(--a);margin-bottom:2px">Mode test actif</div>
            <div style="font-size:13px;color:var(--m)">L'application est en mode démonstration. Toutes les fonctionnalités sont accessibles sans limite pour tous les utilisateurs.</div>
          </div>
        </div>`;
    }

    // 💎 Bandeau bonus cabinet (si membre d'un cabinet ≥ 2 IDE)
    let cabinetBanner = '';
    if (st.cabinetMember && !st.isAdmin) {
      cabinetBanner = `
        <div class="sub-mode-banner cabinet">
          <span style="font-size:22px">🏥</span>
          <div>
            <div style="font-weight:700;color:var(--w);margin-bottom:2px">Bonus cabinet actif (${st.cabinetSize} IDE)</div>
            <div style="font-size:13px;color:var(--m)">Vous êtes membre d'un cabinet multi-IDE. Les fonctionnalités cabinet (planning partagé, transmissions collaboratives) sont débloquées automatiquement.</div>
          </div>
        </div>`;
    }

    let header = '';
    if (st.isAdmin) {
      header = `
        <div class="sub-current-card sub-card-admin">
          <div class="sub-current-label">Mode admin</div>
          <div class="sub-current-tier">🛡️ Accès illimité (bypass)</div>
          <div class="sub-current-sub">${st.appMode === 'TEST' ? 'App en mode test' : 'App en mode payant'} · Utilisez la simulation ci-dessous pour tester un tier.</div>
        </div>`;
    } else if (st.appMode === 'TEST') {
      header = `
        <div class="sub-current-card">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier" style="color:var(--a)">✓ Accès complet</div>
          <div class="sub-current-sub">L'application fonctionne en mode test. Vous avez accès à toutes les fonctionnalités.</div>
        </div>`;
    } else if (st.isTrial) {
      const urgency = st.daysLeft <= 7 ? 'urgent' : '';
      header = `
        <div class="sub-current-card ${urgency}">
          <div class="sub-current-label">Statut actuel</div>
          <div class="sub-current-tier">✨ Essai gratuit</div>
          <div class="sub-current-sub">${st.daysLeft} jour${st.daysLeft>1?'s':''} restant${st.daysLeft>1?'s':''} · Accès total à toutes les fonctionnalités</div>
          <div class="sub-current-progress"><div class="sub-current-progress-bar" style="width:${Math.max(0, Math.min(100, (st.daysLeft/TRIAL_DAYS)*100))}%"></div></div>
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
          <div class="sub-current-tier" style="color:${t?.color||'var(--a)'}">✓ ${t?.label||st.tier}</div>
          <div class="sub-current-sub">${t?.price||''} · Abonnement actif</div>
        </div>`;
    }

    // 💎 Groupement des plans en 2 familles distinctes (Option A)
    //   → IDEL : Essentiel, Pro, Cabinet, Premium (achetés par l'infirmière elle-même)
    //   → Expert-comptable : Comptable (acheté par un cabinet comptable, pricing per-seat)
    const IDEL_PLANS = ['ESSENTIEL','PRO','CABINET','PREMIUM'];
    const COMPTA_PLANS = ['COMPTABLE'];

    function _renderPlanCard(key) {
      const detail = PLAN_DETAILS[key];
      const tinfo = TIERS[key];
      if (!detail || !tinfo) return '';
      const isCurrent = !st.isAdmin && st.tier === key;
      const popularBadge = detail.popular ? '<div class="sub-plan-popular">⭐ Le plus choisi</div>' : '';
      let btnLabel, btnAction;
      if (st.isAdmin) { btnLabel = 'Simuler ce tier'; btnAction = `SUB.setAdminSim('${key}')`; }
      else if (isCurrent) { btnLabel = 'Plan actuel'; btnAction = ''; }
      else { btnLabel = 'Choisir ce plan'; btnAction = `SUB._confirmUpgrade('${key}')`; }
      const featuresList = detail.features.map(f => `<li>${f}</li>`).join('');
      // Détail de pricing (ex: "20 IDEL incluses · +5 € HT/IDEL supplémentaire" pour Comptable)
      const pricingDetail = tinfo.pricingDetail
        ? `<div class="sub-plan-price-detail">${tinfo.pricingDetail}</div>`
        : '';

      return `
        <div class="sub-plan-card ${detail.popular?'popular':''} ${isCurrent?'current':''}" data-tier="${key}">
          ${popularBadge}
          <div class="sub-plan-header" style="border-color:${tinfo.color}33">
            <div class="sub-plan-name" style="color:${tinfo.color}">${tinfo.label}</div>
            <div class="sub-plan-subtitle">${detail.subtitle}</div>
            <div class="sub-plan-price">${tinfo.price}</div>
            ${pricingDetail}
          </div>
          <ul class="sub-plan-features">${featuresList}</ul>
          <button class="sub-plan-cta ${isCurrent?'current':''}" ${isCurrent?'disabled':''}
                  style="background:${isCurrent?'var(--s)':tinfo.color};color:${isCurrent?'var(--m)':'#000'}"
                  onclick="${btnAction}">
            ${btnLabel}
          </button>
        </div>`;
    }

    const idelCards   = IDEL_PLANS.map(_renderPlanCard).join('');
    const comptaCards = COMPTA_PLANS.map(_renderPlanCard).join('');

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

    root.innerHTML = `
      <div class="sub-abo-page">
        <div class="sub-abo-hero">
          <h1>💎 Mon abonnement</h1>
          <p class="sub-abo-hero-sub">Choisissez le plan adapté à votre activité.</p>
        </div>
        ${modeBanner}
        ${cabinetBanner}
        ${header}
        ${adminPanel}

        <!-- 👩‍⚕️ Famille IDEL — plans achetés par l'infirmière elle-même -->
        <div class="sub-plans-group-header">
          <div class="sub-plans-group-title">
            <span style="font-size:22px">👩‍⚕️</span>
            <span>Pour les infirmières libérales</span>
          </div>
          <div class="sub-plans-group-sub">Abonnements individuels — l'IDEL choisit et paie son plan.</div>
        </div>
        <div class="sub-plans-grid">${idelCards}</div>

        <!-- 🧑‍💼 Famille Expert-comptable — plan multi-IDEL pour cabinets comptables -->
        <div class="sub-plans-group-header compta">
          <div class="sub-plans-group-title">
            <span style="font-size:22px">🧑‍💼</span>
            <span>Pour les experts-comptables santé</span>
          </div>
          <div class="sub-plans-group-sub">Plan multi-cabinets pour les experts-comptables qui gèrent plusieurs IDEL clientes. Tarifs en per-seat : <b>à partir de 10 € HT / IDEL / mois</b> pour un portefeuille de 20 clientes.</div>
        </div>
        <div class="sub-plans-grid compta">${comptaCards}</div>

        <div class="sub-abo-footer">
          <div class="sub-abo-footer-item"><div class="sub-abo-footer-ic">🔒</div><div><b>Paiement sécurisé</b><div class="sub-abo-footer-sub">Stripe · SEPA · CB</div></div></div>
          <div class="sub-abo-footer-item"><div class="sub-abo-footer-ic">↩️</div><div><b>Résiliable à tout moment</b><div class="sub-abo-footer-sub">Sans engagement</div></div></div>
          <div class="sub-abo-footer-item"><div class="sub-abo-footer-ic">🏥</div><div><b>Données 100 % locales</b><div class="sub-abo-footer-sub">RGPD / HDS</div></div></div>
        </div>
      </div>
    `;
  }

  async function _confirmUpgrade(tier) {
    const t = TIERS[tier];
    if (!t) return;
    if (!confirm(`Passer à ${t.label} (${t.price}) ?\n\n⚠️ Démo : aucun paiement n'est traité pour l'instant.\nL'intégration Stripe sera activée prochainement.`)) return;
    await upgrade(tier);
  }

  /* ───── 12. HOOK NAVIGATION ─────────────────────────────── */

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

  /* ───── 13. NOTIFICATIONS J-7 (expiration) ──────────────── */

  /**
   * Poussée de notification 7 jours (et moins) avant expiration.
   * Gère deux cas :
   *   - Essai gratuit qui se termine
   *   - Abonnement payant qui arrive à échéance
   * Dismissable : stocke la dernière dismissal dans localStorage (24h cooldown).
   */
  function _checkExpirationNotification() {
    if (!_state) return;
    const st = getState();

    // Pas de notif en mode TEST, admin, ou déjà locked
    if (st.appMode === 'TEST' || st.isAdmin || st.locked) return;

    let notifType = null;       // 'trial' | 'paid'
    let daysRemaining = null;
    let endDate = null;

    if (st.isTrial && st.daysLeft != null && st.daysLeft <= 7 && st.daysLeft > 0) {
      notifType = 'trial';
      daysRemaining = st.daysLeft;
      endDate = st.trialEnd;
    } else if (st.paidUntil && !st.isTrial) {
      const days = Math.ceil((new Date(st.paidUntil).getTime() - Date.now()) / (1000*60*60*24));
      if (days > 0 && days <= 7) {
        notifType = 'paid';
        daysRemaining = days;
        endDate = st.paidUntil;
      }
    }

    if (!notifType) return;

    // Cooldown 24h : si déjà notifié aujourd'hui, on skip
    const dismissKey = `ami_sub_notif_${notifType}_${_userId}`;
    const lastDismissed = localStorage.getItem(dismissKey);
    if (lastDismissed) {
      const ageH = (Date.now() - parseInt(lastDismissed, 10)) / (1000*60*60);
      if (ageH < 24) return;
    }

    // Builder notification
    const title = notifType === 'trial'
      ? `⏱️ Essai gratuit — ${daysRemaining} jour${daysRemaining>1?'s':''} restant${daysRemaining>1?'s':''}`
      : `💳 Abonnement expire dans ${daysRemaining} jour${daysRemaining>1?'s':''}`;
    const msg = notifType === 'trial'
      ? `Votre essai se termine le ${new Date(endDate).toLocaleDateString('fr-FR')}. Choisissez un plan pour conserver l'accès.`
      : `Votre abonnement expire le ${new Date(endDate).toLocaleDateString('fr-FR')}. Pensez à le renouveler pour éviter l'interruption.`;

    const severity = daysRemaining <= 3 ? 'warning' : 'info';
    _notify(severity, title, msg);

    // Enregistrer le timestamp de la dernière notif (pour cooldown 24h)
    localStorage.setItem(dismissKey, String(Date.now()));
  }

  /**
   * Wrapper sur le système de notifications existant (_addNotifItem dans index.html).
   * Fallback : si le panneau n'est pas dispo, log console.
   */
  function _notify(type, title, msg) {
    if (typeof window.notify === 'function') { window.notify(type, title, msg); return; }
    if (typeof window._addNotifItem === 'function') { window._addNotifItem(type, title, msg); return; }
    console.info(`[SUB notif] ${type.toUpperCase()} — ${title}`, msg);
  }

  /**
   * 🏥 Détecte un changement de rôle cabinet (promotion / rétrogradation / ajout / retrait)
   * par rapport au dernier rôle connu (stocké en localStorage par user).
   * Notifie via le panneau notifications à la prochaine connexion.
   */
  function _checkCabinetRoleChange() {
    if (!_state || !_userId) return;
    const currentRole = _state.cabinetRole || null;  // 'titulaire'|'gestionnaire'|'membre'|null
    const key = `ami_last_cab_role_${_userId}`;
    const lastKnown = localStorage.getItem(key);   // string ou null

    // Première connexion connue : juste mémoriser, pas de notif
    if (lastKnown === null && currentRole === null) return;
    if (lastKnown === null) {
      localStorage.setItem(key, currentRole || '');
      return;
    }

    // Pas de changement → rien
    const normalized = currentRole || '';
    if (lastKnown === normalized) return;

    // Changement détecté : construire le message selon la transition
    const ROLE_LABELS = { titulaire:'⭐ Titulaire', gestionnaire:'🛠️ Gestionnaire', membre:'👤 Membre' };
    let title = '', msg = '', severity = 'info';

    if (!lastKnown && currentRole) {
      // Rejoint un cabinet
      title = `🏥 Vous avez rejoint un cabinet`;
      msg = `Votre rôle : ${ROLE_LABELS[currentRole] || currentRole}. Retrouvez les options de gestion dans la section Cabinet.`;
      severity = 'success';
    } else if (lastKnown && !currentRole) {
      // Quitté un cabinet
      title = `🏥 Vous n'êtes plus dans un cabinet`;
      msg = `Votre rôle précédent (${ROLE_LABELS[lastKnown] || lastKnown}) a été révoqué.`;
      severity = 'info';
    } else if (lastKnown === 'membre' && currentRole === 'gestionnaire') {
      title = `🎉 Promotion cabinet`;
      msg = `Vous êtes désormais 🛠️ Gestionnaire du cabinet. Vous pouvez maintenant gérer les membres et consulter la conformité cabinet.`;
      severity = 'success';
    } else if (lastKnown === 'gestionnaire' && currentRole === 'membre') {
      title = `ℹ️ Changement de rôle cabinet`;
      msg = `Vous êtes désormais 👤 Membre standard du cabinet. L'accès à la gestion a été retiré.`;
      severity = 'info';
    } else if (lastKnown === 'membre' && currentRole === 'titulaire') {
      title = `👑 Vous êtes maintenant titulaire`;
      msg = `La propriété du cabinet vous a été transférée.`;
      severity = 'success';
    } else if (lastKnown === 'titulaire' && currentRole !== 'titulaire') {
      title = `ℹ️ Transfert de propriété cabinet`;
      msg = `Vous n'êtes plus titulaire. Rôle actuel : ${ROLE_LABELS[currentRole] || currentRole}.`;
      severity = 'info';
    } else {
      // Cas générique
      title = `🏥 Rôle cabinet modifié`;
      msg = `${ROLE_LABELS[lastKnown]||lastKnown} → ${ROLE_LABELS[currentRole]||currentRole}`;
    }

    _notify(severity, title, msg);
    localStorage.setItem(key, normalized);
  }

  /* ───── 14. EXPORT ──────────────────────────────────────── */

  return {
    getState, currentTier, hasAccess, requireAccess,
    isCabinetManager, cabinetRole,
    bootstrap, refresh, upgrade,
    setAdminSim, clearAdminSim,
    showPaywall, applyUILocks, renderAbonnementPage,
    _closePaywall, _confirmUpgrade,
    TIERS, FEATURES, PLAN_DETAILS, NAV_FEATURE_MAP,
    _debug: () => ({ state:_state, userId:_userId, role:_role })
  };
})();

window.hasAccess = (f) => SUB.hasAccess(f);
window.requireAccess = (f, opts) => SUB.requireAccess(f, opts);
