(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UiComponentDecisionStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCHEMA_VERSION = 7;
  const STORAGE_KEY = 'infinite-canvas.ui-component-library.draft.v7';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function candidatesById(manifest) {
    return new Map((manifest.candidates || []).map((candidate) => [candidate.id, candidate]));
  }

  function requiredStates(contract) {
    return [
      ...(contract.componentStates || []),
      ...(contract.interactionStates || []),
    ];
  }

  function dimensionKey(dimension) {
    return dimension.contentForm
      ? `${dimension.contentForm}.${dimension.size}`
      : dimension.size;
  }

  function targetDimensions(target) {
    const sizes = target.contract.sizes || ['default'];
    const contentForms = target.contract.contentForms?.length
      ? target.contract.contentForms
      : [null];
    return contentForms.flatMap((contentForm) => sizes.map((size) => ({
      key: dimensionKey({ contentForm, size }),
      size,
      ...(contentForm ? { contentForm } : {}),
    })));
  }

  function targetDimension(target, dimensionId) {
    return targetDimensions(target).find((dimension) => dimension.key === dimensionId) || null;
  }

  function candidateStates(candidate) {
    return new Set([
      ...(candidate.coverage?.componentStates || []),
      ...(candidate.coverage?.interactionStates || []),
    ]);
  }

  function requireVerifiedCandidate(manifest, candidateId) {
    const candidate = candidatesById(manifest).get(candidateId);
    if (!candidate) throw new Error(`未知候选：${candidateId}`);
    if (candidate.trust !== 'verified-live') {
      throw new Error(`候选 ${candidateId} 不是 verified-live，不能作为正式基准`);
    }
    return candidate;
  }

  function sourceBaseline(manifest, candidateId) {
    const candidate = requireVerifiedCandidate(manifest, candidateId);
    return {
      kind: 'source-baseline',
      candidateId: candidate.id,
      sourceHash: candidate.sourceHash,
      stateReferences: {},
    };
  }

  function setStateReference(manifest, slot, states, candidateId) {
    if (slot?.kind !== 'source-baseline') {
      throw new Error('状态补选只能添加到 source-baseline 槽位');
    }
    const candidate = requireVerifiedCandidate(manifest, candidateId);
    const available = candidateStates(candidate);
    const next = clone(slot);
    next.stateReferences ||= {};
    for (const state of states || []) {
      if (!available.has(state)) {
        throw new Error(`候选 ${candidateId} 不覆盖状态 ${state}`);
      }
      next.stateReferences[state] = {
        candidateId: candidate.id,
        sourceHash: candidate.sourceHash,
      };
    }
    return next;
  }

  function validateSourceSlot(manifest, target, dimensionId, slot) {
    const errors = [];
    const lookup = candidatesById(manifest);
    const dimension = targetDimension(target, dimensionId);
    const baseline = lookup.get(slot.candidateId);
    const covered = new Set();
    if (!baseline) {
      errors.push(`基准候选不存在：${slot.candidateId || '未填写'}`);
    } else {
      if (baseline.trust !== 'verified-live') {
        errors.push(`基准候选不是 verified-live：${baseline.id}`);
      }
      if (baseline.targetId !== target.id) {
        errors.push(`基准候选不属于目标 ${target.id}`);
      }
      if (baseline.size && baseline.size !== dimension?.size) {
        errors.push(`基准候选尺寸 ${baseline.size} 与槽位 ${dimension?.size || dimensionId} 不匹配`);
      }
      if (dimension?.contentForm && baseline.contentForm !== dimension.contentForm) {
        errors.push(`基准候选内容布局 ${baseline.contentForm || '未分类'} 与槽位 ${dimension.contentForm} 不匹配`);
      }
      if (baseline.sourceHash !== slot.sourceHash) {
        errors.push(`基准源码哈希已过期：${baseline.id}`);
      }
      for (const state of candidateStates(baseline)) covered.add(state);
    }

    for (const [state, reference] of Object.entries(slot.stateReferences || {})) {
      const candidate = lookup.get(reference?.candidateId);
      if (!candidate) {
        errors.push(`状态 ${state} 的补选候选不存在`);
        continue;
      }
      if (candidate.trust !== 'verified-live') {
        errors.push(`状态 ${state} 的补选候选不是 verified-live`);
      }
      if (candidate.targetId !== target.id) {
        errors.push(`状态 ${state} 的补选候选不属于目标 ${target.id}`);
      }
      if (candidate.size && candidate.size !== dimension?.size) {
        errors.push(`状态 ${state} 的补选候选尺寸不匹配`);
      }
      if (dimension?.contentForm && candidate.contentForm !== dimension.contentForm) {
        errors.push(`状态 ${state} 的补选候选内容布局不匹配`);
      }
      if (candidate.sourceHash !== reference.sourceHash) {
        errors.push(`状态 ${state} 的补选源码哈希已过期`);
      }
      if (!candidateStates(candidate).has(state)) {
        errors.push(`补选候选 ${candidate.id} 不覆盖状态 ${state}`);
      } else {
        covered.add(state);
      }
    }

    const missingStates = requiredStates(target.contract).filter((state) => !covered.has(state));
    if (missingStates.length) errors.push(`缺少状态：${missingStates.join('、')}`);
    return { valid: errors.length === 0, errors, missingStates };
  }

  function validateDerivedSlot(manifest, target, dimensionId, slot) {
    const errors = [];
    const dimension = targetDimension(target, dimensionId);
    const candidate = candidatesById(manifest).get(slot.basedOnCandidateId);
    if (slot.requirementStatus !== 'confirmed') errors.push('派生要求尚未确认');
    if (slot.componentType !== target.contract.componentType) errors.push('组件类型不匹配');
    if (slot.semanticTarget !== target.contract.semanticTarget) errors.push('语义目标不匹配');
    if (slot.dimension?.size !== dimension?.size) errors.push('尺寸维度不匹配');
    if ((slot.dimension?.contentForm || null) !== (dimension?.contentForm || null)) {
      errors.push('内容布局维度不匹配');
    }
    if (!candidate) errors.push('参考候选不存在');
    if (!String(slot.preserveFeatures || '').trim()) errors.push('必须填写需要保留的视觉与交互特征');
    if (!String(slot.requirements || '').trim()) errors.push('必须填写其他可验证要求');
    const supplied = new Set(slot.requiredStates || []);
    const missingStates = requiredStates(target.contract).filter((state) => !supplied.has(state));
    if (missingStates.length) errors.push(`必须补齐状态：${missingStates.join('、')}`);
    return { valid: errors.length === 0, errors, missingStates };
  }

  function validateSlot(manifest, target, dimensionId, slot) {
    if (!targetDimension(target, dimensionId)) {
      return { valid: false, errors: [`未知槽位维度：${dimensionId}`], missingStates: [] };
    }
    if (!slot || slot.kind === 'empty') {
      return { valid: false, errors: [`${dimensionId} 槽位为空`], missingStates: requiredStates(target.contract) };
    }
    if (slot.kind === 'source-baseline') {
      return validateSourceSlot(manifest, target, dimensionId, slot);
    }
    if (slot.kind === 'derived-requirement') {
      return validateDerivedSlot(manifest, target, dimensionId, slot);
    }
    return { valid: false, errors: [`未知槽位种类：${slot.kind}`], missingStates: [] };
  }

  function calculateProgress(manifest, draft) {
    let total = 0;
    let complete = 0;
    const targets = {};
    for (const [targetId, target] of Object.entries(manifest.targets || {})) {
      const targetDraft = draft.targets?.[targetId];
      const dimensions = targetDimensions(target);
      const results = {};
      for (const dimension of dimensions) {
        total += 1;
        const dimensionId = dimension.key;
        const result = validateSlot(manifest, target, dimensionId, targetDraft?.slots?.[dimensionId]);
        results[dimensionId] = result;
        if (result.valid) complete += 1;
      }
      targets[targetId] = {
        complete: dimensions.every((dimension) => results[dimension.key].valid),
        slots: results,
      };
    }
    return { total, complete, percent: total ? Math.round((complete / total) * 100) : 0, targets };
  }

  function createDraft(manifest, clock = () => new Date().toISOString()) {
    const targets = {};
    for (const [targetId, target] of Object.entries(manifest.targets || {})) {
      const slots = {};
      for (const dimension of targetDimensions(target)) {
        slots[dimension.key] = { kind: 'empty' };
      }
      targets[targetId] = {
        contract: clone(target.contract),
        status: 'draft',
        slots,
      };
    }
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      status: 'draft',
      sourceRevision: manifest.sourceRevision,
      updatedAt: clock(),
      targets,
    };
    draft.progress = calculateProgress(manifest, draft);
    return draft;
  }

  function validateImportedDocument(manifest, document) {
    if (!document || document.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('只支持 Live Catalog Schema 7 决策文件');
    }
    if (!document.targets || typeof document.targets !== 'object' || Array.isArray(document.targets)) {
      throw new Error('决策文件缺少 targets');
    }
    const knownTargets = new Set(Object.keys(manifest.targets || {}));
    for (const targetId of Object.keys(document.targets)) {
      if (!knownTargets.has(targetId)) throw new Error(`未知组件目标：${targetId}`);
    }
    for (const [targetId, target] of Object.entries(manifest.targets || {})) {
      const imported = document.targets[targetId];
      if (!imported?.slots || typeof imported.slots !== 'object' || Array.isArray(imported.slots)) {
        throw new Error(`目标 ${targetId} 缺少 slots`);
      }
      const dimensions = targetDimensions(target);
      const expected = dimensions.map((dimension) => dimension.key);
      const actual = Object.keys(imported.slots);
      for (const dimensionId of actual) {
        if (!expected.includes(dimensionId)) throw new Error(`目标 ${targetId} 包含未知槽位 ${dimensionId}`);
      }
      for (const dimensionId of expected) {
        if (!Object.hasOwn(imported.slots, dimensionId)) throw new Error(`目标 ${targetId} 缺少槽位 ${dimensionId}`);
        const slot = imported.slots[dimensionId];
        if (!['empty', 'source-baseline', 'derived-requirement'].includes(slot?.kind)) {
          throw new Error(`槽位 ${targetId}.${dimensionId} 种类无效`);
        }
        if (slot.kind === 'source-baseline') {
          const candidate = candidatesById(manifest).get(slot.candidateId);
          if (!candidate) throw new Error(`槽位 ${targetId}.${dimensionId} 引用未知候选`);
          for (const reference of Object.values(slot.stateReferences || {})) {
            if (!candidatesById(manifest).has(reference?.candidateId)) {
              throw new Error(`槽位 ${targetId}.${dimensionId} 包含未知状态补选候选`);
            }
          }
        }
        if (slot.kind === 'derived-requirement') {
          const dimension = dimensions.find((item) => item.key === dimensionId);
          if (
            slot.dimension?.size !== dimension?.size
            || (slot.dimension?.contentForm || null) !== (dimension?.contentForm || null)
          ) {
            throw new Error(`槽位 ${targetId}.${dimensionId} 的派生维度冲突`);
          }
        }
      }
    }
    return true;
  }

  function createStore({ manifest, storage, clock = () => new Date().toISOString() }) {
    let draft = createDraft(manifest, clock);
    let storageAvailable = true;
    try {
      const saved = storage?.getItem?.(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        validateImportedDocument(manifest, parsed);
        draft = parsed;
      }
    } catch (_) {
      storageAvailable = false;
    }

    function touch() {
      draft.updatedAt = clock();
      draft.status = 'draft';
      draft.progress = calculateProgress(manifest, draft);
    }

    return {
      snapshot: () => clone(draft),
      storageAvailable: () => storageAvailable,
      setSlot(targetId, dimensionId, slot) {
        if (!draft.targets?.[targetId]?.slots || !Object.hasOwn(draft.targets[targetId].slots, dimensionId)) {
          throw new Error(`未知决策槽位：${targetId}.${dimensionId}`);
        }
        draft.targets[targetId].slots[dimensionId] = clone(slot);
        touch();
        return this.snapshot();
      },
      save() {
        touch();
        try {
          storage?.setItem?.(STORAGE_KEY, JSON.stringify(draft));
          storageAvailable = true;
          return true;
        } catch (_) {
          storageAvailable = false;
          return false;
        }
      },
      importJson(raw) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          throw new Error('决策文件不是有效 JSON');
        }
        validateImportedDocument(manifest, parsed);
        draft = clone(parsed);
        return this.snapshot();
      },
      exportDraft() {
        const exported = clone(draft);
        exported.status = 'draft';
        exported.progress = calculateProgress(manifest, exported);
        return JSON.stringify(exported, null, 2);
      },
      exportFormal() {
        const progress = calculateProgress(manifest, draft);
        const errors = [];
        for (const [targetId, targetProgress] of Object.entries(progress.targets)) {
          for (const [dimensionId, result] of Object.entries(targetProgress.slots)) {
            if (!result.valid) errors.push(`${targetId}.${dimensionId}: ${result.errors.join('、')}`);
          }
        }
        if (errors.length) throw new Error(`正式导出失败：${errors.join('; ')}`);
        const exported = clone(draft);
        exported.status = 'formal';
        exported.progress = progress;
        exported.implementationItems = [];
        for (const [targetId, target] of Object.entries(exported.targets)) {
          for (const [dimensionId, slot] of Object.entries(target.slots)) {
            if (slot.kind === 'derived-requirement' && slot.requirementStatus === 'confirmed') {
              exported.implementationItems.push({ targetId, dimensionId, ...clone(slot) });
            }
          }
        }
        return JSON.stringify(exported, null, 2);
      },
    };
  }

  return {
    SCHEMA_VERSION,
    STORAGE_KEY,
    createDraft,
    sourceBaseline,
    setStateReference,
    validateSlot,
    calculateProgress,
    targetDimensions,
    validateImportedDocument,
    createStore,
  };
});
