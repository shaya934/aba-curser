import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../src/lib/db';
import {schedule,expandAppointments,type ScheduleInput} from '../src/lib/scheduling';
const req=(method:string,data?:unknown)=>new Request('http://localhost/api',{method,body:data?JSON.stringify(data):undefined});
after(()=>db.$disconnect());
const base:ScheduleInput={clientId:'x',therapistId:'y',start:'2027-03-07T09:00',end:'2027-03-07T10:00',timezone:'America/New_York',location:'Clinic',frequency:'Weekly',count:3};
test('weekly recurrence preserves wall time across DST and rejects nonexistent/ambiguous times',()=>{const rows=expandAppointments(base);assert.equal(rows[0].start.toISOString(),'2027-03-07T14:00:00.000Z');assert.equal(rows[1].start.toISOString(),'2027-03-14T13:00:00.000Z');assert.throws(()=>expandAppointments({...base,start:'2027-03-14T02:30',end:'2027-03-14T04:00'}),/does not exist/);assert.throws(()=>expandAppointments({...base,start:'2027-11-07T01:30',end:'2027-11-07T03:00'}),/ambiguous/);});
test('transactional scheduling prevents concurrent overlaps, supports reschedule and cancellation',async()=>{
 const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.test'}});const therapist=await db.user.findUniqueOrThrow({where:{email:'rbt@example.test'}});const client=await db.client.create({data:{orgId:admin.orgId,name:'Synthetic Calendar Test',dob:'2018-01-01',clientCode:'CAL-'+Date.now(),assignments:{create:{userId:therapist.id}}}});
 const input={...base,clientId:client.id,therapistId:therapist.id,start:'2030-03-01T09:00',end:'2030-03-01T10:00',frequency:'Once'};
 const results=await Promise.allSettled([schedule(admin,['appointments'],req('POST',input)),schedule(admin,['appointments'],req('POST',input))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const a=await db.appointment.findFirstOrThrow({where:{clientId:client.id}});await schedule(admin,['appointments',a.id],req('PATCH',{...input,start:'2030-03-01T11:00',end:'2030-03-01T12:00'}));assert.equal((await db.appointment.findUniqueOrThrow({where:{id:a.id}})).start.toISOString(),'2030-03-01T16:00:00.000Z');
 await schedule(admin,['appointments',a.id],req('PATCH',{status:'Cancelled'}));assert.equal((await db.appointment.findUniqueOrThrow({where:{id:a.id}})).status,'Cancelled');await assert.rejects(schedule(therapist,['appointments'],req('POST',input)),/permission/);
 await db.appointment.deleteMany({where:{clientId:client.id}});await db.client.delete({where:{id:client.id}});
});
