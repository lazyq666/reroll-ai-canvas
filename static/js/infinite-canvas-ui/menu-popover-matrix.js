const cases = [...document.querySelectorAll('[data-menu-popover-case]')];
const status = document.querySelector('[data-menu-popover-status]');
for (const card of cases) { const query = new URLSearchParams({theme:card.dataset.theme,density:card.dataset.density,viewport:card.dataset.viewport,locale:card.dataset.locale,content:card.dataset.content,motion:card.dataset.motion,version:'iconless-1'}); card.querySelector('iframe').src=`/static/design-system/infinite-canvas-ui/menu-popover-case.html?${query}`; }
await Promise.all(cases.map(card => new Promise(resolve => card.querySelector('iframe').addEventListener('load', resolve, {once:true}))));
const deadline=performance.now()+15000; while(performance.now()<deadline && !cases.every(card=>['ready','failed'].includes(card.querySelector('iframe').contentDocument?.documentElement.dataset.menuPopoverCaseStatus))) await new Promise(resolve=>requestAnimationFrame(resolve));
const ready=cases.every(card=>card.querySelector('iframe').contentDocument?.documentElement.dataset.menuPopoverCaseStatus==='ready'); status.textContent=ready?'6/6 个实时情境已载入':'部分情境载入失败'; document.documentElement.dataset.menuPopoverMatrixStatus=ready?'ready':'failed';
