/* ═══════════════════════════════════════════════════════════════
   landing-loader.js
   ─────────────────
   Charge AMI-landing.html dans une iframe overlay à la première
   visite UNIQUEMENT. Communique avec la landing via postMessage.

   • localStorage flag : 'ami_landing_seen' → '1' une fois affichée
   • Marque comme "vue" dès le 1er affichage (pas seulement au CTA)
   • API publique : window.AMI_LANDING.show() / .reset()

   Usage dans index.html :
     <script src="landing-loader.js" defer></script>
   ═══════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  var STORAGE_KEY = 'ami_landing_seen';
  var LANDING_URL = 'AMI-landing.html?embedded=1';
  var Z_INDEX     = 99999;
  var FADE_MS     = 350;

  /* ─── Détection : déjà vue ? ─── */
  function hasBeenSeen(){
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch(e){ return false; }
  }
  function markAsSeen(){
    try { localStorage.setItem(STORAGE_KEY, '1'); }
    catch(e){}
  }
  function resetSeen(){
    try { localStorage.removeItem(STORAGE_KEY); }
    catch(e){}
  }

  /* ─── Référence vers l'overlay actif (1 seule instance possible) ─── */
  var activeHost = null;
  var msgListener = null;

  /* ─── Création de l'iframe overlay ─── */
  function createOverlay(opts){
    opts = opts || {};
    if(activeHost) return activeHost; // déjà ouverte

    /* Container fullscreen */
    var host = document.createElement('div');
    host.id = 'ami-landing-host';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'Présentation AMI');
    host.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:' + Z_INDEX,
      'background:#0b0f14',
      'opacity:0',
      'transition:opacity ' + FADE_MS + 'ms ease',
      'overflow:hidden',
      'display:block'
    ].join(';');

    /* iframe */
    var iframe = document.createElement('iframe');
    iframe.src = LANDING_URL;
    iframe.title = 'Présentation AMI';
    iframe.setAttribute('loading', 'eager');
    iframe.style.cssText = [
      'width:100%',
      'height:100%',
      'border:0',
      'display:block',
      'background:#0b0f14'
    ].join(';');

    /* Bouton fermeture discret (escape hatch si user veut skip la présentation) */
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer la présentation');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = [
      'position:absolute',
      'top:14px',
      'right:14px',
      'z-index:' + (Z_INDEX + 1),
      'width:36px',
      'height:36px',
      'border-radius:50%',
      'background:rgba(11,15,20,.7)',
      'border:1px solid rgba(0,212,170,.3)',
      'color:#94a3b8',
      'font-size:16px',
      'cursor:pointer',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'transition:all .2s'
    ].join(';');
    closeBtn.addEventListener('mouseenter', function(){
      closeBtn.style.color = '#00d4aa';
      closeBtn.style.borderColor = 'rgba(0,212,170,.6)';
    });
    closeBtn.addEventListener('mouseleave', function(){
      closeBtn.style.color = '#94a3b8';
      closeBtn.style.borderColor = 'rgba(0,212,170,.3)';
    });
    closeBtn.addEventListener('click', function(){ closeOverlay(); });

    host.appendChild(iframe);
    host.appendChild(closeBtn);
    document.body.appendChild(host);

    /* Bloquer le scroll du body sous-jacent */
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    host.dataset.prevOverflow = prevOverflow;

    /* Fade in */
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ host.style.opacity = '1'; });
    });

    /* Marque comme vue dès l'affichage (pas seulement au CTA) */
    if(!opts.skipMarkAsSeen) markAsSeen();

    /* Écoute des messages depuis l'iframe */
    msgListener = function(event){
      var data = event.data;
      if(!data || typeof data !== 'object') return;
      if(data.type !== 'ami-landing-close') return;

      /* Optionnel : si la landing nous renvoie un plan choisi, on peut le stocker */
      if(data.plan){
        try { sessionStorage.setItem('ami_landing_plan_intent', data.plan); }
        catch(e){}
      }

      closeOverlay();
    };
    window.addEventListener('message', msgListener);

    /* Échap = fermer */
    var keyHandler = function(e){
      if(e.key === 'Escape') closeOverlay();
    };
    document.addEventListener('keydown', keyHandler);
    host._keyHandler = keyHandler;

    activeHost = host;
    return host;
  }

  /* ─── Fermeture (fade-out + cleanup) ─── */
  function closeOverlay(){
    if(!activeHost) return;
    var host = activeHost;
    activeHost = null;

    host.style.opacity = '0';

    setTimeout(function(){
      try {
        document.body.style.overflow = host.dataset.prevOverflow || '';
        if(host._keyHandler) document.removeEventListener('keydown', host._keyHandler);
        if(msgListener)      window.removeEventListener('message', msgListener);
        host.remove();
      } catch(e){}
      msgListener = null;
    }, FADE_MS + 20);
  }

  /* ─── API publique : window.AMI_LANDING ─── */
  window.AMI_LANDING = {
    /**
     * Affiche la landing manuellement (ex: depuis un menu "Voir la présentation").
     * Ne marque PAS comme vue (force=true pour ré-afficher).
     */
    show: function(opts){
      opts = opts || {};
      createOverlay({ skipMarkAsSeen: opts.skipMarkAsSeen !== false });
    },
    /**
     * Ferme la landing si elle est ouverte.
     */
    close: closeOverlay,
    /**
     * Réinitialise le flag "déjà vue" → la landing s'affichera à nouveau au prochain rechargement.
     * Utile pour debug / QA.
     */
    reset: function(){
      resetSeen();
      console.log('[AMI Landing] flag réinitialisé. Reload pour voir la landing à nouveau.');
    },
    /**
     * Récupère un éventuel plan choisi par l'utilisateur dans la landing.
     * (Stocké en sessionStorage, à utiliser dans ton flow d'inscription.)
     */
    getPlanIntent: function(){
      try { return sessionStorage.getItem('ami_landing_plan_intent') || null; }
      catch(e){ return null; }
    },
    clearPlanIntent: function(){
      try { sessionStorage.removeItem('ami_landing_plan_intent'); }
      catch(e){}
    }
  };

  /* ─── Auto-affichage à la première visite ─── */
  function autoShow(){
    if(hasBeenSeen()) return;
    /* On laisse le DOM se peindre une frame avant d'overlayer,
       sinon flash blanc sur certains navigateurs */
    requestAnimationFrame(function(){
      createOverlay();
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', autoShow);
  } else {
    autoShow();
  }
})();
