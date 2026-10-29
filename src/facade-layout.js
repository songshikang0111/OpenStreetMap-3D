// Design grammars are deterministic illustrations, not observed window records.
// A single layout drives both the shader's pane mask and nearby solid frames.
const grammars = {
  curtain: [
    { name: 'continuous-grid', bay: 2.4, width: .90, height: .86, split: 0, group: 3 },
    { name: 'paired-mullions', bay: 3.0, width: .91, height: .84, split: 1, group: 3 },
    { name: 'spandrel-grid', bay: 2.7, width: .88, height: .70, split: 2, group: 4 },
  ],
  residential: [
    { name: 'punched-windows', bay: 3.4, width: .60, height: .62, split: 0, group: 3 },
    { name: 'paired-casements', bay: 3.8, width: .68, height: .64, split: 1, group: 3 },
    { name: 'transom-windows', bay: 3.5, width: .62, height: .70, split: 2, group: 4 },
  ],
  ribbon: [
    { name: 'horizontal-ribbon', bay: 3.9, width: .93, height: .52, split: 0, group: 4 },
    { name: 'paired-ribbon', bay: 4.2, width: .94, height: .56, split: 1, group: 4 },
    { name: 'deep-spandrel', bay: 3.8, width: .91, height: .46, split: 2, group: 3 },
  ],
  lowrise: [
    { name: 'small-punched', bay: 3.6, width: .54, height: .60, split: 0, group: 3 },
    { name: 'paired-lowrise', bay: 4.0, width: .66, height: .65, split: 1, group: 3 },
    { name: 'transom-lowrise', bay: 3.7, width: .60, height: .70, split: 2, group: 4 },
  ],
};

export function facadeGrammar(family, variant = 0) {
  const choices = grammars[family] || grammars.lowrise;
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(variant * choices.length)));
  return { ...choices[index], index };
}

export function facadeLayout(length, height, style) {
  const grammar = facadeGrammar(style.family, style.variant);
  const bays = Math.max(1, Math.floor(length / grammar.bay));
  const floor = Math.max(2.8, style.floor);
  return {
    ...grammar, length, wallHeight: height, bays, floor, bayWidth: length / bays,
    levels: Math.max(0, Math.floor(height / floor)),
    // w=0 is reserved for older/special landmark skins with the default layout.
    attributes: [bays, grammar.width / 2, grammar.height / 2, grammar.split + 1],
  };
}

export function* facadeWindows(layout, maxLevels = Infinity) {
  for (let level = 1; level < Math.min(layout.levels, maxLevels); level++) {
    for (let bay = 0; bay < layout.bays; bay++) {
      const x = (bay + .5) * layout.bayWidth, y = (level + .5) * layout.floor;
      const width = layout.bayWidth * layout.width, height = layout.floor * layout.height;
      if (y + height / 2 >= layout.wallHeight) continue;
      yield { bay, level, x, y, width, height, split: layout.split };
    }
  }
}
