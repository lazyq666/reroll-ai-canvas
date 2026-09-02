(function(root,factory){
    const module = factory();
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.nodeReviewFixture = module;
})(typeof window !== 'undefined' ? window : globalThis,function(){
    const clone = value => JSON.parse(JSON.stringify(value));

    const fixture = Object.freeze({
        config:{
            apiProviders:[
                {
                    id:'component-review',
                    name:'Component Review',
                    enabled:true,
                    chat_models:['review-text-1','review-text-2'],
                    image_models:['review-image-1'],
                    video_models:['review-video-1'],
                    model_names:{
                        'review-text-1':'Review Text 1',
                        'review-text-2':'Review Text 2',
                        'review-image-1':'Review Image 1',
                        'review-video-1':'Review Video 1'
                    }
                }
            ],
            availableModels:{
                text:[
                    {id:'component-review|review-text-1',provider_id:'component-review',provider_name:'Component Review',model:'review-text-1',name:'Review Text 1'},
                    {id:'component-review|review-text-2',provider_id:'component-review',provider_name:'Component Review',model:'review-text-2',name:'Review Text 2'}
                ],
                image:[
                    {id:'component-review|review-image-1',provider_id:'component-review',provider_name:'Component Review',model:'review-image-1',name:'Review Image 1'}
                ],
                video:[
                    {id:'component-review|review-video-1',provider_id:'component-review',provider_name:'Component Review',model:'review-video-1',name:'Review Video 1'}
                ]
            }
        },
        canvas:{
            id:'component-review-nodes',
            title:'Nodes · Production Review',
            project:'component-review',
            revision:1,
            settings:{
                engine:'api',
                apiKind:'image',
                provider_id:'component-review',
                model:'review-image-1'
            },
            connections:[
                {from:'review-prompt-filled',to:'review-prompt-generation-configured',kind:'flow'},
                {from:'review-image-ready',to:'review-prompt-generation-upstream-image',kind:'input'}
            ],
            logs:[],
            nodes:[
                {id:'review-label-image',type:'smart-text',title:'Image Node label',text:'图像/媒体节点 / Image Node\nImage · Empty · Video · Audio',textSize:'small',x:-240,y:225,w:240,h:92},
                {id:'review-image-ready',type:'smart-image',title:'Image · Ready',x:340,y:80,w:260,h:168,images:[{url:'/static/images/test/fixture.svg',name:'fixture.svg',kind:'image',natural_w:1076,natural_h:704}]},
                {id:'review-image-empty',type:'smart-image',title:'Image · Empty',x:720,y:80,w:260,h:178,images:[]},
                {id:'review-image-video',type:'smart-image',title:'Video · Playing',x:340,y:300,w:300,h:190,images:[{url:'/static/images/test/fixture.mp4',name:'fixture.mp4',kind:'video',natural_w:736,natural_h:414,_inlineVideoActive:true}]},
                {id:'review-image-audio',type:'smart-image',title:'Audio · Ready',x:720,y:300,w:300,h:190,images:[{url:'/static/images/test/fixture.mp4',name:'fixture.mp4 · AAC audio',kind:'audio'}]},

                {id:'review-label-generation',type:'smart-text',title:'Generation Node label',text:'生成节点 / Generation Node\nImage Generation · Video Generation · Generating · Result · Failed',textSize:'small',x:-240,y:755,w:300,h:92},
                {id:'review-generation-image',type:'smart-image',title:'Generation · Image',referenceGenerationKind:'image',generationOutputNode:true,runSettings:{engine:'api',apiKind:'image',provider_id:'component-review',model:'review-image-1',count:1},x:300,y:680,w:300,h:220,images:[]},
                {id:'review-generation-video',type:'smart-image',title:'Generation · Video',referenceGenerationKind:'video',generationOutputNode:true,runSettings:{engine:'api',apiKind:'video',provider_id:'component-review',model:'review-video-1',count:1},x:630,y:680,w:300,h:220,images:[]},
                {id:'review-generation-pending',type:'smart-image',title:'Generation · Generating',referenceGenerationKind:'image',generationOutputNode:true,runSettings:{engine:'api',apiKind:'image',provider_id:'component-review',model:'review-image-1',count:1},pending:1,runStartedAt:Date.now()-15000,x:960,y:680,w:300,h:220,images:[]},
                {id:'review-generation-result',type:'smart-image',title:'Generation · Result',referenceGenerationKind:'image',generationOutputNode:true,runSettings:{engine:'api',apiKind:'image',provider_id:'component-review',model:'review-image-1',count:1},x:1290,y:680,w:260,h:168,images:[{url:'/static/images/test/fixture.svg',name:'fixture.svg',kind:'image',natural_w:1076,natural_h:704}]},
                {id:'review-generation-failed',type:'smart-image',title:'Generation · Failed',referenceGenerationKind:'image',generationOutputNode:true,generationRunFeedback:{successfulCount:0,failedCount:1,reasonCategories:['unsupported_size']},x:1580,y:680,w:300,h:220,images:[]},

                {id:'review-label-prompt',type:'smart-text',title:'Prompt Node label',text:'提示词节点 / Prompt Node\nFilled · Empty',textSize:'small',x:-240,y:1085,w:220,h:76},
                {id:'review-prompt-filled',type:'smart-prompt',title:'Prompt · Filled',text:'你是一名视觉内容分析师与图像生成提示词编辑。把输入参考图提炼成一段可直接交给图像生成模型的中文提示词，准确还原主体内容、角色设定、构图关系、动作关系与场景信息。只提炼画了什么和各元素如何组织，不描述绘画风格、渲染方式、材质表现或成像工艺。识别画面用途、主体数量、角色身份、构图骨架、空间层级、动作、视线、道具、服装、环境、遮挡和关键接触关系。',x:340,y:1020,w:300,h:190,images:[]},
                {id:'review-prompt-empty',type:'smart-prompt',title:'Prompt · Empty',text:'',x:720,y:1020,w:300,h:190,images:[]},

                {id:'review-label-prompt-generation',type:'smart-text',title:'Prompt Generation Node label',text:'提示词生成节点 / Prompt Generation Node\nConfigured · Upstream Image · Generating · Failed',textSize:'small',x:-240,y:1415,w:280,h:92},
                {id:'review-prompt-generation-configured',type:'smart-prompt',title:'Prompt Generation · Configured',llmEnabled:true,llmInstruction:'根据全部上游输入生成结构化中文提示词。准确整理主体数量、身份特征、构图骨架、空间层级、动作、视线、道具、服装、环境元素、前后遮挡与关键接触关系；保留可执行的画面信息，不输出推理过程、分析报告、绘画风格、渲染方式、材质、笔触或成像工艺。继续检查主体之间的距离、朝向、手势、视线交汇、接触点和前后遮挡，明确镜头内每个元素所在位置与比例，避免省略决定画面叙事的关键道具和环境线索。逐项复核人物、动物、建筑、交通工具和自然景观的数量、相对尺寸与所在方位；描述前景、中景、背景的层级以及主体与道具的接触关系；保留镜头视角、画面方向、关键动作和叙事结果。不要输出标题、解释、步骤、Markdown 或分析报告，只输出一段连续、完整、可以直接执行的中文提示词。最终结果应当可以直接交给图片或视频生成模型使用。',llmProvider:'component-review',llmModel:'review-text-1',x:340,y:1330,w:330,h:220,images:[]},
                {id:'review-prompt-generation-upstream-image',type:'smart-prompt',title:'Prompt Generation · Upstream Image',llmEnabled:true,llmInstruction:'根据上游图片生成提示词',llmProvider:'component-review',llmModel:'review-text-1',x:720,y:1330,w:330,h:220,images:[]},
                {id:'review-prompt-generation-pending',type:'smart-prompt',title:'Prompt Generation · Generating',llmEnabled:true,textGenerationPending:true,pending:1,llmInstruction:'正在生成提示词',llmProvider:'component-review',llmModel:'review-text-2',x:1100,y:1330,w:330,h:220,images:[]},
                {id:'review-prompt-generation-failed',type:'smart-prompt',title:'Prompt Generation · Failed',llmEnabled:true,generationFailed:true,generationFailureReason:'生成失败原因',llmProvider:'component-review',llmModel:'review-text-2',x:1480,y:1330,w:330,h:220,images:[]},

                {id:'review-label-splitter',type:'smart-text',title:'Splitter Node label',text:'拆分节点 / Splitter Node\nSemicolon · Vertical bar',textSize:'small',x:-240,y:1745,w:220,h:76},
                {id:'review-splitter-semicolon',type:'smart-splitter',title:'Splitter · Semicolon',separator:';',x:340,y:1650,w:300,h:220,images:[]},
                {id:'review-splitter-bar',type:'smart-splitter',title:'Splitter · Vertical bar',separator:'|',x:720,y:1650,w:300,h:220,images:[]},

                {id:'review-label-loop',type:'smart-text',title:'Batch Run Node label',text:'批量运行 / Batch Run Node\n依次执行 · 并发执行',textSize:'small',x:-240,y:2075,w:250,h:76},
                {id:'review-loop-serial',type:'smart-loop',title:'Batch Run · Sequential',mode:'serial',count:4,x:340,y:1970,w:360,h:406,images:[]},
                {id:'review-loop-parallel',type:'smart-loop',title:'Batch Run · Concurrent',mode:'parallel',count:8,x:760,y:1970,w:360,h:406,images:[]},

                {id:'review-label-group',type:'smart-text',title:'Smart Group Node label',text:'编组 / Smart Group\nEmpty · Media',textSize:'small',x:-240,y:2505,w:220,h:76},
                {id:'review-group-empty',type:'smart-group',title:'Smart Group · Empty',x:340,y:2400,w:300,h:220,images:[],items:[]},
                {id:'review-group-media',type:'smart-group',title:'Smart Group · Media',x:720,y:2400,w:300,h:220,images:[{url:'/static/images/brand/logo.png',name:'group-image.png',kind:'image',natural_w:512,natural_h:330}],items:[]},

                {id:'review-label-frame',type:'smart-text',title:'Frame label',text:'分区 / Frame\nViolet · Blue',textSize:'small',x:-240,y:2835,w:220,h:76},
                {id:'review-frame-violet',type:'smart-frame',title:'Frame · Violet',x:340,y:2730,w:300,h:220,items:[],frameColor:'violet'},
                {id:'review-frame-blue',type:'smart-frame',title:'Frame · Blue',x:720,y:2730,w:300,h:220,items:[],frameColor:'blue'},

                {id:'review-label-text',type:'smart-text',title:'Text Annotation Node label',text:'文本标注 / Text Annotation Node\nSmall · Large',textSize:'small',x:-240,y:3165,w:240,h:76},
                {id:'review-text-small',type:'smart-text',title:'Text Annotation · Small',text:'高光区域需要更柔和',textSize:'small',x:340,y:3070,w:300,h:120},
                {id:'review-text-large',type:'smart-text',title:'Text Annotation · Large',text:'保持主体轮廓',textSize:'large',x:720,y:3070,w:300,h:140},

                {id:'review-label-brush',type:'smart-text',title:'Brush Stroke Node label',text:'画笔标注 / Brush Stroke Node\nThin · Thick',textSize:'small',x:-240,y:3495,w:240,h:76},
                {id:'review-brush-thin',type:'smart-brush',title:'Brush Stroke · Thin',color:'#111827',brushSize:3,points:[[10,78],[68,24],[142,30],[248,76]],x:340,y:3410,w:300,h:130},
                {id:'review-brush-thick',type:'smart-brush',title:'Brush Stroke · Thick',color:'#f97316',brushSize:12,points:[[10,78],[68,24],[142,30],[248,76]],x:720,y:3410,w:300,h:130}
            ]
        }
    });

    return Object.freeze({
        create(){
            return clone(fixture);
        }
    });
});
