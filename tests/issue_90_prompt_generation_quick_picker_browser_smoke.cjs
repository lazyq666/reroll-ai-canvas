const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1180, height:800}});
        await context.route('**/static/js/smart-canvas/canvas-persistence.js*', async route => {
            const response = await route.fetch();
            const source = await response.text();
            const editableSource = source.replace(
                /function canvasPersistenceEditable\(\)\{[\s\S]*?\n\}/,
                'function canvasPersistenceEditable(){ return true; }'
            );
            assert.notEqual(editableSource, source);
            await route.fulfill({response, body:editableSource});
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/login`, {waitUntil:'domcontentloaded'});
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-90-prompt-generation-picker`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.promptAuthoring
            && typeof render === 'function'
            && typeof beginPromptNodeTextEdit === 'function'
        ));
        await page.waitForLoadState('networkidle');

        await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                availableModels.text = [{
                    id:'openai|gpt-4o-mini',
                    provider_id:'openai',
                    provider_name:'OpenAI',
                    model:'gpt-4o-mini',
                    name:'GPT-4o mini'
                }];
                promptLibraries = [{
                    id:'common',
                    name:'通用',
                    categories:[
                        {id:'composition', name:'构图'},
                        {id:'lighting', name:'光线'}
                    ],
                    items:[{
                        id:'common-composition',
                        name:'通用构图',
                        category:'composition',
                        positive:'COMMON_COMPOSITION_PROMPT'
                    }, {
                        id:'common-lighting',
                        name:'通用光线',
                        category:'lighting',
                        positive:'COMMON_LIGHTING_PROMPT'
                    }]
                }, {
                    id:'styles',
                    name:'当前画布',
                    scope:'canvas',
                    categories:[{id:'cg', name:'3D 风格'}],
                    items:[{
                        id:'warm-cg',
                        name:'暖阳赛璐璐 CG',
                        category:'cg',
                        positive:'FIRST_TEMPLATE_PROMPT'
                    }, ...Array.from({length:59}, (_, index) => ({
                        id:'template-' + index,
                        name:'测试模板 ' + (index + 1),
                        category:'cg',
                        positive:'TEMPLATE_' + index
                    }))]
                }];
                activePromptLibraryId = 'styles';
                builtinPromptTemplates = promptLibraries[1].items;
                const node = {
                    id:'issue-90-prompt-generation',
                    type:'smart-prompt',
                    title:'提示词生成',
                    x:360,
                    y:360,
                    w:360,
                    h:260,
                    llmEnabled:true,
                    llmInstruction:'',
                    llmProvider:'openai',
                    llmModel:'gpt-4o-mini'
                };
                canvas = {
                    id:'issue-90-prompt-generation-picker',
                    title:'Issue 90',
                    nodes:[node],
                    connections:[],
                    viewport:{x:0,y:0,scale:1},
                    settings:{},
                    logs:[]
                };
                nodes = canvas.nodes;
                selectedId = '';
                selectedIds = [];
                selectedImage = {nodeId:'',index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                composer.style.display = 'none';
                render();
                beginPromptNodeTextEdit(node.id);
            })();`;
            document.body.appendChild(script);
            script.remove();
        });

        const editor = page.locator(
            '.image-node[data-id="issue-90-prompt-generation"] .prompt-llm-instruction'
        );
        await assert.doesNotReject(editor.waitFor({state:'visible'}));
        await editor.type('/暖阳');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
            () => requestAnimationFrame(resolve)
        )));
        const openedState = await page.evaluate(() => {
            const editor = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"] .prompt-llm-instruction'
            );
            const picker = document.querySelector('#mentionPicker');
            const options = [...picker.shadowRoot.querySelectorAll('[part="option"]')];
            const firstOption = options[0];
            const firstName = firstOption?.querySelector('.name');
            const firstCategory = firstOption?.querySelector('.category');
            return {
                editorTag:editor?.tagName || '',
                editorValue:editor?.value ?? editor?.textContent ?? '',
                instruction:nodes.find(item => item.id === 'issue-90-prompt-generation')
                    ?.llmInstruction || '',
                pickerOpen:picker?.hasAttribute('open'),
                resultCount:options.length,
                itemIcon:firstOption?.querySelector('.icon ic-icon')?.getAttribute('name') || '',
                itemCategory:firstCategory?.textContent.trim() || '',
                itemNameTag:firstName?.tagName || '',
                itemNameWeight:getComputedStyle(firstName).fontWeight,
                itemNameColor:getComputedStyle(firstName).color,
                subtitleColor:(() => {
                    const probe = document.createElement('span');
                    probe.style.color = 'var(--ui-color-text-secondary)';
                    document.body.append(probe);
                    const color = getComputedStyle(probe).color;
                    probe.remove();
                    return color;
                })(),
                itemHeight:Math.round(firstOption?.getBoundingClientRect().height || 0),
                categoryGap:(() => {
                    const nameRect = firstName?.getBoundingClientRect();
                    const categoryRect = firstCategory?.getBoundingClientRect();
                    return nameRect && categoryRect
                        ? Math.round(categoryRect.left - nameRect.right)
                        : -1;
                })(),
                categoryVisualGap:(() => {
                    const name = firstName;
                    const categoryRect = firstCategory?.getBoundingClientRect();
                    if(!name?.firstChild || !categoryRect) return -1;
                    const range = document.createRange();
                    range.selectNodeContents(name);
                    return Math.round(categoryRect.left - range.getBoundingClientRect().right);
                })(),
            };
        });
        assert.equal(
            openedState.pickerOpen
                && openedState.resultCount === 1
                && openedState.itemIcon === 'book-text'
                && openedState.itemCategory === '当前画布'
                && openedState.itemNameTag === 'SPAN'
                && openedState.itemNameWeight === '400'
                && openedState.itemNameColor === openedState.subtitleColor
                && openedState.itemHeight === 24
                && openedState.categoryGap === 8
                && openedState.categoryVisualGap === 8,
            true,
            `Slash picker did not open for Prompt Generation Node: ${JSON.stringify(openedState)}`,
        );
        const pickerState = await page.locator('#mentionPicker').evaluate(picker => {
            const surface = picker.shadowRoot.querySelector('[part="surface"]');
            const rect = surface.getBoundingClientRect();
            const container = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"]'
            );
            const containerRect = container.getBoundingClientRect();
            const content = picker.shadowRoot.querySelector('[part="listbox"]');
            return {
                width:Math.round(rect.width),
                containerWidth:Math.round(containerRect.width),
                height:Math.round(rect.height),
                leftOffset:Math.round(rect.left - containerRect.left),
                gap:Math.round(containerRect.top - rect.bottom),
                maxHeight:Math.round(Number.parseFloat(getComputedStyle(surface).maxHeight)),
                insideViewport:rect.left >= 0 && rect.top >= 0
                    && rect.right <= innerWidth && rect.bottom <= innerHeight,
                headerVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-header')),
                footerVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-footer')),
                primaryTabsVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-primary-tabs')),
                categoryTabsVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-category-tabs')),
                contentScrollable:content.scrollHeight > content.clientHeight,
            };
        });
        assert.deepEqual(
            {
                width:pickerState.width,
                containerWidth:pickerState.containerWidth,
                leftOffset:pickerState.leftOffset,
                gap:pickerState.gap,
                maxHeight:pickerState.maxHeight,
                insideViewport:pickerState.insideViewport,
                headerVisible:pickerState.headerVisible,
                footerVisible:pickerState.footerVisible,
                primaryTabsVisible:pickerState.primaryTabsVisible,
                categoryTabsVisible:pickerState.categoryTabsVisible,
                contentScrollable:pickerState.contentScrollable,
            },
            {
                width:pickerState.containerWidth,
                containerWidth:pickerState.containerWidth,
                leftOffset:0,
                gap:4,
                maxHeight:288,
                insideViewport:true,
                headerVisible:false,
                footerVisible:false,
                primaryTabsVisible:false,
                categoryTabsVisible:false,
                contentScrollable:false,
            },
        );
        assert.ok(pickerState.height <= 288, pickerState);
        await editor.evaluate(element => {
            element.textContent = '/';
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            element.dispatchEvent(new InputEvent('input', {
                bubbles:true,
                data:'/',
                inputType:'insertText',
            }));
        });
        await page.waitForFunction(() => (
            document.querySelector('#mentionPicker')?.shadowRoot
                ?.querySelectorAll('[part="option"]').length === 62
        ));
        const expandedPickerState = await page.locator('#mentionPicker').evaluate(picker => {
            const rect = picker.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect();
            const containerRect = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"]'
            ).getBoundingClientRect();
            const content = picker.shadowRoot.querySelector('[part="listbox"]');
            return {
                width:Math.round(rect.width),
                height:Math.round(rect.height),
                leftOffset:Math.round(rect.left - containerRect.left),
                gap:Math.round(containerRect.top - rect.bottom),
                insideViewport:rect.left >= 0 && rect.top >= 0
                    && rect.right <= innerWidth && rect.bottom <= innerHeight,
                contentScrollable:content.scrollHeight > content.clientHeight,
            };
        });
        assert.deepEqual(
            {
                width:expandedPickerState.width,
                leftOffset:expandedPickerState.leftOffset,
                gap:expandedPickerState.gap,
                insideViewport:expandedPickerState.insideViewport,
                contentScrollable:expandedPickerState.contentScrollable,
            },
            {
                width:pickerState.width,
                leftOffset:0,
                gap:4,
                insideViewport:true,
                contentScrollable:true,
            },
        );
        assert.equal(expandedPickerState.height, 288);
        const arrowNavigationBefore = await editor.evaluate(element => {
            const picker = document.querySelector('#mentionPicker');
            return {
                activeIndex:picker.activeIndex,
                selected:picker.shadowRoot.querySelector('[aria-selected="true"]')
                    ?.getAttribute('data-index'),
            };
        });
        await editor.press('ArrowDown');
        const arrowNavigationAfterDown = await editor.evaluate(element => {
            const picker = document.querySelector('#mentionPicker');
            return {
                activeIndex:picker.activeIndex,
                selected:picker.shadowRoot.querySelector('[aria-selected="true"]')
                    ?.getAttribute('data-index'),
            };
        });
        await editor.press('ArrowUp');
        const arrowNavigationAfterUp = await editor.evaluate(element => {
            const picker = document.querySelector('#mentionPicker');
            return {
                activeIndex:picker.activeIndex,
                selected:picker.shadowRoot.querySelector('[aria-selected="true"]')
                    ?.getAttribute('data-index'),
            };
        });
        const arrowNavigationState = {
            before:arrowNavigationBefore,
            afterDown:arrowNavigationAfterDown,
            afterUp:arrowNavigationAfterUp,
        };
        assert.deepEqual(arrowNavigationState, {
            before:{activeIndex:0, selected:'0'},
            afterDown:{activeIndex:1, selected:'1'},
            afterUp:{activeIndex:0, selected:'0'},
        });
        const wheelBefore = await page.evaluate(() => ({
            x:viewport.x,
            y:viewport.y,
            scale:viewport.scale,
            scrollTop:document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="listbox"]').scrollTop,
        }));
        await page.locator('#mentionPicker').locator('[part="listbox"]').hover();
        await page.mouse.wheel(0, 160);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
            () => requestAnimationFrame(resolve)
        )));
        const wheelAfter = await page.evaluate(() => ({
            x:viewport.x,
            y:viewport.y,
            scale:viewport.scale,
            scrollTop:document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="listbox"]').scrollTop,
        }));
        assert.deepEqual(
            {
                x:wheelAfter.x,
                y:wheelAfter.y,
                scale:wheelAfter.scale,
            },
            {
                x:wheelBefore.x,
                y:wheelBefore.y,
                scale:wheelBefore.scale,
            },
            `Mention Picker wheel leaked into Canvas viewport: ${JSON.stringify({wheelBefore, wheelAfter})}`,
        );
        assert.ok(
            wheelAfter.scrollTop > wheelBefore.scrollTop,
            `Mention Picker did not consume its own wheel scroll: ${JSON.stringify({wheelBefore, wheelAfter})}`,
        );
        const boundaryWheelBefore = await page.evaluate(() => {
            const content = document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="listbox"]');
            content.scrollTop = content.scrollHeight;
            return {
                x:viewport.x,
                y:viewport.y,
                scale:viewport.scale,
                scrollTop:content.scrollTop,
            };
        });
        await page.mouse.wheel(0, 160);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
            () => requestAnimationFrame(resolve)
        )));
        const boundaryWheelAfter = await page.evaluate(() => ({
            x:viewport.x,
            y:viewport.y,
            scale:viewport.scale,
            scrollTop:document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="listbox"]').scrollTop,
        }));
        assert.deepEqual(
            {
                x:boundaryWheelAfter.x,
                y:boundaryWheelAfter.y,
                scale:boundaryWheelAfter.scale,
            },
            {
                x:boundaryWheelBefore.x,
                y:boundaryWheelBefore.y,
                scale:boundaryWheelBefore.scale,
            },
            `Mention Picker boundary wheel leaked into Canvas viewport: ${JSON.stringify({boundaryWheelBefore, boundaryWheelAfter})}`,
        );
        await editor.evaluate(element => {
            element.textContent = '/暖阳';
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            element.dispatchEvent(new InputEvent('input', {
                bubbles:true,
                data:'暖阳',
                inputType:'insertText',
            }));
        });
        await page.waitForFunction(() => (
            document.querySelector('#mentionPicker')?.shadowRoot
                ?.querySelectorAll('[part="option"]').length === 1
        ));
        const anchorBeforeCanvasPan = await page.evaluate(() => {
            const pickerRect = document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="surface"]').getBoundingClientRect();
            const containerRect = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"]'
            ).getBoundingClientRect();
            return {
                viewportY:viewport.y,
                pickerTop:Math.round(pickerRect.top),
                containerTop:Math.round(containerRect.top),
                leftOffset:Math.round(pickerRect.left - containerRect.left),
                gap:Math.round(containerRect.top - pickerRect.bottom),
            };
        });
        await page.mouse.move(1040, 120);
        await page.mouse.wheel(0, 120);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
            () => requestAnimationFrame(resolve)
        )));
        const anchorAfterCanvasPan = await page.evaluate(() => {
            const pickerRect = document.querySelector('#mentionPicker').shadowRoot
                .querySelector('[part="surface"]').getBoundingClientRect();
            const containerRect = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"]'
            ).getBoundingClientRect();
            return {
                viewportY:viewport.y,
                pickerTop:Math.round(pickerRect.top),
                containerTop:Math.round(containerRect.top),
                leftOffset:Math.round(pickerRect.left - containerRect.left),
                gap:Math.round(containerRect.top - pickerRect.bottom),
            };
        });
        assert.notEqual(
            anchorAfterCanvasPan.viewportY,
            anchorBeforeCanvasPan.viewportY,
            `Canvas did not pan during Picker anchor regression: ${JSON.stringify({anchorBeforeCanvasPan, anchorAfterCanvasPan})}`,
        );
        assert.deepEqual(
            {
                leftOffset:anchorAfterCanvasPan.leftOffset,
                gap:anchorAfterCanvasPan.gap,
            },
            {
                leftOffset:0,
                gap:4,
            },
            `Mention Picker detached from its trigger container after Canvas pan: ${JSON.stringify({anchorBeforeCanvasPan, anchorAfterCanvasPan})}`,
        );
        await page.evaluate(() => {
            viewport.x = 0;
            viewport.y = 0;
            viewport.scale = 1;
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(
            () => requestAnimationFrame(resolve)
        )));
        const pickerScreenshotPath = process.env.SMART_CANVAS_PICKER_QA_SCREENSHOT
            || '/tmp/issue-90-mention-picker-open.png';
        await page.screenshot({path:pickerScreenshotPath});
        const themeState = await page.evaluate(async () => {
            const picker = document.querySelector('#mentionPicker');
            const surface = picker.shadowRoot.querySelector('[part="surface"]');
            const lightBackground = getComputedStyle(surface).backgroundColor;
            applyTheme('dark');
            await new Promise(resolve => requestAnimationFrame(resolve));
            return {
                lightBackground,
                darkBackground:getComputedStyle(surface).backgroundColor,
                darkText:getComputedStyle(surface).color,
            };
        });
        assert.notEqual(themeState.lightBackground, themeState.darkBackground);
        const darkPickerScreenshotPath = process.env.SMART_CANVAS_DARK_PICKER_QA_SCREENSHOT
            || '/tmp/issue-90-mention-picker-open-dark.png';
        await page.screenshot({path:darkPickerScreenshotPath});
        await page.evaluate(() => applyTheme('light'));

        const option = page.locator('#mentionPicker').locator('[part="option"]').first();
        assert.equal((await option.locator('.name').textContent()).trim(), '暖阳赛璐璐 CG');
        await option.click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        const state = await page.evaluate(errors => {
            const node = nodes.find(item => item.id === 'issue-90-prompt-generation');
            const editor = document.querySelector(
                '.image-node[data-id="issue-90-prompt-generation"] .prompt-llm-instruction'
            );
            return {
                pickerOpen:document.querySelector('#mentionPicker')?.hasAttribute('open'),
                editorText:editor?.textContent || editor?.value || '',
                tokenCount:editor?.querySelectorAll?.('.prompt-template-token').length || 0,
                instruction:node?.llmInstruction || '',
                activeElementClass:document.activeElement?.className || '',
                pageErrors:errors,
            };
        }, pageErrors);
        assert.deepEqual(
            state.pageErrors.filter(message => message !== '画布不存在'),
            [],
        );
        assert.deepEqual(
            {
                pickerOpen:state.pickerOpen,
                tokenCount:state.tokenCount,
                instruction:state.instruction,
            },
            {
                pickerOpen:false,
                tokenCount:0,
                instruction:'FIRST_TEMPLATE_PROMPT',
            },
        );
        await page.evaluate(() => {
            render();
            beginPromptNodeTextEdit('issue-90-prompt-generation');
        });
        const redrawState = await page.locator(
            '.image-node[data-id="issue-90-prompt-generation"] .prompt-llm-instruction'
        ).evaluate(editor => ({
            editable:editor.isContentEditable,
            tokenCount:editor.querySelectorAll('.prompt-template-token').length,
            editorText:editor.textContent,
            instruction:nodes.find(item => item.id === 'issue-90-prompt-generation')
                ?.llmInstruction || '',
            instructionHtml:nodes.find(item => item.id === 'issue-90-prompt-generation')
                ?.llmInstructionHtml || '',
        }));
        assert.equal(redrawState.editable, true);
        assert.equal(redrawState.tokenCount, 0);
        assert.equal(redrawState.editorText, 'FIRST_TEMPLATE_PROMPT');
        assert.equal(redrawState.instruction, 'FIRST_TEMPLATE_PROMPT');
        assert.doesNotMatch(redrawState.instructionHtml, /prompt-template-token/);
        const redrawnEditor = page.locator(
            '.image-node[data-id="issue-90-prompt-generation"] .prompt-llm-instruction'
        );
        await redrawnEditor.type('/暖阳');
        await page.waitForFunction(() => (
            document.querySelector('#mentionPicker')?.shadowRoot
                ?.querySelectorAll('[part="option"]').length === 1
        ));
        await redrawnEditor.press('Enter');
        const enterState = await redrawnEditor.evaluate(editor => ({
            pickerOpen:document.querySelector('#mentionPicker')?.hasAttribute('open'),
            tokenCount:editor.querySelectorAll('.prompt-template-token').length,
            instruction:nodes.find(item => item.id === 'issue-90-prompt-generation')
                ?.llmInstruction || '',
        }));
        assert.equal(enterState.pickerOpen, false);
        assert.equal(enterState.tokenCount, 0);
        assert.equal(
            enterState.instruction,
            'FIRST_TEMPLATE_PROMPT\n\nFIRST_TEMPLATE_PROMPT',
        );

        const composerPickerState = await page.evaluate(async () => {
            composer.style.display = '';
            composer.style.left = '120px';
            composer.style.top = '600px';
            composer.classList.add('open');
            promptInput.innerHTML = '';
            setPromptCaretToEnd(promptInput);
            promptInput.textContent = '/';
            setPromptCaretToEnd(promptInput);
            promptInput.dispatchEvent(new InputEvent('input', {
                bubbles:true,
                data:'/',
                inputType:'insertText',
            }));
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const picker = document.querySelector('#mentionPicker');
            const container = composer.querySelector('.composer-card');
            const pickerRect = picker.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const result = {
                open:picker.hasAttribute('open'),
                width:Math.round(pickerRect.width),
                containerWidth:Math.round(containerRect.width),
                leftOffset:Math.round(pickerRect.left - containerRect.left),
                gap:Math.round(containerRect.top - pickerRect.bottom),
                height:Math.round(pickerRect.height),
                resultCount:picker.shadowRoot.querySelectorAll('[part="option"]').length,
                primaryTabsVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-primary-tabs')),
                categoryTabsVisible:Boolean(picker.shadowRoot.querySelector('.prompt-quick-category-tabs')),
            };
            closeMentionPicker();
            return result;
        });
        assert.deepEqual(
            {
                open:composerPickerState.open,
                width:composerPickerState.width,
                leftOffset:composerPickerState.leftOffset,
                gap:composerPickerState.gap,
                resultCount:composerPickerState.resultCount,
                primaryTabsVisible:composerPickerState.primaryTabsVisible,
                categoryTabsVisible:composerPickerState.categoryTabsVisible,
            },
            {
                open:true,
                width:composerPickerState.containerWidth,
                leftOffset:0,
                gap:4,
                resultCount:62,
                primaryTabsVisible:false,
                categoryTabsVisible:false,
            },
        );
        assert.ok(composerPickerState.height <= 288, composerPickerState);

        const screenshotPath = process.env.SMART_CANVAS_QA_SCREENSHOT
            || '/tmp/issue-90-prompt-generation-picker.png';
        await page.screenshot({path:screenshotPath});
        process.stdout.write(JSON.stringify({
            ok:true,
            state,
            redrawState,
            enterState,
            arrowNavigationState,
            wheelBefore,
            wheelAfter,
            boundaryWheelBefore,
            boundaryWheelAfter,
            expandedPickerState,
            composerPickerState,
            pickerState,
            themeState,
            pickerScreenshotPath,
            darkPickerScreenshotPath,
            screenshotPath,
        }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
