/* ════════════════════════════════════════════════════════════════════
   admin-subscription-ui.js — AMI NGAP v3.0
   ────────────────────────────────────────────────────────────────────
   Extension NON-INVASIVE de admin.js
   Doit être chargé APRÈS admin.js dans index.html.

   ✅ Remplace loadAdmComptes() et renderAccs() pour afficher en plus :
      - Le tier d'abonnement de chaque utilisateur
      - Le statut (essai, actif, expiré)
      - Les jours restants
      - Un bouton "Modifier abonnement" → modale de changement de tier
   ✅ Injecte un panneau "Mode application" en haut de l'onglet Comptes
      → bouton Bascule TEST ⇄ PAYANT (avec confirmation explicite)
      → indicateur visuel du mode actuel
   ✅ Pas de modification de admin.js, du worker, ou du HTML.
═════════════════════════════════════════════════════════════════════ */
'use strict';

(function(){

  /* ─── Tiers disponibles (synchronisé avec subscription.js / worker.js) ─── */
  const TIERS_INFO = {
    TEST:      { label:'Mode test',       color:'#00d4aa', icon:'🧪' },
    TRIAL:     { label:'Essai 30j',       color:'#00d4aa', icon:'✨' },
    ESSENTIEL: { label:'Essentiel · 29 €/mois', color:'#4fa8ff', icon:'🟢' },
    PRO:       { label:'Pro · 49 €/mois', color:'#00d4aa', icon:'🔵' },
    CABINET:   { label:'Cabinet · dégressif', color:'#a78bfa', icon:'🟣' },
    PREMIUM:   { label:'Premium (add-on) · +29 €/mois', color:'#fbbf24', icon:'💎' },
    COMPTABLE: { label:'Comptable · 99 €/mois', color:'#ff5f6d', icon:'🧑‍💼' },
    LOCKED:    { label:'Verrouillé',      color:'#ff5f6d', icon:'🔒' },
    UNKNOWN:   { label:'Aucun',           color:'#6a8099', icon:'❓' }
  };

  // ⚠️ PREMIUM est intentionnellement ABSENT des tiers assignables :
  // c'est un add-on cumulatif activable séparément via le bouton
  // "💎 Activer Premium add-on" (cf. admPremiumAddon ci-dessous).
  // Si on le laissait ici, un admin pourrait par erreur écraser le tier
  // de base d'un user (Pro/Cabinet) en PREMIUM, ce qui ferait perdre
  // l'accès aux features Cabinet et casserait la facturation.
  const ASSIGNABLE_TIERS = ['TRIAL','ESSENTIEL','PRO','CABINET','COMPTABLE','LOCKED'];

  /* ─── Cache local des abonnements (rempli à chaque loadAdmComptes) ─── */
  let _SUB_LIST = [];   // [{id, nom, prenom, is_blocked, tier, is_trial, days_left, trial_end, paid_until, override, expired, cabinet_member, ...}]
  let _APP_MODE = 'TEST';
  let _APP_PAID_SINCE = null;

  /* ════════════════════════════════════════════════════════════════════
     1. CSS injecté (utilise les variables existantes)
  ════════════════════════════════════════════════════════════════════ */
  function _injectAdmSubStyles() {
    if (document.getElementById('adm-sub-injected-styles')) return;
    const css = `
.adm-sub-mode-card { display:flex; align-items:center; gap:16px; padding:16px 20px;
  background:linear-gradient(135deg, rgba(0,212,170,.05), var(--c));
  border:1px solid var(--b); border-radius:12px; margin-bottom:18px; flex-wrap:wrap; }
.adm-sub-mode-card.payant { background:linear-gradient(135deg, rgba(255,95,109,.05), var(--c));
  border-color:rgba(255,95,109,.3); }
.adm-sub-mode-ic { font-size:28px; flex-shrink:0; }
.adm-sub-mode-info { flex:1; min-width:180px; }
.adm-sub-mode-label { font-family:var(--fm); font-size:11px; color:var(--m); text-transform:uppercase; letter-spacing:1px; }
.adm-sub-mode-value { font-family:var(--fs,serif); font-size:22px; color:var(--t); margin:2px 0; }
.adm-sub-mode-sub { font-size:12px; color:var(--m); }
.adm-sub-mode-actions { display:flex; gap:8px; flex-wrap:wrap; flex-shrink:0; }
.adm-sub-mode-btn { padding:10px 18px; border-radius:10px; font-family:var(--ff); font-size:13px;
  font-weight:600; cursor:pointer; border:1px solid; transition:all .15s; }
.adm-sub-mode-btn-test { background:var(--ad); color:var(--a); border-color:var(--ab); }
.adm-sub-mode-btn-test:hover { background:rgba(0,212,170,.18); }
.adm-sub-mode-btn-payant { background:linear-gradient(135deg, #ff5f6d, #d8525e);
  color:#fff; border-color:transparent; box-shadow:0 4px 18px rgba(255,95,109,.3); }
.adm-sub-mode-btn-payant:hover { transform:translateY(-1px); box-shadow:0 6px 24px rgba(255,95,109,.4); }
.adm-sub-mode-btn-current { background:transparent; color:var(--m); border-color:var(--b); cursor:default; }

.adm-sub-tier-pill { display:inline-flex; align-items:center; gap:5px; padding:3px 9px;
  border-radius:50px; font-size:11px; font-family:var(--fm); font-weight:600;
  border:1px solid; flex-shrink:0; white-space:nowrap; }
.adm-sub-days { font-size:11px; color:var(--m); margin-top:2px; font-family:var(--fm); }
.adm-sub-days.warn { color:var(--w); }
.adm-sub-days.crit { color:var(--d); }

.acc-sub-col { display:flex; flex-direction:column; gap:2px; min-width:120px; align-items:flex-start; }

.bxs.b-sub { background:rgba(167,139,250,.12); color:#a78bfa;
  border:1px solid rgba(167,139,250,.3); }
.bxs.b-sub:hover { background:rgba(167,139,250,.22); }

/* Modale changement abonnement */
.adm-sub-modal { position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:9999;
  display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(6px); }
.adm-sub-modal-card { max-width:520px; width:100%; background:var(--c); border:1px solid var(--b);
  border-radius:16px; padding:24px; max-height:90vh; overflow-y:auto; }
.adm-sub-modal-h { font-family:var(--fs,serif); font-size:22px; margin:0 0 6px; color:var(--t); }
.adm-sub-modal-sub { font-size:13px; color:var(--m); margin-bottom:16px; }
.adm-sub-modal-current { padding:12px 14px; background:var(--s); border:1px solid var(--b);
  border-radius:10px; margin-bottom:16px; }
.adm-sub-modal-current-label { font-size:11px; color:var(--m); text-transform:uppercase; letter-spacing:1px; font-family:var(--fm); }
.adm-sub-modal-current-tier { font-family:var(--fs,serif); font-size:18px; margin:4px 0; }
.adm-sub-modal-current-meta { font-size:12px; color:var(--m); }
.adm-sub-modal-tiers { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:14px; }
@media (max-width:480px) { .adm-sub-modal-tiers { grid-template-columns:1fr; } }
.adm-sub-modal-tier-btn { padding:12px 14px; border-radius:10px; font-family:var(--ff); font-size:13px;
  font-weight:600; cursor:pointer; border:1px solid var(--b); background:var(--s); color:var(--t);
  text-align:left; transition:all .15s; }
.adm-sub-modal-tier-btn:hover { background:var(--c); transform:translateY(-1px); }
.adm-sub-modal-tier-btn.current { border-color:var(--a); background:var(--ad); cursor:default; }
.adm-sub-modal-tier-icon { font-size:18px; margin-right:6px; }
.adm-sub-modal-actions { display:flex; gap:8px; justify-content:flex-end; padding-top:12px;
  border-top:1px solid var(--b); }
.adm-sub-modal-btn { padding:10px 18px; border-radius:10px; font-family:var(--ff); font-size:13px;
  font-weight:600; cursor:pointer; border:1px solid; transition:all .15s; }
.adm-sub-modal-btn-cancel { background:transparent; color:var(--m); border-color:var(--b); }
.adm-sub-modal-btn-cancel:hover { color:var(--t); border-color:var(--bl); }
.adm-sub-modal-extras { margin-top:12px; padding-top:12px; border-top:1px solid var(--b); }
.adm-sub-modal-extras-h { font-size:12px; color:var(--m); text-transform:uppercase; letter-spacing:1px;
  font-family:var(--fm); margin-bottom:8px; }
.adm-sub-modal-extras-row { display:flex; gap:6px; flex-wrap:wrap; }
.adm-sub-extras-btn { padding:6px 12px; border-radius:8px; font-size:12px; cursor:pointer;
  background:var(--s); color:var(--t); border:1px solid var(--b); font-family:var(--ff); transition:all .15s; }
.adm-sub-extras-btn:hover { background:var(--c); border-color:var(--bl); }
`;
    const s = document.createElement('style');
    s.id = 'adm-sub-injected-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ════════════════════════════════════════════════════════════════════
     2. Override de loadAdmComptes — utilise admin-subscription-list
        au lieu de admin-liste pour récupérer les détails d'abonnement
  ════════════════════════════════════════════════════════════════════ */
  const _origLoadAdmComptes = window.loadAdmComptes;

  window.loadAdmComptes = async function() {
    _injectAdmSubStyles();
    const el = document.getElementById('accs');
    if (!el) return;
    el.innerHTML = '<div class="empty"><div class="ei"><div class="spin spinw" style="width:28px;height:28px"></div></div><p style="margin-top:12px">Chargement...</p></div>';

    try {
      // 1. Tenter l'endpoint enrichi
      let d;
      try {
        d = await wpost('/webhook/admin-subscription-list', {});
      } catch (e1) {
        // Fallback : si l'endpoint n'existe pas (ancien worker), utiliser admin-liste
        console.warn('[adm-sub] Endpoint admin-subscription-list KO, fallback admin-liste:', e1.message);
        d = await wpost('/webhook/admin-liste', {});
      }
      if (!d.ok) throw new Error(d.error || 'Erreur');

      // 2. Récupérer le mode global
      try {
        const sd = await wpost('/webhook/subscription-status', {});
        if (sd.ok) {
          _APP_MODE = sd.app_mode || 'TEST';
          _APP_PAID_SINCE = sd.paid_since || null;
        }
      } catch(_) { /* mode TEST par défaut */ }

      // 3. Mettre à jour les caches
      _SUB_LIST = (d.comptes || []).filter(a => a.role !== 'admin');
      window.ACCS = _SUB_LIST;   // garde la compat avec filterAccs() existant
      _renderModeCard();
      _renderAccsWithSub(_SUB_LIST);
    } catch (e) {
      if (typeof admAlert === 'function') admAlert(e.message, 'e');
      el.innerHTML = '<div class="empty"><div class="ei">⚠️</div><p>Impossible de charger les comptes</p></div>';
    }
  };

  /* ════════════════════════════════════════════════════════════════════
     3. Override de renderAccs — ajoute la colonne abonnement
  ════════════════════════════════════════════════════════════════════ */
  const _origRenderAccs = window.renderAccs;

  window.renderAccs = function(list) {
    _renderAccsWithSub(list);
  };

  function _renderAccsWithSub(list) {
    const el = document.getElementById('accs');
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<div class="empty"><div class="ei">👥</div><p>Aucun compte trouvé</p></div>';
      return;
    }

    el.innerHTML = list.map(a => {
      const ini = ((a.prenom||'?')[0] + (a.nom||'?')[0]).toUpperCase();
      const name = ((a.prenom||'') + ' ' + (a.nom||'')).trim() || '—';
      const safe = name.replace(/'/g, "\\'");
      const tier = a.tier || 'UNKNOWN';
      const tierInfo = TIERS_INFO[tier] || TIERS_INFO.UNKNOWN;

      // Pill abonnement (tier de base)
      const subPill = `
        <span class="adm-sub-tier-pill" style="background:${tierInfo.color}1a;color:${tierInfo.color};border-color:${tierInfo.color}55">
          ${tierInfo.icon} ${tierInfo.label}
        </span>`;

      // 💎 Pill Premium add-on (cumulatif, affiché EN PLUS du tier de base
      // quand a.premium_addon === true — exposé par le worker depuis v3.5)
      let premiumAddonPill = '';
      if (a.premium_addon === true) {
        const pColor = '#fbbf24';
        let untilStr = '';
        if (a.premium_addon_until) {
          const dt = new Date(a.premium_addon_until);
          const days = Math.ceil((dt.getTime() - Date.now()) / (1000*60*60*24));
          if (days > 0) untilStr = ` · ${days}j`;
        }
        premiumAddonPill = `
          <span class="adm-sub-tier-pill" style="background:${pColor}1a;color:${pColor};border-color:${pColor}55"
                title="Add-on Premium actif — cumule avec le tier de base">
            💎 + Premium add-on${untilStr}
          </span>`;
      }

      // Jours restants
      let daysHTML = '';
      if (a.is_trial && a.days_left != null) {
        const cls = a.days_left <= 3 ? 'crit' : (a.days_left <= 7 ? 'warn' : '');
        daysHTML = `<span class="adm-sub-days ${cls}">⏱ ${a.days_left}j restant${a.days_left>1?'s':''}</span>`;
      } else if (a.paid_until) {
        const dt = new Date(a.paid_until);
        const days = Math.ceil((dt.getTime() - Date.now()) / (1000*60*60*24));
        if (days > 0) {
          const cls = days <= 7 ? 'warn' : '';
          daysHTML = `<span class="adm-sub-days ${cls}">↻ ${days}j (${dt.toLocaleDateString('fr-FR')})</span>`;
        } else {
          daysHTML = `<span class="adm-sub-days crit">⚠ Expiré le ${dt.toLocaleDateString('fr-FR')}</span>`;
        }
      } else if (tier === 'LOCKED' || a.expired) {
        daysHTML = `<span class="adm-sub-days crit">🔒 Aucun accès</span>`;
      }

      // Override admin
      let overrideHTML = '';
      if (a.override) {
        overrideHTML = `<span class="adm-sub-days" style="color:var(--w)">⚙ Override admin</span>`;
      }

      // Bonus cabinet
      let cabHTML = '';
      if (a.cabinet_member && a.cabinet_size >= 2) {
        const roleLabel = a.cabinet_role === 'titulaire' ? '⭐ Titulaire'
                       : a.cabinet_role === 'gestionnaire' ? '🛠️ Gestionnaire'
                       : '👤 Membre';
        cabHTML = `<span class="adm-sub-days">🏥 Cabinet ${a.cabinet_size} IDE · ${roleLabel}</span>`;
      }

      return `<div class="acc ${a.is_blocked?'blk':''}">
        <div class="avat ${a.is_blocked?'blk':''}">${ini}</div>
        <div class="acc-info-col">
          <div class="acc-name">${name}</div>
          <div class="acc-sub-col">
            ${subPill}
            ${premiumAddonPill}
            ${daysHTML}
            ${cabHTML}
            ${overrideHTML}
          </div>
        </div>
        <div class="acc-st ${a.is_blocked?'blk':'on'}">${a.is_blocked?'⏸ Suspendu':'● Actif'}</div>
        <div class="acc-acts">
          <button class="bxs b-sub" onclick="admChangeSub('${a.id}','${safe}')">💎 Abo</button>
          ${a.is_blocked
            ? `<button class="bxs b-unblk" onclick="admAct('debloquer','${a.id}','${safe}')">▶ Réactiver</button>`
            : `<button class="bxs b-blk" onclick="admAct('bloquer','${a.id}','${safe}')">⏸ Suspendre</button>`}
          <button class="bxs b-del" onclick="admAct('supprimer','${a.id}','${safe}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }

  /* ════════════════════════════════════════════════════════════════════
     4. Carte "Mode application" — toggle TEST ⇄ PAYANT
  ════════════════════════════════════════════════════════════════════ */
  function _renderModeCard() {
    const accsEl = document.getElementById('accs');
    if (!accsEl) return;

    // S'assurer que la carte est juste avant la liste #accs
    let card = document.getElementById('adm-sub-mode-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'adm-sub-mode-card';
      // Insérer AVANT le bloc "adm-search" si possible, sinon avant #accs
      const search = document.querySelector('.adm-search');
      const parent = (search?.parentNode) || accsEl.parentNode;
      const before = search || accsEl;
      parent.insertBefore(card, before);
    }

    const isTest = _APP_MODE !== 'PAYANT';
    const cardClass = isTest ? '' : 'payant';
    const ic   = isTest ? '🧪' : '🚀';
    const lbl  = 'Mode application';
    const val  = isTest ? 'Mode TEST (illimité)' : 'Mode PAYANT (production)';
    const sub  = isTest
      ? 'Toutes les fonctionnalités sont accessibles à tous les utilisateurs sans limite. Aucune carte de paiement requise.'
      : `Le système d'abonnement est actif. Les nouveaux comptes ont automatiquement 30 jours d'essai gratuit avec accès complet.${_APP_PAID_SINCE?` · Activé le ${new Date(_APP_PAID_SINCE).toLocaleDateString('fr-FR')}`:''}`;

    const actions = isTest ? `
      <button class="adm-sub-mode-btn adm-sub-mode-btn-current" disabled>● Test actuel</button>
      <button class="adm-sub-mode-btn adm-sub-mode-btn-payant" onclick="admToggleAppMode('PAYANT')">
        🚀 Activer le mode payant
      </button>` : `
      <button class="adm-sub-mode-btn adm-sub-mode-btn-test" onclick="admToggleAppMode('TEST')">
        ↺ Repasser en mode test
      </button>
      <button class="adm-sub-mode-btn adm-sub-mode-btn-current" disabled>● Payant actuel</button>`;

    card.className = `adm-sub-mode-card ${cardClass}`;
    card.innerHTML = `
      <div class="adm-sub-mode-ic">${ic}</div>
      <div class="adm-sub-mode-info">
        <div class="adm-sub-mode-label">${lbl}</div>
        <div class="adm-sub-mode-value">${val}</div>
        <div class="adm-sub-mode-sub">${sub}</div>
      </div>
      <div class="adm-sub-mode-actions">${actions}</div>`;
  }

  /* ════════════════════════════════════════════════════════════════════
     5. admToggleAppMode — bascule globale TEST ⇄ PAYANT
  ════════════════════════════════════════════════════════════════════ */
  window.admToggleAppMode = async function(newMode) {
    if (newMode === 'PAYANT') {
      const ok = confirm(
        '🚀 ACTIVER LE MODE PAYANT\n\n' +
        'Cette action déclenche le système d\'abonnement pour TOUTE l\'application :\n\n' +
        '  ✓ Les nouveaux comptes auront 30 jours d\'essai gratuit (TRIAL)\n' +
        '  ✓ Les comptes existants démarrent leur essai 30j à partir de maintenant\n' +
        '  ✓ À l\'expiration, les fonctionnalités payantes seront verrouillées\n' +
        '  ✓ Les utilisateurs verront les bandeaux d\'expiration et paywalls\n' +
        '  ✓ Les admins gardent leur bypass illimité\n\n' +
        '⚠️ Cette bascule est immédiate pour tous les utilisateurs connectés.\n' +
        'Vous pourrez toujours repasser en mode TEST si besoin.\n\n' +
        'Confirmer l\'activation du mode payant ?'
      );
      if (!ok) return;
    } else {
      const ok = confirm(
        '↺ REVENIR EN MODE TEST\n\n' +
        'Cette action désactive le système d\'abonnement :\n\n' +
        '  ✓ Toutes les fonctionnalités redeviennent accessibles à tous\n' +
        '  ✓ Les paywalls et bandeaux d\'expiration disparaissent\n' +
        '  ✓ Les abonnements en BDD sont CONSERVÉS (pas effacés)\n' +
        '  ✓ Vous pourrez réactiver le mode payant plus tard sans perte\n\n' +
        'Confirmer le retour en mode test ?'
      );
      if (!ok) return;
    }

    try {
      const d = await wpost('/webhook/admin-subscription-mode', { mode: newMode });
      if (!d.ok) throw new Error(d.error || 'Erreur');
      if (typeof admAlert === 'function') {
        admAlert(`✅ Mode application : ${newMode}`, 'o');
      }
      _APP_MODE = newMode;
      _APP_PAID_SINCE = d.paid_since || _APP_PAID_SINCE;
      _renderModeCard();

      // Rafraîchir l'état SUB du frontend admin (pour que les bandeaux se mettent à jour)
      if (window.SUB && typeof SUB.refresh === 'function') {
        try { await SUB.refresh(); } catch(_) {}
      }
      // Recharger la liste pour refléter les nouveaux statuts
      setTimeout(() => window.loadAdmComptes(), 300);
    } catch (e) {
      if (typeof admAlert === 'function') admAlert(e.message, 'e');
      else alert('Erreur : ' + e.message);
    }
  };

  /* ════════════════════════════════════════════════════════════════════
     6. admChangeSub — modale de changement de tier pour un user
  ════════════════════════════════════════════════════════════════════ */
  window.admChangeSub = function(userId, name) {
    const user = _SUB_LIST.find(u => u.id === userId);
    if (!user) return;

    _injectAdmSubStyles();
    let modal = document.getElementById('adm-sub-modal-root');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'adm-sub-modal-root';
      document.body.appendChild(modal);
    }

    const tier = user.tier || 'UNKNOWN';
    const tierInfo = TIERS_INFO[tier] || TIERS_INFO.UNKNOWN;

    // Détails statut
    let statusLines = [];
    if (user.is_trial && user.days_left != null) {
      statusLines.push(`Essai gratuit · <b>${user.days_left} jour${user.days_left>1?'s':''} restant${user.days_left>1?'s':''}</b>`);
      if (user.trial_end) statusLines.push(`Expire le ${new Date(user.trial_end).toLocaleDateString('fr-FR')}`);
    }
    if (user.paid_until) {
      const dt = new Date(user.paid_until);
      const days = Math.ceil((dt.getTime() - Date.now())/(1000*60*60*24));
      statusLines.push(days > 0
        ? `Renouvellement le ${dt.toLocaleDateString('fr-FR')} (${days}j)`
        : `<span style="color:var(--d)">⚠ Expiré le ${dt.toLocaleDateString('fr-FR')}</span>`);
    }
    if (user.cabinet_member) {
      statusLines.push(`🏥 Cabinet ${user.cabinet_size} IDE · rôle <b>${user.cabinet_role||'membre'}</b>`);
    }
    // 💎 Add-on Premium actif (cumulatif sur le tier de base)
    if (user.premium_addon === true) {
      let addonLine = `💎 <b style="color:#fbbf24">Add-on Premium actif</b> (+29 €/mois cumulé)`;
      if (user.premium_addon_until) {
        const adt = new Date(user.premium_addon_until);
        const adays = Math.ceil((adt.getTime() - Date.now())/(1000*60*60*24));
        if (adays > 0) addonLine += ` · expire le ${adt.toLocaleDateString('fr-FR')} (${adays}j)`;
      }
      statusLines.push(addonLine);
    }
    if (user.override) {
      statusLines.push(`⚙ Override admin actif`);
    }

    const tierButtons = ASSIGNABLE_TIERS.map(t => {
      const ti = TIERS_INFO[t];
      const isCurrent = (t === tier);
      return `<button class="adm-sub-modal-tier-btn ${isCurrent?'current':''}"
                ${isCurrent?'disabled':''}
                onclick="admConfirmChangeTier('${userId}','${name.replace(/'/g,"\\'")}','${t}')"
                style="border-color:${ti.color}55">
                <div style="color:${ti.color};font-weight:700"><span class="adm-sub-modal-tier-icon">${ti.icon}</span>${ti.label}</div>
                ${isCurrent?'<div style="font-size:10px;color:var(--m);margin-top:4px">— Plan actuel —</div>':''}
              </button>`;
    }).join('');

    modal.innerHTML = `
      <div class="adm-sub-modal" onclick="if(event.target===this)admCloseSubModal()">
        <div class="adm-sub-modal-card">
          <h2 class="adm-sub-modal-h">💎 Modifier l'abonnement</h2>
          <div class="adm-sub-modal-sub">${name}</div>

          <div class="adm-sub-modal-current">
            <div class="adm-sub-modal-current-label">Abonnement actuel</div>
            <div class="adm-sub-modal-current-tier" style="color:${tierInfo.color}">
              ${tierInfo.icon} ${tierInfo.label}
            </div>
            <div class="adm-sub-modal-current-meta">
              ${statusLines.length ? statusLines.join(' · ') : '—'}
            </div>
          </div>

          <div class="adm-sub-modal-current-label" style="margin-bottom:8px">Changer pour</div>
          <div class="adm-sub-modal-tiers">${tierButtons}</div>

          <div class="adm-sub-modal-extras">
            <div class="adm-sub-modal-extras-h">Actions complémentaires</div>
            <div class="adm-sub-modal-extras-row">
              <button class="adm-sub-extras-btn" onclick="admExtendTrial('${userId}','${name.replace(/'/g,"\\'")}',30)">+30j d'essai</button>
              <button class="adm-sub-extras-btn" onclick="admExtendTrial('${userId}','${name.replace(/'/g,"\\'")}',7)">+7j d'essai</button>
              <button class="adm-sub-extras-btn" onclick="admPremiumAddon('${userId}','${name.replace(/'/g,"\\'")}',true)">💎 Activer Premium add-on</button>
              <button class="adm-sub-extras-btn" onclick="admPremiumAddon('${userId}','${name.replace(/'/g,"\\'")}',false)">— Désactiver Premium</button>
            </div>
          </div>

          <div class="adm-sub-modal-actions">
            <button class="adm-sub-modal-btn adm-sub-modal-btn-cancel" onclick="admCloseSubModal()">Fermer</button>
          </div>
        </div>
      </div>`;
  };

  window.admCloseSubModal = function() {
    const modal = document.getElementById('adm-sub-modal-root');
    if (modal) modal.innerHTML = '';
  };

  window.admConfirmChangeTier = async function(userId, name, newTier) {
    const ti = TIERS_INFO[newTier];
    if (!confirm(`Changer l'abonnement de ${name} en :\n\n${ti?.icon||''} ${ti?.label||newTier}\n\nConfirmer ?`)) return;
    try {
      const d = await wpost('/webhook/admin-subscription-override', {
        infirmiere_id: userId,
        action: 'set',
        tier: newTier
      });
      if (!d.ok) throw new Error(d.error || 'Erreur');
      if (typeof admAlert === 'function') admAlert(`✅ ${name} → ${ti?.label||newTier}`, 'o');
      window.admCloseSubModal();
      setTimeout(() => window.loadAdmComptes(), 200);
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  window.admExtendTrial = async function(userId, name, days) {
    if (!confirm(`Prolonger l'essai de ${name} de ${days} jour${days>1?'s':''} ?`)) return;
    try {
      const d = await wpost('/webhook/admin-subscription-override', {
        infirmiere_id: userId,
        action: 'extend_trial',
        days: days
      });
      if (!d.ok) throw new Error(d.error || 'Erreur');
      if (typeof admAlert === 'function') admAlert(`✅ Essai de ${name} prolongé de ${days}j`, 'o');
      window.admCloseSubModal();
      setTimeout(() => window.loadAdmComptes(), 200);
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  window.admPremiumAddon = async function(userId, name, on) {
    const action = on ? 'premium_addon_on' : 'premium_addon_off';
    if (!confirm(`${on?'Activer':'Désactiver'} l'add-on Premium pour ${name} ?`)) return;
    try {
      const d = await wpost('/webhook/admin-subscription-override', {
        infirmiere_id: userId,
        action: action
      });
      if (!d.ok) throw new Error(d.error || 'Erreur');
      if (typeof admAlert === 'function') admAlert(`✅ Premium ${on?'activé':'désactivé'} pour ${name}`, 'o');
      window.admCloseSubModal();
      setTimeout(() => window.loadAdmComptes(), 200);
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  console.info('[adm-sub] admin-subscription-ui.js v3.0 chargé · loadAdmComptes/renderAccs étendus');

})();
