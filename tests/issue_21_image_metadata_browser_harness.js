/* Non-product acceptance fixture, loaded only by issue_21_image_metadata_browser_app.cjs. */
(function(){
    const image = (width,height,extra={}) => ({url:`/test-media/${width}x${height}.svg`,name:`${width}×${height}`,kind:'image',natural_w:width,natural_h:height,...extra});
    const node = (id,x,y,images,extra={}) => ({id,type:'smart-image',title:id,x,y,w:280,h:190,images,...extra});
    const sampleNodes = [
        node('exact',40,100,[image(1024,1024)],{w:210,h:210}),
        node('simple',300,100,[image(1344,768)]),
        node('near',630,100,[image(1920,1088)]),
        node('decimal',40,390,[image(1024,600)]),
        node('ultrawide',370,390,[image(2560,1080)]),
        node('multi',700,390,[image(2560,1080),image(1000,667),image(1088,1920)],{w:320,h:190}),
        node('partial',40,680,[image(1000,667,{url:'/test-media/1000x667.svg?delayed=1',natural_w:1000,natural_h:undefined})]),
        {id:'group',type:'smart-group',title:'Group',x:380,y:680,w:350,h:240,images:[image(1344,768),image(1920,1088)],items:[]}
    ];
    window.SmartCanvasModules.nodeReviewFixture = {create:() => ({canvas:{id:'issue-21-review',title:'Issue #21',nodes:sampleNodes,connections:[],settings:{},logs:[]},config:{apiProviders:[],availableModels:{image:[],video:[],text:[]}}})};

    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;z-index:10000;top:8px;left:8px;padding:8px 12px;background:#fff;color:#222;border:1px solid #ddd;border-radius:8px;font:12px system-ui;display:flex;gap:12px;align-items:center';
    panel.innerHTML = '<strong>Issue #21</strong><output id="issue21-result">Running…</output><button id="issue21-en">English</button><button id="issue21-zh">中文</button><button id="issue21-theme">Light / dark</button><button id="issue21-select">Show all badges</button><button id="issue21-zoom">100%</button>';
    document.body.appendChild(panel);
    panel.querySelector('#issue21-en').onclick = () => window.StudioI18n.set('en');
    panel.querySelector('#issue21-zh').onclick = () => window.StudioI18n.set('zh');
    panel.querySelector('#issue21-theme').onclick = () => applyTheme(document.body.classList.contains('theme-dark') ? 'light' : 'dark');
    panel.querySelector('#issue21-select').onclick = () => document.querySelectorAll('.image-wrap,.thumb-item').forEach(element => element.classList.add('image-selected'));
    panel.querySelector('#issue21-zoom').onclick = () => {
        viewport = {x:40,y:0,scale:1};
        window.SmartCanvasModules.viewportSelection.viewport.apply();
    };
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const checks = [];
    function check(condition,message){
        if(!condition) throw new Error(message);
        checks.push(message);
    }
    function element(id){return document.querySelector(`.image-node[data-id="${id}"]`);}
    function texts(id){return [...element(id).querySelectorAll('.image-aspect-ratio-badge')].map(badge => badge.textContent);}

    window.addEventListener('load',async () => {
        try {
            await nextFrame();
            check(document.documentElement.dataset.nodesStatus === 'ready','Real Smart Canvas review page ready');
            for(const [id,label] of [['exact','1:1'],['simple','7:4'],['near','≈ 16:9'],['decimal','≈ 1.71:1'],['ultrawide','≈ 2.37:1']]){
                check(texts(id)[0] === label, `${id}: ${label}`);
                check(element(id).querySelectorAll('.image-metadata-badges > span').length === 2,`${id}: separate badges`);
            }
            check(texts('multi').join(',') === '≈ 2.37:1,≈ 3:2,≈ 9:16','All images in a multi-image Node have individual ratios');
            check(texts('group').join(',') === '7:4,≈ 16:9','Smart Group media use the same badge rules');
            check(!element('partial').querySelector('.image-metadata-badges'),'Incomplete natural size stays hidden before load');
            const originalSize = element('near').getBoundingClientRect();
            window.StudioI18n.set('en');
            await nextFrame();
            check(element('near').querySelector('.image-aspect-ratio-badge').getAttribute('aria-label') === 'Aspect ratio: approximately 16:9','English dynamic description');
            check(element('near').querySelector('.image-resolution-badge').getAttribute('aria-label') === 'Resolution: 1920 by 1088 pixels','English resolution description');
            check(texts('near')[0] === '≈ 16:9','English ratio keeps the approximation marker');
            check(imageResolutionLabel(image(1920,1088)) === '1920 x 1088','Generation log dimensions remain resolution-only');
            check(smartLogSizeSummary({request:{size:'1920x1088'}},[image(1920,1088)]) === trf('smart.actual',{actual:'1920 x 1088'}),'English log recognizes matching pixel sizes');
            check(smartLogSizeSummary({request:{size:'1920x1080'}},[image(1920,1088)]) === trf('smart.requestActual',{requested:'1920 x 1080',actual:'1920 x 1088'}),'English log preserves distinct requested and actual pixel sizes');
            window.StudioI18n.set('zh');
            await nextFrame();
            check(element('near').querySelector('.image-aspect-ratio-badge').getAttribute('aria-label') === '宽高比约为 16:9','Chinese dynamic description');
            check(Math.abs(element('near').getBoundingClientRect().width - originalSize.width) < 0.1,'Badges do not resize the Node');
            const deadline = Date.now()+5000;
            while(!element('partial').querySelector('.image-aspect-ratio-badge') && Date.now()<deadline) await nextFrame();
            check(texts('partial')[0] === '≈ 3:2','Incomplete dimensions recover from the original image load');
            check(element('partial').querySelector('.image-resolution-badge').textContent === '1000×667','Resolution and ratio refresh together');
            // Exercise the same update used by the original-image load path on a thumbnail.
            const thumb = element('multi').querySelector('.thumb-item');
            updateImageResolutionBadgeElement(thumb,image(1200,1000));
            await nextFrame();
            check(thumb.querySelector('.thumb-media-frame > .image-metadata-badges .image-aspect-ratio-badge').textContent === '6:5','Thumbnail updates stay inside the media frame');
            check(thumb.querySelector('.image-aspect-ratio-badge ic-icon')?.dataset.iconStatus === 'ready','Refreshing dimensions renders the ratio icon without a page redraw');
            updateImageResolutionBadgeElement(thumb,image(1200,1000,{kind:'video'}));
            check(thumb.querySelector('.image-resolution-badge') && !thumb.querySelector('.image-aspect-ratio-badge'),'Video metadata keeps only the resolution badge');
            updateImageResolutionBadgeElement(thumb,{});
            check(!thumb.querySelector('.image-metadata-badges'),'Missing size removes both badges');
            updateImageResolutionBadgeElement(thumb,image(2560,1080));
            check(thumb.querySelectorAll('.image-metadata-badges').length === 1,'Recovery recreates exactly one badge pair');
            const before = nodes.find(item => item.id === 'decimal').images[0];
            nodes.find(item => item.id === 'decimal').images[0] = image(1200,1000);
            render();
            await nextFrame();
            check(texts('decimal')[0] === '6:5','Replacing media refreshes the ratio');
            nodes.find(item => item.id === 'decimal').images[0] = before;
            render();
            await nextFrame();
            const frame = element('multi').querySelector('.thumb-media-frame');
            const pair = frame.querySelector('.image-metadata-badges');
            const [resolution,ratio] = pair.children;
            check([...document.querySelectorAll('.image-aspect-ratio-badge')].every(badge => {
                const icon = badge.firstElementChild;
                return icon?.getAttribute('name') === 'aspect-ratio' && icon.dataset.iconStatus === 'ready' && icon.getAttribute('aria-hidden') === 'true';
            }),'Every ratio retains its decorative proportions icon after language switches and media recovery');
            const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
            check(Math.abs(resolution.getBoundingClientRect().height/scale - 16) < 0.2,'Resolution badge retains the 16px visual size');
            check(ratio.getBoundingClientRect().top > resolution.getBoundingClientRect().top,'Narrow thumbnails wrap the ratio badge');
            check(ratio.getBoundingClientRect().right <= frame.getBoundingClientRect().right+1,'Wrapped ratio fits the thumbnail');
            check(smartLogSizeSummary({request:{size:'1024x1024'}},[image(1024,1024)]) === trf('smart.actual',{actual:'1024 x 1024'}),'Matching generation log sizes are not reported as different');
            document.documentElement.dataset.issue21Status = 'passed';
            panel.querySelector('output').textContent = `${checks.length} checks passed`;
            panel.querySelector('output').title = checks.join('\n');
        } catch(error){
            document.documentElement.dataset.issue21Status = 'failed';
            panel.querySelector('output').textContent = error.message;
            console.error(error);
        }
    });
})();
