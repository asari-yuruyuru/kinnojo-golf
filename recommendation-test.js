// macOS: osascript -l JavaScript recommendation-test.js
ObjC.import("Foundation");
const source = $.NSString.stringWithContentsOfFileEncodingError("/Users/asanokeisuke/Documents/鬼ノ城ゴルフ戦略/app.js", $.NSUTF8StringEncoding, null).js;
new Function(source);
const core = source.slice(0, source.indexOf("const selected =")) + source.slice(source.indexOf("function clubTendency("), source.indexOf("function renderShotRecord("));
new Function(core + `
function assert(test, message) { if (!test) throw new Error(message); }
function experienceForHole(hole) { return roundExperienceByCourse[courseData.id]?.[hole.holeNumber] ?? {}; }
const before = JSON.stringify(courseData);
const expected = {1:"3w",3:"5w",12:"5w",13:"driver",14:"4u",16:"3w",17:"3u",18:"3w"};
const rows = courseData.holes.filter(h=>h.par===4||h.par===5).map(h=>{
 const r=evaluatePersonalizedRecommendation(h);
 assert(!expected[h.holeNumber] || r.primary.club.id===expected[h.holeNumber], "実戦目安との不一致: "+h.holeNumber);
 assert(r.primary.safe, "許容リスク超過: "+h.holeNumber);
 assert(r.primaryRecommendation===r.primary, "互換エイリアス");
 if(r.aggressiveOption) assert(r.aggressiveOption.club.carryYards>r.primary.club.carryYards, "攻める候補の距離");
 return {hole:h.holeNumber,primary:r.primary.club.name,attack:r.aggressiveOption?.club.name??"—",remaining:r.primary.remainingDistance,reason:r.primary.reasons.join(" / ")};
});
assert(JSON.stringify(courseData)===before, "推薦計算が保存対象を変更");
assert(rows.length===14,"対象ホール数");
console.log(JSON.stringify(rows));
console.log(JSON.stringify(rows.reduce((c,r)=>(c[r.primary]=(c[r.primary]??0)+1,c),{})));
const short=holeByNumberForTest(14);
assert(evaluatePersonalizedClub(short,clubData[4]).score>evaluatePersonalizedClub(short,clubData[0]).score,"短いPAR4でDriverを過大評価");
function holeByNumberForTest(n){return courseData.holes.find(h=>h.holeNumber===n);}
console.log("PASS: 14ホール、実戦目安8件、許容リスク、データ非変更、短いPAR4");
`)();
