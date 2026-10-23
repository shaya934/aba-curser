import {db} from '../src/lib/db';
import {processReport} from '../src/lib/reports';
async function run(){const jobs=await db.pdfReport.findMany({where:{status:{not:'Ready'},attempts:{lt:5}},select:{id:true},orderBy:{createdAt:'asc'},take:50});for(const job of jobs)console.log(`Report ${job.id}: ${await processReport(job.id)?'ready':'failed'}`);}
if(process.argv.includes('--watch')){for(;;){await run().catch(()=>console.error('Report worker could not reach the database.'));await new Promise(r=>setTimeout(r,30000));}}else{try{await run();}finally{await db.$disconnect();}}
