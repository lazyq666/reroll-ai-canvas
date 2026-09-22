(() => {
  const ASSET_VERSION = 'asset-a8a0ed23b7e4';
  const MANIFEST_URL = '/static/images/avatars/manifest.json?v=asset-0f2c77be2450';
  const ASSET_ROOT = '/static/images/avatars/';
  const assets = new Set();
  let channel = null;

  const ready = fetch(MANIFEST_URL, { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error('Account Avatar manifest is unavailable');
      return response.json();
    })
    .then(payload => {
      (Array.isArray(payload?.assets) ? payload.assets : []).forEach(asset => {
        if (typeof asset === 'string' && asset && !asset.includes('/') && !asset.includes('\\')) assets.add(asset);
      });
      if (!assets.size) throw new Error('Account Avatar manifest is empty');
      return Object.freeze([...assets]);
    })
    .catch(() => Object.freeze([]));

  function fallback(element) {
    delete element.dataset.avatarAsset;
    const icon = document.createElement('ic-icon');
    icon.setAttribute('name', 'account');
    icon.setAttribute('size', 'small');
    icon.setAttribute('aria-hidden', 'true');
    element.replaceChildren(icon);
  }

  function render(element, asset) {
    if (!assets.has(asset)) {
      fallback(element);
      return;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.src = `${ASSET_ROOT}${encodeURIComponent(asset)}?v=${ASSET_VERSION}`;
    image.addEventListener('error', () => {
      if (element.dataset.avatarAssetRequest === asset) fallback(element);
    }, { once: true });
    element.dataset.avatarAsset = asset;
    element.replaceChildren(image);
  }

  function apply(element, user = {}) {
    if (!element) return element;
    const asset = String(user.avatar_asset || '');
    element.classList.add('ic-account-avatar');
    element.setAttribute('aria-hidden', 'true');
    element.dataset.avatarAssetRequest = asset;
    if (user.id) element.dataset.accountUserId = String(user.id);
    fallback(element);
    ready.then(() => {
      if (element.dataset.avatarAssetRequest === asset) render(element, asset);
    });
    return element;
  }

  function create(user = {}, { tag = 'span' } = {}) {
    return apply(document.createElement(tag), user);
  }

  function updateUser(user = {}) {
    const id = String(user.id || '');
    if (!id) return;
    document.querySelectorAll('.ic-account-avatar[data-account-user-id]').forEach(element => {
      if (element.dataset.accountUserId === id) apply(element, user);
    });
  }

  function announce(user = {}) {
    window.dispatchEvent(new CustomEvent('account-avatar-updated', { detail: { user } }));
  }

  function publish(user = {}) {
    updateUser(user);
    announce(user);
    try { channel?.postMessage({ type: 'account-avatar-updated', user }); } catch (_) {}
  }

  try {
    channel = new BroadcastChannel('reroll-account-avatar');
    channel.addEventListener('message', event => {
      if (event.data?.type !== 'account-avatar-updated') return;
      updateUser(event.data.user);
      announce(event.data.user);
    });
  } catch (_) {}

  window.InfiniteCanvasAccountAvatar = Object.freeze({
    apply,
    create,
    publish,
    ready,
    updateUser,
    assetUrl: asset => assets.has(asset) ? `${ASSET_ROOT}${encodeURIComponent(asset)}` : '',
    isValidAsset: asset => assets.has(String(asset || '')),
  });
})();
