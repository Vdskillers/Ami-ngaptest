/* ════════════════════════════════════════════════
   premium-enhanced.js — AMI v3.0
   ────────────────────────────────────────────────
   💎 Intégration des 4 modules Premium dans les onglets cibles.

   Stratégie : SUPPRIMER la section "💎 Premium" de la sidebar et
   intégrer le contenu Premium directement dans les onglets pertinents,
   pour minimiser le nombre d'onglets visibles.

   ┌──────────────────────────────────────────────────────────────┐
   │  Onglet hôte         │  Module Premium intégré                │
   ├──────────────────────┼────────────────────────────────────────┤
   │  Trésorerie          │  Détection CA sous-déclaré             │
   │  Signatures élec.    │  Certificats forensiques (conformes)   │
   │  Rapport mensuel     │  Rapport juridique mensuel             │
   │  Audit CPAM          │  Simulateur régulation CPAM            │
   └──────────────────────┴────────────────────────────────────────┘

   Comment ça marche :
     1. Les modules Premium d'origine (ca-sous-declare.js, forensic-cert.js,
        rapport-juridique.js) restent inchangés. Ils mountent leur DOM
        dans des containers cachés (#view-ca-sous-declare, #view-forensic-cert,
        #view-rapport-juridique) — ces containers existent dans index.html
        avec display:none.
     2. À la navigation vers un onglet hôte, premium-enhanced.js :
          a. Déclenche le rendu du module Premium via son API publique
             (CASousDeclare.render(), ForensicCert.renderList(), RapportJuridique.render())
          b. Attend un instant que le DOM soit peuplé
          c. DÉPLACE le contenu rendu dans une section ".pe-premium-section"
             ajoutée en bas de l'onglet hôte
     3. Pour audit-cpam : le simulateur de régulation est rendu directement
        par ce fichier (pas de module séparé), inséré en bas de la vue.

   🔒 Gating :
     • Premium actif → contenu fonctionnel intégré
     • Premium non actif → contenu grisé + cadenas (FOMO)

   📦 API publique :
     window.PremiumEnhanced.refresh()           — re-applique l'intégration
     window.PremiumEnhanced.openPaywall(featId) — ouvre la modale paywall
══════════════════════════════════════════════════ */
'use strict';

window.PremiumEnhanced = (function(){

  /* ─────────────────────────────────────────────────────────
     CONFIG : table d'intégration onglet hôte → module Premium
  ───────────────────────────────────────────────────────── */
  const INTEGRATIONS = {
    'tresor': {
      hostView: 'view-tresor',
      sourceView: 'view-ca-sous-declare',
      featId: 'ca_sous_declare',
      title: '💸 Détection CA sous-déclaré',
      tagline: 'Croisement longitudinal tournées/cotations/BSI pour récupérer les actes non-cotés.',
      trigger: () => window.CASousDeclare && CASousDeclare.render && CASousDeclare.render()
    },
    'sig': {
      hostView: 'view-sig',
      sourceView: 'view-forensic-cert',
      featId: 'forensic_certificates',
      title: '🛡️ Certificats forensiques (conformes)',
      tagline: 'Certificats horodatés RFC 3161 + chaîne SHA-256 opposable juridiquement à la CPAM.',
      trigger: () => window.ForensicCert && ForensicCert.renderList && ForensicCert.renderList()
    },
    'rapport': {
      hostView: 'view-rapport',
      sourceView: 'view-rapport-juridique',
      featId: 'rapport_juridique_mensuel',
      title: '⚖️ Rapport juridique mensuel',
      tagline: 'Synthèse mensuelle auditée : conformité, preuves collectées, exposition contentieux.',
      trigger: () => window.RapportJuridique && RapportJuridique.render && RapportJuridique.render()
    },
    'audit-cpam': {
      hostView: 'view-audit-cpam',
      sourceView: null,  // rendu directement par renderSimulateurRegulation()
      featId: 'simulateur_regulation',
      title: '⚡ Simulateur régulation CPAM',
      tagline: 'Simule l\'impact d\'une décision (indu/plafond/déconventionnement) et propose des contre-mesures.',
      trigger: null  // géré spécifiquement par injectIntoAuditCpam()
    }
  };

  /* ─────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────── */

  function _safe(s) {
    return String(s ?? '').replace(/[<>"']/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _hasFeature(featId) {
    try { return !!(window.SUB && SUB.hasAccess && SUB.hasAccess(featId)); }
    catch { return false; }
  }

  /** Vrai si l'utilisateur doit voir les badges 💎 dans la sidebar.
   *  Couvre :
   *    • Premium actif (add-on payé)
   *    • Essai gratuit en cours (TRIAL)
   *    • Admin (bypass)
   *    • Mode TEST global (démo)
   *  Le check repose sur SUB.hasAccess() qui couvre nativement ces 4 cas
   *  via la matrice d'accès de subscription.js. */
  function _canShowPremiumBadges() {
    return _hasFeature('ca_sous_declare');
  }

  /** Ajoute/retire la classe `body.has-premium` qui contrôle l'affichage
   *  des badges 💎 (cf. règle CSS dans index.html). */
  function _syncBodyClass() {
    if (!document.body) return;
    document.body.classList.toggle('has-premium', _canShowPremiumBadges());
  }

  /* ═══════════════════════════════════════════════════════
     COUCHE RENOMMAGE + ENRICHISSEMENT (7 onglets Pro)
     ────────────────────────────────────────────────────────
     Pour les abonnés Premium (et trial/admin/test), les 7 onglets Pro
     ci-dessous sont renommés ET enrichis avec des widgets Premium
     injectés en haut de leur vue (forecast, coach IA, jauge de risque…).
     Cette couche s'ajoute par-dessus l'intégration v3 (4 modules
     fusionnés dans 4 onglets hôtes) qui reste active.
  ═══════════════════════════════════════════════════════ */
  const ENRICHMENTS = {
    'copilote': {
      icon: '🤖',
      labelPro: 'Copilote IA',
      labelPremium: 'Copilote IA Pro+',
      tagline: 'Mémoire 90 jours · Analyse longitudinale du portefeuille',
      enrich: _enrichCopilote
    },
    'audit-cpam': {
      icon: '🔍',
      labelPro: 'Simulateur audit CPAM',
      labelPremium: 'Audit CPAM IA prédictif',
      tagline: 'Scoring IA prédictif + détection patterns à risque + plan d\'action',
      enrich: _enrichAuditCpam
    },
    'dash': {
      icon: '📊',
      labelPro: 'Dashboard & Statistiques',
      labelPremium: 'Dashboard prédictif',
      tagline: 'Projections 30/60/90j + alertes intelligentes + score Elite',
      enrich: _enrichDashboard
    },
    'rapport': {
      icon: '📄',
      labelPro: 'Rapport mensuel',
      labelPremium: 'Rapport mensuel intelligent',
      tagline: 'Analyse vs N-1 + détection anomalies + recommandations IA',
      enrich: _enrichRapport
    },
    'outils-charges': {
      icon: '💰',
      labelPro: 'Calcul charges & net',
      labelPremium: 'Charges & net prédictif',
      tagline: 'Projection 12 mois + alertes seuils + scenarios "et si"',
      enrich: _enrichCharges
    },
    'transmissions': {
      icon: '📝',
      labelPro: 'Transmissions infirmières',
      labelPremium: 'Transmissions smart IA',
      tagline: 'Auto-génération voix/photo + classification + alertes pertinence',
      enrich: _enrichTransmissions
    },
    'compte-rendu': {
      icon: '📋',
      labelPro: 'Compte-rendu de passage',
      labelPremium: 'Compte-rendu auto IA',
      tagline: 'CR 100 % auto-généré IA · Modèles personnalisés par patient',
      enrich: _enrichCompteRendu
    }
  };

  /** Renomme les 7 onglets Pro selon le statut Premium.
   *  Idempotent : peut être appelé à chaque sync sans effet de bord. */
  function applyLabels() {
    const isPremium = _canShowPremiumBadges();
    Object.entries(ENRICHMENTS).forEach(([dataV, cfg]) => {
      document.querySelectorAll(`.ni[data-v="${dataV}"]`).forEach(el => {
        const labelSpan = el.querySelector('.ni-label');
        if (!labelSpan) return;  // si le label n'a pas été wrappé → skip
        labelSpan.textContent = isPremium ? cfg.labelPremium : cfg.labelPro;
      });
    });
  }

  /** En-tête Premium injecté en haut d'une vue Pro enrichie. */
  function _enrichHeaderHTML(cfg) {
    return `
      <div class="pe-enrich-header" style="background:linear-gradient(135deg,rgba(198,120,221,.10),rgba(198,120,221,.02));border:1px solid rgba(198,120,221,.30);border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:28px;flex-shrink:0">💎</div>
        <div style="flex:1;min-width:200px">
          <div style="font-family:var(--fm,monospace);font-size:10px;letter-spacing:1px;color:#c678dd;font-weight:700;text-transform:uppercase">Mode Premium activé</div>
          <div style="font-size:13px;color:var(--t,#F0F4F8);margin-top:2px;line-height:1.4">${_safe(cfg.tagline)}</div>
        </div>
      </div>
    `;
  }

  /** Insère les widgets Premium en haut d'une vue Pro (après H1+intro). */
  function _injectAtTop(viewEl, html) {
    if (!viewEl) return null;
    let mount = viewEl.querySelector(':scope > .pe-enrich-mount');
    if (mount) { mount.innerHTML = html; return mount; }

    mount = document.createElement('div');
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

  /** Enrichit une vue Pro avec ses widgets Premium (uniquement si Premium). */
  function enrichView(viewKey) {
    const cfg = ENRICHMENTS[viewKey];
    if (!cfg) return;
    if (!_canShowPremiumBadges()) {
      // Non-Premium : on retire l'enrichissement éventuel pour éviter des
      // résidus si l'utilisateur a downgradé en cours de session.
      const view = document.getElementById('view-' + viewKey);
      view?.querySelector(':scope > .pe-enrich-mount')?.remove();
      return;
    }
    const view = document.getElementById('view-' + viewKey);
    if (!view) return;
    try { cfg.enrich(view, cfg); } catch (e) { console.warn('[PE] enrich KO:', viewKey, e); }
  }

  /* ───── 7 enrichers ────────────────────────────────────── */

  function _enrichCopilote(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🧠</span><strong style="font-size:14px">Suggestions IA personnalisées du jour</strong></div>
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
      } else { host.textContent = 'Module PremiumIntel non chargé.'; }
    } catch (e) { host.innerHTML = `<span style="color:var(--d,#ff5f6d)">Erreur : ${_safe(e.message)}</span>`; }
  }

  function _enrichAuditCpam(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
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
      if (!window.PremiumIntel?.snapshot) { if (actions) actions.textContent = 'PremiumIntel non chargé.'; return; }
      const snap = await PremiumIntel.snapshot();
      if (snap?.risk && riskMount && PremiumIntel.renderRiskGauge) PremiumIntel.renderRiskGauge(riskMount, snap.risk);
      const acts = snap?.risk?.actions || snap?.coach?.messages || [];
      if (actions) actions.innerHTML = acts.length
        ? `<strong>Plan d'action priorisé :</strong>` + acts.slice(0, 4).map((a, i) => {
            const t = typeof a === 'string' ? a : (a.text || a.message || '');
            return `<div style="padding:4px 0">${i+1}. ${_safe(t)}</div>`;
          }).join('')
        : 'Aucune action prioritaire détectée.';
    } catch (e) { console.warn('[PE] audit predict KO:', e); }
  }

  function _enrichDashboard(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
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
    } catch (e) { console.warn('[PE] dash predict KO:', e); }
  }

  function _enrichRapport(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px">
        <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px">
          <div style="font-family:var(--fm,monospace);font-size:10px;color:var(--m,#7c8a9a);text-transform:uppercase;letter-spacing:.5px">Évolution vs N-1</div>
          <div id="pe-rapport-yoy" style="font-size:26px;font-weight:700;color:var(--a,#00d4aa);margin-top:4px">—</div>
          <div style="font-size:11px;color:var(--m,#7c8a9a);margin-top:2px">CA mensuel sur 30 jours</div>
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
      const elA = document.getElementById('pe-rapport-anomalies');
      if (elA) elA.textContent = String((snap.risk?.flags?.length) || (snap.risk?.patterns?.length) || 0);
      const elR = document.getElementById('pe-rapport-reco');
      if (elR) elR.textContent = String((snap.coach?.messages?.length) || 0);
      if (snap.coach && PremiumIntel.renderCoachBlock) PremiumIntel.renderCoachBlock('pe-rapport-coach', snap.coach);
    } catch (e) { console.warn('[PE] rapport intel KO:', e); }
  }

  function _enrichCharges(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
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
    (async () => {
      const host = document.getElementById('pe-charges-forecast');
      if (!host || !window.PremiumIntel?.snapshot) return;
      try {
        const snap = await PremiumIntel.snapshot();
        if (snap?.forecast && PremiumIntel.renderForecastCard) PremiumIntel.renderForecastCard(host, snap.forecast);
      } catch (e) {}
    })();
  }
  function _scenarioCA(pct) {
    if (!_canShowPremiumBadges()) { openPaywall('charges_calc'); return; }
    const out = document.getElementById('pe-charges-scenario');
    if (!out) return;
    const baseCA = 5000, baseNet = baseCA * 0.55;
    const newNet = baseCA * (1 + pct/100) * 0.55;
    const sign = pct >= 0 ? '+' : '';
    out.innerHTML = `<strong>Scenario CA ${sign}${pct} %</strong> · Net mensuel estimé : <strong style="color:${pct >= 0 ? 'var(--a,#00d4aa)' : 'var(--d,#ff5f6d)'}">${Math.round(newNet)} €</strong> (Δ ${sign}${Math.round(newNet - baseNet)} €)`;
  }

  function _enrichTransmissions(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
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
    if (!_canShowPremiumBadges()) { openPaywall('transmissions'); return; }
    const out = document.getElementById('pe-transm-result');
    if (out) out.innerHTML = '<div style="padding:10px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;color:var(--m,#7c8a9a)">🎤 La capture vocale (Web Speech API + IA Grok) sera activée dans la prochaine release.</div>';
  }
  function _capturePhoto() {
    if (!_canShowPremiumBadges()) { openPaywall('transmissions'); return; }
    const out = document.getElementById('pe-transm-result');
    if (out) out.innerHTML = '<div style="padding:10px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;color:var(--m,#7c8a9a)">📷 La capture photo (OCR + extraction IA) sera activée dans la prochaine release.</div>';
  }

  function _enrichCompteRendu(view, cfg) {
    const html = `${_enrichHeaderHTML(cfg)}
      <div class="pe-card" style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:20px">🤖</span><strong style="font-size:14px">Génération auto-IA en 1 clic</strong></div>
        <div style="color:var(--m,#7c8a9a);font-size:13px;margin-bottom:10px">L'IA consolide cotations + constantes + transmissions du jour pour produire un CR complet et signé.</div>
        <button class="btn primary" style="font-size:12px" onclick="PremiumEnhanced._generateCRAuto()">⚡ Générer un CR du jour</button>
        <div id="pe-cr-result" style="margin-top:10px"></div>
      </div>`;
    _injectAtTop(view, html);
  }
  function _generateCRAuto() {
    if (!_canShowPremiumBadges()) { openPaywall('compte_rendu'); return; }
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

  function openPaywall(featId) {
    if (window.SUB && SUB.showPaywall) { SUB.showPaywall(featId); return; }
    if (typeof navTo === 'function') navTo('mon-abo');
  }

  /** Crée (ou récupère) la section Premium dans l'onglet hôte. */
  function _ensurePremiumSection(hostId, integration) {
    const host = document.getElementById(hostId);
    if (!host) return null;
    let section = host.querySelector(':scope > .pe-premium-section');
    if (section) return section;
    section = document.createElement('div');
    section.className = 'pe-premium-section';
    section.dataset.feat = integration.featId;
    section.innerHTML = `
      <h2 style="font-size:18px;margin:0 0 6px;color:var(--t,#F0F4F8)">${_safe(integration.title)}</h2>
      <p style="margin:0 0 18px;color:var(--m,#7c8a9a);font-size:13px;line-height:1.5">${_safe(integration.tagline)}</p>
      <div class="pe-premium-content"></div>
    `;
    host.appendChild(section);
    return section;
  }

  /** Vérifie le gating et applique le verrou visuel si non Premium. */
  function _applyLock(section, integration) {
    if (!section) return;
    const hasFeat = _hasFeature(integration.featId);
    if (hasFeat) {
      section.classList.remove('pe-locked');
      section.onclick = null;
    } else {
      section.classList.add('pe-locked');
      // Le ::after CSS rend le bouton paywall — on bind le click ici
      section.onclick = () => openPaywall(integration.featId);
    }
  }

  /* ═══════════════════════════════════════════════════════
     INTÉGRATION GÉNÉRIQUE (modules ca-sous-declare, forensic-cert, rapport-juridique)
  ═══════════════════════════════════════════════════════ */
  /**
   * Rend le module Premium dans son container source caché, puis déplace
   * son contenu vers la section Premium de l'onglet hôte.
   *
   * 🔒 IMPORTANT : on vérifie l'accès AVANT d'appeler trigger() pour éviter
   * que le module Premium déclenche son propre paywall via SUB.requireAccess().
   * Sinon un utilisateur Pro qui clique sur "Trésorerie" verrait un paywall
   * pour "Détection CA sous-déclaré" qu'il n'a JAMAIS demandé.
   */
  async function _integrate(hostKey) {
    const cfg = INTEGRATIONS[hostKey];
    if (!cfg || !cfg.sourceView || !cfg.trigger) return;

    const section = _ensurePremiumSection(cfg.hostView, cfg);
    if (!section) return;
    const contentMount = section.querySelector('.pe-premium-content');
    if (!contentMount) return;

    // 🔒 Pas Premium ? On affiche la section verrouillée et on s'arrête là
    //    SANS appeler trigger() (qui déclencherait un paywall parasite).
    if (!_hasFeature(cfg.featId)) {
      contentMount.innerHTML = `
        <div style="padding:40px 24px;text-align:center;color:var(--m,#7c8a9a)">
          <div style="font-size:36px;margin-bottom:10px;opacity:.6">🔒</div>
          <div style="font-size:14px;font-weight:600;color:var(--t,#F0F4F8);margin-bottom:6px">${_safe(cfg.title)}</div>
          <div style="font-size:13px;line-height:1.5;max-width:420px;margin:0 auto 14px">${_safe(cfg.tagline)}</div>
          <button onclick="event.stopPropagation();PremiumEnhanced.openPaywall('${cfg.featId}')"
                  style="background:linear-gradient(135deg,#c678dd,#9b59b6);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px">
            💎 Activer Premium
          </button>
        </div>`;
      _applyLock(section, cfg);
      return;
    }

    // ✅ Premium actif : on déclenche le rendu (await la Promise async),
    //    puis on déplace le contenu rendu dans la section hôte.
    contentMount.innerHTML = `<div style="padding:30px;text-align:center;color:var(--m,#7c8a9a);font-size:13px"><div class="spin spinw" style="width:24px;height:24px;margin:0 auto 10px"></div>Chargement…</div>`;

    try {
      // trigger() peut être sync ou async (les renders sont async)
      const ret = cfg.trigger();
      if (ret && typeof ret.then === 'function') await ret;
    } catch (e) {
      console.warn('[PE] trigger KO pour', hostKey, e);
      contentMount.innerHTML = `<div style="padding:14px;color:var(--m,#7c8a9a);font-size:13px;font-style:italic">Le module « ${_safe(cfg.title)} » n'a pas pu se charger : ${_safe(e.message)}</div>`;
      _applyLock(section, cfg);
      return;
    }

    // Polling court : on attend jusqu'à 1.5s que le DOM source soit peuplé
    //   (au cas où le render fait des accès IndexedDB / fetch supplémentaires
    //    après avoir résolu sa Promise principale).
    const source = document.getElementById(cfg.sourceView);
    if (!source) {
      contentMount.innerHTML = `<div style="padding:14px;color:var(--m,#7c8a9a);font-size:13px;font-style:italic">Mount caché « #${cfg.sourceView} » introuvable.</div>`;
      _applyLock(section, cfg);
      return;
    }

    const deadline = Date.now() + 1500;
    while (source.childElementCount === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 80));
    }

    // Déplace tous les enfants du source dans le mount du host
    contentMount.innerHTML = '';
    while (source.firstChild) contentMount.appendChild(source.firstChild);

    // Si après tout ça le contenu est vide → message informatif
    if (contentMount.childElementCount === 0) {
      contentMount.innerHTML = `<div style="padding:14px;color:var(--m,#7c8a9a);font-size:13px;font-style:italic">Aucune donnée à afficher pour ce module.</div>`;
    }

    _applyLock(section, cfg);
  }

  /* ═══════════════════════════════════════════════════════
     INTÉGRATION SPÉCIFIQUE — Simulateur régulation dans Audit CPAM
  ═══════════════════════════════════════════════════════ */
  function _injectIntoAuditCpam() {
    const cfg = INTEGRATIONS['audit-cpam'];
    const section = _ensurePremiumSection(cfg.hostView, cfg);
    if (!section) return;
    const contentMount = section.querySelector('.pe-premium-content');
    if (!contentMount) return;

    contentMount.innerHTML = `
      <div style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:14px;padding:18px">
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
      <div id="pe-reg-result" style="margin-top:14px"></div>
    `;
    _applyLock(section, cfg);
  }

  function _simulateRegulation() {
    if (!_hasFeature('simulateur_regulation')) { openPaywall('simulateur_regulation'); return; }
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
      <div style="background:var(--c,#101720);border:1px solid var(--b,#1f2935);border-radius:14px;padding:18px">
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
     ROUTAGE — déclenche l'intégration au bon moment
  ═══════════════════════════════════════════════════════ */
  function applyForView(viewKey) {
    if (!INTEGRATIONS[viewKey]) return;
    if (viewKey === 'audit-cpam') {
      _injectIntoAuditCpam();
    } else {
      _integrate(viewKey);
    }
  }

  /** Re-applique toutes les intégrations (utile après changement d'état SUB). */
  function refresh() {
    Object.keys(INTEGRATIONS).forEach(key => {
      const view = document.getElementById('view-' + key);
      if (view && view.classList.contains('on')) applyForView(key);
    });
  }

  /* ─── Hook navigation ───
     On laisse 350ms au module hôte (tresorerie.js, signature.js, etc.)
     pour rendre son contenu d'origine, puis on injecte la section Premium. */
  document.addEventListener('ui:navigate', e => {
    const v = e.detail?.view;
    // v3 : intégration des 4 modules Premium dans 4 onglets hôtes
    if (INTEGRATIONS[v]) setTimeout(() => applyForView(v), 350);
    // v2 : enrichissement (widgets) des 7 onglets Pro pour les abonnés Premium
    if (ENRICHMENTS[v]) setTimeout(() => enrichView(v), 200);
  });

  /* Sync initial du badge visibility (au DOM ready + après bootstrap SUB).
     SUB.bootstrap est asynchrone (fetch worker), on attend ~1s pour que
     l'état soit hydraté avant de calculer les visibilités. */
  function _initialSync() {
    _syncBodyClass();
    applyLabels();
    setTimeout(() => { _syncBodyClass(); applyLabels(); }, 800);   // après bootstrap SUB
    setTimeout(() => { _syncBodyClass(); applyLabels(); }, 2000);  // filet de sécurité si worker lent
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initialSync);
  } else {
    _initialSync();
  }

  /* Re-applique le verrou + badge visibility + labels si le statut Premium
     change (admin sim, expiration trial, activation add-on, etc.). */
  setInterval(() => {
    const wasPremium = document.body.dataset.peLastPremium === '1';
    const isPremium = _canShowPremiumBadges();
    if (wasPremium !== isPremium) {
      document.body.dataset.peLastPremium = isPremium ? '1' : '0';
      _syncBodyClass();
      applyLabels();
      // Re-applique sur l'onglet courant si c'est un onglet enrichi
      Object.keys(INTEGRATIONS).forEach(k => {
        const section = document.querySelector(`#view-${k} > .pe-premium-section`);
        if (section) _applyLock(section, INTEGRATIONS[k]);
      });
      // Si l'utilisateur a downgradé : retirer les enrichissements v2
      if (!isPremium) {
        Object.keys(ENRICHMENTS).forEach(k => {
          document.querySelector(`#view-${k} > .pe-enrich-mount`)?.remove();
        });
      } else {
        // Upgrade : si l'utilisateur est sur une vue enrichie, injecter
        Object.keys(ENRICHMENTS).forEach(k => {
          const view = document.getElementById('view-' + k);
          if (view?.classList.contains('on')) enrichView(k);
        });
      }
    }
  }, 3000);

  /* ═══════════════════════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════════════════════ */
  return {
    refresh,
    openPaywall,
    applyForView,
    // v2 : renommage + enrichissement widgets
    applyLabels,
    enrichView,
    // internes (onclick inline)
    _simulateRegulation,
    _scenarioCA,
    _captureVoice,
    _capturePhoto,
    _generateCRAuto
  };
})();
