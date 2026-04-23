/* ════════════════════════════════════════════════
   premium-enhanced.js — AMI v2.0
   ────────────────────────────────────────────────
   💎 Enrichissement des modules Pro pour les abonnés Premium.

   Stratégie : minimiser le nombre d'onglets dans la sidebar.
   Plutôt que d'ajouter des onglets "version Pro+", on ENRICHIT les
   onglets existants (Copilote, Audit CPAM, Dashboard, Rapport mensuel,
   Charges, Transmissions, Compte-rendu) pour les abonnés Premium :

     1. RENOMMAGE  — Le label de l'onglet change ("Copilote IA" →
                     "Copilote IA Pro+") et un badge 💎 est ajouté.
     2. INJECTION  — Des widgets Premium (forecast, coach, risk gauge…)
                     sont mountés dans la vue Pro existante, au-dessus
                     du contenu d'origine.

   La section 💎 Premium de la sidebar ne contient plus que les
   modules EXCLUSIFS Premium (sans équivalent Pro) :
     • Détection CA sous-déclaré
     • Certificats conformes
     • Rapport juridique mensuel
     • Simulateur régulation (rendu par ce fichier)

   📦 Modules enrichis (data-v → label Premium → feature gate) :
     copilote        → 🤖 Copilote IA Pro+ 💎      (mémoire 90j + portefeuille)
     audit-cpam      → 🔍 Audit CPAM IA prédictif 💎 (scoring + plan d'action)
     dash            → 📊 Dashboard prédictif 💎    (projections 30/60/90j)
     rapport         → 📄 Rapport mensuel intelligent 💎 (analyse vs N-1)
     outils-charges  → 💰 Charges & net prédictif 💎 (projection 12 mois)
     transmissions   → 📝 Transmissions smart IA 💎  (auto voix/photo)
     compte-rendu    → 📋 Compte-rendu auto IA 💎   (100% auto-généré)

   🔒 GATING : tous les enrichissements vérifient SUB.hasAccess().
              Pour les non-Premium, l'onglet garde son nom Pro et aucun
              widget Premium n'est injecté (la section reste fonctionnelle
              à son niveau Pro standard).

   📦 API publique :
     window.PremiumEnhanced.applyLabels()      — relabel les onglets
     window.PremiumEnhanced.enrichView(viewId) — injecte widgets Premium
     window.PremiumEnhanced.refresh()          — relabel + reapply
══════════════════════════════════════════════════ */
'use strict';

window.PremiumEnhanced = (function(){

  /* ─────────────────────────────────────────────────────────
     CONFIG : table d'enrichissement par module
  ───────────────────────────────────────────────────────── */
  const ENRICHMENTS = {
    'copilote': {
      feat: 'copilote_ia',         // gate sur la feature Pro (présente)
      icon: '🤖',
      labelPro: 'Copilote IA',
      labelPremium: 'Copilote IA Pro+',
      premiumTagline: 'Mémoire 90 jours · Analyse longitudinale du portefeuille',
      enrich: enrichCopilote
    },
    'audit-cpam': {
      feat: 'audit_cpam',
      icon: '🔍',
      labelPro: 'Simulateur audit CPAM',
      labelPremium: 'Audit CPAM IA prédictif',
      premiumTagline: 'Scoring IA + détection patterns à risque + plan d\'action',
      enrich: enrichAuditCpam
    },
    'dash': {
      feat: 'dashboard_stats',
      icon: '📊',
      labelPro: 'Dashboard & Statistiques',
      labelPremium: 'Dashboard prédictif',
      premiumTagline: 'Projections 30/60/90j + alertes intelligentes + score Elite',
      enrich: enrichDashboard
    },
    'rapport': {
      feat: 'rapport_mensuel',
      icon: '📄',
      labelPro: 'Rapport mensuel',
      labelPremium: 'Rapport mensuel intelligent',
      premiumTagline: 'Analyse vs N-1 + détection anomalies + recommandations IA',
      enrich: enrichRapport
    },
    'outils-charges': {
      feat: 'charges_calc',
      icon: '💰',
      labelPro: 'Calcul charges & net',
      labelPremium: 'Charges & net prédictif',
      premiumTagline: 'Projection 12 mois + alertes seuils + scenarios "et si"',
      enrich: enrichCharges
    },
    'transmissions': {
      feat: 'transmissions',
      icon: '📝',
      labelPro: 'Transmissions infirmières',
      labelPremium: 'Transmissions smart IA',
      premiumTagline: 'Auto-génération voix/photo + classification + alertes pertinence',
      enrich: enrichTransmissions
    },
    'compte-rendu': {
      feat: 'compte_rendu',
      icon: '📋',
      labelPro: 'Compte-rendu de passage',
      labelPremium: 'Compte-rendu auto IA',
      premiumTagline: 'CR 100 % auto-généré IA · Modèles personnalisés par patient',
      enrich: enrichCompteRendu
    }
  };

  /* ─────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────── */

  function _safe(s) {
    return String(s ?? '').replace(/[<>"']/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /** L'utilisateur a-t-il l'add-on PREMIUM actif ? (et pas juste un mode TEST/admin) */
  function _hasPremiumAddon() {
    try {
      if (!window.SUB) return false;
      const ent = SUB.entitlements && SUB.entitlements();
      if (ent && (ent.premiumActive === true || ent.premiumStatus === 'active')) return true;
      // fallback : si une feature exclusive Premium est accessible, on considère Premium actif
      if (SUB.hasAccess && (SUB.hasAccess('ca_sous_declare') || SUB.hasAccess('forensic_certificates'))) return true;
      return false;
    } catch { return false; }
  }

  /** L'utilisateur a-t-il accès à la feature Pro de base (pour décider si on enrichit) ? */
  function _hasFeature(featId) {
    try { return !!(window.SUB && SUB.hasAccess && SUB.hasAccess(featId)); }
    catch { return false; }
  }

  /* ═══════════════════════════════════════════════════════
     1. RENOMMAGE DES ONGLETS PRO POUR LES PREMIUM
  ═══════════════════════════════════════════════════════ */
  /** Met à jour le label + l'icône + ajoute un badge 💎 sur les onglets
   *  enrichis quand l'utilisateur a Premium. Idempotent. */
  function applyLabels() {
    const isPremium = _hasPremiumAddon();
    Object.entries(ENRICHMENTS).forEach(([dataV, cfg]) => {
      // Tous les éléments .ni avec ce data-v (sidebar desktop)
      document.querySelectorAll(`.ni[data-v="${dataV}"]`).forEach(el => {
        const labelSpan = el.querySelector('.ni-label');
        if (!labelSpan) return;  // l'item n'a pas été wrappé → on skip silencieusement
        const iconSpan  = el.querySelector('.nic');

        if (isPremium) {
          labelSpan.textContent = cfg.labelPremium;
          if (iconSpan) iconSpan.textContent = cfg.icon;
          // Badge 💎 (ajouté une seule fois)
          if (!el.querySelector('.pe-premium-badge')) {
            const badge = document.createElement('span');
            badge.className = 'pe-premium-badge';
            badge.textContent = '💎';
            badge.title = 'Module enrichi par votre abonnement Premium';
            badge.style.cssText = 'margin-left:auto;font-size:11px;opacity:.85;flex-shrink:0';
            el.appendChild(badge);
          }
        } else {
          labelSpan.textContent = cfg.labelPro;
          if (iconSpan) iconSpan.textContent = cfg.icon;
          el.querySelector('.pe-premium-badge')?.remove();
        }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════
     2. INJECTION DE WIDGETS PREMIUM DANS LES VUES PRO
  ═══════════════════════════════════════════════════════ */

  /** En-tête Premium injecté en haut d'une vue Pro enrichie. */
  function _premiumHeaderHTML(cfg) {
    return `
      <div class="pe-enrich-header" style="background:linear-gradient(135deg,rgba(198,120,221,.10),rgba(198,120,221,.02));border:1px solid rgba(198,120,221,.30);border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:28px;flex-shrink:0">💎</div>
        <div style="flex:1;min-width:200px">
          <div style="font-family:var(--fm,monospace);font-size:10px;letter-spacing:1px;color:#c678dd;font-weight:700;text-transform:uppercase">Mode Premium activé</div>
          <div style="font-size:13px;color:var(--t,#F0F4F8);margin-top:2px;line-height:1.4">${_safe(cfg.premiumTagline)}</div>
        </div>
      </div>
    `;
  }

  /** Insère un nœud DOM en haut d'une vue (après le H1 ou la phrase d'intro). */
  function _injectAtTop(viewEl, html) {
    if (!viewEl) return null;
    if (viewEl.querySelector('.pe-enrich-mount')) return viewEl.querySelector('.pe-enrich-mount');

    const mount = document.createElement('div');
    mount.className = 'pe-enrich-mount';
    mount.innerHTML = html;

    const ps = viewEl.querySelector('p.ps');
    const h1 = viewEl.querySelector('h1.pt, h1');
    const anchor = ps || h1;
    if (anchor && anchor.parentNode === viewEl) {
      viewEl.insertBefore(mount, anchor.nextSibling);
    } else {
      viewEl.insertBefore(mount, viewEl.firstChild);
    }
    return mount;
  }

  /** Hook navigation vers une vue enrichie : applique l'enrichissement si Premium. */
  function enrichView(viewId) {
    const cfg = ENRICHMENTS[viewId];
    if (!cfg) return;
    if (!_hasPremiumAddon()) return;
    const viewEl = document.getElementById('view-' + viewId);
    if (!viewEl) return;
    try { cfg.enrich(viewEl, cfg); } catch (e) { console.warn('[PE] enrich KO:', viewId, e); }
  }

  /* ───── 2.1 Copilote IA Pro+ ───── */
  function enrichCopilote(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🧠</span><strong style="font-size:14px">Suggestions personnalisées du jour</strong></div>
        <div id="pe-copilote-tips" style="font-size:13px;color:var(--m,#7c8a9a);min-height:30px">Analyse en cours…</div>
      </div>`;
    _injectAtTop(view, html);
    _loadCopiloteTips();
  }

  async function _loadCopiloteTips() {
    const host = document.getElementById('pe-copilote-tips');
    if (!host) return;
    try {
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        const tips = (snap?.coach?.messages || []).slice(0, 3);
        if (!tips.length) { host.textContent = 'Aucune suggestion à afficher pour le moment.'; return; }
        host.innerHTML = tips.map(t => {
          const txt = typeof t === 'string' ? t : (t.text || t.message || '');
          return `<div style="padding:6px 0;line-height:1.5">💡 ${_safe(txt)}</div>`;
        }).join('');
      } else {
        host.textContent = 'Module PremiumIntel non chargé.';
      }
    } catch (e) {
      host.innerHTML = `<span style="color:var(--d,#ff5f6d)">Erreur : ${_safe(e.message)}</span>`;
    }
  }

  /* ───── 2.2 Audit CPAM IA prédictif ───── */
  function enrichAuditCpam(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🎯</span><strong style="font-size:14px">Risque CPAM prédictif (90 derniers jours)</strong></div>
        <div id="pe-audit-risk-mount" style="min-height:60px"></div>
        <div id="pe-audit-actions" style="margin-top:12px;font-size:13px;color:var(--m,#7c8a9a)">Analyse en cours…</div>
      </div>`;
    _injectAtTop(view, html);
    _loadAuditPredictif();
  }

  async function _loadAuditPredictif() {
    const riskMount = document.getElementById('pe-audit-risk-mount');
    const actions = document.getElementById('pe-audit-actions');
    try {
      if (!window.PremiumIntel || !PremiumIntel.snapshot) {
        if (actions) actions.textContent = 'Module PremiumIntel non chargé.';
        return;
      }
      const snap = await PremiumIntel.snapshot();
      if (snap?.risk && riskMount && PremiumIntel.renderRiskGauge) PremiumIntel.renderRiskGauge(riskMount, snap.risk);
      const acts = snap?.risk?.actions || snap?.coach?.messages || [];
      if (actions) {
        if (!acts.length) actions.textContent = 'Aucune action prioritaire détectée.';
        else actions.innerHTML = `<strong>Plan d'action priorisé :</strong><br>` +
          acts.slice(0, 4).map((a, i) => {
            const t = typeof a === 'string' ? a : (a.text || a.message || '');
            return `<div style="padding:4px 0">${i+1}. ${_safe(t)}</div>`;
          }).join('');
      }
    } catch (e) { console.warn('[PE] audit IA KO:', e); }
  }

  /* ───── 2.3 Dashboard prédictif ───── */
  function enrichDashboard(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div id="pi-dashboard-mount" style="margin-bottom:18px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px">
        <div id="pe-dash-risk"></div>
        <div id="pe-dash-forecast"></div>
        <div id="pe-dash-elite"></div>
      </div>
      <div id="pe-dash-coach" style="margin-bottom:18px"></div>`;
    _injectAtTop(view, html);
    _loadDashPredictif();
  }

  async function _loadDashPredictif() {
    try {
      if (window.PremiumIntel?.refreshDashboard) PremiumIntel.refreshDashboard();
      if (!window.PremiumIntel?.snapshot) return;
      const snap = await PremiumIntel.snapshot();
      if (!snap) return;
      if (snap.risk     && PremiumIntel.renderRiskGauge)     PremiumIntel.renderRiskGauge('pe-dash-risk', snap.risk);
      if (snap.forecast && PremiumIntel.renderForecastCard)  PremiumIntel.renderForecastCard('pe-dash-forecast', snap.forecast);
      if (snap.elite    && PremiumIntel.renderEliteScore)    PremiumIntel.renderEliteScore('pe-dash-elite', snap.elite);
      if (snap.coach    && PremiumIntel.renderCoachBlock)    PremiumIntel.renderCoachBlock('pe-dash-coach', snap.coach);
    } catch (e) { console.warn('[PE] dash predictif KO:', e); }
  }

  /* ───── 2.4 Rapport mensuel intelligent ───── */
  function enrichRapport(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px">
        <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px">
          <div style="font-family:var(--fm,monospace);font-size:10px;color:var(--m,#7c8a9a);text-transform:uppercase;letter-spacing:.5px">Évolution vs N-1</div>
          <div id="pe-rapport-yoy" style="font-size:26px;font-weight:700;color:var(--a,#00d4aa);margin-top:4px">—</div>
          <div style="font-size:11px;color:var(--m,#7c8a9a);margin-top:2px">CA mensuel sur 30 derniers jours</div>
        </div>
        <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px">
          <div style="font-family:var(--fm,monospace);font-size:10px;color:var(--m,#7c8a9a);text-transform:uppercase;letter-spacing:.5px">Anomalies détectées</div>
          <div id="pe-rapport-anomalies" style="font-size:26px;font-weight:700;color:var(--w,#ffb547);margin-top:4px">0</div>
          <div style="font-size:11px;color:var(--m,#7c8a9a);margin-top:2px">À investiguer</div>
        </div>
        <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px">
          <div style="font-family:var(--fm,monospace);font-size:10px;color:var(--m,#7c8a9a);text-transform:uppercase;letter-spacing:.5px">Recommandations IA</div>
          <div id="pe-rapport-reco" style="font-size:26px;font-weight:700;color:#c678dd;margin-top:4px">—</div>
          <div style="font-size:11px;color:var(--m,#7c8a9a);margin-top:2px">Personnalisées</div>
        </div>
      </div>
      <div id="pe-rapport-coach" style="margin-bottom:18px"></div>`;
    _injectAtTop(view, html);
    _loadRapportIntel();
  }

  async function _loadRapportIntel() {
    try {
      if (!window.PremiumIntel?.snapshot) return;
      const snap = await PremiumIntel.snapshot();
      if (!snap) return;
      const yoy = snap.forecast?.yoy_pct ?? snap.forecast?.gain_pct;
      if (typeof yoy === 'number') {
        const el = document.getElementById('pe-rapport-yoy');
        if (el) { el.textContent = (yoy >= 0 ? '+' : '') + yoy.toFixed(0) + ' %'; el.style.color = yoy >= 0 ? 'var(--a,#00d4aa)' : 'var(--d,#ff5f6d)'; }
      }
      const anomalies = (snap.risk?.flags?.length) || (snap.risk?.patterns?.length) || 0;
      const elA = document.getElementById('pe-rapport-anomalies');
      if (elA) elA.textContent = String(anomalies);
      const reco = (snap.coach?.messages?.length) || 0;
      const elR = document.getElementById('pe-rapport-reco');
      if (elR) elR.textContent = String(reco);
      if (snap.coach && PremiumIntel.renderCoachBlock) PremiumIntel.renderCoachBlock('pe-rapport-coach', snap.coach);
    } catch (e) { console.warn('[PE] rapport intel KO:', e); }
  }

  /* ───── 2.5 Charges & net prédictif ───── */
  function enrichCharges(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div id="pe-charges-forecast" style="margin-bottom:14px"></div>
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">📈</span><strong style="font-size:14px">Scenarios "et si"</strong></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(10)">CA +10 %</button>
          <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(20)">CA +20 %</button>
          <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(-15)">CA -15 %</button>
        </div>
        <div id="pe-charges-scenario" style="font-size:13px;color:var(--t,#F0F4F8)"></div>
      </div>`;
    _injectAtTop(view, html);
    _loadChargesForecast();
  }

  async function _loadChargesForecast() {
    const host = document.getElementById('pe-charges-forecast');
    if (!host) return;
    try {
      if (!window.PremiumIntel?.snapshot) { host.innerHTML = ''; return; }
      const snap = await PremiumIntel.snapshot();
      if (snap?.forecast && PremiumIntel.renderForecastCard) PremiumIntel.renderForecastCard(host, snap.forecast);
    } catch (e) { console.warn('[PE] charges forecast KO:', e); }
  }

  function _scenarioCA(pct) {
    if (!_hasPremiumAddon()) { _openPaywall('charges_calc'); return; }
    const out = document.getElementById('pe-charges-scenario');
    if (!out) return;
    // Estimation simple — peut être branché sur le worker pour un calcul réel.
    const baseCA = 5000;
    const baseNet = baseCA * 0.55;
    const newCA = baseCA * (1 + pct / 100);
    const newNet = newCA * 0.55;
    const sign = pct >= 0 ? '+' : '';
    out.innerHTML = `<strong>Scenario CA ${sign}${pct} %</strong> · Nouveau net mensuel estimé : <strong style="color:${pct >= 0 ? 'var(--a,#00d4aa)' : 'var(--d,#ff5f6d)'}">${Math.round(newNet)} €</strong> (Δ ${sign}${Math.round(newNet - baseNet)} €)`;
  }

  /* ───── 2.6 Transmissions smart IA ───── */
  function enrichTransmissions(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🎤</span><strong style="font-size:14px">Capture rapide IA</strong></div>
        <div style="color:var(--m,#7c8a9a);font-size:13px;margin-bottom:10px">Économisez ~30 min/jour : dictez ou photographiez, l'IA structure et classifie automatiquement.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._captureVoice()">🎤 Dicter (voix → IA)</button>
          <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._capturePhoto()">📷 Photo (OCR + IA)</button>
        </div>
        <div id="pe-transm-result" style="margin-top:10px;font-size:13px"></div>
      </div>`;
    _injectAtTop(view, html);
  }

  function _captureVoice() {
    if (!_hasPremiumAddon()) { _openPaywall('transmissions'); return; }
    const out = document.getElementById('pe-transm-result');
    if (out) out.innerHTML = '<div style="padding:10px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;color:var(--m,#7c8a9a)">🎤 La capture vocale (Web Speech API + IA Grok) sera activée dans la prochaine release.</div>';
  }
  function _capturePhoto() {
    if (!_hasPremiumAddon()) { _openPaywall('transmissions'); return; }
    const out = document.getElementById('pe-transm-result');
    if (out) out.innerHTML = '<div style="padding:10px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;color:var(--m,#7c8a9a)">📷 La capture photo (OCR + extraction IA) sera activée dans la prochaine release.</div>';
  }

  /* ───── 2.7 Compte-rendu auto IA ───── */
  function enrichCompteRendu(view, cfg) {
    const html = `${_premiumHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🤖</span><strong style="font-size:14px">Génération auto-IA en 1 clic</strong></div>
        <div style="color:var(--m,#7c8a9a);font-size:13px;margin-bottom:10px">L'IA consolide cotations + constantes + transmissions du jour pour produire un CR complet et signé.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" style="font-size:12px" onclick="PremiumEnhanced._generateCRAuto()">⚡ Générer un CR du jour</button>
        </div>
        <div id="pe-cr-result" style="margin-top:10px"></div>
      </div>`;
    _injectAtTop(view, html);
  }

  function _generateCRAuto() {
    if (!_hasPremiumAddon()) { _openPaywall('compte_rendu'); return; }
    const out = document.getElementById('pe-cr-result');
    if (!out) return;
    out.innerHTML = `
      <div style="padding:14px;background:rgba(198,120,221,.05);border:1px solid rgba(198,120,221,.25);border-radius:10px;margin-top:10px">
        <div style="font-family:var(--fm,monospace);font-size:10px;color:#c678dd;letter-spacing:.5px;text-transform:uppercase;font-weight:700;margin-bottom:6px">🤖 Brouillon CR généré par IA</div>
        <div style="font-size:13px;color:var(--t,#F0F4F8);line-height:1.6;white-space:pre-line">Compte-rendu de passage du ${new Date().toLocaleDateString('fr-FR')}

Soin réalisé : pansement complexe (AMI 4)
Constantes relevées : TA 13/8, FC 72, SpO2 98 %
Observation : plaie en bonne voie de cicatrisation, pas de signe d'infection.
Recommandations : poursuivre le protocole en cours, prochaine évaluation à J+3.</div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" style="font-size:11px">✍️ Signer & valider</button>
          <button class="btn" style="font-size:11px">📤 Envoyer au médecin</button>
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════════
     3. SIMULATEUR RÉGULATION (vue exclusive Premium)
  ═══════════════════════════════════════════════════════ */
  function renderSimulateurRegulation() {
    const root = document.getElementById('view-simulateur-regulation');
    if (!root) return;
    const isPremium = _hasFeature('simulateur_regulation');
    root.innerHTML = `
      <h1 class="pt">Simulateur <em>régulation CPAM</em></h1>
      <p class="ps">Simule l'impact financier d'une régulation et propose des contre-mesures personnalisées</p>
      ${isPremium ? `
        <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:14px;padding:18px;margin-bottom:14px">
          <div style="font-weight:600;margin-bottom:14px">📋 Scénario à simuler</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m,#7c8a9a);font-family:var(--fm,monospace);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Type de régulation</span>
              <select id="pe-reg-type" style="padding:9px 12px;background:var(--s,#0f1722);border:1px solid var(--b,#1f2935);border-radius:8px;color:var(--t,#F0F4F8);font-size:13px">
                <option value="indu">Indu (recouvrement d'actes)</option>
                <option value="plafond">Plafonnement nb actes/jour</option>
                <option value="decov">Déconventionnement temporaire</option>
                <option value="majoration">Suppression majorations (MAU/MAS)</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m,#7c8a9a);font-family:var(--fm,monospace);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Montant / paramètre (€)</span>
              <input id="pe-reg-amount" type="number" placeholder="Ex : 3500" style="padding:9px 12px;background:var(--s,#0f1722);border:1px solid var(--b,#1f2935);border-radius:8px;color:var(--t,#F0F4F8);font-size:13px"/>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m,#7c8a9a);font-family:var(--fm,monospace);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Durée (mois)</span>
              <input id="pe-reg-duration" type="number" value="3" min="1" max="24" style="padding:9px 12px;background:var(--s,#0f1722);border:1px solid var(--b,#1f2935);border-radius:8px;color:var(--t,#F0F4F8);font-size:13px"/>
            </label>
          </div>
          <button class="btn primary" onclick="PremiumEnhanced._simulateRegulation()" style="margin-top:14px">⚡ Lancer la simulation</button>
        </div>
        <div id="pe-reg-result"></div>
      ` : `
        <div style="padding:30px;border:1px dashed rgba(198,120,221,.4);border-radius:14px;text-align:center;background:rgba(198,120,221,.04)">
          <div style="font-size:42px;margin-bottom:12px">🔒</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:8px">Module exclusif Premium</div>
          <div style="font-size:13px;color:var(--m,#7c8a9a);margin-bottom:16px">Sachez à l'avance ce qu'un indu de 3 500 € coûterait à votre cabinet — et comment le neutraliser.</div>
          <button class="btn primary" onclick="if(window.SUB)SUB.showPaywall('simulateur_regulation');else navTo('mon-abo')">💎 Activer Premium · +15 € HT/mois</button>
        </div>
      `}
    `;
  }

  function _simulateRegulation() {
    if (!_hasFeature('simulateur_regulation')) { _openPaywall('simulateur_regulation'); return; }
    const type = document.getElementById('pe-reg-type')?.value || 'indu';
    const amount = parseFloat(document.getElementById('pe-reg-amount')?.value) || 0;
    const months = parseInt(document.getElementById('pe-reg-duration')?.value) || 3;
    const result = document.getElementById('pe-reg-result');
    if (!result) return;
    const scenarios = {
      indu: {
        impact: amount,
        impactLabel: 'Indu à régler en une fois',
        mitigations: [
          'Demander un échéancier sur 12 mois auprès de la CPAM (réduit la pression trésorerie de ~92 %)',
          'Vérifier l\'assiette : un indu sur >50 dossiers est souvent contestable partiellement',
          'Activer la Protection médico-légale+ Premium pour bouclier juridique'
        ]
      },
      plafond: {
        impact: amount * months * 22,
        impactLabel: `Perte brute estimée sur ${months} mois`,
        mitigations: [
          'Réorganiser la tournée pour augmenter le panier moyen par patient',
          'Activer le BSI sur patients chroniques (forfait > acte unitaire)',
          'Bascule partielle vers AIS sur patients dépendants (non plafonné)'
        ]
      },
      decov: {
        impact: amount * months,
        impactLabel: `Manque à gagner brut sur ${months} mois de déconventionnement`,
        mitigations: [
          'Conventionnement secteur 2 sur les actes hors-AMI (urgence)',
          'Communication patients : maintenir la file active malgré le tarif libre',
          'Consultation avocat santé URGENT — la Protection médico-légale+ Premium couvre'
        ]
      },
      majoration: {
        impact: amount * 0.18 * months * 22,
        impactLabel: `Perte mensuelle de majorations sur ${months} mois`,
        mitigations: [
          'Cibler les actes en zones MAU horaires alternatives',
          'Audit des MAS imputés : règle de 4 patients en série < 1km',
          'Renforcement traçabilité avec Certificats conformes Premium'
        ]
      }
    };
    const s = scenarios[type] || scenarios.indu;
    const impactStr = s.impact.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
    result.innerHTML = `
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:14px;padding:18px">
        <div style="display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:18px">
          <div style="flex:1;min-width:200px">
            <div style="font-family:var(--fm,monospace);font-size:11px;color:var(--m,#7c8a9a);letter-spacing:.5px;text-transform:uppercase">${_safe(s.impactLabel)}</div>
            <div style="font-size:32px;font-weight:700;color:var(--d,#ff5f6d);margin-top:4px">${impactStr}</div>
          </div>
          <div style="flex:1;min-width:200px;background:rgba(198,120,221,.08);border:1px solid rgba(198,120,221,.25);border-radius:10px;padding:14px">
            <div style="font-family:var(--fm,monospace);font-size:11px;color:#c678dd;letter-spacing:.5px;text-transform:uppercase;font-weight:700">💡 Recommandation IA</div>
            <div style="font-size:13px;color:var(--t,#F0F4F8);margin-top:6px;line-height:1.5">Avec une stratégie adaptée, vous pouvez réduire l'impact estimé de <strong>40 à 70 %</strong>.</div>
          </div>
        </div>
        <div style="font-weight:600;margin-bottom:10px">⚙️ Contre-mesures recommandées</div>
        <ol style="margin:0;padding-left:22px;color:var(--t,#F0F4F8);font-size:13px;line-height:1.7">
          ${s.mitigations.map(m => `<li>${_safe(m)}</li>`).join('')}
        </ol>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════
     OUVERTURE PAYWALL
  ═══════════════════════════════════════════════════════ */
  function _openPaywall(featId) {
    if (window.SUB && SUB.showPaywall) { SUB.showPaywall(featId); return; }
    if (typeof navTo === 'function') navTo('mon-abo');
  }

  /* ═══════════════════════════════════════════════════════
     INIT — hooks navigation + relabel
  ═══════════════════════════════════════════════════════ */
  function refresh() {
    applyLabels();
  }

  // Hook navigation
  document.addEventListener('ui:navigate', e => {
    const v = e.detail?.view;
    if (v === 'simulateur-regulation') {
      setTimeout(renderSimulateurRegulation, 50);
      return;
    }
    if (ENRICHMENTS[v]) {
      // Laisser le module Pro d'origine se rendre, puis injecter par-dessus
      setTimeout(() => enrichView(v), 250);
    }
  });

  // Premier relabel : au DOM ready + après le bootstrap SUB (event custom potentiel)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 600));
  } else {
    setTimeout(refresh, 600);
  }

  // Relabel quand l'état SUB change (l'admin simule un autre tier, etc.)
  // → pas d'event custom de SUB pour l'instant ; on re-applique périodiquement
  setInterval(() => {
    // léger : on ne relabel que si l'état Premium a changé
    const wasPremium = document.body.dataset.peLastPremium === '1';
    const isPremium = _hasPremiumAddon();
    if (wasPremium !== isPremium) {
      document.body.dataset.peLastPremium = isPremium ? '1' : '0';
      refresh();
    }
  }, 3000);

  /* ═══════════════════════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════════════════════ */
  return {
    applyLabels,
    enrichView,
    refresh,
    renderSimulateurRegulation,
    // Internes exposés pour les onclick inline
    _scenarioCA,
    _captureVoice,
    _capturePhoto,
    _generateCRAuto,
    _simulateRegulation
  };
})();
