import test from "node:test";
import assert from "node:assert/strict";
import { readNqCycle, nqCycleMode, advanceNqCycle } from "../src/collector-nq-cycle.js";
test("repeats 50 regular, one low, 25 regular, one unavailable without counting extras", () => {
  let s = { recorded: 0, lowDone: false };
  for (let i=0;i<50;i++) { assert.equal(nqCycleMode(s), null); s=advanceNqCycle(s, {}); }
  assert.equal(nqCycleMode(s), "low");
  s=advanceNqCycle(s, {nqCycleMode:"low"});
  assert.equal(s.recorded,50);
  for(let i=0;i<25;i++) { assert.equal(nqCycleMode(s),null); s=advanceNqCycle(s,{}); }
  assert.equal(nqCycleMode(s),"unavailable");
  s=advanceNqCycle(s,{nqCycleMode:"unavailable"});
  assert.deepEqual(s,{recorded:0,lowDone:false});
  for(let i=0;i<50;i++) s=advanceNqCycle(s,{});
  assert.equal(nqCycleMode(s),"low");
});
test("saved milestones survive reopening and empty special pools advance the cycle", () => {
  const storage={getItem:()=>JSON.stringify({recorded:50,lowDone:false})};
  const s=readNqCycle(storage,"key");
  assert.equal(nqCycleMode(s),"low");
  assert.deepEqual(advanceNqCycle(s,{nqCycleMode:"low",nqCycleFallback:true}),{recorded:51,lowDone:true});
  assert.deepEqual(advanceNqCycle({recorded:75,lowDone:true},{nqCycleMode:"unavailable",nqCycleFallback:true}),{recorded:1,lowDone:false});
  assert.deepEqual(readNqCycle({getItem:()=>"{bad"},"key"),{recorded:0,lowDone:false});
});
