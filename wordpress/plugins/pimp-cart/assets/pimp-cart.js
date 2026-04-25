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

  // Read the chosen quantity + variation from the product page at click time.
  function readSelection(btn) {
    const productId = btn.dataset.productId;
    const form = btn.closest('form.cart') || document;
    const qtyInput = form.querySelector('input.qty');
    const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
    const varInput = form.querySelector('input[name="variation_id"]');
    const variationId = varInput && varInput.value && parseInt(varInput.value, 10) > 0
      ? varInput.value
      : null;
    return { productId, quantity, variationId };
  }

  // Ask WordPress to sign the payload with the current selection.
  async function signOnServer({ productId, quantity, variationId }) {
    const body = new URLSearchParams();
    body.set('action', 'pimp_sign_add_to_cart');
    body.set('product_id', productId);
    body.set('quantity', String(quantity));
    if (variationId) body.set('variation_id', variationId);
    const resp = await fetch(cfg.ajaxUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = await resp.json();
    if (!json || !json.success) {
      const message = (json && json.data && json.data.message) || 'sign failed';
      throw new Error(message);
    }
    return json.data;
  }

  // Resume an in-flight add after Auth0 redirect roundtrip.
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
          const sel = JSON.parse(pending);
          const fresh = await signOnServer(sel);
          await addToPimp(fresh);
        }
      } catch (e) {
        console.error('[pimp-cart] callback error', e);
      }
    }
    checkAlreadyInCart();
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

  // Toggles the button to an "already in cart" state with a link to the SaaS.
  function markAsInCart(btn, item) {
    btn.dataset.inCart = '1';
    const variation = item.variation_label ? ' (' + item.variation_label.replace(/<[^>]+>/g, '') + ')' : '';
    btn.textContent = '✓ Déjà dans votre panier Pimp ×' + item.quantity + variation;
    const status = btn.parentElement.querySelector('.pimp-status');
    if (status) {
      status.innerHTML = ' <a href="' + cfg.pimpUrl + '" target="_blank" rel="noopener">Voir le panier</a>';
    }
  }

  async function checkAlreadyInCart() {
    const btn = document.querySelector('.pimp-add-to-cart');
    if (!btn) return;
    try {
      const client = await getAuth0();
      if (!(await client.isAuthenticated())) return;
      const token = await client.getTokenSilently();
      const res = await fetch(cfg.apiUrl + '/api/cart', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return;
      const cart = await res.json();
      const productId = btn.dataset.productId;
      const found = cart.items.find(
        (i) => i.site_id === cfg.siteId && String(i.product_id) === String(productId),
      );
      if (found) markAsInCart(btn, found);
    } catch (e) {
      // Silently ignore — this is a UX hint, not critical.
    }
  }

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('.pimp-add-to-cart');
    if (!btn) return;
    e.preventDefault();

    const sel = readSelection(btn);
    if (!sel.productId) return;

    btn.disabled = true;
    setStatus(btn, 'Ajout en cours…', 'pending');

    try {
      const client = await getAuth0();
      const isAuthenticated = await client.isAuthenticated();
      if (!isAuthenticated) {
        // Save the selection (not the signed payload) so we re-sign post-redirect.
        sessionStorage.setItem('pimp_pending', JSON.stringify(sel));
        await client.loginWithRedirect({
          appState: { returnTo: window.location.pathname },
        });
        return;
      }
      const signed = await signOnServer(sel);
      const result = await addToPimp(signed);
      const label = signed.variation_label ? ' (' + signed.variation_label.replace(/<[^>]+>/g, '') + ')' : '';
      const qty = signed.quantity > 1 ? ' ×' + signed.quantity : '';
      setStatus(btn, 'Ajouté à votre panier Pimp ✓' + qty + label, 'success');
      // Switch the button to the "already in cart" state immediately so the
      // user sees they don't need to click again.
      markAsInCart(btn, result);
    } catch (err) {
      console.error('[pimp-cart]', err);
      setStatus(btn, 'Erreur: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
