/* Unified Smart Canvas Model Capability Catalog */
const smartModelCapabilityCache = new Map();

function smartModelCapabilityContext(context={}){
    return {
        protocol:String(context?.protocol || '').trim().toLowerCase(),
        base_url:String(context?.base_url || context?.baseUrl || '').trim()
    };
}
function smartModelCapabilityKey(providerId='', modelId='', operation='', context={}){
    const route = smartModelCapabilityContext(context);
    return [providerId,modelId,operation,route.protocol,route.base_url]
        .map(value => String(value || '').trim())
        .join('\u001f');
}
function smartModelCapabilityFallback(providerId='', modelId='', operation=''){
    return {
        provider_id:String(providerId || '').trim(),
        model_id:String(modelId || '').trim(),
        operation:String(operation || '').trim(),
        capability_schema_version:1,
        catalog_revision:'',
        support_state:'unknown',
        source:'fallback',
        source_url:null,
        confirmed_at:null,
        fetched_at:null,
        expires_at:null,
        inputs:{},
        input_rules:{},
        output:{},
        parameters:{},
        media_contract:{}
    };
}
function smartModelCapabilityClean(value, providerId='', modelId='', operation=''){
    const fallback = smartModelCapabilityFallback(providerId, modelId, operation);
    if(!value || typeof value !== 'object') return fallback;
    const states = new Set(['supported','unknown']);
    const supportState = states.has(value.support_state) ? value.support_state : 'unknown';
    return {
        ...fallback,
        ...value,
        provider_id:String(value.provider_id || providerId || '').trim(),
        model_id:String(value.model_id || modelId || '').trim(),
        operation:String(value.operation || operation || '').trim(),
        capability_schema_version:Number(value.capability_schema_version) || 1,
        catalog_revision:String(value.catalog_revision || ''),
        support_state:supportState,
        inputs:value.inputs && typeof value.inputs === 'object' ? value.inputs : {},
        input_rules:value.input_rules && typeof value.input_rules === 'object' ? value.input_rules : {},
        output:value.output && typeof value.output === 'object' ? value.output : {},
        parameters:value.parameters && typeof value.parameters === 'object' ? value.parameters : {},
        media_contract:value.media_contract && typeof value.media_contract === 'object' ? value.media_contract : {}
    };
}
async function smartModelCapabilityLoad(providerId='', modelId='', operation='', context={}){
    const route = smartModelCapabilityContext(context);
    const key = smartModelCapabilityKey(providerId, modelId, operation, route);
    if(smartModelCapabilityCache.has(key)) return smartModelCapabilityCache.get(key);
    const query = new URLSearchParams({
        provider_id:String(providerId || ''),
        model:String(modelId || ''),
        operation:String(operation || ''),
        protocol:route.protocol,
        base_url:route.base_url
    });
    const value = await fetch(`/api/model-capabilities?${query}`).then(async response => {
        if(!response.ok) throw new Error(await response.text());
        return response.json();
    }).catch(() => smartModelCapabilityFallback(providerId, modelId, operation));
    const capability = smartModelCapabilityClean(value, providerId, modelId, operation);
    smartModelCapabilityCache.set(key, capability);
    return capability;
}
function smartModelCapabilityCurrent(providerId='', modelId='', operation='', context={}){
    return smartModelCapabilityCache.get(smartModelCapabilityKey(providerId, modelId, operation, context))
        || smartModelCapabilityFallback(providerId, modelId, operation);
}
function smartModelCapabilityOutputCountMaximum(capability={}, fallback=4){
    const contract = capability?.model_capability || capability || {};
    const maximum = Number(contract?.output?.count?.maximum);
    return Number.isFinite(maximum) && maximum >= 1
        ? Math.floor(maximum)
        : Math.max(1, Math.floor(Number(fallback) || 1));
}
function smartModelCapabilityValidate(capability={}, {inputs={},inputRoles={},parameters={},catalogRevision=''}={}){
    const errors = [];
    if(!catalogRevision || !capability.catalog_revision || catalogRevision !== capability.catalog_revision){
        return {valid:false,errors:[{
            code:'catalog_changed',
            field:'catalog_revision',
            expected:capability.catalog_revision || '',
            actual:catalogRevision || ''
        }]};
    }
    const normalizedCounts = {};
    Object.entries(inputs || {}).forEach(([kind,rawCount]) => {
        const count = Number(rawCount);
        if(!Number.isInteger(count) || count < 0){
            errors.push({code:'input_invalid',field:kind,actual:rawCount});
            return;
        }
        normalizedCounts[kind] = count;
        const contract = capability.inputs?.[kind];
        const resolvedContract = contract || {};
        if(Number.isFinite(Number(resolvedContract.minimum)) && count < Number(resolvedContract.minimum)){
            errors.push({code:'input_minimum',field:kind,minimum:Number(resolvedContract.minimum),actual:count});
        }
        if(resolvedContract.maximum !== null && resolvedContract.maximum !== undefined && Number.isFinite(Number(resolvedContract.maximum)) && count > Number(resolvedContract.maximum)){
            errors.push({code:'input_maximum',field:kind,maximum:Number(resolvedContract.maximum),actual:count});
        }
    });
    const inputRules = capability.input_rules && typeof capability.input_rules === 'object'
        ? capability.input_rules
        : {};
    (inputRules.totals || []).forEach(rule => {
        if(!rule || typeof rule !== 'object') return;
        const actual = (rule.inputs || []).reduce(
            (total, kind) => total + Number(normalizedCounts[String(kind || '')] || 0),
            0
        );
        if(rule.active_when_any_present && actual === 0) return;
        const field = String(rule.id || 'input_total');
        if(Number.isFinite(Number(rule.minimum)) && actual < Number(rule.minimum)){
            errors.push({code:'input_total_minimum',field,minimum:Number(rule.minimum),actual});
        }
        if(rule.maximum !== null && rule.maximum !== undefined && Number.isFinite(Number(rule.maximum)) && actual > Number(rule.maximum)){
            errors.push({code:'input_total_maximum',field,maximum:Number(rule.maximum),actual});
        }
    });
    (inputRules.requirements || []).forEach(rule => {
        if(!rule || typeof rule !== 'object') return;
        const condition = rule.when && typeof rule.when === 'object' ? rule.when : {};
        const conditionCount = Number(normalizedCounts[String(condition.input || '')] || 0);
        const conditionMinimum = Number(condition.minimum ?? 1);
        if(conditionCount < conditionMinimum) return;
        const actual = (rule.any_of || []).reduce(
            (total, kind) => total + Number(normalizedCounts[String(kind || '')] || 0),
            0
        );
        const minimum = Number(rule.minimum ?? 1);
        if(actual < minimum){
            errors.push({code:'input_combination',field:String(rule.id || 'input_combination'),minimum,actual});
        }
    });
    const rolesByInput = inputRoles && typeof inputRoles === 'object' ? inputRoles : {};
    (inputRules.role_groups || []).forEach(rule => {
        if(!rule || typeof rule !== 'object') return;
        const kind = String(rule.input || '');
        const rawRoles = Array.isArray(rolesByInput[kind]) ? rolesByInput[kind] : [];
        const actualRoles = rawRoles.map(role => String(role || '').trim());
        if(!actualRoles.some(Boolean)) return;
        const expectedRoles = (rule.roles || []).map(role => String(role || '').trim());
        const orderedRoles = actualRoles.filter(Boolean);
        const minimum = Number(rule.minimum ?? 0);
        const maximum = Number(rule.maximum ?? expectedRoles.length);
        const expectedPrefix = expectedRoles.slice(0, orderedRoles.length);
        if(
            orderedRoles.length < minimum
            || orderedRoles.length > maximum
            || orderedRoles.some((role, index) => role !== expectedPrefix[index])
        ){
            errors.push({code:'input_role',field:kind,allowed:expectedRoles,actual:orderedRoles});
        }
        const exclusiveInputs = (rule.exclusive_inputs || []).map(value => String(value || ''));
        const exclusiveCount = exclusiveInputs.reduce(
            (total, value) => total + Number(normalizedCounts[value] || 0),
            0
        );
        if(exclusiveCount){
            errors.push({code:'input_combination',field:String(rule.id || kind),actual:exclusiveCount});
        }
    });
    Object.entries(parameters || {}).forEach(([key,value]) => {
        const contract = capability.parameters?.[key];
        if(!contract){
            errors.push({code:'parameter_unknown',field:key,actual:value});
            return;
        }
        const expectedType = contract.type;
        const typeMatches = expectedType === 'boolean'
            ? typeof value === 'boolean'
            : expectedType === 'number'
                ? typeof value === 'number' && Number.isFinite(value)
                : expectedType === 'integer'
                    ? Number.isInteger(value)
                    : expectedType === 'string'
                        ? typeof value === 'string'
                        : expectedType === 'array'
                            ? Array.isArray(value)
                            : true;
        if(!typeMatches){
            errors.push({code:'parameter_type',field:key,expected:expectedType,actual:value});
            return;
        }
        if(Array.isArray(contract.values) && contract.values.length && !contract.values.includes(value)){
            errors.push({code:'parameter_value',field:key,allowed:contract.values,actual:value});
            return;
        }
        const measured = Array.isArray(value) || typeof value === 'string' ? value.length : Number(value);
        if(contract.minimum !== null && contract.minimum !== undefined && Number.isFinite(measured) && measured < Number(contract.minimum)){
            errors.push({code:'parameter_minimum',field:key,minimum:Number(contract.minimum),actual:measured});
        }
        if(contract.maximum !== null && contract.maximum !== undefined && Number.isFinite(measured) && measured > Number(contract.maximum)){
            errors.push({code:'parameter_maximum',field:key,maximum:Number(contract.maximum),actual:measured});
        }
    });
    return {valid:!errors.length,errors,catalog_revision:capability.catalog_revision || ''};
}
function smartModelCapabilityErrorMessage(error={}, fallback=''){
    const translate = typeof tr === 'function' ? tr : key => key;
    const format = typeof trf === 'function' ? trf : (key,values) => `${key} ${JSON.stringify(values || {})}`;
    const field = translate(`smart.capabilityField.${String(error.field || 'unknown')}`);
    const values = {field,actual:error.actual ?? '—',minimum:error.minimum ?? '—',maximum:error.maximum ?? '—'};
    const keys = {
        catalog_changed:'smart.capabilityCatalogChanged',
        input_invalid:'smart.capabilityInputInvalid',
        input_minimum:'smart.capabilityInputMinimum',
        input_maximum:'smart.capabilityInputMaximum',
        input_total_minimum:'smart.capabilityInputTotalMinimum',
        input_total_maximum:'smart.capabilityInputTotalMaximum',
        input_combination:'smart.capabilityInputCombination',
        input_role:'smart.capabilityInputRole',
        input_count:'smart.capabilityInputCount',
        parameter_unknown:'smart.capabilityParameterUnknown',
        parameter_type:'smart.capabilityParameterType',
        parameter_value:'smart.capabilityParameterValue',
        parameter_minimum:'smart.capabilityParameterMinimum',
        parameter_maximum:'smart.capabilityParameterMaximum'
    };
    const key = keys[error.code];
    return key ? format(key, values) : (fallback || translate('smart.capabilityInvalid'));
}
function smartModelCapabilityValidationMessage(validation={}, fallback=''){
    return smartModelCapabilityErrorMessage(validation?.errors?.[0] || validation || {}, fallback);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.modelCapabilities = Object.freeze({
    clean:smartModelCapabilityClean,
    fallback:smartModelCapabilityFallback,
    current:smartModelCapabilityCurrent,
    outputCountMaximum:smartModelCapabilityOutputCountMaximum,
    load:smartModelCapabilityLoad,
    validate:smartModelCapabilityValidate,
    errorMessage:smartModelCapabilityErrorMessage,
    validationMessage:smartModelCapabilityValidationMessage
});
