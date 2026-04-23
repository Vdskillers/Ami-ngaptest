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
   */
  function _integrate(hostKey) {
    const cfg = INTEGRATIONS[hostKey];
    if (!cfg || !cfg.sourceView || !cfg.trigger) return;

    const section = _ensurePremiumSection(cfg.hostView, cfg);
    if (!section) return;
    const contentMount = section.querySelector('.pe-premium-content');
    if (!contentMount) return;

    // Déclenche le rendu du module Premium (qui mountera dans #view-X caché)
    try {
      cfg.trigger();
    } catch (e) {
      console.warn('[PE] trigger KO pour', hostKey, e);
      contentMount.innerHTML = `<div style="padding:14px;color:var(--m,#7c8a9a);font-size:13px;font-style:italic">Le module Premium « ${_safe(cfg.title)} » est en cours de chargement. Réessayez dans un instant.</div>`;
      _applyLock(section, cfg);
      return;
    }

    // Attend que le DOM soit peuplé puis déplace les enfants
    setTimeout(() => {
      const source = document.getElementById(cfg.sourceView);
      if (!source) return;
      // On déplace tous les enfants du source dans le mount du host
      contentMount.innerHTML = '';
      while (source.firstChild) contentMount.appendChild(source.firstChild);
      _applyLock(section, cfg);
    }, 250);
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
    if (INTEGRATIONS[v]) setTimeout(() => applyForView(v), 350);
  });

  /* Sync initial du badge visibility (au DOM ready + après bootstrap SUB).
     SUB.bootstrap est asynchrone (fetch worker), on attend ~1s pour que
     l'état soit hydraté avant de calculer les visibilités. */
  function _initialSync() {
    _syncBodyClass();
    setTimeout(_syncBodyClass, 800);   // après bootstrap SUB
    setTimeout(_syncBodyClass, 2000);  // filet de sécurité si worker lent
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initialSync);
  } else {
    _initialSync();
  }

  /* Re-applique le verrou + badge visibility si le statut Premium change
     (admin sim, expiration trial, activation add-on, etc.). */
  setInterval(() => {
    const wasPremium = document.body.dataset.peLastPremium === '1';
    const isPremium = _canShowPremiumBadges();
    if (wasPremium !== isPremium) {
      document.body.dataset.peLastPremium = isPremium ? '1' : '0';
      _syncBodyClass();
      // Re-applique sur l'onglet courant si c'est un onglet enrichi
      Object.keys(INTEGRATIONS).forEach(k => {
        const section = document.querySelector(`#view-${k} > .pe-premium-section`);
        if (section) _applyLock(section, INTEGRATIONS[k]);
      });
    }
  }, 3000);

  /* ═══════════════════════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════════════════════ */
  return {
    refresh,
    openPaywall,
    applyForView,
    // internes (onclick inline)
    _simulateRegulation
  };
})();
