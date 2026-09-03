/* Ephemeral Smart Canvas Presence controller and renderer. */
(() => {
    const shellElement = document.getElementById('shell');
    const pointerOverlay = document.getElementById('presencePointerOverlay');
    const membersHost = document.getElementById('presenceMembers');
    const members = new Map();
    const pointerElements = new Map();
    const pointerLabelTimers = new Map();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const fixedUiSelector = [
        '.smart-back',
        '.smart-log-toggle',
        '#presenceMembers',
        '#smartCanvasDock',
        '#composer',
        '#minimap',
        '.smart-canvas-settings-panel',
        'ic-menu',
        'ic-popover',
        'ic-dialog',
        '[role="dialog"]',
        '.smart-log-modal',
        '.generation-failure-alert-queue'
    ].join(',');
    let enabled = false;
    let capabilityKnown = false;
    let selfParticipantId = '';
    let membershipVersion = 0;
    let updateIntervalMs = 100;
    let seq = 0;
    let pointerOrder = 0;
    let pendingCursor = null;
    let pendingTimer = 0;
    let lastSentAt = 0;
    let lastObservedScreen = null;
    let accumulatedDistance = 0;
    let pointerActive = false;
    let overflowPopover = null;

    const tr = key => window.StudioI18n?.t?.(key) || key;
    const trf = (key, values = {}) => {
        if (window.StudioI18n?.format) return window.StudioI18n.format(key, values);
        return Object.entries(values).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            tr(key),
        );
    };
    const displayName = member => String(member?.display_name || member?.username || '').trim();
    const persistence = () => window.SmartCanvasModules?.canvasPersistence;
    const viewportApi = () => window.SmartCanvasModules?.viewportSelection?.viewport;

    function send(message) {
        return persistence()?.sendPresence?.(message) === true;
    }

    function sendCursor(cursor) {
        if (!enabled) return false;
        seq += 1;
        if (!Number.isSafeInteger(seq)) seq = 1;
        if (!send({ type: 'presence_update', seq, cursor })) return false;
        lastSentAt = performance.now();
        return true;
    }

    function clearPendingTimer() {
        if (pendingTimer) window.clearTimeout(pendingTimer);
        pendingTimer = 0;
    }

    function flushPendingCursor() {
        clearPendingTimer();
        if (!pendingCursor || !enabled) return;
        const cursor = pendingCursor;
        pendingCursor = null;
        accumulatedDistance = 0;
        sendCursor(cursor);
    }

    function queueCursor(cursor, { immediate = false } = {}) {
        pendingCursor = cursor;
        if (immediate || !lastSentAt) {
            flushPendingCursor();
            return;
        }
        const elapsed = performance.now() - lastSentAt;
        if (elapsed >= updateIntervalMs) {
            flushPendingCursor();
            return;
        }
        if (!pendingTimer) {
            pendingTimer = window.setTimeout(flushPendingCursor, updateIntervalMs - elapsed);
        }
    }

    function deactivatePointer() {
        // Publish the last queued canvas position before pausing capture.
        // Membership and the public pointer live until the account goes offline.
        flushPendingCursor();
        pendingCursor = null;
        accumulatedDistance = 0;
        lastObservedScreen = null;
        pointerActive = false;
    }

    function eventInsideCaptureArea(event) {
        if (!shellElement?.contains(event.target)) return false;
        return !(event.target instanceof Element && event.target.closest(fixedUiSelector));
    }

    function onPointerMove(event) {
        if (!enabled || event.pointerType !== 'mouse') return;
        if (!eventInsideCaptureArea(event)) {
            deactivatePointer();
            return;
        }
        const screen = { x: event.clientX, y: event.clientY };
        const wasActive = pointerActive;
        pointerActive = true;
        if (lastObservedScreen) {
            accumulatedDistance += Math.hypot(
                screen.x - lastObservedScreen.x,
                screen.y - lastObservedScreen.y,
            );
        }
        lastObservedScreen = screen;
        if (wasActive && accumulatedDistance < 5) return;
        const cursor = viewportApi()?.screenToWorld?.(event);
        if (!Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return;
        queueCursor({ x: cursor.x, y: cursor.y }, { immediate: !wasActive });
    }

    function participantById(participantId) {
        for (const member of members.values()) {
            if (member.participant_id === participantId) return member;
        }
        return null;
    }

    function avatarButton(member, { listItem = false } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'presence-avatar-button';
        const name = displayName(member);
        const own = member.participant_id === selfParticipantId;
        const accessibleName = own ? `${name} · ${tr('smart.presenceYou')}` : name;
        button.setAttribute('aria-label', accessibleName);
        const avatar = window.InfiniteCanvasAccountAvatar?.create?.(member)
            || document.createElement('span');
        avatar.dataset.pointerColorSlot = String(member.pointer_color_slot || 1);
        button.appendChild(avatar);
        if (!listItem) return button;
        const tooltip = document.createElement('ic-tooltip');
        tooltip.setAttribute('content', accessibleName);
        tooltip.setAttribute('placement', 'block-end');
        button.slot = 'trigger';
        tooltip.appendChild(button);
        const item = document.createElement('span');
        item.setAttribute('role', 'listitem');
        item.appendChild(tooltip);
        return item;
    }

    function renderMemberPopover(popover, ordered) {
        const list = document.createElement('div');
        list.className = 'presence-member-list';
        list.setAttribute('role', 'list');
        ordered.forEach(member => {
            const row = document.createElement('div');
            row.className = 'presence-member-row';
            row.setAttribute('role', 'listitem');
            const avatar = window.InfiniteCanvasAccountAvatar?.create?.(member)
                || document.createElement('span');
            avatar.dataset.pointerColorSlot = String(member.pointer_color_slot || 1);
            const name = document.createElement('span');
            name.className = 'presence-member-name';
            name.textContent = displayName(member);
            name.title = displayName(member);
            row.append(avatar, name);
            if (member.participant_id === selfParticipantId) {
                const you = document.createElement('span');
                you.className = 'presence-member-you';
                you.textContent = tr('smart.presenceYou');
                row.appendChild(you);
            }
            list.appendChild(row);
        });
        popover.replaceChildren(popover.querySelector('[slot="trigger"]'), list);
    }

    function renderMembers() {
        if (!membersHost) return;
        if (!capabilityKnown || !members.size) {
            overflowPopover?.hide?.('programmatic');
            membersHost.hidden = true;
            membersHost.replaceChildren();
            return;
        }
        const ordered = [...members.values()];
        const own = ordered.find(member => member.participant_id === selfParticipantId);
        const others = ordered.filter(member => member !== own);
        const directOtherCount = Math.max(0, 5 - (own ? 1 : 0));
        const visibleOthers = others.slice(0, directOtherCount);
        const hiddenCount = Math.max(0, others.length - visibleOthers.length);
        const group = document.createElement('div');
        group.className = 'presence-avatar-strip';
        group.setAttribute('role', 'list');
        if (hiddenCount) {
            const popover = document.createElement('ic-popover');
            popover.className = 'presence-overflow-popover';
            popover.setAttribute('label', tr('smart.presenceMemberList'));
            popover.setAttribute('content', 'interactive');
            popover.setAttribute('dismiss-policy', 'light');
            popover.setAttribute('focus-policy', 'move-into');
            popover.setAttribute('placement', 'block-end');
            popover.setAttribute('alignment', 'end');
            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.slot = 'trigger';
            trigger.className = 'presence-overflow-button';
            trigger.textContent = `+${hiddenCount}`;
            trigger.setAttribute('aria-label', trf('smart.presenceOverflow', { n: hiddenCount }));
            trigger.setAttribute('aria-expanded', 'false');
            trigger.addEventListener('click', () => {
                if (popover.hasAttribute('open')) popover.hide('toggle');
                else popover.show(trigger);
            });
            popover.appendChild(trigger);
            renderMemberPopover(popover, ordered);
            group.appendChild(popover);
            overflowPopover = popover;
        } else {
            overflowPopover?.hide?.('programmatic');
            overflowPopover = null;
        }
        visibleOthers.slice().reverse().forEach(member => group.appendChild(avatarButton(member, { listItem: true })));
        if (own) group.appendChild(avatarButton(own, { listItem: true }));
        membersHost.replaceChildren(group);
        membersHost.hidden = false;
    }

    function pointerElement(member) {
        let element = pointerElements.get(member.participant_id);
        if (element) return element;
        element = document.createElement('div');
        element.className = 'realtime-pointer';
        element.dataset.pointerColorSlot = String(member.pointer_color_slot || 1);
        element.setAttribute('aria-hidden', 'true');
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrow.setAttribute('viewBox', '0 0 18 22');
        arrow.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', 'M2 1.5 16.2 13 9.4 13.7 6.2 20.5Z');
        arrow.appendChild(shape);
        const label = document.createElement('span');
        label.className = 'realtime-pointer-label';
        label.textContent = displayName(member);
        label.title = displayName(member);
        element.append(arrow, label);
        pointerOverlay?.appendChild(element);
        pointerElements.set(member.participant_id, element);
        return element;
    }

    function removePointer(participantId) {
        pointerElements.get(participantId)?.remove();
        pointerElements.delete(participantId);
        window.clearTimeout(pointerLabelTimers.get(participantId));
        pointerLabelTimers.delete(participantId);
    }

    function projectMember(member, { moved = false } = {}) {
        if (member.participant_id === selfParticipantId || !member.cursor) {
            removePointer(member.participant_id);
            return;
        }
        const view = viewportApi()?.state?.();
        if (!view || !Number.isFinite(view.scale)) return;
        const x = view.x + Number(member.cursor.x) * view.scale;
        const y = view.y + Number(member.cursor.y) * view.scale;
        const element = pointerElement(member);
        const visible = x >= 0 && y >= 0 && x <= shellElement.clientWidth && y <= shellElement.clientHeight;
        element.hidden = !visible;
        if (!visible) return;
        const previousX = Number(element.dataset.projectedX);
        const previousY = Number(element.dataset.projectedY);
        const now = performance.now();
        const lastMove = Number(element.dataset.lastMoveAt || 0);
        const distance = Number.isFinite(previousX) && Number.isFinite(previousY)
            ? Math.hypot(x - previousX, y - previousY)
            : Infinity;
        const jump = reducedMotion?.matches || !moved || !lastMove || now - lastMove > 1000 || distance > 400;
        element.style.transitionDuration = jump ? '0ms' : `${Math.min(updateIntervalMs, 120)}ms`;
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        element.style.zIndex = String(30 + (++pointerOrder));
        element.dataset.projectedX = String(x);
        element.dataset.projectedY = String(y);
        if (moved) {
            element.dataset.lastMoveAt = String(now);
            element.classList.add('is-label-visible');
            window.clearTimeout(pointerLabelTimers.get(member.participant_id));
            const timer = window.setTimeout(() => {
                element.classList.remove('is-label-visible');
            }, reducedMotion?.matches ? 0 : 1500);
            pointerLabelTimers.set(member.participant_id, timer);
        }
    }

    function reproject() {
        members.forEach(member => projectMember(member));
    }

    function applySnapshot(message) {
        if (Number(message.protocol_version) !== 1 || !Array.isArray(message.members)) return;
        enabled = true;
        capabilityKnown = true;
        selfParticipantId = String(message.self_participant_id || '');
        membershipVersion = Number(message.membership_version || 0);
        updateIntervalMs = Math.max(50, Math.min(500, Number(message.update_interval_ms) || 100));
        seq = 0;
        const nextIds = new Set();
        members.clear();
        message.members.forEach(member => {
            if (!member || !member.participant_id) return;
            const normalized = { ...member, participant_id: String(member.participant_id) };
            members.set(normalized.participant_id, normalized);
            nextIds.add(normalized.participant_id);
        });
        [...pointerElements.keys()].forEach(id => { if (!nextIds.has(id)) removePointer(id); });
        renderMembers();
        members.forEach(member => projectMember(member));
    }

    function validMembershipVersion(message) {
        const next = Number(message.membership_version || 0);
        if (next <= membershipVersion) return false;
        if (next !== membershipVersion + 1) {
            send({ type: 'presence_resync' });
            return false;
        }
        membershipVersion = next;
        return true;
    }

    function receive(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'presence_snapshot') {
            applySnapshot(message);
            return;
        }
        if (!enabled || Number(message.protocol_version) !== 1) return;
        if (message.type === 'presence_join') {
            if (!validMembershipVersion(message) || !message.member?.participant_id) return;
            const member = { ...message.member, participant_id: String(message.member.participant_id) };
            members.set(member.participant_id, member);
            renderMembers();
            projectMember(member);
            return;
        }
        if (message.type === 'presence_leave') {
            if (!validMembershipVersion(message)) return;
            const participantId = String(message.participant_id || '');
            members.delete(participantId);
            removePointer(participantId);
            renderMembers();
            return;
        }
        if (message.type === 'presence_batch' && Array.isArray(message.updates)) {
            message.updates.forEach(update => {
                const member = participantById(String(update?.participant_id || ''));
                if (!member) return;
                const version = Number(update.cursor_version || 0);
                if (version <= Number(member.cursor_version || 0)) return;
                member.cursor_version = version;
                member.cursor = update.cursor && Number.isFinite(Number(update.cursor.x)) && Number.isFinite(Number(update.cursor.y))
                    ? { x: Number(update.cursor.x), y: Number(update.cursor.y) }
                    : null;
                projectMember(member, { moved: member.cursor !== null });
            });
        }
    }

    function disconnect() {
        clearPendingTimer();
        pendingCursor = null;
        pointerActive = false;
        lastObservedScreen = null;
        accumulatedDistance = 0;
        pointerElements.forEach(element => element.remove());
        pointerElements.clear();
        const own = participantById(selfParticipantId);
        members.clear();
        if (own) members.set(own.participant_id, own);
        enabled = false;
        overflowPopover?.hide?.('programmatic');
        renderMembers();
    }

    shellElement?.addEventListener('pointermove', onPointerMove, { passive: true });
    shellElement?.addEventListener('pointerleave', deactivatePointer, { passive: true });
    window.addEventListener('blur', deactivatePointer);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') deactivatePointer();
    });
    window.addEventListener('resize', reproject, { passive: true });
    window.addEventListener('studio-lang-change', renderMembers);
    new MutationObserver(() => overflowPopover?.hide?.('feedback'))
        .observe(document.getElementById('generationFailureAlertQueue') || document.body, { childList: true, subtree: true });

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.realtimePresence = Object.freeze({
        receive,
        disconnect,
        reproject,
        state: () => ({
            enabled,
            selfParticipantId,
            membershipVersion,
            memberCount: members.size,
            updateIntervalMs,
        }),
    });
})();
