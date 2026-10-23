import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../src/lib/db';
import {goals} from '../src/lib/goals';
const req=(method:string,data?:unknown)=>new Request('http://localhost/api',{method,body:data?JSON.stringify(data):undefined});
after(()=>db.$disconnect());
test('assigned BCBA manages versioned goals and all measurement types, RBT cannot edit',async()=>{
 const bcba=await db.user.findUniqueOrThrow({where:{email:'bcba@example.test'}});const rbt=await db.user.findUniqueOrThrow({where:{email:'rbt@example.test'}});
 const c=await db.client.create({data:{orgId:bcba.orgId,name:'Synthetic Goal Test',dob:'2017-01-01',clientCode:'GOAL-'+Date.now(),assignments:{create:[{userId:bcba.id},{userId:rbt.id}]}}});
 const g=await(await goals(bcba,['goals'],req('POST',{clientId:c.id,name:'Functional communication',domain:'Communication',startDate:'2026-01-01',masteryCriteria:'80% over 3 sessions'})))!.json();
 for(const measurement of ['Correct/Incorrect','Independent/Prompted','Frequency','Duration','Percentage','Yes/No']){const t=await(await goals(bcba,['goals',g.id,'targets'],req('POST',{name:measurement,measurement,masteryCriteria:'Defined by BCBA'})))!.json();assert.equal(t.goalId,g.id);const updated=await(await goals(bcba,['targets',t.id],req('PATCH',{...t,status:'Mastered'})))!.json();assert.equal(updated.version,2);assert(updated.masteredAt);const history=await(await goals(bcba,['targets',t.id,'history'],req('GET')))!.json();assert.equal(history.length,2);await assert.rejects(goals(bcba,['targets',t.id],req('PATCH',{...t,status:'Active'})),/changed/);await assert.rejects(goals(rbt,['targets',t.id],req('PATCH',updated)),/permission/);}
 const unassigned=await db.user.create({data:{orgId:bcba.orgId,name:'Synthetic Unassigned',email:'u-'+Date.now()+'@example.test',passwordHash:'unused',role:'BCBA'}});await assert.rejects(goals(unassigned,['goals',g.id],req('GET')),/not found/);
 const targets=await db.target.findMany({where:{goalId:g.id}});await db.clinicalHistory.deleteMany({where:{entityId:{in:[g.id,...targets.map(t=>t.id)]}}});await db.target.deleteMany({where:{goalId:g.id}});await db.goal.delete({where:{id:g.id}});await db.client.delete({where:{id:c.id}});await db.user.delete({where:{id:unassigned.id}});
});
