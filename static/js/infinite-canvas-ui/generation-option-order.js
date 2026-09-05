const RATIO_ORDER = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5',
  '21:9', '1:4', '4:1', '1:8', '8:1', '2:1', '1:2', '3:1', '1:3', '9:21',
];
const RATIO_ALIASES = {
  square: '1:1', landscape: '3:2', portrait: '2:3', landscape43: '4:3',
  portrait43: '3:4', wide: '16:9', story: '9:16', ultrawide: '21:9', ultratall: '9:21',
};

export function orderAspectRatios(values) {
  const rank = (value) => {
    if (['source', 'keep_ratio', 'adaptive', 'auto'].includes(value)) return -1;
    const index = RATIO_ORDER.indexOf(RATIO_ALIASES[value] || value);
    return index < 0 ? RATIO_ORDER.length : index;
  };
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b));
}

export function orderResolutions(values) {
  const rank = (value) => {
    const match = /^(\d+(?:\.\d+)?)(k|p)$/i.exec(value);
    return match ? Number(match[1]) * (match[2].toLowerCase() === 'k' ? 1024 : 1) : Infinity;
  };
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b));
}
