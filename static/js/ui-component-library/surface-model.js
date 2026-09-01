(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InfiniteCanvasUiSurfaceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'infinite-canvas.ui-component-surfaces.draft.v1';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }

  function stableStringify(value) {
    return JSON.stringify(canonical(value), null, 2);
  }

  function stableHash(value) {
    const text = typeof value === 'string' ? value : stableStringify(value);
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= BigInt(text.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  function sourceEvidence(source = {}) {
    return {
      file: source.file || source.page || '',
      line: Number(source.line || 0),
      source: source.source || 'unknown',
      surface: source.surface || '',
      scenario: source.scenario || '',
      domPath: source.domPath || source.dom_path || source.selector || '',
    };
  }

  function deriveLegacyInstances(legacyManifest) {
    const instances = [];
    for (const candidate of legacyManifest?.candidates || []) {
      for (const source of candidate.sources || []) {
        const evidence = sourceEvidence(source);
        const identity = {
          candidateId: candidate.id,
          file: evidence.file,
          source: evidence.source,
          domPath: evidence.domPath,
        };
        instances.push({
          identity: stableStringify(identity),
          candidateId: candidate.id,
          label: source.display_text || candidate.label || candidate.id,
          suggestedTargetId: candidate.targetId || '',
          componentType: candidate.componentType || '',
          categoryId: candidate.categoryId || '',
          evidence,
          originalPage: evidence.file.endsWith('.html') ? `/${evidence.file}` : '',
        });
      }
    }
    instances.sort((left, right) => (
      left.identity.localeCompare(right.identity)
      || left.label.localeCompare(right.label)
    ));
    const occurrences = new Map();
    for (const instance of instances) {
      const ordinal = (occurrences.get(instance.identity) || 0) + 1;
      occurrences.set(instance.identity, ordinal);
      instance.id = `legacy.${stableHash(instance.identity)}.${ordinal}`;
      delete instance.identity;
    }
    return instances;
  }

  function createDocument(surfaceManifest, semanticSeed = null) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: surfaceManifest.surfaces?.target?.initialLifecycleStatus || 'draft',
      revision: 0,
      mappingRevision: 0,
      fingerprints: clone(surfaceManifest.fingerprints || {}),
      classificationBaselineRevision: semanticSeed?.revision || null,
      classificationReviewStatus: semanticSeed?.reviewStatus || null,
      confirmations: {},
      implementation: null,
      mappings: clone(semanticSeed?.mappings || {}),
    };
  }

  function outcomes(surfaceManifest) {
    return new Map(
      (surfaceManifest.surfaces?.migration?.outcomes || []).map((item) => [item.id, item]),
    );
  }

  function validateMapping(surfaceManifest, mapping) {
    const outcome = outcomes(surfaceManifest).get(mapping?.outcome);
    if (!outcome) throw new Error(`未知迁移结果：${mapping?.outcome || '未填写'}`);
    const reference = String(mapping?.reference || '').trim();
    if (outcome.referenceRequired && !reference) {
      throw new Error(`迁移结果 ${outcome.id} 必须填写目标引用`);
    }
    if (
      outcome.id === 'target-component'
      && !(surfaceManifest.surfaces?.migration?.targetComponentIds || []).includes(reference)
    ) {
      throw new Error(`未知 Target 组件：${reference || '未填写'}`);
    }
    return {
      outcome: outcome.id,
      ...(reference ? { reference } : {}),
    };
  }

  function validateDocument(surfaceManifest, instances, document) {
    if (!document || document.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('只支持 Component Surfaces Schema 1');
    }
    if (!(surfaceManifest.lifecycle?.states || []).includes(document.status)) {
      throw new Error(`未知合同状态：${document.status}`);
    }
    if (!document.mappings || typeof document.mappings !== 'object' || Array.isArray(document.mappings)) {
      throw new Error('Migration Map 必须是对象');
    }
    const instanceIds = new Set(instances.map((instance) => instance.id));
    for (const [instanceId, mapping] of Object.entries(document.mappings)) {
      if (!instanceIds.has(instanceId)) throw new Error(`未知 Legacy 实例：${instanceId}`);
      validateMapping(surfaceManifest, mapping);
    }
    const states = surfaceManifest.lifecycle?.states || [];
    const statusIndex = states.indexOf(document.status);
    const reached = (status) => {
      const index = states.indexOf(status);
      return index >= 0 && statusIndex >= index;
    };
    const requireConfirmation = (status, label) => {
      const confirmation = document.confirmations?.[status];
      if (
        !confirmation
        || !String(confirmation.reviewer || '').trim()
        || !String(confirmation.note || '').trim()
        || !Number.isFinite(Number(confirmation.mappingRevision))
        || !confirmation.fingerprints
        || typeof confirmation.fingerprints !== 'object'
      ) {
        throw new Error(`缺少${label}人工确认记录`);
      }
    };
    if (reached('contract_confirmed')) {
      requireConfirmation('contract_confirmed', '合同');
    }
    if (
      reached('implemented')
      && !String(document.implementation?.evidence || '').trim()
    ) {
      throw new Error('缺少 implemented 实现证据');
    }
    if (reached('live_confirmed')) {
      requireConfirmation('live_confirmed', '真实运行');
    }
    if (reached('migration_ready')) {
      const summary = migrationSummary(surfaceManifest, instances, document);
      if (summary.unresolved) {
        throw new Error(`仍有 ${summary.unresolved} 个 Legacy 实例未映射`);
      }
    }
    return true;
  }

  function migrationSummary(surfaceManifest, instances, document) {
    const result = Object.fromEntries([...outcomes(surfaceManifest).keys()].map((id) => [id, 0]));
    for (const mapping of Object.values(document.mappings || {})) {
      if (Object.hasOwn(result, mapping.outcome)) result[mapping.outcome] += 1;
    }
    const resolved = Object.keys(document.mappings || {}).length;
    return {
      total: instances.length,
      resolved,
      unresolved: instances.length - resolved,
      outcomes: result,
    };
  }

  function reverseMappings(document) {
    const groups = {};
    for (const [instanceId, mapping] of Object.entries(document.mappings || {}).sort()) {
      const key = `${mapping.outcome}:${mapping.reference || ''}`;
      groups[key] ||= [];
      groups[key].push(instanceId);
    }
    return groups;
  }

  function compareFingerprints(expected, current, keys, reasons) {
    const labels = {
      legacy: 'Legacy 清单',
      contract: 'Target 合同',
      implementation: '实现',
      semanticBaseline: '语义分类基线',
    };
    for (const key of keys) {
      if (expected?.[key] !== current?.[key]) reasons.push(`${labels[key]}依赖已变化`);
    }
  }

  function assess(surfaceManifest, document) {
    const reasons = [];
    const states = surfaceManifest.lifecycle?.states || [];
    const statusIndex = states.indexOf(document.status);
    const contractIndex = states.indexOf('contract_confirmed');
    const liveIndex = states.indexOf('live_confirmed');
    const contractConfirmation = document.confirmations?.contract_confirmed;
    const liveConfirmation = document.confirmations?.live_confirmed;

    if (statusIndex >= contractIndex && contractIndex >= 0) {
      if (!contractConfirmation) reasons.push('缺少合同人工确认记录');
      else {
        compareFingerprints(
          contractConfirmation.fingerprints,
          surfaceManifest.fingerprints,
          ['legacy', 'contract', 'semanticBaseline'],
          reasons,
        );
        if (contractConfirmation.mappingRevision !== document.mappingRevision) {
          reasons.push('Migration Map 在合同确认后发生变化');
        }
      }
    }
    if (statusIndex >= liveIndex && liveIndex >= 0) {
      if (!liveConfirmation) reasons.push('缺少真实运行人工确认记录');
      else {
        compareFingerprints(
          liveConfirmation.fingerprints,
          surfaceManifest.fingerprints,
          ['legacy', 'contract', 'implementation', 'semanticBaseline'],
          reasons,
        );
        if (liveConfirmation.mappingRevision !== document.mappingRevision) {
          reasons.push('Migration Map 在真实运行确认后发生变化');
        }
      }
    }
    return { stale: reasons.length > 0, reasons };
  }

  function requireHumanEvidence(evidence) {
    if (
      evidence?.human !== true
      || !String(evidence?.reviewer || '').trim()
      || !String(evidence?.note || '').trim()
    ) {
      throw new Error('该阶段需要带 reviewer 与 note 的人工确认');
    }
  }

  function semanticSeed(surfaceManifest, semanticBaseline) {
    if (!semanticBaseline) return null;
    if (semanticBaseline.schemaVersion !== 1) {
      throw new Error('只支持 Semantic Baseline Schema 1');
    }
    if (Number(semanticBaseline.coverage?.unclassifiedInstanceCount || 0) !== 0) {
      throw new Error('语义基线仍有未分类实例');
    }
    const decisions = semanticBaseline.decisions || {};
    const pageMigrations = new Map(
      (semanticBaseline.pageMigrations || []).map((item) => [item.id, item]),
    );
    const seen = new Set();
    const mappings = {};
    const instances = (semanticBaseline.instances || []).map((item) => {
      if (!item.id || seen.has(item.id)) {
        throw new Error(`语义基线包含重复或空实例 ID：${item.id || '空'}`);
      }
      seen.add(item.id);
      const decision = decisions[item.decisionId];
      if (!decision) throw new Error(`语义基线缺少 Decision：${item.decisionId || '空'}`);
      const classifiedMapping = validateMapping(surfaceManifest, decision);
      const mapping = item.migrationStatus === 'migrated'
        ? validateMapping(surfaceManifest, {
            outcome: 'target-component',
            reference: item.migratedTo,
          })
        : classifiedMapping;
      mappings[item.id] = mapping;
      const evidence = sourceEvidence(item.evidence || {});
      return {
        id: item.id,
        candidateId: item.candidateId || '',
        label: item.label || item.candidateId || item.id,
        suggestedTargetId: item.suggestedTargetId || '',
        componentType: item.componentType || '',
        categoryId: item.categoryId || '',
        migrationStatus: item.migrationStatus || 'active',
        migrationId: item.migrationId || '',
        visualAcceptance: pageMigrations.get(item.migrationId)?.visualAcceptance || '',
        migratedTo: item.migratedTo || '',
        replacement: item.replacement || '',
        evidence,
        originalPage: evidence.file.endsWith('.html') ? `/${evidence.file}` : '',
        classification: {
          decisionId: item.decisionId,
          layer: decision.layer || '',
          rationale: decision.rationale || '',
          outcome: classifiedMapping.outcome,
          reference: classifiedMapping.reference || '',
        },
      };
    });
    const expectedCount = Number(semanticBaseline.coverage?.classifiedInstanceCount || 0);
    if (instances.length !== expectedCount) {
      throw new Error(`语义基线覆盖数不一致：${instances.length}/${expectedCount}`);
    }
    return {
      revision: semanticBaseline.baselineRevision || semanticBaseline.baselineVersion || '',
      reviewStatus: semanticBaseline.review?.status || '',
      instances,
      mappings,
    };
  }

  function createStore({ surfaceManifest, legacyManifest, semanticBaseline, storage }) {
    const seed = semanticSeed(surfaceManifest, semanticBaseline);
    const instances = seed?.instances || deriveLegacyInstances(legacyManifest);
    let document = createDocument(surfaceManifest, seed);
    let storageAvailable = true;
    try {
      const raw = storage?.getItem?.(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!seed || saved.classificationBaselineRevision === seed.revision) {
          validateDocument(surfaceManifest, instances, saved);
          document = clone(saved);
        }
      }
    } catch (_) {
      storageAvailable = false;
    }

    function update(mutator) {
      const next = clone(document);
      mutator(next);
      next.revision = Number(next.revision || 0) + 1;
      validateDocument(surfaceManifest, instances, next);
      document = next;
      return clone(document);
    }

    return {
      instances: () => clone(instances),
      snapshot: () => clone(document),
      storageAvailable: () => storageAvailable,
      assessment: () => assess(surfaceManifest, document),
      migrationSummary: () => migrationSummary(surfaceManifest, instances, document),
      reverseMappings: () => clone(reverseMappings(document)),
      setMapping(instanceId, mapping) {
        if (!instances.some((instance) => instance.id === instanceId)) {
          throw new Error(`未知 Legacy 实例：${instanceId}`);
        }
        const normalized = validateMapping(surfaceManifest, mapping);
        return update((next) => {
          next.mappings[instanceId] = normalized;
          next.mappingRevision = Number(next.mappingRevision || 0) + 1;
        });
      },
      clearMapping(instanceId) {
        if (!instances.some((instance) => instance.id === instanceId)) {
          throw new Error(`未知 Legacy 实例：${instanceId}`);
        }
        return update((next) => {
          delete next.mappings[instanceId];
          next.mappingRevision = Number(next.mappingRevision || 0) + 1;
        });
      },
      transition(nextStatus, evidence = {}) {
        const transition = (surfaceManifest.lifecycle?.transitions || []).find(
          ([from, to]) => from === document.status && to === nextStatus,
        );
        if (!transition) throw new Error(`非法状态跳转：${document.status} → ${nextStatus}`);
        const currentAssessment = assess(surfaceManifest, document);
        if (currentAssessment.stale) {
          throw new Error(`当前确认已 stale：${currentAssessment.reasons.join('；')}`);
        }
        if ((surfaceManifest.lifecycle?.humanGates || []).includes(nextStatus)) {
          requireHumanEvidence(evidence);
        }
        if (nextStatus === 'implemented' && !String(evidence?.evidence || '').trim()) {
          throw new Error('implemented 阶段必须记录实现证据');
        }
        if (nextStatus === 'migration_ready') {
          const summary = migrationSummary(surfaceManifest, instances, document);
          if (summary.unresolved) {
            throw new Error(`仍有 ${summary.unresolved} 个 Legacy 实例未映射`);
          }
        }
        return update((next) => {
          next.status = nextStatus;
          if (nextStatus === 'contract_confirmed' || nextStatus === 'live_confirmed') {
            next.confirmations[nextStatus] = {
              reviewer: String(evidence.reviewer).trim(),
              note: String(evidence.note).trim(),
              mappingRevision: next.mappingRevision,
              fingerprints: clone(surfaceManifest.fingerprints || {}),
            };
          }
          if (nextStatus === 'implemented') {
            next.implementation = {
              evidence: String(evidence.evidence).trim(),
              fingerprint: surfaceManifest.fingerprints?.implementation || '',
            };
          }
        });
      },
      save() {
        try {
          storage?.setItem?.(STORAGE_KEY, stableStringify(document));
          storageAvailable = true;
          return true;
        } catch (_) {
          storageAvailable = false;
          return false;
        }
      },
      exportJson() {
        return `${stableStringify(document)}\n`;
      },
      importJson(raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          throw new Error('组件界面决策文件不是有效 JSON');
        }
        validateDocument(surfaceManifest, instances, parsed);
        document = clone(parsed);
        return clone(document);
      },
    };
  }

  return {
    SCHEMA_VERSION,
    STORAGE_KEY,
    createStore,
  };
});
