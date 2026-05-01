/* ════════════════════════════════════════════════════════════════════
   admin-comptabilite.js — AMI NGAP v1.0
   ────────────────────────────────────────────────────────────────────
   📒 ONGLET COMPTABILITÉ (panneau admin)
   ────────────────────────────────────────────────────────────────────
   Pour le propriétaire SaaS (admin) — pas pour les expert-comptables
   utilisateurs (eux ont le tier COMPTABLE et le module comptable.js).

   Ce que fait ce module :
   1. Calcule le CA mensuel récurrent (MRR) à partir des abonnements
      réels en BDD via /webhook/admin-subscription-list.
   2. Permet de saisir/éditer les charges fixes mensuelles
      (hébergement, Supabase, n8n, IA, comptable, etc.).
   3. Calcule mois par mois : Recettes − Charges = Bénéfice net.
   4. Génère un export PDF prêt à être signé par l'expert-comptable
      (impression A4 avec zone de signature) + export CSV.

   Stockage des charges :
   • Backend : /webhook/admin-charges-fixes-{get,set} (si dispo)
   • Fallback : localStorage clé 'ami:adm:charges_fixes'
   → Si le worker n'expose pas encore les endpoints, le module
     fonctionne immédiatement en local (zero impact production).

   Stockage des snapshots mensuels (recettes + ajustements) :
   • localStorage 'ami:adm:compta:snapshots' (par YYYY-MM)
   → Bastien peut "figer" un mois pour la comptabilité officielle.

   📦 API publique :
     window.AdmCompta = {
       load(),                       // appelé par admTab('compta')
       refresh(),                    // recharge données live
       saveCharges(),                // persiste charges fixes
       freezeMonth(yyyymm),          // fige un mois (snapshot)
       unfreezeMonth(yyyymm),        // dégèle
       exportPDF(yyyymm),            // imprime PDF mensuel
       exportCSV(year),              // CSV année complète
     }
═══════════════════════════════════════════════════════════════════════ */
'use strict';

(function(){

  /* ═════════════════════════════════════════════════════════════════
     1. CONFIG — prix par tier (HT par défaut, ajustable dans l'UI)
     ─────────────────────────────────────────────────────────────────
     Sources : subscription.js + AMI-landing.html (au 2026-05-01)
  ═════════════════════════════════════════════════════════════════ */
  const DEFAULT_TIER_PRICES = {
    ESSENTIEL: 29,           // €/mois (TTC affiché aux IDEL)
    PRO:       49,
    PREMIUM:   29,           // addon, +29 €/mois sur tier de base
    COMPTABLE: 99,           // HT/mois (B2B)
    // CABINET : prix dégressif selon nb membres
    CABINET_1_2: 49,         // 1 ou 2 IDE → 49 €/IDE/mois HT
    CABINET_3_5: 39,         // 3 à 5 IDE → 39 €/IDE/mois HT
    CABINET_6P:  29,         // 6+ IDE → 29 €/IDE/mois HT
    // Tiers non facturables
    TRIAL:     0,
    LOCKED:    0,
    UNKNOWN:   0,
    TEST:      0,
    ADMIN:     0
  };

  /* TVA par défaut sur abonnements B2C IDEL.
     Note : dans la pratique, ces abonnements peuvent être HT (B2B) ou
     soumis à TVA selon le statut. L'utilisateur peut basculer dans l'UI. */
  const DEFAULT_VAT_RATE = 20; // %

  /* Charges fixes par défaut (suggestions — éditables) */
  const DEFAULT_CHARGES = [
    { id: 'host',     label: 'Hébergement (Cloudflare Workers)', amount: 0, recurrent: true },
    { id: 'db',       label: 'Base de données (Supabase)',       amount: 0, recurrent: true },
    { id: 'auto',     label: 'Automation (n8n)',                 amount: 0, recurrent: true },
    { id: 'ia',       label: 'IA (OpenAI / Anthropic API)',      amount: 0, recurrent: true },
    { id: 'domaine',  label: 'Nom de domaine',                   amount: 0, recurrent: true },
    { id: 'stripe',   label: 'Stripe (frais)',                   amount: 0, recurrent: true },
    { id: 'compta',   label: 'Honoraires expert-comptable',      amount: 0, recurrent: true },
    { id: 'rcpro',    label: 'Assurance RC pro',                 amount: 0, recurrent: true },
    { id: 'autre',    label: 'Autres',                           amount: 0, recurrent: true }
  ];

  /* ═════════════════════════════════════════════════════════════════
     2. ÉTAT
  ═════════════════════════════════════════════════════════════════ */
  const STATE = {
    prices:    null,    // { ESSENTIEL: 29, ... } — chargé / éditable
    vatRate:   DEFAULT_VAT_RATE,
    charges:   null,    // [{id,label,amount,recurrent}, ...]
    subs:      [],      // résultat /admin-subscription-list
    snapshots: {},      // { 'YYYY-MM': { revenue, charges, frozen, ... } }
    selectedMonth: _ymNow(),
    selectedYear:  new Date().getUTCFullYear(),
    appMode:   'TEST'   // 'TEST' ou 'PAYANT'
  };

  /* ═════════════════════════════════════════════════════════════════
     3. UTILS
  ═════════════════════════════════════════════════════════════════ */
  function _esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function _eur(n){return (Math.round((Number(n)||0)*100)/100).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
  function _pct(n){return (Math.round((Number(n)||0)*10)/10).toLocaleString('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1})+' %';}
  function _ymNow(){const d=new Date();return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
  function _ymLabel(ym){const [y,m]=ym.split('-');const N=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];return `${N[+m-1]} ${y}`;}
  function _todayFR(){return new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});}
  function _toast(msg, type='o'){if(typeof admAlert==='function') admAlert(msg, type); else if(typeof showToast==='function') showToast(type==='e'?'error':type==='w'?'warning':'success', msg);}

  /* ─── Persistance localStorage (toujours utilisée comme cache + fallback) ─── */
  const LS_CHARGES   = 'ami:adm:charges_fixes_v1';
  const LS_PRICES    = 'ami:adm:tier_prices_v1';
  const LS_SNAPSHOTS = 'ami:adm:compta:snapshots_v1';
  const LS_VAT       = 'ami:adm:vat_rate_v1';

  function _lsGet(k, fallback){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fallback;}catch(_){return fallback;}}
  function _lsSet(k, v){try{localStorage.setItem(k, JSON.stringify(v));}catch(_){}}

  /* ═════════════════════════════════════════════════════════════════
     4. PERSISTANCE charges/prix : backend si dispo, sinon localStorage
  ═════════════════════════════════════════════════════════════════ */
  async function _loadCharges() {
    // Tenter backend (silencieux si endpoint absent)
    if (typeof wpost === 'function') {
      try {
        const d = await wpost('/webhook/admin-charges-fixes-get', {});
        if (d && d.ok && d.data) {
          if (Array.isArray(d.data.charges)) STATE.charges = d.data.charges;
          if (d.data.prices && typeof d.data.prices === 'object') STATE.prices = { ...DEFAULT_TIER_PRICES, ...d.data.prices };
          if (typeof d.data.vatRate === 'number') STATE.vatRate = d.data.vatRate;
          if (d.data.snapshots && typeof d.data.snapshots === 'object') STATE.snapshots = d.data.snapshots;
          // Synchro vers localStorage (cache)
          _lsSet(LS_CHARGES, STATE.charges);
          _lsSet(LS_PRICES, STATE.prices);
          _lsSet(LS_VAT, STATE.vatRate);
          _lsSet(LS_SNAPSHOTS, STATE.snapshots);
          return { source: 'server' };
        }
      } catch (_) { /* silent fallback */ }
    }
    // Fallback localStorage
    STATE.charges   = _lsGet(LS_CHARGES, JSON.parse(JSON.stringify(DEFAULT_CHARGES)));
    STATE.prices    = { ...DEFAULT_TIER_PRICES, ..._lsGet(LS_PRICES, {}) };
    STATE.vatRate   = _lsGet(LS_VAT, DEFAULT_VAT_RATE);
    STATE.snapshots = _lsGet(LS_SNAPSHOTS, {});
    return { source: 'local' };
  }

  async function _saveCharges() {
    // Toujours sauvegarder localStorage (immédiat)
    _lsSet(LS_CHARGES, STATE.charges);
    _lsSet(LS_PRICES, STATE.prices);
    _lsSet(LS_VAT, STATE.vatRate);
    _lsSet(LS_SNAPSHOTS, STATE.snapshots);
    // Tenter backend (silencieux si endpoint absent)
    if (typeof wpost === 'function') {
      try {
        const d = await wpost('/webhook/admin-charges-fixes-set', {
          data: {
            charges:   STATE.charges,
            prices:    STATE.prices,
            vatRate:   STATE.vatRate,
            snapshots: STATE.snapshots
          }
        });
        return d && d.ok ? 'server' : 'local';
      } catch (_) { return 'local'; }
    }
    return 'local';
  }

  /* ═════════════════════════════════════════════════════════════════
     5. CALCUL DES RECETTES (MRR) à partir de la liste d'abonnements
     ─────────────────────────────────────────────────────────────────
     Entrée : STATE.subs (sortie de /webhook/admin-subscription-list)
     Sortie : { byTier: { ESSENTIEL: {count, unit, total}, ... },
                totalHT, totalTVA, totalTTC, premiumAddonCount }
  ═════════════════════════════════════════════════════════════════ */
  function _computeRevenue(subs, prices, vatRate) {
    const P = prices || DEFAULT_TIER_PRICES;
    const out = {
      byTier: {
        ESSENTIEL: { count:0, unit:P.ESSENTIEL, total:0 },
        PRO:       { count:0, unit:P.PRO,       total:0 },
        CABINET:   { count:0, unit:0,           total:0, breakdown:{ '1-2':0, '3-5':0, '6+':0 } },
        PREMIUM:   { count:0, unit:P.PREMIUM,   total:0 },
        COMPTABLE: { count:0, unit:P.COMPTABLE, total:0 }
      },
      trialCount:    0,
      lockedCount:   0,
      blockedCount:  0,
      totalHT:       0
    };

    (subs || []).forEach(s => {
      if (s.is_blocked) { out.blockedCount++; return; }
      const t = s.tier;

      if (t === 'TRIAL')        out.trialCount++;
      else if (t === 'LOCKED' || t === 'UNKNOWN') out.lockedCount++;
      else if (t === 'ESSENTIEL') {
        out.byTier.ESSENTIEL.count++;
        out.byTier.ESSENTIEL.total += P.ESSENTIEL;
      }
      else if (t === 'PRO') {
        out.byTier.PRO.count++;
        out.byTier.PRO.total += P.PRO;
      }
      else if (t === 'CABINET') {
        out.byTier.CABINET.count++;
        const sz = Number(s.cabinet_size || 1);
        let unit = P.CABINET_1_2;
        let bucket = '1-2';
        if (sz >= 6)      { unit = P.CABINET_6P; bucket = '6+'; }
        else if (sz >= 3) { unit = P.CABINET_3_5; bucket = '3-5'; }
        out.byTier.CABINET.total += unit;
        out.byTier.CABINET.breakdown[bucket]++;
      }
      else if (t === 'COMPTABLE') {
        out.byTier.COMPTABLE.count++;
        out.byTier.COMPTABLE.total += P.COMPTABLE;
      }

      // PREMIUM est un add-on cumulatif (s'ajoute à n'importe quel tier de base)
      // L'API ne le retourne pas dans /admin-subscription-list pour le moment ;
      // on prévoit un compteur séparé si jamais l'info est exposée plus tard.
      if (s.premium_addon === true) {
        out.byTier.PREMIUM.count++;
        out.byTier.PREMIUM.total += P.PREMIUM;
      }
    });

    out.byTier.CABINET.unit = out.byTier.CABINET.count
      ? Math.round(out.byTier.CABINET.total / out.byTier.CABINET.count) : 0;

    out.totalHT  = Object.values(out.byTier).reduce((s,r)=>s+r.total, 0);
    const vr     = (Number(vatRate) || 0) / 100;
    out.totalTVA = Math.round(out.totalHT * vr * 100) / 100;
    out.totalTTC = Math.round((out.totalHT + out.totalTVA) * 100) / 100;
    return out;
  }

  function _chargesTotal(charges) {
    return (charges || []).reduce((s,c) => s + (Number(c.amount)||0), 0);
  }

  /* ─── Helper : promesse avec timeout dur (anti-blocage) ─── */
  function _withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + ms + 'ms ' + (label||''))), ms))
    ]);
  }

  /* ═════════════════════════════════════════════════════════════════
     6. CHARGEMENT (entry point)
     ─────────────────────────────────────────────────────────────────
     Stratégie anti-blocage :
     1. Charger d'abord la config locale (instantané) → rendre l'UI
     2. Lancer les requêtes serveur en parallèle avec timeout dur 4s
     3. Re-rendre dès qu'on a les données (ou afficher un bouton retry)
  ═════════════════════════════════════════════════════════════════ */
  async function load() {
    console.log('[adm-compta] load() démarré');
    const root = document.getElementById('adm-compta-root');
    if (!root) {
      console.error('[adm-compta] #adm-compta-root introuvable dans le DOM');
      return;
    }

    // ── Étape 1 : charger config locale (synchrone, < 50ms) + rendre UI immédiatement ──
    try {
      // Config locale d'abord (localStorage = instantané) pour rendre l'UI sans attente
      STATE.charges   = _lsGet(LS_CHARGES, JSON.parse(JSON.stringify(DEFAULT_CHARGES)));
      STATE.prices    = { ...DEFAULT_TIER_PRICES, ..._lsGet(LS_PRICES, {}) };
      STATE.vatRate   = _lsGet(LS_VAT, DEFAULT_VAT_RATE);
      STATE.snapshots = _lsGet(LS_SNAPSHOTS, {});
      STATE.subs      = [];
      STATE.appMode   = 'TEST';
      console.log('[adm-compta] config locale chargée — rendu initial');
      _render(); // rendu immédiat avec recettes à 0
    } catch (e) {
      console.error('[adm-compta] erreur rendu initial :', e);
      root.innerHTML = `<div class="ai er" style="padding:20px">⚠️ Erreur de rendu : ${_esc(e.message)}</div>`;
      return;
    }

    // ── Étape 2 : charger données serveur en parallèle, avec timeout dur 4s chacune ──
    if (typeof wpost !== 'function') {
      console.warn('[adm-compta] wpost indisponible — mode 100% local');
      _injectWarning('⚠️ Connexion serveur indisponible. Données locales uniquement.');
      return;
    }

    console.log('[adm-compta] chargement données serveur (parallèle, timeout 4s)…');
    const tasks = await Promise.allSettled([
      _withTimeout(wpost('/webhook/admin-charges-fixes-get', {}), 4000, 'charges-get'),
      _withTimeout(wpost('/webhook/admin-subscription-list', {}), 4000, 'sub-list'),
      _withTimeout(wpost('/webhook/subscription-status', {}),     4000, 'sub-status')
    ]);

    // Charges-fixes-get (config serveur)
    if (tasks[0].status === 'fulfilled' && tasks[0].value && tasks[0].value.ok && tasks[0].value.data) {
      const d = tasks[0].value.data;
      if (Array.isArray(d.charges))                STATE.charges   = d.charges;
      if (d.prices && typeof d.prices === 'object') STATE.prices    = { ...DEFAULT_TIER_PRICES, ...d.prices };
      if (typeof d.vatRate === 'number')           STATE.vatRate   = d.vatRate;
      if (d.snapshots && typeof d.snapshots === 'object') STATE.snapshots = d.snapshots;
      // Sync localStorage
      _lsSet(LS_CHARGES, STATE.charges);
      _lsSet(LS_PRICES, STATE.prices);
      _lsSet(LS_VAT, STATE.vatRate);
      _lsSet(LS_SNAPSHOTS, STATE.snapshots);
      console.log('[adm-compta] config serveur récupérée');
    } else if (tasks[0].status === 'rejected') {
      console.warn('[adm-compta] charges-get KO (fallback localStorage) :', tasks[0].reason && tasks[0].reason.message);
    }

    // Subscription-list (recettes)
    if (tasks[1].status === 'fulfilled' && tasks[1].value && tasks[1].value.ok) {
      STATE.subs = (tasks[1].value.comptes || []).filter(a => a.role !== 'admin');
      console.log('[adm-compta] subscription-list OK :', STATE.subs.length, 'abonnements');
    } else {
      console.warn('[adm-compta] subscription-list KO :', tasks[1].reason && tasks[1].reason.message);
    }

    // Subscription-status (mode TEST/PAYANT)
    if (tasks[2].status === 'fulfilled' && tasks[2].value && tasks[2].value.ok) {
      STATE.appMode = tasks[2].value.app_mode || 'TEST';
    }

    // ── Re-rendre avec les données serveur ──
    _render();
    console.log('[adm-compta] rendu final OK');
  }

  /** Affiche un avertissement non-bloquant en bas du module. */
  function _injectWarning(msg) {
    const root = document.getElementById('adm-compta-root');
    if (!root) return;
    const existing = document.getElementById('cmpt-warn');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'cmpt-warn';
    div.style.cssText = 'background:rgba(255,181,71,.10);border:1px solid rgba(255,181,71,.3);border-radius:8px;padding:10px 14px;margin-bottom:14px;color:var(--w);font-size:12px;font-family:var(--fm)';
    div.textContent = msg;
    root.insertBefore(div, root.firstChild);
  }

  async function refresh() { return load(); }

  /* ═════════════════════════════════════════════════════════════════
     7. RENDU PRINCIPAL
  ═════════════════════════════════════════════════════════════════ */
  function _render() {
    const root = document.getElementById('adm-compta-root');
    if (!root) return;

    _injectStyles();
    const rev      = _computeRevenue(STATE.subs, STATE.prices, STATE.vatRate);
    const chTotal  = _chargesTotal(STATE.charges);
    const benefHT  = Math.round((rev.totalHT - chTotal) * 100) / 100;
    const margePct = rev.totalHT > 0 ? (benefHT / rev.totalHT) * 100 : 0;

    const modeBadge = STATE.appMode === 'TEST'
      ? `<span class="cmpt-mode-badge cmpt-mode-test">⚠️ Mode TEST — recettes simulées (aucune facturation réelle)</span>`
      : `<span class="cmpt-mode-badge cmpt-mode-payant">✓ Mode PAYANT — facturation active</span>`;

    root.innerHTML = `
      <div class="cmpt-wrap">

        <!-- ── HEADER ── -->
        <div class="cmpt-hero">
          <div>
            <div class="cmpt-h1">📒 Comptabilité <em>SaaS</em></div>
            <div class="cmpt-sub">Calcul automatique du chiffre d'affaires + suivi des charges fixes · Export prêt à signer pour l'expert-comptable</div>
          </div>
          <div class="cmpt-hero-actions">
            <button class="cmpt-btn cmpt-btn-ghost" onclick="AdmCompta.refresh()">↻ Actualiser</button>
            <button class="cmpt-btn cmpt-btn-primary" onclick="AdmCompta.exportPDF('${_esc(STATE.selectedMonth)}')">📄 Export PDF mensuel</button>
            <button class="cmpt-btn cmpt-btn-ghost" onclick="AdmCompta.exportCSV(${STATE.selectedYear})">📊 Export CSV année</button>
          </div>
        </div>

        ${modeBadge}

        <!-- ── KPIs MOIS COURANT ── -->
        <div class="cmpt-kpis">
          <div class="cmpt-kpi cmpt-kpi-rev">
            <div class="cmpt-kpi-icon">💰</div>
            <div class="cmpt-kpi-label">Recettes mensuelles HT</div>
            <div class="cmpt-kpi-val">${_eur(rev.totalHT)}</div>
            <div class="cmpt-kpi-sub">TTC : ${_eur(rev.totalTTC)}</div>
          </div>
          <div class="cmpt-kpi cmpt-kpi-chg">
            <div class="cmpt-kpi-icon">💸</div>
            <div class="cmpt-kpi-label">Charges fixes</div>
            <div class="cmpt-kpi-val">${_eur(chTotal)}</div>
            <div class="cmpt-kpi-sub">${(STATE.charges||[]).filter(c=>c.amount>0).length} poste(s) actif(s)</div>
          </div>
          <div class="cmpt-kpi cmpt-kpi-benef ${benefHT>=0?'positive':'negative'}">
            <div class="cmpt-kpi-icon">${benefHT>=0?'📈':'📉'}</div>
            <div class="cmpt-kpi-label">Bénéfice HT</div>
            <div class="cmpt-kpi-val">${_eur(benefHT)}</div>
            <div class="cmpt-kpi-sub">Marge : ${_pct(margePct)}</div>
          </div>
        </div>

        <!-- ── SECTION 1 : RECETTES PAR TIER ── -->
        <div class="cmpt-section">
          <div class="cmpt-section-head">
            <div class="cmpt-section-title">📊 Recettes par offre — ${_ymLabel(STATE.selectedMonth)}</div>
            <div class="cmpt-section-tools">
              <label class="cmpt-tva-label">TVA :
                <input type="number" step="0.5" min="0" max="50" value="${STATE.vatRate}" onchange="AdmCompta._setVAT(this.value)" class="cmpt-tva-input"> %
              </label>
              <button class="cmpt-btn-mini" onclick="AdmCompta._togglePriceEdit()">✏️ Modifier prix</button>
            </div>
          </div>
          ${_renderRevenueTable(rev)}
          <div class="cmpt-info">
            <strong>${rev.trialCount}</strong> compte(s) en essai gratuit (non facturés) · 
            <strong>${rev.lockedCount}</strong> compte(s) verrouillé(s) · 
            <strong>${rev.blockedCount}</strong> compte(s) bloqué(s)
          </div>
        </div>

        <!-- ── SECTION 2 : CHARGES FIXES ── -->
        <div class="cmpt-section">
          <div class="cmpt-section-head">
            <div class="cmpt-section-title">💸 Charges fixes mensuelles</div>
            <div class="cmpt-section-tools">
              <button class="cmpt-btn-mini" onclick="AdmCompta._addCharge()">＋ Ajouter une charge</button>
              <button class="cmpt-btn-mini cmpt-btn-mini-primary" onclick="AdmCompta.saveCharges()">💾 Enregistrer</button>
            </div>
          </div>
          ${_renderChargesEditor()}
        </div>

        <!-- ── SECTION 3 : GRAPHIQUE D'ÉVOLUTION ── -->
        <div class="cmpt-section">
          <div class="cmpt-section-head">
            <div class="cmpt-section-title">📈 Évolution mensuelle ${STATE.selectedYear}</div>
            <div class="cmpt-section-tools">
              <span class="cmpt-legend"><span class="cmpt-legend-dot" style="background:var(--a2)"></span>Recettes</span>
              <span class="cmpt-legend"><span class="cmpt-legend-dot" style="background:var(--w)"></span>Charges</span>
              <span class="cmpt-legend"><span class="cmpt-legend-dot" style="background:var(--a)"></span>Bénéfice</span>
            </div>
          </div>
          ${_renderChart(rev, chTotal)}
        </div>

        <!-- ── SECTION 4 : VUE ANNUELLE ── -->
        <div class="cmpt-section">
          <div class="cmpt-section-head">
            <div class="cmpt-section-title">📅 Récapitulatif annuel ${STATE.selectedYear}</div>
            <div class="cmpt-section-tools">
              <button class="cmpt-btn-mini" onclick="AdmCompta._setYear(${STATE.selectedYear-1})">←</button>
              <span class="cmpt-year-label">${STATE.selectedYear}</span>
              <button class="cmpt-btn-mini" onclick="AdmCompta._setYear(${STATE.selectedYear+1})">→</button>
            </div>
          </div>
          ${_renderAnnualTable(rev, chTotal)}
        </div>

        <!-- ── SECTION 4 : INFO RGPD ── -->
        <div class="cmpt-info-box">
          <strong>ℹ️ À propos de cette page</strong><br>
          Les recettes sont calculées en temps réel à partir de la table <code>subscriptions</code> (Supabase).
          Les charges fixes sont stockées côté admin (backend si endpoint disponible, sinon navigateur).
          L'export PDF est généré localement dans votre navigateur — aucune donnée comptable n'est transmise à un tiers.
          Pour les mois passés, les chiffres sont une estimation basée sur le snapshot actuel des abonnements ;
          utilisez le bouton « Figer ce mois » pour verrouiller un mois définitivement à la fin de chaque période.
        </div>

      </div>
    `;
  }

  /* ─── Tableau recettes par tier ─── */
  function _renderRevenueTable(rev) {
    const rows = [
      { tier:'ESSENTIEL',  label:'Essentiel',         color:'#4fa8ff', d: rev.byTier.ESSENTIEL },
      { tier:'PRO',        label:'Pro',               color:'#00d4aa', d: rev.byTier.PRO },
      { tier:'CABINET',    label:'Cabinet',           color:'#a78bfa', d: rev.byTier.CABINET },
      { tier:'PREMIUM',    label:'Premium (add-on)',  color:'#fbbf24', d: rev.byTier.PREMIUM },
      { tier:'COMPTABLE',  label:'AMI Comptable',     color:'#ff5f6d', d: rev.byTier.COMPTABLE }
    ];
    const body = rows.map(r => {
      const detail = (r.tier === 'CABINET' && r.d.count > 0)
        ? `<div class="cmpt-cab-detail">1-2 IDE: ${r.d.breakdown['1-2']} · 3-5: ${r.d.breakdown['3-5']} · 6+: ${r.d.breakdown['6+']}</div>`
        : '';
      const unitCell = r.tier === 'CABINET'
        ? `<span class="cmpt-mut">dégressif</span>`
        : `${_eur(r.d.unit)}/mois`;
      return `
        <tr>
          <td><span class="cmpt-tier-dot" style="background:${r.color}"></span> ${r.label}${detail}</td>
          <td class="cmpt-num">${r.d.count}</td>
          <td class="cmpt-num">${unitCell}</td>
          <td class="cmpt-num cmpt-strong">${_eur(r.d.total)}</td>
        </tr>`;
    }).join('');

    return `
      <table class="cmpt-table">
        <thead>
          <tr>
            <th>Offre</th>
            <th class="cmpt-num">Comptes actifs</th>
            <th class="cmpt-num">Prix unitaire HT</th>
            <th class="cmpt-num">Sous-total HT</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr class="cmpt-foot-row">
            <td><strong>Total HT</strong></td>
            <td></td>
            <td></td>
            <td class="cmpt-num cmpt-strong">${_eur(rev.totalHT)}</td>
          </tr>
          <tr class="cmpt-foot-row cmpt-foot-vat">
            <td>TVA (${STATE.vatRate} %)</td>
            <td></td>
            <td></td>
            <td class="cmpt-num">${_eur(rev.totalTVA)}</td>
          </tr>
          <tr class="cmpt-foot-row cmpt-foot-total">
            <td><strong>Total TTC</strong></td>
            <td></td>
            <td></td>
            <td class="cmpt-num cmpt-strong cmpt-ttc">${_eur(rev.totalTTC)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /* ─── Éditeur de charges fixes ─── */
  function _renderChargesEditor() {
    const charges = STATE.charges || [];
    if (!charges.length) {
      return `<div class="cmpt-empty">Aucune charge enregistrée. <button class="cmpt-btn-mini" onclick="AdmCompta._addCharge()">＋ Ajouter</button></div>`;
    }
    const rows = charges.map((c, i) => `
      <tr data-idx="${i}">
        <td>
          <input type="text" class="cmpt-input" value="${_esc(c.label)}"
                 oninput="AdmCompta._editCharge(${i},'label',this.value)" placeholder="Libellé…">
        </td>
        <td class="cmpt-num">
          <input type="number" step="0.01" min="0" class="cmpt-input cmpt-input-num"
                 value="${Number(c.amount)||0}"
                 oninput="AdmCompta._editCharge(${i},'amount',this.value)">
        </td>
        <td class="cmpt-num">
          <button class="cmpt-icon-btn cmpt-icon-del" title="Supprimer" onclick="AdmCompta._delCharge(${i})">✕</button>
        </td>
      </tr>
    `).join('');
    const total = _chargesTotal(charges);
    return `
      <table class="cmpt-table cmpt-table-edit">
        <thead>
          <tr>
            <th>Libellé</th>
            <th class="cmpt-num">Montant € / mois</th>
            <th class="cmpt-num"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="cmpt-foot-total">
            <td><strong>Total charges fixes</strong></td>
            <td class="cmpt-num cmpt-strong">${_eur(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /* ─── Construit la série mensuelle (utilisée par graphique + tableau annuel) ─── */
  function _buildMonthlySeries(currentRev, currentCharges) {
    const months = [];
    const nowYM = _ymNow();
    for (let m = 1; m <= 12; m++) {
      const ym = `${STATE.selectedYear}-${String(m).padStart(2,'0')}`;
      const snap = STATE.snapshots[ym] || null;
      const isFuture  = ym > nowYM;
      const isCurrent = ym === nowYM;
      const isPast    = !isFuture && !isCurrent;

      let revHT, charges, frozen = false, noData = false;
      if (snap && snap.frozen) {
        // Mois figé : valeurs historisées au moment du snapshot
        revHT = snap.revHT; charges = snap.charges; frozen = true;
      } else if (isFuture) {
        // Mois futur : pas encore arrivé
        revHT = 0; charges = 0;
      } else if (isPast) {
        // ⚡ FIX (2026-05-01) : mois passé SANS snapshot figé → AUCUNE donnée.
        //   AVANT : on recopiait les valeurs du mois COURANT (currentRev), ce qui
        //   faisait croire à tort que Janvier/Février/etc. avaient la même
        //   clientèle et les mêmes charges qu'aujourd'hui — affichage trompeur
        //   surtout après un démarrage récent (5 mois identiques).
        //   APRÈS : on affiche 0 + flag noData → le rendu mettra "—" (pas de
        //   donnée). L'admin peut figer rétroactivement un mois s'il a les
        //   chiffres réels (bouton 🔒 dans la table).
        revHT = 0; charges = 0; noData = true;
      } else {
        // Mois courant : seul cas où on utilise le calcul temps réel
        revHT = currentRev.totalHT;
        charges = currentCharges;
      }
      const benef = revHT - charges;
      const marge = revHT > 0 ? (benef / revHT) * 100 : 0;
      months.push({ ym, revHT, charges, benef, marge, frozen, isCurrent, isFuture, noData });
    }
    return months;
  }

  /* ─── Graphique d'évolution mensuelle (SVG pur, zéro dépendance) ─── */
  function _renderChart(currentRev, currentCharges) {
    const series = _buildMonthlySeries(currentRev, currentCharges);
    // ⚡ "visible" = mois avec données affichables (= ni futur, ni noData).
    //   Si aucun mois exploitable (ex: année passée sans aucun snapshot),
    //   on affiche un placeholder explicatif plutôt que des barres vides
    //   ou trompeuses.
    const visible = series.filter(m => !m.isFuture && !m.noData);

    if (!visible.length) {
      const yearLbl = STATE.selectedYear;
      const isCurrentYear = yearLbl === new Date().getFullYear();
      return `<div class="cmpt-chart-empty">${
        isCurrentYear
          ? 'Aucune donnée disponible pour cette année.'
          : `Aucune donnée historique pour ${yearLbl}. Utilisez le bouton 🔒 dans le tableau ci-dessous pour saisir rétroactivement les chiffres si vous les connaissez.`
      }</div>`;
    }

    // Dimensions SVG
    const W = 760;     // viewBox width
    const H = 280;     // viewBox height
    const PAD = { top: 24, right: 24, bottom: 48, left: 64 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    // Échelle Y : max entre toutes les valeurs (recettes, charges, |bénéfice|)
    let yMax = 0;
    series.forEach(m => {
      yMax = Math.max(yMax, m.revHT, m.charges, Math.abs(m.benef));
    });
    if (yMax === 0) yMax = 100; // évite division par zéro
    // Arrondir au multiple de 100 supérieur pour avoir des graduations propres
    yMax = Math.ceil(yMax / 100) * 100;

    const monthW = innerW / 12;
    const barW = Math.min(20, monthW * 0.30);
    const barGap = 2;

    const x = i => PAD.left + i * monthW + monthW / 2;
    const y = v => PAD.top + innerH - (v / yMax) * innerH;

    // Mois courts FR
    const monthsLbl = ['J','F','M','A','M','J','J','A','S','O','N','D'];

    // Graduation Y (5 ticks)
    const yTicks = [];
    for (let i = 0; i <= 5; i++) {
      const v = (yMax * i) / 5;
      yTicks.push({ v, y: y(v) });
    }

    // Couleurs (cohérentes avec l'app)
    const C_REV = '#4fa8ff';   // var(--a2)
    const C_CHG = '#ffb547';   // var(--w)
    const C_BEN = '#00d4aa';   // var(--a)
    const C_NEG = '#ff5f6d';   // var(--d)

    // Barres : recettes (gauche), charges (droite).
    // ⚡ Skip futurs ET noData : pas de barre pour ces mois (juste le label X).
    const barsHTML = series.map((m, i) => {
      if (m.isFuture || m.noData) return '';
      const cx = x(i);
      const xRev = cx - barW - barGap/2;
      const xChg = cx + barGap/2;
      const yRev = y(m.revHT);
      const yChg = y(m.charges);
      const hRev = (PAD.top + innerH) - yRev;
      const hChg = (PAD.top + innerH) - yChg;
      const opacity = m.isCurrent ? '1' : (m.frozen ? '0.95' : '0.85');
      return `
        <g class="cmpt-bar-g" data-i="${i}">
          <rect x="${xRev}" y="${yRev}" width="${barW}" height="${hRev}" fill="${C_REV}" opacity="${opacity}" rx="2">
            <title>${_ymLabel(m.ym)} — Recettes : ${_eur(m.revHT)}</title>
          </rect>
          <rect x="${xChg}" y="${yChg}" width="${barW}" height="${hChg}" fill="${C_CHG}" opacity="${opacity}" rx="2">
            <title>${_ymLabel(m.ym)} — Charges : ${_eur(m.charges)}</title>
          </rect>
        </g>`;
    }).join('');

    // Courbe bénéfice (uniquement sur mois visibles)
    const linePoints = visible.map((m, i) => {
      const idx = series.indexOf(m);
      return `${x(idx)},${y(Math.max(0, m.benef))}`;
    }).join(' ');

    // Points cliquables sur la courbe
    const linePts = visible.map(m => {
      const idx = series.indexOf(m);
      const cx = x(idx);
      const cy = y(Math.max(0, m.benef));
      const color = m.benef >= 0 ? C_BEN : C_NEG;
      return `
        <circle cx="${cx}" cy="${cy}" r="4" fill="${color}" stroke="var(--bg)" stroke-width="2" class="cmpt-line-pt">
          <title>${_ymLabel(m.ym)} — Bénéfice : ${_eur(m.benef)} (marge ${_pct(m.marge)})</title>
        </circle>`;
    }).join('');

    // Graduations Y
    const ticksHTML = yTicks.map(t => `
      <g>
        <line x1="${PAD.left}" y1="${t.y}" x2="${W - PAD.right}" y2="${t.y}" stroke="var(--b)" stroke-width="1" opacity="0.4" stroke-dasharray="2,3"/>
        <text x="${PAD.left - 8}" y="${t.y + 4}" text-anchor="end" font-family="DM Mono, monospace" font-size="10" fill="var(--m)">
          ${t.v >= 1000 ? (t.v/1000).toFixed(1) + 'k' : t.v.toFixed(0)} €
        </text>
      </g>`).join('');

    // Labels mois (axe X)
    const xLabelsHTML = series.map((m, i) => {
      const cx = x(i);
      const fontWeight = m.isCurrent ? '700' : '400';
      // ⚡ noData et isFuture sont traités pareil visuellement (gris, opacité réduite)
      const dimmed = m.isFuture || m.noData;
      const color = m.isCurrent ? 'var(--a)' : (dimmed ? 'var(--m)' : 'var(--t)');
      const opacity = dimmed ? '0.4' : '1';
      return `
        <text x="${cx}" y="${H - PAD.bottom + 18}" text-anchor="middle"
              font-family="DM Mono, monospace" font-size="11"
              font-weight="${fontWeight}" fill="${color}" opacity="${opacity}">
          ${monthsLbl[i]}
        </text>`;
    }).join('');

    // Annotation "auj." sur mois courant
    const nowIdx = series.findIndex(m => m.isCurrent);
    const nowMarker = nowIdx >= 0 ? `
      <line x1="${x(nowIdx)}" y1="${PAD.top}" x2="${x(nowIdx)}" y2="${H - PAD.bottom}"
            stroke="var(--a)" stroke-width="1" opacity="0.25" stroke-dasharray="3,3"/>
      <text x="${x(nowIdx)}" y="${PAD.top - 6}" text-anchor="middle"
            font-family="DM Mono, monospace" font-size="9" fill="var(--a)" font-weight="700">
        AUJOURD'HUI
      </text>` : '';

    // Marqueurs "figé"
    const frozenMarkers = series.map((m, i) => {
      if (!m.frozen) return '';
      return `<text x="${x(i)}" y="${PAD.top + 12}" text-anchor="middle" font-size="10" opacity="0.7">🔒</text>`;
    }).join('');

    return `
      <div class="cmpt-chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="cmpt-chart-svg" preserveAspectRatio="xMidYMid meet">
          <!-- Graduations -->
          ${ticksHTML}

          <!-- Marqueur "aujourd'hui" -->
          ${nowMarker}

          <!-- Barres recettes / charges -->
          ${barsHTML}

          <!-- Marqueurs figé -->
          ${frozenMarkers}

          <!-- Courbe bénéfice (uniquement sur mois passés/courants) -->
          ${linePoints ? `<polyline points="${linePoints}" fill="none" stroke="${C_BEN}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>` : ''}

          <!-- Points -->
          ${linePts}

          <!-- Labels axe X -->
          ${xLabelsHTML}
        </svg>
        <div class="cmpt-chart-foot">
          ${_chartSummary(visible)}
        </div>
      </div>
    `;
  }

  /* ─── Synthèse sous le graphique : moyenne / meilleur mois / pire mois ─── */
  function _chartSummary(visible) {
    if (!visible.length) return '';
    const totalRev = visible.reduce((s,m)=>s+m.revHT, 0);
    const totalChg = visible.reduce((s,m)=>s+m.charges, 0);
    const totalBen = totalRev - totalChg;
    const avgBen = totalBen / visible.length;
    const best = visible.reduce((a,b)=>b.benef>a.benef?b:a, visible[0]);
    const worst = visible.reduce((a,b)=>b.benef<a.benef?b:a, visible[0]);
    // ⚡ Tendance : compare le PREMIER mois exploitable au DERNIER mois exploitable
    //   (avant le fix, "vs janvier" était hardcodé alors qu'on n'avait pas
    //   forcément de données en janvier — affichage incohérent).
    const firstYM = visible[0].ym;
    const lastYM  = visible[visible.length-1].ym;
    const trend = visible.length >= 2
      ? visible[visible.length-1].benef - visible[0].benef
      : 0;
    const trendArrow = trend > 0 ? '↗' : (trend < 0 ? '↘' : '→');
    const trendColor = trend > 0 ? 'var(--a)' : (trend < 0 ? 'var(--d)' : 'var(--m)');
    // Label tendance : "vs <premier mois>" si > 1 mois, sinon "donnée unique"
    const trendSubLabel = visible.length >= 2
      ? `vs ${_ymLabel(firstYM).toLowerCase().split(' ')[0]}`  // ex: "vs mai"
      : 'donnée unique';

    return `
      <div class="cmpt-chart-stats">
        <div class="cmpt-chart-stat">
          <div class="cmpt-chart-stat-lbl">Bénéfice moyen / mois</div>
          <div class="cmpt-chart-stat-val ${avgBen>=0?'cmpt-pos':'cmpt-neg'}">${_eur(avgBen)}</div>
          <div class="cmpt-chart-stat-sub">sur ${visible.length} mois</div>
        </div>
        <div class="cmpt-chart-stat">
          <div class="cmpt-chart-stat-lbl">Meilleur mois</div>
          <div class="cmpt-chart-stat-val cmpt-pos">${_eur(best.benef)}</div>
          <div class="cmpt-chart-stat-sub">${_ymLabel(best.ym)}</div>
        </div>
        <div class="cmpt-chart-stat">
          <div class="cmpt-chart-stat-lbl">Plus faible</div>
          <div class="cmpt-chart-stat-val ${worst.benef>=0?'cmpt-pos':'cmpt-neg'}">${_eur(worst.benef)}</div>
          <div class="cmpt-chart-stat-sub">${_ymLabel(worst.ym)}</div>
        </div>
        <div class="cmpt-chart-stat">
          <div class="cmpt-chart-stat-lbl">Tendance</div>
          <div class="cmpt-chart-stat-val" style="color:${trendColor}">${trendArrow} ${_eur(Math.abs(trend))}</div>
          <div class="cmpt-chart-stat-sub">${trendSubLabel}</div>
        </div>
      </div>
    `;
  }

  /* ─── Tableau annuel ─── */
  function _renderAnnualTable(currentRev, currentCharges) {
    const months = _buildMonthlySeries(currentRev, currentCharges);

    const body = months.map(m => {
      // ⚡ "Pas de données affichables" = soit futur, soit passé sans snapshot
      const noShow = m.isFuture || m.noData;

      let actionBtn = '';
      if (m.isFuture) {
        actionBtn = '<span class="cmpt-mut">—</span>';
      } else if (m.frozen) {
        actionBtn = `<button class="cmpt-icon-btn" title="Dégeler ce mois" onclick="AdmCompta.unfreezeMonth('${m.ym}')">🔓</button>`;
      } else if (m.noData) {
        // Mois passé sans données : permettre de figer rétroactivement si l'admin
        // a les vrais chiffres (sera rempli avec snapshot.revHT/charges manuels)
        actionBtn = `<button class="cmpt-icon-btn" title="Saisir et figer rétroactivement les chiffres de ce mois" onclick="AdmCompta.freezeMonth('${m.ym}')" style="opacity:.6">🔒</button>`;
      } else {
        actionBtn = `<button class="cmpt-icon-btn" title="Figer ce mois (snapshot)" onclick="AdmCompta.freezeMonth('${m.ym}')">🔒</button>`;
      }
      const exportBtn = noShow ? '' :
        `<button class="cmpt-icon-btn" title="Exporter PDF de ce mois" onclick="AdmCompta.exportPDF('${m.ym}')">📄</button>`;

      const rowClass = [
        m.isCurrent ? 'cmpt-row-current' : '',
        m.frozen    ? 'cmpt-row-frozen'  : '',
        m.isFuture  ? 'cmpt-row-future'  : '',
        m.noData    ? 'cmpt-row-nodata'  : '',
        // Marge positive/négative seulement pour les mois avec données
        !noShow && m.benef >= 0 ? 'cmpt-row-pos' : (!noShow ? 'cmpt-row-neg' : '')
      ].filter(Boolean).join(' ');

      // Libellé "no data" avec tooltip discret (en plus du badge)
      const labelExtra = m.isCurrent
        ? ' <span class="cmpt-tag-now">en cours</span>'
        : m.frozen
          ? ' <span class="cmpt-tag-frozen">🔒 figé</span>'
          : m.noData
            ? ' <span class="cmpt-tag-nodata" title="Aucune donnée historique pour ce mois. Cliquez sur 🔒 pour saisir les chiffres rétroactivement si vous les connaissez.">aucune donnée</span>'
            : '';

      return `
        <tr class="${rowClass}">
          <td>${_ymLabel(m.ym)}${labelExtra}</td>
          <td class="cmpt-num">${noShow ? '<span class="cmpt-mut">—</span>' : _eur(m.revHT)}</td>
          <td class="cmpt-num">${noShow ? '<span class="cmpt-mut">—</span>' : _eur(m.charges)}</td>
          <td class="cmpt-num cmpt-strong ${noShow ? '' : (m.benef>=0?'cmpt-pos':'cmpt-neg')}">${noShow ? '<span class="cmpt-mut">—</span>' : _eur(m.benef)}</td>
          <td class="cmpt-num">${noShow ? '<span class="cmpt-mut">—</span>' : _pct(m.marge)}</td>
          <td class="cmpt-num">${actionBtn} ${exportBtn}</td>
        </tr>`;
    }).join('');

    // ⚡ Totaux : EXCLURE les mois sans données (futurs OU passés sans snapshot)
    //   Avant le fix, le total était faussé par les fausses valeurs des mois passés.
    const totRev = months.reduce((s,m)=>s+(m.isFuture||m.noData?0:m.revHT), 0);
    const totChg = months.reduce((s,m)=>s+(m.isFuture||m.noData?0:m.charges), 0);
    const totBen = totRev - totChg;
    const totMar = totRev > 0 ? (totBen/totRev)*100 : 0;
    // Compteur de mois avec vraies données (pour clarifier le total)
    const realMonths = months.filter(m => !m.isFuture && !m.noData).length;

    return `
      <table class="cmpt-table cmpt-table-annual">
        <thead>
          <tr>
            <th>Mois</th>
            <th class="cmpt-num">Recettes HT</th>
            <th class="cmpt-num">Charges</th>
            <th class="cmpt-num">Bénéfice HT</th>
            <th class="cmpt-num">Marge</th>
            <th class="cmpt-num">Actions</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr class="cmpt-foot-total">
            <td><strong>Total ${STATE.selectedYear}</strong>${realMonths < 12 ? ` <span class="cmpt-mut" style="font-size:11px;font-weight:400" title="Calculé sur ${realMonths} mois disposant de données réelles ou figées. Les mois 'aucune donnée' sont exclus.">(${realMonths} mois)</span>` : ''}</td>
            <td class="cmpt-num cmpt-strong">${_eur(totRev)}</td>
            <td class="cmpt-num cmpt-strong">${_eur(totChg)}</td>
            <td class="cmpt-num cmpt-strong ${totBen>=0?'cmpt-pos':'cmpt-neg'}">${_eur(totBen)}</td>
            <td class="cmpt-num cmpt-strong">${_pct(totMar)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /* ═════════════════════════════════════════════════════════════════
     8. ACTIONS UI (handlers)
  ═════════════════════════════════════════════════════════════════ */
  function _editCharge(idx, field, value) {
    if (!STATE.charges[idx]) return;
    if (field === 'amount') {
      STATE.charges[idx].amount = Math.max(0, Number(value) || 0);
    } else {
      STATE.charges[idx][field] = String(value);
    }
    // ✅ Mise à jour ciblée : on touche UNIQUEMENT le total des charges + KPIs + footer.
    //    On NE re-rend PAS l'éditeur (sinon l'input perd le focus à chaque frappe).
    _refreshChargesDependents();
  }

  function _addCharge() {
    STATE.charges = STATE.charges || [];
    STATE.charges.push({ id: 'c'+Date.now(), label: 'Nouvelle charge', amount: 0, recurrent: true });
    _render();
  }

  function _delCharge(idx) {
    if (!STATE.charges[idx]) return;
    if (!confirm('Supprimer la charge « ' + (STATE.charges[idx].label || '') + ' » ?')) return;
    STATE.charges.splice(idx, 1);
    _render();
  }

  /**
   * Met à jour en place uniquement les éléments qui dépendent du total des charges :
   *  - KPI "Charges fixes"
   *  - KPI "Bénéfice"
   *  - Total en bas du tableau d'édition des charges
   *  - Tableau annuel + graphique d'évolution
   * SANS toucher aux <input> de l'éditeur (pour préserver le focus pendant la frappe).
   */
  function _refreshChargesDependents() {
    const root = document.getElementById('adm-compta-root');
    if (!root) return;
    const rev      = _computeRevenue(STATE.subs, STATE.prices, STATE.vatRate);
    const chTotal  = _chargesTotal(STATE.charges);
    const benefHT  = Math.round((rev.totalHT - chTotal) * 100) / 100;
    const margePct = rev.totalHT > 0 ? (benefHT / rev.totalHT) * 100 : 0;

    // KPI charges
    const kpiChg = root.querySelector('.cmpt-kpi-chg');
    if (kpiChg) {
      const valEl = kpiChg.querySelector('.cmpt-kpi-val');
      const subEl = kpiChg.querySelector('.cmpt-kpi-sub');
      if (valEl) valEl.textContent = _eur(chTotal);
      if (subEl) subEl.textContent = `${(STATE.charges||[]).filter(c=>c.amount>0).length} poste(s) actif(s)`;
    }

    // KPI bénéfice
    const kpiBen = root.querySelector('.cmpt-kpi-benef');
    if (kpiBen) {
      kpiBen.classList.remove('positive', 'negative');
      kpiBen.classList.add(benefHT >= 0 ? 'positive' : 'negative');
      const iconEl = kpiBen.querySelector('.cmpt-kpi-icon');
      const valEl  = kpiBen.querySelector('.cmpt-kpi-val');
      const subEl  = kpiBen.querySelector('.cmpt-kpi-sub');
      if (iconEl) iconEl.textContent = benefHT >= 0 ? '📈' : '📉';
      if (valEl)  valEl.textContent  = _eur(benefHT);
      if (subEl)  subEl.textContent  = `Marge : ${_pct(margePct)}`;
    }

    // Total en bas du tableau d'édition des charges (sans toucher aux <tr> au-dessus = inputs préservés)
    const chgTfoot = root.querySelector('.cmpt-table-edit tfoot .cmpt-strong');
    if (chgTfoot) chgTfoot.textContent = _eur(chTotal);

    // Tableau annuel : remplacer juste son contenu (il n'a pas d'input)
    // On le retrouve par sa classe spécifique pour ne pas confondre avec les autres tables.
    const annualTbl = root.querySelector('.cmpt-table-annual');
    if (annualTbl && annualTbl.parentElement) {
      const wrap = document.createElement('div');
      wrap.innerHTML = _renderAnnualTable(rev, chTotal);
      const newTbl = wrap.querySelector('.cmpt-table-annual');
      if (newTbl) annualTbl.replaceWith(newTbl);
    }

    // Graphique d'évolution : remplacer le wrapper SVG (pas d'input à l'intérieur)
    const chartWrap = root.querySelector('.cmpt-chart-wrap');
    if (chartWrap && chartWrap.parentElement) {
      const wrap = document.createElement('div');
      wrap.innerHTML = _renderChart(rev, chTotal);
      const newChart = wrap.querySelector('.cmpt-chart-wrap');
      if (newChart) chartWrap.replaceWith(newChart);
    }
  }

  // Compatibilité ascendante (au cas où d'autres fonctions appellent encore l'ancien nom)
  function _renderQuickRefresh() {
    _refreshChargesDependents();
  }

  function _setVAT(v) {
    STATE.vatRate = Math.max(0, Math.min(50, Number(v) || 0));
    _render();
  }

  function _setYear(y) {
    STATE.selectedYear = Number(y) || new Date().getUTCFullYear();
    _render();
  }

  function _togglePriceEdit() {
    const html = `
      <div class="cmpt-modal-body">
        <p class="cmpt-modal-intro">Tarifs HT par défaut. Modifiez si vos prix Stripe diffèrent. Les prix sont enregistrés avec le bouton « Enregistrer » de la section Charges fixes.</p>
        ${_priceEditRow('ESSENTIEL', 'Essentiel')}
        ${_priceEditRow('PRO', 'Pro')}
        ${_priceEditRow('CABINET_1_2', 'Cabinet · 1-2 IDE')}
        ${_priceEditRow('CABINET_3_5', 'Cabinet · 3-5 IDE')}
        ${_priceEditRow('CABINET_6P', 'Cabinet · 6+ IDE')}
        ${_priceEditRow('PREMIUM', 'Premium (add-on)')}
        ${_priceEditRow('COMPTABLE', 'AMI Comptable')}
      </div>
      <div class="cmpt-modal-foot">
        <button class="cmpt-btn cmpt-btn-ghost" onclick="AdmCompta._closeModal()">Fermer</button>
        <button class="cmpt-btn cmpt-btn-primary" onclick="AdmCompta._closeModal();AdmCompta.saveCharges()">💾 Enregistrer prix</button>
      </div>
    `;
    _openModal('💎 Tarifs des abonnements (HT)', html);
  }

  function _priceEditRow(key, label) {
    const v = (STATE.prices && STATE.prices[key] != null) ? STATE.prices[key] : DEFAULT_TIER_PRICES[key];
    return `
      <div class="cmpt-price-row">
        <label>${_esc(label)}</label>
        <input type="number" step="1" min="0" value="${v}"
               oninput="AdmCompta._setPrice('${key}', this.value)" class="cmpt-input cmpt-input-num"> €
      </div>`;
  }

  function _setPrice(key, v) {
    STATE.prices = STATE.prices || { ...DEFAULT_TIER_PRICES };
    STATE.prices[key] = Math.max(0, Number(v) || 0);
  }

  /* ─── Modal helpers ─── */
  function _openModal(title, contentHTML) {
    let m = document.getElementById('cmpt-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cmpt-modal';
      m.className = 'cmpt-modal-back';
      document.body.appendChild(m);
    }
    m.innerHTML = `
      <div class="cmpt-modal" onclick="event.stopPropagation()">
        <div class="cmpt-modal-head">
          <div class="cmpt-modal-title">${_esc(title)}</div>
          <button class="cmpt-modal-x" onclick="AdmCompta._closeModal()">✕</button>
        </div>
        ${contentHTML}
      </div>
    `;
    m.style.display = 'flex';
    m.onclick = _closeModal;
  }
  function _closeModal() {
    const m = document.getElementById('cmpt-modal');
    if (m) m.style.display = 'none';
  }

  /* ═════════════════════════════════════════════════════════════════
     9. SNAPSHOT MENSUEL (figer un mois)
  ═════════════════════════════════════════════════════════════════ */
  async function freezeMonth(ym) {
    if (!ym) ym = _ymNow();
    if (!confirm(`Figer la comptabilité de ${_ymLabel(ym)} ? Les chiffres ne bougeront plus, même si des abonnements évoluent.`)) return;
    const rev = _computeRevenue(STATE.subs, STATE.prices, STATE.vatRate);
    const ch  = _chargesTotal(STATE.charges);
    STATE.snapshots[ym] = {
      ym,
      frozen:  true,
      frozenAt: new Date().toISOString(),
      revHT:   rev.totalHT,
      revTVA:  rev.totalTVA,
      revTTC:  rev.totalTTC,
      vatRate: STATE.vatRate,
      charges: ch,
      chargesDetail: JSON.parse(JSON.stringify(STATE.charges || [])),
      revDetail: JSON.parse(JSON.stringify(rev.byTier))
    };
    await _saveCharges();
    _toast(`✅ ${_ymLabel(ym)} figé`, 'o');
    _render();
  }

  async function unfreezeMonth(ym) {
    if (!ym) return;
    if (!confirm(`Dégeler ${_ymLabel(ym)} ? Les chiffres redeviendront calculés en temps réel.`)) return;
    delete STATE.snapshots[ym];
    await _saveCharges();
    _toast(`🔓 ${_ymLabel(ym)} dégelé`, 'o');
    _render();
  }

  async function saveCharges() {
    const where = await _saveCharges();
    _toast(where === 'server' ? '✅ Enregistré (serveur)' : '✅ Enregistré (local)', 'o');
    _render();
  }

  /* ═════════════════════════════════════════════════════════════════
     10. EXPORT PDF (impression A4) — prêt à signer
  ═════════════════════════════════════════════════════════════════ */
  function exportPDF(ym) {
    if (!ym) ym = STATE.selectedMonth;
    const snap = STATE.snapshots[ym];
    let revHT, revTVA, revTTC, charges, chargesDetail, revDetail, vatRate, frozenAt;
    if (snap && snap.frozen) {
      revHT = snap.revHT; revTVA = snap.revTVA; revTTC = snap.revTTC;
      charges = snap.charges; chargesDetail = snap.chargesDetail;
      revDetail = snap.revDetail; vatRate = snap.vatRate; frozenAt = snap.frozenAt;
    } else {
      const rev = _computeRevenue(STATE.subs, STATE.prices, STATE.vatRate);
      revHT = rev.totalHT; revTVA = rev.totalTVA; revTTC = rev.totalTTC;
      charges = _chargesTotal(STATE.charges);
      chargesDetail = STATE.charges || [];
      revDetail = rev.byTier;
      vatRate = STATE.vatRate;
      frozenAt = null;
    }
    const benef = revHT - charges;

    const tierRows = [
      { key:'ESSENTIEL', label:'Essentiel' },
      { key:'PRO',       label:'Pro' },
      { key:'CABINET',   label:'Cabinet' },
      { key:'PREMIUM',   label:'Premium (add-on)' },
      { key:'COMPTABLE', label:'AMI Comptable' }
    ].map(r => {
      const d = revDetail[r.key] || { count:0, total:0 };
      return `<tr><td>${r.label}</td><td class="r">${d.count}</td><td class="r">${_eur(d.total)}</td></tr>`;
    }).join('');

    const chgRows = (chargesDetail || []).filter(c => Number(c.amount) > 0)
      .map(c => `<tr><td>${_esc(c.label)}</td><td class="r">${_eur(c.amount)}</td></tr>`).join('')
      || `<tr><td colspan="2" class="muted">Aucune charge enregistrée</td></tr>`;

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) { _toast('⚠️ Impossible d\'ouvrir la fenêtre — autorisez les popups.', 'e'); return; }

    win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Comptabilité AMI-NGAP — ${_ymLabel(ym)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.55; margin: 0; padding: 0; font-size: 11pt; }
  .doc { max-width: 800px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #00a085; padding-bottom: 12px; margin-bottom: 22px; }
  .head h1 { font-family: 'Georgia', serif; font-size: 22pt; margin: 0 0 4px; color: #00a085; font-weight: 600; }
  .head .sub { font-size: 10pt; color: #666; }
  .head .meta { text-align: right; font-size: 9.5pt; color: #555; }
  .head .meta strong { color: #1a1a1a; }
  h2 { font-family: 'Georgia', serif; font-size: 14pt; margin: 28px 0 10px; color: #1a1a1a; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10.5pt; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e8e8e8; }
  th { background: #f6faf9; font-weight: 600; color: #00604a; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.5px; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 2px solid #00a085; border-bottom: none; font-weight: 700; padding-top: 10px; }
  .total-line { background: #f6faf9; padding: 12px 14px; margin-top: 4px; font-size: 12pt; font-weight: 700; display: flex; justify-content: space-between; border-radius: 4px; }
  .total-line.benef { background: ${benef >= 0 ? '#e6f7f0' : '#ffe9eb'}; color: ${benef >= 0 ? '#00604a' : '#a8181c'}; font-size: 13pt; margin-top: 8px; border: 1px solid ${benef >= 0 ? '#b9e3d2' : '#f5b7b9'}; }
  .muted { color: #888; font-style: italic; }
  .frozen-badge { display: inline-block; background: #00a085; color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 9pt; margin-left: 8px; font-weight: 600; }
  .estim-badge { display: inline-block; background: #ffb547; color: #4a3000; padding: 2px 10px; border-radius: 12px; font-size: 9pt; margin-left: 8px; font-weight: 600; }
  .signature { margin-top: 50px; padding-top: 24px; border-top: 1px dashed #999; display: flex; justify-content: space-between; gap: 40px; }
  .sig-block { flex: 1; }
  .sig-block .lbl { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .sig-block .line { border-bottom: 1px solid #333; height: 70px; margin-top: 8px; }
  .sig-block .name { font-size: 9pt; color: #555; margin-top: 6px; font-style: italic; }
  .footer { margin-top: 40px; font-size: 8.5pt; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
  @media print {
    .no-print { display: none !important; }
    body { font-size: 10.5pt; }
  }
  .actions { margin-bottom: 20px; padding: 14px; background: #f4f8f7; border-radius: 6px; display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .actions button { background: #00a085; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 11pt; font-weight: 600; }
  .actions button:hover { background: #007d65; }
  .actions .hint { font-size: 9.5pt; color: #555; }
</style></head><body><div class="doc">

  <div class="actions no-print">
    <span class="hint">📄 Document prêt à imprimer ou enregistrer en PDF (Ctrl+P / Cmd+P).</span>
    <button onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
  </div>

  <div class="head">
    <div>
      <h1>Comptabilité AMI-NGAP</h1>
      <div class="sub">Récapitulatif mensuel — ${_ymLabel(ym)}${snap && snap.frozen ? '<span class="frozen-badge">🔒 Figé</span>' : '<span class="estim-badge">⚠️ Estimation</span>'}</div>
    </div>
    <div class="meta">
      <strong>AMI-NGAP</strong><br>
      Application de cotation infirmière<br>
      Édité le : ${_todayFR()}<br>
      ${frozenAt ? 'Figé le : ' + new Date(frozenAt).toLocaleDateString('fr-FR') : ''}
    </div>
  </div>

  <h2>1. Recettes — Abonnements actifs</h2>
  <table>
    <thead><tr><th>Offre</th><th class="r">Comptes actifs</th><th class="r">Sous-total HT</th></tr></thead>
    <tbody>${tierRows}</tbody>
    <tfoot>
      <tr><td><strong>Total recettes HT</strong></td><td class="r"></td><td class="r">${_eur(revHT)}</td></tr>
    </tfoot>
  </table>
  <table>
    <tbody>
      <tr><td>TVA collectée (${vatRate} %)</td><td class="r">${_eur(revTVA)}</td></tr>
      <tr><td><strong>Total recettes TTC</strong></td><td class="r"><strong>${_eur(revTTC)}</strong></td></tr>
    </tbody>
  </table>

  <h2>2. Charges fixes</h2>
  <table>
    <thead><tr><th>Poste</th><th class="r">Montant € / mois</th></tr></thead>
    <tbody>${chgRows}</tbody>
    <tfoot>
      <tr><td><strong>Total charges</strong></td><td class="r">${_eur(charges)}</td></tr>
    </tfoot>
  </table>

  <h2>3. Résultat</h2>
  <div class="total-line">
    <span>Recettes HT</span><span>${_eur(revHT)}</span>
  </div>
  <div class="total-line">
    <span>− Charges fixes</span><span>${_eur(charges)}</span>
  </div>
  <div class="total-line benef">
    <span>= Bénéfice ${benef >= 0 ? 'net' : 'négatif'} HT</span><span>${_eur(benef)}</span>
  </div>

  <div class="signature">
    <div class="sig-block">
      <div class="lbl">Édité par</div>
      <div class="name">Direction AMI-NGAP</div>
      <div class="line"></div>
      <div class="name">Date · Signature</div>
    </div>
    <div class="sig-block">
      <div class="lbl">Visa de l'expert-comptable</div>
      <div class="name">Cabinet comptable</div>
      <div class="line"></div>
      <div class="name">Date · Signature et cachet</div>
    </div>
  </div>

  <div class="footer">
    Document généré automatiquement par AMI-NGAP · ${_todayFR()}<br>
    ${snap && snap.frozen ? 'Mois figé : chiffres définitifs.' : 'Mois en cours : chiffres susceptibles d\'évoluer jusqu\'à clôture.'}
  </div>

</div></body></html>`);
    win.document.close();
    setTimeout(() => { try { win.focus(); } catch(_){} }, 200);
  }

  /* ═════════════════════════════════════════════════════════════════
     11. EXPORT CSV (année complète)
  ═════════════════════════════════════════════════════════════════ */
  function exportCSV(year) {
    year = year || STATE.selectedYear;
    const rev = _computeRevenue(STATE.subs, STATE.prices, STATE.vatRate);
    const chTotal = _chargesTotal(STATE.charges);
    const nowYM = _ymNow();

    const sep = ';'; // standard fr (Excel)
    const lines = [];
    lines.push(['Mois', 'Statut', 'Recettes HT', 'TVA', 'Recettes TTC', 'Charges fixes', 'Bénéfice HT', 'Marge %'].join(sep));

    let totRev = 0, totTVA = 0, totTTC = 0, totChg = 0;
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2,'0')}`;
      const snap = STATE.snapshots[ym];
      const isFuture = ym > nowYM;
      let revHT, revTVA, revTTC, ch, statut;
      if (snap && snap.frozen) {
        revHT = snap.revHT; revTVA = snap.revTVA; revTTC = snap.revTTC; ch = snap.charges;
        statut = 'Figé';
      } else if (isFuture) {
        revHT = 0; revTVA = 0; revTTC = 0; ch = 0; statut = 'À venir';
      } else {
        revHT = rev.totalHT; revTVA = rev.totalTVA; revTTC = rev.totalTTC; ch = chTotal;
        statut = (ym === nowYM) ? 'En cours' : 'Estimation';
      }
      const benef = revHT - ch;
      const marge = revHT > 0 ? (benef/revHT)*100 : 0;
      lines.push([
        _ymLabel(ym),
        statut,
        revHT.toFixed(2).replace('.', ','),
        revTVA.toFixed(2).replace('.', ','),
        revTTC.toFixed(2).replace('.', ','),
        ch.toFixed(2).replace('.', ','),
        benef.toFixed(2).replace('.', ','),
        marge.toFixed(1).replace('.', ',')
      ].join(sep));
      if (!isFuture) { totRev += revHT; totTVA += revTVA; totTTC += revTTC; totChg += ch; }
    }
    const totBen = totRev - totChg;
    const totMar = totRev > 0 ? (totBen/totRev)*100 : 0;
    lines.push(['', '', '', '', '', '', '', ''].join(sep));
    lines.push([
      `Total ${year}`,
      '',
      totRev.toFixed(2).replace('.', ','),
      totTVA.toFixed(2).replace('.', ','),
      totTTC.toFixed(2).replace('.', ','),
      totChg.toFixed(2).replace('.', ','),
      totBen.toFixed(2).replace('.', ','),
      totMar.toFixed(1).replace('.', ',')
    ].join(sep));

    const bom = '\uFEFF'; // UTF-8 BOM pour Excel
    const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ami-ngap-comptabilite-${year}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    _toast(`✅ CSV ${year} exporté`, 'o');
  }

  /* ═════════════════════════════════════════════════════════════════
     12. STYLES (injectés une fois)
  ═════════════════════════════════════════════════════════════════ */
  let _stylesInjected = false;
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = `
      .cmpt-wrap { font-family: var(--ff); }
      .cmpt-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
      .cmpt-h1 { font-family: var(--fs); font-size: 26px; margin: 0; color: var(--t); }
      .cmpt-h1 em { font-style: italic; color: var(--a); }
      .cmpt-sub { color: var(--m); font-size: 12px; margin-top: 4px; max-width: 540px; line-height: 1.5; }
      .cmpt-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }

      .cmpt-mode-badge { display: inline-block; padding: 7px 14px; border-radius: 8px; font-size: 12px; font-family: var(--fm); margin-bottom: 18px; letter-spacing: .3px; }
      .cmpt-mode-test { background: rgba(255,181,71,.10); color: var(--w); border: 1px solid rgba(255,181,71,.3); }
      .cmpt-mode-payant { background: rgba(0,212,170,.10); color: var(--a); border: 1px solid rgba(0,212,170,.3); }

      .cmpt-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 26px; }
      .cmpt-kpi { background: var(--s); border: 1px solid var(--b); border-radius: 12px; padding: 18px 16px; position: relative; transition: transform .15s, border-color .15s; }
      .cmpt-kpi:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.15); }
      .cmpt-kpi-icon { font-size: 22px; margin-bottom: 6px; opacity: .85; }
      .cmpt-kpi-label { font-family: var(--fm); font-size: 10px; color: var(--m); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 6px; }
      .cmpt-kpi-val { font-family: var(--fs); font-size: 28px; line-height: 1.1; color: var(--t); }
      .cmpt-kpi-sub { font-family: var(--fm); font-size: 11px; color: var(--m); margin-top: 4px; }
      .cmpt-kpi-rev .cmpt-kpi-val { color: var(--a2); }
      .cmpt-kpi-chg .cmpt-kpi-val { color: var(--w); }
      .cmpt-kpi-benef.positive .cmpt-kpi-val { color: var(--a); }
      .cmpt-kpi-benef.negative .cmpt-kpi-val { color: var(--d); }

      .cmpt-section { background: var(--s); border: 1px solid var(--b); border-radius: 12px; padding: 18px 18px 10px; margin-bottom: 18px; }
      .cmpt-section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--b); }
      .cmpt-section-title { font-family: var(--fs); font-size: 17px; color: var(--t); }
      .cmpt-section-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

      .cmpt-tva-label { font-family: var(--fm); font-size: 11px; color: var(--m); display: inline-flex; align-items: center; gap: 6px; }
      .cmpt-tva-input { width: 60px; padding: 5px 8px; background: var(--bg); border: 1px solid var(--b); border-radius: 6px; color: var(--t); font-family: var(--fm); font-size: 12px; text-align: right; }
      .cmpt-tva-input:focus { outline: none; border-color: var(--a); }

      .cmpt-table { width: 100%; border-collapse: collapse; }
      .cmpt-table th, .cmpt-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--b); font-size: 13px; vertical-align: middle; }
      .cmpt-table th { font-family: var(--fm); font-size: 10px; color: var(--m); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
      .cmpt-table tbody tr { transition: background .12s; }
      .cmpt-table tbody tr:hover { background: rgba(255,255,255,.02); }
      .cmpt-num { text-align: right; font-family: var(--fm); font-variant-numeric: tabular-nums; }
      .cmpt-strong { color: var(--t); font-weight: 600; }
      .cmpt-mut { color: var(--m); font-style: italic; font-family: var(--fm); font-size: 11px; }
      .cmpt-ttc { color: var(--a); font-size: 14px; }
      .cmpt-pos { color: var(--a); }
      .cmpt-neg { color: var(--d); }

      .cmpt-foot-row td { border-bottom: none; padding-top: 12px; }
      .cmpt-foot-vat td { color: var(--m); font-size: 12px; padding-top: 4px; padding-bottom: 4px; }
      .cmpt-foot-total td { border-top: 2px solid var(--b); padding-top: 14px; }

      .cmpt-tier-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
      .cmpt-cab-detail { font-family: var(--fm); font-size: 10px; color: var(--m); margin-top: 2px; padding-left: 14px; }

      .cmpt-table-edit input, .cmpt-input { background: var(--bg); border: 1px solid var(--b); border-radius: 6px; color: var(--t); padding: 6px 10px; font-family: var(--ff); font-size: 13px; width: 100%; transition: border-color .12s; }
      .cmpt-input:focus { outline: none; border-color: var(--a); }
      .cmpt-input-num { text-align: right; font-family: var(--fm); }

      .cmpt-icon-btn { background: none; border: 1px solid var(--b); border-radius: 6px; padding: 4px 9px; cursor: pointer; color: var(--m); font-size: 13px; transition: all .12s; margin-left: 4px; }
      .cmpt-icon-btn:hover { color: var(--t); border-color: rgba(255,255,255,.2); }
      .cmpt-icon-del:hover { color: var(--d); border-color: rgba(255,95,109,.3); background: rgba(255,95,109,.08); }

      .cmpt-btn { padding: 9px 16px; background: var(--s); border: 1px solid var(--b); border-radius: 8px; color: var(--t); font-family: var(--ff); font-size: 12px; font-weight: 600; cursor: pointer; transition: all .12s; }
      .cmpt-btn:hover { border-color: rgba(0,212,170,.4); }
      .cmpt-btn-primary { background: linear-gradient(135deg, var(--a), #00b891); color: #000; border-color: transparent; }
      .cmpt-btn-primary:hover { box-shadow: 0 4px 16px rgba(0,212,170,.3); border-color: transparent; }
      .cmpt-btn-ghost { background: transparent; }
      .cmpt-btn-mini { padding: 5px 11px; background: var(--bg); border: 1px solid var(--b); border-radius: 6px; color: var(--m); font-family: var(--fm); font-size: 11px; cursor: pointer; transition: all .12s; }
      .cmpt-btn-mini:hover { color: var(--t); border-color: rgba(255,255,255,.2); }
      .cmpt-btn-mini-primary { color: var(--a); border-color: rgba(0,212,170,.3); }
      .cmpt-btn-mini-primary:hover { background: rgba(0,212,170,.08); }

      .cmpt-info { font-family: var(--fm); font-size: 11px; color: var(--m); padding: 10px 0 4px; }
      .cmpt-info-box { background: rgba(79,168,255,.06); border: 1px solid rgba(79,168,255,.2); border-radius: 10px; padding: 14px 16px; font-size: 12px; color: var(--m); line-height: 1.6; margin-top: 8px; }
      .cmpt-info-box code { background: var(--bg); padding: 1px 6px; border-radius: 4px; font-family: var(--fm); font-size: 11px; color: var(--a); }
      .cmpt-info-box strong { color: var(--t); }

      .cmpt-empty { padding: 24px; text-align: center; color: var(--m); font-size: 13px; }

      .cmpt-table-annual .cmpt-row-current { background: rgba(0,212,170,.04); }
      .cmpt-table-annual .cmpt-row-frozen td { color: var(--t); }
      .cmpt-table-annual .cmpt-row-future td { color: var(--m); opacity: .55; }
      /* ⚡ Mois passé sans snapshot : visuellement distinct du futur (légèrement
         différent de cmpt-row-future pour qu'on perçoive que c'est différent
         du futur — c'est du passé "non saisi", donc actionable via 🔒) */
      .cmpt-table-annual .cmpt-row-nodata td { color: var(--m); opacity: .65; font-style: italic; }
      .cmpt-tag-now { display: inline-block; background: rgba(0,212,170,.15); color: var(--a); padding: 1px 8px; border-radius: 10px; font-size: 9px; font-family: var(--fm); margin-left: 6px; letter-spacing: .5px; }
      .cmpt-tag-frozen { display: inline-block; background: rgba(255,255,255,.04); color: var(--m); padding: 1px 8px; border-radius: 10px; font-size: 9px; font-family: var(--fm); margin-left: 6px; }
      .cmpt-tag-nodata { display: inline-block; background: rgba(255,181,71,.08); color: var(--w, #ffb547); padding: 1px 8px; border-radius: 10px; font-size: 9px; font-family: var(--fm); margin-left: 6px; cursor: help; border: 1px dashed rgba(255,181,71,.3); }
      .cmpt-year-label { font-family: var(--fs); font-size: 18px; color: var(--a); padding: 0 10px; }

      /* Chart évolution */
      .cmpt-legend { display: inline-flex; align-items: center; gap: 6px; font-family: var(--fm); font-size: 11px; color: var(--m); margin-right: 12px; }
      .cmpt-legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
      .cmpt-chart-wrap { padding: 8px 0 4px; }
      .cmpt-chart-svg { width: 100%; height: auto; max-height: 320px; display: block; }
      .cmpt-chart-svg .cmpt-bar-g { transition: opacity .15s; }
      .cmpt-chart-svg .cmpt-bar-g:hover { opacity: 0.75; cursor: pointer; }
      .cmpt-chart-svg .cmpt-line-pt { transition: r .12s; cursor: pointer; }
      .cmpt-chart-svg .cmpt-line-pt:hover { r: 6; }
      .cmpt-chart-empty { padding: 40px; text-align: center; color: var(--m); font-size: 13px; font-style: italic; }
      .cmpt-chart-foot { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--b); }
      .cmpt-chart-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
      .cmpt-chart-stat { background: rgba(255,255,255,.02); border: 1px solid var(--b); border-radius: 8px; padding: 10px 12px; }
      .cmpt-chart-stat-lbl { font-family: var(--fm); font-size: 9px; color: var(--m); letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 4px; }
      .cmpt-chart-stat-val { font-family: var(--fs); font-size: 18px; color: var(--t); line-height: 1.2; }
      .cmpt-chart-stat-sub { font-family: var(--fm); font-size: 10px; color: var(--m); margin-top: 2px; }

      /* Modal */
      .cmpt-modal-back { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 9999; align-items: center; justify-content: center; padding: 20px; }
      .cmpt-modal { background: var(--c); border: 1px solid var(--b); border-radius: 14px; padding: 22px; max-width: 480px; width: 100%; max-height: 88vh; overflow-y: auto; }
      .cmpt-modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--b); }
      .cmpt-modal-title { font-family: var(--fs); font-size: 18px; color: var(--t); }
      .cmpt-modal-x { background: none; border: 1px solid var(--b); width: 30px; height: 30px; border-radius: 50%; color: var(--m); cursor: pointer; transition: all .12s; }
      .cmpt-modal-x:hover { color: var(--d); border-color: var(--d); }
      .cmpt-modal-intro { font-size: 12px; color: var(--m); margin-bottom: 16px; line-height: 1.5; }
      .cmpt-price-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .cmpt-price-row label { flex: 1; font-size: 13px; color: var(--t); }
      .cmpt-price-row input { width: 90px; }
      .cmpt-modal-foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--b); }
    `;
    const tag = document.createElement('style');
    tag.id = 'cmpt-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ═════════════════════════════════════════════════════════════════
     13. EXPORT API publique
  ═════════════════════════════════════════════════════════════════ */
  window.AdmCompta = {
    load,
    refresh,
    saveCharges,
    freezeMonth,
    unfreezeMonth,
    exportPDF,
    exportCSV,
    // Internes exposés pour les onclick=…
    _editCharge,
    _addCharge,
    _delCharge,
    _setVAT,
    _setYear,
    _setPrice,
    _togglePriceEdit,
    _closeModal
  };

  /* ⚡ Auto-refresh quand un abonnement IDE est modifié ailleurs (modale admin
     d'override, promotion de rôle, activation Premium, etc.). Sans ça, la
     Comptabilité affichait les anciennes valeurs jusqu'à un changement
     d'onglet ou un F5 manuel — déroutant pour l'admin qui vient de promouvoir
     quelqu'un en Pro et ne voit pas le CA bouger.

     Le déclencheur est un CustomEvent dispatché par admin-subscription-ui.js
     après chaque appel réussi à /webhook/admin-subscription-override (ou
     /admin-promote-user). On rafraîchit UNIQUEMENT si l'onglet Comptabilité
     est actuellement visible (sinon load() sera appelé naturellement à la
     prochaine ouverture via admTab('compta')).

     ⚡ Détection robuste : on lit le DOM (display de la section compta) plutôt
     que la variable _ADM_ACTIVE_TAB d'admin.js — un `let` top-level n'est PAS
     forcément accessible entre fichiers script (comportement variable selon
     le navigateur et le mode de chargement). Le DOM est la source de vérité. */
  document.addEventListener('ami:subscription_changed', (e) => {
    try {
      const comptaSection = document.querySelector('.adm-tab-section[data-tab="compta"]');
      // visible = display !== 'none' (qui inclut 'block', 'flex' et chaîne vide en init)
      const isComptaVisible = comptaSection
        && getComputedStyle(comptaSection).display !== 'none';
      if (!isComptaVisible) {
        console.info('[adm-compta] subscription_changed reçu (%s), mais onglet Comptabilité non visible → skip refresh (sera rechargé au prochain switch)',
          e.detail?.action || 'unknown');
        return;
      }
      console.info('[adm-compta] subscription_changed reçu (%s) → refresh', e.detail?.action || 'unknown');
      refresh();
    } catch (err) {
      console.warn('[adm-compta] auto-refresh KO :', err.message);
    }
  });

  console.log('[adm-compta] v1.2 prêt — window.AdmCompta exposé + auto-refresh sur ami:subscription_changed');

})();
