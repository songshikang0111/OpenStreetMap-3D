// Design grammars are deterministic illustrations, not observed window records.
// A single layout drives both the shader's pane mask and nearby solid frames.
const grammars = {
  curtain: [
    { name: 'continuous-grid', bay: 2.1, width: .975, height: .96, split: 0, group: 4 },
    { name: 'paired-mullions', bay: 3.0, width: .975, height: .95, split: 1, group: 5 },
    { name: 'slender-vertical', bay: 1.65, width: .95, height: .975, split: 0, group: 6 },
    { name: 'glass-spandrel', bay: 2.8, width: .975, height: .90, split: 0, group: 4 },
  ],
  residential: [
    { name: 'punched-windows', bay: 3.4, width: .60, height: .62, split: 0, group: 3 },
    { name: 'paired-casements', bay: 3.8, width: .68, height: .64, split: 1, group: 3 },
    { name: 'transom-windows', bay: 3.5, width: .62, height: .70, split: 2, group: 4 },
    { name: 'tall-stone-bays', bay: 3.0, width: .48, height: .80, split: 0, group: 4 },
    { name: 'wide-recessed-pairs', bay: 4.6, width: .77, height: .59, split: 1, group: 3 },
    { name: 'square-precast', bay: 3.6, width: .69, height: .69, split: 0, group: 3 },
  ],
  ribbon: [
    { name: 'horizontal-ribbon', bay: 3.9, width: .93, height: .52, split: 0, group: 4 },
    { name: 'paired-ribbon', bay: 4.2, width: .94, height: .56, split: 1, group: 4 },
    { name: 'deep-spandrel', bay: 3.8, width: .91, height: .46, split: 2, group: 3 },
    { name: 'long-ribbon', bay: 5.6, width: .97, height: .65, split: 1, group: 5 },
    { name: 'framed-office-bays', bay: 3.3, width: .72, height: .78, split: 0, group: 3 },
    { name: 'twin-horizontal', bay: 4.8, width: .88, height: .72, split: 2, group: 4 },
  ],
  lowrise: [
    { name: 'small-punched', bay: 3.6, width: .54, height: .60, split: 0, group: 3 },
    { name: 'paired-lowrise', bay: 4.0, width: .66, height: .65, split: 1, group: 3 },
    { name: 'transom-lowrise', bay: 3.7, width: .60, height: .70, split: 2, group: 4 },
    { name: 'narrow-masonry', bay: 2.8, width: .44, height: .76, split: 0, group: 3 },
    { name: 'wide-shopfront', bay: 4.8, width: .81, height: .73, split: 1, group: 4 },
    { name: 'square-rendered', bay: 3.3, width: .65, height: .56, split: 0, group: 3 },
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

// Project onto the entire segment: testing only a wall's midpoint would hide
// nearby windows at the ends of a long warehouse or podium facade.
export function distanceToFacade(wall, position) {
  const t=Math.max(0,Math.min(1,((position.x-wall.a[0])*wall.dx+(position.z-wall.a[1])*wall.dz)/(wall.len*wall.len)));
  return Math.hypot(wall.a[0]+wall.dx*t-position.x,wall.a[1]+wall.dz*t-position.z);
}

export function nearbyFacadeFrames(walls, position, limit=18000) {
  if(position.y>=180)return [];
  const out=[],candidates=walls.map(wall=>({wall,distance:distanceToFacade(wall,position)}))
    .filter(c=>c.distance<=162).sort((a,b)=>a.distance-b.distance||a.wall.key.localeCompare(b.wall.key));
  for(const {wall} of candidates){
    const {a,dx,dz,len,normal,angle,layout,baseY,style}=wall;
    for(const cell of facadeWindows(layout,12)){
      const {bay,level}=cell,u=cell.x/len,y=baseY+cell.y,w=cell.width,h=cell.height;
      const x=a[0]+dx*u+normal[0]*.10,z=a[1]+dz*u+normal[2]*.10;
      if(Math.hypot(x-position.x,z-position.z)>160||Math.abs(y-position.y)>90)continue;
      // Curtain mullions sit almost flush; masonry keeps a projecting sill.
      const glass=style.family==='curtain',splitWidth=glass?.016:.036;
      const frames=[{x,y:y-h/2,z,angle,w,h:glass?.065:.13,d:glass?.12:.35}];
      if(cell.split===1)frames.push({x,y,z,angle,w:splitWidth*layout.bayWidth,h,d:glass?.12:.20});
      if(cell.split===2)frames.push({x,y:y+.16*layout.floor,z,angle,w,h:.036*layout.floor,d:.20});
      if(style.family==='residential'){
        frames.push({x:x-dx/len*w/2,y,z:z-dz/len*w/2,angle,w:.12,h,d:.24});
        frames.push({x:x+dx/len*w/2,y,z:z+dz/len*w/2,angle,w:.12,h,d:.24});
        if(style.balcony&&bay%3===1&&level%2===0){
          const bx=x+normal[0]*.55,bz=z+normal[2]*.55;
          frames.push({x:bx,y:y-h/2-.15,z:bz,angle,w:w+1,h:.18,d:1.25});
          frames.push({x:bx+normal[0]*.55,y:y-h/2+.42,z:bz+normal[2]*.55,angle,w:w+1,h:1,d:.13});
        }
      }
      // Keep each pane's frame set intact when the allocation limit is reached.
      if(out.length+frames.length>limit)return out;
      out.push(...frames);
    }
  }
  return out;
}
