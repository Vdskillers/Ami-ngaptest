/* ════════════════════════════════════════════════════════════════════
   tier-visibility.js — AMI NGAP v1.0
   ────────────────────────────────────────────────────────────────────
   Compagnon NON-INVASIF de subscription.js.
   À charger APRÈS subscription.js dans index.html :
     <script src="tier-visibility.js" defer></script>

   🎯 BUT
   Chaque utilisateur ne voit dans la nav QUE les fonctionnalités
   couvertes par son abonnement. Les autres ne sont plus simplement
   "verrouillées avec un cadenas" → elles sont COMPLÈTEMENT MASQUÉES
   (display:none).

   ✅ Couvre :
      • Sidebar desktop  (.ni[data-v])
      • Bottom-nav mobile (#bottom-nav .bn-item[data-v])
      • Menu "Plus" mobile (#mobile-menu .bn-item[data-v])
      • Sous-onglets des hubs (.hub-tab[data-hub][data-hub-tab])
        → outils-hub, patients-hub, comptable-hub
      • Blocs sidebar (.sl) entièrement vides → label aussi masqué
      • Bascule auto sur le 1er onglet visible si l'actif est masqué

   ✅ Bypass dans ces cas (= comportement standard SUB préservé) :
      • Mode TEST sans sim/preview        → tout visible
      • Admin sans sim et sans preview    → tout visible
      • Items "toujours visibles"          → mon-abo, aide, sec, profil

   ✅ API publique exposée (admin uniquement, depuis console) :
      • SUB.setStrictTierVisibility(true|false)  ← toggle live
      • SUB.isStrictTierVisibility()
═════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  /* ───── 0. Init différée si SUB pas encore prêt ─────────────────── */
  if (!window.SUB) {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));
    return;
  }
  init();

  /* ════════════════════════════════════════════════════════════════ */

  function init() {
    if (window.__amiTierVisibilityInstalled) return;
    window.__amiTierVisibilityInstalled = true;

    /* ───── 1. Configuration ─────────────────────────────────────── */

    // Activé par défaut. Peut être désactivé via SUB.setStrictTierVisibility(false)
    let _STRICT = true;

    // Items toujours visibles, peu importe le tier
    // (UX critique : il faut toujours pouvoir voir son abonnement, l'aide,
    //  la sécurité de son compte, et son profil)
    const ALWAYS_VISIBLE = new Set([
      'mon-abo',     // page abonnement (offre les upgrades)
      'aide',        // aide & docs
      'sec',         // sécurité de l'utilisateur (2FA, etc.)
      'profil',      // page profil
      'contact',     // contact admin (whitelist LOCKED dans subscription.js)
      'outils-hub',  // hub conteneur — les onglets internes seront filtrés
      'more'         // bouton "Plus" du bottom-nav
    ]);

    // Map "hub-name:tab-name" → feature ID (extension de NAV_FEATURE_MAP
    // qui ne couvrait pas les sous-onglets)
    const HUB_TAB_FEATURE_MAP = {
      // ─── outils-hub (Outils pratiques) ───
      'outils:dash':              'dashboard_stats',
      'outils:tresor':            'tresor_base',
      'outils:rapport':           'rapport_mensuel',
      'outils:copilote':          'copilote_ia',
      'outils:audit':             'audit_cpam',
      'outils:charges':           'charges_calc',
      'outils:modeles':           'modeles_soins',
      'outils:ca-sous-declare':   'ca_sous_declare',
      'outils:forensic-cert':     'forensic_certificates',
      'outils:rapport-juridique': 'rapport_juridique_mensuel',
      // ─── patients-hub ───
      'patients:carnet':          'patient_book',
      'patients:ordos':           'ordonnances',
      'patients:pilulier':        'pilulier',
      'patients:constantes':      'constantes',
      'patients:bsi':             'bsi',
      'patients:consentements':   'consentements',
      'patients:cr':              'compte_rendu',
      'patients:alertes-med':     'alertes_med',
      // ─── comptable-hub ───
      'comptable:dashboard':      'dashboard_consolide',
      'comptable:export-fec':     'export_fiscal',
      'comptable:2042':           'generateur_2042',
      'comptable:scoring':        'scoring_risque',
      'comptable:alertes':        'alertes_ngap_masse',
      'comptable:connecteurs':    'connecteurs_compta',
      'comptable:anonymisee':     'vue_anonymisee',
      'comptable:trimestriel':    'rapport_trimestriel'
    };

    // Marqueur DOM utilisé pour pouvoir restaurer si on désactive le mode strict
    const HIDDEN_ATTR = 'data-tv-hidden';

    /* ───── 2. Logique de filtrage ───────────────────────────────── */

    /** Doit-on appliquer le masquage strict actuellement ? */
    function _shouldFilter() {
      if (!_STRICT) return false;
      const st = SUB.getState ? SUB.getState() : null;
      if (!st) return false;

      // Mode TEST sans sim ni preview → bypass total
      if (st.appMode === 'TEST' && !st.isAdminSim && !st.isPreview) return false;

      // Admin sans sim ni preview → bypass total (admin doit tout voir)
      if (st.isAdmin && !st.isAdminSim && !st.isPreview) return false;

      return true;
    }

    /** Cache un élément (en mémorisant son display original) */
    function _hide(el) {
      if (el.getAttribute(HIDDEN_ATTR) === '1') return;
      el.setAttribute(HIDDEN_ATTR, '1');
      el.dataset.tvOrigDisplay = el.style.display || '';
      el.style.display = 'none';
    }

    /** Restaure un élément masqué par nous */
    function _show(el) {
      if (el.getAttribute(HIDDEN_ATTR) !== '1') return;
      el.removeAttribute(HIDDEN_ATTR);
      el.style.display = el.dataset.tvOrigDisplay || '';
      delete el.dataset.tvOrigDisplay;
    }

    /** Restaure tout ce qu'on a masqué (si on désactive le mode strict) */
    function _restoreAll() {
      document.querySelectorAll('[' + HIDDEN_ATTR + '="1"]').forEach(_show);
    }

    /** Renvoie le feature-id associé à un data-v de nav (cherche dans SUB) */
    function _featureForView(v) {
      try { return (SUB.NAV_FEATURE_MAP && SUB.NAV_FEATURE_MAP[v]) || null; }
      catch (_) { return null; }
    }

    /** Application principale — masque tout ce qui n'est pas accessible */
    function _applyStrictVisibility() {
      // Si on doit pas filtrer → on restaure tout ce qu'on avait masqué
      if (!_shouldFilter()) { _restoreAll(); return; }

      /* ─── 2.1 Items de navigation (sidebar + bottom-nav + mobile menu) ─── */
      const navSelectors = [
        '.ni[data-v]',
        '#bottom-nav .bn-item[data-v]',
        '#mobile-menu .bn-item[data-v]'
      ];
      navSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const v = el.dataset.v;
          if (!v || ALWAYS_VISIBLE.has(v)) { _show(el); return; }

          const feat = _featureForView(v);
          // Pas de mapping → on laisse visible (pages neutres : aide, mon-abo…)
          if (!feat) { _show(el); return; }

          if (SUB.hasAccess(feat)) _show(el);
          else                     _hide(el);
        });
      });

      /* ─── 2.2 Sous-onglets des hubs ─── */
      document.querySelectorAll('.hub-tab[data-hub][data-hub-tab]').forEach(el => {
        const hub = el.dataset.hub;
        const tab = el.dataset.hubTab;
        const feat = HUB_TAB_FEATURE_MAP[hub + ':' + tab];
        // Pas de mapping → toujours visible (onglet neutre)
        if (!feat) { _show(el); return; }

        if (SUB.hasAccess(feat)) {
          _show(el);
        } else {
          const wasActive = el.classList.contains('on');
          _hide(el);
          // Si on vient de cacher l'onglet actif → bascule sur le 1er visible
          if (wasActive) _switchToFirstVisibleHubTab(hub);
        }
      });

      /* ─── 2.3 Blocs sidebar (.sl) → masquer si tous les items sont cachés ─── */
      document.querySelectorAll('nav.side .sl').forEach(block => {
        const items = block.querySelectorAll('.ni[data-v]');
        if (!items.length) return;
        const anyVisible = Array.from(items).some(
          i => i.getAttribute(HIDDEN_ATTR) !== '1'
        );
        if (anyVisible) _show(block);
        else            _hide(block);
      });

      /* ─── 2.4 Menu "Plus" mobile : si vide → cacher le bouton ─── */
      const mobMenuItems = document.querySelectorAll('#mobile-menu .bn-item[data-v]');
      if (mobMenuItems.length) {
        const anyVisible = Array.from(mobMenuItems).some(
          i => i.getAttribute(HIDDEN_ATTR) !== '1'
        );
        const moreBtn = document.querySelector('#bottom-nav .bn-item[data-v="more"]');
        if (moreBtn) anyVisible ? _show(moreBtn) : _hide(moreBtn);
      }
    }

    /** Bascule sur le 1er onglet visible d'un hub donné */
    function _switchToFirstVisibleHubTab(hub) {
      const tabs = document.querySelectorAll(`.hub-tab[data-hub="${hub}"]`);
      const firstVisible = Array.from(tabs).find(
        t => t.getAttribute(HIDDEN_ATTR) !== '1'
      );
      if (!firstVisible) return;
      const tabName = firstVisible.dataset.hubTab;
      try {
        if (hub === 'outils'    && typeof window.outilsHubSwitchTab    === 'function') window.outilsHubSwitchTab(tabName, firstVisible);
        else if (hub === 'patients'  && typeof window.patientsHubSwitchTab  === 'function') window.patientsHubSwitchTab(tabName, firstVisible);
        else if (hub === 'comptable' && typeof window.comptableHubSwitchTab === 'function') window.comptableHubSwitchTab(tabName, firstVisible);
        else firstVisible.click();
      } catch (e) {
        console.warn('[tier-visibility] switch tab fallback:', e.message);
        firstVisible.click();
      }
    }

    /* ───── 3. Wrappers — re-jouer le filtrage après chaque action SUB ─── */

    function _wrap(name, isAsync) {
      const orig = SUB[name];
      if (typeof orig !== 'function') return;
      if (isAsync) {
        SUB[name] = async function () {
          const r = await orig.apply(SUB, arguments);
          // Petit délai pour laisser SUB finir ses propres applyUILocks/animations
          setTimeout(_applyStrictVisibility, 30);
          return r;
        };
      } else {
        SUB[name] = function () {
          const r = orig.apply(SUB, arguments);
          setTimeout(_applyStrictVisibility, 30);
          return r;
        };
      }
    }

    _wrap('applyUILocks');
    _wrap('bootstrap',  true);
    _wrap('refresh',    true);
    _wrap('upgrade',    true);
    _wrap('setAdminSim');
    _wrap('clearAdminSim');
    _wrap('previewTier');
    _wrap('clearPreview');

    /* ───── 4. Hooks événements ─────────────────────────────────── */

    // Re-jouer après chaque navigation (au cas où des items DOM apparaissent
    // dynamiquement, ex: nav admin injectée par auth.js)
    document.addEventListener('ui:navigate', () => {
      setTimeout(_applyStrictVisibility, 50);
    });

    // Pass initiale après que tout soit chargé
    if (document.readyState === 'complete') {
      setTimeout(_applyStrictVisibility, 250);
    } else {
      window.addEventListener('load', () => setTimeout(_applyStrictVisibility, 250));
    }

    // Re-jouer après chaque ouverture du menu mobile
    const _origToggle = window.toggleMobileMenu;
    if (typeof _origToggle === 'function') {
      window.toggleMobileMenu = function () {
        const r = _origToggle.apply(this, arguments);
        setTimeout(_applyStrictVisibility, 30);
        return r;
      };
    }

    /* ───── 5. API publique exposée sur SUB ─────────────────────── */

    SUB.setStrictTierVisibility = function (on) {
      _STRICT = !!on;
      _applyStrictVisibility();
      console.info('[tier-visibility] strict mode →', _STRICT ? 'ON' : 'OFF');
      return _STRICT;
    };
    SUB.isStrictTierVisibility = function () { return _STRICT; };

    /* Debug helper (console) */
    SUB._tvDebug = function () {
      const st = SUB.getState();
      return {
        strict: _STRICT,
        active: _shouldFilter(),
        appMode: st.appMode,
        tier: st.tier,
        isAdmin: st.isAdmin,
        isAdminSim: st.isAdminSim,
        isPreview: st.isPreview,
        previewTier: st.previewTier,
        hiddenCount: document.querySelectorAll('[' + HIDDEN_ATTR + '="1"]').length
      };
    };

    console.info('[tier-visibility] installed — strict mode ON. Disable with SUB.setStrictTierVisibility(false)');
  }
})();
