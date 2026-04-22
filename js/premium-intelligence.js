/* ════════════════════════════════════════════════
   premium-intelligence.js — AMI v1.0
   ────────────────────────────────────────────────
   💎 Copilote financier + juridique intelligent
   ────────────────────────────────────────────────
   Module front qui consomme l'enrichissement `premium_intel` renvoyé
   par le worker sur /webhook/ami-calcul, et qui expose des widgets
   réutilisables partout dans l'app (dashboard, cotation, tournée…).

   ⚙️ Architecture :
     • Vanilla JS (cohérent avec le reste du projet — pas de React)
     • Aucune dépendance externe
     • S'appuie sur SUB.entitlements() pour le gating
     • S'appuie sur hasAccess('optimisation_ca_plus') pour les hooks upsell

   📦 API publique :
     PremiumIntel.renderLossCard(target, premiumIntel)       → bloc gain €
     PremiumIntel.renderRiskGauge(target, risk)              → jauge risque URSSAF
     PremiumIntel.renderCoachBlock(target, coachMessages)    → conseils IA
     PremiumIntel.renderForecastCard(target, forecast)       → projection 30j
     PremiumIntel.renderEliteScore(target, elite)            → score gamifié
     PremiumIntel.renderPreCheck(target, precheck)           → hints temps réel
     PremiumIntel.renderTourneeOptimizer(target, result)     → gain tournée
     PremiumIntel.openPaywallModal(premiumIntel)             → modal conversion max
     PremiumIntel.injectUpsellHint(target, loss)             → hook "+XX€ avec Premium"
     PremiumIntel.precheckInput(texte, meta)                 → fetch /ami-precheck
     PremiumIntel.optimizeTournee(patients)                  → fetch /ami-tournee-optimize
     PremiumIntel.snapshot()                                 → fetch /ami-premium-snapshot

   🔒 Gating :
     • Les widgets s'affichent TOUJOURS (FOMO visible = conversion)
     • Pour les NON-Premium : CTA "Activer Premium" + action gatée
     • Pour les Premium actifs : action directe (correction auto, etc.)
══════════════════════════════════════════════════ */
'use strict';

window.PremiumIntel = (function(){

  /* ───── Utilitaires ─────────────────────────────────────── */

  function _el(target) {
    if (typeof target === 'string') return document.getElementById(target) || document.querySelector(target);
    return target || null;
  }

  function _fmtEur(n) {
    const v = parseFloat(n) || 0;
    return v.toFixed(2) + ' €';
  }

  function _fmtEurRound(n) {
    return Math.round(parseFloat(n) || 0) + ' €';
  }

  function _safe(s) {
    return String(s || '').replace(/[<>"']/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function _isPremium() {
    try { return !!(SUB && SUB.entitlements && SUB.entitlements().canOptimizeCA); }
    catch { return false; }
  }

  function _openPaywall(featId) {
    featId = featId || 'optimisation_ca_plus';
    if (typeof SUB !== 'undefined' && SUB.showPaywall) SUB.showPaywall(featId);
    else if (typeof navTo === 'function') navTo('mon-abo');
  }

  /* ───── 1. BLOC PERTE DÉTECTÉE (post-cotation, le plus important) ──── */
  /** @param {HTMLElement|string} target
   *  @param {Object} intel — premium_intel renvoyé par ami-calcul */
  function renderLossCard(target, intel) {
    const host = _el(target);
    if (!host) return;
    if (!intel || !intel.loss || !intel.loss.has_loss) {
      host.innerHTML = '';
      return;
    }
    const premium = _isPremium();
    const lossEur = _fmtEur(intel.loss.loss);
    const sev = intel.loss.severity || 'low';
    const trigger = intel.trigger || {};
    const cta = premium ? 'Corriger automatiquement' : (trigger.cta || 'Activer Premium');
    const btnClass = premium ? 'pi-btn-primary' : 'pi-btn-premium';

    host.innerHTML = `
      <div class="pi-card pi-card-loss pi-sev-${_safe(sev)}">
        <div class="pi-card-head">
          <span class="pi-icon">💸</span>
          <div>
            <h3 class="pi-card-title">${lossEur} récupérables</h3>
            <p class="pi-card-sub">${_safe(trigger.message || 'Optimisation détectée sur cet acte')}</p>
          </div>
          ${!premium ? '<span class="pi-badge-premium">PREMIUM</span>' : ''}
        </div>
        ${intel.loss.insights && intel.loss.insights.length ? `
          <ul class="pi-insights">
            ${intel.loss.insights.slice(0,3).map(i => `
              <li>
                <span class="pi-insight-msg">${_safe(i.message)}</span>
                ${i.gain ? `<span class="pi-insight-gain">+${_fmtEur(i.gain)}</span>` : ''}
              </li>`).join('')}
          </ul>` : ''}
        <button class="pi-btn ${btnClass}" data-action="${premium ? 'fix' : 'upsell'}">
          ${premium ? '⚡' : '🔒'} ${_safe(cta)}
        </button>
      </div>
    `;

    host.querySelector('.pi-btn').onclick = () => {
      if (premium) {
        // TODO hook auto-correction — pour l'instant ouvre le paywall
        if (typeof showToast === 'function') showToast('info', '⚡ Correction auto', 'Fonctionnalité en cours de déploiement.');
      } else {
        _openPaywall('optimisation_ca_plus');
      }
    };
  }

  /* ───── 2. JAUGE RISQUE URSSAF ──────────────────────────── */
  function renderRiskGauge(target, risk) {
    const host = _el(target);
    if (!host) return;
    if (!risk) { host.innerHTML = ''; return; }
    const lvl = risk.level || 'LOW';
    const score = Math.min(100, Math.max(0, risk.score || 0));
    const sevClass = lvl === 'HIGH' ? 'high' : lvl === 'MEDIUM' ? 'medium' : 'low';
    const label = lvl === 'HIGH' ? 'Risque élevé' : lvl === 'MEDIUM' ? 'Risque modéré' : 'Risque faible';
    const conformity = Math.max(0, 100 - score);

    host.innerHTML = `
      <div class="pi-card pi-card-risk">
        <div class="pi-card-head">
          <span class="pi-icon">⚖️</span>
          <div>
            <h3 class="pi-card-title">Score conformité</h3>
            <p class="pi-card-sub">CPAM · URSSAF · NGAP</p>
          </div>
        </div>
        <div class="pi-gauge pi-gauge-${sevClass}">
          <div class="pi-gauge-value">${conformity}%</div>
          <div class="pi-gauge-label">${_safe(label)}</div>
          <div class="pi-gauge-bar">
            <div class="pi-gauge-fill" style="width:${conformity}%"></div>
          </div>
        </div>
        <div class="pi-gauge-stats">
          ${risk.critical ? `<span class="pi-stat pi-stat-crit">🚨 ${risk.critical} critique${risk.critical>1?'s':''}</span>` : ''}
          ${risk.medium ? `<span class="pi-stat pi-stat-med">⚠️ ${risk.medium} modérée${risk.medium>1?'s':''}</span>` : ''}
          ${risk.good ? `<span class="pi-stat pi-stat-good">✓ ${risk.good} bonne${risk.good>1?'s':''} pratique${risk.good>1?'s':''}</span>` : ''}
        </div>
      </div>
    `;
  }

  /* ───── 3. COACH IA ─────────────────────────────────────── */
  function renderCoachBlock(target, coachMessages) {
    const host = _el(target);
    if (!host) return;
    if (!Array.isArray(coachMessages) || !coachMessages.length) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = `
      <div class="pi-card pi-card-coach">
        <div class="pi-card-head">
          <span class="pi-icon">💡</span>
          <h3 class="pi-card-title">Conseil AMI</h3>
        </div>
        <div class="pi-coach-list">
          ${coachMessages.map(c => `
            <div class="pi-coach-item">
              <div class="pi-coach-title">${_safe(c.title)}</div>
              <div class="pi-coach-expl">${_safe(c.explanation)}</div>
              <div class="pi-coach-action">➜ ${_safe(c.action)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /* ───── 4. PROJECTION CA 30 JOURS ───────────────────────── */
  function renderForecastCard(target, forecast) {
    const host = _el(target);
    if (!host) return;
    if (!forecast || !forecast.sample_days) { host.innerHTML = ''; return; }
    const gain = forecast.gain || 0;
    const showGain = gain > 1;
    const premium = _isPremium();

    host.innerHTML = `
      <div class="pi-card pi-card-forecast">
        <div class="pi-card-head">
          <span class="pi-icon">📈</span>
          <div>
            <h3 class="pi-card-title">Projection 30 jours</h3>
            <p class="pi-card-sub">Basé sur ${forecast.sample_days} derniers jours</p>
          </div>
        </div>
        <div class="pi-forecast-grid">
          <div class="pi-forecast-col">
            <div class="pi-forecast-label">CA actuel</div>
            <div class="pi-forecast-value">${_fmtEurRound(forecast.monthly_real)}</div>
          </div>
          <div class="pi-forecast-arrow">→</div>
          <div class="pi-forecast-col pi-forecast-col-opt">
            <div class="pi-forecast-label">CA optimisé</div>
            <div class="pi-forecast-value">${_fmtEurRound(forecast.monthly_optimized)}</div>
          </div>
        </div>
        ${showGain ? `
          <div class="pi-forecast-gain">
            💸 <strong>+${_fmtEurRound(gain)}/mois récupérables</strong>
          </div>
          ${!premium ? `
            <button class="pi-btn pi-btn-premium" data-action="upsell">
              🔒 Activer Premium pour récupérer
            </button>` : ''}
        ` : ''}
      </div>
    `;

    const btn = host.querySelector('.pi-btn-premium');
    if (btn) btn.onclick = () => _openPaywall('optimisation_ca_plus');
  }

  /* ───── 5. SCORE IDEL ÉLITE (gamification) ──────────────── */
  function renderEliteScore(target, elite) {
    const host = _el(target);
    if (!host) return;
    if (!elite) { host.innerHTML = ''; return; }
    const score = elite.score || 0;
    const rank = elite.rank || 'Débutant';
    const emoji = elite.emoji || '🌱';
    const color = elite.color || '#4fa8ff';

    host.innerHTML = `
      <div class="pi-card pi-card-elite" style="--pi-elite-color:${_safe(color)}">
        <div class="pi-card-head">
          <span class="pi-icon">📊</span>
          <h3 class="pi-card-title">Score IDEL</h3>
        </div>
        <div class="pi-elite-body">
          <div class="pi-elite-emoji">${emoji}</div>
          <div class="pi-elite-score">${score}<span class="pi-elite-max">/100</span></div>
          <div class="pi-elite-rank">${_safe(rank)}</div>
        </div>
        <div class="pi-elite-bar">
          <div class="pi-elite-fill" style="width:${score}%"></div>
        </div>
        ${score < 90 ? `<p class="pi-elite-hint">🔒 Les IDEL <strong>Élite</strong> utilisent Premium pour rester au sommet</p>` : ''}
      </div>
    `;
  }

  /* ───── 6. PRÉ-CHECK TEMPS RÉEL (avant validation cotation) ──── */
  function renderPreCheck(target, precheck) {
    const host = _el(target);
    if (!host) return;
    if (!precheck || !Array.isArray(precheck.insights) || !precheck.insights.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML = `
      <div class="pi-precheck">
        <div class="pi-precheck-head">
          <span class="pi-icon-small">🤖</span>
          <span>Suggestions en temps réel</span>
        </div>
        <ul class="pi-precheck-list">
          ${precheck.insights.map(i => `
            <li>
              <span class="pi-precheck-msg">${_safe(i.message)}</span>
              <span class="pi-precheck-impact">${_safe(i.impact)}</span>
            </li>`).join('')}
        </ul>
      </div>
    `;
  }

  /* ───── 7. OPTIMISATION TOURNÉE ─────────────────────────── */
  function renderTourneeOptimizer(target, result) {
    const host = _el(target);
    if (!host) return;
    if (!result || !Array.isArray(result.optimized)) { host.innerHTML = ''; return; }
    const premium = _isPremium();
    const gain = result.total_gain || 0;

    host.innerHTML = `
      <div class="pi-card pi-card-tournee">
        <div class="pi-card-head">
          <span class="pi-icon">🚀</span>
          <div>
            <h3 class="pi-card-title">Tournée optimisée</h3>
            <p class="pi-card-sub">${result.optimized.length} patient${result.optimized.length>1?'s':''} analysé${result.optimized.length>1?'s':''}</p>
          </div>
        </div>
        ${gain > 0 ? `<div class="pi-tournee-gain">💸 +${_fmtEurRound(gain)} potentiel</div>` : ''}
        <div class="pi-tournee-list">
          ${result.optimized.slice(0, 5).map(p => `
            <div class="pi-tournee-row ${p.gain > 0 ? 'pi-tournee-up' : ''}">
              <div class="pi-tournee-pat">${_safe(p.name)}</div>
              <div class="pi-tournee-delta">
                ${p.gain > 0 ? `<span class="pi-up">+${_fmtEur(p.gain)}</span>` : `<span class="pi-neutral">${_fmtEur(p.current_revenue || 0)}</span>`}
              </div>
            </div>
          `).join('')}
        </div>
        ${!premium && gain > 0 ? `
          <button class="pi-btn pi-btn-premium" data-action="upsell">
            🔒 Optimisation automatique avec Premium
          </button>` : ''}
      </div>
    `;
    const btn = host.querySelector('.pi-btn-premium');
    if (btn) btn.onclick = () => _openPaywall('optimisation_ca_plus');
  }

  /* ───── 8. PAYWALL MODAL (conversion max) ───────────────── */
  function openPaywallModal(intel) {
    intel = intel || {};
    const loss = intel.loss?.loss || 0;
    const monthlyGain = intel.forecast?.gain || 0;

    let modal = document.getElementById('pi-paywall-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pi-paywall-modal';
      modal.className = 'pi-modal-overlay';
      modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="pi-modal-card">
        <button class="pi-modal-close" onclick="PremiumIntel._closeModal()">×</button>
        <div class="pi-modal-header">
          <div class="pi-modal-icon">💸</div>
          <h2 class="pi-modal-title">Tu perds de l'argent</h2>
        </div>
        <div class="pi-modal-body">
          ${loss > 0 ? `<p class="pi-modal-line">Sur cet acte : <strong>+${_fmtEur(loss)}</strong> récupérables</p>` : ''}
          ${monthlyGain > 1 ? `<p class="pi-modal-line">Sur 30 jours : <strong>~${_fmtEurRound(monthlyGain)}</strong> récupérables</p>` : ''}
          <p class="pi-modal-tagline">Premium se rembourse en <strong>1 journée de tournée</strong>.</p>
        </div>
        <div class="pi-modal-actions">
          <button class="pi-btn pi-btn-primary pi-btn-large" onclick="PremiumIntel._goUpgrade()">
            💎 Récupérer maintenant
          </button>
          <button class="pi-btn pi-btn-ghost" onclick="PremiumIntel._closeModal()">Plus tard</button>
        </div>
      </div>
    `;
    modal.classList.add('open');
    setTimeout(() => modal.classList.add('visible'), 10);
  }

  function _closeModal() {
    const modal = document.getElementById('pi-paywall-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.classList.remove('open'), 200);
  }

  function _goUpgrade() {
    _closeModal();
    if (typeof navTo === 'function') navTo('mon-abo');
  }

  /* ───── 9. HOOK UPSELL (mini — à injecter partout) ──────── */
  /** Petit hint "+32€ récupérables avec Premium" pour rendre Premium omniprésent.
   *  À appeler depuis dashboard, historique, cotation, etc. */
  function injectUpsellHint(target, amount) {
    const host = _el(target);
    if (!host) return;
    if (_isPremium()) { host.innerHTML = ''; return; }
    const a = parseFloat(amount) || 0;
    if (a < 1) { host.innerHTML = ''; return; }

    host.innerHTML = `
      <div class="pi-hint" onclick="PremiumIntel._openPaywall('optimisation_ca_plus')">
        <span class="pi-hint-icon">💸</span>
        <span class="pi-hint-text"><strong>+${_fmtEurRound(a)}</strong> récupérables avec Premium</span>
        <span class="pi-hint-arrow">→</span>
      </div>
    `;
  }

  /* ───── 10. API worker ──────────────────────────────────── */

  async function precheckInput(texte, meta) {
    if (typeof fetchAPI !== 'function') return { predicted_total: 0, insights: [] };
    try {
      const r = await fetchAPI('/webhook/ami-precheck', {
        method: 'POST',
        body: JSON.stringify({ texte, heure_soin: meta?.heure, date_soin: meta?.date })
      });
      return r?.precheck || { predicted_total: 0, insights: [] };
    } catch (e) {
      console.warn('[PI] precheckInput KO:', e.message);
      return { predicted_total: 0, insights: [] };
    }
  }

  async function optimizeTournee(patients) {
    if (typeof fetchAPI !== 'function') return { optimized: [], total_gain: 0 };
    try {
      const r = await fetchAPI('/webhook/ami-tournee-optimize', {
        method: 'POST',
        body: JSON.stringify({ patients })
      });
      return r || { optimized: [], total_gain: 0 };
    } catch (e) {
      console.warn('[PI] optimizeTournee KO:', e.message);
      return { optimized: [], total_gain: 0, error: e.message };
    }
  }

  async function snapshot() {
    if (typeof fetchAPI !== 'function') return null;
    try {
      const r = await fetchAPI('/webhook/ami-premium-snapshot', { method: 'POST', body: '{}' });
      return r?.snapshot || null;
    } catch (e) {
      console.warn('[PI] snapshot KO:', e.message);
      return null;
    }
  }

  /* ───── 11. RENDU GROUPÉ (one-shot après cotation) ──────── */
  /** Rendu complet post-cotation : loss + forecast + coach
   *  @param {Object} opts — { loss, forecast, coach, elite, risk } — zones cibles */
  function renderAfterCotation(intel, opts) {
    opts = opts || {};
    if (!intel) return;
    if (opts.loss)     renderLossCard(opts.loss, intel);
    if (opts.forecast) renderForecastCard(opts.forecast, intel.forecast);
    if (opts.coach)    renderCoachBlock(opts.coach, intel.coach);
    if (opts.risk)     renderRiskGauge(opts.risk, intel.risk);
    if (opts.elite)    renderEliteScore(opts.elite, intel.elite);
  }

  /* ───── 12. AUTO-HOOK sur dashboard ─────────────────────── */
  // Quand l'user navigue sur le dashboard, on injecte automatiquement un
  // snapshot Premium si la zone existe dans le DOM (ajoutée par dashboard.js
  // ou par un data-attribute <div id="pi-snapshot-root"></div>).
  let _snapshotCache = null;
  let _snapshotCacheAt = 0;

  async function _refreshDashboard() {
    const mount = document.getElementById('pi-dashboard-mount');
    if (!mount) return;
    // Cache 60s pour éviter les refetch inutiles
    const now = Date.now();
    if (!_snapshotCache || (now - _snapshotCacheAt) > 60000) {
      _snapshotCache = await snapshot();
      _snapshotCacheAt = now;
    }
    const snap = _snapshotCache;
    if (!snap) { mount.innerHTML = ''; return; }

    mount.innerHTML = `
      <div class="pi-dashboard-grid">
        <div id="pi-dash-risk"></div>
        <div id="pi-dash-forecast"></div>
        <div id="pi-dash-elite"></div>
      </div>
    `;
    renderRiskGauge('pi-dash-risk', snap.risk);
    renderForecastCard('pi-dash-forecast', snap.forecast);
    renderEliteScore('pi-dash-elite', snap.elite);
  }

  document.addEventListener('ui:navigate', e => {
    if (e.detail?.view === 'dashboard' || e.detail?.view === 'home') {
      setTimeout(_refreshDashboard, 200);
    }
  });

  /* ───── EXPORT ─────────────────────────────────────────── */

  return {
    // widgets
    renderLossCard,
    renderRiskGauge,
    renderCoachBlock,
    renderForecastCard,
    renderEliteScore,
    renderPreCheck,
    renderTourneeOptimizer,
    renderAfterCotation,
    injectUpsellHint,
    openPaywallModal,
    // API worker
    precheckInput,
    optimizeTournee,
    snapshot,
    refreshDashboard: _refreshDashboard,
    // internes exposés pour les handlers onclick inline
    _closeModal, _goUpgrade, _openPaywall
  };
})();
