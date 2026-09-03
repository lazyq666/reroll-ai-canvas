/* Read-only, ephemeral online membership for the currently rendered cards. */
(() => {
    const summaries = new Map();
    let timer = 0;
    let request = null;
    const hosts = () => [...document.querySelectorAll('.ws-card-presence')];
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const trf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
    const nameOf = member => String(member.display_name || member.username || '');
    const labelOf = member => member.is_self
        ? trf('workspace.presenceSelf', { name: nameOf(member) }) : nameOf(member);

    function tooltipButton(label, className) {
        const tooltip = document.createElement('ic-tooltip');
        tooltip.setAttribute('content', label);
        tooltip.setAttribute('placement', 'block-start');
        const button = document.createElement('button');
        button.type = 'button';
        button.slot = 'trigger';
        button.className = className;
        button.setAttribute('aria-label', label);
        tooltip.appendChild(button);
        return { tooltip, button };
    }

    function render(host, members, status = 'ready') {
        const key = JSON.stringify([window.StudioI18n?.lang?.(), status, members]);
        if (host.dataset.renderKey === key) return;
        host.dataset.renderKey = key;
        const focused = host.contains(document.activeElement);
        const focusKey = focused ? document.activeElement?.dataset.memberKey : '';
        const oldPopover = host.querySelector('ic-popover');
        const wasOpen = oldPopover?.hasAttribute('open');
        oldPopover?.hide?.('programmatic');
        host.replaceChildren();
        host.hidden = status === 'ready' && members.length === 0;
        host.dataset.status = status;
        host.setAttribute('aria-label', tr('workspace.presenceMembers'));
        if (host.hidden) {
            if (focused) host.closest('.ws-card')?.focus({ preventScroll: true });
            return;
        }
        if (status !== 'ready') {
            const { tooltip, button } = tooltipButton(
                tr(status === 'loading' ? 'workspace.presenceLoading' : 'workspace.presenceUnavailable'),
                'ws-presence-status',
            );
            button.textContent = '…';
            host.appendChild(tooltip);
            if (focused) button.focus({ preventScroll: true });
            return;
        }
        const own = members.find(member => member.is_self);
        const others = members.filter(member => member !== own);
        const visible = others.slice(0, own ? 2 : 3);
        if (own) visible.push(own);
        const strip = document.createElement('span');
        strip.className = 'ws-presence-strip';
        visible.forEach(member => {
            const { tooltip, button } = tooltipButton(labelOf(member), 'ws-presence-avatar');
            button.dataset.memberKey = member.participant_id;
            button.appendChild(window.InfiniteCanvasAccountAvatar.create(member));
            strip.appendChild(tooltip);
        });
        host.appendChild(strip);
        const hiddenCount = members.length - visible.length;
        if (hiddenCount) {
            const popover = document.createElement('ic-popover');
            popover.className = 'ws-presence-popover';
            for (const [key, value] of Object.entries({
                label: tr('workspace.presenceMembers'), content: 'interactive',
                'dismiss-policy': 'light', 'focus-policy': 'move-into',
                placement: 'block-end', alignment: 'end',
            })) popover.setAttribute(key, value);
            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.slot = 'trigger';
            trigger.className = 'ws-presence-overflow';
            trigger.dataset.memberKey = 'overflow';
            trigger.textContent = `+${hiddenCount}`;
            trigger.setAttribute('aria-label', trf('workspace.presenceOverflow', { n: hiddenCount }));
            trigger.setAttribute('aria-expanded', 'false');
            trigger.addEventListener('click', async () => {
                await customElements.whenDefined('ic-popover');
                if (popover.hasAttribute('open')) popover.hide('toggle');
                else popover.show(trigger);
            });
            const list = document.createElement('div');
            list.className = 'ws-presence-member-list';
            list.setAttribute('role', 'list');
            members.forEach(member => {
                const row = document.createElement('div');
                row.className = 'ws-presence-member';
                row.setAttribute('role', 'listitem');
                const name = document.createElement('span');
                name.textContent = labelOf(member);
                row.append(window.InfiniteCanvasAccountAvatar.create(member), name);
                list.appendChild(row);
            });
            popover.append(trigger, list);
            host.appendChild(popover);
            if (wasOpen) customElements.whenDefined('ic-popover').then(() => {
                if (popover.isConnected) popover.show(trigger);
            });
        }
        if (focused) {
            const target = [...host.querySelectorAll('button')]
                .find(button => button.dataset.memberKey === focusKey) || host.querySelector('button');
            target?.focus({ preventScroll: true });
        }
    }

    function mount(host) {
        // Let the public popover handle Escape and focus management. Card/board
        // gestures and keyboard shortcuts must not consume member interactions.
        for (const eventName of ['mousedown', 'click', 'dblclick', 'keydown', 'keyup']) {
            host.addEventListener(eventName, event => {
                if (event.key !== 'Escape') event.stopPropagation();
            });
        }
        const members = summaries.get(host.dataset.canvasId);
        render(host, members || [], members ? 'ready' : 'loading');
    }

    function pause() {
        window.clearTimeout(timer);
        request?.abort();
        request = null;
        summaries.clear();
        hosts().forEach(host => render(host, [], 'loading'));
    }

    async function refresh() {
        window.clearTimeout(timer);
        request?.abort();
        request = null;
        const currentHosts = hosts();
        const ids = [...new Set(currentHosts.map(host => host.dataset.canvasId))];
        // Prune old projects/deleted cards; no cross-page presence cache.
        for (const id of summaries.keys()) if (!ids.includes(id)) summaries.delete(id);
        if (document.hidden || !ids.length) return;
        const controller = new AbortController();
        request = controller;
        try {
            for (let offset = 0; offset < ids.length; offset += 200) {
                const batch = ids.slice(offset, offset + 200);
                const timeout = window.setTimeout(() => controller.abort(), 4500);
                let data;
                try {
                    const response = await fetch('/api/canvases/presence', {
                        method: 'POST', cache: 'no-store', signal: controller.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ canvas_ids: batch }),
                    });
                    if (!response.ok) throw new Error('presence unavailable');
                    data = await response.json();
                } finally {
                    window.clearTimeout(timeout);
                }
                if (request !== controller) return;
                batch.forEach(id => {
                    const members = data.canvases?.[id];
                    if (Array.isArray(members)) summaries.set(id, members);
                    else summaries.delete(id);
                });
            }
            currentHosts.forEach(host => {
                const members = summaries.get(host.dataset.canvasId);
                render(host, members || [], members ? 'ready' : 'unavailable');
            });
        } catch (_) {
            if (request !== controller) return;
            summaries.clear();
            currentHosts.forEach(host => render(host, [], 'unavailable'));
        } finally {
            if (request === controller) {
                request = null;
                if (!document.hidden) timer = window.setTimeout(refresh, 5000);
            }
        }
    }

    document.addEventListener('visibilitychange', () => document.hidden ? pause() : refresh());
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('studio-lang-change', () => hosts().forEach(host => {
        render(host, summaries.get(host.dataset.canvasId) || [], host.dataset.status || 'loading');
    }));
    window.CanvasListPresence = Object.freeze({ mount, refresh });
})();
