(function () {
  'use strict';

  const cfg = window.PIMP_CART_CFG;
  if (!cfg || !cfg.auth0Domain || !cfg.auth0Client) {
    console.warn('[pimp-cart] missing config');
    return;
  }

  let auth0ClientPromise = null;
  function getAuth0() {
    if (!auth0ClientPromise) {
      auth0ClientPromise = window.auth0
        .createAuth0Client({
          domain: cfg.auth0Domain,
          clientId: cfg.auth0Client,
          authorizationParams: {
            redirect_uri: window.location.href,
            audience: cfg.auth0Audience,
          },
          cacheLocation: 'localstorage',
          useRefreshTokens: true,
        });
    }
    return auth0ClientPromise;
  }

  // Complete the Auth0 redirect if we come back from the login flow.
  (async () => {
    const qs = window.location.search;
    if (qs.includes('code=') && qs.includes('state=')) {
      const client = await getAuth0();
      try {
        const { appState } = await client.handleRedirectCallback();
        const target = (appState && appState.returnTo) || window.location.pathname;
        window.history.replaceState({}, document.title, target);
        const pending = sessionStorage.getItem('pimp_pending');
        if (pending) {
          sessionStorage.removeItem('pimp_pending');
          await addToPimp(JSON.parse(pending));
        }
      } catch (e) {
        console.error('[pimp-cart] callback error', e);
      }
    }
  })();

  async function addToPimp(payload) {
    const client = await getAuth0();
    const token = await client.getTokenSilently();
    const res = await fetch(cfg.apiUrl + '/api/cart/items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error('API error ' + res.status + ': ' + body);
    }
    return res.json();
  }

  function setStatus(btn, text, kind) {
    const status = btn.parentElement.querySelector('.pimp-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind || '';
  }

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('.pimp-add-to-cart');
    if (!btn) return;
    e.preventDefault();

    let payload;
    try {
      payload = JSON.parse(btn.dataset.payload);
    } catch (err) {
      console.error('[pimp-cart] bad payload', err);
      return;
    }

    btn.disabled = true;
    setStatus(btn, 'Ajout en cours…', 'pending');

    try {
      const client = await getAuth0();
      const isAuthenticated = await client.isAuthenticated();
      if (!isAuthenticated) {
        sessionStorage.setItem('pimp_pending', JSON.stringify(payload));
        await client.loginWithRedirect({
          appState: { returnTo: window.location.pathname },
        });
        return;
      }
      await addToPimp(payload);
      setStatus(btn, 'Ajouté à votre panier Pimp ✓', 'success');
    } catch (err) {
      console.error('[pimp-cart]', err);
      setStatus(btn, 'Erreur: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
