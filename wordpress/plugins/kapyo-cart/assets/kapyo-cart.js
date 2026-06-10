(function () {
  'use strict';

  const cfg = window.KAPYO_CART_CFG;
  if (!cfg || !cfg.auth0Domain || !cfg.auth0Client) {
    console.warn('[kapyo-cart] missing config');
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
            redirect_uri: window.location.origin + '/auth/callback',
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
    body.set('action', 'kapyo_sign_add_to_cart');
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

  // Resume an in-flight add when returning from the /auth/callback redirect.
  // appState.returnTo brings the user back to the product page; the plugin
  // then picks up kapyo_pending from sessionStorage and completes the add.
  (async () => {
    const pending = sessionStorage.getItem('kapyo_pending');
    if (pending) {
      const btn = document.querySelector('.kapyo-add-to-cart');
      try {
        const client = await getAuth0();
        if (await client.isAuthenticated()) {
          sessionStorage.removeItem('kapyo_pending');
          const sel = JSON.parse(pending);
          if (btn) { btn.disabled = true; setStatus(btn, 'Ajout en cours…', 'pending'); }
          const fresh = await signOnServer(sel);
          const result = await addToKapyo(fresh);
          if (btn) {
            const label = fresh.variation_label ? ' (' + fresh.variation_label.replace(/<[^>]+>/g, '') + ')' : '';
            const qty = fresh.quantity > 1 ? ' ×' + fresh.quantity : '';
            setStatus(btn, 'Ajouté à votre panier Kapyo ✓' + qty + label, 'success');
            markAsInCart(btn, result);
            btn.disabled = false;
          }
        }
      } catch (e) {
        console.error('[kapyo-cart] resume error', e);
        if (btn) { btn.disabled = false; setStatus(btn, 'Erreur: ' + e.message, 'error'); }
      }
    }
    checkAlreadyInCart();
  })();

  async function addToKapyo(payload) {
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
    const status = btn.parentElement.querySelector('.kapyo-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind || '';
  }

  // Toggles the button to an "already in cart" state with a link to the SaaS.
  function markAsInCart(btn, item) {
    btn.dataset.inCart = '1';
    const variation = item.variation_label ? ' (' + item.variation_label.replace(/<[^>]+>/g, '') + ')' : '';
    btn.textContent = '✓ Déjà dans votre panier Kapyo ×' + item.quantity + variation;
    const status = btn.parentElement.querySelector('.kapyo-status');
    if (status) {
      status.innerHTML = ' <a href="' + cfg.kapyoUrl + '" target="_blank" rel="noopener">Voir le panier</a>';
    }
  }

  async function checkAlreadyInCart() {
    const btn = document.querySelector('.kapyo-add-to-cart');
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
    const btn = e.target.closest('.kapyo-add-to-cart');
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
        // Save the selection so we re-sign after returning from /auth/callback.
        sessionStorage.setItem('kapyo_pending', JSON.stringify(sel));
        await client.loginWithRedirect({
          appState: { returnTo: window.location.href },
        });
        return;
      }
      const signed = await signOnServer(sel);
      const result = await addToKapyo(signed);
      const label = signed.variation_label ? ' (' + signed.variation_label.replace(/<[^>]+>/g, '') + ')' : '';
      const qty = signed.quantity > 1 ? ' ×' + signed.quantity : '';
      setStatus(btn, 'Ajouté à votre panier Kapyo ✓' + qty + label, 'success');
      // Switch the button to the "already in cart" state immediately so the
      // user sees they don't need to click again.
      markAsInCart(btn, result);
    } catch (err) {
      console.error('[kapyo-cart]', err);
      setStatus(btn, 'Erreur: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
