(function(){
    const KEY = 'studio_lang';
    const DEFAULT_LANG = 'zh';
    const dict = { zh: {}, en: {} };

    function lang(){
        return localStorage.getItem(KEY) || DEFAULT_LANG;
    }

    function normalizeEntry(key, entry){
        if(entry && typeof entry === 'object' && !Array.isArray(entry) && ('zh' in entry || 'en' in entry)){
            return {
                zh: entry.zh == null ? (entry.en == null ? key : String(entry.en)) : String(entry.zh),
                en: entry.en == null ? (entry.zh == null ? key : String(entry.zh)) : String(entry.en),
            };
        }
        const value = entry == null ? key : String(entry);
        return { zh: value, en: value };
    }

    function register(bundle){
        if(!bundle || typeof bundle !== 'object') return;
        if(bundle.zh || bundle.en){
            Object.assign(dict.zh, bundle.zh || {});
            Object.assign(dict.en, bundle.en || {});
            return;
        }
        Object.entries(bundle).forEach(([key, entry]) => {
            const normalized = normalizeEntry(key, entry);
            dict.zh[key] = normalized.zh;
            dict.en[key] = normalized.en;
        });
    }

    function t(key){
        const current = lang();
        return dict[current]?.[key] || dict[DEFAULT_LANG]?.[key] || key;
    }

    function format(key, values={}){
        return t(key).replace(/\{([^{}]+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
        ));
    }

    function apply(root=document){
        root.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.dataset.i18n);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const value = t(el.dataset.i18nPlaceholder);
            el.setAttribute('placeholder', value);
            if(el.hasAttribute('data-placeholder')) el.setAttribute('data-placeholder', value);
        });
        [
            ['data-i18n-label', 'label'],
            ['data-i18n-description', 'description'],
            ['data-i18n-confirm-label', 'confirm-label'],
            ['data-i18n-cancel-label', 'cancel-label'],
            ['data-i18n-button-label', 'button-label'],
            ['data-i18n-upload-button-label', 'upload-button-label'],
            ['data-i18n-hint', 'hint'],
            ['data-i18n-content', 'content'],
            ['data-i18n-empty-label', 'empty-label'],
            ['data-i18n-adaptive-label', 'adaptive-label'],
            ['data-i18n-keep-ratio-label', 'keep-ratio-label'],
        ].forEach(([selector, attribute]) => {
            root.querySelectorAll(`[${selector}]`).forEach(el => {
                const datasetKey = selector.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                el.setAttribute(attribute, t(el.dataset[datasetKey]));
            });
        });
        root.querySelectorAll('[data-i18n-subtitle]').forEach(el => {
            el.setAttribute('subtitle', t(el.dataset.i18nSubtitle));
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.setAttribute('title', t(el.dataset.i18nTitle));
        });
        root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
        });
        root.querySelectorAll('[data-i18n-alt]').forEach(el => {
            el.setAttribute('alt', t(el.dataset.i18nAlt));
        });
        root.querySelectorAll('[data-i18n-value]').forEach(el => {
            el.setAttribute('value', t(el.dataset.i18nValue));
        });
        root.documentElement?.setAttribute('lang', lang() === 'en' ? 'en' : 'zh-CN');
        window.dispatchEvent(new CustomEvent('studio-lang-change', { detail:{ lang:lang() } }));
    }

    function set(next){
        localStorage.setItem(KEY, next === 'en' ? 'en' : 'zh');
        apply();
    }

    function toggle(){
        set(lang() === 'en' ? 'zh' : 'en');
    }

    function entries(){
        return JSON.parse(JSON.stringify(dict));
    }

    window.StudioI18n = { t, format, apply, set, toggle, lang, register, entries };
    window.addEventListener?.('message', event => {
        if(event.origin && event.origin !== window.location?.origin) return;
        if(event.data?.type === 'studio-lang' && event.data.lang) set(event.data.lang);
    });
    document.addEventListener('DOMContentLoaded', () => apply());
})();
