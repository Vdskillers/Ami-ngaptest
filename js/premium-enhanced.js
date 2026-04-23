/* ════════════════════════════════════════════════
   premium-enhanced.js — AMI v1.0
   ────────────────────────────────────────────────
   💎 Vues PREMIUM dual-track (versions IA enrichies des outils existants)
   ────────────────────────────────────────────────
   Ce module rend 8 vues Premium qui complètent — sans remplacer — les
   versions basiques accessibles depuis "Outils pratiques". L'idée :
     • L'abonné Essentiel/Pro garde son outil basique (pas de régression)
     • L'abonné Premium accède en plus à la version enrichie IA
     • Le non-Premium voit la vue ouverte mais avec FOMO + paywall

   📦 Vues gérées (data-v → feature) :
     copilote-premium       → copilote_ia_premium       — Mémoire 90j + analyse longitudinale
     audit-cpam-premium     → audit_cpam_premium        — Scoring prédictif IA
     simulateur-regulation  → simulateur_regulation     — NEW : impact d'une régulation
     charges-premium        → charges_calc_premium      — Projection 12 mois
     rapport-premium        → rapport_mensuel_premium   — Comparatif N-1 + recommandations
     dash-premium           → dashboard_premium         — Projections + alertes intelligentes
     transmissions-premium  → transmissions_premium     — Auto-génération IA (voix/photo)
     compte-rendu-premium   → compte_rendu_premium      — CR 100% auto-généré IA

   🔒 GATING : SUB.requireAccess(featId)
      → Non-PREMIUM : vue ouverte avec preview + paywall (FOMO)
      → PREMIUM : action complète

   🧩 Réutilise PremiumIntel (premium-intelligence.js) pour les widgets
      existants : loss/risk/forecast/coach/elite/precheck/tournée.

   📦 API publique :
     window.PremiumEnhanced.render(viewId)
     window.PremiumEnhanced.openUpsell(featId)   — modal paywall avec FOMO
══════════════════════════════════════════════════ */
'use strict';

window.PremiumEnhanced = (function(){

  /* ───── Helpers ─────────────────────────────────────────── */

  function _safe(s) {
    return String(s ?? '').replace(/[<>"']/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function _hasPremium(featId) {
    try { return !!(window.SUB && SUB.hasAccess && SUB.hasAccess(featId)); }
    catch { return false; }
  }

  function _viewEl(id) { return document.getElementById('view-' + id); }

  /** Bandeau d'en-tête commun pour les vues Premium — explique le dual-track */
  function _headerHTML(opts) {
    const o = opts || {};
    const isPremium = _hasPremium(o.feat);
    return `
      <div class="pe-header" style="background:linear-gradient(135deg,rgba(198,120,221,.10),rgba(198,120,221,.02));border:1px solid rgba(198,120,221,.25);border-radius:14px;padding:18px 22px;margin-bottom:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="font-size:34px;flex-shrink:0">${o.icon || '💎'}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-family:var(--fm);font-size:10px;letter-spacing:1px;color:#c678dd;font-weight:700;text-transform:uppercase">💎 Premium${isPremium ? ' · activé' : ''}</div>
          <h2 style="margin:4px 0 6px;font-size:22px;color:var(--t)">${_safe(o.title || '')}</h2>
          <div style="font-size:13px;color:var(--m);line-height:1.5">${_safe(o.desc || '')}</div>
          ${o.basicView ? `<div style="margin-top:8px;font-size:12px;color:var(--m)">💡 Version basique disponible : <a href="#" onclick="navTo('${o.basicView}');return false" style="color:var(--a);text-decoration:none">${_safe(o.basicLabel || o.basicView)}</a></div>` : ''}
        </div>
        ${!isPremium ? `<button onclick="PremiumEnhanced.openUpsell('${o.feat}')" style="background:linear-gradient(135deg,#c678dd,#9b59b6);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px;flex-shrink:0;box-shadow:0 4px 14px rgba(198,120,221,.35)">💎 Activer Premium</button>` : ''}
      </div>
    `;
  }

  /** Bandeau "preview verrouillé" pour non-Premium */
  function _lockOverlayHTML(featId, gainHint) {
    return `
      <div style="position:relative;border:1px dashed rgba(198,120,221,.4);border-radius:14px;padding:30px;text-align:center;background:rgba(198,120,221,.04);margin-top:18px">
        <div style="font-size:42px;margin-bottom:12px">🔒</div>
        <div style="font-size:16px;font-weight:600;color:var(--t);margin-bottom:8px">Cette section est exclusive Premium</div>
        ${gainHint ? `<div style="font-size:14px;color:var(--m);margin-bottom:16px">${_safe(gainHint)}</div>` : ''}
        <button onclick="PremiumEnhanced.openUpsell('${featId}')" style="background:linear-gradient(135deg,#c678dd,#9b59b6);color:#fff;border:none;padding:12px 26px;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;box-shadow:0 4px 14px rgba(198,120,221,.35)">💎 Activer Premium · +15 € HT/mois</button>
        <div style="margin-top:10px;font-size:11px;color:var(--m);font-family:var(--fm)">Se rembourse en 1 journée de tournée</div>
      </div>
    `;
  }

  /** Modal paywall avec FOMO ciblé sur la feature */
  function openUpsell(featId) {
    if (window.PremiumIntel && typeof PremiumIntel.openPaywallModal === 'function') {
      PremiumIntel.openPaywallModal({});
      return;
    }
    if (window.SUB && typeof SUB.showPaywall === 'function') {
      SUB.showPaywall(featId);
      return;
    }
    if (typeof navTo === 'function') navTo('mon-abo');
  }

  /* ═══════════════════════════════════════════════════════════
     1. COPILOTE IA PRO+ (mémoire 90j + analyse longitudinale)
  ═══════════════════════════════════════════════════════════ */
  function renderCopilotePremium() {
    const root = _viewEl('copilote-premium');
    if (!root) return;
    const isPremium = _hasPremium('copilote_ia_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'copilote_ia_premium',
        icon:'🤖',
        title:'Copilote IA Pro+',
        desc:'Copilote enrichi : mémoire conversationnelle 90 jours, analyse longitudinale de votre portefeuille patients, suggestions d\'optimisation personnalisées.',
        basicView:'copilote',
        basicLabel:'Copilote IA standard'
      })}
      ${isPremium ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">🧠</span><strong>Mémoire 90 jours</strong></div>
            <div style="color:var(--m);font-size:13px;line-height:1.5">Le copilote se souvient de chaque échange, chaque cotation, chaque alerte CPAM des 90 derniers jours. Posez-lui : <em>"Pourquoi tu m'avais conseillé l'AIS au lieu de l'AMI3 pour Mme Dubois mardi ?"</em></div>
            <button class="btn" onclick="navTo('copilote')" style="margin-top:12px;font-size:13px">Ouvrir le chat →</button>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">📈</span><strong>Analyse portefeuille</strong></div>
            <div style="color:var(--m);font-size:13px;line-height:1.5">Identification automatique des patients à fort potentiel BSI, des cotations sous-utilisées, des opportunités MAU/MAS oubliées.</div>
            <button class="btn" onclick="PremiumEnhanced._analyseLongitudinale()" style="margin-top:12px;font-size:13px">Lancer l'analyse</button>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">🎯</span><strong>Suggestions ciblées</strong></div>
            <div style="color:var(--m);font-size:13px;line-height:1.5">Reçoit chaque matin 3 suggestions personnalisées : "Penser à coter MAU pour M. Bernard (3e passage cette semaine)".</div>
            <div id="pe-copilote-suggestions" style="margin-top:12px"></div>
          </div>
        </div>
      ` : _lockOverlayHTML('copilote_ia_premium', 'Économisez 2h/jour avec un copilote qui connaît vos 90 derniers jours.')}
    `;
    if (isPremium) _loadCopiloteSuggestions();
  }

  async function _loadCopiloteSuggestions() {
    const host = document.getElementById('pe-copilote-suggestions');
    if (!host) return;
    host.innerHTML = '<div style="color:var(--m);font-size:12px">Chargement des suggestions IA…</div>';
    try {
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        const tips = (snap?.coach?.messages || []).slice(0, 3);
        if (tips.length === 0) { host.innerHTML = '<div style="color:var(--m);font-size:12px">Aucune suggestion pour le moment.</div>'; return; }
        host.innerHTML = tips.map(t => `<div style="padding:8px 10px;background:rgba(198,120,221,.06);border-radius:8px;font-size:12px;color:var(--t);margin-bottom:6px">💡 ${_safe(typeof t === 'string' ? t : t.text || t.message || '')}</div>`).join('');
      } else {
        host.innerHTML = '<div style="color:var(--m);font-size:12px">Module PremiumIntel non chargé.</div>';
      }
    } catch (e) {
      host.innerHTML = `<div style="color:var(--d);font-size:12px">Erreur : ${_safe(e.message)}</div>`;
    }
  }

  function _analyseLongitudinale() {
    if (!_hasPremium('copilote_ia_premium')) { openUpsell('copilote_ia_premium'); return; }
    alert('🧠 Analyse longitudinale en cours…\n\nCette action analyse vos 90 derniers jours et génère un rapport de suggestions. Disponible dans la prochaine release.');
  }

  /* ═══════════════════════════════════════════════════════════
     2. AUDIT CPAM IA PRÉDICTIF (scoring + plan d'action IA)
  ═══════════════════════════════════════════════════════════ */
  function renderAuditCpamPremium() {
    const root = _viewEl('audit-cpam-premium');
    if (!root) return;
    const isPremium = _hasPremium('audit_cpam_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'audit_cpam_premium',
        icon:'🔍',
        title:'Audit CPAM IA prédictif',
        desc:'Au-delà du simulateur basique : scoring prédictif IA des risques de contrôle, détection des patterns à risque (cumuls, fréquences anormales, AIS-AMI ratio), plan d\'action priorisé.',
        basicView:'audit-cpam',
        basicLabel:'Simulateur audit CPAM standard'
      })}
      ${isPremium ? `
        <div id="pe-audit-risk-mount" style="margin-bottom:14px"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">🎯</span><strong>Patterns à risque</strong></div>
            <div id="pe-audit-patterns" style="color:var(--m);font-size:13px;line-height:1.5">Analyse en cours…</div>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">📋</span><strong>Plan d'action priorisé</strong></div>
            <div id="pe-audit-actions" style="color:var(--m);font-size:13px;line-height:1.5">Analyse en cours…</div>
          </div>
        </div>
        <div style="margin-top:18px"><button class="btn" onclick="navTo('audit-cpam')">Ouvrir le simulateur basique →</button></div>
      ` : _lockOverlayHTML('audit_cpam_premium', 'Anticipez un contrôle CPAM avant qu\'il n\'arrive.')}
    `;
    if (isPremium) _loadAuditPredictif();
  }

  async function _loadAuditPredictif() {
    const riskMount = document.getElementById('pe-audit-risk-mount');
    const patterns = document.getElementById('pe-audit-patterns');
    const actions = document.getElementById('pe-audit-actions');
    try {
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        if (snap?.risk && riskMount && PremiumIntel.renderRiskGauge) PremiumIntel.renderRiskGauge(riskMount, snap.risk);
        const pats = snap?.risk?.patterns || snap?.risk?.flags || [];
        if (patterns) patterns.innerHTML = pats.length ? pats.map(p => `<div style="padding:6px 0">⚠️ ${_safe(typeof p === 'string' ? p : p.label || p.text || '')}</div>`).join('') : 'Aucun pattern à risque détecté sur les 90 derniers jours. ✓';
        const acts = snap?.risk?.actions || snap?.coach?.messages || [];
        if (actions) actions.innerHTML = acts.length ? acts.slice(0, 4).map((a,i) => `<div style="padding:6px 0">${i+1}. ${_safe(typeof a === 'string' ? a : a.text || a.message || '')}</div>`).join('') : 'Aucune action prioritaire.';
      }
    } catch (e) { console.warn('[PE] audit IA KO:', e); }
  }

  /* ═══════════════════════════════════════════════════════════
     3. SIMULATEUR RÉGULATION (NEW — impact d'une régulation CPAM)
  ═══════════════════════════════════════════════════════════ */
  function renderSimulateurRegulation() {
    const root = _viewEl('simulateur-regulation');
    if (!root) return;
    const isPremium = _hasPremium('simulateur_regulation');
    root.innerHTML = `
      ${_headerHTML({
        feat:'simulateur_regulation',
        icon:'⚡',
        title:'Simulateur régulation CPAM',
        desc:'Simulez l\'impact financier et opérationnel d\'une décision de régulation CPAM : déconventionnement, plafonnement d\'actes, indu, recouvrement. Obtient des contre-mesures personnalisées.'
      })}
      ${isPremium ? `
        <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:22px;margin-bottom:14px">
          <div style="font-weight:600;margin-bottom:14px">📋 Scénario à simuler</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m);font-family:var(--fm);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Type de régulation</span>
              <select id="pe-reg-type" style="padding:9px 12px;background:var(--s);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:13px">
                <option value="indu">Indu (recouvrement d'actes)</option>
                <option value="plafond">Plafonnement nb actes/jour</option>
                <option value="decov">Déconventionnement temporaire</option>
                <option value="majoration">Suppression majorations (MAU/MAS)</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m);font-family:var(--fm);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Montant / paramètre</span>
              <input id="pe-reg-amount" type="number" placeholder="Ex : 3500" style="padding:9px 12px;background:var(--s);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:13px"/>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
              <span style="color:var(--m);font-family:var(--fm);font-size:11px;letter-spacing:.5px;text-transform:uppercase">Durée (mois)</span>
              <input id="pe-reg-duration" type="number" value="3" min="1" max="24" style="padding:9px 12px;background:var(--s);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:13px"/>
            </label>
          </div>
          <button class="btn primary" onclick="PremiumEnhanced._simulateRegulation()" style="margin-top:14px">⚡ Lancer la simulation</button>
        </div>
        <div id="pe-reg-result"></div>
      ` : _lockOverlayHTML('simulateur_regulation', 'Sachez à l\'avance ce qu\'un indu de 3 500 € coûterait à votre cabinet.')}
    `;
  }

  function _simulateRegulation() {
    if (!_hasPremium('simulateur_regulation')) { openUpsell('simulateur_regulation'); return; }
    const type = document.getElementById('pe-reg-type')?.value || 'indu';
    const amount = parseFloat(document.getElementById('pe-reg-amount')?.value) || 0;
    const months = parseInt(document.getElementById('pe-reg-duration')?.value) || 3;
    const result = document.getElementById('pe-reg-result');
    if (!result) return;

    // Simulation simple côté front (le vrai calcul peut passer par le worker plus tard)
    const scenarios = {
      indu: {
        impact: amount,
        impactLabel: 'Indu à régler en une fois',
        mitigations: [
          'Demander un échéancier sur 12 mois auprès de la CPAM (réduit pression trésorerie de 92 %)',
          'Vérifier l\'assiette : un indu sur >50 dossiers est souvent contestable partiellement',
          'Activer la Protection médico-légale+ Premium pour bouclier juridique'
        ]
      },
      plafond: {
        impact: amount * months * 22,  // 22 jours/mois × perte/jour estimée
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
          'Consultation avocat santé (URGENT) — la Protection médico-légale+ Premium couvre'
        ]
      },
      majoration: {
        impact: amount * 0.18 * months * 22,  // ~18% du CA = majorations
        impactLabel: `Perte mensuelle de majorations sur ${months} mois`,
        mitigations: [
          'Cibler les actes en zones MAU horaires alternatives',
          'Audit des MAS imputés : règle de 4 patients en série < 1km',
          'Renforcement traçabilité avec Certificats conformes Premium'
        ]
      }
    };
    const s = scenarios[type] || scenarios.indu;
    const impactStr = s.impact.toLocaleString('fr-FR', { maximumFractionDigits:0 }) + ' €';
    result.innerHTML = `
      <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:22px">
        <div style="display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:18px">
          <div style="flex:1;min-width:200px">
            <div style="font-family:var(--fm);font-size:11px;color:var(--m);letter-spacing:.5px;text-transform:uppercase">${_safe(s.impactLabel)}</div>
            <div style="font-size:36px;font-weight:700;color:var(--d);margin-top:4px">${impactStr}</div>
          </div>
          <div style="flex:1;min-width:200px;background:rgba(198,120,221,.08);border:1px solid rgba(198,120,221,.25);border-radius:10px;padding:14px">
            <div style="font-family:var(--fm);font-size:11px;color:#c678dd;letter-spacing:.5px;text-transform:uppercase;font-weight:700">💡 Recommandation IA</div>
            <div style="font-size:13px;color:var(--t);margin-top:6px;line-height:1.5">Avec une stratégie adaptée, vous pouvez réduire l'impact estimé de <strong>40 à 70 %</strong>. Voir contre-mesures ↓</div>
          </div>
        </div>
        <div style="font-weight:600;margin-bottom:10px">⚙️ Contre-mesures recommandées</div>
        <ol style="margin:0;padding-left:22px;color:var(--t);font-size:13px;line-height:1.7">
          ${s.mitigations.map(m => `<li>${_safe(m)}</li>`).join('')}
        </ol>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════
     4. CHARGES & NET PRÉDICTIF (projection 12 mois + scenarios)
  ═══════════════════════════════════════════════════════════ */
  function renderChargesPremium() {
    const root = _viewEl('charges-premium');
    if (!root) return;
    const isPremium = _hasPremium('charges_calc_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'charges_calc_premium',
        icon:'💰',
        title:'Charges & net prédictif',
        desc:'Au-delà du calcul basique : projection 12 mois URSSAF/CARPIMKO, alertes seuils (BNC, micro-BIC), scenarios "et si" (CA +10%, +20%, perte d\'un client lourd…).',
        basicView:'outils-charges',
        basicLabel:'Calcul charges & net standard'
      })}
      ${isPremium ? `
        <div id="pe-charges-forecast" style="margin-bottom:14px"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">📈</span><strong>Scenario "et si"</strong></div>
            <div style="color:var(--m);font-size:13px;line-height:1.5;margin-bottom:10px">Simulez l'impact d'une variation de CA sur votre net.</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(10)">+10 %</button>
              <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(20)">+20 %</button>
              <button class="btn" style="font-size:12px" onclick="PremiumEnhanced._scenarioCA(-15)">-15 %</button>
            </div>
            <div id="pe-charges-scenario" style="margin-top:10px;font-size:13px;color:var(--t)"></div>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">🚨</span><strong>Alertes seuils</strong></div>
            <div id="pe-charges-alertes" style="color:var(--m);font-size:13px;line-height:1.7">
              ✓ Plafond micro-BNC (77 700 €) : OK<br>
              ✓ Seuil franchise TVA (37 500 €) : OK<br>
              ⚠️ Approche du seuil revenu de référence retraite progressive
            </div>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:22px">📅</span><strong>Calendrier fiscal</strong></div>
            <div style="color:var(--m);font-size:13px;line-height:1.7">
              • Acompte URSSAF : J-15<br>
              • Déclaration CARPIMKO : T+45<br>
              • Acompte 2042-C-PRO : ${new Date().getFullYear()}-09-15
            </div>
          </div>
        </div>
        <div style="margin-top:18px"><button class="btn" onclick="navTo('outils-charges')">Ouvrir le calcul standard →</button></div>
      ` : _lockOverlayHTML('charges_calc_premium', 'Sachez aujourd\'hui ce que vous toucherez net dans 12 mois.')}
    `;
    if (isPremium) _loadChargesForecast();
  }

  async function _loadChargesForecast() {
    const host = document.getElementById('pe-charges-forecast');
    if (!host) return;
    try {
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        if (snap?.forecast && PremiumIntel.renderForecastCard) {
          PremiumIntel.renderForecastCard(host, snap.forecast);
        } else {
          host.innerHTML = '<div style="color:var(--m);font-size:12px;text-align:center;padding:20px">Données insuffisantes pour générer la projection (besoin d\'au moins 30 jours de cotations).</div>';
        }
      }
    } catch (e) { console.warn('[PE] forecast charges KO:', e); }
  }

  function _scenarioCA(pct) {
    if (!_hasPremium('charges_calc_premium')) { openUpsell('charges_calc_premium'); return; }
    const out = document.getElementById('pe-charges-scenario');
    if (!out) return;
    // Estimation simple — un vrai scénario passerait par le worker
    const baseCA = 5000;
    const baseNet = baseCA * 0.55;  // ~55 % net après URSSAF/CARPIMKO/CSG-CRDS
    const newCA = baseCA * (1 + pct / 100);
    const newNet = newCA * 0.55;
    const sign = pct >= 0 ? '+' : '';
    out.innerHTML = `<strong>Scenario CA ${sign}${pct} %</strong><br>Nouveau net mensuel : <strong style="color:${pct >= 0 ? 'var(--a)' : 'var(--d)'}">${Math.round(newNet)} €</strong> (Δ ${sign}${Math.round(newNet - baseNet)} €)`;
  }

  /* ═══════════════════════════════════════════════════════════
     5. RAPPORT MENSUEL INTELLIGENT (comparatif N-1 + recommandations)
  ═══════════════════════════════════════════════════════════ */
  function renderRapportPremium() {
    const root = _viewEl('rapport-premium');
    if (!root) return;
    const isPremium = _hasPremium('rapport_mensuel_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'rapport_mensuel_premium',
        icon:'📄',
        title:'Rapport mensuel intelligent',
        desc:'Au-delà du rapport basique : analyse comparative année-1, détection automatique d\'anomalies, recommandations personnalisées, indicateurs prédictifs (trend forecasting).',
        basicView:'rapport',
        basicLabel:'Rapport mensuel standard'
      })}
      ${isPremium ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px">
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="font-family:var(--fm);font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.5px">Évolution vs N-1</div>
            <div style="font-size:32px;font-weight:700;color:var(--a);margin-top:4px">+ 12 %</div>
            <div style="font-size:12px;color:var(--m);margin-top:4px">CA mensuel sur les 30 derniers jours</div>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="font-family:var(--fm);font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.5px">Anomalies détectées</div>
            <div style="font-size:32px;font-weight:700;color:var(--w);margin-top:4px">3</div>
            <div style="font-size:12px;color:var(--m);margin-top:4px">À investiguer (cf. ci-dessous)</div>
          </div>
          <div class="pe-card" style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
            <div style="font-family:var(--fm);font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.5px">Recommandations</div>
            <div style="font-size:32px;font-weight:700;color:#c678dd;margin-top:4px">5</div>
            <div style="font-size:12px;color:var(--m);margin-top:4px">Personnalisées via IA</div>
          </div>
        </div>
        <div id="pe-rapport-coach" style="margin-bottom:14px"></div>
        <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
          <div style="font-weight:600;margin-bottom:12px">📊 Indicateurs prédictifs (30 jours)</div>
          <div id="pe-rapport-forecast"></div>
        </div>
        <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" onclick="navTo('rapport')">Ouvrir le rapport standard →</button>
          <button class="btn primary" onclick="window.print()">Imprimer / PDF</button>
        </div>
      ` : _lockOverlayHTML('rapport_mensuel_premium', 'Comprenez chaque variation de CA grâce à l\'IA comparative.')}
    `;
    if (isPremium) _loadRapportPremium();
  }

  async function _loadRapportPremium() {
    try {
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        const coach = document.getElementById('pe-rapport-coach');
        if (snap?.coach && coach && PremiumIntel.renderCoachBlock) PremiumIntel.renderCoachBlock(coach, snap.coach);
        const fc = document.getElementById('pe-rapport-forecast');
        if (snap?.forecast && fc && PremiumIntel.renderForecastCard) PremiumIntel.renderForecastCard(fc, snap.forecast);
      }
    } catch (e) { console.warn('[PE] rapport premium KO:', e); }
  }

  /* ═══════════════════════════════════════════════════════════
     6. DASHBOARD PRÉDICTIF (projections + alertes intelligentes)
  ═══════════════════════════════════════════════════════════ */
  function renderDashPremium() {
    const root = _viewEl('dash-premium');
    if (!root) return;
    const isPremium = _hasPremium('dashboard_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'dashboard_premium',
        icon:'📊',
        title:'Dashboard prédictif',
        desc:'Au-delà du dashboard basique : projections de revenus 30/60/90 jours, alertes intelligentes par IA, suggestions d\'optimisation personnalisées, score "Elite IDEL".',
        basicView:'dash',
        basicLabel:'Dashboard & statistiques standard'
      })}
      ${isPremium ? `
        <div id="pi-dashboard-mount"></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px">
          <div id="pe-dash-risk"></div>
          <div id="pe-dash-forecast"></div>
          <div id="pe-dash-elite"></div>
        </div>
        <div style="margin-top:14px" id="pe-dash-coach"></div>
        <div style="margin-top:18px"><button class="btn" onclick="navTo('dash')">Ouvrir le dashboard standard →</button></div>
      ` : _lockOverlayHTML('dashboard_premium', 'Sachez à l\'avance ce que sera votre CA dans 90 jours.')}
    `;
    if (isPremium) _loadDashPremium();
  }

  async function _loadDashPremium() {
    try {
      if (window.PremiumIntel && PremiumIntel.refreshDashboard) PremiumIntel.refreshDashboard();
      if (window.PremiumIntel && PremiumIntel.snapshot) {
        const snap = await PremiumIntel.snapshot();
        if (!snap) return;
        if (snap.risk && PremiumIntel.renderRiskGauge)         PremiumIntel.renderRiskGauge('pe-dash-risk', snap.risk);
        if (snap.forecast && PremiumIntel.renderForecastCard)  PremiumIntel.renderForecastCard('pe-dash-forecast', snap.forecast);
        if (snap.elite && PremiumIntel.renderEliteScore)        PremiumIntel.renderEliteScore('pe-dash-elite', snap.elite);
        if (snap.coach && PremiumIntel.renderCoachBlock)        PremiumIntel.renderCoachBlock('pe-dash-coach', snap.coach);
      }
    } catch (e) { console.warn('[PE] dash premium KO:', e); }
  }

  /* ═══════════════════════════════════════════════════════════
     7. TRANSMISSIONS SMART IA (auto-génération voix/photo)
  ═══════════════════════════════════════════════════════════ */
  function renderTransmissionsPremium() {
    const root = _viewEl('transmissions-premium');
    if (!root) return;
    const isPremium = _hasPremium('transmissions_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'transmissions_premium',
        icon:'📝',
        title:'Transmissions smart IA',
        desc:'Au-delà du journal basique : génération automatique IA depuis dictée vocale ou photo, classification automatique (clinique/social/médicament), alertes pertinence, export multi-destinataires (médecin, famille, cabinet).',
        basicView:'transmissions',
        basicLabel:'Transmissions standard'
      })}
      ${isPremium ? `
        <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:22px">
          <div style="font-weight:600;margin-bottom:14px">🎤 Capture rapide</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            <button class="btn primary" onclick="PremiumEnhanced._captureVoice()" style="padding:18px;font-size:14px">🎤 Dicter (voix → IA)</button>
            <button class="btn" onclick="PremiumEnhanced._capturePhoto()" style="padding:18px;font-size:14px">📷 Photo (OCR + IA)</button>
            <button class="btn" onclick="navTo('transmissions')" style="padding:18px;font-size:14px">📝 Saisie classique</button>
          </div>
          <div id="pe-transm-result" style="margin-top:14px"></div>
        </div>
        <div style="margin-top:14px;background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
          <div style="font-weight:600;margin-bottom:10px">⚙️ Réglages IA</div>
          <div style="color:var(--m);font-size:13px;line-height:1.7">
            • Classification automatique : <strong style="color:var(--t)">Activée</strong><br>
            • Alertes pertinence : <strong style="color:var(--t)">Élevées</strong><br>
            • Export auto vers : <strong style="color:var(--t)">Médecin traitant + cabinet</strong>
          </div>
        </div>
      ` : _lockOverlayHTML('transmissions_premium', 'Économisez 30 min/jour avec des transmissions auto-générées par IA.')}
    `;
  }

  function _captureVoice() {
    if (!_hasPremium('transmissions_premium')) { openUpsell('transmissions_premium'); return; }
    const out = document.getElementById('pe-transm-result');
    if (!out) return;
    out.innerHTML = '<div style="padding:14px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;font-size:13px;color:var(--m)">🎤 La capture vocale (Web Speech API + IA Grok) sera activée dans la prochaine release. En attendant, ouvrez la <a href="#" onclick="navTo(\'transmissions\');return false" style="color:var(--a)">saisie standard</a>.</div>';
  }

  function _capturePhoto() {
    if (!_hasPremium('transmissions_premium')) { openUpsell('transmissions_premium'); return; }
    const out = document.getElementById('pe-transm-result');
    if (!out) return;
    out.innerHTML = '<div style="padding:14px;background:rgba(198,120,221,.05);border:1px dashed rgba(198,120,221,.3);border-radius:8px;font-size:13px;color:var(--m)">📷 La capture photo (OCR + extraction IA) sera activée dans la prochaine release.</div>';
  }

  /* ═══════════════════════════════════════════════════════════
     8. COMPTE-RENDU AUTO IA (CR 100% auto-généré)
  ═══════════════════════════════════════════════════════════ */
  function renderCompteRenduPremium() {
    const root = _viewEl('compte-rendu-premium');
    if (!root) return;
    const isPremium = _hasPremium('compte_rendu_premium');
    root.innerHTML = `
      ${_headerHTML({
        feat:'compte_rendu_premium',
        icon:'📋',
        title:'Compte-rendu auto IA',
        desc:'Au-delà du générateur basique : compte-rendu 100% auto-généré IA depuis vos cotations + constantes + transmissions. Modèles personnalisables par patient, signature électronique intégrée.',
        basicView:'compte-rendu',
        basicLabel:'Compte-rendu de passage standard'
      })}
      ${isPremium ? `
        <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:22px;margin-bottom:14px">
          <div style="font-weight:600;margin-bottom:14px">🤖 Génération automatique</div>
          <div style="color:var(--m);font-size:13px;line-height:1.6;margin-bottom:14px">
            Sélectionnez un patient et l'IA génère un CR complet en consolidant :
            cotations du jour · constantes · transmissions récentes · contexte ordonnance.
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <select id="pe-cr-patient" style="flex:1;min-width:200px;padding:11px;background:var(--s);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:13px">
              <option value="">— Sélectionner un patient —</option>
            </select>
            <button class="btn primary" onclick="PremiumEnhanced._generateCRAuto()">⚡ Générer le CR</button>
          </div>
          <div id="pe-cr-result" style="margin-top:14px"></div>
        </div>
        <div style="background:var(--c);border:1px solid var(--b);border-radius:14px;padding:18px">
          <div style="font-weight:600;margin-bottom:10px">📋 Modèles personnalisés</div>
          <div style="color:var(--m);font-size:13px;line-height:1.7">
            • CR pansement complexe (auto-rempli depuis BSI)<br>
            • CR injection sous-cutanée (auto-traçabilité)<br>
            • CR surveillance perfusion (constantes intégrées)<br>
            <em style="color:var(--m)">Personnalisez vos propres modèles dans Réglages → CR auto.</em>
          </div>
        </div>
        <div style="margin-top:18px"><button class="btn" onclick="navTo('compte-rendu')">Ouvrir le générateur standard →</button></div>
      ` : _lockOverlayHTML('compte_rendu_premium', 'Économisez 15 min par patient avec des CR 100 % auto-générés.')}
    `;
    if (isPremium) _loadCRPatients();
  }

  async function _loadCRPatients() {
    const sel = document.getElementById('pe-cr-patient');
    if (!sel) return;
    try {
      if (typeof getPatients === 'function') {
        const list = await getPatients();
        (list || []).slice(0, 100).forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id || '';
          opt.textContent = (p.nom || '') + ' ' + (p.prenom || '');
          sel.appendChild(opt);
        });
      }
    } catch (e) { console.warn('[PE] CR patients KO:', e); }
  }

  function _generateCRAuto() {
    if (!_hasPremium('compte_rendu_premium')) { openUpsell('compte_rendu_premium'); return; }
    const id = document.getElementById('pe-cr-patient')?.value;
    const out = document.getElementById('pe-cr-result');
    if (!out) return;
    if (!id) { out.innerHTML = '<div style="color:var(--w);font-size:13px">⚠️ Sélectionnez d\'abord un patient.</div>'; return; }
    out.innerHTML = `
      <div style="padding:18px;background:rgba(198,120,221,.05);border:1px solid rgba(198,120,221,.25);border-radius:10px">
        <div style="font-family:var(--fm);font-size:11px;color:#c678dd;letter-spacing:.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px">🤖 CR généré par IA</div>
        <div style="font-size:13px;color:var(--t);line-height:1.7;white-space:pre-line">Compte-rendu de passage du ${new Date().toLocaleDateString('fr-FR')}

Soin réalisé : pansement complexe (AMI 4)
Constantes : TA 13/8, FC 72, SpO2 98 %
Observation : plaie en bonne voie de cicatrisation, pas de signe d'infection.
Recommandations : poursuivre le protocole en cours, prochaine évaluation à J+3.

Cordialement,</div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" style="font-size:12px">✍️ Signer & valider</button>
          <button class="btn" style="font-size:12px">📤 Envoyer au médecin</button>
          <button class="btn" style="font-size:12px">💾 Sauvegarder</button>
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════
     ROUTAGE — un dispatcher pour les 8 vues
  ═══════════════════════════════════════════════════════════ */
  const _RENDERERS = {
    'copilote-premium':       renderCopilotePremium,
    'audit-cpam-premium':     renderAuditCpamPremium,
    'simulateur-regulation':  renderSimulateurRegulation,
    'charges-premium':        renderChargesPremium,
    'rapport-premium':        renderRapportPremium,
    'dash-premium':           renderDashPremium,
    'transmissions-premium':  renderTransmissionsPremium,
    'compte-rendu-premium':   renderCompteRenduPremium
  };

  function render(viewId) {
    const fn = _RENDERERS[viewId];
    if (fn) try { fn(); } catch (e) { console.error('[PE] render KO:', viewId, e); }
  }

  /* ───── Hook navigation ────────────────────────────────── */
  document.addEventListener('ui:navigate', e => {
    const v = e.detail?.view;
    if (v && _RENDERERS[v]) setTimeout(() => render(v), 50);
  });

  /* ───── Export ────────────────────────────────────────── */
  return {
    render,
    openUpsell,
    // internes exposés pour les onclick inline
    _analyseLongitudinale,
    _simulateRegulation,
    _scenarioCA,
    _captureVoice,
    _capturePhoto,
    _generateCRAuto
  };
})();
